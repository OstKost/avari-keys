package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/egress"
)

func TestSlaveCLI_EgressSubcommands(t *testing.T) {
	tmpDir := t.TempDir()
	regPath := filepath.Join(tmpDir, "egress.json")
	lockPath := filepath.Join(tmpDir, "lock")

	entries := []egress.TargetConfig{
		{Interface: "awg1", Endpoint: "127.0.0.1", Label: "Local Test"},
	}
	data, _ := json.Marshal(entries)
	_ = os.WriteFile(regPath, data, 0600)

	t.Setenv("AVARI_EGRESS_CONFIG", regPath)
	t.Setenv("AVARI_EGRESS_LOCK", lockPath)

	mgr := egress.NewManager()
	if mgr == nil {
		t.Fatal("expected non-nil egress manager")
	}
}
