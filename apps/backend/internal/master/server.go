package master

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/client"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/monitor"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/telegram"
)

const dashboardCacheTTL = 3 * time.Minute

type dashboardCache struct {
	mu           sync.RWMutex
	data         *models.DashboardStatsResponse
	pendingUsers int
	cachedAt     time.Time
}

// Config holds Master server configuration.
type Config struct {
	Port                string
	JWTSecret           string
	TelegramBotToken    string
	TelegramBotUsername string
	TelegramAdminChatID string
	TelegramAdminSecret string
	HealthCheckInterval time.Duration
	HealthCheckTimeout  time.Duration
}

// Server is the Master Backend API server.
type Server struct {
	cfg           Config
	storage       *storage.Storage
	jwtMgr        *auth.JWTManager
	mux           *http.ServeMux
	telegramBot   *telegram.Bot
	healthChecker *monitor.HealthChecker
	dashCache     dashboardCache
}

// NewServer creates a new Master server instance.
func NewServer(cfg Config, s *storage.Storage) *Server {
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, 0)

	srv := &Server{
		cfg:     cfg,
		storage: s,
		jwtMgr:  jwtMgr,
		mux:     http.NewServeMux(),
	}

	// Load stored Telegram settings if available
	var tgToken, tgUsername, tgSecret string
	var notifyDown, notifyRecover, notifyNewUser bool = true, true, true
	tgEnabled := false

	savedSettings, err := s.GetTelegramSettings(context.Background())
	if err == nil && savedSettings != nil && (savedSettings.BotToken != "" || savedSettings.Enabled) {
		tgToken = savedSettings.BotToken
		tgUsername = savedSettings.BotUsername
		tgSecret = savedSettings.AdminSecret
		tgEnabled = savedSettings.Enabled
		notifyDown = savedSettings.NotifyOnNodeDown
		notifyRecover = savedSettings.NotifyOnNodeRecover
		notifyNewUser = savedSettings.NotifyOnNewUser
	} else {
		tgToken = cfg.TelegramBotToken
		tgUsername = cfg.TelegramBotUsername
		tgSecret = cfg.TelegramAdminSecret
		tgEnabled = cfg.TelegramBotToken != ""
	}

	// Initialize Telegram Bot & HealthChecker
	tgCfg := telegram.Config{
		Token:               tgToken,
		BotUsername:         tgUsername,
		AdminSecret:         tgSecret,
		AdminChatID:         cfg.TelegramAdminChatID,
		Enabled:             tgEnabled,
		NotifyOnNodeDown:    notifyDown,
		NotifyOnNodeRecover: notifyRecover,
		NotifyOnNewUser:     notifyNewUser,
		Storage:             s,
		NodeLister: func(ctx context.Context) ([]models.NodeWithStatus, error) {
			if srv.healthChecker != nil {
				return srv.healthChecker.CheckAllNodes(ctx)
			}
			nodes, err := s.ListNodes(ctx)
			if err != nil {
				return nil, err
			}
			res := make([]models.NodeWithStatus, len(nodes))
			for i, n := range nodes {
				res[i] = models.NodeWithStatus{Node: n, Online: true}
			}
			return res, nil
		},
	}
	srv.telegramBot = telegram.NewBot(tgCfg)

	hcCfg := monitor.Config{
		Storage:     s,
		Bot:         srv.telegramBot,
		Interval:    cfg.HealthCheckInterval,
		Timeout:     cfg.HealthCheckTimeout,
		LogActivity: func(category models.AuditLogCategory, action string, details string) {
			_ = s.CreateAuditLog(context.Background(), &models.AuditLog{
				Username:  "system_monitor",
				Action:    action,
				Category:  category,
				IPAddress: "127.0.0.1",
				Details:   details,
			})
		},
	}
	srv.healthChecker = monitor.NewHealthChecker(hcCfg)

	srv.routes()
	return srv
}

// StartBackgroundWorkers launches Telegram bot polling and HealthChecker.
func (s *Server) StartBackgroundWorkers(ctx context.Context) {
	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		s.telegramBot.Start(ctx)
	}
	if s.healthChecker != nil {
		s.healthChecker.Start(ctx)
	}
}

// StopBackgroundWorkers gracefully stops background workers.
func (s *Server) StopBackgroundWorkers() {
	if s.healthChecker != nil {
		s.healthChecker.Stop()
	}
	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		s.telegramBot.Stop()
	}
}


