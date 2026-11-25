package monitor_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/monitor"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/telegram"
)

func setupTestStorage(t *testing.T) (*storage.Storage, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "monitor-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}
	return store, func() {
		_ = store.Close()
		_ = os.RemoveAll(tmpDir)
	}
}

func TestHealthCheckerTransitions(t *testing.T) {
	var isNodeOnline atomic.Bool
	isNodeOnline.Store(true)

	// Mock Slave Node
	mockSlave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isNodeOnline.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"error"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","service":"avari-slave","version":"v0.1.0"}`))
	}))
	defer mockSlave.Close()

	store, cleanup := setupTestStorage(t)
	defer cleanup()

	ctx := context.Background()
	node, err := store.CreateNode(ctx, "Test Node", "cascade", "NLD", "https://aeza.net", mockSlave.URL, "dummy_key", true, false, false)
	if err != nil {
		t.Fatalf("failed to create test node: %v", err)
	}

	bot := telegram.NewBot(telegram.Config{
		Token:       "", // Disabled for this test
		BotUsername: "TestBot",
		Storage:     store,
	})

	checker := monitor.NewHealthChecker(monitor.Config{
		Storage:  store,
		Bot:      bot,
		Interval: 50 * time.Millisecond,
		Timeout:  100 * time.Millisecond,
	})

	// 1. Check all nodes while online
	statuses, err := checker.CheckAllNodes(ctx)
	if err != nil {
		t.Fatalf("failed to check nodes: %v", err)
	}
	if len(statuses) != 1 || !statuses[0].Online {
		t.Fatalf("expected 1 online node, got %+v", statuses)
	}

	// 2. Set node offline
	isNodeOnline.Store(false)
	statusesAfter, err := checker.CheckAllNodes(ctx)
	if err != nil {
		t.Fatalf("failed to check nodes: %v", err)
	}
	if len(statusesAfter) != 1 || statusesAfter[0].Online {
		t.Fatalf("expected 1 offline node, got %+v", statusesAfter)
	}

	_ = node
}

