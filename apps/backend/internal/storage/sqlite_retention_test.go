package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func TestStorageRetention(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_retention.db")
	s, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}
	defer s.Close()

	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open raw sqlite db: %v", err)
	}
	defer rawDB.Close()

	// 1. Audit logs: create user and log
	u, err := s.CreateUser(ctx, "retention_user", "password123")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	err = s.CreateAuditLog(ctx, &models.AuditLog{
		UserID:    &u.ID,
		Username:  u.Username,
		Action:    "recent_action",
		Category:  models.CategoryAuth,
		IPAddress: "127.0.0.1",
		Details:   "recent log",
	})
	if err != nil {
		t.Fatalf("failed to create recent audit log: %v", err)
	}

	// Insert an old audit log directly into SQLite with past timestamp
	_, err = rawDB.ExecContext(ctx, `
		INSERT INTO audit_logs (user_id, username, action, category, ip_address, details, created_at)
		VALUES (?, ?, 'old_action', 'auth', '127.0.0.1', 'old log', datetime('now', '-40 days'))
	`, u.ID, u.Username)
	if err != nil {
		t.Fatalf("failed to insert old audit log: %v", err)
	}

	// 2. Telemetry: create a node and client config
	node, err := s.CreateNode(ctx, "Node1", "direct", "NL", "https://nl.example.com", "http://127.0.0.1:8081", "key123", false, false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}
	key, err := s.CreateClientConfig(ctx, u.ID, node.ID, "key_retention", "pub123", "priv123", "10.0.0.2")
	if err != nil {
		t.Fatalf("failed to create client config: %v", err)
	}

	// Insert old and new telemetry
	oldDate := time.Now().AddDate(0, 0, -100).Format("2006-01-02")
	newDate := time.Now().Format("2006-01-02")

	_, err = rawDB.ExecContext(ctx, `
		INSERT INTO peer_traffic_daily (date, client_config_id, rx_bytes, tx_bytes) VALUES (?, ?, 1000, 2000), (?, ?, 3000, 4000)
	`, oldDate, key.ID, newDate, key.ID)
	if err != nil {
		t.Fatalf("failed to insert peer_traffic_daily: %v", err)
	}

	_, err = rawDB.ExecContext(ctx, `
		INSERT INTO node_traffic_daily (date, node_id, rx_bytes, tx_bytes) VALUES (?, ?, 5000, 6000), (?, ?, 7000, 8000)
	`, oldDate, node.ID, newDate, node.ID)
	if err != nil {
		t.Fatalf("failed to insert node_traffic_daily: %v", err)
	}

	// 3. Password reset requests: one pending, one old approved
	_, err = rawDB.ExecContext(ctx, `
		INSERT INTO password_reset_requests (user_id, new_password_hash, status, created_at, updated_at)
		VALUES (?, 'hash1', 'approved', datetime('now', '-20 days'), datetime('now', '-20 days')),
		       (?, 'hash2', 'pending', datetime('now', '-20 days'), datetime('now', '-20 days'))
	`, u.ID, u.ID)
	if err != nil {
		t.Fatalf("failed to insert password_reset_requests: %v", err)
	}

	// 4. Telegram link tokens: one old (8 days ago), one fresh
	_, err = rawDB.ExecContext(ctx, `
		INSERT INTO telegram_link_tokens (token, user_id, created_at)
		VALUES ('expired_token', ?, datetime('now', '-8 days')),
		       ('valid_token', ?, datetime('now'))
	`, u.ID, u.ID)
	if err != nil {
		t.Fatalf("failed to insert telegram_link_tokens: %v", err)
	}

	// Run retention
	stats, err := s.RunRetention(ctx, 30, 90)
	if err != nil {
		t.Fatalf("RunRetention failed: %v", err)
	}

	if stats.AuditLogsDeleted != 1 {
		t.Errorf("expected 1 audit log deleted, got %d", stats.AuditLogsDeleted)
	}
	if stats.TelemetryDeleted != 2 {
		t.Errorf("expected 2 telemetry records deleted (1 peer + 1 node), got %d", stats.TelemetryDeleted)
	}
	if stats.ResetRequestsDeleted != 1 {
		t.Errorf("expected 1 reset request deleted, got %d", stats.ResetRequestsDeleted)
	}
	if stats.ExpiredTokensDeleted != 1 {
		t.Errorf("expected 1 expired token deleted, got %d", stats.ExpiredTokensDeleted)
	}

	// Verify remaining counts
	var auditCount int
	_ = rawDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM audit_logs").Scan(&auditCount)
	if auditCount != 1 {
		t.Errorf("expected 1 remaining audit log, got %d", auditCount)
	}

	var peerCount int
	_ = rawDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM peer_traffic_daily").Scan(&peerCount)
	if peerCount != 1 {
		t.Errorf("expected 1 remaining peer telemetry, got %d", peerCount)
	}

	var tokenCount int
	_ = rawDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM telegram_link_tokens").Scan(&tokenCount)
	if tokenCount != 1 {
		t.Errorf("expected 1 remaining link token, got %d", tokenCount)
	}
}
