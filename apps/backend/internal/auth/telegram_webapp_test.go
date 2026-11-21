package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"
)

func generateTestInitData(botToken string, params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
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

	secretMac := hmac.New(sha256.New, []byte("WebAppData"))
	secretMac.Write([]byte(botToken))
	secretKey := secretMac.Sum(nil)

	hashMac := hmac.New(sha256.New, secretKey)
	hashMac.Write([]byte(dataCheckString))
	hash := hex.EncodeToString(hashMac.Sum(nil))

	v := url.Values{}
	for k, val := range params {
		v.Set(k, val)
	}
	v.Set("hash", hash)
	return v.Encode()
}

func TestValidateTelegramWebAppData(t *testing.T) {
	botToken := "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
	now := time.Now().Unix()

	params := map[string]string{
		"auth_date": fmt.Sprintf("%d", now),
		"query_id":  "AAHdF6IQAAAAAN0XohDhrOrc",
		"user":      `{"id":987654321,"first_name":"Alex","username":"alex_tg","is_premium":true}`,
	}

	validInitData := generateTestInitData(botToken, params)

	// Case 1: Valid initData
	data, err := ValidateTelegramWebAppData(validInitData, botToken, 24*time.Hour)
	if err != nil {
		t.Fatalf("expected valid initData, got error: %v", err)
	}
	if data == nil || data.User == nil {
		t.Fatalf("expected parsed user, got nil")
	}
	if data.User.ID != 987654321 {
		t.Errorf("expected User ID 987654321, got %d", data.User.ID)
	}
	if data.User.FirstName != "Alex" {
		t.Errorf("expected User FirstName Alex, got %s", data.User.FirstName)
	}
	if data.User.Username != "alex_tg" {
		t.Errorf("expected User Username alex_tg, got %s", data.User.Username)
	}

	// Case 2: Tampered param
	tamperedInitData := validInitData + "&extra=bad"
	_, err = ValidateTelegramWebAppData(tamperedInitData, botToken, 24*time.Hour)
	if err == nil {
		t.Errorf("expected signature verification failure for tampered data")
	}

	// Case 3: Wrong bot token
	_, err = ValidateTelegramWebAppData(validInitData, "wrong-token", 24*time.Hour)
	if err == nil {
		t.Errorf("expected signature verification failure for wrong bot token")
	}

	// Case 4: Missing hash
	v, _ := url.ParseQuery(validInitData)
	v.Del("hash")
	_, err = ValidateTelegramWebAppData(v.Encode(), botToken, 24*time.Hour)
	if err != ErrMissingHash {
		t.Errorf("expected ErrMissingHash, got %v", err)
	}

	// Case 5: Expired initData
	oldParams := map[string]string{
		"auth_date": fmt.Sprintf("%d", now-100000), // > 24h
		"user":      `{"id":987654321,"first_name":"Alex"}`,
	}
	oldInitData := generateTestInitData(botToken, oldParams)
	_, err = ValidateTelegramWebAppData(oldInitData, botToken, 24*time.Hour)
	if err != ErrExpiredInitData {
		t.Errorf("expected ErrExpiredInitData, got %v", err)
	}

	// Case 6: Future auth_date
	futureParams := map[string]string{
		"auth_date": fmt.Sprintf("%d", now+3600), // 1h in future
		"user":      `{"id":987654321,"first_name":"Alex"}`,
	}
	futureInitData := generateTestInitData(botToken, futureParams)
	_, err = ValidateTelegramWebAppData(futureInitData, botToken, 24*time.Hour)
	if err != ErrFutureInitData {
		t.Errorf("expected ErrFutureInitData, got %v", err)
	}
}
