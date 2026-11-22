package egress

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// Snapshot preserves previous routing and NAT state for crash-safe rollback.
type Snapshot struct {
	Subnet    string              `json:"subnet"`
	Routes    map[string][]string `json:"routes"`
	Selection *string             `json:"selection"`
	Target    string              `json:"target"`
	NatAdded  bool                `json:"nat_added"`
}

// Manager controls cascade egress interface routing, health probing and switching.
type Manager struct {
	cfg    Config
	exec   CommandExecutor
	prober HTTPProber
}

// InterfaceHandshakeInfo holds parsed WireGuard tunnel handshake and traffic metrics.
type InterfaceHandshakeInfo struct {
	LatestHandshakeEpoch int64
	RxBytes              int64
	TxBytes              int64
	Found                bool
}

// CheckInterfaceDump queries awg/wg show dump for the interface to inspect session health.
func CheckInterfaceDump(ctx context.Context, exec CommandExecutor, iface string) InterfaceHandshakeInfo {
	if exec == nil || iface == "" {
		return InterfaceHandshakeInfo{}
	}
	for _, bin := range []string{"awg", "wg"} {
		out, err := exec.Run(ctx, bin, "show", iface, "dump")
		if err != nil || out == "" {
			continue
		}
		lines := strings.Split(out, "\n")
		for _, line := range lines {
			fields := strings.Fields(line)
			// Peer line in WireGuard dump:
			// 0: public_key, 1: preshared_key, 2: endpoint, 3: allowed_ips, 4: latest_handshake, 5: rx, 6: tx, 7: persistent_keepalive
			if len(fields) >= 8 {
				handshake, _ := strconv.ParseInt(fields[4], 10, 64)
				rx, _ := strconv.ParseInt(fields[5], 10, 64)
				tx, _ := strconv.ParseInt(fields[6], 10, 64)
				return InterfaceHandshakeInfo{
					LatestHandshakeEpoch: handshake,
					RxBytes:              rx,
					TxBytes:              tx,
					Found:                true,
				}
			}
		}
	}
	return InterfaceHandshakeInfo{}
}

// NewManager returns a new Manager with default config, OS executor, and HTTP prober.
func NewManager() *Manager {
	cfg := DefaultConfig()
	return NewManagerWith(cfg, &OSCommandExecutor{}, &DefaultHTTPProber{DoHURL: cfg.DoHURL})
}

// NewManagerWith initializes a Manager with custom components (useful for testing).
func NewManagerWith(cfg Config, exec CommandExecutor, prober HTTPProber) *Manager {
	return &Manager{
		cfg:    cfg,
		exec:   exec,
		prober: prober,
	}
}

// acquireLock locks the exclusive routing file lock.
func (m *Manager) acquireLock() (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(m.cfg.LockPath), 0700); err != nil {
		return nil, fmt.Errorf("create lock dir: %w", err)
	}

	f, err := os.OpenFile(m.cfg.LockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open lock file %q: %w", m.cfg.LockPath, err)
	}

	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("другая операция переключения уже выполняется: %w", err)
	}

	return f, nil
}

func (m *Manager) releaseLock(f *os.File) {
	if f != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}
}