// Handler returns the HTTP handler with global middleware.
func (s *Server) Handler() http.Handler {
	return s.corsMiddleware(s.jwtMgr.AuthMiddleware(s.mux))
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	// Public Routes
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	s.mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)

	// User Authenticated Routes
	s.mux.HandleFunc("GET /api/v1/auth/me", auth.RequireAuth(s.handleMe))
	s.mux.HandleFunc("PUT /api/v1/auth/profile", auth.RequireAuth(s.handleUpdateProfile))
	s.mux.HandleFunc("GET /api/v1/nodes", auth.RequireAuth(s.handleListActiveNodes))
	s.mux.HandleFunc("GET /api/v1/keys", auth.RequireAuth(s.handleListUserKeys))
	s.mux.HandleFunc("POST /api/v1/keys", auth.RequireAuth(s.handleCreateKey))
	s.mux.HandleFunc("GET /api/v1/keys/{id}", auth.RequireAuth(s.handleGetKey))
	s.mux.HandleFunc("DELETE /api/v1/keys/{id}", auth.RequireAuth(s.handleDeleteKey))

	// Admin Routes
	s.mux.HandleFunc("GET /api/v1/admin/users", auth.RequireAdmin(s.handleAdminListUsers))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/activate", auth.RequireAdmin(s.handleAdminActivateUser))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/deactivate", auth.RequireAdmin(s.handleAdminDeactivateUser))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/role", auth.RequireAdmin(s.handleAdminSetUserRole))
	s.mux.HandleFunc("DELETE /api/v1/admin/users/{id}", auth.RequireAdmin(s.handleAdminDeleteUser))

	s.mux.HandleFunc("GET /api/v1/admin/nodes", auth.RequireAdmin(s.handleAdminListNodes))
	s.mux.HandleFunc("POST /api/v1/admin/nodes", auth.RequireAdmin(s.handleAdminAddNode))
	s.mux.HandleFunc("PUT /api/v1/admin/nodes/{id}", auth.RequireAdmin(s.handleAdminUpdateNode))
	s.mux.HandleFunc("DELETE /api/v1/admin/nodes/{id}", auth.RequireAdmin(s.handleAdminDeleteNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/restart", auth.RequireAdmin(s.handleAdminRestartNode))
	s.mux.HandleFunc("GET /api/v1/admin/nodes/{id}/backup", auth.RequireAdmin(s.handleAdminBackupNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/restore", auth.RequireAdmin(s.handleAdminRestoreNode))
	s.mux.HandleFunc("GET /api/v1/admin/nodes/{id}/egress", auth.RequireAdmin(s.handleAdminGetNodeEgress))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/egress", auth.RequireAdmin(s.handleAdminSwitchNodeEgress))

	s.mux.HandleFunc("GET /api/v1/admin/keys", auth.RequireAdmin(s.handleAdminListAllKeys))

	s.mux.HandleFunc("GET /api/v1/admin/logs", auth.RequireAdmin(s.handleAdminListAuditLogs))
	s.mux.HandleFunc("POST /api/v1/admin/logs/cleanup", auth.RequireAdmin(s.handleAdminCleanupAuditLogs))

	// Billing Routes
	s.mux.HandleFunc("GET /api/v1/billing/status", auth.RequireAuth(s.handleGetBillingStatus))
	s.mux.HandleFunc("GET /api/v1/billing/requisites", auth.RequireAuth(s.handleGetBillingRequisites))
	s.mux.HandleFunc("POST /api/v1/billing/pay", auth.RequireAuth(s.handlePayDues))
	s.mux.HandleFunc("POST /api/v1/billing/snooze", auth.RequireAuth(s.handleSnoozeDues))
	s.mux.HandleFunc("GET /api/v1/admin/billing", auth.RequireAdmin(s.handleAdminGetBilling))
	s.mux.HandleFunc("PUT /api/v1/admin/billing/requisites", auth.RequireAdmin(s.handleAdminUpdateBillingRequisites))

	// Telegram Bot Routes
	s.mux.HandleFunc("GET /api/v1/user/telegram", auth.RequireAuth(s.handleGetUserTelegramStatus))
	s.mux.HandleFunc("POST /api/v1/user/telegram/unlink", auth.RequireAuth(s.handleUserUnlinkTelegram))
	s.mux.HandleFunc("GET /api/v1/admin/telegram/status", auth.RequireAdmin(s.handleAdminGetTelegramStatus))
	s.mux.HandleFunc("GET /api/v1/admin/telegram/settings", auth.RequireAdmin(s.handleAdminGetTelegramSettings))
	s.mux.HandleFunc("PUT /api/v1/admin/telegram/settings", auth.RequireAdmin(s.handleAdminUpdateTelegramSettings))
	s.mux.HandleFunc("POST /api/v1/admin/telegram/test", auth.RequireAdmin(s.handleAdminSendTelegramTest))
	s.mux.HandleFunc("DELETE /api/v1/admin/telegram/subscribers/{id}", auth.RequireAdmin(s.handleAdminDeleteTelegramSubscriber))
	s.mux.HandleFunc("POST /api/v1/admin/telegram/subscribers/{id}/toggle", auth.RequireAdmin(s.handleAdminToggleTelegramSubscriber))

	// News / Announcements Routes
	s.mux.HandleFunc("GET /api/v1/news", auth.RequireAuth(s.handleListNews))
	s.mux.HandleFunc("POST /api/v1/admin/news", auth.RequireAdmin(s.handleAdminCreateNews))
	s.mux.HandleFunc("PUT /api/v1/admin/news/{id}", auth.RequireAdmin(s.handleAdminUpdateNews))
	s.mux.HandleFunc("DELETE /api/v1/admin/news/{id}", auth.RequireAdmin(s.handleAdminDeleteNews))

	// Shared / Dashboard Routes
	s.mux.HandleFunc("GET /api/v1/stats/dashboard", auth.RequireAuth(s.handleGetDashboardStats))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, models.HealthResponse{
		Status:  "ok",
		Service: "avari-master",
		Version: "v0.4.4",
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	user, err := s.storage.CreateUser(r.Context(), req.Username, req.Password)
	if err != nil {
		s.logActivity(r, nil, req.Username, models.CategoryAuth, "auth_register_failed", fmt.Sprintf("Ошибка регистрации: %v", err))
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_register", "Регистрация нового аккаунта (ожидает подтверждения администратора)")

	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go s.telegramBot.NotifyNewUser(*user)
	}

	s.writeJSON(w, http.StatusCreated, map[string]any{
		"message": "Registration successful. Please wait for administrator approval before logging in.",
		"user": models.UserPublic{
			ID:        user.ID,
			Username:  user.Username,
			Role:      user.Role,
			IsActive:  user.IsActive,
			CreatedAt: user.CreatedAt,
		},
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	user, err := s.storage.GetUserByUsername(r.Context(), req.Username)
	if err != nil || !auth.CheckPassword(req.Password, user.PasswordHash) {
		s.logActivity(r, nil, req.Username, models.CategoryAuth, "auth_login_failed", "Неудачная попытка входа (неверный пароль или пользователь не найден)")
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid username or password"})
		return
	}

	if !user.IsActive {
		s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_login_blocked", "Попытка входа в неактивированный аккаунт")
		s.writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "Your account is pending administrator approval. Please contact support/admin.",
		})
		return
	}

	token, err := s.jwtMgr.GenerateToken(user)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_login", "Успешная авторизация в системе")

	s.writeJSON(w, http.StatusOK, models.LoginResponse{
		Token: token,
		User: models.UserPublic{
			ID:        user.ID,
			Username:  user.Username,
			Role:      user.Role,
			IsActive:  user.IsActive,
			CreatedAt: user.CreatedAt,
		},
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	user, err := s.storage.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	s.writeJSON(w, http.StatusOK, models.UserPublic{
		ID:        user.ID,
		Username:  user.Username,
		Role:      user.Role,
		IsActive:  user.IsActive,
		CreatedAt: user.CreatedAt,
	})
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	updatedUser, err := s.storage.UpdateUserProfile(r.Context(), claims.UserID, req.Username, req.Password)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &updatedUser.ID, updatedUser.Username, models.CategoryProfile, "profile_update", "Обновлены учетные данные профиля")

	token, _ := s.jwtMgr.GenerateToken(updatedUser)

	s.writeJSON(w, http.StatusOK, models.LoginResponse{
		Token: token,
		User: models.UserPublic{
			ID:        updatedUser.ID,
			Username:  updatedUser.Username,
			Role:      updatedUser.Role,
			IsActive:  updatedUser.IsActive,
			CreatedAt: updatedUser.CreatedAt,
		},
	})
}


// User: Nodes & Keys
func (s *Server) handleListActiveNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.storage.ListActiveNodesPublic(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleListUserKeys(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	keys, err := s.storage.ListClientConfigsByUser(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, keys)
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.CreateKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	req.DeviceName = strings.TrimSpace(req.DeviceName)
	if req.DeviceName == "" {
		req.DeviceName = "device"
	}

	node, err := s.storage.GetNodeByID(r.Context(), req.NodeID)
	if err != nil || !node.IsActive {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Selected node is unavailable"})
		return
	}

	// Create unique sanitized client name on the node: e.g. u1_phone
	cleanDevice := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, req.DeviceName)
	clientName := fmt.Sprintf("u%d_%s", claims.UserID, cleanDevice)

	// Call Slave API
	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	slaveResp, err := slaveCli.CreateClient(r.Context(), clientName, req.PSK)
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Slave node failed: %v", err)})
		return
	}

	// Extract allocated IP from config
	allocIP := ""
	for _, l := range strings.Split(slaveResp.Config, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Address") {
			parts := strings.SplitN(l, "=", 2)
			if len(parts) == 2 {
				ips := strings.Split(parts[1], ",")
				if len(ips) > 0 {
					allocIP = strings.TrimSpace(strings.Split(strings.TrimSpace(ips[0]), "/")[0])
				}
			}
			break
		}
	}

	// Save record in DB with PublicKey and AllocatedIP
	keyRecord, err := s.storage.CreateClientConfig(r.Context(), claims.UserID, node.ID, clientName, req.DeviceName, slaveResp.PublicKey, allocIP)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	pskDetails := ""
	if req.PSK {
		pskDetails = " [PSK / Shadowrocket]"
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_create", fmt.Sprintf("Создан VPN-ключ «%s» (%s)%s на сервере «%s»", req.DeviceName, clientName, pskDetails, node.Name))

	cleanConfig := runner.SanitizeAWGConfig(slaveResp.Config)
	if cleanConfig != "" {
		slaveResp.Config = cleanConfig
	}

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusCreated, map[string]any{
		"id":          keyRecord.ID,
		"client_name": clientName,
		"device_name": req.DeviceName,
		"node_id":     node.ID,
		"node_name":   node.Name,
		"node_type":   node.Type,
		"config":      slaveResp.Config,
		"qr_code":     slaveResp.QRCode,
		"vpn_uri":     slaveResp.VPNURI,
		"vpn_qr_code": slaveResp.VPNQRCode,
		"created_at":  keyRecord.CreatedAt,
	})
}

func (s *Server) handleGetKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid key ID"})
		return
	}

	keyRecord, err := s.storage.GetClientConfigByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Key not found"})
		return
	}

	// Verify ownership unless admin
	if keyRecord.UserID != claims.UserID && claims.Role != models.RoleAdmin {
		s.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Access denied"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), keyRecord.NodeID)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	slaveResp, err := slaveCli.GetClient(r.Context(), keyRecord.ClientName)
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to retrieve config from slave: %v", err)})
		return
	}

	cleanKeyConfig := runner.SanitizeAWGConfig(slaveResp.Config)
	if cleanKeyConfig != "" {
		slaveResp.Config = cleanKeyConfig
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_view", fmt.Sprintf("Просмотр конфигурации / QR-кода ключа «%s» (%s)", keyRecord.DeviceName, keyRecord.ClientName))

	s.writeJSON(w, http.StatusOK, map[string]any{
		"id":          keyRecord.ID,
		"client_name": keyRecord.ClientName,
		"device_name": keyRecord.DeviceName,
		"node_id":     node.ID,
		"node_name":   node.Name,
		"node_type":   node.Type,
		"config":      slaveResp.Config,
		"qr_code":     slaveResp.QRCode,
		"vpn_uri":     slaveResp.VPNURI,
		"vpn_qr_code": slaveResp.VPNQRCode,
		"created_at":  keyRecord.CreatedAt,
	})
}

func (s *Server) handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid key ID"})
		return
	}

	keyRecord, err := s.storage.GetClientConfigByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Key not found"})
		return
	}

	if keyRecord.UserID != claims.UserID && claims.Role != models.RoleAdmin {
		s.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Access denied"})
		return
	}

	// Delete from Slave
	node, err := s.storage.GetNodeByID(r.Context(), keyRecord.NodeID)
	if err == nil {
		slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
		_ = slaveCli.DeleteClient(r.Context(), keyRecord.ClientName)
	}

	if err := s.storage.DeleteClientConfig(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_delete", fmt.Sprintf("Отозван и удален VPN-ключ «%s» (%s)", keyRecord.DeviceName, keyRecord.ClientName))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Key successfully deleted",
	})
}

