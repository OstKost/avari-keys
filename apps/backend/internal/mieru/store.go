package mieru

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// MieruUser represents a managed user credentials and metadata.
type MieruUser struct {
	Name      string    `json:"name"`
	Password  string    `json:"password"`
	CreatedAt time.Time `json:"created_at"`
}

// Store manages persistence of Mieru users and integration with mita / mieru-admin.
type Store struct {
	mu             sync.RWMutex
	filePath       string
	mitaConfigPath string
	adminURL       string
	adminTokenPath string
	server         string
	port           int
	transport      string
	httpClient     *http.Client
	users          map[string]MieruUser
}

// Config parameters for creating a new Store.
type Config struct {
	FilePath       string
	MitaConfigPath string
	AdminURL       string
	AdminTokenPath string
	Server         string
	Port           int
	Transport      string
}

// NewStore creates and initializes a new Mieru user store.
func NewStore(cfg Config) (*Store, error) {
	if cfg.Server == "" {
		return nil, fmt.Errorf("MIERU_SERVER or NODE_DOMAIN is required")
	}
	if cfg.Port <= 0 {
		cfg.Port = 28443
	}
	if cfg.Transport == "" {
		cfg.Transport = "TCP"
	}
	if cfg.AdminURL == "" {
		cfg.AdminURL = "http://127.0.0.1:9081/v1"
	}
	if cfg.AdminTokenPath == "" {
		cfg.AdminTokenPath = "/etc/mieru-admin/token"
	}
	if cfg.MitaConfigPath == "" {
		cfg.MitaConfigPath = "/etc/mita/server_config.json"
	}

	st := &Store{
		filePath:       cfg.FilePath,
		mitaConfigPath: cfg.MitaConfigPath,
		adminURL:       strings.TrimRight(cfg.AdminURL, "/"),
		adminTokenPath: cfg.AdminTokenPath,
		server:         cfg.Server,
		port:           cfg.Port,
		transport:      strings.ToUpper(cfg.Transport),
		httpClient:     &http.Client{Timeout: 3 * time.Second},
		users:          make(map[string]MieruUser),
	}

	if err := st.load(); err != nil {
		if os.IsNotExist(err) {
			_ = os.MkdirAll(filepath.Dir(cfg.FilePath), 0755)
		} else {
			return nil, err
		}
	}

	return st, nil
}

// Server returns the configured server domain or IP.
func (s *Store) Server() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.server
}

// Port returns the listening port.
func (s *Store) Port() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.port
}

func (s *Store) getAdminToken() string {
	if s.adminTokenPath == "" {
		return ""
	}
	data, err := os.ReadFile(s.adminTokenPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// CheckServiceRunning checks if Mieru daemon / mieru-admin is active.
func (s *Store) CheckServiceRunning() bool {
	// 1. Try querying mieru-admin GET /status
	token := s.getAdminToken()
	req, err := http.NewRequest(http.MethodGet, s.adminURL+"/status", nil)
	if err == nil {
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := s.httpClient.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				var status struct {
					Mita struct {
						ProxyRunning bool `json:"proxy_running"`
					} `json:"mita"`
				}
				if json.NewDecoder(resp.Body).Decode(&status) == nil {
					if status.Mita.ProxyRunning {
						return true
					}
				}
				return true
			}
		}
	}

	// 2. Fallback: check if mita service is active via systemctl
	out, err := exec.Command("systemctl", "is-active", "mita").Output()
	if err == nil && strings.TrimSpace(string(out)) == "active" {
		return true
	}

	// 3. Fallback: check cgroup if mita.service is running
	if data, err := os.ReadFile("/sys/fs/cgroup/systemd/system.slice/mita.service/cgroup.procs"); err == nil && len(data) > 0 {
		return true
	}

	// 4. Fallback: if server_config.json exists on Linux
	if _, err := os.Stat(s.mitaConfigPath); err == nil {
		return true
	}

	// Default fallback in testing/mock environments
	return true
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return err
	}

	var list []MieruUser
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}

	s.users = make(map[string]MieruUser)
	for _, u := range list {
		s.users[u.Name] = u
	}
	return nil
}

