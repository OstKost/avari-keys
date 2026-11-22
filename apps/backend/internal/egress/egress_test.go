package egress

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
)

type mockExecutor struct {
	mu           sync.Mutex
	commandsRun  []string
	runHandler   func(name string, args ...string) (string, error)
	rawHandler   func(name string, args ...string) (int, error)
	activeRoute  string
	natExisted   bool
	routesTable  map[string][]string
}

func newMockExecutor() *mockExecutor {
	return &mockExecutor{
		routesTable: make(map[string][]string),
	}
}

func (m *mockExecutor) Run(ctx context.Context, name string, args ...string) (string, error) {
	m.mu.Lock()
	cmdStr := name + " " + strings.Join(args, " ")
	m.commandsRun = append(m.commandsRun, cmdStr)
	m.mu.Unlock()

	if m.runHandler != nil {
		return m.runHandler(name, args...)
	}

	if name == "ip" {
		if len(args) >= 4 && args[0] == "-4" && args[1] == "route" && args[2] == "show" && args[3] == "table" {
			if m.activeRoute != "" {
				return fmt.Sprintf("default dev %s scope link", m.activeRoute), nil
			}
			return "", nil
		}
		if len(args) >= 6 && args[0] == "-4" && args[1] == "route" && args[2] == "replace" && args[3] == "default" {
			m.activeRoute = args[5]
			return "", nil
		}
	}

	return "", nil
}

func (m *mockExecutor) Raw(ctx context.Context, name string, args ...string) (int, error) {
	m.mu.Lock()
	cmdStr := name + " " + strings.Join(args, " ")
	m.commandsRun = append(m.commandsRun, cmdStr)
	m.mu.Unlock()

	if m.rawHandler != nil {
		return m.rawHandler(name, args...)
	}

	if name == "iptables" && len(args) >= 4 && args[3] == "-C" {
		if m.natExisted {
			return 0, nil
		}
		return 1, nil // not existing
	}

	return 0, nil
}

type mockProber struct {
	fetchIPFunc        func(iface, url string) (string, int, error)
	fetchStatusFunc    func(iface, url string) (int, error)
	checkInterfaceFunc func(iface string) error
}

func (p *mockProber) CheckInterface(iface string) error {
	if p.checkInterfaceFunc != nil {
		return p.checkInterfaceFunc(iface)
	}
	return nil
}

func (p *mockProber) FetchIP(ctx context.Context, iface string, url string) (string, int, error) {
	if p.fetchIPFunc != nil {
		return p.fetchIPFunc(iface, url)
	}
	return "194.87.1.1", 200, nil
}

func (p *mockProber) FetchStatus(ctx context.Context, iface string, url string) (int, error) {
	if p.fetchStatusFunc != nil {
		return p.fetchStatusFunc(iface, url)
	}
	if strings.Contains(url, "telegram") {
		return 302, nil
	}
	return 200, nil
}

