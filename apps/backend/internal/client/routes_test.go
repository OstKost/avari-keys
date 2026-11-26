package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthUsesBackupOnlyOnTransportFailure(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	backup := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer backup.Close()
	c := NewSlaveClient(primary.URL, "test-key")
	c.backup = &SlaveClient{baseURL: backup.URL, apiKey: "test-key", httpClient: backup.Client()}
	if health, err := c.CheckHealth(context.Background()); err == nil || health != nil {
		t.Fatal("HTTP authorization failure must not trigger fallback")
	}
	primary.Close()
	health, err := c.CheckHealth(context.Background())
	if err != nil || health == nil || health.Status != "ok" || !health.ViaBackup {
		t.Fatalf("expected successful authenticated backup: health=%+v err=%v", health, err)
	}
}

func TestConfigureSlaveRoutesRejectsPlainHTTPBackup(t *testing.T) {
	err := ConfigureSlaveRoutes(`{"http://primary.example":{"backup_url":"http://backup.example"}}`)
	if err == nil {
		t.Fatal("expected plain HTTP backup to be rejected")
	}
}
