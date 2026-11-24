package master_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/master"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/slave"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func setupTestEnvironment(t *testing.T) (*master.Server, *httptest.Server, *storage.Storage, func()) {
	t.Helper()
	t.Setenv("HYSTERIA_SERVER", "vpn.example.test")
	t.Setenv("HYSTERIA_USERS_PATH", filepath.Join(t.TempDir(), "hysteria.json"))
	tmpDir, err := os.MkdirTemp("", "avari-master-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "master.db")

	os.Setenv("ADMIN_USER", "Forve")
	os.Setenv("ADMIN_PASSWORD", "AdminPass123!")

	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}

	// Setup mock slave server
	slaveToken := "slave-secret-123"
	mockRunner := runner.NewMockRunner(true)
	slaveSrv := slave.NewServer(slave.Config{
		APIKey: slaveToken,
		Port:   "8081",
	}, mockRunner)
	slaveHttpSrv := httptest.NewServer(slaveSrv.Handler())

	// Add mock slave node to DB (with Hysteria 2 and Mieru enabled)
	_, err = store.CreateNode(context.Background(), "Mock Cascade Node", "cascade", "NLD", "https://aeza.net", slaveHttpSrv.URL, slaveToken, true, false, true, true)
	if err != nil {
		t.Fatalf("failed to create mock node: %v", err)
	}

	masterSrv := master.NewServer(master.Config{
		Port:                "8080",
		JWTSecret:           "test-jwt-secret-xyz",
		TelegramBotUsername: "AvariTestBot",
	}, store)

	cleanup := func() {
		slaveHttpSrv.Close()
		_ = store.Close()
		_ = os.RemoveAll(tmpDir)
	}

	return masterSrv, slaveHttpSrv, store, cleanup
}

func TestCompleteUserAndKeyFlow(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Register a new user
	regBody, _ := json.Marshal(models.RegisterRequest{
		Username: "alice",
		Password: "alicePassword123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(regBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	// 2. Try login as alice before activation -> Expect 403 Forbidden
	loginBody, _ := json.Marshal(models.LoginRequest{
		Username: "alice",
		Password: "alicePassword123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden before activation, got %d", rec.Code)
	}

	// 3. Login as admin Forve
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 4. Admin lists users and activates alice
	req = httptest.NewRequest("GET", "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var users []models.UserPublic
	_ = json.NewDecoder(rec.Body).Decode(&users)
	var aliceID int64
	for _, u := range users {
		if u.Username == "alice" {
			aliceID = u.ID
			break
		}
	}
	if aliceID == 0 {
		t.Fatalf("alice was not found in users list")
	}

	// Activate alice
	req = httptest.NewRequest("POST", "/api/v1/admin/users/"+string(rune('0'+aliceID))+"/activate", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on user activation, got %d", rec.Code)
	}

	// 5. Login as alice after activation -> Expect 200 OK
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for alice login, got %d", rec.Code)
	}

	var aliceLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&aliceLoginResp)
	aliceToken := aliceLoginResp.Token

	// 6. Alice lists active nodes
	req = httptest.NewRequest("GET", "/api/v1/nodes", nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var nodes []models.NodePublic
	_ = json.NewDecoder(rec.Body).Decode(&nodes)
	if len(nodes) == 0 {
		t.Fatalf("expected at least 1 active node")
	}
	nodeID := nodes[0].ID

	// 7. Alice creates a key on the node with PSK enabled (Shadowrocket)
	keyReqBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     nodeID,
		DeviceName: "iPad-Pro",
		PSK:        true,
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(keyReqBody))
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for key creation, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var createdKey map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&createdKey)
	if createdKey["qr_code"] == nil || createdKey["config"] == nil {
		t.Fatalf("expected config and qr_code in response, got %+v", createdKey)
	}
	configStr, ok := createdKey["config"].(string)
	if !ok || !strings.Contains(configStr, "PresharedKey") {
		t.Fatalf("expected config to contain PresharedKey for Shadowrocket, got: %v", createdKey["config"])
	}

	if createdKey["protocol"] != "awg" {
		t.Fatalf("expected protocol 'awg' in createdKey, got: %v", createdKey["protocol"])
	}

	keyID := int64(createdKey["id"].(float64))

	// Verify GET /api/v1/keys/:id
	req = httptest.NewRequest("GET", fmt.Sprintf("/api/v1/keys/%d", keyID), nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/v1/keys/:id, got %d", rec.Code)
	}
	var fetchedKey map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&fetchedKey)
	if fetchedKey["protocol"] != "awg" {
		t.Fatalf("expected protocol 'awg' in fetchedKey, got: %v", fetchedKey["protocol"])
	}

	// 8. Alice lists her keys
	req = httptest.NewRequest("GET", "/api/v1/keys", nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var myKeys []models.ClientConfig
	_ = json.NewDecoder(rec.Body).Decode(&myKeys)
	if len(myKeys) != 1 || myKeys[0].DeviceName != "iPad-Pro" || myKeys[0].Protocol != "awg" {
		t.Fatalf("expected 1 key with protocol 'awg' for alice, got %+v", myKeys)
	}

	// 9. Alice creates a Hysteria 2 key
	hyReqBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     nodeID,
		DeviceName: "MacBook-Hysteria",
		Protocol:   "hysteria2",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(hyReqBody))
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for Hysteria key, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var createdHyKey map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&createdHyKey)
	if createdHyKey["protocol"] != "hysteria2" {
		t.Fatalf("expected protocol 'hysteria2' in createdHyKey, got: %v", createdHyKey["protocol"])
	}
	hyKeyID := int64(createdHyKey["id"].(float64))

	// Verify GET /api/v1/keys/:id for Hysteria 2 key
	req = httptest.NewRequest("GET", fmt.Sprintf("/api/v1/keys/%d", hyKeyID), nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET /api/v1/keys/:id (hysteria), got %d", rec.Code)
	}
	var fetchedHyKey map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&fetchedHyKey)
	if fetchedHyKey["protocol"] != "hysteria2" {
		t.Fatalf("expected protocol 'hysteria2' in fetchedHyKey, got: %v", fetchedHyKey["protocol"])
	}
}