func TestReadRegistry(t *testing.T) {
	tmpDir := t.TempDir()
	regPath := filepath.Join(tmpDir, "egress.json")

	// Valid
	validData := `[
		{"interface": "awg1", "endpoint": "194.87.1.1", "node": "S1", "label": "S1 Netherlands"},
		{"interface": "awg3", "endpoint": "194.87.1.2", "node": "S4", "label": "S4 Sweden"}
	]`
	if err := os.WriteFile(regPath, []byte(validData), 0600); err != nil {
		t.Fatal(err)
	}

	entries, err := ReadRegistry(regPath)
	if err != nil {
		t.Fatalf("expected valid registry, got err: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	// Invalid interface
	invalidIface := `[{"interface": "eth0", "endpoint": "194.87.1.1"}]`
	_ = os.WriteFile(regPath, []byte(invalidIface), 0600)
	if _, err := ReadRegistry(regPath); err == nil {
		t.Fatal("expected error for invalid interface name eth0")
	}

	// Invalid endpoint
	invalidIP := `[{"interface": "awg1", "endpoint": "not-an-ip"}]`
	_ = os.WriteFile(regPath, []byte(invalidIP), 0600)
	if _, err := ReadRegistry(regPath); err == nil {
		t.Fatal("expected error for invalid endpoint")
	}

	// Duplicate interface
	dupIface := `[{"interface": "awg1", "endpoint": "194.87.1.1"}, {"interface": "awg1", "endpoint": "194.87.1.2"}]`
	_ = os.WriteFile(regPath, []byte(dupIface), 0600)
	if _, err := ReadRegistry(regPath); err == nil {
		t.Fatal("expected error for duplicate interface")
	}
}

func TestActive(t *testing.T) {
	ctx := context.Background()
	exec := newMockExecutor()

	// Single default route
	exec.runHandler = func(name string, args ...string) (string, error) {
		return "default dev awg2 proto static metric 100", nil
	}
	active, err := Active(ctx, exec)
	if err != nil || active != "awg2" {
		t.Fatalf("expected awg2, got %q (err: %v)", active, err)
	}

	// No default route
	exec.runHandler = func(name string, args ...string) (string, error) {
		return "10.8.0.0/24 dev awg1 proto kernel scope link", nil
	}
	active, err = Active(ctx, exec)
	if err != nil || active != "" {
		t.Fatalf("expected empty active route, got %q", active)
	}

	// Ambiguous routes
	exec.runHandler = func(name string, args ...string) (string, error) {
		return "default dev awg1\ndefault dev awg2", nil
	}
	active, err = Active(ctx, exec)
	if err != nil || active != "" {
		t.Fatalf("expected empty for ambiguous routes, got %q", active)
	}
}

func TestProbeTarget_Scenarios(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	target := TargetConfig{
		Interface: "awg1",
		Endpoint:  "194.87.1.1",
		Node:      "S1",
		Label:     "S1 Netherlands",
	}

	// Scenario 1: All 5 checks succeed (5/5)
	prober := &mockProber{}
	if err := ProbeTarget(ctx, cfg, target, prober); err != nil {
		t.Fatalf("expected probe to succeed with 5/5, got: %v", err)
	}

	// Scenario 2: 1 check fails (4/5 pass, IP OK) -> Quorum (>=3) must pass
	prober1Fail := &mockProber{
		fetchStatusFunc: func(iface, url string) (int, error) {
			if strings.Contains(url, "chatgpt") {
				return 403, nil // ChatGPT blocked
			}
			if strings.Contains(url, "telegram") {
				return 302, nil
			}
			return 200, nil
		},
	}
	if err := ProbeTarget(ctx, cfg, target, prober1Fail); err != nil {
		t.Fatalf("expected quorum to pass with 4/5, got error: %v", err)
	}

	// Scenario 2b: Safety Gate violation: IP mismatch (even though 4 web services succeed)
	proberIPLeak := &mockProber{
		fetchIPFunc: func(iface, url string) (string, int, error) {
			return "95.161.1.1", 200, nil // IP leak / wrong exit IP
		},
		fetchStatusFunc: func(iface, url string) (int, error) {
			return 200, nil
		},
	}
	errIP := ProbeTarget(ctx, cfg, target, proberIPLeak)
	if errIP == nil || !strings.Contains(errIP.Error(), "утечка или несовпадение IP") {
		t.Fatalf("expected Safety Gate failure on IP mismatch, got: %v", errIP)
	}

	// Verify RunTargetProbe report structure
	rep := RunTargetProbe(ctx, cfg, target, proberIPLeak)
	if rep.Available {
		t.Fatal("expected report to be unavailable on IP mismatch")
	}
	if rep.PassedChecks != 4 || rep.TotalChecks != 5 {
		t.Fatalf("expected 4 passed checks and 5 total, got %d/%d", rep.PassedChecks, rep.TotalChecks)
	}

	// Scenario 2c: Interface down via CheckInterface
	proberIfaceDown := &mockProber{
		checkInterfaceFunc: func(iface string) error {
			return fmt.Errorf("туннель %s не запущен: no such device", iface)
		},
	}
	repDown := RunTargetProbe(ctx, cfg, target, proberIfaceDown)
	if repDown.Available {
		t.Fatal("expected target to be unavailable when interface is down")
	}
	if !strings.Contains(repDown.Reason, "туннель awg1 не запущен") {
		t.Fatalf("unexpected reason: %s", repDown.Reason)
	}
	if len(rep.Checks) != 5 {
		t.Fatalf("expected 5 check results in report, got %d", len(rep.Checks))
	}
	if rep.Checks[0].OK {
		t.Fatal("expected IP check to be marked as not OK")
	}

	// Scenario 3: 2 checks fail (3/5 pass) -> Quorum (>=3) must pass
	prober2Fail := &mockProber{
		fetchStatusFunc: func(iface, url string) (int, error) {
			if strings.Contains(url, "chatgpt") {
				return 403, nil // ChatGPT blocked
			}
			if strings.Contains(url, "grok") {
				return 500, nil // Grok down
			}
			if strings.Contains(url, "telegram") {
				return 302, nil
			}
			return 200, nil
		},
	}
	if err := ProbeTarget(ctx, cfg, target, prober2Fail); err != nil {
		t.Fatalf("expected quorum to pass with 3/5, got error: %v", err)
	}

	// Scenario 4: 3 checks fail (2/5 pass) -> Quorum fails! (<3)
	prober3Fail := &mockProber{
		fetchStatusFunc: func(iface, url string) (int, error) {
			if strings.Contains(url, "chatgpt") {
				return 403, nil // ChatGPT blocked
			}
			if strings.Contains(url, "grok") {
				return 403, nil // Grok blocked
			}
			if strings.Contains(url, "instagram") {
				return 403, nil // Meta blocked
			}
			if strings.Contains(url, "telegram") {
				return 302, nil
			}
			return 200, nil
		},
	}
	err := ProbeTarget(ctx, cfg, target, prober3Fail)
	if err == nil || !strings.Contains(err.Error(), "пройдено только 2/5 проверок") {
		t.Fatalf("expected error for 2/5 quorum failure, got: %v", err)
	}
	if !strings.Contains(err.Error(), "chatgpt") || !strings.Contains(err.Error(), "grok") || !strings.Contains(err.Error(), "meta") {
		t.Fatalf("expected error to list failing services, got: %v", err)
	}

	// Scenario 5: All 5 fail (0/5 pass) -> Total failure
	proberAllFail := &mockProber{
		fetchIPFunc: func(iface, url string) (string, int, error) {
			return "", 0, fmt.Errorf("network down")
		},
		fetchStatusFunc: func(iface, url string) (int, error) {
			return 0, fmt.Errorf("network down")
		},
	}
	err = ProbeTarget(ctx, cfg, target, proberAllFail)
	if err == nil || !strings.Contains(err.Error(), "пройдено только 0/5 проверок") {
		t.Fatalf("expected error for 0/5 failure, got: %v", err)
	}
}

func setupTestEnvironment(t *testing.T) (Config, *mockExecutor, *mockProber) {
	tmpDir := t.TempDir()

	cfg := Config{
		RegistryPath: filepath.Join(tmpDir, "egress.json"),
		StatePath:    filepath.Join(tmpDir, "egress-selected.env"),
		PendingPath:  filepath.Join(tmpDir, "egress-pending.json"),
		SubnetPath:   filepath.Join(tmpDir, "egress-client-subnet"),
		LockPath:     filepath.Join(tmpDir, "awg-routing.lock"),
		IpifyURL:     "https://api.ipify.org",
		TelegramURL:  "https://api.telegram.org",
		ChatGPTURL:   "https://chatgpt.com",
	}

	entries := []TargetConfig{
		{Interface: "awg1", Endpoint: "194.87.1.1", Node: "S1", Label: "S1 Netherlands"},
		{Interface: "awg3", Endpoint: "194.87.1.3", Node: "S4", Label: "S4 Sweden"},
	}
	data, _ := json.Marshal(entries)
	_ = os.WriteFile(cfg.RegistryPath, data, 0600)

	_ = os.WriteFile(cfg.SubnetPath, []byte("10.8.0.0/24\n"), 0600)
	_ = os.WriteFile(cfg.StatePath, []byte("AWG1_IF=\"awg1\"\nAWG1_ENDPOINT=\"194.87.1.1\"\n"), 0600)

	exec := newMockExecutor()
	exec.activeRoute = "awg1"

	prober := &mockProber{
		fetchIPFunc: func(iface, url string) (string, int, error) {
			if iface == "awg1" {
				return "194.87.1.1", 200, nil
			}
			return "194.87.1.3", 200, nil
		},
		fetchStatusFunc: func(iface, url string) (int, error) {
			if strings.Contains(url, "telegram") {
				return 302, nil
			}
			return 200, nil
		},
	}

	return cfg, exec, prober
}

func TestManager_GetStatus(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)
	mgr := NewManagerWith(cfg, exec, prober)

	resp, err := mgr.GetStatus(context.Background())
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}

	if resp.ActiveInterface != "awg1" {
		t.Fatalf("expected active interface awg1, got %s", resp.ActiveInterface)
	}
	if len(resp.Targets) != 2 {
		t.Fatalf("expected 2 targets, got %d", len(resp.Targets))
	}
	for _, target := range resp.Targets {
		if !target.Available {
			t.Fatalf("expected target %s to be available, got reason: %s", target.Interface, target.Reason)
		}
	}
}

