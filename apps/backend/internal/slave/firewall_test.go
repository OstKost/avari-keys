package slave_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/firewall"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/slave"
)

type firewallMockExec struct{}

func (firewallMockExec) Run(ctx context.Context, name string, args ...string) (string, error) {
	return "", nil
}
func (firewallMockExec) Raw(ctx context.Context, name string, args ...string) (int, error) {
	return 1, nil
}

func firewallTestResolve(ctx context.Context, network, host string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("10.99.99.1")}, nil
}

func setupTestSlaveWithFirewall() (*slave.Server, string) {
	apiKey := "test-secret-token-12345"
	mockRunner := runner.NewMockRunner(true)
	srv := slave.NewServer(slave.Config{
		APIKey:   apiKey,
		Port:     "8081",
		Firewall: firewall.NewManagerWithResolver(firewallMockExec{}, firewallTestResolve),
	}, mockRunner)
	return srv, apiKey
}

func doSlaveJSON(t *testing.T, srv *slave.Server, apiKey, method, path string, body any, target any) int {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("X-API-Key", apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if target != nil && rec.Body.Len() > 0 {
		_ = json.NewDecoder(rec.Body).Decode(target)
	}
	return rec.Code
}

func TestFirewallApplySoftAndGetStatus(t *testing.T) {
	srv, apiKey := setupTestSlaveWithFirewall()

	var resp models.TrafficPolicyResponse
	code := doSlaveJSON(t, srv, apiKey, "POST", "/api/v1/firewall", models.TrafficPolicyRequest{Mode: models.PolicySoft}, &resp)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if !resp.Applied || resp.Mode != models.PolicySoft {
		t.Fatalf("unexpected response: %+v", resp)
	}

	var status models.FirewallStatusResponse
	code = doSlaveJSON(t, srv, apiKey, "GET", "/api/v1/firewall", nil, &status)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if status.Mode != models.PolicySoft {
		t.Fatalf("expected soft status, got %s", status.Mode)
	}
}

func TestFirewallStrictNotImplemented(t *testing.T) {
	srv, apiKey := setupTestSlaveWithFirewall()

	code := doSlaveJSON(t, srv, apiKey, "POST", "/api/v1/firewall", models.TrafficPolicyRequest{Mode: models.PolicyStrict}, nil)
	if code != http.StatusNotImplemented {
		t.Fatalf("expected 501, got %d", code)
	}
}

func TestFirewallApplyBlocklist(t *testing.T) {
	srv, apiKey := setupTestSlaveWithFirewall()

	code := doSlaveJSON(t, srv, apiKey, "POST", "/api/v1/firewall/blocklist", models.TorrentBlocklistApplyRequest{Domains: []string{"tracker.example.com"}}, nil)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
}

func TestFirewallRequiresAuth(t *testing.T) {
	srv, _ := setupTestSlaveWithFirewall()

	req := httptest.NewRequest("GET", "/api/v1/firewall", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