func TestAdminAuditLogsFlow(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Login as admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 2. Perform user registration to generate logs
	regBody, _ := json.Marshal(models.RegisterRequest{
		Username: "log_user",
		Password: "password123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(regBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register, got %d", rec.Code)
	}

	// 3. Admin gets audit logs
	req = httptest.NewRequest("GET", "/api/v1/admin/logs?limit=50", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin logs, got %d", rec.Code)
	}

	var logsResp models.PaginatedAuditLogsResponse
	_ = json.NewDecoder(rec.Body).Decode(&logsResp)

	if logsResp.TotalCount < 2 {
		t.Fatalf("expected at least 2 logs (login and register), got %d", logsResp.TotalCount)
	}
	if len(logsResp.Logs) < 2 {
		t.Fatalf("expected at least 2 logs returned, got %d", len(logsResp.Logs))
	}

	// 4. Admin filters by category
	req = httptest.NewRequest("GET", "/api/v1/admin/logs?category=auth", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for category filter, got %d", rec.Code)
	}

	var filteredResp models.PaginatedAuditLogsResponse
	_ = json.NewDecoder(rec.Body).Decode(&filteredResp)
	for _, l := range filteredResp.Logs {
		if l.Category != models.CategoryAuth {
			t.Fatalf("expected category auth, got %s", l.Category)
		}
	}

	// 5. Admin calls cleanup endpoint
	cleanupBody, _ := json.Marshal(models.CleanupLogsRequest{Days: 90})
	req = httptest.NewRequest("POST", "/api/v1/admin/logs/cleanup", bytes.NewReader(cleanupBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for logs cleanup, got %d", rec.Code)
	}

	var cleanupResp models.CleanupLogsResponse
	_ = json.NewDecoder(rec.Body).Decode(&cleanupResp)
	if !cleanupResp.Success {
		t.Fatalf("expected cleanup success")
	}
}

func TestDashboardStatsEndpoint(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Admin login
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 2. Query Dashboard Stats as Admin
	req = httptest.NewRequest("GET", "/api/v1/stats/dashboard", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for dashboard stats, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var statsResp models.DashboardStatsResponse
	_ = json.NewDecoder(rec.Body).Decode(&statsResp)

	if statsResp.TotalUsers < 1 {
		t.Fatalf("expected at least 1 user (admin), got %d", statsResp.TotalUsers)
	}
	if statsResp.TotalNodes < 1 {
		t.Fatalf("expected at least 1 node, got %d", statsResp.TotalNodes)
	}
	if statsResp.SystemStatus == "" {
		t.Fatalf("expected system status to be non-empty")
	}

	// 3. Test In-Memory Cache (should return the same GeneratedAt immediately)
	req2 := httptest.NewRequest("GET", "/api/v1/stats/dashboard", nil)
	req2.Header.Set("Authorization", "Bearer "+adminToken)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	var cachedStats models.DashboardStatsResponse
	_ = json.NewDecoder(rec2.Body).Decode(&cachedStats)
	if !cachedStats.GeneratedAt.Equal(statsResp.GeneratedAt) {
		t.Fatalf("expected cached GeneratedAt %v, got %v", statsResp.GeneratedAt, cachedStats.GeneratedAt)
	}

	// 4. Test Bypass with ?fresh=true
	time.Sleep(10 * time.Millisecond)
	req3 := httptest.NewRequest("GET", "/api/v1/stats/dashboard?fresh=true", nil)
	req3.Header.Set("Authorization", "Bearer "+adminToken)
	rec3 := httptest.NewRecorder()
	handler.ServeHTTP(rec3, req3)

	var freshStats models.DashboardStatsResponse
	_ = json.NewDecoder(rec3.Body).Decode(&freshStats)
	if freshStats.GeneratedAt.Equal(statsResp.GeneratedAt) {
		t.Fatalf("expected fresh GeneratedAt to be newer than %v, got %v", statsResp.GeneratedAt, freshStats.GeneratedAt)
	}
}

func TestAdminNodeEditFlow(t *testing.T) {
	masterSrv, slaveHttpSrv, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Admin login
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 2. Add a new node with CountryCode and ProviderURL
	addNodeBody, _ := json.Marshal(models.AddNodeRequest{
		Name:              "Direct Frankfurt S2",
		Type:              "direct",
		CountryCode:       "DEU",
		ProviderURL:       "https://hetzner.com",
		APIURL:            slaveHttpSrv.URL,
		APIKey:            "slave-secret-123",
		IsMobileOptimized: false,
	})
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes", bytes.NewReader(addNodeBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for add node, got %d", rec.Code)
	}

	var createdNode models.Node
	_ = json.NewDecoder(rec.Body).Decode(&createdNode)
	if createdNode.CountryCode != "DEU" || createdNode.ProviderURL != "https://hetzner.com" {
		t.Fatalf("invalid created node data: %+v", createdNode)
	}

	// 3. Edit node via PUT /api/v1/admin/nodes/{id}
	updateNodeBody, _ := json.Marshal(models.UpdateNodeRequest{
		Name:              "Direct Frankfurt S2 (Renamed)",
		Type:              "direct",
		CountryCode:       "DEU",
		ProviderURL:       "https://console.hetzner.cloud",
		APIURL:            slaveHttpSrv.URL,
		APIKey:            "", // Keep existing key
		IsMobileOptimized: true,
	})
	req = httptest.NewRequest("PUT", fmt.Sprintf("/api/v1/admin/nodes/%d", createdNode.ID), bytes.NewReader(updateNodeBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for update node, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var updatedNode models.Node
	_ = json.NewDecoder(rec.Body).Decode(&updatedNode)
	if updatedNode.Name != "Direct Frankfurt S2 (Renamed)" || !updatedNode.IsMobileOptimized || updatedNode.ProviderURL != "https://console.hetzner.cloud" {
		t.Fatalf("invalid updated node data: %+v", updatedNode)
	}
}

func TestAdminNodeDetailAndDiagnoseFlow(t *testing.T) {
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Admin login
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 2. GET /api/v1/admin/nodes/1 (Cascade M0 -> S1 node created in setup)
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for get node detail, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var detail models.NodeDetailResponse
	if err := json.NewDecoder(rec.Body).Decode(&detail); err != nil {
		t.Fatalf("failed to decode node detail: %v", err)
	}
	if detail.ID != 1 {
		t.Fatalf("expected node ID 1, got %d", detail.ID)
	}
	if !detail.Online {
		t.Fatalf("expected node to be online")
	}
	if detail.Health == nil || !detail.Health.AWGAvailable {
		t.Fatalf("expected AWG to be available in health status: %+v", detail.Health)
	}

	// 3. POST /api/v1/admin/nodes/1/diagnose
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes/1/diagnose", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for diagnose node, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var diagDetail models.NodeDetailResponse
	if err := json.NewDecoder(rec.Body).Decode(&diagDetail); err != nil {
		t.Fatalf("failed to decode diagnosed detail: %v", err)
	}
	if !diagDetail.Online {
		t.Fatalf("expected node to remain online after diagnose")
	}
	if diagDetail.ServerStatus.State != "green" {
		t.Fatalf("expected server status state 'green', got '%s'", diagDetail.ServerStatus.State)
	}

	// 4. Test 404 on non-existent node
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/9999", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-existent node, got %d", rec.Code)
	}

	// 5. Test 401 Unauthorized without token
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized without token, got %d", rec.Code)
	}
}