// GetStatus checks all configured egress interfaces concurrently and returns their availability.
func (m *Manager) GetStatus(ctx context.Context) (*models.EgressStatusResponse, error) {
	entries, err := ReadRegistry(m.cfg.RegistryPath)
	if err != nil {
		return nil, err
	}

	current, _ := Active(ctx, m.exec)

	targets := make([]models.EgressTarget, len(entries))
	availIfaces := make([]string, len(entries))

	var wg sync.WaitGroup
	for i, entry := range entries {
		availIfaces[i] = entry.Interface
		wg.Add(1)
		go func(idx int, target TargetConfig) {
			defer wg.Done()
			report := RunTargetProbe(ctx, m.cfg, target, m.prober)
			dumpInfo := CheckInterfaceDump(ctx, m.exec, target.Interface)

			now := time.Now().Unix()
			isFrozen := false
			var handshakeAge int64
			var recommendation string

			if dumpInfo.Found {
				if dumpInfo.LatestHandshakeEpoch > 0 {
					handshakeAge = now - dumpInfo.LatestHandshakeEpoch
					if handshakeAge < 0 {
						handshakeAge = 0
					}
					// If handshake is older than 3 minutes (180s) and probe failed, or rx is 0 with tx > 0
					if (handshakeAge > 180 && !report.Available) || (dumpInfo.TxBytes > 0 && dumpInfo.RxBytes == 0) {
						isFrozen = true
						recommendation = fmt.Sprintf("Зависла сессия WireGuard (последний handshake %d мин назад). Рекомендуется перезапустить службу туннеля: systemctl restart awg-quick@%s", handshakeAge/60, target.Interface)
					}
				} else if dumpInfo.TxBytes > 0 && dumpInfo.RxBytes == 0 {
					isFrozen = true
					handshakeAge = -1
					recommendation = fmt.Sprintf("Сессия WireGuard не установила рукопожатие (0 B получено). Рекомендуется перезапустить службу туннеля: systemctl restart awg-quick@%s", target.Interface)
				}
			}

			t := models.EgressTarget{
				Interface:       target.Interface,
				Node:            target.Node,
				Label:           target.Label,
				Endpoint:        target.Endpoint,
				Available:       report.Available,
				Reason:          report.Reason,
				PassedChecks:    report.PassedChecks,
				TotalChecks:     report.TotalChecks,
				Checks:          report.Checks,
				HandshakeAgeSec: handshakeAge,
				IsFrozen:        isFrozen,
				Recommendation:  recommendation,
			}
			targets[idx] = t
		}(i, entry)
	}
	wg.Wait()

	details := "Активный маршрут не определён"
	if current != "" {
		details = "Фактический default таблицы 100"
	}

	return &models.EgressStatusResponse{
		ActiveInterface:     current,
		AvailableInterfaces: availIfaces,
		Targets:             targets,
		Details:             details,
	}, nil
}