func TestHealthCheckerFailureThresholdAndRetry(t *testing.T) {
	var requestCount atomic.Int32
	var simulateTemporaryGlitch atomic.Bool
	simulateTemporaryGlitch.Store(false)

	// Mock Slave Node
	mockSlave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requestCount.Add(1)
		if r.URL.Path == "/health" || r.URL.Path == "/api/v1/health" {
			// If glitch is active, fail every odd request (attempt 1), succeed on retry (attempt 2)
			if simulateTemporaryGlitch.Load() && count%2 == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"status":"error"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","service":"avari-slave","version":"v0.2.0"}`))
			return
		}
		if r.URL.Path == "/api/v1/stats" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"active_peers":0,"total_rx":0,"total_tx":0,"peers":{}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mockSlave.Close()

	store, cleanup := setupTestStorage(t)
	defer cleanup()

	ctx := context.Background()
	_, err := store.CreateNode(ctx, "Resilient Node", "direct", "DEU", "https://aeza.net", mockSlave.URL, "dummy_key", true, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	checker := monitor.NewHealthChecker(monitor.Config{
		Storage:          store,
		Interval:         50 * time.Millisecond,
		Timeout:          200 * time.Millisecond,
		FailureThreshold: 2,
	})

	// 1. Initial collection: node is online
	checker.CollectTelemetry(ctx)
	dash := checker.GetLatestDashboardStats(ctx)
	if dash.OnlineNodes != 1 {
		t.Fatalf("expected 1 online node initially, got %d", dash.OnlineNodes)
	}

	// 2. Enable transient glitch (1st attempt fails, retry succeeds)
	simulateTemporaryGlitch.Store(true)
	checker.CollectTelemetry(ctx)
	dash = checker.GetLatestDashboardStats(ctx)
	if dash.OnlineNodes != 1 {
		t.Fatalf("expected node to remain online due to immediate retry, got %d", dash.OnlineNodes)
	}
}

func TestTelemetryCollectorAndDeltaEngine(t *testing.T) {
	var activeEgress atomic.Value
	activeEgress.Store("awg4")
	var rawRx atomic.Int64
	var rawTx atomic.Int64
	rawRx.Store(100 * 1024 * 1024)
	rawTx.Store(50 * 1024 * 1024)

	// Mock Slave Node returning health & stats
	mockSlave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/api/v1/health" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","service":"avari-slave","version":"v0.1.0"}`))
			return
		}
		if r.URL.Path == "/api/v1/cascade/egress" {
			fmt.Fprintf(w, `{"active_interface":%q,"targets":[{"interface":"awg4","label":"S4"},{"interface":"awg5","label":"S5P"}]}`, activeEgress.Load().(string))
			return
		}
		if r.URL.Path == "/api/v1/stats" {
			rx := rawRx.Load()
			tx := rawTx.Load()
			now := time.Now().Unix()
			resp := fmt.Sprintf(`{
				"active_peers": 1,
				"uptime": "1d 2h",
				"total_rx": %d,
				"total_tx": %d,
				"peers": {
					"u1_iphone": {
						"client_name": "u1_iphone",
						"public_key": "mockKey123==",
						"interface": "awg0",
						"allowed_ips": "10.7.0.2/32",
						"last_handshake": "только что",
						"last_handshake_epoch": %d,
						"is_online": true,
						"rx_bytes": %d,
						"tx_bytes": %d,
						"month_bytes": %d
					}
				}
			}`, rx, tx, now-10, rx, tx, rx+tx)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(resp))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockSlave.Close()

	store, cleanup := setupTestStorage(t)
	defer cleanup()

	ctx := context.Background()
	user, err := store.CreateUser(ctx, "tele_worker_user", "password123")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	node, err := store.CreateNode(ctx, "Telemetry Node", "cascade", "NLD", "https://aeza.net", mockSlave.URL, "dummy_key", true, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	cfg, err := store.CreateClientConfig(ctx, user.ID, node.ID, "u1_iphone", "iPhone", "mockKey123==", "10.7.0.2")
	if err != nil {
		t.Fatalf("failed to create config: %v", err)
	}

	checker := monitor.NewHealthChecker(monitor.Config{
		Storage:  store,
		Interval: 50 * time.Millisecond,
		Timeout:  100 * time.Millisecond,
	})

	// Round 1: Baseline collection
	checker.CollectTelemetry(ctx)

	stats := checker.GetLatestDashboardStats(ctx)
	if len(stats.Nodes) != 1 || stats.Nodes[0].ActiveEgress != "S4" {
		t.Fatalf("missing current egress: %+v", stats.Nodes)
	}
	activeEgress.Store("awg5")

	// Round 2: Increment traffic (+50MB RX, +30MB TX = +80MB total)
	rawRx.Store(150 * 1024 * 1024)
	rawTx.Store(80 * 1024 * 1024)
	checker.CollectTelemetry(ctx)

	stats = checker.GetLatestDashboardStats(ctx)
	if stats.Nodes[0].ActiveEgress != "S5P" {
		t.Fatalf("egress did not refresh: %+v", stats.Nodes)
	}

	updatedCfg, err := store.GetClientConfigByID(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("failed to get config: %v", err)
	}
	expectedDelta := int64(80 * 1024 * 1024)
	if updatedCfg.TotalTrafficBytes != expectedDelta {
		t.Fatalf("expected total traffic %d, got %d", expectedDelta, updatedCfg.TotalTrafficBytes)
	}

	// Round 3: Counter Reset (Server reboots, counters reset to 10MB RX, 5MB TX = +15MB delta)
	rawRx.Store(10 * 1024 * 1024)
	rawTx.Store(5 * 1024 * 1024)
	checker.CollectTelemetry(ctx)

	updatedCfg2, err := store.GetClientConfigByID(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("failed to get config: %v", err)
	}
	expectedAfterReset := expectedDelta + int64(15*1024*1024)
	if updatedCfg2.TotalTrafficBytes != expectedAfterReset {
		t.Fatalf("expected total traffic %d after counter reset, got %d", expectedAfterReset, updatedCfg2.TotalTrafficBytes)
	}

	// Verify Dashboard stats
	dash := checker.GetLatestDashboardStats(ctx)
	if dash == nil {
		t.Fatalf("expected non-nil dashboard stats")
	}
	if dash.TotalKeys != 1 || dash.OnlineNodes != 1 || dash.ActiveDevicesOnline != 1 {
		t.Fatalf("unexpected dashboard metrics: %+v", dash)
	}
}

func TestCascadeAutoFailover(t *testing.T) {
	var currentActive atomic.Value
	currentActive.Store("awg1")

	var switchCalls atomic.Int32
	var lastSwitchedTo atomic.Value
	lastSwitchedTo.Store("")

	var auditAction atomic.Value
	auditAction.Store("")

	mockSlave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/health", "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok","service":"avari-slave","version":"v1.6.0"}`))
			return
		case "/api/v1/stats":
			_, _ = w.Write([]byte(`{"total_rx":100,"total_tx":100,"peers":[]}`))
			return
		case "/api/v1/cascade/egress":
			if r.Method == http.MethodPost {
				switchCalls.Add(1)
				var req struct {
					Interface string `json:"interface"`
				}
				_ = json.NewDecoder(r.Body).Decode(&req)
				currentActive.Store(req.Interface)
				lastSwitchedTo.Store(req.Interface)
				_, _ = w.Write([]byte(`{"success":true}`))
				return
			}
			active := currentActive.Load().(string)
			// When active is awg1, it is DOWN (available=false).
			// awg4 is healthy (available=true).
			resp := fmt.Sprintf(`{
				"active_interface": "%s",
				"available_interfaces": ["awg1", "awg4"],
				"targets": [
					{"interface":"awg1","node":"S1","label":"S1 Амстердам","available":false,"reason":"packet loss 100%%"},
					{"interface":"awg4","node":"S4","label":"S4 Стокгольм","available":true}
				]
			}`, active)
			_, _ = w.Write([]byte(resp))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockSlave.Close()

	store, cleanup := setupTestStorage(t)
	defer cleanup()

	ctx := context.Background()
	node, err := store.CreateNode(ctx, "Cascade Failover Test", "cascade", "NLD", "https://aeza.net", mockSlave.URL, "key123", true, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	// Enable AutoFailover with priority ["awg4", "awg1"]
	_, err = store.UpdateNodeFailoverSettings(ctx, node.ID, true, []string{"awg4", "awg1"})
	if err != nil {
		t.Fatalf("failed to update failover settings: %v", err)
	}

	checker := monitor.NewHealthChecker(monitor.Config{
		Storage:  store,
		Interval: 50 * time.Millisecond,
		Timeout:  100 * time.Millisecond,
		LogActivity: func(category models.AuditLogCategory, action string, details string) {
			if action == "admin_cascade_auto_failover" {
				auditAction.Store(action)
			}
		},
	})

	// Round 1: Active is awg1 (failing). First failure cycle -> fail count = 1.
	checker.CollectTelemetry(ctx)
	status1 := checker.GetFailoverStatus(node.ID)
	if status1.ConsecutiveFailures != 1 {
		t.Fatalf("expected 1 consecutive failure, got %d", status1.ConsecutiveFailures)
	}
	if switchCalls.Load() != 0 {
		t.Fatalf("expected 0 switch calls on first failure, got %d", switchCalls.Load())
	}
	if currentActive.Load().(string) != "awg1" {
		t.Fatalf("expected active interface to remain awg1, got %s", currentActive.Load().(string))
	}

	// Round 2: Active is still awg1 (failing). Second failure cycle -> fail count = 2 -> AUTO-FAILOVER TRIGGERS!
	checker.CollectTelemetry(ctx)
	if switchCalls.Load() != 1 {
		t.Fatalf("expected 1 switch call after 2 consecutive failures, got %d", switchCalls.Load())
	}
	if lastSwitchedTo.Load().(string) != "awg4" {
		t.Fatalf("expected switched to awg4, got %s", lastSwitchedTo.Load().(string))
	}
	if currentActive.Load().(string) != "awg4" {
		t.Fatalf("expected active interface to be awg4, got %s", currentActive.Load().(string))
	}

	// Verify cooldown is active and failures reset
	status2 := checker.GetFailoverStatus(node.ID)
	if status2.ConsecutiveFailures != 0 {
		t.Fatalf("expected failures reset to 0, got %d", status2.ConsecutiveFailures)
	}
	if !status2.InCooldown {
		t.Fatalf("expected in_cooldown to be true after failover")
	}

	// Verify audit activity logged
	if auditAction.Load().(string) != "admin_cascade_auto_failover" {
		t.Fatalf("expected audit action admin_cascade_auto_failover, got '%s'", auditAction.Load().(string))
	}
}

