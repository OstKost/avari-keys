package runner

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// RealRunner executes manage_amneziawg.sh via os/exec.
type RealRunner struct {
	scriptPath string
	configsDir string

	mu             sync.RWMutex
	lastHealthTime time.Time
	lastHealthVal  bool
}

// NewRealRunner creates a new RealRunner instance.
func NewRealRunner(scriptPath, configsDir string) *RealRunner {
	if scriptPath == "" {
		scriptPath = "/root/awg/manage_amneziawg.sh"
	}
	if configsDir == "" {
		configsDir = "/root/awg/clients"
	}
	return &RealRunner{
		scriptPath: scriptPath,
		configsDir: configsDir,
	}
}

// hasActiveAWGInterface quickly checks if an AmneziaWG / WireGuard network interface is UP.
func hasActiveAWGInterface() bool {
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, ifc := range ifaces {
			name := strings.ToLower(ifc.Name)
			if (strings.HasPrefix(name, "awg") || strings.HasPrefix(name, "wg") || strings.HasPrefix(name, "amnezia")) && (ifc.Flags&net.FlagUp != 0) {
				return true
			}
		}
	}
	// Fallback to /proc/net/dev on Linux
	if data, err := os.ReadFile("/proc/net/dev"); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "awg") || strings.HasPrefix(line, "wg") || strings.HasPrefix(line, "amnezia") {
				return true
			}
		}
	}
	return false
}

func (r *RealRunner) CheckHealth(ctx context.Context) bool {
	if _, err := os.Stat(r.scriptPath); err != nil {
		return false
	}

	// 1. Fast lightweight check (sub-millisecond, zero process spawn)
	if hasActiveAWGInterface() {
		r.mu.Lock()
		r.lastHealthVal = true
		r.lastHealthTime = time.Now()
		r.mu.Unlock()
		return true
	}

	// 2. If quick check didn't find active interface, check cached status with rate limit
	r.mu.RLock()
	if time.Since(r.lastHealthTime) < 15*time.Second {
		val := r.lastHealthVal
		r.mu.RUnlock()
		return val
	}
	r.mu.RUnlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check after acquiring write lock
	if time.Since(r.lastHealthTime) < 15*time.Second {
		return r.lastHealthVal
	}

	// 3. Fallback to full manage_amneziawg.sh status command if interface not active
	cmd := exec.CommandContext(ctx, "bash", r.scriptPath, "status")
	healthy := cmd.Run() == nil

	r.lastHealthVal = healthy
	r.lastHealthTime = time.Now()
	return healthy
}

func (r *RealRunner) AddClient(ctx context.Context, name string, psk bool) (*models.ClientResponse, error) {
	if err := ValidateClientName(name); err != nil {
		return nil, err
	}

	args := []string{r.scriptPath, "add", name, "--yes"}
	if psk {
		args = append(args, "--psk")
	}

	cmd := exec.CommandContext(ctx, "bash", args...)
	cmd.Dir = filepath.Dir(r.scriptPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("manage_amneziawg.sh add failed: %w (stderr: %s)", err, stderr.String())
	}

	return r.GetClient(ctx, name)
}

func (r *RealRunner) RemoveClient(ctx context.Context, name string) error {
	if err := ValidateClientName(name); err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "bash", r.scriptPath, "remove", name, "--yes")
	cmd.Dir = filepath.Dir(r.scriptPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("manage_amneziawg.sh remove failed: %w (stderr: %s)", err, stderr.String())
	}
	return nil
}

