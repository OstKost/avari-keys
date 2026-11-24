package firewall

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// CommandExecutor executes external OS commands (iptables / ipset).
// It mirrors the shape of egress.CommandExecutor so a shared OS executor can be reused.
type CommandExecutor interface {
	Run(ctx context.Context, name string, args ...string) (string, error)
	Raw(ctx context.Context, name string, args ...string) (int, error)
}

// Names of the custom iptables chain and ipset used by the filter.
const (
	chainName = "AVARI_TORRENT"
	ipsetName = "avari_torrent_trackers"
)

// torrentPorts is the curated list of common BitTorrent / tracker ports (TCP+UDP).
var torrentPorts = []string{"6881:6889", "6969", "1337", "2710", "51413"}

// ErrStrictNotImplemented is returned when applying the reserved strict policy.
var ErrStrictNotImplemented = errors.New("strict torrent policy is not implemented yet")

// Manager applies and clears the torrent traffic filter rules on a node.
// It is platform-agnostic: it only builds and runs iptables/ipset commands via the
// injected executor, so production wires the real OS executor while tests wire a mock.
type Manager struct {
	exec CommandExecutor
	// resolve is swappable for tests; defaults to the real net resolver.
	resolve func(ctx context.Context, network, host string) ([]net.IP, error)

	mu          sync.Mutex
	mode        models.TrafficPolicy
	domains     []string
	lastApplied time.Time
}

// NewManager creates a Manager backed by the given command executor.
func NewManager(exec CommandExecutor) *Manager {
	return &Manager{
		exec:    exec,
		resolve: net.DefaultResolver.LookupIP,
		mode:    models.PolicyOff,
		domains: []string{},
	}
}

// NewManagerWithResolver creates a Manager with a custom DNS resolver (used in tests).
func NewManagerWithResolver(exec CommandExecutor, resolve func(ctx context.Context, network, host string) ([]net.IP, error)) *Manager {
	m := NewManager(exec)
	m.resolve = resolve
	return m
}

// Apply applies (or clears) the filter rules for the given mode.
func (m *Manager) Apply(ctx context.Context, mode models.TrafficPolicy) (models.TrafficPolicyResponse, error) {
	if !mode.Valid() {
		return models.TrafficPolicyResponse{}, fmt.Errorf("unknown traffic policy %q", mode)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	switch mode {
	case models.PolicyOff:
		if err := m.clear(ctx); err != nil {
			return models.TrafficPolicyResponse{}, err
		}
		m.mode = models.PolicyOff
		return models.TrafficPolicyResponse{Mode: mode, Applied: true, Message: "filter cleared"}, nil

	case models.PolicySoft:
		m.mode = models.PolicySoft
		if err := m.applySoft(ctx); err != nil {
			return models.TrafficPolicyResponse{}, err
		}
		m.lastApplied = time.Now()
		return models.TrafficPolicyResponse{Mode: mode, Applied: true, Message: "soft filter applied"}, nil

	case models.PolicyStrict:
		return models.TrafficPolicyResponse{Mode: mode, Applied: false, Message: ErrStrictNotImplemented.Error()}, ErrStrictNotImplemented

	default:
		return models.TrafficPolicyResponse{}, fmt.Errorf("unknown traffic policy %q", mode)
	}
}

// ApplyBlocklist stores the domain list and, when the filter is active, refreshes the ipset.
func (m *Manager) ApplyBlocklist(ctx context.Context, domains []string) error {
	m.mu.Lock()
	m.domains = normalizeDomains(domains)
	active := m.mode == models.PolicySoft
	m.mu.Unlock()

	if active {
		m.mu.Lock()
		defer m.mu.Unlock()
		return m.applySoft(ctx)
	}
	return nil
}

// Status returns a snapshot of the current local filter state.
func (m *Manager) Status() models.FirewallStatusResponse {
	m.mu.Lock()
	defer m.mu.Unlock()

	rules := 0
	if m.mode == models.PolicySoft {
		// 2 port rules (tcp + udp) + 1 ipset match rule when domains are present.
		rules = 2
		if len(m.domains) > 0 {
			rules++
		}
	}

	last := ""
	if !m.lastApplied.IsZero() {
		last = m.lastApplied.UTC().Format(time.RFC3339)
	}

	domains := make([]string, len(m.domains))
	copy(domains, m.domains)

	return models.FirewallStatusResponse{
		Mode:           m.mode,
		RulesCount:     rules,
		BlockedDomains: domains,
		LastAppliedAt:  last,
	}
}

// StartResolver periodically re-resolves the blocklist domains and refreshes the ipset.
// It runs until the context is cancelled. Resolution errors are ignored (best effort).
func (m *Manager) StartResolver(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			active := m.mode == models.PolicySoft
			m.mu.Unlock()
			if active {
				m.mu.Lock()
				_ = m.applySoft(ctx)
				m.mu.Unlock()
			}
		}
	}
}

