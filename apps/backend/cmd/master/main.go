package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/logger"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/master"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func main() {
	// Initialize structured logging (slog + standard log bridge)
	logger.Init("avari-master")

	port := os.Getenv("MASTER_PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/avari-master.db"
	}

	jwtSecret := os.Getenv("JWT_SECRET")

	tgToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	tgUsername := os.Getenv("TELEGRAM_BOT_USERNAME")
	tgAdminChatID := os.Getenv("TELEGRAM_ADMIN_CHAT_ID")
	tgAdminSecret := os.Getenv("TELEGRAM_ADMIN_SECRET")

	intervalSec := 180
	if secStr := os.Getenv("HEALTHCHECK_INTERVAL_SEC"); secStr != "" {
		if s, err := strconv.Atoi(secStr); err == nil && s > 0 {
			intervalSec = s
		}
	}

	timeoutSec := 15
	if secStr := os.Getenv("HEALTHCHECK_TIMEOUT_SEC"); secStr != "" {
		if s, err := strconv.Atoi(secStr); err == nil && s > 0 {
			timeoutSec = s
		}
	}

	auditRetentionDays := 30
	if daysStr := os.Getenv("AUDIT_RETENTION_DAYS"); daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
			auditRetentionDays = d
		}
	}

	telemetryRetentionDays := 90
	if daysStr := os.Getenv("TELEMETRY_RETENTION_DAYS"); daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
			telemetryRetentionDays = d
		}
	}

	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		slog.Error("Failed to initialize SQLite database", "error", err, "path", dbPath)
		os.Exit(1)
	}
	defer store.Close()

	if err := store.EnsureDefaultAnnouncements(context.Background()); err != nil {
		slog.Warn("Failed to ensure default announcements", "error", err)
	}

	cfg := master.Config{
		Port:                   port,
		JWTSecret:              jwtSecret,
		TelegramBotToken:       tgToken,
		TelegramBotUsername:    tgUsername,
		TelegramAdminChatID:    tgAdminChatID,
		TelegramAdminSecret:    tgAdminSecret,
		HealthCheckInterval:    time.Duration(intervalSec) * time.Second,
		HealthCheckTimeout:     time.Duration(timeoutSec) * time.Second,
		AuditRetentionDays:     auditRetentionDays,
		TelemetryRetentionDays: telemetryRetentionDays,
	}

	srv := master.NewServer(cfg, store)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start background workers (Telegram long-polling, HealthChecker, Retention Worker)
	srv.StartBackgroundWorkers(ctx)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: srv.Handler(),
	}

	// Graceful shutdown listener
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-stopChan
		slog.Info("Shutting down master server gracefully...")
		srv.StopBackgroundWorkers()
		shutdownCtx, sCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer sCancel()
		_ = httpServer.Shutdown(shutdownCtx)
		cancel()
	}()

	slog.Info("Master server listening", "port", port, "url", fmt.Sprintf("http://0.0.0.0:%s", port))
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("Master server startup failed", "error", err)
		os.Exit(1)
	}
}
