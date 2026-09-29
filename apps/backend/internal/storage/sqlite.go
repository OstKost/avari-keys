package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

// Storage wraps the SQLite database.
type Storage struct {
	db *sql.DB
}

// NewSQLiteStorage initializes the SQLite database at dbPath and runs migrations.
func NewSQLiteStorage(dbPath string) (*Storage, error) {
	if dbPath == "" {
		dbPath = "./data/avari-master.db"
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory %s: %w", dir, err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Pragmas for performance and concurrency
	if _, err := db.Exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA foreign_keys=ON;
		PRAGMA busy_timeout=5000;
	`); err != nil {
		return nil, fmt.Errorf("failed to set sqlite pragmas: %w", err)
	}

	s := &Storage{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	if err := s.ensureAdminUser(); err != nil {
		return nil, fmt.Errorf("failed to ensure admin user: %w", err)
	}

	return s, nil
}

func (s *Storage) Close() error {
	return s.db.Close()
}

func (s *Storage) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user',
		is_active INTEGER NOT NULL DEFAULT 0,
		billing_snoozed_until DATETIME DEFAULT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS nodes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL, -- 'cascade' or 'direct'
		country_code TEXT NOT NULL DEFAULT '',
		provider_url TEXT NOT NULL DEFAULT '',
		api_url TEXT NOT NULL,
		api_key TEXT NOT NULL,
		is_mobile_optimized INTEGER NOT NULL DEFAULT 0,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS client_configs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		node_id INTEGER NOT NULL,
		client_name TEXT NOT NULL,
		device_name TEXT NOT NULL,
		public_key TEXT NOT NULL DEFAULT '',
		allocated_ip TEXT NOT NULL DEFAULT '',
		total_rx_bytes INTEGER NOT NULL DEFAULT 0,
		total_tx_bytes INTEGER NOT NULL DEFAULT 0,
		last_handshake_epoch INTEGER NOT NULL DEFAULT 0,
		last_seen_at DATETIME DEFAULT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS peer_traffic_daily (
		date TEXT NOT NULL, -- 'YYYY-MM-DD'
		client_config_id INTEGER NOT NULL,
		rx_bytes INTEGER NOT NULL DEFAULT 0,
		tx_bytes INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (date, client_config_id),
		FOREIGN KEY (client_config_id) REFERENCES client_configs(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS node_traffic_daily (
		date TEXT NOT NULL, -- 'YYYY-MM-DD'
		node_id INTEGER NOT NULL,
		rx_bytes INTEGER NOT NULL DEFAULT 0,
		tx_bytes INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (date, node_id),
		FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		username TEXT NOT NULL,
		action TEXT NOT NULL,
		category TEXT NOT NULL,
		ip_address TEXT,
		details TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
	);

	CREATE TABLE IF NOT EXISTS billing_records (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		username TEXT NOT NULL,
		amount REAL NOT NULL DEFAULT 0,
		currency TEXT NOT NULL DEFAULT 'RUB',
		period_month TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'confirmed',
		note TEXT NOT NULL DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS telegram_chats (
		chat_id INTEGER PRIMARY KEY,
		username TEXT NOT NULL DEFAULT '',
		first_name TEXT NOT NULL DEFAULT '',
		is_admin INTEGER NOT NULL DEFAULT 1,
		alerts_enabled INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS telegram_link_tokens (
		token TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS announcements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT 'general',
		is_pinned INTEGER NOT NULL DEFAULT 0,
		author_name TEXT NOT NULL DEFAULT 'Admin',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Migrate existing nodes & users tables if new columns are missing
	_, _ = s.db.Exec(`ALTER TABLE nodes ADD COLUMN is_mobile_optimized INTEGER NOT NULL DEFAULT 0;`)
	_, _ = s.db.Exec(`ALTER TABLE nodes ADD COLUMN country_code TEXT NOT NULL DEFAULT '';`)
	_, _ = s.db.Exec(`ALTER TABLE nodes ADD COLUMN provider_url TEXT NOT NULL DEFAULT '';`)
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN billing_snoozed_until DATETIME DEFAULT NULL;`)
	_, _ = s.db.Exec(`ALTER TABLE telegram_chats ADD COLUMN user_id INTEGER DEFAULT NULL;`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN public_key TEXT NOT NULL DEFAULT '';`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN allocated_ip TEXT NOT NULL DEFAULT '';`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN total_rx_bytes INTEGER NOT NULL DEFAULT 0;`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN total_tx_bytes INTEGER NOT NULL DEFAULT 0;`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN last_handshake_epoch INTEGER NOT NULL DEFAULT 0;`)
	_, _ = s.db.Exec(`ALTER TABLE client_configs ADD COLUMN last_seen_at DATETIME DEFAULT NULL;`)

	indexes := `
	CREATE INDEX IF NOT EXISTS idx_client_configs_pubkey ON client_configs(public_key);
	CREATE INDEX IF NOT EXISTS idx_client_configs_node_id ON client_configs(node_id);
	CREATE INDEX IF NOT EXISTS idx_peer_traffic_daily_date ON peer_traffic_daily(date);
	CREATE INDEX IF NOT EXISTS idx_node_traffic_daily_date ON node_traffic_daily(date);
	CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
	CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
	CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
	CREATE INDEX IF NOT EXISTS idx_billing_records_user_id ON billing_records(user_id);
	CREATE INDEX IF NOT EXISTS idx_billing_records_created_at ON billing_records(created_at);
	CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user_id ON telegram_link_tokens(user_id);
	CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at);
	CREATE INDEX IF NOT EXISTS idx_announcements_is_pinned ON announcements(is_pinned);
	`
	if _, err := s.db.Exec(indexes); err != nil {
		return err
	}
	return nil
}

func (s *Storage) ensureAdminUser() error {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count)
	if err != nil {
		return err
	}

	if count > 0 {
		return nil
	}

	adminUsername := os.Getenv("ADMIN_USER")
	if adminUsername == "" {
		adminUsername = "Forve"
	}

	adminPassword := os.Getenv("ADMIN_PASSWORD")
	if adminPassword == "" {
		adminPassword = generateRandomPassword(16)
		log.Printf("\n======================================================\n"+
			"[MASTER AUTH] Default Admin Account Created!\n"+
			"Username: %s\n"+
			"Password: %s\n"+
			"Save this password in a secure place.\n"+
			"======================================================\n", adminUsername, adminPassword)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash admin password: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO users (username, password_hash, role, is_active)
		VALUES (?, ?, ?, 1)
	`, adminUsername, string(hash), string(models.RoleAdmin))

	return err
}

