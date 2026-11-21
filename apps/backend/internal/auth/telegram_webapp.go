package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrEmptyInitData    = errors.New("telegram init_data is empty")
	ErrEmptyBotToken    = errors.New("telegram bot token is empty")
	ErrMissingHash      = errors.New("telegram init_data missing hash")
	ErrInvalidSignature = errors.New("telegram init_data signature verification failed")
	ErrExpiredInitData  = errors.New("telegram init_data is expired")
	ErrFutureInitData   = errors.New("telegram init_data timestamp is in the future")
)

// TelegramWebAppUser represents the user payload passed by Telegram Mini App.
type TelegramWebAppUser struct {
	ID           int64  `json:"id"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name,omitempty"`
	Username     string `json:"username,omitempty"`
	LanguageCode string `json:"language_code,omitempty"`
	IsPremium    bool   `json:"is_premium,omitempty"`
}

// TelegramWebAppData contains parsed and verified Telegram Mini App parameters.
type TelegramWebAppData struct {
	User     *TelegramWebAppUser
	AuthDate time.Time
	QueryID  string
	Hash     string
	Params   map[string]string
}

// ValidateTelegramWebAppData verifies the cryptographic signature of Telegram WebApp initData
// using HMAC-SHA256 according to Telegram WebApp specification.
// See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
func ValidateTelegramWebAppData(initData string, botToken string, maxAge time.Duration) (*TelegramWebAppData, error) {
	initData = strings.TrimSpace(initData)
	if initData == "" {
		return nil, ErrEmptyInitData
	}
	botToken = strings.TrimSpace(botToken)
	if botToken == "" {
		return nil, ErrEmptyBotToken
	}

	values, err := url.ParseQuery(initData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse init_data query: %w", err)
	}

	hash := values.Get("hash")
	if hash == "" {
		return nil, ErrMissingHash
	}

	// 1. Build data-check-string from all keys except "hash", sorted alphabetically
	keys := make([]string, 0, len(values))
	params := make(map[string]string, len(values))
	for k := range values {
		val := values.Get(k)
		params[k] = val
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)

	var sb strings.Builder
	for i, k := range keys {
		if i > 0 {
			sb.WriteByte('\n')
		}
		sb.WriteString(k)
		sb.WriteByte('=')
		sb.WriteString(params[k])
	}
	dataCheckString := sb.String()

	// 2. Secret key = HMAC_SHA256("WebAppData", botToken)
	secretMac := hmac.New(sha256.New, []byte("WebAppData"))
	secretMac.Write([]byte(botToken))
	secretKey := secretMac.Sum(nil)

	// 3. Expected hash = hex(HMAC_SHA256(secretKey, dataCheckString))
	hashMac := hmac.New(sha256.New, secretKey)
	hashMac.Write([]byte(dataCheckString))
	expectedHash := hex.EncodeToString(hashMac.Sum(nil))

	if !hmac.Equal([]byte(strings.ToLower(hash)), []byte(strings.ToLower(expectedHash))) {
		return nil, ErrInvalidSignature
	}

	// 4. Validate auth_date freshness
	var authDate time.Time
	if authDateStr := params["auth_date"]; authDateStr != "" {
		ts, err := strconv.ParseInt(authDateStr, 10, 64)
		if err == nil && ts > 0 {
			authDate = time.Unix(ts, 0)
			now := time.Now()
			if authDate.After(now.Add(5 * time.Minute)) {
				return nil, ErrFutureInitData
			}
			if maxAge > 0 && now.Sub(authDate) > maxAge {
				return nil, ErrExpiredInitData
			}
		}
	}

	// 5. Parse user info if present
	var tgUser *TelegramWebAppUser
	if userJSON := params["user"]; userJSON != "" {
		var u TelegramWebAppUser
		if err := json.Unmarshal([]byte(userJSON), &u); err == nil && u.ID > 0 {
			tgUser = &u
		}
	}

	return &TelegramWebAppData{
		User:     tgUser,
		AuthDate: authDate,
		QueryID:  params["query_id"],
		Hash:     hash,
		Params:   params,
	}, nil
}