func TestAdminCascadeEgressSwitchFlow(t *testing.T) {
	srv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := srv.Handler()

	// 1. Login as admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	adminToken := loginResp.Token

	// 2. Get initial egress status for cascade node (ID: 1)
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1/egress", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for get egress, got %d: %s", rec.Code, rec.Body.String())
	}
	var egressResp models.EgressStatusResponse
	if err := json.NewDecoder(rec.Body).Decode(&egressResp); err != nil {
		t.Fatalf("failed to decode egress status: %v", err)
	}
	if egressResp.ActiveInterface != "awg1" {
		t.Fatalf("expected initial active interface 'awg1', got '%s'", egressResp.ActiveInterface)
	}

	// 3. Switch egress to awg3
	switchBody, _ := json.Marshal(models.SwitchEgressRequest{Interface: "awg3"})
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes/1/egress", bytes.NewReader(switchBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for switch egress, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Verify egress status is now awg3
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1/egress", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	_ = json.NewDecoder(rec.Body).Decode(&egressResp)
	if egressResp.ActiveInterface != "awg3" {
		t.Fatalf("expected active interface 'awg3' after switch, got '%s'", egressResp.ActiveInterface)
	}

	// 5. Restart egress interface awg3
	restartBody, _ := json.Marshal(models.SwitchEgressRequest{Interface: "awg3"})
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes/1/egress/restart", bytes.NewReader(restartBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for restart egress, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCascadeAutoFailoverSettingsFlow(t *testing.T) {
	masterSrv, slaveHttpSrv, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Get admin token
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	adminToken := loginResp.Token

	// 2. Initial node detail has default AutoFailoverEnabled=false
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for get node detail, got %d: %s", rec.Code, rec.Body.String())
	}
	var detail models.NodeDetailResponse
	if err := json.NewDecoder(rec.Body).Decode(&detail); err != nil {
		t.Fatalf("failed to decode node detail: %v", err)
	}
	if detail.AutoFailoverEnabled {
		t.Fatalf("expected default auto_failover_enabled to be false")
	}

	// 3. Update failover settings via POST /api/v1/admin/nodes/1/failover
	failoverReq := models.NodeFailoverSettingsRequest{
		AutoFailoverEnabled: true,
		FailoverPriority:    []string{"awg4", "awg1", "awg3"},
	}
	body, _ := json.Marshal(failoverReq)
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes/1/failover", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for update failover, got %d: %s", rec.Code, rec.Body.String())
	}
	var updatedNode models.Node
	if err := json.NewDecoder(rec.Body).Decode(&updatedNode); err != nil {
		t.Fatalf("failed to decode updated node: %v", err)
	}
	if !updatedNode.AutoFailoverEnabled {
		t.Fatalf("expected auto_failover_enabled to be true")
	}
	if len(updatedNode.FailoverPriority) != 3 || updatedNode.FailoverPriority[0] != "awg4" {
		t.Fatalf("expected failover priority ['awg4', 'awg1', 'awg3'], got %v", updatedNode.FailoverPriority)
	}

	// 4. Verify node detail now reflects updated failover and runtime status
	req = httptest.NewRequest("GET", "/api/v1/admin/nodes/1", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	var detailAfter models.NodeDetailResponse
	_ = json.NewDecoder(rec.Body).Decode(&detailAfter)
	if !detailAfter.AutoFailoverEnabled {
		t.Fatalf("expected auto_failover_enabled in detail to be true")
	}
	if detailAfter.Failover == nil {
		t.Fatalf("expected detail.Failover runtime status to be present for cascade node")
	}
	if detailAfter.Failover.ConsecutiveFailures != 0 {
		t.Fatalf("expected consecutive failures to be 0")
	}

	// 5. Test rejection on direct node
	directNode, err := store.CreateNode(context.Background(), "Direct Node", "direct", "DEU", "https://hetzner.com", slaveHttpSrv.URL, "slave-secret-123", false, false, false)
	if err != nil {
		t.Fatalf("failed to create direct node: %v", err)
	}
	req = httptest.NewRequest("POST", fmt.Sprintf("/api/v1/admin/nodes/%d/failover", directNode.ID), bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when setting failover on direct node, got %d", rec.Code)
	}
}

func TestBillingEndpoints(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Unauthenticated access
	req := httptest.NewRequest("GET", "/api/v1/billing/status", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for unauthenticated billing status, got %d", rec.Code)
	}

	// 2. Create and activate a regular user
	ctx := context.Background()
	user, err := store.CreateUser(ctx, "dave", "davePassword123!")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	if err := store.SetUserActive(ctx, user.ID, true); err != nil {
		t.Fatalf("failed to activate user: %v", err)
	}

	// Login user
	loginBody, _ := json.Marshal(models.LoginRequest{Username: "dave", Password: "davePassword123!"})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	userToken := loginResp.Token

	// 3. GET /api/v1/billing/status
	req = httptest.NewRequest("GET", "/api/v1/billing/status", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	var bStatus models.BillingStatusResponse
	if err := json.NewDecoder(rec.Body).Decode(&bStatus); err != nil {
		t.Fatalf("failed to decode billing status: %v", err)
	}
	if bStatus.DaysRemaining <= 0 {
		t.Fatalf("expected positive days remaining, got %d", bStatus.DaysRemaining)
	}

	// 4. POST /api/v1/billing/pay
	payBody, _ := json.Marshal(models.PayDuesRequest{Amount: 100, Note: "Взнос за ноду"})
	req = httptest.NewRequest("POST", "/api/v1/billing/pay", bytes.NewReader(payBody))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for pay, got %d: %s", rec.Code, rec.Body.String())
	}
	var afterPayStatus models.BillingStatusResponse
	_ = json.NewDecoder(rec.Body).Decode(&afterPayStatus)
	if len(afterPayStatus.History) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(afterPayStatus.History))
	}

	// 5. POST /api/v1/billing/snooze (1 day)
	snoozeBody, _ := json.Marshal(models.SnoozeDuesRequest{Days: 1})
	req = httptest.NewRequest("POST", "/api/v1/billing/snooze", bytes.NewReader(snoozeBody))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for snooze, got %d: %s", rec.Code, rec.Body.String())
	}
	var afterSnooze models.BillingStatusResponse
	_ = json.NewDecoder(rec.Body).Decode(&afterSnooze)
	if afterSnooze.SnoozedUntil == nil {
		t.Fatalf("expected snoozedUntil to be set")
	}

	// 6. Regular user cannot access /api/v1/admin/billing
	req = httptest.NewRequest("GET", "/api/v1/admin/billing", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-admin on admin billing, got %d", rec.Code)
	}

	// 7. Admin can access /api/v1/admin/billing
	adminLoginBody, _ := json.Marshal(models.LoginRequest{Username: "Forve", Password: "AdminPass123!"})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)

	req = httptest.NewRequest("GET", "/api/v1/admin/billing", nil)
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin billing, got %d: %s", rec.Code, rec.Body.String())
	}
	var adminSummary models.AdminBillingSummaryResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminSummary)
	if adminSummary.TotalPayments < 1 {
		t.Fatalf("expected at least 1 payment record, got %d", adminSummary.TotalPayments)
	}

	// 8. Test Billing Requisites GET & PUT
	// Regular user can GET
	req = httptest.NewRequest("GET", "/api/v1/billing/requisites", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for user GET requisites, got %d", rec.Code)
	}
	var reqs models.BillingRequisites
	_ = json.NewDecoder(rec.Body).Decode(&reqs)
	if reqs.SBPPhone == "" || reqs.SBPBank == "" {
		t.Fatalf("expected default requisites, got %+v", reqs)
	}

	// Regular user cannot PUT requisites
	updateBody, _ := json.Marshal(models.BillingRequisites{
		SBPPhone: "+7 (999) 111-22-33",
		SBPBank:  "Альфа-Банк",
	})
	req = httptest.NewRequest("PUT", "/api/v1/admin/billing/requisites", bytes.NewReader(updateBody))
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-admin PUT requisites, got %d", rec.Code)
	}

	// Admin can PUT requisites
	req = httptest.NewRequest("PUT", "/api/v1/admin/billing/requisites", bytes.NewReader(updateBody))
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin PUT requisites, got %d: %s", rec.Code, rec.Body.String())
	}
	var updatedReqs models.BillingRequisites
	_ = json.NewDecoder(rec.Body).Decode(&updatedReqs)
	if updatedReqs.SBPPhone != "+7 (999) 111-22-33" || updatedReqs.SBPBank != "Альфа-Банк" {
		t.Fatalf("expected updated requisites, got %+v", updatedReqs)
	}
}