func generateRandomPassword(length int) string {
	const charset = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"
	res := make([]byte, length)
	for i := range res {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		res[i] = charset[n.Int64()]
	}
	return string(res)
}

// User methods
func (s *Storage) CreateUser(ctx context.Context, username, password string) (*models.User, error) {
	username = strings.TrimSpace(username)
	if len(username) < 3 {
		return nil, errors.New("username must be at least 3 characters")
	}
	if len(password) < 6 {
		return nil, errors.New("password must be at least 6 characters")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO users (username, password_hash, role, is_active)
		VALUES (?, ?, 'user', 0)
	`, username, string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, errors.New("username already exists")
		}
		return nil, err
	}

	id, _ := res.LastInsertId()
	return s.GetUserByID(ctx, id)
}

func (s *Storage) GetUserByID(ctx context.Context, id int64) (*models.User, error) {
	var u models.User
	var role string
	var isActive int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, username, password_hash, role, is_active, created_at
		FROM users WHERE id = ?
	`, id).Scan(&u.ID, &u.Username, &u.PasswordHash, &role, &isActive, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.Role = models.Role(role)
	u.IsActive = isActive == 1
	return &u, nil
}

func (s *Storage) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	var role string
	var isActive int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, username, password_hash, role, is_active, created_at
		FROM users WHERE username = ?
	`, strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.PasswordHash, &role, &isActive, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.Role = models.Role(role)
	u.IsActive = isActive == 1
	return &u, nil
}

func (s *Storage) ListUsers(ctx context.Context) ([]models.UserPublic, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, username, role, is_active, created_at
		FROM users ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []models.UserPublic{}
	for rows.Next() {
		var u models.UserPublic
		var role string
		var isActive int
		if err := rows.Scan(&u.ID, &u.Username, &role, &isActive, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Role = models.Role(role)
		u.IsActive = isActive == 1
		list = append(list, u)
	}
	return list, nil
}

func (s *Storage) SetUserActive(ctx context.Context, id int64, active bool) error {
	isActiveVal := 0
	if active {
		isActiveVal = 1
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET is_active = ? WHERE id = ?`, isActiveVal, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("user not found")
	}
	return nil
}

func (s *Storage) SetUserRole(ctx context.Context, id int64, role models.Role) error {
	if role != models.RoleAdmin && role != models.RoleUser {
		return errors.New("invalid role")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, string(role), id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("user not found")
	}
	return nil
}

func (s *Storage) UpdateUserProfile(ctx context.Context, id int64, username, password string) (*models.User, error) {
	u, err := s.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}

	username = strings.TrimSpace(username)
	if username != "" {
		if len(username) < 3 {
			return nil, errors.New("username must be at least 3 characters")
		}
		u.Username = username
	}

	if strings.TrimSpace(password) != "" {
		if len(password) < 6 {
			return nil, errors.New("password must be at least 6 characters")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		u.PasswordHash = string(hash)
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE users SET username = ?, password_hash = ? WHERE id = ?
	`, u.Username, u.PasswordHash, id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, errors.New("username already exists")
		}
		return nil, err
	}

	return u, nil
}

func (s *Storage) DeleteUser(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("user not found")
	}
	return nil
}


// Node methods
func (s *Storage) CreateNode(ctx context.Context, name, nodeType, countryCode, providerURL, apiURL, apiKey string, isMobileOptimized bool) (*models.Node, error) {
	isMobileVal := 0
	if isMobileOptimized {
		isMobileVal = 1
	}
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO nodes (name, type, country_code, provider_url, api_url, api_key, is_mobile_optimized, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1)
	`, strings.TrimSpace(name), strings.TrimSpace(nodeType), strings.ToUpper(strings.TrimSpace(countryCode)), strings.TrimSpace(providerURL), strings.TrimSpace(apiURL), strings.TrimSpace(apiKey), isMobileVal)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetNodeByID(ctx, id)
}

