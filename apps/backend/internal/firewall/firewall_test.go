package firewall

import (
	"context"
	"errors"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

type mockExecutor struct {
	mu   sync.Mutex
	runs [][]string
	raws [][]string
}

func (m *mockExecutor) Run(ctx context.Context, name string, args ...string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs = append(m.runs, append([]string{name}, args...))
	return "", nil
}

// Raw returns a non-zero exit code to simulate "rule/chain not found" checks.
func (m *mockExecutor) Raw(ctx context.Context, name string, args ...string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.raws = append(m.raws, append([]string{name}, args...))
	return 1, nil
}

// contains reports whether a Run/Raw command named cmd had args containing every substr.
func (m *mockExecutor) contains(cmd string, substr ...string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, all := range [][][]string{m.runs, m.raws} {
		for _, r := range all {
			if len(r) == 0 || r[0] != cmd {
				continue
			}
			joined := strings.Join(r[1:], " ")
			ok := true
			for _, s := range substr {
				if !strings.Contains(joined, s) {
					ok = false
					break
				}
			}
			if ok {
				return true
			}
		}
	}
	return false
}

func noResolve(ctx context.Context, network, host string) ([]net.IP, error) {
	return nil, errors.New("unresolvable")
}

func TestApplySoftAppliesPortRulesAndJumps(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)
	m.resolve = noResolve

	resp, err := m.Apply(context.Background(), models.PolicySoft)
	if err != nil {
		t.Fatalf("apply soft: %v", err)
	}
	if !resp.Applied {
		t.Fatalf("expected applied=true")
	}

	if !exec.contains("iptables", "-N", chainName) {
		t.Errorf("expected chain creation")
	}
	if !exec.contains("iptables", "-p", "tcp", "--dports", "6881:6889") {
		t.Errorf("expected TCP port rule")
	}
	if !exec.contains("iptables", "-p", "udp", "--dports", "6881:6889") {
		t.Errorf("expected UDP port rule")
	}
	if !exec.contains("iptables", "-I", "FORWARD", "-j", chainName) {
		t.Errorf("expected FORWARD jump")
	}
	if !exec.contains("iptables", "-I", "OUTPUT", "-j", chainName) {
		t.Errorf("expected OUTPUT jump")
	}

	if st := m.Status(); st.Mode != models.PolicySoft {
		t.Fatalf("expected soft status, got %s", st.Mode)
	}
}

func TestApplyOffClearsRules(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)
	m.resolve = noResolve

	if _, err := m.Apply(context.Background(), models.PolicySoft); err != nil {
		t.Fatalf("apply soft: %v", err)
	}

	resp, err := m.Apply(context.Background(), models.PolicyOff)
	if err != nil {
		t.Fatalf("apply off: %v", err)
	}
	if !resp.Applied {
		t.Fatalf("expected applied=true")
	}

	for _, chain := range []string{"FORWARD", "OUTPUT"} {
		if !exec.contains("iptables", "-D", chain, "-j", chainName) {
			t.Errorf("expected jump removal from %s", chain)
		}
	}
	if !exec.contains("iptables", "-X", chainName) {
		t.Errorf("expected chain deletion")
	}
	if !exec.contains("ipset", "destroy", ipsetName) {
		t.Errorf("expected ipset destroy")
	}
}

func TestApplyStrictNotImplemented(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)

	_, err := m.Apply(context.Background(), models.PolicyStrict)
	if !errors.Is(err, ErrStrictNotImplemented) {
		t.Fatalf("expected ErrStrictNotImplemented, got %v", err)
	}
}

func TestApplyInvalidPolicy(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)

	if _, err := m.Apply(context.Background(), models.TrafficPolicy("bogus")); err == nil {
		t.Fatalf("expected error for unknown policy")
	}
}

func TestApplyBlocklistPopulatesIPSet(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)
	m.resolve = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("1.2.3.4"), net.ParseIP("5.6.7.8")}, nil
	}

	if _, err := m.Apply(context.Background(), models.PolicySoft); err != nil {
		t.Fatalf("apply soft: %v", err)
	}
	if err := m.ApplyBlocklist(context.Background(), []string{"TRACKER.example.com", "tracker.example.com"}); err != nil {
		t.Fatalf("apply blocklist: %v", err)
	}

	if !exec.contains("ipset", "add", ipsetName, "1.2.3.4") {
		t.Errorf("expected ipset add 1.2.3.4")
	}
	if !exec.contains("ipset", "add", ipsetName, "5.6.7.8") {
		t.Errorf("expected ipset add 5.6.7.8")
	}
	if !exec.contains("iptables", "--match-set", ipsetName, "dst") {
		t.Errorf("expected ipset match rule")
	}

	st := m.Status()
	if len(st.BlockedDomains) != 1 || st.BlockedDomains[0] != "tracker.example.com" {
		t.Fatalf("expected deduped/lowercased domain, got %v", st.BlockedDomains)
	}
}

func TestApplyBlocklistWhenOffOnlyStores(t *testing.T) {
	exec := &mockExecutor{}
	m := NewManager(exec)
	m.resolve = noResolve

	if err := m.ApplyBlocklist(context.Background(), []string{"tracker.example.com"}); err != nil {
		t.Fatalf("apply blocklist: %v", err)
	}

	// No iptables/ipset commands should have run since the filter is off.
	if len(exec.runs) != 0 {
		t.Fatalf("expected no commands while off, got %v", exec.runs)
	}
	if st := m.Status(); len(st.BlockedDomains) != 1 {
		t.Fatalf("expected domain stored, got %v", st.BlockedDomains)
	}
}

func TestSaveAndRestoreState(t *testing.T) {
	fakeResolve := func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("1.2.3.4")}, nil
	}

	m := NewManagerWithResolver(&mockExecutor{}, fakeResolve)
	statePath := filepath.Join(t.TempDir(), "firewall-state.json")
	m.SetStatePath(statePath)

	if _, err := m.Apply(context.Background(), models.PolicySoft); err != nil {
		t.Fatalf("apply soft: %v", err)
	}
	if err := m.ApplyBlocklist(context.Background(), []string{"tracker.example.com"}); err != nil {
		t.Fatalf("apply blocklist: %v", err)
	}

	// A fresh manager restores from the persisted state.
	m2 := NewManagerWithResolver(&mockExecutor{}, fakeResolve)
	m2.SetStatePath(statePath)
	restored, err := m2.RestoreState(context.Background())
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !restored {
		t.Fatalf("expected restored=true")
	}
	st := m2.Status()
	if st.Mode != models.PolicySoft || len(st.BlockedDomains) != 1 {
		t.Fatalf("unexpected restored status: %+v", st)
	}
}

func TestBlockableIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"1.2.3.4", true},
		{"8.8.8.8", true},
		{"93.158.213.92", true},
		{"127.0.0.1", false},
		{"10.0.0.1", false},
		{"192.168.1.1", false},
		{"172.16.0.1", false},
		{"169.254.1.1", false},
		{"0.0.0.0", false},
		{"224.0.0.1", false},
	}
	for _, c := range cases {
		got := blockableIP(net.ParseIP(c.ip))
		if got != c.want {
			t.Errorf("blockableIP(%s) = %v, want %v", c.ip, got, c.want)
		}
	}
}