// applySoft builds the full soft rule set. Caller must hold m.mu.
func (m *Manager) applySoft(ctx context.Context) error {
	if err := m.ensureChain(ctx); err != nil {
		return err
	}

	// Port rules (TCP + UDP) in the custom chain.
	for _, proto := range []string{"tcp", "udp"} {
		args := []string{"-A", chainName, "-p", proto, "-m", "multiport", "--dports", strings.Join(torrentPorts, ","), "-j", "DROP"}
		if _, err := m.exec.Run(ctx, "iptables", args...); err != nil {
			return fmt.Errorf("add %s port rule: %w", proto, err)
		}
	}

	// Resolve blocklist domains and populate the ipset.
	ips, _ := m.resolveIPs(ctx, m.domains)
	if err := m.syncIPSet(ctx, ips); err != nil {
		return err
	}
	if len(ips) > 0 {
		args := []string{"-A", chainName, "-m", "set", "--match-set", ipsetName, "dst", "-j", "DROP"}
		if _, err := m.exec.Run(ctx, "iptables", args...); err != nil {
			return fmt.Errorf("add ipset match rule: %w", err)
		}
	}

	return nil
}

// clear removes all filter rules, the custom chain, and the ipset. Caller must hold m.mu.
func (m *Manager) clear(ctx context.Context) error {
	// Remove jumps from FORWARD and OUTPUT (ignore errors when absent).
	for _, chain := range []string{"FORWARD", "OUTPUT"} {
		_, _ = m.exec.Raw(ctx, "iptables", "-D", chain, "-j", chainName)
	}
	// Flush and delete the custom chain.
	_, _ = m.exec.Raw(ctx, "iptables", "-F", chainName)
	_, _ = m.exec.Raw(ctx, "iptables", "-X", chainName)
	// Destroy the ipset (ignore error when absent).
	_, _ = m.exec.Raw(ctx, "ipset", "destroy", ipsetName)
	return nil
}

// ensureChain creates the custom chain (if missing) and jumps to it from FORWARD and OUTPUT.
func (m *Manager) ensureChain(ctx context.Context) error {
	// Create chain if missing (non-zero exit is expected when it already exists).
	_, _ = m.exec.Raw(ctx, "iptables", "-N", chainName)

	// Flush existing rules to make re-application idempotent.
	_, _ = m.exec.Raw(ctx, "iptables", "-F", chainName)

	// Ensure jumps are present.
	for _, chain := range []string{"FORWARD", "OUTPUT"} {
		if !m.ruleExists(ctx, "-C", chain, "-j", chainName) {
			if _, err := m.exec.Run(ctx, "iptables", "-I", chain, "-j", chainName); err != nil {
				return fmt.Errorf("jump %s -> %s: %w", chain, chainName, err)
			}
		}
	}
	return nil
}

// syncIPSet creates/flushes the ipset and fills it with the given IPs.
func (m *Manager) syncIPSet(ctx context.Context, ips []string) error {
	// -exist makes create idempotent.
	if _, err := m.exec.Run(ctx, "ipset", "create", ipsetName, "hash:ip", "-exist"); err != nil {
		return fmt.Errorf("create ipset: %w", err)
	}
	if _, err := m.exec.Run(ctx, "ipset", "flush", ipsetName); err != nil {
		return fmt.Errorf("flush ipset: %w", err)
	}
	for _, ip := range ips {
		if _, err := m.exec.Run(ctx, "ipset", "add", ipsetName, ip, "-exist"); err != nil {
			return fmt.Errorf("ipset add %s: %w", ip, err)
		}
	}
	return nil
}

// ruleExists reports whether the given iptables rule already exists (via -C check).
func (m *Manager) ruleExists(ctx context.Context, args ...string) bool {
	code, err := m.exec.Raw(ctx, "iptables", args...)
	return err == nil && code == 0
}

// resolveIPs resolves the given domains to their IPv4 addresses (dedup + sorted).
func (m *Manager) resolveIPs(ctx context.Context, domains []string) ([]string, error) {
	seen := map[string]bool{}
	var ips []string
	for _, d := range domains {
		addrs, err := m.resolve(ctx, "ip4", d)
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ip := a.String()
			if !seen[ip] {
				seen[ip] = true
				ips = append(ips, ip)
			}
		}
	}
	sort.Strings(ips)
	return ips, nil
}

// normalizeDomains lowercases, trims, dedups and drops empty entries.
func normalizeDomains(domains []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, d := range domains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	sort.Strings(out)
	return out
}