func (s *Storage) UpdateNode(ctx context.Context, id int64, name, nodeType, countryCode, providerURL, apiURL, apiKey string, isMobileOptimized bool) (*models.Node, error) {
	isMobileVal := 0
	if isMobileOptimized {
		isMobileVal = 1
	}

	name = strings.TrimSpace(name)
	nodeType = strings.TrimSpace(nodeType)
	countryCode = strings.ToUpper(strings.TrimSpace(countryCode))
	providerURL = strings.TrimSpace(providerURL)
	apiURL = strings.TrimSpace(apiURL)
	apiKey = strings.TrimSpace(apiKey)

	var err error
	if apiKey != "" {
		_, err = s.db.ExecContext(ctx, `
			UPDATE nodes
			SET name = ?, type = ?, country_code = ?, provider_url = ?, api_url = ?, api_key = ?, is_mobile_optimized = ?
			WHERE id = ?
		`, name, nodeType, countryCode, providerURL, apiURL, apiKey, isMobileVal, id)
	} else {
		_, err = s.db.ExecContext(ctx, `
			UPDATE nodes
			SET name = ?, type = ?, country_code = ?, provider_url = ?, api_url = ?, is_mobile_optimized = ?
			WHERE id = ?
		`, name, nodeType, countryCode, providerURL, apiURL, isMobileVal, id)
	}

	if err != nil {
		return nil, err
	}
	return s.GetNodeByID(ctx, id)
}

func (s *Storage) GetNodeByID(ctx context.Context, id int64) (*models.Node, error) {
	var n models.Node
	var isActive, isMobile int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, type, country_code, provider_url, api_url, api_key, is_mobile_optimized, is_active, created_at
		FROM nodes WHERE id = ?
	`, id).Scan(&n.ID, &n.Name, &n.Type, &n.CountryCode, &n.ProviderURL, &n.APIURL, &n.APIKey, &isMobile, &isActive, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	n.IsMobileOptimized = isMobile == 1
	n.IsActive = isActive == 1
	return &n, nil
}

func (s *Storage) ListNodes(ctx context.Context) ([]models.Node, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, type, country_code, provider_url, api_url, api_key, is_mobile_optimized, is_active, created_at
		FROM nodes ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []models.Node{}
	for rows.Next() {
		var n models.Node
		var isActive, isMobile int
		if err := rows.Scan(&n.ID, &n.Name, &n.Type, &n.CountryCode, &n.ProviderURL, &n.APIURL, &n.APIKey, &isMobile, &isActive, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.IsMobileOptimized = isMobile == 1
		n.IsActive = isActive == 1
		list = append(list, n)
	}
	return list, nil
}

func (s *Storage) ListActiveNodesPublic(ctx context.Context) ([]models.NodePublic, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, type, country_code, is_mobile_optimized, is_active, created_at
		FROM nodes WHERE is_active = 1 ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []models.NodePublic{}
	for rows.Next() {
		var n models.NodePublic
		var isActive, isMobile int
		if err := rows.Scan(&n.ID, &n.Name, &n.Type, &n.CountryCode, &isMobile, &isActive, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.IsMobileOptimized = isMobile == 1
		n.IsActive = isActive == 1
		list = append(list, n)
	}
	return list, nil
}

func (s *Storage) DeleteNode(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM nodes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("node not found")
	}
	return nil
}

// ClientConfig methods
func (s *Storage) CreateClientConfig(ctx context.Context, userID, nodeID int64, clientName, deviceName string, extra ...string) (*models.ClientConfig, error) {
	pubKey := ""
	allocIP := ""
	if len(extra) > 0 {
		pubKey = strings.TrimSpace(extra[0])
	}
	if len(extra) > 1 {
		allocIP = strings.TrimSpace(extra[1])
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO client_configs (user_id, node_id, client_name, device_name, public_key, allocated_ip)
		VALUES (?, ?, ?, ?, ?, ?)
	`, userID, nodeID, clientName, deviceName, pubKey, allocIP)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetClientConfigByID(ctx, id)
}

func (s *Storage) UpdateClientConfigPublicKey(ctx context.Context, id int64, publicKey, allocatedIP string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE client_configs
		SET public_key = ?, allocated_ip = ?
		WHERE id = ?
	`, strings.TrimSpace(publicKey), strings.TrimSpace(allocatedIP), id)
	return err
}

func (s *Storage) RecordPeerTelemetry(ctx context.Context, clientConfigID int64, rxDelta, txDelta, handshakeEpoch int64, isOnline bool) error {
	if clientConfigID <= 0 {
		return nil
	}

	// 1. Update cumulative totals on client_configs
	_, err := s.db.ExecContext(ctx, `
		UPDATE client_configs
		SET total_rx_bytes = total_rx_bytes + ?,
		    total_tx_bytes = total_tx_bytes + ?,
		    last_handshake_epoch = CASE WHEN ? > last_handshake_epoch THEN ? ELSE last_handshake_epoch END,
		    last_seen_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_seen_at END
		WHERE id = ?
	`, rxDelta, txDelta, handshakeEpoch, handshakeEpoch, isOnline, clientConfigID)
	if err != nil {
		return err
	}

	// 2. Upsert into peer_traffic_daily
	if rxDelta > 0 || txDelta > 0 {
		today := time.Now().UTC().Format("2006-01-02")
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO peer_traffic_daily (date, client_config_id, rx_bytes, tx_bytes)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(date, client_config_id) DO UPDATE SET
				rx_bytes = rx_bytes + excluded.rx_bytes,
				tx_bytes = tx_bytes + excluded.tx_bytes
		`, today, clientConfigID, rxDelta, txDelta)
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *Storage) RecordNodeTelemetry(ctx context.Context, nodeID int64, rxDelta, txDelta int64) error {
	if nodeID <= 0 || (rxDelta <= 0 && txDelta <= 0) {
		return nil
	}

	today := time.Now().UTC().Format("2006-01-02")
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO node_traffic_daily (date, node_id, rx_bytes, tx_bytes)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(date, node_id) DO UPDATE SET
			rx_bytes = rx_bytes + excluded.rx_bytes,
			tx_bytes = tx_bytes + excluded.tx_bytes
	`, today, nodeID, rxDelta, txDelta)
	return err
}

func (s *Storage) GetMonthTrafficMap(ctx context.Context, yearMonth string) (map[int64]int64, error) {
	if yearMonth == "" {
		yearMonth = time.Now().UTC().Format("2006-01")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT client_config_id, COALESCE(SUM(rx_bytes + tx_bytes), 0)
		FROM peer_traffic_daily
		WHERE date LIKE ?
		GROUP BY client_config_id
	`, yearMonth+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[int64]int64)
	for rows.Next() {
		var id, total int64
		if err := rows.Scan(&id, &total); err == nil {
			res[id] = total
		}
	}
	return res, nil
}

