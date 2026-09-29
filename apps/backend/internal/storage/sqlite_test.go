package storage_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
)

func createTestDB(t *testing.T) (*storage.Storage, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "avari-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	dbPath := filepath.Join(tmpDir, "test.db")

	os.Setenv("ADMIN_USER", "Forve")
	os.Setenv("ADMIN_PASSWORD", "SuperAdminSecret123!")

	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}

	cleanup := func() {
		_ = store.Close()
		_ = os.RemoveAll(tmpDir)
	}
	return store, cleanup
}

func TestAdminUserCreatedOnInit(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()
	admin, err := store.GetUserByUsername(ctx, "Forve")
	if err != nil {
		t.Fatalf("expected admin user 'Forve' to exist: %v", err)
	}
	if admin.Role != models.RoleAdmin || !admin.IsActive {
		t.Fatalf("invalid admin attributes: %+v", admin)
	}
}

func TestUserRegistrationAndModeration(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create user -> is_active should be false (0), is_pro should be false
	user, err := store.CreateUser(ctx, "bob", "secretpassword")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	if user.IsActive {
		t.Fatalf("newly registered user must have is_active=false")
	}
	if user.IsPro {
		t.Fatalf("newly registered user must have is_pro=false")
	}

	// 2. Activate user
	if err := store.SetUserActive(ctx, user.ID, true); err != nil {
		t.Fatalf("failed to activate user: %v", err)
	}

	updated, err := store.GetUserByID(ctx, user.ID)
	if err != nil || !updated.IsActive {
		t.Fatalf("expected user to be active after update")
	}

	// Set user PRO
	if err := store.SetUserPro(ctx, user.ID, true); err != nil {
		t.Fatalf("failed to set user pro: %v", err)
	}
	proUser, err := store.GetUserByID(ctx, user.ID)
	if err != nil || !proUser.IsPro {
		t.Fatalf("expected user to have is_pro=true")
	}

	// Disable user PRO
	if err := store.SetUserPro(ctx, user.ID, false); err != nil {
		t.Fatalf("failed to disable user pro: %v", err)
	}
	nonProUser, err := store.GetUserByID(ctx, user.ID)
	if err != nil || nonProUser.IsPro {
		t.Fatalf("expected user to have is_pro=false")
	}

	// 3. Deactivate user
	if err := store.SetUserActive(ctx, user.ID, false); err != nil {
		t.Fatalf("failed to deactivate user: %v", err)
	}

	deactivated, err := store.GetUserByID(ctx, user.ID)
	if err != nil || deactivated.IsActive {
		t.Fatalf("expected user to be inactive")
	}
}

func TestNodesAndConfigsStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create nodes (node1: normal, node2: backup)
	node1, err := store.CreateNode(ctx, "Cascade Node", "cascade", "NLD", "https://aeza.net", "http://127.0.0.1:8081", "token1", true, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}
	if !node1.IsMobileOptimized || node1.CountryCode != "NLD" || node1.ProviderURL != "https://aeza.net" || node1.IsBackup {
		t.Fatalf("invalid node1 attributes: %+v", node1)
	}
	node2, err := store.CreateNode(ctx, "Direct Node", "direct", "DEU", "https://hetzner.com", "http://127.0.0.1:8082", "token2", false, true)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}
	if node2.IsMobileOptimized || node2.CountryCode != "DEU" || node2.ProviderURL != "https://hetzner.com" || !node2.IsBackup {
		t.Fatalf("invalid node2 attributes: %+v", node2)
	}

	// Update node test: change is_backup to false
	updatedNode2, err := store.UpdateNode(ctx, node2.ID, "Direct Node Updated", "direct", "FIN", "https://hetzner.com/vps", "http://127.0.0.1:8085", "", true, false)
	if err != nil {
		t.Fatalf("failed to update node: %v", err)
	}
	if updatedNode2.Name != "Direct Node Updated" || updatedNode2.CountryCode != "FIN" || updatedNode2.APIURL != "http://127.0.0.1:8085" || !updatedNode2.IsMobileOptimized || updatedNode2.IsBackup {
		t.Fatalf("invalid updated node attributes: %+v", updatedNode2)
	}
	if updatedNode2.APIKey != "token2" {
		t.Fatalf("expected APIKey to be preserved when empty in update, got: %s", updatedNode2.APIKey)
	}

	nodes, err := store.ListNodes(ctx)
	if err != nil || len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}

	// 2. Create client configs
	user, _ := store.CreateUser(ctx, "carol", "password123")
	cfg1, err := store.CreateClientConfig(ctx, user.ID, node1.ID, "u2_iphone", "iPhone")
	if err != nil {
		t.Fatalf("failed to create client config: %v", err)
	}

	cfg2, err := store.CreateClientConfig(ctx, user.ID, node2.ID, "u2_macbook", "MacBook")
	if err != nil {
		t.Fatalf("failed to create client config: %v", err)
	}

	userConfigs, err := store.ListClientConfigsByUser(ctx, user.ID)
	if err != nil || len(userConfigs) != 2 {
		t.Fatalf("expected 2 configs for user, got %d", len(userConfigs))
	}

	// 3. Delete config
	if err := store.DeleteClientConfig(ctx, cfg1.ID); err != nil {
		t.Fatalf("failed to delete config: %v", err)
	}

	remaining, _ := store.ListClientConfigsByUser(ctx, user.ID)
	if len(remaining) != 1 || remaining[0].ID != cfg2.ID {
		t.Fatalf("expected 1 remaining config, got %+v", remaining)
	}
}

func TestAuditLogsStorageAndPurge(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create audit logs
	admin, err := store.GetUserByUsername(ctx, "Forve")
	if err != nil {
		t.Fatalf("failed to get admin user: %v", err)
	}

	alice, err := store.CreateUser(ctx, "alice", "alicepassword123")
	if err != nil {
		t.Fatalf("failed to create alice: %v", err)
	}

	uid1 := admin.ID
	uid2 := alice.ID

	log1 := &models.AuditLog{
		UserID:    &uid1,
		Username:  "Forve",
		Action:    "auth_login",
		Category:  models.CategoryAuth,
		IPAddress: "127.0.0.1",
		Details:   "Admin logged in",
	}
	if err := store.CreateAuditLog(ctx, log1); err != nil {
		t.Fatalf("failed to create audit log: %v", err)
	}
	if log1.ID == 0 {
		t.Fatalf("expected log ID to be set")
	}

	log2 := &models.AuditLog{
		UserID:    &uid2,
		Username:  "alice",
		Action:    "key_create",
		Category:  models.CategoryKeys,
		IPAddress: "192.168.1.50",
		Details:   "Created key for iPhone",
	}
	if err := store.CreateAuditLog(ctx, log2); err != nil {
		t.Fatalf("failed to create audit log: %v", err)
	}

	// 2. Query all logs
	logs, count, err := store.ListAuditLogs(ctx, models.AuditLogFilter{Limit: 50})
	if err != nil {
		t.Fatalf("failed to list audit logs: %v", err)
	}
	if count != 2 || len(logs) != 2 {
		t.Fatalf("expected 2 logs, got %d (count: %d)", len(logs), count)
	}

	// 3. Filter by Category
	authLogs, authCount, err := store.ListAuditLogs(ctx, models.AuditLogFilter{Category: string(models.CategoryAuth)})
	if err != nil || authCount != 1 || len(authLogs) != 1 {
		t.Fatalf("expected 1 auth log, got %d", authCount)
	}
	if authLogs[0].Username != "Forve" {
		t.Fatalf("expected Forve, got %s", authLogs[0].Username)
	}

	// 4. Filter by UserID
	aliceLogs, aliceCount, err := store.ListAuditLogs(ctx, models.AuditLogFilter{UserID: &uid2})
	if err != nil || aliceCount != 1 || len(aliceLogs) != 1 {
		t.Fatalf("expected 1 alice log, got %d", aliceCount)
	}

	// 5. Purge logs
	deleted, err := store.PurgeAuditLogsOlderThan(ctx, 90)
	if err != nil {
		t.Fatalf("failed to purge logs: %v", err)
	}
	// Recent logs should not be purged
	if deleted != 0 {
		t.Fatalf("expected 0 deleted logs for fresh entries, got %d", deleted)
	}
}

func TestBillingStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create a user
	user, err := store.CreateUser(ctx, "charlie", "password123")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// 2. Initial billing status (30 days from creation, not due)
	status, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to get billing status: %v", err)
	}
	if status.IsDue {
		t.Fatalf("expected fresh user not to be due, got isDue=true")
	}
	if status.DaysRemaining <= 0 {
		t.Fatalf("expected days remaining > 0, got %d", status.DaysRemaining)
	}
	if len(status.History) != 0 {
		t.Fatalf("expected empty history, got %d", len(status.History))
	}

	// 3. Record payment ("Оплачено")
	rec, err := store.RecordPayment(ctx, user.ID, user.Username, 0, "Оплачено за сентябрь")
	if err != nil {
		t.Fatalf("failed to record payment: %v", err)
	}
	if rec.ID == 0 || rec.Status != "confirmed" {
		t.Fatalf("invalid record: %+v", rec)
	}

	// 4. Verify updated billing status
	statusAfterPay, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to get updated status: %v", err)
	}
	if len(statusAfterPay.History) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(statusAfterPay.History))
	}
	if statusAfterPay.LastPaidAt == nil {
		t.Fatalf("expected lastPaidAt to be set")
	}

	// 5. Snooze reminder (1 day / next day)
	if err := store.SnoozeBillingReminder(ctx, user.ID, 1); err != nil {
		t.Fatalf("failed to snooze: %v", err)
	}
	statusSnooze, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to get status after snooze: %v", err)
	}
	if statusSnooze.SnoozedUntil == nil {
		t.Fatalf("expected snoozedUntil to be set")
	}

	// 6. Admin summary
	adminSummary, err := store.GetAllBillingRecords(ctx)
	if err != nil {
		t.Fatalf("failed to get admin billing summary: %v", err)
	}
	if adminSummary.TotalPayments != 1 {
		t.Fatalf("expected 1 total payment, got %d", adminSummary.TotalPayments)
	}

	// 7. Verify pricing formulas: non-PRO vs PRO, keyCount <= 3 vs keyCount > 3
	// Initially non-PRO with 0 keys -> 200.0
	statusNonPro0, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil || statusNonPro0.RecommendedAmount != 200.0 || statusNonPro0.IsPro {
		t.Fatalf("expected 200.0 for non-pro with 0 keys, got %.1f (is_pro=%v)", statusNonPro0.RecommendedAmount, statusNonPro0.IsPro)
	}

	// Switch to PRO with 0 keys -> 300.0
	_ = store.SetUserPro(ctx, user.ID, true)
	statusPro0, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil || statusPro0.RecommendedAmount != 300.0 || !statusPro0.IsPro {
		t.Fatalf("expected 300.0 for pro with 0 keys, got %.1f (is_pro=%v)", statusPro0.RecommendedAmount, statusPro0.IsPro)
	}

	// Add 5 keys to user (2 extra keys)
	testNode, _ := store.CreateNode(ctx, "Billing Node", "direct", "NLD", "https://aeza.net", "http://127.0.0.1:8080", "secret", false, false)
	for i := 1; i <= 5; i++ {
		_, _ = store.CreateClientConfig(ctx, user.ID, testNode.ID, fmt.Sprintf("key_%d", i), fmt.Sprintf("Device %d", i))
	}

	// PRO with 5 keys -> 300 + 2 * 50 = 400.0
	statusPro5, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil || statusPro5.RecommendedAmount != 400.0 {
		t.Fatalf("expected 400.0 for pro with 5 keys, got %.1f", statusPro5.RecommendedAmount)
	}

	// Switch back to non-PRO with 5 keys -> 200 + 2 * 30 = 260.0
	_ = store.SetUserPro(ctx, user.ID, false)
	statusNonPro5, err := store.GetBillingStatus(ctx, user.ID)
	if err != nil || statusNonPro5.RecommendedAmount != 260.0 {
		t.Fatalf("expected 260.0 for non-pro with 5 keys, got %.1f", statusNonPro5.RecommendedAmount)
	}
}

func TestTelegramChatsStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Save chat
	chat := models.TelegramChat{
		ChatID:        123456789,
		Username:      "avari_admin",
		FirstName:     "Elven Admin",
		IsAdmin:       true,
		AlertsEnabled: true,
	}

	if err := store.SaveTelegramChat(ctx, chat); err != nil {
		t.Fatalf("failed to save telegram chat: %v", err)
	}

	// 2. List chats
	chats, err := store.ListTelegramChats(ctx)
	if err != nil {
		t.Fatalf("failed to list telegram chats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("expected 1 chat, got %d", len(chats))
	}
	if chats[0].ChatID != 123456789 || chats[0].Username != "avari_admin" {
		t.Fatalf("unexpected chat data: %+v", chats[0])
	}

	// 3. Disable alerts
	if err := store.SetTelegramAlertsEnabled(ctx, 123456789, false); err != nil {
		t.Fatalf("failed to set alerts enabled: %v", err)
	}
	chats, _ = store.ListTelegramChats(ctx)
	if chats[0].AlertsEnabled {
		t.Fatalf("expected alerts to be disabled")
	}

	// 4. Delete chat
	if err := store.DeleteTelegramChat(ctx, 123456789); err != nil {
		t.Fatalf("failed to delete telegram chat: %v", err)
	}
	chats, _ = store.ListTelegramChats(ctx)
	if len(chats) != 0 {
		t.Fatalf("expected 0 chats after delete, got %d", len(chats))
	}
}

func TestTelegramSettingsStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Initial settings
	st, err := store.GetTelegramSettings(ctx)
	if err != nil {
		t.Fatalf("failed to get default telegram settings: %v", err)
	}
	if st == nil {
		t.Fatalf("expected non-nil settings")
	}

	// 2. Update settings
	newSettings := models.TelegramSettings{
		Enabled:             true,
		BotToken:            "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
		BotUsername:         "MyCustomBot",
		AdminSecret:         "SuperSecretCode42",
		NotifyOnNodeDown:    true,
		NotifyOnNodeRecover: false,
		NotifyOnNewUser:     true,
	}

	saved, err := store.UpdateTelegramSettings(ctx, newSettings)
	if err != nil {
		t.Fatalf("failed to update telegram settings: %v", err)
	}
	if saved.BotToken != newSettings.BotToken || saved.BotUsername != "MyCustomBot" || !saved.Enabled || saved.NotifyOnNodeRecover {
		t.Fatalf("unexpected saved settings: %+v", saved)
	}

	// 3. Fetch again from DB
	fetched, err := store.GetTelegramSettings(ctx)
	if err != nil {
		t.Fatalf("failed to get updated settings: %v", err)
	}
	if fetched.BotToken != newSettings.BotToken || fetched.AdminSecret != "SuperSecretCode42" {
		t.Fatalf("unexpected fetched settings: %+v", fetched)
	}
}

func TestTelegramLinkTokensStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// Create a test user
	user, err := store.CreateUser(ctx, "teleuser", "pass123456")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// 1. Initially user is not active, link token lookup should return error
	token, err := store.GetOrCreateTelegramLinkToken(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to get/create token: %v", err)
	}
	if token == "" {
		t.Fatalf("expected non-empty token")
	}

	_, err = store.GetUserByTelegramLinkToken(ctx, token)
	if err == nil {
		t.Fatalf("expected error for inactive user token lookup")
	}

	// 2. Activate user
	if err := store.SetUserActive(ctx, user.ID, true); err != nil {
		t.Fatalf("failed to activate user: %v", err)
	}

	foundUser, err := store.GetUserByTelegramLinkToken(ctx, token)
	if err != nil {
		t.Fatalf("failed to find user by token: %v", err)
	}
	if foundUser.ID != user.ID || foundUser.Username != "teleuser" {
		t.Fatalf("unexpected found user: %+v", foundUser)
	}

	// 3. Consume token
	if err := store.ConsumeTelegramLinkToken(ctx, token); err != nil {
		t.Fatalf("failed to consume token: %v", err)
	}

	_, err = store.GetUserByTelegramLinkToken(ctx, token)
	if err == nil {
		t.Fatalf("expected error after consuming token")
	}

	// 4. Test GetTelegramChatByChatID
	chat := models.TelegramChat{
		ChatID:        987654321,
		UserID:        &user.ID,
		Username:      "tguser99",
		FirstName:     "Tele",
		IsAdmin:       false,
		AlertsEnabled: true,
	}
	if err := store.SaveTelegramChat(ctx, chat); err != nil {
		t.Fatalf("failed to save telegram chat: %v", err)
	}

	fetchedChat, err := store.GetTelegramChatByChatID(ctx, 987654321)
	if err != nil {
		t.Fatalf("failed to get telegram chat by chat id: %v", err)
	}
	if fetchedChat.ChatID != 987654321 || *fetchedChat.UserID != user.ID || fetchedChat.Username != "tguser99" {
		t.Fatalf("unexpected fetched chat: %+v", fetchedChat)
	}
}

func TestTelemetryStorageAndMonthlyDelta(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create User, Node, and ClientConfig with PublicKey
	user, err := store.CreateUser(ctx, "tele_test_user", "password123")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	node, err := store.CreateNode(ctx, "Test Node S1", "direct", "NLD", "https://aeza.net", "http://127.0.0.1:8080", "secret", false, false)
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	cfg, err := store.CreateClientConfig(ctx, user.ID, node.ID, "u1_iphone", "iPhone", "pubkeyBase64==", "10.7.0.2")
	if err != nil {
		t.Fatalf("failed to create client config: %v", err)
	}
	if cfg.PublicKey != "pubkeyBase64==" || cfg.AllocatedIP != "10.7.0.2" {
		t.Fatalf("expected PublicKey and AllocatedIP set, got %+v", cfg)
	}

	// 2. Record first batch of telemetry (100MB RX, 50MB TX, handshake 30s ago)
	now := time.Now().Unix()
	handshake1 := now - 30
	err = store.RecordPeerTelemetry(ctx, cfg.ID, 100*1024*1024, 50*1024*1024, handshake1, true)
	if err != nil {
		t.Fatalf("failed to record peer telemetry: %v", err)
	}

	err = store.RecordNodeTelemetry(ctx, node.ID, 100*1024*1024, 50*1024*1024)
	if err != nil {
		t.Fatalf("failed to record node telemetry: %v", err)
	}

	// 3. Verify updated config
	updatedCfg, err := store.GetClientConfigByID(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("failed to get client config: %v", err)
	}
	if updatedCfg.TotalTrafficBytes != 150*1024*1024 {
		t.Fatalf("expected 150MB total traffic, got %d", updatedCfg.TotalTrafficBytes)
	}
	if updatedCfg.MonthTrafficBytes != 150*1024*1024 {
		t.Fatalf("expected 150MB month traffic, got %d", updatedCfg.MonthTrafficBytes)
	}
	if !updatedCfg.IsOnline {
		t.Fatalf("expected client to be online")
	}

	// 4. Record second batch of telemetry (additional 50MB RX, 20MB TX)
	err = store.RecordPeerTelemetry(ctx, cfg.ID, 50*1024*1024, 20*1024*1024, now-10, true)
	if err != nil {
		t.Fatalf("failed to record second peer telemetry: %v", err)
	}

	updatedCfg2, err := store.GetClientConfigByID(ctx, cfg.ID)
	if err != nil {
		t.Fatalf("failed to get client config: %v", err)
	}
	expectedTotal := int64(220 * 1024 * 1024)
	if updatedCfg2.TotalTrafficBytes != expectedTotal {
		t.Fatalf("expected %d total traffic, got %d", expectedTotal, updatedCfg2.TotalTrafficBytes)
	}
	if updatedCfg2.MonthTrafficBytes != expectedTotal {
		t.Fatalf("expected %d month traffic, got %d", expectedTotal, updatedCfg2.MonthTrafficBytes)
	}

	// 5. Test Month Traffic Map
	monthMap, err := store.GetMonthTrafficMap(ctx, time.Now().UTC().Format("2006-01"))
	if err != nil {
		t.Fatalf("failed to get month traffic map: %v", err)
	}
	if monthMap[cfg.ID] != expectedTotal {
		t.Fatalf("expected %d in monthMap for client %d, got %d", expectedTotal, cfg.ID, monthMap[cfg.ID])
	}
}