// Admin: Users
func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.storage.ListUsers(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleAdminActivateUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	if err := s.storage.SetUserActive(r.Context(), id, true); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_activate", fmt.Sprintf("Активирован доступ для пользователя «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User activated"})
}

func (s *Server) handleAdminDeactivateUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	if err := s.storage.SetUserActive(r.Context(), id, false); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_deactivate", fmt.Sprintf("Заблокирован доступ для пользователя «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User deactivated"})
}

func (s *Server) handleAdminSetUserRole(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	var req models.SetRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if err := s.storage.SetUserRole(r.Context(), id, req.Role); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_role", fmt.Sprintf("Изменена роль пользователя «%s» (ID #%d) на «%s»", targetUsername, id, req.Role))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Роль пользователя изменена на %s", req.Role),
	})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	if err := s.storage.DeleteUser(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_delete", fmt.Sprintf("Удален пользователь «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User deleted"})
}

// Admin: Nodes
func (s *Server) handleAdminListNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.storage.ListNodes(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	res := []models.NodeWithStatus{}
	for _, n := range nodes {
		slaveCli := client.NewSlaveClient(n.APIURL, n.APIKey)
		start := time.Now()
		health, hErr := slaveCli.CheckHealth(r.Context())
		latency := time.Since(start).Milliseconds()
		isOnline := hErr == nil && health != nil && health.Status == "ok"
		if !isOnline {
			latency = 0
		}
		res = append(res, models.NodeWithStatus{
			Node:      n,
			Online:    isOnline,
			LatencyMs: latency,
		})
	}

	s.writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleAdminRestartNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.Restart(r.Context()); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Restart failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_restart", fmt.Sprintf("Перезапущен сервис AmneziaWG на узле «%s» (ID #%d)", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Node '%s' AWG service restarted successfully", node.Name),
	})
}