func (s *Storage) GetNodeMonthTrafficMap(ctx context.Context, yearMonth string) (map[int64]int64, error) {
	if yearMonth == "" {
		yearMonth = time.Now().UTC().Format("2006-01")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT node_id, COALESCE(SUM(rx_bytes + tx_bytes), 0)
		FROM node_traffic_daily
		WHERE date LIKE ?
		GROUP BY node_id
	`, yearMonth+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[int64]int64)
	for rows.Next() {
		var id, total int64
		if err := rows.Scan(&id, &total); err == nil {
			res[id] = total
		}
	}
	return res, nil
}

func (s *Storage) GetClientConfigByID(ctx context.Context, id int64) (*models.ClientConfig, error) {
	var c models.ClientConfig
	var totalRx, totalTx, handshakeEpoch int64
	err := s.db.QueryRowContext(ctx, `
		SELECT c.id, c.user_id, COALESCE(u.username, ''), c.node_id, c.client_name, c.device_name,
		       COALESCE(c.public_key, ''), COALESCE(c.allocated_ip, ''),
		       c.total_rx_bytes, c.total_tx_bytes, c.last_handshake_epoch, c.created_at,
		       COALESCE(n.name, ''), COALESCE(n.type, 'direct'), COALESCE(n.country_code, '')
		FROM client_configs c
		LEFT JOIN nodes n ON c.node_id = n.id
		LEFT JOIN users u ON c.user_id = u.id
		WHERE c.id = ?
	`, id).Scan(&c.ID, &c.UserID, &c.Username, &c.NodeID, &c.ClientName, &c.DeviceName,
		&c.PublicKey, &c.AllocatedIP, &totalRx, &totalTx, &handshakeEpoch, &c.CreatedAt,
		&c.NodeName, &c.NodeType, &c.NodeCountryCode)
	if err != nil {
		return nil, err
	}

	c.LastHandshakeEpoch = handshakeEpoch
	c.LastHandshake, c.IsOnline = formatHandshakeTime(handshakeEpoch)
	c.TotalTrafficBytes = totalRx + totalTx
	c.TotalTrafficFormatted = formatBytes(c.TotalTrafficBytes)

	monthMap, _ := s.GetMonthTrafficMap(ctx, time.Now().UTC().Format("2006-01"))
	if mBytes, ok := monthMap[c.ID]; ok {
		c.MonthTrafficBytes = mBytes
	} else {
		c.MonthTrafficBytes = c.TotalTrafficBytes
	}
	c.MonthTrafficFormatted = formatBytes(c.MonthTrafficBytes)

	return &c, nil
}

func (s *Storage) ListClientConfigsByUser(ctx context.Context, userID int64) ([]models.ClientConfig, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.user_id, COALESCE(u.username, ''), c.node_id, c.client_name, c.device_name,
		       COALESCE(c.public_key, ''), COALESCE(c.allocated_ip, ''),
		       c.total_rx_bytes, c.total_tx_bytes, c.last_handshake_epoch, c.created_at,
		       COALESCE(n.name, ''), COALESCE(n.type, 'direct'), COALESCE(n.country_code, '')
		FROM client_configs c
		LEFT JOIN nodes n ON c.node_id = n.id
		LEFT JOIN users u ON c.user_id = u.id
		WHERE c.user_id = ?
		ORDER BY c.id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	monthMap, _ := s.GetMonthTrafficMap(ctx, time.Now().UTC().Format("2006-01"))

	list := []models.ClientConfig{}
	for rows.Next() {
		var c models.ClientConfig
		var totalRx, totalTx, handshakeEpoch int64
		if err := rows.Scan(&c.ID, &c.UserID, &c.Username, &c.NodeID, &c.ClientName, &c.DeviceName,
			&c.PublicKey, &c.AllocatedIP, &totalRx, &totalTx, &handshakeEpoch, &c.CreatedAt,
			&c.NodeName, &c.NodeType, &c.NodeCountryCode); err != nil {
			return nil, err
		}
		c.LastHandshakeEpoch = handshakeEpoch
		c.LastHandshake, c.IsOnline = formatHandshakeTime(handshakeEpoch)
		c.TotalTrafficBytes = totalRx + totalTx
		c.TotalTrafficFormatted = formatBytes(c.TotalTrafficBytes)

		if mBytes, ok := monthMap[c.ID]; ok {
			c.MonthTrafficBytes = mBytes
		} else {
			c.MonthTrafficBytes = c.TotalTrafficBytes
		}
		c.MonthTrafficFormatted = formatBytes(c.MonthTrafficBytes)

		list = append(list, c)
	}
	return list, nil
}

func (s *Storage) ListAllClientConfigs(ctx context.Context) ([]models.ClientConfig, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.user_id, COALESCE(u.username, ''), c.node_id, c.client_name, c.device_name,
		       COALESCE(c.public_key, ''), COALESCE(c.allocated_ip, ''),
		       c.total_rx_bytes, c.total_tx_bytes, c.last_handshake_epoch, c.created_at,
		       COALESCE(n.name, ''), COALESCE(n.type, 'direct'), COALESCE(n.country_code, '')
		FROM client_configs c
		LEFT JOIN nodes n ON c.node_id = n.id
		LEFT JOIN users u ON c.user_id = u.id
		ORDER BY c.id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	monthMap, _ := s.GetMonthTrafficMap(ctx, time.Now().UTC().Format("2006-01"))

	list := []models.ClientConfig{}
	for rows.Next() {
		var c models.ClientConfig
		var totalRx, totalTx, handshakeEpoch int64
		if err := rows.Scan(&c.ID, &c.UserID, &c.Username, &c.NodeID, &c.ClientName, &c.DeviceName,
			&c.PublicKey, &c.AllocatedIP, &totalRx, &totalTx, &handshakeEpoch, &c.CreatedAt,
			&c.NodeName, &c.NodeType, &c.NodeCountryCode); err != nil {
			return nil, err
		}
		c.LastHandshakeEpoch = handshakeEpoch
		c.LastHandshake, c.IsOnline = formatHandshakeTime(handshakeEpoch)
		c.TotalTrafficBytes = totalRx + totalTx
		c.TotalTrafficFormatted = formatBytes(c.TotalTrafficBytes)

		if mBytes, ok := monthMap[c.ID]; ok {
			c.MonthTrafficBytes = mBytes
		} else {
			c.MonthTrafficBytes = c.TotalTrafficBytes
		}
		c.MonthTrafficFormatted = formatBytes(c.MonthTrafficBytes)

		list = append(list, c)
	}
	return list, nil
}

func (s *Storage) DeleteClientConfig(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM client_configs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("client config not found")
	}
	return nil
}

// AuditLog methods
func (s *Storage) CreateAuditLog(ctx context.Context, log *models.AuditLog) error {
	if log.Username == "" {
		log.Username = "anonymous"
	}
	if log.Category == "" {
		log.Category = models.CategoryAuth
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_logs (user_id, username, action, category, ip_address, details)
		VALUES (?, ?, ?, ?, ?, ?)
	`, log.UserID, log.Username, log.Action, string(log.Category), log.IPAddress, log.Details)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err == nil {
		log.ID = id
	}
	return nil
}