func TestSchemaUpgradeFromLegacyDatabase(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "avari-legacy-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	dbPath := filepath.Join(tmpDir, "legacy.db")

	// Create legacy database manually without public_key in client_configs
	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open raw db: %v", err)
	}
	legacySchema := `
	CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user',
		is_active INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE nodes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		api_url TEXT NOT NULL,
		api_key TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE client_configs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		node_id INTEGER NOT NULL,
		client_name TEXT NOT NULL,
		device_name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	if _, err := rawDB.Exec(legacySchema); err != nil {
		t.Fatalf("failed to setup legacy schema: %v", err)
	}
	_ = rawDB.Close()

	// Now initialize NewSQLiteStorage on this legacy DB
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to migrate legacy database: %v", err)
	}
	defer store.Close()
}

func TestAnnouncementsStorage(t *testing.T) {
	store, cleanup := createTestDB(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Create first announcement
	item1, err := store.CreateNews(ctx, &models.NewsItem{
		Title:      "Обычная новость",
		Content:    "Текст обычной новости",
		Category:   models.NewsCategoryGeneral,
		IsPinned:   false,
		AuthorName: "Forve",
	})
	if err != nil {
		t.Fatalf("failed to create news 1: %v", err)
	}
	if item1.ID == 0 || item1.Title != "Обычная новость" || item1.IsPinned {
		t.Fatalf("invalid item1: %+v", item1)
	}

	// 2. Create second announcement (pinned)
	item2, err := store.CreateNews(ctx, &models.NewsItem{
		Title:      "Важное объявление",
		Content:    "Сервер перезагружается",
		Category:   models.NewsCategoryIncident,
		IsPinned:   true,
		AuthorName: "Admin",
	})
	if err != nil {
		t.Fatalf("failed to create news 2: %v", err)
	}
	if !item2.IsPinned {
		t.Fatalf("expected item2 to be pinned")
	}

	// 3. List announcements -> pinned should be first
	list, err := store.ListNews(ctx)
	if err != nil {
		t.Fatalf("failed to list news: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 items, got %d", len(list))
	}
	if list[0].ID != item2.ID {
		t.Fatalf("expected pinned item2 to be first in list, got ID %d", list[0].ID)
	}

	// 4. Update announcement
	updated, err := store.UpdateNews(ctx, item1.ID, models.UpdateNewsRequest{
		Title:    "Отредактированная новость",
		Content:  "Новый текст",
		Category: models.NewsCategoryBilling,
		IsPinned: true,
	})
	if err != nil {
		t.Fatalf("failed to update news: %v", err)
	}
	if updated.Title != "Отредактированная новость" || updated.Category != models.NewsCategoryBilling || !updated.IsPinned {
		t.Fatalf("unexpected updated news: %+v", updated)
	}

	// 5. Delete announcement
	if err := store.DeleteNews(ctx, item2.ID); err != nil {
		t.Fatalf("failed to delete news: %v", err)
	}

	afterDelete, err := store.ListNews(ctx)
	if err != nil {
		t.Fatalf("failed to list news after delete: %v", err)
	}
	if len(afterDelete) != 1 || afterDelete[0].ID != item1.ID {
		t.Fatalf("expected 1 item remaining, got %d", len(afterDelete))
	}
}

