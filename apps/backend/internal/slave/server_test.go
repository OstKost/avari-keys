package slave_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/slave"
)

func setupTestSlave() (*slave.Server, string) {
	apiKey := "test-secret-token-12345"
	mockRunner := runner.NewMockRunner(true)
	srv := slave.NewServer(slave.Config{
		APIKey: apiKey,
		Port:   "8081",
	}, mockRunner)
	return srv, apiKey
}

func TestDecoyPage(t *testing.T) {
	srv, _ := setupTestSlave()
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Node Gateway") {
		t.Fatalf("expected decoy HTML content, got %s", rec.Body.String())
	}
}

func TestHealthCheck(t *testing.T) {
	srv, _ := setupTestSlave()
	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	var res models.HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("failed to decode health JSON: %v", err)
	}
	if res.Status != "ok" || !res.AWGAvailable {
		t.Fatalf("unexpected health response: %+v", res)
	}
}

func TestAuthMiddleware(t *testing.T) {
	srv, apiKey := setupTestSlave()

	// 1. Missing API Key -> 401
	req := httptest.NewRequest("GET", "/api/v1/clients", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", rec.Code)
	}

	// 2. Invalid API Key -> 401
	req = httptest.NewRequest("GET", "/api/v1/clients", nil)
	req.Header.Set("X-API-Key", "wrong-key")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", rec.Code)
	}

	// 3. Valid X-API-Key -> 200
	req = httptest.NewRequest("GET", "/api/v1/clients", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	// 4. Valid Authorization Bearer -> 200
	req = httptest.NewRequest("GET", "/api/v1/clients", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
}

func TestClientLifecycle(t *testing.T) {
	srv, apiKey := setupTestSlave()

	clientName := "alice-phone"

	// 1. Create client
	body, _ := json.Marshal(models.ClientCreateRequest{Name: clientName, PSK: true})
	req := httptest.NewRequest("POST", "/api/v1/clients", bytes.NewReader(body))
	req.Header.Set("X-API-Key", apiKey)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var created models.ClientResponse
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode client response: %v", err)
	}
	if created.Name != clientName || !strings.Contains(created.Config, "[Interface]") || !strings.Contains(created.Config, "PresharedKey") {
		t.Fatalf("invalid client response or missing PSK: %+v", created)
	}

	// 2. Get client details
	req = httptest.NewRequest("GET", "/api/v1/clients/"+clientName, nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	// 3. List clients
	req = httptest.NewRequest("GET", "/api/v1/clients", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	var list []models.ClientListItem
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatalf("failed to decode client list: %v", err)
	}
	if len(list) != 1 || list[0].Name != clientName {
		t.Fatalf("expected 1 client in list, got %+v", list)
	}

	// 4. Delete client
	req = httptest.NewRequest("DELETE", "/api/v1/clients/"+clientName, nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	// 5. Verify client no longer exists
	req = httptest.NewRequest("GET", "/api/v1/clients/"+clientName, nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found after deletion, got %d", rec.Code)
	}
}

func TestStatsEndpoint(t *testing.T) {
	srv, apiKey := setupTestSlave()

	req := httptest.NewRequest("GET", "/api/v1/stats", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
}

func TestCascadeEgressEndpoints(t *testing.T) {
	srv, apiKey := setupTestSlave()

	// 1. Get initial egress status (default: awg1)
	req := httptest.NewRequest("GET", "/api/v1/cascade/egress", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	var status models.EgressStatusResponse
	if err := json.NewDecoder(rec.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode egress status: %v", err)
	}
	if status.ActiveInterface != "awg1" {
		t.Fatalf("expected active interface 'awg1', got '%s'", status.ActiveInterface)
	}

	// 2. Switch to awg3
	switchBody, _ := json.Marshal(models.SwitchEgressRequest{Interface: "awg3"})
	req = httptest.NewRequest("POST", "/api/v1/cascade/egress", bytes.NewReader(switchBody))
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on switch, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Verify status updated to awg3
	req = httptest.NewRequest("GET", "/api/v1/cascade/egress", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	if err := json.NewDecoder(rec.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode egress status: %v", err)
	}
	if status.ActiveInterface != "awg3" {
		t.Fatalf("expected active interface 'awg3' after switch, got '%s'", status.ActiveInterface)
	}

	// 4. Test invalid interface
	badBody, _ := json.Marshal(models.SwitchEgressRequest{Interface: "eth0"})
	req = httptest.NewRequest("POST", "/api/v1/cascade/egress", bytes.NewReader(badBody))
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 error for invalid interface eth0, got %d", rec.Code)
	}
}

func TestHysteriaClientAndAuth(t *testing.T) {
	srv, apiKey := setupTestSlave()

	// 1. Create Hysteria client
	createReq, _ := json.Marshal(models.ClientCreateRequest{
		Name:     "u1_hysteria_test",
		Protocol: "hysteria2",
	})
	req := httptest.NewRequest("POST", "/api/v1/clients", bytes.NewReader(createReq))
	req.Header.Set("X-API-Key", apiKey)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
	}

	var created models.ClientResponse
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode json: %v", err)
	}

	if created.Protocol != "hysteria2" || !strings.HasPrefix(created.VPNURI, "hysteria2://") {
		t.Fatalf("unexpected client response: %+v", created)
	}

	// 2. Parse password from URI: hysteria2://<pwd>@s2.avari.dev:443/...
	uriParts := strings.Split(strings.TrimPrefix(created.VPNURI, "hysteria2://"), "@")
	if len(uriParts) < 2 {
		t.Fatalf("malformed hysteria uri: %s", created.VPNURI)
	}
	password := uriParts[0]

	// 3. Test HTTP Auth Hook with correct password
	authReq, _ := json.Marshal(map[string]string{
		"auth": password,
		"addr": "1.2.3.4:5678",
	})
	req = httptest.NewRequest("POST", "/api/v1/hysteria/auth", bytes.NewReader(authReq))
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid auth, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Test HTTP Auth Hook with wrong password
	badAuthReq, _ := json.Marshal(map[string]string{
		"auth": "wrongpassword123",
		"addr": "1.2.3.4:5678",
	})
	req = httptest.NewRequest("POST", "/api/v1/hysteria/auth", bytes.NewReader(badAuthReq))
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for bad auth, got %d", rec.Code)
	}

	// 5. Test GetClient
	req = httptest.NewRequest("GET", "/api/v1/clients/u1_hysteria_test", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get client, got %d", rec.Code)
	}

	// 6. Test DeleteClient
	req = httptest.NewRequest("DELETE", "/api/v1/clients/u1_hysteria_test", nil)
	req.Header.Set("X-API-Key", apiKey)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on delete client, got %d", rec.Code)
	}
}

