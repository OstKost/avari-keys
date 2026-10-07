package hysteria

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// HysteriaUser represents a managed user credentials and metadata.
type HysteriaUser struct {
	Name      string    `json:"name"`
	Password  string    `json:"password"`
	CreatedAt time.Time `json:"created_at"`
}

// Store manages persistence of Hysteria users and HTTP auth validation.
type Store struct {
	mu       sync.RWMutex
	filePath string
	server   string
	port     int
	users    map[string]HysteriaUser
}

func NewStore(filePath string, server string, port int) (*Store, error) {
	if server == "" {
		server = "s2.avari.dev"
	}
	if port <= 0 {
		port = 443
	}

	st := &Store{
		filePath: filePath,
		server:   server,
		port:     port,
		users:    make(map[string]HysteriaUser),
	}

	if err := st.load(); err != nil {
		// If file doesn't exist, ignore error but ensure dir exists
		if os.IsNotExist(err) {
			_ = os.MkdirAll(filepath.Dir(filePath), 0755)
		} else {
			return nil, err
		}
	}

	return st, nil
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return err
	}

	var list []HysteriaUser
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}

	s.users = make(map[string]HysteriaUser)
	for _, u := range list {
		s.users[u.Name] = u
	}
	return nil
}

func (s *Store) save() error {
	_ = os.MkdirAll(filepath.Dir(s.filePath), 0755)

	list := make([]HysteriaUser, 0, len(s.users))
	for _, u := range s.users {
		list = append(list, u)
	}

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.filePath, data, 0600)
}

// AddUser generates or sets credentials for a user and returns a ClientResponse.
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

		u = HysteriaUser{
			Name:      name,
			Password:  pwd,
			CreatedAt: time.Now().UTC(),
		}
		s.users[name] = u
		_ = s.save()
	}

	return s.buildResponse(u), nil
}

// GetUser retrieves an existing user and returns ClientResponse.
func (s *Store) GetUser(ctx context.Context, name string) (*models.ClientResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	u, exists := s.users[name]
	if !exists {
		return nil, fmt.Errorf("hysteria user %s not found", name)
	}

	return s.buildResponse(u), nil
}

// RemoveUser deletes a user from the store.
func (s *Store) RemoveUser(ctx context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.users[name]; !exists {
		return nil
	}

	delete(s.users, name)
	return s.save()
}

// ListUsers returns all registered Hysteria users.
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

// Authenticate verifies password for Hysteria 2 HTTP Auth API.
func (s *Store) Authenticate(auth string) (bool, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// In Hysteria 2, auth can be sent as password or user:password
	auth = strings.TrimSpace(auth)
	if auth == "" {
		return false, ""
	}

	for _, u := range s.users {
		if auth == u.Password || auth == fmt.Sprintf("%s:%s", u.Name, u.Password) {
			return true, u.Name
		}
	}
	return false, ""
}

func (s *Store) buildResponse(u HysteriaUser) *models.ClientResponse {
	// Format hysteria2 URI
	// hysteria2://password@s2.avari.dev:443/?sni=s2.avari.dev&insecure=0#u.Name
	uri := fmt.Sprintf("hysteria2://%s@%s:%d/?sni=%s&insecure=0#%s", u.Password, s.server, s.port, s.server, u.Name)

	configYAML := fmt.Sprintf(`server: %s:%d
auth: %s
tls:
  sni: %s
  insecure: false
bandwidth:
  up: 50 mbps
  down: 200 mbps
`, s.server, s.port, u.Password, s.server)

	return &models.ClientResponse{
		Name:      u.Name,
		Config:    configYAML,
		Protocol:  "hysteria2",
		VPNURI:    uri,
		CreatedAt: u.CreatedAt.Format(time.RFC3339),
	}
}