func (s *Server) handleAdminBackupNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	backup, err := slaveCli.Backup(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Backup failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_backup", fmt.Sprintf("Выгружена резервная копия конфигурации узла «%s» (ID #%d)", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, backup)
}

func (s *Server) handleAdminRestoreNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	var req models.RestoreNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
		return
	}
	if req.BackupData == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "backup_data is required"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.Restore(r.Context(), req.BackupData); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Restore failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_restore", fmt.Sprintf("Восстановлена конфигурация узла «%s» (ID #%d) из резервной копии", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Node '%s' restored successfully from backup", node.Name),
	})
}

func (s *Server) handleAdminGetNodeEgress(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Node is not a cascade node"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	egress, err := slaveCli.GetCascadeEgress(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to get egress status: %v", err)})
		return
	}

	s.writeJSON(w, http.StatusOK, egress)
}

func (s *Server) handleAdminSwitchNodeEgress(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Node is not a cascade node"})
		return
	}

	var req models.SwitchEgressRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
		return
	}
	if req.Interface == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "interface is required (e.g. 'awg1' or 'awg3')"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.SwitchCascadeEgress(r.Context(), req.Interface); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to switch egress: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_switch_egress", fmt.Sprintf("Переключен шлюз выхода каскада для узла «%s» (ID #%d) на интерфейс %s", node.Name, node.ID, req.Interface))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Cascade egress on node '%s' switched to %s", node.Name, req.Interface),
	})
}


