package vless

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestProfileResponse(t *testing.T) {
	first, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || len(first) != 36 || first[14] != '4' {
		t.Fatal("invalid or duplicate UUID")
	}
	profile := Profile{Server: "2001:db8::1", Port: 443, UUID: first, SNI: "example.com", PublicKey: "public-key", ShortID: "0123"}
	response, err := profile.Response("test device")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(response.VPNURI)
	if err != nil || parsed.Hostname() != profile.Server || parsed.User.Username() != first || parsed.Query().Get("security") != "reality" || parsed.Fragment != "test device" {
		t.Fatalf("invalid URI: %s", response.VPNURI)
	}
	var decoded Profile
	if err := json.Unmarshal([]byte(response.Config), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Protocol != "vless" || decoded.UUID != first || decoded.Flow != "xtls-rprx-vision" {
		t.Fatalf("invalid profile: %+v", decoded)
	}
}

func TestIncompleteProfile(t *testing.T) {
	if _, err := (Profile{}).Response("test"); err == nil {
		t.Fatal("expected error")
	}
}