func TestTelegramAdminEndpoints(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Login as Admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)

	// 2. Add test Telegram subscriber
	_ = store.SaveTelegramChat(context.Background(), models.TelegramChat{
		ChatID:        777888999,
		Username:      "avari_tester",
		FirstName:     "Tester",
		IsAdmin:       true,
		AlertsEnabled: true,
	})

	// 3. GET /api/v1/admin/telegram/status
	req = httptest.NewRequest("GET", "/api/v1/admin/telegram/status", nil)
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for telegram status, got %d: %s", rec.Code, rec.Body.String())
	}

	var statusResp models.TelegramStatusResponse
	if err := json.NewDecoder(rec.Body).Decode(&statusResp); err != nil {
		t.Fatalf("failed to decode telegram status response: %v", err)
	}
	if statusResp.TotalSubscribers != 1 {
		t.Fatalf("expected 1 subscriber, got %d", statusResp.TotalSubscribers)
	}

	// 4. GET /api/v1/admin/telegram/settings
	req = httptest.NewRequest("GET", "/api/v1/admin/telegram/settings", nil)
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for telegram settings, got %d: %s", rec.Code, rec.Body.String())
	}

	// 5. PUT /api/v1/admin/telegram/settings
	updatePayload, _ := json.Marshal(models.TelegramSettings{
		Enabled:             false, // Disable so getMe is not hit with fake token during test
		BotToken:            "test_dummy_token_123",
		BotUsername:         "AvariTestBot",
		AdminSecret:         "secret789",
		NotifyOnNodeDown:    true,
		NotifyOnNodeRecover: true,
		NotifyOnNewUser:     true,
	})
	req = httptest.NewRequest("PUT", "/api/v1/admin/telegram/settings", bytes.NewReader(updatePayload))
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for update telegram settings, got %d: %s", rec.Code, rec.Body.String())
	}

	var updatedSettings models.TelegramSettings
	_ = json.NewDecoder(rec.Body).Decode(&updatedSettings)
	if updatedSettings.BotUsername != "AvariTestBot" || updatedSettings.AdminSecret != "secret789" {
		t.Fatalf("unexpected updated settings: %+v", updatedSettings)
	}

	// 6. POST /api/v1/admin/telegram/subscribers/777888999/toggle
	toggleBody, _ := json.Marshal(models.TelegramSubscriberToggleRequest{AlertsEnabled: false})
	req = httptest.NewRequest("POST", "/api/v1/admin/telegram/subscribers/777888999/toggle", bytes.NewReader(toggleBody))
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for subscriber toggle, got %d", rec.Code)
	}

	// 7. DELETE /api/v1/admin/telegram/subscribers/777888999
	req = httptest.NewRequest("DELETE", "/api/v1/admin/telegram/subscribers/777888999", nil)
	req.Header.Set("Authorization", "Bearer "+adminLoginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for subscriber delete, got %d", rec.Code)
	}

	// Verify subscriber count is now 0
	subscribers, _ := store.ListTelegramChats(context.Background())
	if len(subscribers) != 0 {
		t.Fatalf("expected 0 subscribers after delete, got %d", len(subscribers))
	}
}

