package vless

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

type Profile struct {
	Server      string `json:"server"`
	Port        int    `json:"server_port"`
	UUID        string `json:"uuid"`
	Flow        string `json:"flow"`
	SNI         string `json:"sni"`
	PublicKey   string `json:"reality_public_key"`
	ShortID     string `json:"reality_short_id"`
	Fingerprint string `json:"fingerprint"`
	Protocol    string `json:"protocol_type"`
}

func NewUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	value := hex.EncodeToString(bytes[:])
	return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:], nil
}

func (profile Profile) Response(name string) (*models.ClientResponse, error) {
	if profile.Server == "" || profile.Port < 1 || profile.Port > 65535 || profile.UUID == "" || profile.SNI == "" || profile.PublicKey == "" || profile.ShortID == "" {
		return nil, fmt.Errorf("incomplete VLESS Reality profile")
	}
	profile.Protocol = "vless"
	if profile.Flow == "" {
		profile.Flow = "xtls-rprx-vision"
	}
	if profile.Fingerprint == "" {
		profile.Fingerprint = "chrome"
	}
	config, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return nil, err
	}
	query := url.Values{"security": {"reality"}, "encryption": {"none"}, "pbk": {profile.PublicKey}, "fp": {profile.Fingerprint}, "sni": {profile.SNI}, "sid": {profile.ShortID}, "flow": {profile.Flow}, "type": {"tcp"}}
	uri := url.URL{Scheme: "vless", User: url.User(profile.UUID), Host: net.JoinHostPort(profile.Server, strconv.Itoa(profile.Port)), RawQuery: query.Encode(), Fragment: name}
	return &models.ClientResponse{Name: name, Protocol: "vless", Config: string(config), VPNURI: uri.String()}, nil
}
