package master_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// firewallTestExec is a no-op command executor used by the mock slave's firewall.
type firewallTestExec struct{}

func (firewallTestExec) Run(ctx context.Context, name string, args ...string) (string, error) {
	return "", nil
}
func (firewallTestExec) Raw(ctx context.Context, name string, args ...string) (int, error) {
	return 1, nil
}

func firewallTestResolve(ctx context.Context, network, host string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("10.99.99.1")}, nil
}

func loginAdmin(t *testing.T, handler http.Handler) string {
	t.Helper()
	body, _ := json.Marshal(models.LoginRequest{Username: "Forve", Password: "AdminPass123!"})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin login failed: %d", rec.Code)
	}
	var resp models.LoginResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode login: %v", err)
	}
	return resp.Token
}

func doAdmin(t *testing.T, handler http.Handler, token, method, path string, body any, target any) int {
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
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if target != nil && rec.Body.Len() > 0 {
		_ = json.NewDecoder(rec.Body).Decode(target)
	}
	return rec.Code
}

func TestAdminTrafficPolicyFlow(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()
	handler := masterSrv.Handler()
	token := loginAdmin(t, handler)

	// 1. Default policy is off, with a seeded blocklist.
	var view models.TrafficPolicyView
	code := doAdmin(t, handler, token, "GET", "/api/v1/admin/traffic-policy", nil, &view)
	if code != http.StatusOK {
		t.Fatalf("get policy: %d", code)
	}
	if view.Mode != models.PolicyOff {
		t.Fatalf("expected off, got %s", view.Mode)
	}
	if len(view.Blocklist) == 0 {
		t.Fatalf("expected seeded blocklist")
	}

	// 2. Set policy to soft; fan-out should apply to the single mock node.
	var fanout models.TrafficPolicyFanoutResponse
	code = doAdmin(t, handler, token, "PUT", "/api/v1/admin/traffic-policy", models.TrafficPolicyRequest{Mode: models.PolicySoft}, &fanout)
	if code != http.StatusOK {
		t.Fatalf("put policy: %d", code)
	}
	if fanout.Mode != models.PolicySoft {
		t.Fatalf("expected soft, got %s", fanout.Mode)
	}
	if fanout.AppliedNodes != 1 || fanout.FailedNodes != 0 {
		t.Fatalf("expected 1 applied, 0 failed; got %+v", fanout)
	}

	// 3. Storage reflects the new policy.
	mode, err := store.GetTrafficPolicy(context.Background())
	if err != nil || mode != models.PolicySoft {
		t.Fatalf("expected soft in storage, got %s (err=%v)", mode, err)
	}

	// 4. Strict is rejected at the Master level.
	code = doAdmin(t, handler, token, "PUT", "/api/v1/admin/traffic-policy", models.TrafficPolicyRequest{Mode: models.PolicyStrict}, nil)
	if code != http.StatusBadRequest {
		t.Fatalf("expected 400 for strict, got %d", code)
	}

	// 5. Invalid mode is rejected.
	code = doAdmin(t, handler, token, "PUT", "/api/v1/admin/traffic-policy", models.TrafficPolicyRequest{Mode: "bogus"}, nil)
	if code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid mode, got %d", code)
	}
}

func TestAdminTorrentBlocklistCRUD(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()
	handler := masterSrv.Handler()
	token := loginAdmin(t, handler)

	// Add a domain (normalized to lowercase).
	var entry models.TorrentBlocklistEntry
	code := doAdmin(t, handler, token, "POST", "/api/v1/admin/torrent-blocklist", models.TorrentBlocklistRequest{Domain: "  TRACKER.Example.ORG  "}, &entry)
	if code != http.StatusCreated {
		t.Fatalf("add domain: %d", code)
	}
	if entry.Domain != "tracker.example.org" {
		t.Fatalf("expected normalized domain, got %q", entry.Domain)
	}

	// List includes it.
	var entries []models.TorrentBlocklistEntry
	code = doAdmin(t, handler, token, "GET", "/api/v1/admin/torrent-blocklist", nil, &entries)
	if code != http.StatusOK {
		t.Fatalf("list domains: %d", code)
	}
	found := false
	for _, e := range entries {
		if e.Domain == "tracker.example.org" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected added domain in list")
	}

	// Delete it.
	code = doAdmin(t, handler, token, "DELETE", "/api/v1/admin/torrent-blocklist/"+strconv.FormatInt(entry.ID, 10), nil, nil)
	if code != http.StatusOK {
		t.Fatalf("delete domain: %d", code)
	}
}

func TestTrafficPolicyRequiresAdmin(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()
	handler := masterSrv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/admin/traffic-policy", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
