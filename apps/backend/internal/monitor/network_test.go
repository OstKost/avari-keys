package monitor

import (
	"context"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
	"path/filepath"
	"testing"
	"time"
)

func TestIndependentCachedServerAndNetworkStatuses(t *testing.T) {
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	node, err := store.CreateNode(context.Background(), "test", "direct", "DEU", "https://provider.example.test", "http://127.0.0.1:1", "key", false, false, false)
	if err != nil {
		t.Fatal(err)
	}
	h := NewHealthChecker(Config{Storage: store})
	now := time.Now().UTC()
	h.nodeStates[node.ID] = true
	h.nodeLatencies[node.ID] = 12
	h.serverStatuses[node.ID] = models.StatusDetail{State: "green", CheckedAt: now}
	for _, source := range []string{"M0", "S0"} {
		h.networkProbes[node.ID] = append(h.networkProbes[node.ID], models.NetworkProbe{NodeID: node.ID, Source: source, StatusDetail: models.StatusDetail{State: "red", CheckedAt: now}})
	}
	nodes, err := h.CheckAllNodes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if nodes[0].ServerStatus.State != "green" || nodes[0].NetworkStatus.State != "red" || !nodes[0].Online || len(nodes[0].NetworkProbes) != 2 {
		t.Fatalf("statuses were conflated: %+v", nodes[0])
	}
	h.serverStatuses[node.ID] = models.StatusDetail{State: "green", CheckedAt: now.Add(-10 * time.Minute)}
	delete(h.networkProbes, node.ID)
	nodes, err = h.CheckAllNodes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if nodes[0].ServerStatus.State != "yellow" || nodes[0].NetworkStatus.State != "unknown" {
		t.Fatalf("missing stale/unknown states: %+v", nodes[0])
	}
}