func (s *Server) handleAdminAddNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.AddNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.APIURL = strings.TrimSpace(req.APIURL)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.Type = strings.TrimSpace(req.Type)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.ProviderURL = strings.TrimSpace(req.ProviderURL)

	if req.Name == "" || req.APIURL == "" || req.APIKey == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name, API URL, and API Key are required"})
		return
	}

	if req.Type != "cascade" && req.Type != "direct" {
		req.Type = "direct"
	}

	node, err := s.storage.CreateNode(r.Context(), req.Name, req.Type, req.CountryCode, req.ProviderURL, req.APIURL, req.APIKey, req.IsMobileOptimized)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	mobileTag := ""
	if node.IsMobileOptimized {
		mobileTag = " [Mobile 443/UDP]"
	}
	countryTag := ""
	if node.CountryCode != "" {
		countryTag = fmt.Sprintf(" [%s]", node.CountryCode)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_create", fmt.Sprintf("Добавлен новый сервер «%s» (%s%s%s, URL: %s)", node.Name, node.Type, countryTag, mobileTag, node.APIURL))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusCreated, node)
}

func (s *Server) handleAdminUpdateNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	var req models.UpdateNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.APIURL = strings.TrimSpace(req.APIURL)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.Type = strings.TrimSpace(req.Type)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.ProviderURL = strings.TrimSpace(req.ProviderURL)

	if req.Name == "" || req.APIURL == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name and API URL are required"})
		return
	}

	if req.Type != "cascade" && req.Type != "direct" {
		req.Type = "direct"
	}

	node, err := s.storage.UpdateNode(r.Context(), id, req.Name, req.Type, req.CountryCode, req.ProviderURL, req.APIURL, req.APIKey, req.IsMobileOptimized)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	mobileTag := ""
	if node.IsMobileOptimized {
		mobileTag = " [Mobile 443/UDP]"
	}
	countryTag := ""
	if node.CountryCode != "" {
		countryTag = fmt.Sprintf(" [%s]", node.CountryCode)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_update", fmt.Sprintf("Обновлены параметры сервера «%s» (ID #%d, %s%s%s, URL: %s)", node.Name, node.ID, node.Type, countryTag, mobileTag, node.APIURL))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleAdminDeleteNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, _ := s.storage.GetNodeByID(r.Context(), id)
	nodeName := ""
	if node != nil {
		nodeName = node.Name
	}

	if err := s.storage.DeleteNode(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_delete", fmt.Sprintf("Удален сервер «%s» (ID #%d)", nodeName, id))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "Node deleted"})
}

func (s *Server) handleAdminListAllKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.storage.ListAllClientConfigs(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Filter by search and node_id
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	nodeIDStr := strings.TrimSpace(r.URL.Query().Get("node_id"))
	var filterNodeID int64
	if nodeIDStr != "" {
		filterNodeID, _ = strconv.ParseInt(nodeIDStr, 10, 64)
	}

	var filtered []models.ClientConfig
	for _, k := range keys {
		if filterNodeID > 0 && k.NodeID != filterNodeID {
			continue
		}
		if search != "" {
			matchDevice := strings.Contains(strings.ToLower(k.DeviceName), search)
			matchClient := strings.Contains(strings.ToLower(k.ClientName), search)
			matchNode := strings.Contains(strings.ToLower(k.NodeName), search)
			matchUser := strings.Contains(strings.ToLower(k.Username), search)
			if !matchDevice && !matchClient && !matchNode && !matchUser {
				continue
			}
		}
		filtered = append(filtered, k)
	}

	// Guarantee reverse sort by ID (newest keys first)
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].ID > filtered[j].ID
	})

	// Pagination
	page := 1
	limit := 10
	if pStr := r.URL.Query().Get("page"); pStr != "" {
		if p, pErr := strconv.Atoi(pStr); pErr == nil && p > 0 {
			page = p
		}
	}
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, lErr := strconv.Atoi(lStr); lErr == nil && l > 0 {
			limit = l
		}
	}

	totalCount := len(filtered)
	totalPages := (totalCount + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	startIndex := (page - 1) * limit
	var pagedKeys []models.ClientConfig
	if startIndex < totalCount {
		endIndex := startIndex + limit
		if endIndex > totalCount {
			endIndex = totalCount
		}
		pagedKeys = filtered[startIndex:endIndex]
	} else {
		pagedKeys = []models.ClientConfig{}
	}

	s.writeJSON(w, http.StatusOK, models.PaginatedKeysResponse{
		Keys:       pagedKeys,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	})
}

