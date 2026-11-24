package storage_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func TestTrafficPolicyDefaultsToOff(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()
	mode, err := store.GetTrafficPolicy(ctx)
	if err != nil {
		t.Fatalf("get traffic policy: %v", err)
	}
	if mode != models.PolicyOff {
		t.Fatalf("expected default policy off, got %s", mode)
	}
}

func TestTrafficPolicySetAndGet(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()
	if err := store.SetTrafficPolicy(ctx, models.PolicySoft); err != nil {
		t.Fatalf("set policy soft: %v", err)
	}

	mode, err := store.GetTrafficPolicy(ctx)
	if err != nil {
		t.Fatalf("get traffic policy: %v", err)
	}
	if mode != models.PolicySoft {
		t.Fatalf("expected soft, got %s", mode)
	}

	if err := store.SetTrafficPolicy(ctx, models.TrafficPolicy("bogus")); err == nil {
		t.Fatalf("expected error for invalid policy")
	}
}

func TestTorrentBlocklistSeeded(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()
	entries, err := store.ListTorrentBlocklist(ctx)
	if err != nil {
		t.Fatalf("list blocklist: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("expected seeded default blocklist")
	}
	for _, e := range entries {
		if e.Domain == "" {
			t.Fatalf("empty domain in blocklist")
		}
	}
}

func TestTorrentBlocklistCRUD(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	added, err := store.AddTorrentBlocklistDomain(ctx, "  Tracker.Example.COM  ", "admin")
	if err != nil {
		t.Fatalf("add domain: %v", err)
	}
	if added.Domain != "tracker.example.com" {
		t.Fatalf("expected normalized domain, got %q", added.Domain)
	}

	// Duplicate add should be idempotent.
	if _, err := store.AddTorrentBlocklistDomain(ctx, "tracker.example.com", "admin"); err != nil {
		t.Fatalf("duplicate add: %v", err)
	}

	entries, err := store.ListTorrentBlocklist(ctx)
	if err != nil {
		t.Fatalf("list blocklist: %v", err)
	}
	found := false
	for _, e := range entries {
		if e.Domain == "tracker.example.com" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected added domain in list")
	}

	if err := store.DeleteTorrentBlocklistDomain(ctx, added.ID); err != nil {
		t.Fatalf("delete domain: %v", err)
	}

	if err := store.DeleteTorrentBlocklistDomain(ctx, added.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected sql.ErrNoRows deleting missing row, got %v", err)
	}
}
