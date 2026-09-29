package models

import "time"

// Role represents a user role.
type Role string

const (
	RoleAdmin Role = "admin"
	RoleUser  Role = "user"
)

// User represents a user account in the system.
type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}

// UserPublic represents user data safe for API responses.
type UserPublic struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Role      Role      `json:"role"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

// Node represents a managed Slave API node (Cascade or Direct).
type Node struct {
	ID                int64     `json:"id"`
	Name              string    `json:"name"`
	Type              string    `json:"type"` // "cascade" or "direct"
	CountryCode       string    `json:"country_code"` // e.g. "NLD", "DEU", "USA"
	ProviderURL       string    `json:"provider_url"` // e.g. "https://aeza.net"
	APIURL            string    `json:"api_url"`
	APIKey            string    `json:"-"` // Hidden in public responses
	IsMobileOptimized bool      `json:"is_mobile_optimized"`
	IsActive          bool      `json:"is_active"`
	CreatedAt         time.Time `json:"created_at"`
}

// NodePublic represents safe node info for regular users.
type NodePublic struct {
	ID                int64     `json:"id"`
	Name              string    `json:"name"`
	Type              string    `json:"type"`
	CountryCode       string    `json:"country_code"`
	IsMobileOptimized bool      `json:"is_mobile_optimized"`
	IsActive          bool      `json:"is_active"`
	CreatedAt         time.Time `json:"created_at"`
}

// NodeWithStatus represents node with live connectivity & ping.
type NodeWithStatus struct {
	Node
	Online    bool  `json:"online"`
	LatencyMs int64 `json:"latency_ms"`
}

// ClientConfig represents a user's VPN key reference in the database and audit logs.
type ClientConfig struct {
	ID                    int64     `json:"id"`
	UserID                int64     `json:"user_id"`
	Username              string    `json:"username,omitempty"`
	NodeID                int64     `json:"node_id"`
	ClientName            string    `json:"client_name"` // e.g. "u1_iphone"
	DeviceName            string    `json:"device_name"` // e.g. "iPhone"
	PublicKey             string    `json:"public_key,omitempty"`
	AllocatedIP           string    `json:"allocated_ip,omitempty"`
	NodeName              string    `json:"node_name,omitempty"`
	NodeType              string    `json:"node_type,omitempty"`
	NodeCountryCode       string    `json:"node_country_code,omitempty"`
	LastHandshake         string    `json:"last_handshake,omitempty"`
	LastHandshakeEpoch    int64     `json:"last_handshake_epoch,omitempty"`
	IsOnline              bool      `json:"is_online,omitempty"`
	TotalTrafficBytes     int64     `json:"total_traffic_bytes,omitempty"`
	MonthTrafficBytes     int64     `json:"month_traffic_bytes,omitempty"`
	TotalTrafficFormatted string    `json:"total_traffic_formatted,omitempty"`
	MonthTrafficFormatted string    `json:"month_traffic_formatted,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
}

// PaginatedKeysResponse for Admin key audit list.
type PaginatedKeysResponse struct {
	Keys       []ClientConfig `json:"keys"`
	TotalCount int            `json:"total_count"`
	Page       int            `json:"page"`
	Limit      int            `json:"limit"`
	TotalPages int            `json:"total_pages"`
}

// Auth DTOs
type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string     `json:"token"`
	User  UserPublic `json:"user"`
}

type CreateKeyRequest struct {
	NodeID     int64  `json:"node_id"`
	DeviceName string `json:"device_name"`
	PSK        bool   `json:"psk,omitempty"`
}

type AddNodeRequest struct {
	Name              string `json:"name"`
	Type              string `json:"type"` // "cascade" or "direct"
	CountryCode       string `json:"country_code"`
	ProviderURL       string `json:"provider_url"`
	APIURL            string `json:"api_url"`
	APIKey            string `json:"api_key"`
	IsMobileOptimized bool   `json:"is_mobile_optimized"`
}

type UpdateNodeRequest struct {
	Name              string `json:"name"`
	Type              string `json:"type"`
	CountryCode       string `json:"country_code"`
	ProviderURL       string `json:"provider_url"`
	APIURL            string `json:"api_url"`
	APIKey            string `json:"api_key,omitempty"` // If empty, keep existing key
	IsMobileOptimized bool   `json:"is_mobile_optimized"`
}

type RestoreNodeRequest struct {
	BackupData string `json:"backup_data"`
}