// Admin: Audit Logs
func (s *Server) handleAdminListAuditLogs(w http.ResponseWriter, r *http.Request) {
	var filter models.AuditLogFilter

	if uidStr := strings.TrimSpace(r.URL.Query().Get("user_id")); uidStr != "" {
		if uid, err := strconv.ParseInt(uidStr, 10, 64); err == nil && uid > 0 {
			filter.UserID = &uid
		}
	}

	filter.Username = strings.TrimSpace(r.URL.Query().Get("username"))
	filter.Category = strings.TrimSpace(r.URL.Query().Get("category"))
	filter.Action = strings.TrimSpace(r.URL.Query().Get("action"))
	filter.FromDate = strings.TrimSpace(r.URL.Query().Get("from"))
	filter.ToDate = strings.TrimSpace(r.URL.Query().Get("to"))

	page := 1
	limit := 50
	if pStr := r.URL.Query().Get("page"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil && p > 0 {
			page = p
		}
	}
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	filter.Page = page
	filter.Limit = limit

	logs, totalCount, err := s.storage.ListAuditLogs(r.Context(), filter)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	totalPages := (totalCount + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	s.writeJSON(w, http.StatusOK, models.PaginatedAuditLogsResponse{
		Logs:       logs,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	})
}

func (s *Server) handleAdminCleanupAuditLogs(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.CleanupLogsRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	days := req.Days
	if days <= 0 {
		days = 90 // Default 3 months
	}

	deleted, err := s.storage.PurgeAuditLogsOlderThan(r.Context(), days)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_logs_cleanup", fmt.Sprintf("Очищен журнал аудита старше %d дней (удалено записей: %d)", days, deleted))

	s.writeJSON(w, http.StatusOK, models.CleanupLogsResponse{
		Success:      true,
		Message:      fmt.Sprintf("Успешно удалено записей старше %d дней: %d", days, deleted),
		DeletedCount: deleted,
	})
}

func (s *Server) logActivity(r *http.Request, userID *int64, username string, category models.AuditLogCategory, action string, details string) {
	ip := getIPAddress(r)
	if username == "" {
		username = "anonymous"
	}
	logEntry := &models.AuditLog{
		UserID:    userID,
		Username:  username,
		Action:    action,
		Category:  category,
		IPAddress: ip,
		Details:   details,
	}
	_ = s.storage.CreateAuditLog(r.Context(), logEntry)
}

func getIPAddress(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(ip); err == nil {
		return host
	}
	return ip
}

func formatBytes(b int64) string {
	if b <= 0 {
		return "0 B"
	}
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func (s *Server) invalidateDashboardCache() {
	s.dashCache.mu.Lock()
	s.dashCache.data = nil
	s.dashCache.cachedAt = time.Time{}
	s.dashCache.mu.Unlock()
}

func (s *Server) handleGetDashboardStats(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	isFresh := r.URL.Query().Get("fresh") == "true" || r.URL.Query().Get("force") == "true"

	if isFresh && s.healthChecker != nil {
		s.healthChecker.CollectTelemetry(r.Context())
	}

	var stats *models.DashboardStatsResponse
	if s.healthChecker != nil {
		stats = s.healthChecker.GetLatestDashboardStats(r.Context())
	}

	if stats == nil {
		users, _ := s.storage.ListUsers(r.Context())
		allConfigs, _ := s.storage.ListAllClientConfigs(r.Context())
		nodes, _ := s.storage.ListNodes(r.Context())
		activeUsers := 0
		pendingUsers := 0
		for _, u := range users {
			if u.IsActive {
				activeUsers++
			} else {
				pendingUsers++
			}
		}

		stats = &models.DashboardStatsResponse{
			TotalUsers:            len(users),
			ActiveUsers:           activeUsers,
			PendingUsers:          pendingUsers,
			TotalKeys:             len(allConfigs),
			TotalNodes:            len(nodes),
			OnlineNodes:           len(nodes),
			SystemStatus:          "operational",
			GeneratedAt:           time.Now().UTC(),
			TotalTrafficFormatted: "0 B",
			MonthTrafficFormatted: "0 B",
		}
	}

	respCopy := *stats
	if claims == nil || claims.Role != models.RoleAdmin {
		respCopy.PendingUsers = 0
	}

	s.writeJSON(w, http.StatusOK, respCopy)
}

// Billing Handlers

func (s *Server) handleGetBillingStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handlePayDues(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.PayDuesRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	rec, err := s.storage.RecordPayment(r.Context(), claims.UserID, claims.Username, req.Amount, req.Note)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	details := fmt.Sprintf("Подтверждение оплаты взноса: период %s", rec.PeriodMonth)
	if req.Note != "" {
		details += fmt.Sprintf(" (%s)", req.Note)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryBilling, "payment_recorded", details)

	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSnoozeDues(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.SnoozeDuesRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Days <= 0 {
		req.Days = 1
	}

	if err := s.storage.SnoozeBillingReminder(r.Context(), claims.UserID, req.Days); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryBilling, "reminder_snoozed", fmt.Sprintf("Напоминание о взносе отложено на %d дн.", req.Days))

	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleAdminGetBilling(w http.ResponseWriter, r *http.Request) {
	summary, err := s.storage.GetAllBillingRecords(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleGetBillingRequisites(w http.ResponseWriter, r *http.Request) {
	reqs, err := s.storage.GetBillingRequisites(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, reqs)
}

func (s *Server) handleAdminUpdateBillingRequisites(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.BillingRequisites
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	updated, err := s.storage.UpdateBillingRequisites(r.Context(), req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "billing_requisites_update", fmt.Sprintf("Обновлены платежные реквизиты: СБП %s (%s)", updated.SBPPhone, updated.SBPBank))

	s.writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleAdminGetTelegramStatus(w http.ResponseWriter, r *http.Request) {
	chats, err := s.storage.ListTelegramChats(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	botUsername := s.cfg.TelegramBotUsername
	var settings *models.TelegramSettings
	isEnabled := false
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		settings = &snap
		if snap.BotUsername != "" {
			botUsername = snap.BotUsername
		}
		isEnabled = s.telegramBot.IsEnabled()
	} else {
		dbSettings, err := s.storage.GetTelegramSettings(r.Context())
		if err == nil && dbSettings != nil {
			settings = dbSettings
			if dbSettings.BotUsername != "" {
				botUsername = dbSettings.BotUsername
			}
			isEnabled = dbSettings.Enabled
		}
	}

	s.writeJSON(w, http.StatusOK, models.TelegramStatusResponse{
		Enabled:          isEnabled,
		BotUsername:      botUsername,
		Settings:         settings,
		Subscribers:      chats,
		TotalSubscribers: len(chats),
	})
}

func (s *Server) handleAdminGetTelegramSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.storage.GetTelegramSettings(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Also sync live bot username if known
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		if snap.BotUsername != "" && settings.BotUsername == "" {
			settings.BotUsername = snap.BotUsername
		}
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleAdminUpdateTelegramSettings(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.TelegramSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	req.BotToken = strings.TrimSpace(req.BotToken)
	req.BotUsername = strings.TrimSpace(req.BotUsername)
	req.AdminSecret = strings.TrimSpace(req.AdminSecret)

	// If token is provided and enabled, validate with Telegram getMe API
	if req.Enabled && req.BotToken != "" && s.telegramBot != nil {
		detectedUsername, _, err := s.telegramBot.ValidateToken(req.BotToken)
		if err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("Ошибка валидации токена Telegram: %v", err)})
			return
		}
		if detectedUsername != "" {
			req.BotUsername = detectedUsername
		}
	}

	saved, err := s.storage.UpdateTelegramSettings(r.Context(), req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Hot reload running Telegram bot instance
	if s.telegramBot != nil {
		_ = s.telegramBot.UpdateConfig(context.Background(), *saved)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_settings_update", fmt.Sprintf("Обновлены настройки Telegram-бота @%s (Enabled: %v)", saved.BotUsername, saved.Enabled))

	s.writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleAdminDeleteTelegramSubscriber(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chat ID"})
		return
	}

	if err := s.storage.DeleteTelegramChat(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_subscriber_delete", fmt.Sprintf("Удален получатель Telegram-оповещений (Chat ID #%d)", id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Получатель успешно удален из списка рассылки",
	})
}

func (s *Server) handleAdminToggleTelegramSubscriber(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chat ID"})
		return
	}

	var req models.TelegramSubscriberToggleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if err := s.storage.SetTelegramAlertsEnabled(r.Context(), id, req.AlertsEnabled); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	statusText := "отключены"
	if req.AlertsEnabled {
		statusText = "включены"
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_subscriber_toggle", fmt.Sprintf("Оповещения для Telegram-чата #%d %s", id, statusText))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Оповещения для чата %s", statusText),
	})
}

func (s *Server) handleAdminSendTelegramTest(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	if s.telegramBot == nil || !s.telegramBot.IsEnabled() {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Telegram bot is not configured or disabled"})
		return
	}

	if err := s.telegramBot.SendTestAlert(0); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Failed to send test alert: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_test", "Отправлено тестовое оповещение в Telegram")
	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Тестовое оповещение успешно отправлено во все привязанные Telegram-чаты",
	})
}

func (s *Server) handleGetUserTelegramStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	botUsername := s.cfg.TelegramBotUsername
	botEnabled := false
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		botEnabled = s.telegramBot.IsEnabled()
		if snap.BotUsername != "" {
			botUsername = snap.BotUsername
		}
	} else {
		dbSettings, err := s.storage.GetTelegramSettings(r.Context())
		if err == nil && dbSettings != nil {
			if dbSettings.BotUsername != "" {
				botUsername = dbSettings.BotUsername
			}
			botEnabled = dbSettings.Enabled
		}
	}

	chat, _ := s.storage.GetTelegramChatByUserID(r.Context(), claims.UserID)
	isLinked := chat != nil
	var chatID *int64
	tgUsername := ""
	alertsEnabled := false
	if chat != nil {
		chatID = &chat.ChatID
		tgUsername = chat.Username
		alertsEnabled = chat.AlertsEnabled
	}

	token, _ := s.storage.GetOrCreateTelegramLinkToken(r.Context(), claims.UserID)
	deepLink := ""
	if botUsername != "" {
		deepLink = fmt.Sprintf("https://t.me/%s?start=link_%s", botUsername, token)
	}

	s.writeJSON(w, http.StatusOK, models.UserTelegramStatusResponse{
		BotUsername:      botUsername,
		BotEnabled:       botEnabled,
		IsLinked:         isLinked,
		TelegramChatID:   chatID,
		TelegramUsername: tgUsername,
		AlertsEnabled:    alertsEnabled,
		DeepLink:         deepLink,
	})
}