func (r *RealRunner) GetClient(ctx context.Context, name string) (*models.ClientResponse, error) {
	if err := ValidateClientName(name); err != nil {
		return nil, err
	}

	scriptDir := filepath.Dir(r.scriptPath)
	// 1. Candidate paths where manage_amneziawg.sh stores .conf files
	candidatePaths := []string{
		filepath.Join("/root/awg", fmt.Sprintf("%s.conf", name)),
		filepath.Join("/root/awg/clients", fmt.Sprintf("%s.conf", name)),
		filepath.Join(r.configsDir, fmt.Sprintf("%s.conf", name)),
		filepath.Join(scriptDir, fmt.Sprintf("%s.conf", name)),
		filepath.Join(scriptDir, "clients", fmt.Sprintf("%s.conf", name)),
		filepath.Join("/opt/avari-keys", fmt.Sprintf("%s.conf", name)),
		filepath.Join("/root", fmt.Sprintf("%s.conf", name)),
		filepath.Join("/etc/amnezia/amneziawg", fmt.Sprintf("%s.conf", name)),
		filepath.Join("/etc/amnezia/amneziawg/clients", fmt.Sprintf("%s.conf", name)),
	}

	var rawConfig string
	var foundPath string
	for _, p := range candidatePaths {
		if confBytes, err := os.ReadFile(p); err == nil && len(confBytes) > 0 {
			rawConfig = string(confBytes)
			foundPath = p
			break
		}
	}

	if foundPath == "" {
		return nil, fmt.Errorf("client configuration file '%s.conf' not found in standard directories (/root/awg, /root/awg/clients, /root, /etc/amnezia/amneziawg)", name)
	}

	cleanConfig := SanitizeAWGConfig(rawConfig)
	if cleanConfig == "" || !strings.Contains(cleanConfig, "[Interface]") || !strings.Contains(cleanConfig, "[Peer]") {
		return nil, fmt.Errorf("file '%s' does not contain a valid WireGuard/AmneziaWG configuration block ([Interface] and [Peer])", foundPath)
	}

	// 2. Read or generate QR code
	qrBase64 := ""
	candidateQRPatterns := []string{
		filepath.Join("/root/awg", fmt.Sprintf("%s.png", name)),
		filepath.Join("/root/awg/clients", fmt.Sprintf("%s.png", name)),
		filepath.Join(r.configsDir, fmt.Sprintf("%s.png", name)),
		filepath.Join(scriptDir, fmt.Sprintf("%s.png", name)),
		filepath.Join(scriptDir, "clients", fmt.Sprintf("%s.png", name)),
		filepath.Join("/opt/avari-keys", fmt.Sprintf("%s.png", name)),
		filepath.Join("/root", fmt.Sprintf("%s.png", name)),
	}
	for _, qp := range candidateQRPatterns {
		if qrBytes, qrErr := os.ReadFile(qp); qrErr == nil && len(qrBytes) > 0 {
			qrBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrBytes)
			break
		}
	}

	if qrBase64 == "" {
		// Try qrencode if available using the sanitized config
		qrCmd := exec.CommandContext(ctx, "qrencode", "-t", "PNG", "-o", "-", cleanConfig)
		var qrOut bytes.Buffer
		qrCmd.Stdout = &qrOut
		if qrCmd.Run() == nil && qrOut.Len() > 0 {
			qrBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrOut.Bytes())
		}
	}

	// 3. Read AmneziaVPN URI (.vpnuri) if available
	candidateVpnUriPaths := []string{
		filepath.Join("/root/awg", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join("/root/awg/clients", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join(r.configsDir, fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join(scriptDir, fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join(scriptDir, "clients", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join("/opt/avari-keys", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join("/root", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join("/etc/amnezia/amneziawg", fmt.Sprintf("%s.vpnuri", name)),
		filepath.Join("/etc/amnezia/amneziawg/clients", fmt.Sprintf("%s.vpnuri", name)),
	}

	var vpnURI string
	for _, vp := range candidateVpnUriPaths {
		if vpnBytes, err := os.ReadFile(vp); err == nil && len(vpnBytes) > 0 {
			vpnURI = strings.TrimSpace(string(vpnBytes))
			break
		}
	}

	// 4. Read AmneziaVPN QR code (.vpnuri.png) if available
	vpnQRBase64 := ""
	candidateVpnQRPatterns := []string{
		filepath.Join("/root/awg", fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join("/root/awg/clients", fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join(r.configsDir, fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join(scriptDir, fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join(scriptDir, "clients", fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join("/opt/avari-keys", fmt.Sprintf("%s.vpnuri.png", name)),
		filepath.Join("/root", fmt.Sprintf("%s.vpnuri.png", name)),
	}
	for _, vqp := range candidateVpnQRPatterns {
		if qrBytes, qrErr := os.ReadFile(vqp); qrErr == nil && len(qrBytes) > 0 {
			vpnQRBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrBytes)
			break
		}
	}

	if vpnQRBase64 == "" && vpnURI != "" {
		qrCmd := exec.CommandContext(ctx, "qrencode", "-t", "PNG", "-o", "-", vpnURI)
		var qrOut bytes.Buffer
		qrCmd.Stdout = &qrOut
		if qrCmd.Run() == nil && qrOut.Len() > 0 {
			vpnQRBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrOut.Bytes())
		}
	}

	var clientPubKey string
	for _, line := range strings.Split(cleanConfig, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "PrivateKey") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				if pk, err := derivePubKeyFromPrivateKey(strings.TrimSpace(parts[1])); err == nil {
					clientPubKey = pk
				}
			}
		}
	}

	return &models.ClientResponse{
		Name:      name,
		Config:    cleanConfig,
		QRCode:    qrBase64,
		VPNURI:    vpnURI,
		VPNQRCode: vpnQRBase64,
		PublicKey: clientPubKey,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (r *RealRunner) ListClients(ctx context.Context) ([]models.ClientListItem, error) {
	cmd := exec.CommandContext(ctx, "bash", r.scriptPath, "list")
	cmd.Dir = filepath.Dir(r.scriptPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("manage_amneziawg.sh list failed: %w (stderr: %s)", err, stderr.String())
	}

	lines := strings.Split(stdout.String(), "\n")
	var clients []models.ClientListItem
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "===") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) > 0 {
			clients = append(clients, models.ClientListItem{
				Name:      fields[0],
				CreatedAt: time.Now().UTC(),
				Status:    "active",
			})
		}
	}
	return clients, nil
}

func (r *RealRunner) GetStats(ctx context.Context) (*models.StatsSummaryResponse, error) {
	res := &models.StatsSummaryResponse{
		Peers: make(map[string]models.PeerStats),
	}

	// 1. Build Client Mappings from server configs & client config files (with Curve25519 pubkey derivation)
	pubkeyToName, ipToName, knownClients := r.buildClientMappings()

	// 2. Query AWG/WG dump data from system CLI
	dumpLines := r.fetchAWGDump(ctx)

	now := time.Now().Unix()
	var totalRx, totalTx int64
	activePeersCount := 0

	for _, line := range dumpLines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		tokens := strings.Split(trimmed, "\t")
		if len(tokens) < 8 {
			tokens = strings.Fields(trimmed)
		}

		var ifaceName string
		var pubkey, allowedIPs string
		var handshakeEpoch, rxBytes, txBytes int64

		if len(tokens) >= 9 {
			// Format: <iface> <pubkey> <psk> <endpoint> <allowed-ips> <handshake> <rx> <tx> <keepalive>
			ifaceName = tokens[0]
			pubkey = tokens[1]
			allowedIPs = tokens[4]
			handshakeEpoch, _ = strconv.ParseInt(tokens[5], 10, 64)
			rxBytes, _ = strconv.ParseInt(tokens[6], 10, 64)
			txBytes, _ = strconv.ParseInt(tokens[7], 10, 64)
		} else if len(tokens) >= 8 {
			// Format: <pubkey> <psk> <endpoint> <allowed-ips> <handshake> <rx> <tx> <keepalive>
			ifaceName = "awg0"
			pubkey = tokens[0]
			allowedIPs = tokens[3]
			handshakeEpoch, _ = strconv.ParseInt(tokens[4], 10, 64)
			rxBytes, _ = strconv.ParseInt(tokens[5], 10, 64)
			txBytes, _ = strconv.ParseInt(tokens[6], 10, 64)
		} else {
			continue
		}

		// Find client name
		clientName := ""
		if name, ok := pubkeyToName[pubkey]; ok && name != "" {
			clientName = name
		} else {
			// Try by allowed IPs (e.g. 10.7.0.2/32 -> 10.7.0.2)
			ipList := strings.Split(allowedIPs, ",")
			for _, ip := range ipList {
				cleanIP := strings.TrimSpace(strings.Split(ip, "/")[0])
				if name, ok := ipToName[cleanIP]; ok && name != "" {
					clientName = name
					break
				}
			}
		}

		if clientName == "" {
			// Generate clean fallback name
			cleanIP := strings.TrimSpace(strings.Split(allowedIPs, "/")[0])
			cleanIP = strings.ReplaceAll(cleanIP, ".", "_")
			if cleanIP != "" && cleanIP != "(none)" {
				clientName = fmt.Sprintf("peer_%s", cleanIP)
			} else if len(pubkey) >= 8 {
				clientName = fmt.Sprintf("peer_%s", pubkey[:8])
			} else {
				clientName = "unknown_peer"
			}
		}

		// Calculate handshake diff and online status (within 3 minutes / 180s)
		isOnline := false
		var lastHandshake string
		if handshakeEpoch <= 0 {
			lastHandshake = "Никогда"
		} else {
			diff := now - handshakeEpoch
			if diff < 0 {
				diff = 0
			}
			isOnline = (diff <= 180)

			if diff <= 10 {
				lastHandshake = "только что"
			} else if diff < 60 {
				lastHandshake = fmt.Sprintf("%d сек назад", diff)
			} else if diff < 3600 {
				lastHandshake = fmt.Sprintf("%d мин назад", diff/60)
			} else if diff < 86400 {
				lastHandshake = fmt.Sprintf("%d ч назад", diff/3600)
			} else {
				lastHandshake = fmt.Sprintf("%d дн назад", diff/86400)
			}
		}

		if isOnline {
			activePeersCount++
		}

		totalRx += rxBytes
		totalTx += txBytes

		res.Peers[clientName] = models.PeerStats{
			ClientName:         clientName,
			PublicKey:          pubkey,
			Interface:          ifaceName,
			AllowedIPs:         allowedIPs,
			LastHandshake:      lastHandshake,
			LastHandshakeEpoch: handshakeEpoch,
			IsOnline:           isOnline,
			RxBytes:            rxBytes,
			TxBytes:            txBytes,
			MonthBytes:         rxBytes + txBytes,
		}
	}

	// 3. Include any configured clients that haven't performed a handshake yet
	for name := range knownClients {
		if _, exists := res.Peers[name]; !exists {
			res.Peers[name] = models.PeerStats{
				ClientName:         name,
				LastHandshake:      "Никогда",
				LastHandshakeEpoch: 0,
				IsOnline:           false,
				RxBytes:            0,
				TxBytes:            0,
				MonthBytes:         0,
			}
		}
	}

	// 4. Fallback if CLI dump was completely unavailable: try manage_amneziawg.sh stats --json
	if len(res.Peers) == 0 {
		cmd := exec.CommandContext(ctx, "bash", r.scriptPath, "stats", "--json")
		cmd.Dir = filepath.Dir(r.scriptPath)
		var stdout bytes.Buffer
		cmd.Stdout = &stdout
		if cmd.Run() == nil && stdout.Len() > 0 {
			_ = json.Unmarshal(stdout.Bytes(), res)
			return res, nil
		}
	}

	// 5. If peer stats total is 0, attempt interface-level counter fallback from /proc/net/dev
	if totalRx+totalTx == 0 {
		if devRx, devTx, devErr := r.readProcNetDevStats(); devErr == nil && devRx+devTx > 0 {
			totalRx = devRx
			totalTx = devTx
		}
	}

	res.ActivePeers = activePeersCount
	res.TotalRx = totalRx
	res.TotalTx = totalTx
	res.Uptime = "online"

	return res, nil
}

// readProcNetDevStats reads aggregate RX/TX bytes for awg/wg interfaces from /proc/net/dev.
func (r *RealRunner) readProcNetDevStats() (int64, int64, error) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()

	var totalRx, totalTx int64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		iface := strings.TrimSpace(parts[0])
		if !strings.HasPrefix(iface, "awg") && !strings.HasPrefix(iface, "wg") && !strings.HasPrefix(iface, "amnezia") {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) >= 9 {
			rx, _ := strconv.ParseInt(fields[0], 10, 64)
			tx, _ := strconv.ParseInt(fields[8], 10, 64)
			totalRx += rx
			totalTx += tx
		}
	}
	return totalRx, totalTx, nil
}

// findAWGBinaries locates available awg / wg executables.
func findAWGBinaries() []string {
	candidates := []string{
		"awg",
		"/usr/bin/awg",
		"/usr/local/bin/awg",
		"/usr/sbin/awg",
		"/bin/awg",
		"wg",
		"/usr/bin/wg",
		"/usr/local/bin/wg",
		"/usr/sbin/wg",
		"/bin/wg",
	}
	var existing []string
	seen := make(map[string]bool)
	for _, c := range candidates {
		path := c
		if !filepath.IsAbs(c) {
			if looked, err := exec.LookPath(c); err == nil {
				path = looked
			} else {
				continue
			}
		} else {
			if _, err := os.Stat(path); err != nil {
				continue
			}
		}
		if !seen[path] {
			seen[path] = true
			existing = append(existing, path)
		}
	}
	return existing
}

// fetchAWGDump queries awg/wg dump command for all active interfaces.
func (r *RealRunner) fetchAWGDump(ctx context.Context) []string {
	binaries := findAWGBinaries()
	if len(binaries) == 0 {
		binaries = []string{"awg", "wg"}
	}

	// Detect candidate interfaces dynamically
	interfaces := []string{"all", "awg0", "awg1", "awg2", "awg3", "wg0"}
	if ifaces, err := net.Interfaces(); err == nil {
		for _, ifc := range ifaces {
			name := strings.ToLower(ifc.Name)
			if strings.HasPrefix(name, "awg") || strings.HasPrefix(name, "wg") || strings.HasPrefix(name, "amnezia") {
				interfaces = append(interfaces, ifc.Name)
			}
		}
	}

	var allLines []string
	seenPubkeys := make(map[string]bool)

	for _, bin := range binaries {
		// First try 'show all dump'
		cmdAll := exec.CommandContext(ctx, bin, "show", "all", "dump")
		var outAll bytes.Buffer
		cmdAll.Stdout = &outAll
		if cmdAll.Run() == nil && outAll.Len() > 0 {
			scanner := bufio.NewScanner(&outAll)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				tokens := strings.Split(line, "\t")
				if len(tokens) < 8 {
					tokens = strings.Fields(line)
				}
				if len(tokens) >= 8 {
					pubkey := tokens[0]
					if len(tokens) >= 9 {
						pubkey = tokens[1]
					}
					if !seenPubkeys[pubkey] {
						seenPubkeys[pubkey] = true
						allLines = append(allLines, line)
					}
				}
			}
		}

		// Also try explicit interface dump
		for _, iface := range interfaces {
			if iface == "all" {
				continue
			}
			cmd := exec.CommandContext(ctx, bin, "show", iface, "dump")
			var out bytes.Buffer
			cmd.Stdout = &out
			if cmd.Run() == nil && out.Len() > 0 {
				scanner := bufio.NewScanner(&out)
				for scanner.Scan() {
					line := strings.TrimSpace(scanner.Text())
					if line == "" {
						continue
					}
					tokens := strings.Split(line, "\t")
					if len(tokens) < 8 {
						tokens = strings.Fields(line)
					}
					if len(tokens) >= 8 {
						pubkey := tokens[0]
						if len(tokens) >= 9 {
							pubkey = tokens[1]
						}
						if !seenPubkeys[pubkey] {
							seenPubkeys[pubkey] = true
							allLines = append(allLines, line)
						}
					}
				}
			}
		}
	}

	return allLines
}

// derivePubKeyFromPrivateKey computes Curve25519 public key in Base64 from private key Base64.
func derivePubKeyFromPrivateKey(privKeyBase64 string) (string, error) {
	privBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(privKeyBase64))
	if err != nil {
		return "", err
	}
	if len(privBytes) != 32 {
		return "", fmt.Errorf("invalid private key length: %d bytes (expected 32)", len(privBytes))
	}
	privKey, err := ecdh.X25519().NewPrivateKey(privBytes)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(privKey.PublicKey().Bytes()), nil
}

