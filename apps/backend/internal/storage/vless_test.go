package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func TestVlessMigration(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	store, err := storage.NewSQLiteStorage(path)
	if err != nil {
		t.Fatal(err)
	}
	node, err := store.CreateNode(ctx, "Existing", "direct", "DE", "", "https://example.test", "token", false, false, false, true)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TRIGGER validate_vless_owner; ALTER TABLE nodes DROP COLUMN has_vless"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err = storage.NewSQLiteStorage(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	migrated, err := store.GetNodeByID(ctx, node.ID)
	if err != nil || migrated.HasVless || !migrated.HasMieru {
		t.Fatal("legacy node capabilities changed", err)
	}
	updated, err := store.UpdateNode(ctx, node.ID, node.Name, node.Type, node.CountryCode, "", node.APIURL, "", false, false, false, true, true)
	if err != nil || !updated.HasVless {
		t.Fatal("VLESS update failed", err)
	}
	updated, err = store.UpdateNode(ctx, node.ID, node.Name, node.Type, node.CountryCode, "", node.APIURL, "", false, false, false, true)
	if err != nil || !updated.HasVless {
		t.Fatal("legacy update cleared VLESS", err)
	}
}