type UpdateProfileRequest struct {
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

type SetRoleRequest struct {
	Role Role `json:"role"`
}

// AuditLogCategory represents the category of the logged action.
type AuditLogCategory string

const (
	CategoryAuth    AuditLogCategory = "auth"
	CategoryKeys    AuditLogCategory = "keys"
	CategoryProfile AuditLogCategory = "profile"
	CategoryAdmin   AuditLogCategory = "admin"
	CategoryBilling AuditLogCategory = "billing"
	CategorySystem  AuditLogCategory = "system"
)

// BillingRecord represents a recorded payment/dues entry in the system.
type BillingRecord struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	Username    string    `json:"username"`
	Amount      float64   `json:"amount"`
	Currency    string    `json:"currency"`
	PeriodMonth string    `json:"period_month"` // e.g. "2026-09"
	Status      string    `json:"status"`       // "confirmed", "pending"
	Note        string    `json:"note"`
	CreatedAt   time.Time `json:"created_at"`
}

// BillingStatusResponse represents current user's dues state and reminder countdown.
type BillingStatusResponse struct {
	IsDue             bool            `json:"is_due"`
	DaysRemaining     int             `json:"days_remaining"`
	NextDueAt         time.Time       `json:"next_due_at"`
	LastPaidAt        *time.Time      `json:"last_paid_at,omitempty"`
	SnoozedUntil      *time.Time      `json:"snoozed_until,omitempty"`
	Status            string          `json:"status"` // "paid", "due", "snoozed"
	KeyCount          int             `json:"key_count"`
	RecommendedAmount float64         `json:"recommended_amount"`
	History           []BillingRecord `json:"history"`
}

// PayDuesRequest DTO for confirming dues payment.
type PayDuesRequest struct {
	Amount float64 `json:"amount,omitempty"`
	Note   string  `json:"note,omitempty"`
}

// SnoozeDuesRequest DTO for postponing the reminder.
type SnoozeDuesRequest struct {
	Days int `json:"days,omitempty"` // Default 3
}

// AdminBillingSummaryResponse for admin billing overview.
type AdminBillingSummaryResponse struct {
	TotalPayments  int             `json:"total_payments"`
	UsersDueCount  int             `json:"users_due_count"`
	TotalUsers     int             `json:"total_users"`
	Records        []BillingRecord `json:"records"`
}

// AuditLog represents a single action performed in the system.
type AuditLog struct {
	ID        int64            `json:"id"`
	UserID    *int64           `json:"user_id,omitempty"`
	Username  string           `json:"username"`
	Action    string           `json:"action"`
	Category  AuditLogCategory `json:"category"`
	IPAddress string           `json:"ip_address,omitempty"`
	Details   string           `json:"details,omitempty"`
	CreatedAt time.Time        `json:"created_at"`
}

// PaginatedAuditLogsResponse represents paginated audit logs for the admin UI.
type PaginatedAuditLogsResponse struct {
	Logs       []AuditLog `json:"logs"`
	TotalCount int        `json:"total_count"`
	Page       int        `json:"page"`
	Limit      int        `json:"limit"`
	TotalPages int        `json:"total_pages"`
}

// AuditLogFilter contains filter criteria for querying logs.
type AuditLogFilter struct {
	UserID   *int64
	Username string
	Category string
	Action   string
	FromDate string // YYYY-MM-DD or RFC3339
	ToDate   string // YYYY-MM-DD or RFC3339
	Page     int
	Limit    int
}

// CleanupLogsRequest for pruning old logs.
type CleanupLogsRequest struct {
	Days int `json:"days"`
}

// CleanupLogsResponse returns number of deleted logs.
type CleanupLogsResponse struct {
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	DeletedCount int64  `json:"deleted_count"`
}

// TopologyTrafficBreakdown represents traffic share by node type.
type TopologyTrafficBreakdown struct {
	CascadeTrafficBytes     int64  `json:"cascade_traffic_bytes"`
	DirectTrafficBytes      int64  `json:"direct_traffic_bytes"`
	CascadeTrafficFormatted string `json:"cascade_traffic_formatted"`
	DirectTrafficFormatted  string `json:"direct_traffic_formatted"`
	CascadePercentage       int    `json:"cascade_percentage"`
	DirectPercentage        int    `json:"direct_percentage"`
}

// NodeDashboardInfo represents individual node status in the dashboard overview.
type NodeDashboardInfo struct {
	ID                    int64  `json:"id"`
	Name                  string `json:"name"`
	Type                  string `json:"type"`
	CountryCode           string `json:"country_code"`
	Online                bool   `json:"online"`
	LatencyMs             int64  `json:"latency_ms"`
	PeerCount             int    `json:"peer_count"`
	TotalTrafficFormatted string `json:"total_traffic_formatted"`
}

