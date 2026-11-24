package runner

import (
	"context"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// MockRunner is an in-memory implementation of AWGRunner for development and testing.
type MockRunner struct {
	mu           sync.RWMutex
	clients      map[string]*models.ClientResponse
	healthy      bool
	activeEgress string
}

// NewMockRunner creates a new instance of MockRunner.
func NewMockRunner(healthy bool) *MockRunner {
	return &MockRunner{
		clients:      make(map[string]*models.ClientResponse),
		healthy:      healthy,
		activeEgress: "awg1",
	}
}

func (m *MockRunner) CheckHealth(ctx context.Context) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.healthy
}

func (m *MockRunner) AddClient(ctx context.Context, name string, psk bool) (*models.ClientResponse, error) {
	if err := ValidateClientName(name); err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	pskLine := ""
	if psk {
		pskLine = "\nPresharedKey = aMockPresharedKeyForShadowrocket12345="
	}

	config := fmt.Sprintf(`[Interface]
Address = 10.7.0.%d/32
PrivateKey = aMockPrivateKeyForTestingPurposesOnly12345=
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 25
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyForTestingPurposes67890=%s
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`, len(m.clients)+3, pskLine)

	mockQR := fmt.Sprintf("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='black'/><text x='10' y='50' fill='white'>QR:%s</text></svg>", name)
	mockVPNURI := fmt.Sprintf("vpn://?payload=mockAmneziaVpnUriForClient_%s", name)
	mockVPNQR := fmt.Sprintf("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='#102833'/><text x='10' y='50' fill='#D9B96E'>VPN:%s</text></svg>", name)

	res := &models.ClientResponse{
		Name:      name,
		Config:    config,
		QRCode:    mockQR,
		VPNURI:    mockVPNURI,
		VPNQRCode: mockVPNQR,
		PublicKey: fmt.Sprintf("mockPubKey-%s", name),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	m.clients[name] = res
	return res, nil
}

func (m *MockRunner) RemoveClient(ctx context.Context, name string) error {
	if err := ValidateClientName(name); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.clients[name]; !exists {
		return fmt.Errorf("client '%s' not found", name)
	}
	delete(m.clients, name)
	return nil
}

func (m *MockRunner) GetClient(ctx context.Context, name string) (*models.ClientResponse, error) {
	if err := ValidateClientName(name); err != nil {
		return nil, err
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	res, exists := m.clients[name]
	if !exists {
		return nil, fmt.Errorf("client '%s' not found", name)
	}
	return res, nil
}

func (m *MockRunner) ListClients(ctx context.Context) ([]models.ClientListItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []models.ClientListItem
	for name := range m.clients {
		list = append(list, models.ClientListItem{
			Name:      name,
			CreatedAt: time.Now().UTC(),
			Status:    "active",
		})
	}
	return list, nil
}

func (m *MockRunner) GetStats(ctx context.Context) (*models.StatsSummaryResponse, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().Unix()
	peers := make(map[string]models.PeerStats)
	idx := 1
	var totalRx, totalTx int64
	for name := range m.clients {
		rx := int64(idx * 450 * 1024 * 1024)
		tx := int64(idx * 1200 * 1024 * 1024)
		totalRx += rx
		totalTx += tx
		handshakeEpoch := now - int64(idx*30) // online within last 30-90s
		peers[name] = models.PeerStats{
			ClientName:         name,
			PublicKey:          fmt.Sprintf("mockPubKey-%s", name),
			Interface:          "awg0",
			AllowedIPs:         fmt.Sprintf("10.7.0.%d/32", idx+1),
			LastHandshake:      fmt.Sprintf("%d сек назад", idx*30),
			LastHandshakeEpoch: handshakeEpoch,
			IsOnline:           true,
			RxBytes:            rx,
			TxBytes:            tx,
			MonthBytes:         rx + tx,
		}
		idx++
	}

	return &models.StatsSummaryResponse{
		ActivePeers: len(m.clients),
		Uptime:      "3d 12h 4m",
		TotalRx:     totalRx,
		TotalTx:     totalTx,
		Peers:       peers,
	}, nil
}

func (m *MockRunner) RestartAWG(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// simulate restart
	return nil
}

func (m *MockRunner) BackupAWG(ctx context.Context) (*models.BackupResponse, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	dummyContent := fmt.Sprintf("# Mock AWG Backup (%d clients)\nGenerated at: %s", len(m.clients), time.Now().Format(time.RFC3339))
	return &models.BackupResponse{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		BackupData: base64.StdEncoding.EncodeToString([]byte(dummyContent)),
	}, nil
}

func (m *MockRunner) RestoreAWG(ctx context.Context, backupData string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if backupData == "" {
		return fmt.Errorf("backup data is empty")
	}
	return nil
}

func (m *MockRunner) SwitchEgress(ctx context.Context, devName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if devName != "awg1" && devName != "awg3" {
		return fmt.Errorf("invalid egress interface '%s' (must be awg1 or awg3)", devName)
	}
	m.activeEgress = devName
	return nil
}

func (m *MockRunner) GetEgressStatus(ctx context.Context) (*models.EgressStatusResponse, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return &models.EgressStatusResponse{
		ActiveInterface:     m.activeEgress,
		AvailableInterfaces: []string{"awg1", "awg3"},
		Details:             fmt.Sprintf("Mock egress route dev in table 100 is %s", m.activeEgress),
	}, nil
}

func (m *MockRunner) RestartEgress(ctx context.Context, devName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if devName != "awg1" && devName != "awg3" {
		return fmt.Errorf("invalid egress interface '%s' (must be awg1 or awg3)", devName)
	}
	return nil
}