// buildClientMappings builds pubkey -> clientName and IP -> clientName mappings from server and client configs.
func (r *RealRunner) buildClientMappings() (map[string]string, map[string]string, map[string]bool) {
	pubkeyToName := make(map[string]string)
	ipToName := make(map[string]string)
	knownClients := make(map[string]bool)

	scriptDir := filepath.Dir(r.scriptPath)

	// 1. Scan client config files first (direct Curve25519 derivation from PrivateKey)
	clientDirs := []string{
		"/root/awg/clients",
		"/root/awg",
		"/etc/amnezia/amneziawg/clients",
		"/etc/amnezia/amneziawg",
		"/opt/avari-keys/clients",
		r.configsDir,
		filepath.Join(scriptDir, "clients"),
		scriptDir,
	}

	for _, dir := range clientDirs {
		matches, err := filepath.Glob(filepath.Join(dir, "*.conf"))
		if err != nil {
			continue
		}
		for _, confPath := range matches {
			base := filepath.Base(confPath)
			if strings.HasPrefix(base, "awg") || strings.HasPrefix(base, "wg") {
				// Server interface config, skip in client scan
				continue
			}
			clientName := strings.TrimSuffix(base, ".conf")
			knownClients[clientName] = true

			f, err := os.Open(confPath)
			if err != nil {
				continue
			}
			scanner := bufio.NewScanner(f)
			var inInterface bool
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.EqualFold(line, "[Interface]") {
					inInterface = true
				} else if strings.HasPrefix(line, "[") {
					inInterface = false
				}

				if inInterface && strings.HasPrefix(line, "PrivateKey") {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						privKey := strings.TrimSpace(parts[1])
						if pubKey, err := derivePubKeyFromPrivateKey(privKey); err == nil && pubKey != "" {
							pubkeyToName[pubKey] = clientName
						}
					}
				} else if strings.HasPrefix(line, "Address") {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						ips := strings.Split(parts[1], ",")
						for _, ip := range ips {
							clean := strings.TrimSpace(strings.Split(strings.TrimSpace(ip), "/")[0])
							if clean != "" {
								ipToName[clean] = clientName
							}
						}
					}
				}
			}
			_ = f.Close()
		}
	}

	// 2. Scan server config files (awg0.conf, awg1.conf, etc.)
	serverConfDirs := []string{
		"/etc/amnezia/amneziawg",
		"/etc/wireguard",
		"/root/awg",
		"/root/awg2",
		"/opt/avari-keys",
		scriptDir,
	}

	for _, dir := range serverConfDirs {
		matches, err := filepath.Glob(filepath.Join(dir, "*.conf"))
		if err != nil {
			continue
		}
		for _, confPath := range matches {
			if strings.Contains(confPath, "/clients/") {
				continue
			}
			f, err := os.Open(confPath)
			if err != nil {
				continue
			}
			scanner := bufio.NewScanner(f)
			var currentClient string
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "### Client") || strings.HasPrefix(line, "# Client") ||
					strings.HasPrefix(line, "### client") || strings.HasPrefix(line, "# client") ||
					strings.HasPrefix(line, "### BEGIN_PEER") || strings.HasPrefix(line, "# BEGIN_PEER") {
					cleaned := strings.TrimLeft(line, "# ")
					cleaned = strings.TrimPrefix(cleaned, "Client")
					cleaned = strings.TrimPrefix(cleaned, "client")
					cleaned = strings.TrimPrefix(cleaned, "BEGIN_PEER")
					cleaned = strings.TrimPrefix(cleaned, ":")
					cleaned = strings.TrimPrefix(cleaned, "=")
					currentClient = strings.TrimSpace(cleaned)
					if currentClient != "" {
						knownClients[currentClient] = true
					}
				} else if strings.HasPrefix(line, "[Peer]") {
					// Check inline peer comment if any: [Peer] # client_name
					if idx := strings.Index(line, "#"); idx != -1 {
						candidate := strings.TrimSpace(line[idx+1:])
						if candidate != "" {
							currentClient = candidate
							knownClients[currentClient] = true
						}
					}
				} else if strings.HasPrefix(line, "PublicKey") && currentClient != "" {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						pubkey := strings.TrimSpace(parts[1])
						pubkeyToName[pubkey] = currentClient
					}
				} else if strings.HasPrefix(line, "AllowedIPs") && currentClient != "" {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						ips := strings.Split(parts[1], ",")
						for _, ip := range ips {
							clean := strings.TrimSpace(strings.Split(strings.TrimSpace(ip), "/")[0])
							if clean != "" {
								ipToName[clean] = currentClient
							}
						}
					}
				} else if line == "[Interface]" {
					currentClient = ""
				}
			}
			_ = f.Close()
		}
	}

	return pubkeyToName, ipToName, knownClients
}

