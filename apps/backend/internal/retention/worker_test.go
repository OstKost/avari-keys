package retention_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/retention"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func TestRetentionWorkerLifecycle(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "test_worker.db")
	s, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}
	defer s.Close()

	cfg := retention.Config{
		AuditDays:     30,
		TelemetryDays: 90,
		Interval:      50 * time.Millisecond,
		InitialDelay:  10 * time.Millisecond,
	}

	worker := retention.NewWorker(s, cfg)

	// Test RunOnce
	stats, err := worker.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if stats.AuditLogsDeleted != 0 {
		t.Errorf("expected 0 deleted, got %d", stats.AuditLogsDeleted)
	}

	// Test Start and Stop
	worker.Start(ctx)

	// Allow initial cycle to run
	time.Sleep(30 * time.Millisecond)

	// Idempotent start
	worker.Start(ctx)

	// Clean stop
	worker.Stop()
	// Idempotent stop
	worker.Stop()
}
