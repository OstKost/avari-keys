package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/master"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func main() {
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

	intervalSec := 60
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

	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		log.Fatalf("[MASTER] Failed to initialize SQLite database: %v", err)
	}
	defer store.Close()

	cfg := master.Config{
		Port:                port,
		JWTSecret:           jwtSecret,
		TelegramBotToken:    tgToken,
		TelegramBotUsername: tgUsername,
		TelegramAdminChatID: tgAdminChatID,
		TelegramAdminSecret: tgAdminSecret,
		HealthCheckInterval: time.Duration(intervalSec) * time.Second,
		HealthCheckTimeout:  time.Duration(timeoutSec) * time.Second,
	}

	srv := master.NewServer(cfg, store)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start background workers (Telegram long-polling & HealthChecker)
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
		log.Println("[MASTER] Shutting down gracefully...")
		srv.StopBackgroundWorkers()
		shutdownCtx, sCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer sCancel()
		_ = httpServer.Shutdown(shutdownCtx)
		cancel()
	}()

	log.Printf("[MASTER] Server listening on http://0.0.0.0:%s", port)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[MASTER] Server startup failed: %v", err)
	}
}