func (s *Storage) ListAuditLogs(ctx context.Context, filter models.AuditLogFilter) ([]models.AuditLog, int, error) {
	var whereClauses []string
	var args []any

	if filter.UserID != nil && *filter.UserID > 0 {
		whereClauses = append(whereClauses, "user_id = ?")
		args = append(args, *filter.UserID)
	}

	if filter.Username != "" {
		whereClauses = append(whereClauses, "username LIKE ?")
		args = append(args, "%"+filter.Username+"%")
	}

	if filter.Category != "" {
		whereClauses = append(whereClauses, "category = ?")
		args = append(args, filter.Category)
	}

	if filter.Action != "" {
		whereClauses = append(whereClauses, "action = ?")
		args = append(args, filter.Action)
	}

	if filter.FromDate != "" {
		// Expecting YYYY-MM-DD or full timestamp
		fromVal := filter.FromDate
		if len(fromVal) == 10 {
			fromVal += " 00:00:00"
		}
		whereClauses = append(whereClauses, "created_at >= ?")
		args = append(args, fromVal)
	}

	if filter.ToDate != "" {
		toVal := filter.ToDate
		if len(toVal) == 10 {
			toVal += " 23:59:59"
		}
		whereClauses = append(whereClauses, "created_at <= ?")
		args = append(args, toVal)
	}

	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = " WHERE " + strings.Join(whereClauses, " AND ")
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM audit_logs" + whereSQL
	var totalCount int
	err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalCount)
	if err != nil {
		return nil, 0, err
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	limit := filter.Limit
	if limit < 1 {
		limit = 50
	}
	offset := (page - 1) * limit

	query := `
		SELECT id, user_id, username, action, category, ip_address, details, created_at
		FROM audit_logs
	` + whereSQL + " ORDER BY id DESC LIMIT ? OFFSET ?"

	queryArgs := append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		var categoryStr string
		var rawUserID sql.NullInt64
		var rawIP, rawDetails sql.NullString

		if err := rows.Scan(
			&l.ID,
			&rawUserID,
			&l.Username,
			&l.Action,
			&categoryStr,
			&rawIP,
			&rawDetails,
			&l.CreatedAt,
		); err != nil {
			return nil, 0, err
		}

		if rawUserID.Valid {
			uid := rawUserID.Int64
			l.UserID = &uid
		}
		if rawIP.Valid {
			l.IPAddress = rawIP.String
		}
		if rawDetails.Valid {
			l.Details = rawDetails.String
		}
		l.Category = models.AuditLogCategory(categoryStr)
		logs = append(logs, l)
	}

	if logs == nil {
		logs = []models.AuditLog{}
	}

	return logs, totalCount, nil
}

