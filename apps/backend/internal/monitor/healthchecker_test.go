package monitor_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

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
	node, err := store.CreateNode(ctx, "Test Node", "cascade", "NLD", "https://aeza.net", mockSlave.URL, "dummy_key", true, false)
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
	_, err := store.CreateNode(ctx, "Resilient Node", "direct", "DEU", "https://aeza.net", mockSlave.URL, "dummy_key", true, false)
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

	node, err := store.CreateNode(ctx, "Telemetry Node", "cascade", "NLD", "https://aeza.net", mockSlave.URL, "dummy_key", true, false)
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

	// Round 2: Increment traffic (+50MB RX, +30MB TX = +80MB total)
	rawRx.Store(150 * 1024 * 1024)
	rawTx.Store(80 * 1024 * 1024)
	checker.CollectTelemetry(ctx)

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

