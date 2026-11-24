package master

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/monitor"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/retention"
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
	Port                   string
	JWTSecret              string
	TelegramBotToken       string
	TelegramBotUsername    string
	TelegramAdminChatID    string
	TelegramAdminSecret    string
	HealthCheckInterval    time.Duration
	HealthCheckTimeout     time.Duration
	AuditRetentionDays     int
	TelemetryRetentionDays int
}

// Server is the Master Backend API server.
type Server struct {
	cfg             Config
	storage         *storage.Storage
	jwtMgr          *auth.JWTManager
	mux             *http.ServeMux
	telegramBot     *telegram.Bot
	healthChecker   *monitor.HealthChecker
	retentionWorker *retention.Worker
	dashCache       dashboardCache
	authLimiter     *IPRateLimiter
	resetLimiter    *IPRateLimiter
	miniAppLimiter  *IPRateLimiter
}

// NewServer creates a new Master server instance.
func NewServer(cfg Config, s *storage.Storage) *Server {
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, 0)

	srv := &Server{
		cfg:            cfg,
		storage:        s,
		jwtMgr:         jwtMgr,
		mux:            http.NewServeMux(),
		authLimiter:    NewIPRateLimiter(5, time.Minute),
		resetLimiter:   NewIPRateLimiter(3, time.Minute),
		miniAppLimiter: NewIPRateLimiter(15, time.Minute),
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
		Storage:  s,
		Bot:      srv.telegramBot,
		Interval: cfg.HealthCheckInterval,
		Timeout:  cfg.HealthCheckTimeout,
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

	retentionCfg := retention.Config{
		AuditDays:     cfg.AuditRetentionDays,
		TelemetryDays: cfg.TelemetryRetentionDays,
		Interval:      24 * time.Hour,
		InitialDelay:  10 * time.Second,
	}
	srv.retentionWorker = retention.NewWorker(s, retentionCfg)

	srv.routes()
	return srv
}

// StartBackgroundWorkers launches Telegram bot polling, HealthChecker, and Retention Worker.
func (s *Server) StartBackgroundWorkers(ctx context.Context) {
	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		s.telegramBot.Start(ctx)
	}
	if s.healthChecker != nil {
		s.healthChecker.Start(ctx)
	}
	if s.retentionWorker != nil {
		s.retentionWorker.Start(ctx)
	}
}

// StopBackgroundWorkers gracefully stops background workers.
func (s *Server) StopBackgroundWorkers() {
	if s.retentionWorker != nil {
		s.retentionWorker.Stop()
	}
	if s.healthChecker != nil {
		s.healthChecker.Stop()
	}
	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		s.telegramBot.Stop()
	}
	if s.authLimiter != nil {
		s.authLimiter.Stop()
	}
	if s.resetLimiter != nil {
		s.resetLimiter.Stop()
	}
	if s.miniAppLimiter != nil {
		s.miniAppLimiter.Stop()
	}
}

// Handler returns the HTTP handler with global middleware.
func (s *Server) Handler() http.Handler {
	return s.securityHeadersMiddleware(s.corsMiddleware(s.maxBytesMiddleware(1<<20, s.jwtMgr.AuthMiddleware(s.mux))))
}

func (s *Server) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; frame-ancestors 'self' https://web.telegram.org;")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) maxBytesMiddleware(maxBytes int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) rateLimitMiddleware(limiter *IPRateLimiter, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if limiter != nil {
			ip := GetClientIP(r)
			allowed, retryAfter := limiter.Allow(ip)
			if !allowed {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())+1))
				s.writeJSON(w, http.StatusTooManyRequests, map[string]string{
					"error": "Слишком много запросов. Пожалуйста, повторите попытку через минуту.",
				})
				return
			}
		}
		next(w, r)
	}
}

func (s *Server) decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			s.writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "Размер тела запроса превышает допустимый лимит (1 МБ)",
			})
			return false
		}
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return false
	}
	return true
}