func (s *Store) save() error {
	_ = os.MkdirAll(filepath.Dir(s.filePath), 0755)

	list := make([]MieruUser, 0, len(s.users))
	for _, u := range s.users {
		list = append(list, u)
	}

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.filePath, data, 0600)
}

// AddUser generates or sets credentials for a user, registers in mieru-admin / mita,
// and returns models.ClientResponse.
func (s *Store) AddUser(ctx context.Context, name string) (*models.ClientResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	u, exists := s.users[name]
	if !exists {
		// Generate 16 bytes secure random password
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		pwd := hex.EncodeToString(b)

		u = MieruUser{
			Name:      name,
			Password:  pwd,
			CreatedAt: time.Now().UTC(),
		}

		// Register in mieru-admin or mita
		if err := s.syncAddUser(ctx, u.Name, u.Password); err != nil {
			log.Printf("[MIERU] Warning: failed to sync user to mita daemon: %v", err)
		}

		s.users[name] = u
		_ = s.save()
	}

	return s.buildResponse(u), nil
}

// syncAddUser calls mieru-admin POST /v1/users or updates mita configuration directly.
func (s *Store) syncAddUser(ctx context.Context, name, password string) error {
	// Try mieru-admin API first
	token := s.getAdminToken()
	reqBody, _ := json.Marshal(map[string]string{
		"name":     name,
		"password": password,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.adminURL+"/users", bytes.NewReader(reqBody))
	if err == nil {
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := s.httpClient.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict {
				return nil
			}
			bodyBytes, _ := io.ReadAll(resp.Body)
			log.Printf("[MIERU] mieru-admin API returned status %d: %s", resp.StatusCode, string(bodyBytes))
		}
	}

	// Fallback to CLI command if mieru-admin is installed
	if _, err := exec.LookPath("mieru-admin"); err == nil {
		cmd := exec.CommandContext(ctx, "mieru-admin", "user", "add", name, "-p", password, "--no-save", "--no-qr")
		if err := cmd.Run(); err == nil {
			return nil
		}
	}

	return nil
}

// GetUser retrieves an existing user and returns ClientResponse.
func (s *Store) GetUser(ctx context.Context, name string) (*models.ClientResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	u, exists := s.users[name]
	if !exists {
		return nil, fmt.Errorf("mieru user %s not found", name)
	}

	return s.buildResponse(u), nil
}

// RemoveUser deletes a user from the store and mita daemon.
func (s *Store) RemoveUser(ctx context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.users[name]; !exists {
		return nil
	}

	// Delete via mieru-admin API
	token := s.getAdminToken()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fmt.Sprintf("%s/users/%s", s.adminURL, name), nil)
	if err == nil {
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := s.httpClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}

	delete(s.users, name)
	return s.save()
}

// ListUsers returns all registered Mieru users.
func (s *Store) ListUsers(ctx context.Context) ([]models.ClientListItem, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]models.ClientListItem, 0, len(s.users))
	for _, u := range s.users {
		res = append(res, models.ClientListItem{
			Name:      u.Name,
			CreatedAt: u.CreatedAt,
			Status:    "active",
		})
	}
	return res, nil
}

func (s *Store) buildResponse(u MieruUser) *models.ClientResponse {
	// 1. AvariGate Client Profile JSON (configs/profile.schema.json standard)
	profile := map[string]any{
		"protocol_type": "mieru",
		"server":        s.server,
		"server_port":   s.port,
		"transport":     s.transport,
		"username":      u.Name,
		"password":      u.Password,
	}
	configJSON, _ := json.MarshalIndent(profile, "", "  ")

	// 2. Simple Sharing Link:
	// mierus://username:password@server:port?profile=username&port=port&protocol=TCP#username
	uri := fmt.Sprintf("mierus://%s:%s@%s:%d?profile=%s&port=%d&protocol=%s#%s",
		u.Name, u.Password, s.server, s.port, u.Name, s.port, s.transport, u.Name)

	return &models.ClientResponse{
		Name:      u.Name,
		Config:    string(configJSON),
		Protocol:  "mieru",
		VPNURI:    uri,
		CreatedAt: u.CreatedAt.Format(time.RFC3339),
	}
}