// Switch switches the cascade egress default route and Telegram subnets to targetInterface.
func (m *Manager) Switch(ctx context.Context, targetInterface string) error {
	lock, err := m.acquireLock()
	if err != nil {
		return err
	}
	defer m.releaseLock(lock)

	// Crash recovery if previous transaction died unexpectedly
	if _, err := os.Stat(m.cfg.PendingPath); err == nil {
		_ = m.recoverInternal(ctx)
	}

	entries, err := ReadRegistry(m.cfg.RegistryPath)
	if err != nil {
		return err
	}

	var target *TargetConfig
	for i := range entries {
		if entries[i].Interface == targetInterface {
			target = &entries[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("выход %s отсутствует в конфигурации", targetInterface)
	}

	current, _ := Active(ctx, m.exec)
	if current == "" {
		return fmt.Errorf("текущий маршрут неизвестен; переключение отменено")
	}

	// Preflight health verification of the target interface
	if err := ProbeTarget(ctx, m.cfg, *target, m.prober); err != nil {
		// Attempt auto-recovery of frozen interface before aborting
		_, _ = m.exec.Run(ctx, "systemctl", "restart", "awg-quick@"+target.Interface)
		time.Sleep(1 * time.Second)
		if retryErr := ProbeTarget(ctx, m.cfg, *target, m.prober); retryErr != nil {
			return fmt.Errorf("предварительная проверка выхода %s не прошла: %w", target.Interface, retryErr)
		}
	}

	if current == target.Interface {
		// Already active, nothing to change
		return nil
	}

	routes, err := ReadCurrentRoutes(ctx, m.exec)
	if err != nil {
		return fmt.Errorf("read current routes: %w", err)
	}

	subnetBytes, err := os.ReadFile(m.cfg.SubnetPath)
	if err != nil {
		return fmt.Errorf("read subnet file %q: %w", m.cfg.SubnetPath, err)
	}
	subnet := strings.TrimSpace(string(subnetBytes))

	natExists := CheckNatRule(ctx, m.exec, subnet, target.Interface)

	var selection *string
	if stBytes, err := os.ReadFile(m.cfg.StatePath); err == nil {
		s := string(stBytes)
		selection = &s
	}

	snapshot := Snapshot{
		Subnet:    subnet,
		Routes:    routes,
		Selection: selection,
		Target:    target.Interface,
		NatAdded:  !natExists,
	}

	snapData, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}

	if err := AtomicWrite(m.cfg.PendingPath, snapData); err != nil {
		return fmt.Errorf("write pending snapshot: %w", err)
	}

	// Arm independent watchdog rollback via systemd timer
	timerUnit := fmt.Sprintf("avari-egress-rollback-%d", time.Now().UnixNano())
	_, _ = m.exec.Run(ctx, "systemd-run", "--quiet", "--unit="+timerUnit, "--on-active=60s", "--property=Restart=on-failure", "--property=RestartSec=5s", "/usr/local/bin/avari-slave", "recover")

	var switchErr error
	defer func() {
		// Disarm the rollback timer when done
		_, _ = m.exec.Raw(ctx, "systemctl", "stop", timerUnit+".timer")
	}()

	// 1. Add NAT MASQUERADE if not yet present
	if !natExists {
		if err := AddNatRule(ctx, m.exec, subnet, target.Interface); err != nil {
			switchErr = fmt.Errorf("add nat rule: %w", err)
			m.Rollback(ctx, snapshot)
			return switchErr
		}
	}

	// 2. Replace routing table entries
	if err := ApplyRoutes(ctx, m.exec, target.Interface); err != nil {
		switchErr = fmt.Errorf("apply routes: %w", err)
		m.Rollback(ctx, snapshot)
		return switchErr
	}

	// 3. Post-flight verification probe
	if err := ProbeTarget(ctx, m.cfg, *target, m.prober); err != nil {
		switchErr = fmt.Errorf("проверка связи после переключения не удалась: %w", err)
		m.Rollback(ctx, snapshot)
		return switchErr
	}

	// 4. Verify active route in table 100
	newActive, _ := Active(ctx, m.exec)
	if newActive != target.Interface {
		switchErr = fmt.Errorf("маршрут не применён: активен %q вместо %q", newActive, target.Interface)
		m.Rollback(ctx, snapshot)
		return switchErr
	}

	// 5. Commit state file atomically
	stateContent := fmt.Sprintf("AWG1_IF=%q\nAWG1_ENDPOINT=%q\n", target.Interface, target.Endpoint)
	if err := AtomicWrite(m.cfg.StatePath, []byte(stateContent)); err != nil {
		switchErr = fmt.Errorf("save state file: %w", err)
		m.Rollback(ctx, snapshot)
		return switchErr
	}

	_ = os.Remove(m.cfg.PendingPath)
	return nil
}

// Recover recovers pending snapshot transaction if exists (used on service startup or watchdog).
func (m *Manager) Recover(ctx context.Context) error {
	lock, err := m.acquireLock()
	if err != nil {
		return err
	}
	defer m.releaseLock(lock)

	return m.recoverInternal(ctx)
}

func (m *Manager) recoverInternal(ctx context.Context) error {
	data, err := os.ReadFile(m.cfg.PendingPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read pending file: %w", err)
	}

	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		_ = os.Remove(m.cfg.PendingPath)
		return fmt.Errorf("corrupt pending file: %w", err)
	}

	m.Rollback(ctx, snap)
	return nil
}

// Rollback restores routes, removes added NAT, restores selection and deletes pending file.
func (m *Manager) Rollback(ctx context.Context, snapshot Snapshot) {
	RollbackRoutes(ctx, m.exec, snapshot.Routes)

	if snapshot.Selection == nil {
		_ = os.Remove(m.cfg.StatePath)
	} else {
		_ = AtomicWrite(m.cfg.StatePath, []byte(*snapshot.Selection))
	}

	if snapshot.NatAdded && snapshot.Subnet != "" && snapshot.Target != "" {
		_ = DeleteNatRule(ctx, m.exec, snapshot.Subnet, snapshot.Target)
	}

	_ = os.Remove(m.cfg.PendingPath)
}