func TestManager_Switch_Success(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)
	mgr := NewManagerWith(cfg, exec, prober)

	err := mgr.Switch(context.Background(), "awg3")
	if err != nil {
		t.Fatalf("Switch to awg3 failed: %v", err)
	}

	// Verify state file
	stateBytes, err := os.ReadFile(cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(stateBytes), "AWG1_IF=\"awg3\"") {
		t.Fatalf("expected state file to contain awg3, got: %s", string(stateBytes))
	}

	// Pending file should be cleared
	if _, err := os.Stat(cfg.PendingPath); !os.IsNotExist(err) {
		t.Fatalf("expected pending file to be removed after successful switch")
	}
}

func TestManager_Switch_PreflightFailure_NoChanges(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)
	// Make awg3 fail quorum on preflight (ChatGPT, Grok, Meta return 403)
	prober.fetchStatusFunc = func(iface, url string) (int, error) {
		if iface == "awg3" {
			return 403, nil
		}
		return 200, nil
	}

	mgr := NewManagerWith(cfg, exec, prober)
	err := mgr.Switch(context.Background(), "awg3")
	if err == nil {
		t.Fatal("expected switch to fail on preflight check")
	}

	// State file must remain unchanged
	stateBytes, _ := os.ReadFile(cfg.StatePath)
	if !strings.Contains(string(stateBytes), "AWG1_IF=\"awg1\"") {
		t.Fatalf("expected state file to still point to awg1, got: %s", string(stateBytes))
	}
	if _, err := os.Stat(cfg.PendingPath); !os.IsNotExist(err) {
		t.Fatal("pending file should not exist after preflight failure")
	}
}