func TestUserTelegramEndpoints(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	ctx := context.Background()
	user, err := store.CreateUser(ctx, "alice", "alicePassword123!")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	_ = store.SetUserActive(ctx, user.ID, true)

	loginBody, _ := json.Marshal(models.LoginRequest{Username: "alice", Password: "alicePassword123!"})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	token := loginResp.Token

	// 1. GET /api/v1/user/telegram initially not linked
	req = httptest.NewRequest("GET", "/api/v1/user/telegram", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}
	var uStatus models.UserTelegramStatusResponse
	if err := json.NewDecoder(rec.Body).Decode(&uStatus); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if uStatus.IsLinked {
		t.Fatalf("expected user to not be linked initially")
	}
	if !strings.Contains(uStatus.DeepLink, "start=link_") {
		t.Fatalf("expected deep link to contain start=link_, got %s", uStatus.DeepLink)
	}

	tokenPart := strings.TrimPrefix(uStatus.DeepLink[strings.Index(uStatus.DeepLink, "start=link_")+11:], "")
	foundUser, err := store.GetUserByTelegramLinkToken(ctx, tokenPart)
	if err != nil || foundUser.ID != user.ID {
		t.Fatalf("expected valid token resolving to user %d, got err=%v, foundUser=%+v", user.ID, err, foundUser)
	}

	// 2. Link user chat
	_ = store.SaveTelegramChat(ctx, models.TelegramChat{
		ChatID:        123456789,
		UserID:        &user.ID,
		Username:      "alice_tg",
		FirstName:     "Alice",
		AlertsEnabled: true,
	})

	// 3. GET /api/v1/user/telegram again
	req = httptest.NewRequest("GET", "/api/v1/user/telegram", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	_ = json.NewDecoder(rec.Body).Decode(&uStatus)
	if !uStatus.IsLinked || uStatus.TelegramUsername != "alice_tg" {
		t.Fatalf("expected linked user status, got %+v", uStatus)
	}

	// 4. POST /api/v1/user/telegram/unlink
	req = httptest.NewRequest("POST", "/api/v1/user/telegram/unlink", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for unlink, got %d", rec.Code)
	}

	// Verify unlinked
	req = httptest.NewRequest("GET", "/api/v1/user/telegram", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	_ = json.NewDecoder(rec.Body).Decode(&uStatus)
	if uStatus.IsLinked {
		t.Fatalf("expected unlinked status after unlink call")
	}
}

func TestAdminAllKeysPagination(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()
	ctx := context.Background()

	// Login as admin
	loginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	adminToken := loginResp.Token

	// Create user
	user, err := store.CreateUser(ctx, "pag_user", "hash123")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	nodes, err := store.ListNodes(ctx)
	if err != nil || len(nodes) == 0 {
		t.Fatalf("expected at least 1 node")
	}
	nodeID := nodes[0].ID

	// Create 15 client configs
	for i := 1; i <= 15; i++ {
		_, err := store.CreateClientConfig(ctx, user.ID, nodeID, fmt.Sprintf("client_%02d", i), fmt.Sprintf("device_%02d", i))
		if err != nil {
			t.Fatalf("failed to create client config %d: %v", i, err)
		}
	}

	// 1. Get Page 1 (limit 10)
	req = httptest.NewRequest("GET", "/api/v1/admin/keys?page=1&limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	var p1Resp models.PaginatedKeysResponse
	if err := json.NewDecoder(rec.Body).Decode(&p1Resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if p1Resp.TotalCount != 15 {
		t.Fatalf("expected TotalCount 15, got %d", p1Resp.TotalCount)
	}
	if p1Resp.TotalPages != 2 {
		t.Fatalf("expected TotalPages 2, got %d", p1Resp.TotalPages)
	}
	if p1Resp.Page != 1 {
		t.Fatalf("expected Page 1, got %d", p1Resp.Page)
	}
	if len(p1Resp.Keys) != 10 {
		t.Fatalf("expected 10 keys on page 1, got %d", len(p1Resp.Keys))
	}

	// 2. Get Page 2 (limit 10)
	req = httptest.NewRequest("GET", "/api/v1/admin/keys?page=2&limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	var p2Resp models.PaginatedKeysResponse
	if err := json.NewDecoder(rec.Body).Decode(&p2Resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if p2Resp.Page != 2 {
		t.Fatalf("expected Page 2, got %d", p2Resp.Page)
	}
	if len(p2Resp.Keys) != 5 {
		t.Fatalf("expected 5 keys on page 2, got %d", len(p2Resp.Keys))
	}
}

func TestNewsEndpointsFlow(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// Admin login
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	adminToken := loginResp.Token

	// Register & activate regular user
	user, err := store.CreateUser(context.Background(), "bob", "bobPass123!")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	_ = store.SetUserActive(context.Background(), user.ID, true)

	bobLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "bob",
		Password: "bobPass123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(bobLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var bobLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&bobLoginResp)
	bobToken := bobLoginResp.Token

	// 1. Regular user creates news -> 403 Forbidden
	createPayload, _ := json.Marshal(models.CreateNewsRequest{
		Title:          "Unauthorized News",
		Content:        "Should fail",
		Category:       models.NewsCategoryGeneral,
		IsPinned:       false,
		NotifyTelegram: false,
	})
	req = httptest.NewRequest("POST", "/api/v1/admin/news", bytes.NewReader(createPayload))
	req.Header.Set("Authorization", "Bearer "+bobToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-admin create news, got %d", rec.Code)
	}

	// 2. Admin creates a news item
	validCreatePayload, _ := json.Marshal(models.CreateNewsRequest{
		Title:          "Плановые техработы на сервере Германия",
		Content:        "В субботу с 02:00 до 04:00 МСК будут проводиться технические работы.",
		Category:       models.NewsCategoryMaintenance,
		IsPinned:       true,
		NotifyTelegram: false,
	})
	req = httptest.NewRequest("POST", "/api/v1/admin/news", bytes.NewReader(validCreatePayload))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for admin create news, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var createdNews models.NewsItem
	if err := json.NewDecoder(rec.Body).Decode(&createdNews); err != nil {
		t.Fatalf("failed to decode created news: %v", err)
	}
	if createdNews.ID == 0 || createdNews.Title != "Плановые техработы на сервере Германия" || !createdNews.IsPinned {
		t.Fatalf("unexpected news data: %+v", createdNews)
	}

	// 3. User lists news -> 200 OK with news item
	req = httptest.NewRequest("GET", "/api/v1/news", nil)
	req.Header.Set("Authorization", "Bearer "+bobToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for list news, got %d", rec.Code)
	}
	var newsList []models.NewsItem
	if err := json.NewDecoder(rec.Body).Decode(&newsList); err != nil {
		t.Fatalf("failed to decode news list: %v", err)
	}
	if len(newsList) != 1 || newsList[0].ID != createdNews.ID {
		t.Fatalf("expected 1 news item, got %d", len(newsList))
	}

	// 4. Admin updates news item
	updatePayload, _ := json.Marshal(models.UpdateNewsRequest{
		Title:    "Обновлено: Плановые техработы завершены",
		Content:  "Техработы успешно завершены.",
		Category: models.NewsCategoryMaintenance,
		IsPinned: false,
	})
	req = httptest.NewRequest("PUT", fmt.Sprintf("/api/v1/admin/news/%d", createdNews.ID), bytes.NewReader(updatePayload))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for update news, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var updatedNews models.NewsItem
	_ = json.NewDecoder(rec.Body).Decode(&updatedNews)
	if updatedNews.Title != "Обновлено: Плановые техработы завершены" || updatedNews.IsPinned != false {
		t.Fatalf("unexpected updated news: %+v", updatedNews)
	}

	// 5. Admin deletes news item
	req = httptest.NewRequest("DELETE", fmt.Sprintf("/api/v1/admin/news/%d", createdNews.ID), nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete news, got %d", rec.Code)
	}

	// 6. User lists news -> now empty
	req = httptest.NewRequest("GET", "/api/v1/news", nil)
	req.Header.Set("Authorization", "Bearer "+bobToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var emptyNews []models.NewsItem
	_ = json.NewDecoder(rec.Body).Decode(&emptyNews)
	if len(emptyNews) != 0 {
		t.Fatalf("expected 0 news items after delete, got %d", len(emptyNews))
	}
}

func TestBackupServersAndPROTierFlow(t *testing.T) {
	masterSrv, slaveHttpSrv, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Login as Admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var adminLogin models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLogin)
	adminToken := adminLogin.Token

	// 2. Admin creates a backup server node (is_backup: true)
	addNodeBody, _ := json.Marshal(models.AddNodeRequest{
		Name:              "Backup Frankfurt 01",
		Type:              "direct",
		CountryCode:       "DEU",
		ProviderURL:       "https://aeza.net",
		APIURL:            slaveHttpSrv.URL,
		APIKey:            "slave-secret-123",
		IsMobileOptimized: true,
		IsBackup:          true,
	})
	req = httptest.NewRequest("POST", "/api/v1/admin/nodes", bytes.NewReader(addNodeBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for add backup node, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var backupNode models.Node
	_ = json.NewDecoder(rec.Body).Decode(&backupNode)
	if !backupNode.IsBackup {
		t.Fatalf("expected backupNode.IsBackup to be true, got false")
	}

	// 3. Register and activate a regular user 'dave'
	regBody, _ := json.Marshal(models.RegisterRequest{
		Username: "dave",
		Password: "DavePassword123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(regBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	daveUser, _ := store.GetUserByUsername(context.Background(), "dave")
	_ = store.SetUserActive(context.Background(), daveUser.ID, true)

	// Login as dave
	daveLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "dave",
		Password: "DavePassword123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(daveLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var daveLogin models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&daveLogin)
	daveToken := daveLogin.Token

	if daveLogin.User.IsPro {
		t.Fatalf("expected dave.IsPro to be false initially")
	}

	// 4. Non-PRO user tries to create key on backup server -> 403 Forbidden
	createKeyBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     backupNode.ID,
		DeviceName: "Dave iPhone",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(createKeyBody))
	req.Header.Set("Authorization", "Bearer "+daveToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when non-PRO creates key on backup server, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	expectedErrMsg := "Данный сервер является запасным и доступен только для пользователей с тарифом PRO. Обратитесь к администратору для подключения."
	if !strings.Contains(rec.Body.String(), expectedErrMsg) {
		t.Fatalf("expected error message %q, got %q", expectedErrMsg, rec.Body.String())
	}

	// 5. Admin enables PRO tier for dave: POST /api/v1/admin/users/{id}/pro
	setProBody, _ := json.Marshal(models.SetUserProRequest{
		IsPro: true,
	})
	req = httptest.NewRequest("POST", fmt.Sprintf("/api/v1/admin/users/%d/pro", daveUser.ID), bytes.NewReader(setProBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin set pro, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	// Verify dave profile now has is_pro: true via /api/v1/auth/me
	req = httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+daveToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var daveMe models.UserPublic
	_ = json.NewDecoder(rec.Body).Decode(&daveMe)
	if !daveMe.IsPro {
		t.Fatalf("expected daveMe.IsPro to be true")
	}

	// Verify billing status for PRO user shows recommended_amount: 300.0 and is_pro: true
	req = httptest.NewRequest("GET", "/api/v1/billing/status", nil)
	req.Header.Set("Authorization", "Bearer "+daveToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var billStatus models.BillingStatusResponse
	_ = json.NewDecoder(rec.Body).Decode(&billStatus)
	if !billStatus.IsPro || billStatus.RecommendedAmount != 300.0 {
		t.Fatalf("expected PRO billing status (is_pro=true, amount=300.0), got is_pro=%v, amount=%.1f", billStatus.IsPro, billStatus.RecommendedAmount)
	}

	// 6. PRO user creates key on backup server -> 201 Created!
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(createKeyBody))
	req.Header.Set("Authorization", "Bearer "+daveToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for PRO user creating key on backup server, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	// 7. Admin creates key on backup server (Admin bypass test) -> 201 Created
	adminKeyBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     backupNode.ID,
		DeviceName: "Admin Laptop",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(adminKeyBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for admin creating key on backup server, got %d", rec.Code)
	}

	// 8. Admin disables PRO tier for dave: POST /api/v1/admin/users/{id}/pro with is_pro: false
	disableProBody, _ := json.Marshal(models.SetUserProRequest{
		IsPro: false,
	})
	req = httptest.NewRequest("POST", fmt.Sprintf("/api/v1/admin/users/%d/pro", daveUser.ID), bytes.NewReader(disableProBody))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for disabling pro, got %d", rec.Code)
	}

	// 9. Dave attempts to create another key on backup server -> 403 Forbidden
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(createKeyBody))
	req.Header.Set("Authorization", "Bearer "+daveToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden after disabling PRO, got %d", rec.Code)
	}
}

func TestTelegramProxiesEndpoint(t *testing.T) {
	t.Setenv("TELEGRAM_PROXY_SERVER", "s2.example.net")
	t.Setenv("TELEGRAM_PROXY_SECRET", "test-secret")
	masterSrv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Login as admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}

	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)

	// 2. Query /api/v1/proxies/telegram
	req = httptest.NewRequest("GET", "/api/v1/proxies/telegram", nil)
	req.Header.Set("Authorization", "Bearer "+loginResp.Token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for telegram proxies, got %d: %s", rec.Code, rec.Body.String())
	}

	var proxies []models.TelegramProxyInfo
	if err := json.NewDecoder(rec.Body).Decode(&proxies); err != nil {
		t.Fatalf("failed to decode proxies json: %v", err)
	}

	if len(proxies) == 0 {
		t.Fatalf("expected at least 1 proxy in response")
	}

	p := proxies[0]
	if p.Server != "s2.example.net" || p.Port != 8443 || !strings.Contains(p.Link, "tg://proxy") {
		t.Fatalf("unexpected proxy info: %+v", p)
	}
}

func TestHysteriaNodeValidationFlow(t *testing.T) {
	masterSrv, slaveHttpSrv, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()
	ctx := context.Background()

	// 1. Create a node without Hysteria
	nodeNoHysteria, err := store.CreateNode(ctx, "Node Without Hysteria", "direct", "DEU", "https://hetzner.com", slaveHttpSrv.URL, "slave-secret-123", false, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	// 2. Login as admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	token := loginResp.Token

	// 3. Try creating Hysteria 2 key on node without Hysteria -> Expect 400 Bad Request
	failBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     nodeNoHysteria.ID,
		DeviceName: "test-hysteria-fail",
		Protocol:   "hysteria2",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(failBody))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when creating Hysteria key on node without Hysteria, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "не поддерживает протокол Hysteria 2") {
		t.Fatalf("expected error message to mention Hysteria 2 support, got: %s", rec.Body.String())
	}

	// 4. Create Hysteria 2 key on mock node with HasHysteria=true (created in setupTestEnvironment) -> Expect 201 Created
	successBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     1, // Mock Cascade Node has has_hysteria=true
		DeviceName: "test-hysteria-ok",
		Protocol:   "hysteria2",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(successBody))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on Hysteria node, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMieruKeyCreationAndCyrillicTransliteration(t *testing.T) {
	t.Setenv("MIERU_SERVER", "s2.example.test")
	masterSrv, slaveHttpSrv, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()
	ctx := context.Background()

	// 1. Create a node without Mieru
	nodeNoMieru, err := store.CreateNode(ctx, "Node Without Mieru", "direct", "DEU", "https://hetzner.com", slaveHttpSrv.URL, "slave-secret-123", false, false, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	// 2. Login as admin
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	token := loginResp.Token

	// 3. Try creating Mieru key on node without Mieru -> Expect 400 Bad Request
	failBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     nodeNoMieru.ID,
		DeviceName: "Айфон Тест",
		Protocol:   "mieru",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(failBody))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when creating Mieru key on node without Mieru, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "не поддерживает протокол Mieru") {
		t.Fatalf("expected error message to mention Mieru support, got: %s", rec.Body.String())
	}

	// 4. Create Mieru key on node with HasMieru=true and Cyrillic name ("Рабочий Айфон Forve")
	successBody, _ := json.Marshal(models.CreateKeyRequest{
		NodeID:     1, // Mock Cascade Node has has_mieru=true
		DeviceName: "Рабочий Айфон Forve",
		Protocol:   "mieru",
	})
	req = httptest.NewRequest("POST", "/api/v1/keys", bytes.NewReader(successBody))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on Mieru node, got %d: %s", rec.Code, rec.Body.String())
	}

	var createdKey map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&createdKey)
	if createdKey["protocol"] != "mieru" {
		t.Fatalf("expected protocol 'mieru', got %v", createdKey["protocol"])
	}
	// Check transliterated device name and sanitized client name
	if createdKey["device_name"] != "Rabochiy Ayfon Forve" {
		t.Fatalf("expected transliterated device_name 'Rabochiy Ayfon Forve', got: %v", createdKey["device_name"])
	}
	if !strings.Contains(createdKey["client_name"].(string), "Rabochiy_Ayfon_Forve") {
		t.Fatalf("expected client_name with transliterated device, got: %v", createdKey["client_name"])
	}
	vpnURI, _ := createdKey["vpn_uri"].(string)
	if !strings.HasPrefix(vpnURI, "mierus://") {
		t.Fatalf("expected mierus:// uri, got %v", vpnURI)
	}

	// 5. Verify GET /api/v1/keys/:id
	keyID := int64(createdKey["id"].(float64))
	req = httptest.NewRequest("GET", fmt.Sprintf("/api/v1/keys/%d", keyID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET key, got %d: %s", rec.Code, rec.Body.String())
	}
	var getKeyResp map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&getKeyResp)
	if getKeyResp["protocol"] != "mieru" {
		t.Fatalf("expected protocol mieru, got: %v", getKeyResp["protocol"])
	}
}

func TestPasswordResetEndpointsFlow(t *testing.T) {
	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := masterSrv.Handler()

	// 1. Admin login
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var loginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&loginResp)
	adminToken := loginResp.Token

	// 2. Create user carol and activate her
	user, err := store.CreateUser(context.Background(), "carol", "carolInitial123")
	if err != nil {
		t.Fatalf("failed to create user carol: %v", err)
	}
	_ = store.SetUserActive(context.Background(), user.ID, true)

	// 3. Submit reset password request
	resetBody, _ := json.Marshal(models.ResetPasswordRequestDTO{
		Username:    "carol",
		NewPassword: "carolNewPass789!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/reset-password", bytes.NewReader(resetBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reset-password request, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Admin lists users and checks has_pending_password_reset
	req = httptest.NewRequest("GET", "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin list users, got %d", rec.Code)
	}
	var users []models.UserPublic
	_ = json.NewDecoder(rec.Body).Decode(&users)
	var carolUser *models.UserPublic
	for _, u := range users {
		if u.ID == user.ID {
			carolUser = &u
			break
		}
	}
	if carolUser == nil || !carolUser.HasPendingPasswordReset {
		t.Fatalf("expected carol to have pending password reset in admin users list")
	}

	// 5. Admin approves password reset
	req = httptest.NewRequest("POST", fmt.Sprintf("/api/v1/admin/users/%d/approve-password-reset", user.ID), nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for approve-password-reset, got %d: %s", rec.Code, rec.Body.String())
	}

	// 6. Login with new password succeeds
	newLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "carol",
		Password: "carolNewPass789!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(newLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected login to succeed with new password, got %d: %s", rec.Code, rec.Body.String())
	}

	// 7. Test Reject flow
	resetBody2, _ := json.Marshal(models.ResetPasswordRequestDTO{
		Username:    "carol",
		NewPassword: "rejectedPassword123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/reset-password", bytes.NewReader(resetBody2))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for second reset request, got %d", rec.Code)
	}

	req = httptest.NewRequest("POST", fmt.Sprintf("/api/v1/admin/users/%d/reject-password-reset", user.ID), nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reject-password-reset, got %d: %s", rec.Code, rec.Body.String())
	}

	// Carol cannot login with rejected password
	rejLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "carol",
		Password: "rejectedPassword123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(rejLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for rejected password, got %d", rec.Code)
	}
}

func generateMiniAppInitData(botToken string, params map[string]string) string {
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

func TestTelegramMiniAppAuthFlow(t *testing.T) {
	botToken := "test-bot-token-998877"
	t.Setenv("TELEGRAM_BOT_TOKEN", botToken)
	t.Setenv("TELEGRAM_BOT_USERNAME", "AvariMiniAppBot")

	masterSrv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	// Update storage settings and reload bot
	ctx := context.Background()
	_, _ = store.UpdateTelegramSettings(ctx, models.TelegramSettings{
		Enabled:     true,
		BotToken:    botToken,
		BotUsername: "AvariMiniAppBot",
		WebAppURL:   "https://m0.vpn.test/miniapp",
	})
	_ = masterSrv.GetTelegramBot().UpdateConfig(ctx, models.TelegramSettings{
		Enabled:     true,
		BotToken:    botToken,
		BotUsername: "AvariMiniAppBot",
		WebAppURL:   "https://m0.vpn.test/miniapp",
	})

	handler := masterSrv.Handler()

	// 1. Create and activate a regular user
	userAlice, err := store.CreateUser(ctx, "tma_alice", "hashed_pwd_alice")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	_ = store.SetUserActive(ctx, userAlice.ID, true)

	// Link Alice's Telegram chat (ChatID = 111222333)
	aliceChatID := int64(111222333)
	err = store.SaveTelegramChat(ctx, models.TelegramChat{
		ChatID:        aliceChatID,
		UserID:        &userAlice.ID,
		Username:      "alice_telegram",
		FirstName:     "Alice",
		IsAdmin:       false,
		AlertsEnabled: true,
	})
	if err != nil {
		t.Fatalf("failed to link alice chat: %v", err)
	}

	// 2. Test valid Mini App login for Alice
	now := time.Now().Unix()
	aliceParams := map[string]string{
		"auth_date": fmt.Sprintf("%d", now),
		"query_id":  "AAHdF6IQAAAAAN0XohDhrOrc",
		"user":      fmt.Sprintf(`{"id":%d,"first_name":"Alice","username":"alice_telegram"}`, aliceChatID),
	}
	aliceInitData := generateMiniAppInitData(botToken, aliceParams)

	authBody, _ := json.Marshal(models.TelegramMiniAppAuthRequest{InitData: aliceInitData})
	req := httptest.NewRequest("POST", "/api/v1/auth/telegram-miniapp", bytes.NewReader(authBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Alice TMA auth, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var authResp models.TelegramMiniAppAuthResponse
	if err := json.NewDecoder(rec.Body).Decode(&authResp); err != nil {
		t.Fatalf("failed to decode TMA auth resp: %v", err)
	}
	if authResp.Token == "" {
		t.Errorf("expected non-empty JWT token")
	}
	if authResp.User.Username != "tma_alice" {
		t.Errorf("expected username tma_alice, got %s", authResp.User.Username)
	}
	if authResp.IsAdmin {
		t.Errorf("expected alice not to be admin")
	}
	if !authResp.IsLinked {
		t.Errorf("expected alice to be linked")
	}

	// 3. Test unlinked Telegram user (ChatID = 999888777)
	unlinkedChatID := int64(999888777)
	unlinkedParams := map[string]string{
		"auth_date": fmt.Sprintf("%d", now),
		"user":      fmt.Sprintf(`{"id":%d,"first_name":"Stranger"}`, unlinkedChatID),
	}
	unlinkedInitData := generateMiniAppInitData(botToken, unlinkedParams)

	authBody, _ = json.Marshal(models.TelegramMiniAppAuthRequest{InitData: unlinkedInitData})
	req = httptest.NewRequest("POST", "/api/v1/auth/telegram-miniapp", bytes.NewReader(authBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for unlinked user, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "unlinked_chat") {
		t.Errorf("expected error unlinked_chat, got body: %s", rec.Body.String())
	}

	// 4. Test invalid HMAC signature (tampered initData)
	tamperedInitData := aliceInitData + "&tampered=1"
	authBody, _ = json.Marshal(models.TelegramMiniAppAuthRequest{InitData: tamperedInitData})
	req = httptest.NewRequest("POST", "/api/v1/auth/telegram-miniapp", bytes.NewReader(authBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for tampered initData, got %d", rec.Code)
	}

	// 5. Test Admin TMA login
	adminUser, err := store.GetUserByUsername(ctx, "Forve")
	if err != nil {
		t.Fatalf("failed to get admin Forve: %v", err)
	}
	adminChatID := int64(777666555)
	_ = store.SaveTelegramChat(ctx, models.TelegramChat{
		ChatID:        adminChatID,
		UserID:        &adminUser.ID,
		Username:      "forve_admin",
		FirstName:     "Forve",
		IsAdmin:       true,
		AlertsEnabled: true,
	})

	adminParams := map[string]string{
		"auth_date": fmt.Sprintf("%d", now),
		"user":      fmt.Sprintf(`{"id":%d,"first_name":"Forve","username":"forve_admin"}`, adminChatID),
	}
	adminInitData := generateMiniAppInitData(botToken, adminParams)
	authBody, _ = json.Marshal(models.TelegramMiniAppAuthRequest{InitData: adminInitData})
	req = httptest.NewRequest("POST", "/api/v1/auth/telegram-miniapp", bytes.NewReader(authBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Admin TMA auth, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	var adminResp models.TelegramMiniAppAuthResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminResp)
	if !adminResp.IsAdmin {
		t.Errorf("expected Forve to be recognized as admin in TMA")
	}
}

func TestMeEndpointMonthTrafficAndAdminUserTraffic(t *testing.T) {
	srv, _, store, cleanup := setupTestEnvironment(t)
	defer cleanup()

	handler := srv.Handler()
	ctx := context.Background()

	// 1. Admin logs in
	adminLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "Forve",
		Password: "AdminPass123!",
	})
	req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(adminLoginBody))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin login, got %d", rec.Code)
	}
	var adminLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&adminLoginResp)
	adminToken := adminLoginResp.Token

	// 2. Register & activate regular user "traffic_tester"
	regBody, _ := json.Marshal(models.RegisterRequest{
		Username: "traffic_tester",
		Password: "Password123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(regBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register, got %d", rec.Code)
	}

	user, err := store.GetUserByUsername(ctx, "traffic_tester")
	if err != nil {
		t.Fatalf("failed to find traffic_tester: %v", err)
	}
	_ = store.SetUserActive(ctx, user.ID, true)

	// User logs in
	userLoginBody, _ := json.Marshal(models.LoginRequest{
		Username: "traffic_tester",
		Password: "Password123!",
	})
	req = httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(userLoginBody))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for user login, got %d", rec.Code)
	}
	var userLoginResp models.LoginResponse
	_ = json.NewDecoder(rec.Body).Decode(&userLoginResp)
	userToken := userLoginResp.Token

	// 3. Add a direct node and key
	node, err := store.CreateNode(ctx, "Direct DE", "direct", "DEU", "https://de.test", "https://de.test:8081", "key123", false, false, false, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}
	key, err := store.CreateClientConfig(ctx, user.ID, node.ID, "phone-traffic", "iPhone", "pubkey123", "10.0.0.5", "awg")
	if err != nil {
		t.Fatalf("failed to create key: %v", err)
	}

	// Record peer telemetry
	if err := store.RecordPeerTelemetry(ctx, key.ID, 18000000, 7000000, 1700000000, true); err != nil {
		t.Fatalf("failed to record peer telemetry: %v", err)
	}

	// 4. Test GET /api/v1/auth/me returns user month traffic
	req = httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /api/v1/auth/me, got %d", rec.Code)
	}
	var me models.UserPublic
	if err := json.NewDecoder(rec.Body).Decode(&me); err != nil {
		t.Fatalf("failed to decode /me response: %v", err)
	}

	if me.MonthTraffic == nil {
		t.Fatalf("expected MonthTraffic to be populated in /me response")
	}
	if me.MonthTraffic.TotalBytes != 25000000 {
		t.Fatalf("expected MonthTraffic.TotalBytes to be 25000000, got %d", me.MonthTraffic.TotalBytes)
	}
	if me.MonthTraffic.RxBytes != 18000000 || me.MonthTraffic.TxBytes != 7000000 {
		t.Fatalf("expected Rx 18000000 Tx 7000000, got Rx %d Tx %d", me.MonthTraffic.RxBytes, me.MonthTraffic.TxBytes)
	}
	if me.MonthTrafficBytes != 25000000 {
		t.Fatalf("expected MonthTrafficBytes 25000000, got %d", me.MonthTrafficBytes)
	}

	// 5. Test GET /api/v1/admin/users returns month traffic for user
	req = httptest.NewRequest("GET", "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /api/v1/admin/users, got %d", rec.Code)
	}
	var users []models.UserPublic
	if err := json.NewDecoder(rec.Body).Decode(&users); err != nil {
		t.Fatalf("failed to decode users: %v", err)
	}

	foundUser := false
	for _, u := range users {
		if u.ID == user.ID {
			foundUser = true
			if u.MonthTrafficBytes != 25000000 {
				t.Fatalf("expected user month traffic in admin list to be 25000000, got %d", u.MonthTrafficBytes)
			}
			if u.MonthTrafficFormatted == "" {
				t.Fatalf("expected formatted month traffic to not be empty")
			}
		}
	}
	if !foundUser {
		t.Fatalf("expected to find traffic_tester in admin users list")
	}
}

