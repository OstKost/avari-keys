package vless

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

const Path = "/etc/avari-vless/config.json"
const unit = "avari-vless.service"

type Client struct {
	Name string `json:"email"`
	UUID string `json:"id"`
	Flow string `json:"flow"`
}
type inbound struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Settings struct {
		Clients    []Client `json:"clients"`
		Decryption string   `json:"decryption"`
	} `json:"settings"`
	Stream struct {
		Network  string `json:"network"`
		Security string `json:"security"`
		Reality  struct {
			PrivateKey string   `json:"privateKey"`
			Names      []string `json:"serverNames"`
			IDs        []string `json:"shortIds"`
			Target     string   `json:"dest"`
		} `json:"realitySettings"`
	} `json:"streamSettings"`
}
type configuration struct {
	Inbounds  []inbound         `json:"inbounds"`
	Outbounds []json.RawMessage `json:"outbounds"`
}
type Store struct {
	mu   sync.Mutex
	Host string
	File string
	run  func(context.Context, string, ...string) error
}

func New(host string) *Store {
	return &Store{Host: host, File: Path, run: func(ctx context.Context, name string, args ...string) error {
		return exec.CommandContext(ctx, name, args...).Run()
	}}
}
func (s *Store) load() (*configuration, []byte, error) {
	raw, err := os.ReadFile(s.File)
	if err != nil {
		return nil, nil, err
	}
	var cfg configuration
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&cfg); err != nil || len(cfg.Inbounds) != 1 {
		return nil, nil, errors.New("invalid dedicated Xray configuration")
	}
	ib := cfg.Inbounds[0]
	reality := ib.Stream.Reality
	if ib.Protocol != "vless" || ib.Stream.Security != "reality" || len(reality.Names) == 0 || len(reality.IDs) == 0 {
		return nil, nil, errors.New("invalid Reality inbound")
	}
	return &cfg, raw, nil
}
func (s *Store) ready(ctx context.Context, port int) bool {
	if s.run(ctx, "systemctl", "is-active", "--quiet", unit) != nil {
		return false
	}
	dialer := net.Dialer{Timeout: time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
func (s *Store) Available(ctx context.Context) bool {
	if s == nil {
		return false
	}
	cfg, _, err := s.load()
	return err == nil && s.ready(ctx, cfg.Inbounds[0].Port)
}
func (s *Store) temp(raw []byte) (string, error) {
	file, err := os.CreateTemp(filepath.Dir(s.File), ".config-*.json")
	if err != nil {
		return "", err
	}
	_, err = file.Write(raw)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err = errors.Join(err, closeErr); err != nil {
		os.Remove(file.Name())
		return "", err
	}
	return file.Name(), nil
}
func (s *Store) apply(ctx context.Context, cfg *configuration, old []byte) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	candidate, err := s.temp(raw)
	if err != nil {
		return err
	}
	defer os.Remove(candidate)
	backup, err := s.temp(old)
	if err != nil {
		return err
	}
	defer os.Remove(backup)
	if err = s.run(ctx, "/usr/local/bin/xray", "run", "-test", "-c", candidate); err != nil {
		return errors.New("Xray rejected configuration")
	}
	if err = os.Rename(candidate, s.File); err != nil {
		return err
	}
	if s.restart(ctx, cfg.Inbounds[0].Port) == nil {
		return nil
	}
	rollback, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err = os.Rename(backup, s.File); err != nil {
		return fmt.Errorf("Xray rollback: %w", err)
	}
	return errors.Join(errors.New("Xray failed to activate configuration"), s.restart(rollback, cfg.Inbounds[0].Port))
}
func (s *Store) restart(ctx context.Context, port int) error {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if err := s.run(ctx, "systemctl", "restart", unit); err != nil {
		return err
	}
	for !s.ready(ctx, port) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil
}
func (s *Store) List() ([]models.ClientListItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, _, err := s.load()
	if err != nil {
		return nil, err
	}
	var result []models.ClientListItem
	for _, user := range cfg.Inbounds[0].Settings.Clients {
		result = append(result, models.ClientListItem{Name: user.Name, Status: "active"})
	}
	return result, nil
}
func (s *Store) Manage(ctx context.Context, method, name string) (*models.ClientResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, old, err := s.load()
	if err != nil {
		return nil, fmt.Errorf("read dedicated config: %v", err)
	}
	ib := &cfg.Inbounds[0]
	users := ib.Settings.Clients
	index := -1
	for pos, user := range users {
		if user.Name == name {
			index = pos
			break
		}
	}
	if method == "DELETE" {
		if index < 0 {
			return nil, nil
		}
		ib.Settings.Clients = append(users[:index], users[index+1:]...)
		return nil, s.apply(ctx, cfg, old)
	}
	fresh := index < 0
	if fresh {
		if method != "POST" {
			return nil, os.ErrNotExist
		}
		uuid, err := NewUUID()
		if err != nil {
			return nil, err
		}
		index = len(users)
		ib.Settings.Clients = append(users, Client{Name: name, UUID: uuid, Flow: "xtls-rprx-vision"})
	}
	reality := ib.Stream.Reality
	secret, err := base64.RawURLEncoding.DecodeString(reality.PrivateKey)
	if err != nil {
		return nil, errors.New("invalid Reality key")
	}
	key, err := ecdh.X25519().NewPrivateKey(secret)
	if err != nil {
		return nil, err
	}
	profile := Profile{Server: s.Host, Port: ib.Port, UUID: ib.Settings.Clients[index].UUID, PublicKey: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), SNI: reality.Names[0], ShortID: reality.IDs[0]}
	response, err := profile.Response(name)
	if err != nil {
		return nil, err
	}
	if fresh {
		err = s.apply(ctx, cfg, old)
	}
	return response, err
}