func (s *Server) handleUserUnlinkTelegram(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	chat, err := s.storage.GetTelegramChatByUserID(r.Context(), claims.UserID)
	if err == nil && chat != nil {
		_ = s.storage.DeleteTelegramChat(r.Context(), chat.ChatID)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAuth, "user_telegram_unlink", "Отвязан Telegram-чат пользователя")

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Telegram успешно отвязан от вашего аккаунта",
	})
}

// News Handlers

func (s *Server) handleListNews(w http.ResponseWriter, r *http.Request) {
	news, err := s.storage.ListNews(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Ошибка получения списка новостей"})
		return
	}
	s.writeJSON(w, http.StatusOK, news)
}

func (s *Server) handleAdminCreateNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.CreateNewsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный формат данных"})
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	if req.Title == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заголовок новости не может быть пустым"})
		return
	}
	if req.Content == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Текст новости не может быть пустым"})
		return
	}

	if req.Category == "" {
		req.Category = models.NewsCategoryGeneral
	}

	item := &models.NewsItem{
		Title:          req.Title,
		Content:        req.Content,
		Category:       req.Category,
		IsPinned:       req.IsPinned,
		AuthorName:     claims.Username,
		NotifyTelegram: req.NotifyTelegram,
	}

	created, err := s.storage.CreateNews(r.Context(), item)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка сохранения новости: %v", err)})
		return
	}

	// If notify_telegram is enabled, broadcast via Telegram Bot to subscribers
	if req.NotifyTelegram && s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go func(ni models.NewsItem) {
			if err := s.telegramBot.BroadcastNews(ni); err != nil {
				log.Printf("[MASTER NEWS] Telegram broadcast error: %v", err)
			}
		}(*created)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_create", fmt.Sprintf("Опубликована новость «%s» (ID #%d, TG: %v)", created.Title, created.ID, req.NotifyTelegram))

	s.writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleAdminUpdateNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный ID новости"})
		return
	}

	var req models.UpdateNewsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный формат данных"})
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	if req.Title == "" || req.Content == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заголовок и текст не могут быть пустыми"})
		return
	}

	if req.Category == "" {
		req.Category = models.NewsCategoryGeneral
	}

	updated, err := s.storage.UpdateNews(r.Context(), id, req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка обновления новости: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_update", fmt.Sprintf("Отредактирована новость «%s» (ID #%d)", updated.Title, updated.ID))

	s.writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleAdminDeleteNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный ID новости"})
		return
	}

	existing, _ := s.storage.GetNewsByID(r.Context(), id)
	title := ""
	if existing != nil {
		title = existing.Title
	}

	if err := s.storage.DeleteNews(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка удаления новости: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_delete", fmt.Sprintf("Удалена новость «%s» (ID #%d)", title, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Новость успешно удалена",
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}