func (s *Storage) PurgeAuditLogsOlderThan(ctx context.Context, days int) (int64, error) {
	if days <= 0 {
		days = 90
	}

	query := fmt.Sprintf("DELETE FROM audit_logs WHERE created_at < datetime('now', '-%d days')", days)
	res, err := s.db.ExecContext(ctx, query)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Billing Methods

// RecordPayment records that a user has paid their cooperative dues.
func (s *Storage) RecordPayment(ctx context.Context, userID int64, username string, amount float64, note string) (*models.BillingRecord, error) {
	if username == "" {
		u, err := s.GetUserByID(ctx, userID)
		if err != nil {
			return nil, fmt.Errorf("failed to get user for billing: %w", err)
		}
		username = u.Username
	}

	periodMonth := time.Now().Format("2006-01")
	status := "confirmed"

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO billing_records (user_id, username, amount, currency, period_month, status, note)
		VALUES (?, ?, ?, 'RUB', ?, ?, ?)
	`, userID, username, amount, periodMonth, status, strings.TrimSpace(note))
	if err != nil {
		return nil, fmt.Errorf("failed to insert billing record: %w", err)
	}

	// Reset snooze timer upon payment
	_, _ = s.db.ExecContext(ctx, `UPDATE users SET billing_snoozed_until = NULL WHERE id = ?`, userID)

	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	var rec models.BillingRecord
	err = s.db.QueryRowContext(ctx, `
		SELECT id, user_id, username, amount, currency, period_month, status, note, created_at
		FROM billing_records WHERE id = ?
	`, id).Scan(
		&rec.ID,
		&rec.UserID,
		&rec.Username,
		&rec.Amount,
		&rec.Currency,
		&rec.PeriodMonth,
		&rec.Status,
		&rec.Note,
		&rec.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scan inserted billing record: %w", err)
	}

	return &rec, nil
}

// SnoozeBillingReminder postpones the 30-day dues reminder for a given number of days.
func (s *Storage) SnoozeBillingReminder(ctx context.Context, userID int64, days int) error {
	if days <= 0 {
		days = 1
	}

	query := fmt.Sprintf("UPDATE users SET billing_snoozed_until = datetime('now', '+%d days') WHERE id = ?", days)
	_, err := s.db.ExecContext(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to snooze billing reminder: %w", err)
	}
	return nil
}

// GetBillingRecords returns all billing records for a specific user.
func (s *Storage) GetBillingRecords(ctx context.Context, userID int64) ([]models.BillingRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, username, amount, currency, period_month, status, note, created_at
		FROM billing_records WHERE user_id = ? ORDER BY id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []models.BillingRecord
	for rows.Next() {
		var r models.BillingRecord
		if err := rows.Scan(
			&r.ID,
			&r.UserID,
			&r.Username,
			&r.Amount,
			&r.Currency,
			&r.PeriodMonth,
			&r.Status,
			&r.Note,
			&r.CreatedAt,
		); err != nil {
			return nil, err
		}
		records = append(records, r)
	}

	if records == nil {
		records = []models.BillingRecord{}
	}

	return records, nil
}

// GetBillingStatus calculates user's dues status, next due date (every 30 days) and history.
func (s *Storage) GetBillingStatus(ctx context.Context, userID int64) (*models.BillingStatusResponse, error) {
	var userCreatedAt time.Time
	var rawSnoozed sql.NullTime

	err := s.db.QueryRowContext(ctx, `
		SELECT created_at, billing_snoozed_until FROM users WHERE id = ?
	`, userID).Scan(&userCreatedAt, &rawSnoozed)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	history, err := s.GetBillingRecords(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	var lastPaidAt *time.Time
	var nextDueAt time.Time

	if len(history) > 0 {
		t := history[0].CreatedAt
		lastPaidAt = &t
		nextDueAt = t.Add(30 * 24 * time.Hour)
	} else {
		nextDueAt = userCreatedAt.Add(30 * 24 * time.Hour)
	}

	daysRemaining := int(math.Ceil(time.Until(nextDueAt).Hours() / 24.0))

	var snoozedUntil *time.Time
	if rawSnoozed.Valid {
		st := rawSnoozed.Time
		snoozedUntil = &st
	}

	isDue := false
	status := "paid"

	if now.After(nextDueAt) || daysRemaining <= 0 {
		if snoozedUntil != nil && now.Before(*snoozedUntil) {
			isDue = false
			status = "snoozed"
		} else {
			isDue = true
			status = "due"
		}
	} else {
		isDue = false
		status = "paid"
	}

	var keyCount int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM client_configs WHERE user_id = ?`, userID).Scan(&keyCount)

	recommendedAmount := 200.0
	if keyCount > 3 {
		recommendedAmount = 200.0 + float64(keyCount-3)*30.0
	}

	return &models.BillingStatusResponse{
		IsDue:             isDue,
		DaysRemaining:     daysRemaining,
		NextDueAt:         nextDueAt,
		LastPaidAt:        lastPaidAt,
		SnoozedUntil:      snoozedUntil,
		Status:            status,
		KeyCount:          keyCount,
		RecommendedAmount: recommendedAmount,
		History:           history,
	}, nil
}

// GetAllBillingRecords returns billing overview for administrators.
func (s *Storage) GetAllBillingRecords(ctx context.Context) (*models.AdminBillingSummaryResponse, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, username, amount, currency, period_month, status, note, created_at
		FROM billing_records ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []models.BillingRecord
	for rows.Next() {
		var r models.BillingRecord
		if err := rows.Scan(
			&r.ID,
			&r.UserID,
			&r.Username,
			&r.Amount,
			&r.Currency,
			&r.PeriodMonth,
			&r.Status,
			&r.Note,
			&r.CreatedAt,
		); err != nil {
			return nil, err
		}
		records = append(records, r)
	}

	if records == nil {
		records = []models.BillingRecord{}
	}

	// Calculate due users count
	users, err := s.ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	dueCount := 0
	for _, u := range users {
		if !u.IsActive {
			continue
		}
		st, err := s.GetBillingStatus(ctx, u.ID)
		if err == nil && (st.IsDue || st.DaysRemaining <= 0) {
			dueCount++
		}
	}

	return &models.AdminBillingSummaryResponse{
		TotalPayments: len(records),
		UsersDueCount: dueCount,
		TotalUsers:    len(users),
		Records:       records,
	}, nil
}