func TestManager_Switch_PostflightFailure_Rollback(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)

	// Preflight succeeds, but postflight fails quorum
	var awg3Checks int32
	prober.fetchStatusFunc = func(iface, url string) (int, error) {
		if iface == "awg3" && atomic.LoadInt32(&awg3Checks) > 0 {
			return 403, nil // postflight fails
		}
		if strings.Contains(url, "telegram") {
			return 302, nil
		}
		return 200, nil
	}
	prober.fetchIPFunc = func(iface, url string) (string, int, error) {
		if iface == "awg3" {
			atomic.AddInt32(&awg3Checks, 1)
			return "194.87.1.3", 200, nil
		}
		return "194.87.1.1", 200, nil
	}

	mgr := NewManagerWith(cfg, exec, prober)
	err := mgr.Switch(context.Background(), "awg3")
	if err == nil {
		t.Fatal("expected switch to fail on postflight check")
	}

	// State file must be rolled back to awg1
	stateBytes, _ := os.ReadFile(cfg.StatePath)
	if !strings.Contains(string(stateBytes), "AWG1_IF=\"awg1\"") {
		t.Fatalf("expected state file to be rolled back to awg1, got: %s", string(stateBytes))
	}
	// Pending file should be cleared after rollback
	if _, err := os.Stat(cfg.PendingPath); !os.IsNotExist(err) {
		t.Fatal("pending file should be removed after rollback")
	}
}

func TestManager_Recover_Pending(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)

	// Create pending snapshot simulating a crashed process
	prevSel := "AWG1_IF=\"awg1\"\nAWG1_ENDPOINT=\"194.87.1.1\"\n"
	snap := Snapshot{
		Subnet: "10.8.0.0/24",
		Routes: map[string][]string{
			"default": {"default dev awg1 scope link"},
		},
		Selection: &prevSel,
		Target:    "awg3",
		NatAdded:  true,
	}
	data, _ := json.Marshal(snap)
	_ = os.WriteFile(cfg.PendingPath, data, 0600)
	_ = os.WriteFile(cfg.StatePath, []byte("AWG1_IF=\"awg3\"\n"), 0600)

	mgr := NewManagerWith(cfg, exec, prober)
	err := mgr.Recover(context.Background())
	if err != nil {
		t.Fatalf("recover failed: %v", err)
	}

	// State should be restored to awg1
	stateBytes, _ := os.ReadFile(cfg.StatePath)
	if !strings.Contains(string(stateBytes), "AWG1_IF=\"awg1\"") {
		t.Fatalf("expected state restored to awg1, got: %s", string(stateBytes))
	}
	// Pending file removed
	if _, err := os.Stat(cfg.PendingPath); !os.IsNotExist(err) {
		t.Fatal("pending file must be removed after recovery")
	}
}

func TestManager_ConcurrentLockRefused(t *testing.T) {
	cfg, exec, prober := setupTestEnvironment(t)

	// Manually hold flock
	f, err := os.OpenFile(cfg.LockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	mgr := NewManagerWith(cfg, exec, prober)
	err = mgr.Switch(context.Background(), "awg3")
	if err == nil || !strings.Contains(err.Error(), "другая операция") {
		t.Fatalf("expected error about concurrent operation, got: %v", err)
	}
}