func TestCascadeEgressFrozenAndRecoveryFlow(t *testing.T) {
	var sentMessages []map[string]any
	var mu sync.Mutex

	mockTG := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if strings.Contains(r.URL.Path, "sendMessage") {
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			sentMessages = append(sentMessages, payload)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok": true, "result": {"message_id": 123}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok": true, "result": []}`))
	}))
	defer mockTG.Close()

	var isFrozen atomic.Bool
	isFrozen.Store(true)

	mockSlave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/health", "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok","service":"avari-slave","version":"v1.6.0"}`))
			return
		case "/api/v1/stats":
			_, _ = w.Write([]byte(`{"total_rx":100,"total_tx":100,"peers":[]}`))
			return
		case "/api/v1/cascade/egress":
			frozen := isFrozen.Load()
			resp := fmt.Sprintf(`{
				"active_interface": "awg1",
				"available_interfaces": ["awg1"],
				"targets": [
					{
						"interface": "awg1",
						"node": "S1",
						"label": "S1 Амстердам",
						"available": true,
						"is_frozen": %v,
						"handshake_age_sec": 200,
						"recommendation": "systemctl restart awg-quick@awg1"
					}
				]
			}`, frozen)
			_, _ = w.Write([]byte(resp))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockSlave.Close()

	store, cleanup := setupTestStorage(t)
	defer cleanup()

	ctx := context.Background()
	_ = store.SaveTelegramChat(ctx, models.TelegramChat{
		ChatID:        12345,
		Username:      "admin",
		IsAdmin:       true,
		AlertsEnabled: true,
	})

	_, err := store.CreateNode(ctx, "Cascade Freeze Test", "cascade", "NLD", "https://example.com", mockSlave.URL, "key", true, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	bot := telegram.NewBot(telegram.Config{
		APIURL:      mockTG.URL,
		Token:       "dummy_token",
		BotUsername: "TestBot",
		Storage:     store,
	})

	var loggedActivities []string
	var actMu sync.Mutex

	checker := monitor.NewHealthChecker(monitor.Config{
		Storage:  store,
		Bot:      bot,
		Interval: 50 * time.Millisecond,
		Timeout:  100 * time.Millisecond,
		LogActivity: func(category models.AuditLogCategory, action string, details string) {
			actMu.Lock()
			loggedActivities = append(loggedActivities, action)
			actMu.Unlock()
		},
	})

	// Round 1: Target is frozen -> expect Frozen alert sent to TG
	checker.CollectTelemetry(ctx)

	mu.Lock()
	count := len(sentMessages)
	var firstMsg string
	if count > 0 {
		firstMsg = fmt.Sprintf("%v", sentMessages[0]["text"])
	}
	mu.Unlock()

	if count != 1 {
		t.Fatalf("expected 1 alert on initial freeze, got %d", count)
	}
	if !strings.Contains(firstMsg, "Завис") || !strings.Contains(firstMsg, "[АКТИВНЫЙ]") {
		t.Fatalf("unexpected message content: %s", firstMsg)
	}

	// Round 2: Target is still frozen -> anti-spam suppresses duplicate alert
	checker.CollectTelemetry(ctx)
	mu.Lock()
	count2 := len(sentMessages)
	mu.Unlock()
	if count2 != 1 {
		t.Fatalf("expected no duplicate alert on continuous freeze, got %d", count2)
	}

	// Round 3: Target recovers (isFrozen = false) -> expect Recovery notification
	isFrozen.Store(false)
	checker.CollectTelemetry(ctx)

	mu.Lock()
	count3 := len(sentMessages)
	var recoverMsg string
	if count3 > 1 {
		recoverMsg = fmt.Sprintf("%v", sentMessages[1]["text"])
	}
	mu.Unlock()

	if count3 != 2 {
		t.Fatalf("expected 2 total alerts (frozen + recovered), got %d", count3)
	}
	if !strings.Contains(recoverMsg, "восстановилась") || !strings.Contains(recoverMsg, "[АКТИВНЫЙ]") {
		t.Fatalf("unexpected recovery message content: %s", recoverMsg)
	}

	// Round 4: Immediate re-freeze within 15 min anti-flapping window -> alert suppressed
	isFrozen.Store(true)
	checker.CollectTelemetry(ctx)

	mu.Lock()
	count4 := len(sentMessages)
	mu.Unlock()
	if count4 != 2 {
		t.Fatalf("expected flapping alert to be suppressed by 15m cooldown, got %d messages", count4)
	}

	// Verify audit logs
	actMu.Lock()
	defer actMu.Unlock()
	hasFrozenLog := false
	hasRecoveredLog := false
	for _, act := range loggedActivities {
		if act == "cascade_egress_frozen" {
			hasFrozenLog = true
		}
		if act == "cascade_egress_recovered" {
			hasRecoveredLog = true
		}
	}
	if !hasFrozenLog || !hasRecoveredLog {
		t.Fatalf("expected both frozen and recovered audit logs, got: %v", loggedActivities)
	}
}