// GetTelegramBot returns the internal Telegram Bot instance.
func (s *Server) GetTelegramBot() *telegram.Bot {
	return s.telegramBot
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
	s.mux.HandleFunc("POST /api/v1/auth/register", s.rateLimitMiddleware(s.authLimiter, s.handleRegister))
	s.mux.HandleFunc("POST /api/v1/auth/login", s.rateLimitMiddleware(s.authLimiter, s.handleLogin))
	s.mux.HandleFunc("POST /api/v1/auth/reset-password", s.rateLimitMiddleware(s.resetLimiter, s.handleResetPasswordRequest))
	s.mux.HandleFunc("POST /api/v1/auth/telegram-miniapp", s.rateLimitMiddleware(s.miniAppLimiter, s.handleTelegramMiniAppAuth))

	// User Authenticated Routes
	s.mux.HandleFunc("GET /api/v1/auth/me", auth.RequireAuth(s.handleMe))
	s.mux.HandleFunc("PUT /api/v1/auth/profile", auth.RequireAuth(s.handleUpdateProfile))
	s.mux.HandleFunc("GET /api/v1/nodes", auth.RequireAuth(s.handleListActiveNodes))
	s.mux.HandleFunc("GET /api/v1/proxies/telegram", auth.RequireAuth(s.handleGetTelegramProxies))
	s.mux.HandleFunc("GET /api/v1/keys", auth.RequireAuth(s.handleListUserKeys))
	s.mux.HandleFunc("POST /api/v1/keys", auth.RequireAuth(s.handleCreateKey))
	s.mux.HandleFunc("GET /api/v1/keys/{id}", auth.RequireAuth(s.handleGetKey))
	s.mux.HandleFunc("DELETE /api/v1/keys/{id}", auth.RequireAuth(s.handleDeleteKey))

	// Admin Routes
	s.mux.HandleFunc("GET /api/v1/admin/users", auth.RequireAdmin(s.handleAdminListUsers))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/activate", auth.RequireAdmin(s.handleAdminActivateUser))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/deactivate", auth.RequireAdmin(s.handleAdminDeactivateUser))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/role", auth.RequireAdmin(s.handleAdminSetUserRole))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/pro", auth.RequireAdmin(s.handleAdminSetUserPro))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/approve-password-reset", auth.RequireAdmin(s.handleAdminApprovePasswordReset))
	s.mux.HandleFunc("POST /api/v1/admin/users/{id}/reject-password-reset", auth.RequireAdmin(s.handleAdminRejectPasswordReset))
	s.mux.HandleFunc("DELETE /api/v1/admin/users/{id}", auth.RequireAdmin(s.handleAdminDeleteUser))

	s.mux.HandleFunc("GET /api/v1/admin/nodes", auth.RequireAdmin(s.handleAdminListNodes))
	s.mux.HandleFunc("GET /api/v1/admin/nodes/{id}", auth.RequireAdmin(s.handleAdminGetNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/diagnose", auth.RequireAdmin(s.handleAdminDiagnoseNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes", auth.RequireAdmin(s.handleAdminAddNode))
	s.mux.HandleFunc("PUT /api/v1/admin/nodes/{id}", auth.RequireAdmin(s.handleAdminUpdateNode))
	s.mux.HandleFunc("DELETE /api/v1/admin/nodes/{id}", auth.RequireAdmin(s.handleAdminDeleteNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/restart", auth.RequireAdmin(s.handleAdminRestartNode))
	s.mux.HandleFunc("GET /api/v1/admin/nodes/{id}/backup", auth.RequireAdmin(s.handleAdminBackupNode))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/restore", auth.RequireAdmin(s.handleAdminRestoreNode))
	s.mux.HandleFunc("GET /api/v1/admin/nodes/{id}/egress", auth.RequireAdmin(s.handleAdminGetNodeEgress))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/egress", auth.RequireAdmin(s.handleAdminSwitchNodeEgress))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/egress/restart", auth.RequireAdmin(s.handleAdminRestartNodeEgress))
	s.mux.HandleFunc("POST /api/v1/admin/nodes/{id}/failover", auth.RequireAdmin(s.handleAdminUpdateNodeFailover))

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
		Version: "v1.9.0",
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
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