func (s *Storage) GetBillingRequisites(ctx context.Context) (*models.BillingRequisites, error) {
	var val string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = 'billing_requisites'`).Scan(&val)
	if err != nil {
		// Default fallback
		return &models.BillingRequisites{
			SBPPhone: "+7 (999) 000-00-00",
			SBPBank:  "Т-Банк / Сбербанк",
		}, nil
	}

	var req models.BillingRequisites
	if err := json.Unmarshal([]byte(val), &req); err != nil {
		return &models.BillingRequisites{
			SBPPhone: "+7 (999) 000-00-00",
			SBPBank:  "Т-Банк / Сбербанк",
		}, nil
	}
	return &req, nil
}

func (s *Storage) UpdateBillingRequisites(ctx context.Context, req models.BillingRequisites) (*models.BillingRequisites, error) {
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO app_settings (key, value, updated_at)
		VALUES ('billing_requisites', ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, string(data))
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// Telegram Chat Subscribers
func (s *Storage) SaveTelegramChat(ctx context.Context, chat models.TelegramChat) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO telegram_chats (chat_id, user_id, username, first_name, is_admin, alerts_enabled, created_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(chat_id) DO UPDATE SET
			user_id = COALESCE(excluded.user_id, telegram_chats.user_id),
			username = excluded.username,
			first_name = excluded.first_name,
			is_admin = excluded.is_admin,
			alerts_enabled = excluded.alerts_enabled
	`, chat.ChatID, chat.UserID, chat.Username, chat.FirstName, chat.IsAdmin, chat.AlertsEnabled)
	return err
}

func (s *Storage) ListTelegramChats(ctx context.Context) ([]models.TelegramChat, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT chat_id, user_id, username, first_name, is_admin, alerts_enabled, created_at
		FROM telegram_chats
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chats []models.TelegramChat
	for rows.Next() {
		var c models.TelegramChat
		var uid sql.NullInt64
		if err := rows.Scan(&c.ChatID, &uid, &c.Username, &c.FirstName, &c.IsAdmin, &c.AlertsEnabled, &c.CreatedAt); err != nil {
			return nil, err
		}
		if uid.Valid {
			c.UserID = &uid.Int64
		}
		chats = append(chats, c)
	}
	if chats == nil {
		chats = []models.TelegramChat{}
	}
	return chats, nil
}

func (s *Storage) GetTelegramChatByUserID(ctx context.Context, userID int64) (*models.TelegramChat, error) {
	var c models.TelegramChat
	var uid sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT chat_id, user_id, username, first_name, is_admin, alerts_enabled, created_at
		FROM telegram_chats
		WHERE user_id = ? AND alerts_enabled = 1
		LIMIT 1
	`, userID).Scan(&c.ChatID, &uid, &c.Username, &c.FirstName, &c.IsAdmin, &c.AlertsEnabled, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	if uid.Valid {
		c.UserID = &uid.Int64
	}
	return &c, nil
}

func (s *Storage) DeleteTelegramChat(ctx context.Context, chatID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM telegram_chats WHERE chat_id = ?`, chatID)
	return err
}

func (s *Storage) SetTelegramAlertsEnabled(ctx context.Context, chatID int64, enabled bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE telegram_chats SET alerts_enabled = ? WHERE chat_id = ?`, enabled, chatID)
	return err
}

func (s *Storage) GetTelegramSettings(ctx context.Context) (*models.TelegramSettings, error) {
	var val string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = 'telegram_settings'`).Scan(&val)
	if err != nil {
		// Fallback to environment variables or defaults
		token := os.Getenv("TELEGRAM_BOT_TOKEN")
		username := os.Getenv("TELEGRAM_BOT_USERNAME")
		secret := os.Getenv("TELEGRAM_ADMIN_SECRET")

		enabled := token != ""

		return &models.TelegramSettings{
			Enabled:             enabled,
			BotToken:            token,
			BotUsername:         username,
			AdminSecret:         secret,
			NotifyOnNodeDown:    true,
			NotifyOnNodeRecover: true,
			NotifyOnNewUser:     true,
		}, nil
	}

	var settings models.TelegramSettings
	if err := json.Unmarshal([]byte(val), &settings); err != nil {
		return nil, fmt.Errorf("failed to unmarshal telegram settings: %w", err)
	}
	return &settings, nil
}

func (s *Storage) UpdateTelegramSettings(ctx context.Context, settings models.TelegramSettings) (*models.TelegramSettings, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal telegram settings: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO app_settings (key, value, updated_at)
		VALUES ('telegram_settings', ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, string(data))
	if err != nil {
		return nil, fmt.Errorf("failed to save telegram settings: %w", err)
	}

	return &settings, nil
}

// GetOrCreateTelegramLinkToken retrieves an existing link token for a user or generates a new one.
func (s *Storage) GetOrCreateTelegramLinkToken(ctx context.Context, userID int64) (string, error) {
	var token string
	err := s.db.QueryRowContext(ctx, `
		SELECT token FROM telegram_link_tokens
		WHERE user_id = ?
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&token)
	if err == nil && token != "" {
		return token, nil
	}

	return s.GenerateTelegramLinkToken(ctx, userID)
}

// GenerateTelegramLinkToken creates a new unique link token for a user.
func (s *Storage) GenerateTelegramLinkToken(ctx context.Context, userID int64) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random token: %w", err)
	}
	token := hex.EncodeToString(b)

	// Clean any previous tokens for this user
	_, _ = s.db.ExecContext(ctx, `DELETE FROM telegram_link_tokens WHERE user_id = ?`, userID)

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO telegram_link_tokens (token, user_id, created_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
	`, token, userID)
	if err != nil {
		return "", fmt.Errorf("failed to save telegram link token: %w", err)
	}

	return token, nil
}