func TestSecurityHeadersAndRateLimiting(t *testing.T) {
	srv, _, _, cleanup := setupTestEnvironment(t)
	defer cleanup()
	handler := srv.Handler()

	// 1. Verify Security Headers
	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", rec.Header().Get("X-Content-Type-Options"))
	}
	if rec.Header().Get("X-XSS-Protection") != "1; mode=block" {
		t.Errorf("expected X-XSS-Protection: 1; mode=block, got %q", rec.Header().Get("X-XSS-Protection"))
	}
	if rec.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
		t.Errorf("expected Referrer-Policy: strict-origin-when-cross-origin, got %q", rec.Header().Get("Referrer-Policy"))
	}
	if !strings.Contains(rec.Header().Get("Content-Security-Policy"), "default-src 'self'") {
		t.Errorf("expected CSP default-src 'self', got %q", rec.Header().Get("Content-Security-Policy"))
	}

	// 2. Test Rate Limiting on /api/v1/auth/login (limit is 5 req/min)
	loginBody, _ := json.Marshal(models.LoginRequest{
		Username: "ratelimit_user",
		Password: "wrongpassword",
	})
	clientIP := "203.0.113.42:54321"

	for i := 1; i <= 5; i++ {
		req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
		req.RemoteAddr = clientIP
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request #%d unexpectedly rate limited (429)", i)
		}
	}

	// 6th request from same IP should be blocked with 429
	req6 := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	req6.RemoteAddr = clientIP
	rec6 := httptest.NewRecorder()
	handler.ServeHTTP(rec6, req6)
	if rec6.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 6th request to be 429 Too Many Requests, got %d", rec6.Code)
	}
	if rec6.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header on 429 response")
	}

	// Request from another IP should still succeed
	reqOther := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(loginBody))
	reqOther.RemoteAddr = "203.0.113.99:12345"
	recOther := httptest.NewRecorder()
	handler.ServeHTTP(recOther, reqOther)
	if recOther.Code == http.StatusTooManyRequests {
		t.Fatalf("request from different IP should not be rate limited")
	}

	// 3. Test MaxBytes Limit (> 1MB should be rejected)
	largeJSON := `{"username":"` + strings.Repeat("a", 1024*1024+100) + `"}`
	reqLarge := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(largeJSON))
	reqLarge.RemoteAddr = "203.0.113.150:1111"
	recLarge := httptest.NewRecorder()
	handler.ServeHTTP(recLarge, reqLarge)
	if recLarge.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 Request Entity Too Large for >1MB body, got %d", recLarge.Code)
	}
}


