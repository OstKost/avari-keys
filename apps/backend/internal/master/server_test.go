package master_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

	// Add mock slave node to DB
	_, err = store.CreateNode(context.Background(), "Mock Cascade Node", "cascade", "NLD", "https://aeza.net", slaveHttpSrv.URL, slaveToken, true)
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

	// 8. Alice lists her keys
	req = httptest.NewRequest("GET", "/api/v1/keys", nil)
	req.Header.Set("Authorization", "Bearer "+aliceToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var myKeys []models.ClientConfig
	_ = json.NewDecoder(rec.Body).Decode(&myKeys)
	if len(myKeys) != 1 || myKeys[0].DeviceName != "iPad-Pro" {
		t.Fatalf("expected 1 key for alice, got %+v", myKeys)
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