// GetUserByTelegramLinkToken finds an active user by telegram link token.
func (s *Storage) GetUserByTelegramLinkToken(ctx context.Context, token string) (*models.User, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("empty token")
	}

	var u models.User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.password_hash, u.role, u.is_active, u.created_at
		FROM telegram_link_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token = ? AND u.is_active = 1
		LIMIT 1
	`, token).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.IsActive, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ConsumeTelegramLinkToken deletes a used link token.
func (s *Storage) ConsumeTelegramLinkToken(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM telegram_link_tokens WHERE token = ?`, strings.TrimSpace(token))
	return err
}

// GetTelegramChatByChatID retrieves a chat by its Telegram chat ID.
func (s *Storage) GetTelegramChatByChatID(ctx context.Context, chatID int64) (*models.TelegramChat, error) {
	var c models.TelegramChat
	var uid sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT chat_id, user_id, username, first_name, is_admin, alerts_enabled, created_at
		FROM telegram_chats
		WHERE chat_id = ?
		LIMIT 1
	`, chatID).Scan(&c.ChatID, &uid, &c.Username, &c.FirstName, &c.IsAdmin, &c.AlertsEnabled, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	if uid.Valid {
		c.UserID = &uid.Int64
	}
	return &c, nil
}

func formatBytes(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	} else if bytes < 1024*1024 {
		return fmt.Sprintf("%.2f KB", float64(bytes)/1024)
	} else if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.2f MB", float64(bytes)/(1024*1024))
	} else if bytes < 1024*1024*1024*1024 {
		return fmt.Sprintf("%.2f GB", float64(bytes)/(1024*1024*1024))
	}
	return fmt.Sprintf("%.2f TB", float64(bytes)/(1024*1024*1024*1024))
}

func formatHandshakeTime(epoch int64) (string, bool) {
	if epoch <= 0 {
		return "Никогда", false
	}
	now := time.Now().Unix()
	diff := now - epoch
	if diff < 0 {
		diff = 0
	}
	isOnline := diff <= 180
	if isOnline {
		if diff <= 10 {
			return "только что", true
		}
		if diff < 60 {
			return fmt.Sprintf("%d сек назад", diff), true
		}
		return fmt.Sprintf("%d мин назад", diff/60), true
	}
	if diff < 3600 {
		return fmt.Sprintf("%d мин назад", diff/60), false
	}
	if diff < 86400 {
		return fmt.Sprintf("%d ч назад", diff/3600), false
	}
	return fmt.Sprintf("%d дн назад", diff/86400), false
}

// ListNews returns all announcements ordered by pinned status first, then by creation date descending.
func (s *Storage) ListNews(ctx context.Context) ([]models.NewsItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, content, category, is_pinned, author_name, created_at, updated_at
		FROM announcements
		ORDER BY is_pinned DESC, created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query announcements: %w", err)
	}
	defer rows.Close()

	var news []models.NewsItem
	for rows.Next() {
		var item models.NewsItem
		var pinned int
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Content,
			&item.Category,
			&pinned,
			&item.AuthorName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan announcement: %w", err)
		}
		item.IsPinned = pinned == 1
		news = append(news, item)
	}

	if news == nil {
		news = []models.NewsItem{}
	}

	return news, nil
}

// GetNewsByID retrieves a single announcement by its ID.
func (s *Storage) GetNewsByID(ctx context.Context, id int64) (*models.NewsItem, error) {
	var item models.NewsItem
	var pinned int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, title, content, category, is_pinned, author_name, created_at, updated_at
		FROM announcements
		WHERE id = ?
		LIMIT 1
	`, id).Scan(
		&item.ID,
		&item.Title,
		&item.Content,
		&item.Category,
		&pinned,
		&item.AuthorName,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get announcement by id: %w", err)
	}
	item.IsPinned = pinned == 1
	return &item, nil
}

// CreateNews inserts a new announcement.
func (s *Storage) CreateNews(ctx context.Context, item *models.NewsItem) (*models.NewsItem, error) {
	pinned := 0
	if item.IsPinned {
		pinned = 1
	}

	author := item.AuthorName
	if author == "" {
		author = "Admin"
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO announcements (title, content, category, is_pinned, author_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, item.Title, item.Content, string(item.Category), pinned, author)
	if err != nil {
		return nil, fmt.Errorf("failed to insert announcement: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last inserted announcement id: %w", err)
	}

	return s.GetNewsByID(ctx, id)
}

// UpdateNews updates an existing announcement.
func (s *Storage) UpdateNews(ctx context.Context, id int64, req models.UpdateNewsRequest) (*models.NewsItem, error) {
	pinned := 0
	if req.IsPinned {
		pinned = 1
	}

	res, err := s.db.ExecContext(ctx, `
		UPDATE announcements
		SET title = ?, content = ?, category = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Title, req.Content, string(req.Category), pinned, id)
	if err != nil {
		return nil, fmt.Errorf("failed to update announcement: %w", err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, errors.New("announcement not found")
	}

	return s.GetNewsByID(ctx, id)
}

// DeleteNews removes an announcement by ID.
func (s *Storage) DeleteNews(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM announcements WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete announcement: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("announcement not found")
	}
	return nil
}

