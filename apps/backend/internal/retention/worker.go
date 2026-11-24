package retention

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

// Config holds configuration for the retention worker.
type Config struct {
	AuditDays     int           // Retention days for audit_logs (default: 30)
	TelemetryDays int           // Retention days for peer/node daily telemetry (default: 90)
	Interval      time.Duration // Interval between retention cycles (default: 24h)
	InitialDelay  time.Duration // Delay before the first cycle after startup (default: 10s)
}

// Worker periodically cleans up old records to prevent SQLite database bloat.
type Worker struct {
	storage *storage.Storage
	cfg     Config
	stopCh  chan struct{}
	doneCh  chan struct{}
	running atomic.Bool
	mu      sync.Mutex
}

// NewWorker creates a new Retention Worker.
func NewWorker(s *storage.Storage, cfg Config) *Worker {
	if cfg.AuditDays <= 0 {
		cfg.AuditDays = 30
	}
	if cfg.TelemetryDays <= 0 {
		cfg.TelemetryDays = 90
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	if cfg.InitialDelay <= 0 {
		cfg.InitialDelay = 10 * time.Second
	}

	return &Worker{
		storage: s,
		cfg:     cfg,
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
}

// Start begins periodic retention cycles in the background.
func (w *Worker) Start(ctx context.Context) {
	if !w.running.CompareAndSwap(false, true) {
		return
	}

	slog.Info("Retention worker started",
		"audit_retention_days", w.cfg.AuditDays,
		"telemetry_retention_days", w.cfg.TelemetryDays,
		"interval", w.cfg.Interval.String(),
	)

	go func() {
		defer close(w.doneCh)
		defer w.running.Store(false)

		// Wait initial delay before first run
		select {
		case <-time.After(w.cfg.InitialDelay):
			w.runCycle(ctx)
		case <-w.stopCh:
			return
		case <-ctx.Done():
			return
		}

		ticker := time.NewTicker(w.cfg.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				w.runCycle(ctx)
			case <-w.stopCh:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
}

// Stop cleanly terminates the retention worker.
func (w *Worker) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running.Load() {
		return
	}

	select {
	case <-w.stopCh:
		// already stopping
	default:
		close(w.stopCh)
	}

	select {
	case <-w.doneCh:
	case <-time.After(5 * time.Second):
		slog.Warn("Retention worker stop timed out")
	}

	slog.Info("Retention worker stopped")
}

// RunOnce runs an immediate retention cycle and returns the stats.
func (w *Worker) RunOnce(ctx context.Context) (models.RetentionStats, error) {
	start := time.Now()
	stats, err := w.storage.RunRetention(ctx, w.cfg.AuditDays, w.cfg.TelemetryDays)
	duration := time.Since(start)

	if err != nil {
		slog.Error("Retention cleanup cycle failed",
			"error", err,
			"duration_ms", duration.Milliseconds(),
		)
		return stats, fmt.Errorf("retention run failed: %w", err)
	}

	totalDeleted := stats.AuditLogsDeleted + stats.TelemetryDeleted + stats.ResetRequestsDeleted + stats.ExpiredTokensDeleted
	if totalDeleted > 0 {
		slog.Info("Retention cleanup cycle completed",
			"audit_deleted", stats.AuditLogsDeleted,
			"telemetry_deleted", stats.TelemetryDeleted,
			"reset_requests_deleted", stats.ResetRequestsDeleted,
			"expired_tokens_deleted", stats.ExpiredTokensDeleted,
			"total_deleted", totalDeleted,
			"duration_ms", duration.Milliseconds(),
		)
	} else {
		slog.Debug("Retention cleanup cycle completed (no expired records to purge)",
			"duration_ms", duration.Milliseconds(),
		)
	}

	return stats, nil
}

func (w *Worker) runCycle(ctx context.Context) {
	cycleCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	_, _ = w.RunOnce(cycleCtx)
}
