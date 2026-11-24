package master_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func TestVlessKeyLifecycle(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()
	var supported, refuse atomic.Bool
	var clientName atomic.Value
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			json.NewEncoder(w).Encode(models.HealthResponse{VlessAvailable: supported.Load()})
			return
		}
		if !supported.Load() || r.Header.Get("X-API-Key") != "test-secret" {
			t.Error("unexpected credential operation")
			w.WriteHeader(403)
			return
		}
		if r.Method == "POST" {
			var req models.ClientCreateRequest
			json.NewDecoder(r.Body).Decode(&req)
			if req.Protocol != "vless" {
				t.Error("wrong protocol")
			}
			clientName.Store(req.Name)
		} else if r.URL.Query().Get("protocol") != "vless" || !strings.HasSuffix(r.URL.Path, "/"+clientName.Load().(string)) {
			t.Error("incorrect credential reference")
		}
		if r.Method == "DELETE" {
			if refuse.Load() {
				w.WriteHeader(503)
				return
			}
			w.Header().Set("X-Avari-Protocol", "vless")
			json.NewEncoder(w).Encode(models.GenericSuccessResponse{Success: true})
			return
		}
		json.NewEncoder(w).Encode(models.ClientResponse{Name: clientName.Load().(string), Protocol: "vless", VPNURI: "vless://test", Config: "{}"})
	}))
	defer fake.Close()
	node, err := store.CreateNode(context.Background(), "Direct", "direct", "DE", "", fake.URL, "test-secret", false, false, false, false, true)
	if err != nil {
		t.Fatal(err)
	}
	token := ""
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		masterSrv.Handler().ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, rec.Code, want, rec.Body.String())
		}
		return rec
	}
	login := call("POST", "/api/v1/auth/login", `{"username":"Forve","password":"AdminPass123!"}`, 200)
	var auth models.LoginResponse
	json.Unmarshal(login.Body.Bytes(), &auth)
	token = auth.Token
	body := fmt.Sprintf(`{"protocol":"vless","device_name":"laptop","node_id":%d}`, node.ID)
	call("POST", "/api/v1/keys", body, 503)
	supported.Store(true)
	rec := call("POST", "/api/v1/keys", body, 201)
	var key models.ClientConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &key); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/keys/%d", key.ID)
	call("GET", path, "", 200)
	call("DELETE", fmt.Sprintf("/api/v1/admin/nodes/%d", node.ID), "", 409)
	refuse.Store(true)
	call("DELETE", path, "", 502)
	call("GET", path, "", 200)
	refuse.Store(false)
	call("DELETE", path, "", 200)
	call("GET", path, "", 404)
}