// DashboardStatsResponse represents aggregated public & admin status metrics.
type DashboardStatsResponse struct {
	TotalUsers            int                      `json:"total_users"`
	ActiveUsers           int                      `json:"active_users"`
	PendingUsers          int                      `json:"pending_users,omitempty"` // Only populated for admin
	TotalKeys             int                      `json:"total_keys"`
	ActiveDevicesOnline   int                      `json:"active_devices_online"`
	TotalTrafficBytes     int64                    `json:"total_traffic_bytes"`
	MonthTrafficBytes     int64                    `json:"month_traffic_bytes"`
	TotalTrafficFormatted string                   `json:"total_traffic_formatted"`
	MonthTrafficFormatted string                   `json:"month_traffic_formatted"`
	TotalNodes            int                      `json:"total_nodes"`
	OnlineNodes           int                      `json:"online_nodes"`
	AvgLatencyMs          int64                    `json:"avg_latency_ms"`
	SystemStatus          string                   `json:"system_status"` // "operational", "degraded", "maintenance"
	TopologyBreakdown     TopologyTrafficBreakdown `json:"topology_breakdown"`
	Nodes                 []NodeDashboardInfo      `json:"nodes"`
	GeneratedAt           time.Time                `json:"generated_at"`
}

// BillingRequisites represents customizable payment details for cooperative dues.
type BillingRequisites struct {
	SBPPhone string `json:"sbp_phone"`
	SBPBank  string `json:"sbp_bank"`
}

// TelegramChat represents a subscribed Telegram chat for admin alerts or user notifications.
type TelegramChat struct {
	ChatID        int64     `json:"chat_id"`
	UserID        *int64    `json:"user_id,omitempty"`
	Username      string    `json:"username"`
	FirstName     string    `json:"first_name"`
	IsAdmin       bool      `json:"is_admin"`
	AlertsEnabled bool      `json:"alerts_enabled"`
	CreatedAt     time.Time `json:"created_at"`
}

// TelegramSettings represents configurable Telegram Bot settings in Master Backend.
type TelegramSettings struct {
	Enabled                  bool   `json:"enabled"`
	BotToken                 string `json:"bot_token"`
	BotUsername              string `json:"bot_username"`
	AdminSecret              string `json:"admin_secret"`
	NotifyOnNodeDown         bool   `json:"notify_on_node_down"`
	NotifyOnNodeRecover      bool   `json:"notify_on_node_recover"`
	NotifyOnNewUser          bool   `json:"notify_on_new_user"`
	NotifyOnBillingReminders bool   `json:"notify_on_billing_reminders"`
}

// TelegramStatusResponse represents the current status of the Telegram bot.
type TelegramStatusResponse struct {
	Enabled          bool              `json:"enabled"`
	BotUsername      string            `json:"bot_username"`
	Settings         *TelegramSettings `json:"settings,omitempty"`
	Subscribers      []TelegramChat    `json:"subscribers"`
	TotalSubscribers int               `json:"total_subscribers"`
}

// TelegramTestAlertRequest for sending a test notification.
type TelegramTestAlertRequest struct {
	Message string `json:"message,omitempty"`
}

// TelegramSubscriberToggleRequest for enabling/disabling subscriber alerts.
type TelegramSubscriberToggleRequest struct {
	AlertsEnabled bool `json:"alerts_enabled"`
}

// UserTelegramStatusResponse represents user-specific Telegram integration status and deep link.
type UserTelegramStatusResponse struct {
	BotUsername      string `json:"bot_username"`
	BotEnabled       bool   `json:"bot_enabled"`
	IsLinked         bool   `json:"is_linked"`
	TelegramChatID   *int64 `json:"telegram_chat_id,omitempty"`
	TelegramUsername string `json:"telegram_username,omitempty"`
	AlertsEnabled    bool   `json:"alerts_enabled"`
	DeepLink         string `json:"deep_link"`
}

// NewsCategory represents category classification for announcements.
type NewsCategory string

const (
	NewsCategoryGeneral     NewsCategory = "general"     // Общее
	NewsCategoryMaintenance NewsCategory = "maintenance" // Техработы
	NewsCategoryIncident    NewsCategory = "incident"    // Сбой / Авария
	NewsCategoryBilling     NewsCategory = "billing"     // Оплата и взносы
	NewsCategoryKeys        NewsCategory = "keys"        // Обновление ключей
)

// NewsItem represents an announcement published in the system.
type NewsItem struct {
	ID             int64        `json:"id"`
	Title          string       `json:"title"`
	Content        string       `json:"content"`
	Category       NewsCategory `json:"category"`
	IsPinned       bool         `json:"is_pinned"`
	AuthorName     string       `json:"author_name"`
	NotifyTelegram bool         `json:"notify_telegram"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

// CreateNewsRequest is the payload for creating a new announcement.
type CreateNewsRequest struct {
	Title          string       `json:"title"`
	Content        string       `json:"content"`
	Category       NewsCategory `json:"category"`
	IsPinned       bool         `json:"is_pinned"`
	NotifyTelegram bool         `json:"notify_telegram"`
}

// UpdateNewsRequest is the payload for editing an existing announcement.
type UpdateNewsRequest struct {
	Title    string       `json:"title"`
	Content  string       `json:"content"`
	Category NewsCategory `json:"category"`
	IsPinned bool         `json:"is_pinned"`
}



