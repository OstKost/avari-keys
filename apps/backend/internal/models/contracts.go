package models

import "time"

// HealthResponse represents system and service health status.
type HealthResponse struct {
	Status            string `json:"status"`
	Service           string `json:"service"`
	AWGAvailable      bool   `json:"awg_available"`
	HysteriaAvailable bool   `json:"hysteria_available,omitempty"`
	MieruAvailable    bool   `json:"mieru_available,omitempty"`
	VlessAvailable    bool   `json:"vless_available,omitempty"`
	Version           string `json:"version,omitempty"`
}

// ClientCreateRequest payload for creating a client key.
type ClientCreateRequest struct {
	Name     string `json:"name"`
	PSK      bool   `json:"psk,omitempty"`
	Protocol string `json:"protocol,omitempty"` // "awg" (default), "hysteria2", or "mieru"
}

// ClientResponse represents the output when a client is created or retrieved.
type ClientResponse struct {
	Name      string `json:"name"`
	Config    string `json:"config"`
	Protocol  string `json:"protocol,omitempty"`    // "awg", "hysteria2", or "mieru"
	QRCode    string `json:"qr_code,omitempty"`     // Base64 PNG or SVG data URI for AWG/Hysteria/Mieru
	VPNURI    string `json:"vpn_uri,omitempty"`     // AmneziaVPN URI (vpn://...), hysteria2://, or mierus://
	VPNQRCode string `json:"vpn_qr_code,omitempty"` // Base64 PNG or SVG data URI
	PublicKey string `json:"public_key,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

// TelegramProxyInfo represents public MTProxy information.
type TelegramProxyInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	CountryCode string `json:"country_code"`
	Server      string `json:"server"`
	Port        int    `json:"port"`
	Secret      string `json:"secret"`
	Link        string `json:"link"`
	Status      string `json:"status"`
}

// ClientListItem represents an entry in the client list.
type ClientListItem struct {
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	Status    string    `json:"status"`
}

// PeerStats details per-peer traffic and handshakes.
type PeerStats struct {
	ClientName         string `json:"client_name"`
	PublicKey          string `json:"public_key,omitempty"`
	Interface          string `json:"interface,omitempty"`
	Endpoint           string `json:"endpoint,omitempty"`
	AllowedIPs         string `json:"allowed_ips,omitempty"`
	LastHandshake      string `json:"last_handshake"`
	LastHandshakeEpoch int64  `json:"last_handshake_epoch,omitempty"`
	IsOnline           bool   `json:"is_online"`
	RxBytes            int64  `json:"rx_bytes"`
	TxBytes            int64  `json:"tx_bytes"`
	MonthBytes         int64  `json:"month_bytes"`
}

// StatsSummaryResponse represents aggregate AWG statistics.
type StatsSummaryResponse struct {
	ActivePeers int                  `json:"active_peers"`
	Uptime      string               `json:"uptime"`
	TotalRx     int64                `json:"total_rx"`
	TotalTx     int64                `json:"total_tx"`
	Peers       map[string]PeerStats `json:"peers,omitempty"`
}

// BackupResponse holds exported configuration data.
type BackupResponse struct {
	Timestamp  string `json:"timestamp"`
	BackupData string `json:"backup_data"` // base64 / zip archive or conf text
}

// GenericSuccessResponse for deletion and status toggles.
type GenericSuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// SwitchEgressRequest payload for switching cascade egress interface.
type SwitchEgressRequest struct {
	Interface string `json:"interface"` // e.g. "awg1" or "awg3"
}

// TargetProbeResult represents the check outcome for an individual probed service.
type TargetProbeResult struct {
	Name   string `json:"name"`   // "ip", "telegram", "chatgpt", "grok", "meta"
	Target string `json:"target"` // "api.ipify.org", "api.telegram.org", etc.
	OK     bool   `json:"ok"`
	Status int    `json:"status,omitempty"` // HTTP status code (e.g. 200, 302, 403)
	Error  string `json:"error,omitempty"`
}

// EgressStatusResponse represents the active and available egress routes for a cascade node.
type EgressTarget struct {
	Interface       string              `json:"interface"`
	Node            string              `json:"node"`
	Label           string              `json:"label"`
	Endpoint        string              `json:"endpoint"`
	Available       bool                `json:"available"`
	Reason          string              `json:"reason,omitempty"`
	PassedChecks    int                 `json:"passed_checks,omitempty"`
	TotalChecks     int                 `json:"total_checks,omitempty"`
	Checks          []TargetProbeResult `json:"checks,omitempty"`
	HandshakeAgeSec int64               `json:"handshake_age_sec,omitempty"`
	IsFrozen        bool                `json:"is_frozen,omitempty"`
	Recommendation  string              `json:"recommendation,omitempty"`
}

type EgressStatusResponse struct {
	Targets             []EgressTarget `json:"targets,omitempty"`
	ActiveInterface     string         `json:"active_interface"`
	AvailableInterfaces []string       `json:"available_interfaces"`
	Details             string         `json:"details,omitempty"`
}

// TrafficPolicy represents the torrent traffic filtering mode.
type TrafficPolicy string

const (
	PolicyOff    TrafficPolicy = "off"
	PolicySoft   TrafficPolicy = "soft"
	PolicyStrict TrafficPolicy = "strict" // reserved for future L7/DPI, not implemented yet
)

// Valid reports whether the policy value is a known mode.
func (p TrafficPolicy) Valid() bool {
	switch p {
	case PolicyOff, PolicySoft, PolicyStrict:
		return true
	default:
		return false
	}
}

// TrafficPolicyRequest payload for updating the torrent traffic filtering mode.
type TrafficPolicyRequest struct {
	Mode TrafficPolicy `json:"mode"`
}

// TrafficPolicyResponse represents the applied traffic filtering mode.
type TrafficPolicyResponse struct {
	Mode    TrafficPolicy `json:"mode"`
	Applied bool          `json:"applied"`
	Message string        `json:"message,omitempty"`
}

// FirewallStatusResponse represents the local firewall state on a node.
type FirewallStatusResponse struct {
	Mode           TrafficPolicy `json:"mode"`
	RulesCount     int           `json:"rules_count"`
	BlockedDomains []string      `json:"blocked_domains"`
	LastAppliedAt  string        `json:"last_applied_at,omitempty"`
}

// TorrentBlocklistEntry represents an editable tracker/DHT domain in the blocklist.
type TorrentBlocklistEntry struct {
	ID        int64     `json:"id"`
	Domain    string    `json:"domain"`
	AddedBy   string    `json:"added_by"`
	CreatedAt time.Time `json:"created_at"`
}

// TorrentBlocklistRequest payload for adding a domain to the blocklist.
type TorrentBlocklistRequest struct {
	Domain string `json:"domain"`
}

// TorrentBlocklistApplyRequest payload for pushing the domain list to a node.
type TorrentBlocklistApplyRequest struct {
	Domains []string `json:"domains"`
}
