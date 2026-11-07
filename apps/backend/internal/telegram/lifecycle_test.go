package telegram_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/telegram"
)

// A real long-polling request forces Stop/UpdateConfig to wait for a worker that
// must read the settings mutex again on exit. Shutdown must cancel that request
// and must not hold the settings lock while joining the worker.
func TestBotStopAndHotReloadCancelLongPolling(t *testing.T) {
	requests := make(chan string, 8)
	forceDone := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case requests <- r.URL.Path:
		default:
		}
		select {
		case <-r.Context().Done():
		case <-forceDone:
		}
	}))
	defer server.Close()
	defer close(forceDone)
	bot := telegram.NewBot(telegram.Config{APIURL: server.URL, Token: "old-token", Enabled: true})
	defer bot.Stop()
	nextRequest := func(want string) {
		t.Helper()
		select {
		case path := <-requests:
			if !strings.Contains(path, want) {
				t.Fatalf("expected %q request, got %q", want, path)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("polling did not start")
		}
	}
	promptly := func(fn func()) {
		t.Helper()
		done := make(chan struct{})
		go func() { fn(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("worker shutdown deadlocked or did not cancel long polling")
		}
	}
	bot.Start(context.Background())
	nextRequest("old-token")
	promptly(bot.Stop)
	promptly(bot.Stop) // idempotent
	bot.Start(context.Background())
	nextRequest("old-token")
	promptly(func() {
		if err := bot.UpdateConfig(context.Background(), models.TelegramSettings{Enabled: true, BotToken: "new-token"}); err != nil {
			t.Error(err)
		}
	})
	nextRequest("new-token")
	promptly(func() {
		if err := bot.UpdateConfig(context.Background(), models.TelegramSettings{Enabled: false, BotToken: "new-token"}); err != nil {
			t.Error(err)
		}
	})
	if bot.IsEnabled() {
		t.Fatal("disabled bot still enabled")
	}
	promptly(bot.Stop)
}

func TestBotImmediateAndConcurrentLifecycle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	bot := telegram.NewBot(telegram.Config{APIURL: server.URL, Token: "test-token", Enabled: true})
	// Covers stopping before the goroutine first obtains its settings RLock.
	for i := 0; i < 20; i++ {
		bot.Start(context.Background())
		bot.Stop()
	}
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				bot.Start(context.Background())
				_ = bot.UpdateConfig(context.Background(), models.TelegramSettings{Enabled: true, BotToken: "test-token"})
				bot.Stop()
			}
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("concurrent lifecycle operations deadlocked")
	}
	bot.Stop()
}