func (r *RealRunner) RestartAWG(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "systemctl", "restart", "awg-quick@awg0")
	if err := cmd.Run(); err != nil {
		// Fallback: try restart via manage_amneziawg.sh if script supports it
		cmd2 := exec.CommandContext(ctx, "bash", r.scriptPath, "restart")
		if err2 := cmd2.Run(); err2 != nil {
			return fmt.Errorf("failed to restart AWG service: %w", err)
		}
	}
	return nil
}

func (r *RealRunner) BackupAWG(ctx context.Context) (*models.BackupResponse, error) {
	// Create tar.gz of configsDir
	tarCmd := exec.CommandContext(ctx, "tar", "-czf", "-", "-C", filepath.Dir(r.configsDir), filepath.Base(r.configsDir))
	var out bytes.Buffer
	tarCmd.Stdout = &out
	if err := tarCmd.Run(); err != nil {
		return nil, fmt.Errorf("backup failed: %w", err)
	}

	return &models.BackupResponse{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		BackupData: base64.StdEncoding.EncodeToString(out.Bytes()),
	}, nil
}

func (r *RealRunner) RestoreAWG(ctx context.Context, backupData string) error {
	dataBytes, err := base64.StdEncoding.DecodeString(backupData)
	if err != nil {
		return fmt.Errorf("invalid backup base64 data: %w", err)
	}

	tarCmd := exec.CommandContext(ctx, "tar", "-xzf", "-", "-C", filepath.Dir(r.configsDir))
	tarCmd.Stdin = bytes.NewReader(dataBytes)
	if err := tarCmd.Run(); err != nil {
		return fmt.Errorf("restore failed: %w", err)
	}

	return nil
}

// SwitchEgress delegates the allowlisted, persistent transaction to a root-owned helper.
func (r *RealRunner) SwitchEgress(ctx context.Context, devName string) error {
	if !regexp.MustCompile(`^awg[1-9][0-9]*$`).MatchString(devName) {
		return fmt.Errorf("invalid egress interface %q", devName)
	}
	output, err := exec.CommandContext(ctx, "/usr/local/libexec/avari-egress", "switch", devName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("egress switch failed: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}

func (r *RealRunner) GetEgressStatus(ctx context.Context) (*models.EgressStatusResponse, error) {
	output, err := exec.CommandContext(ctx, "/usr/local/libexec/avari-egress", "status").Output()
	if err != nil {
		return nil, fmt.Errorf("egress status failed: %w", err)
	}
	var status models.EgressStatusResponse
	if err := json.Unmarshal(output, &status); err != nil {
		return nil, fmt.Errorf("invalid egress status: %w", err)
	}
	return &status, nil
}
