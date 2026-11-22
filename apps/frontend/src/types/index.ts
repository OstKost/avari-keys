export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  is_pro: boolean;
  has_pending_password_reset?: boolean;
  created_at: string;
}

export interface NodePublic {
  id: number;
  name: string;
  type: 'cascade' | 'direct';
  country_code?: string;
  is_mobile_optimized?: boolean;
  is_backup?: boolean;
  has_hysteria?: boolean;
  has_mieru?: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AdminNode {
  id: number;
  name: string;
  type: 'cascade' | 'direct';
  country_code?: string;
  provider_url?: string;
  api_url: string;
  is_mobile_optimized?: boolean;
  is_backup: boolean;
  has_hysteria?: boolean;
  has_mieru?: boolean;
  is_active: boolean;
  online: boolean;
  latency_ms?: number;
  auto_failover_enabled?: boolean;
  failover_priority?: string[];
  created_at: string;
  server_status?: NodeStatus;
  network_status?: NodeStatus;
  network_probes?: NetworkProbe[];
}

export interface FailoverRuntimeStatus {
  in_cooldown: boolean;
  cooldown_until?: string;
  consecutive_failures: number;
  failure_threshold: number;
}

export interface NodeDetailResponse extends AdminNode {
  health?: {
    status: string;
    service: string;
    awg_available: boolean;
    hysteria_available?: boolean;
    mieru_available?: boolean;
    version?: string;
  };
  stats?: {
    active_peers: number;
    uptime: string;
    total_rx: number;
    total_tx: number;
    peers?: Record<string, any>;
  };
  egress?: EgressStatusResponse;
  failover?: FailoverRuntimeStatus;
  client_keys?: ClientConfigSummary[];
}

export type ProtocolType = 'awg' | 'hysteria2' | 'mieru';

export interface TelegramProxyInfo {
  id: string;
  name: string;
  country_code: string;
  server: string;
  port: number;
  secret: string;
  link: string;
  status: string;
}

export interface ClientConfigSummary {
  id: number;
  user_id: number;
  username?: string;
  node_id: number;
  client_name: string;
  device_name: string;
  node_name?: string;
  node_type?: 'cascade' | 'direct';
  node_country_code?: string;
  protocol?: ProtocolType;
  last_handshake?: string;
  total_traffic_bytes?: number;
  month_traffic_bytes?: number;
  total_traffic_formatted?: string;
  month_traffic_formatted?: string;
  created_at: string;
}

export interface PaginatedKeysResponse {
  keys: ClientConfigSummary[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ClientConfigDetail {
  id: number;
  user_id?: number;
  username?: string;
  client_name: string;
  device_name: string;
  node_id: number;
  node_name: string;
  node_type: 'cascade' | 'direct';
  protocol?: ProtocolType;
  config: string;
  qr_code?: string;
  vpn_uri?: string;
  vpn_qr_code?: string;
  created_at: string;
}

export type AuditLogCategory = 'auth' | 'keys' | 'profile' | 'admin' | 'billing';

export interface AuditLog {
  id: number;
  user_id?: number;
  username: string;
  action: string;
  category: AuditLogCategory;
  ip_address?: string;
  details?: string;
  created_at: string;
}

export interface PaginatedAuditLogsResponse {
  logs: AuditLog[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface AuditLogFilterParams {
  userId?: number;
  username?: string;
  category?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface CleanupLogsResponse {
  success: boolean;
  message: string;
  deleted_count: number;
}

export interface TopologyTrafficBreakdown {
  cascade_traffic_bytes: number;
  direct_traffic_bytes: number;
  cascade_traffic_formatted: string;
  direct_traffic_formatted: string;
  cascade_percentage: number;
  direct_percentage: number;
}

export interface NodeDashboardInfo {
  active_egress?: string;
  id: number;
  name: string;
  type: 'cascade' | 'direct';
  country_code?: string;
  is_backup?: boolean;
  online: boolean;
  latency_ms: number;
  peer_count: number;
  total_traffic_formatted: string;
}

export interface DashboardStats {
  total_users: number;
  active_users: number;
  pending_users?: number;
  total_keys: number;
  active_devices_online: number;
  total_traffic_bytes: number;
  month_traffic_bytes: number;
  total_traffic_formatted: string;
  month_traffic_formatted: string;
  total_nodes: number;
  online_nodes: number;
  avg_latency_ms: number;
  system_status: 'operational' | 'degraded' | 'outage' | 'maintenance';
  topology_breakdown: TopologyTrafficBreakdown;
  nodes: NodeDashboardInfo[];
  generated_at: string;
}

export interface TargetProbeResult {
  name: string;
  target: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface EgressTarget {
  interface: string;
  node: string;
  label: string;
  endpoint: string;
  available: boolean;
  reason?: string;
  passed_checks?: number;
  total_checks?: number;
  checks?: TargetProbeResult[];
}

export interface EgressStatusResponse {
  targets?: EgressTarget[];
  active_interface: string;
  available_interfaces: string[];
  details?: string;
}

export interface BillingRecord {
  id: number;
  user_id: number;
  username: string;
  amount: number;
  currency: string;
  period_month: string;
  status: 'confirmed' | 'pending';
  note?: string;
  created_at: string;
}

export interface BillingStatus {
  is_due: boolean;
  days_remaining: number;
  next_due_at: string;
  last_paid_at?: string;
  snoozed_until?: string;
  status: 'paid' | 'due' | 'snoozed';
  is_pro?: boolean;
  key_count?: number;
  recommended_amount?: number;
  history: BillingRecord[];
}

export interface AdminBillingSummary {
  total_payments: number;
  users_due_count: number;
  total_users: number;
  records: BillingRecord[];
}

export interface BillingRequisites {
  sbp_phone: string;
  sbp_bank: string;
}

export interface TelegramChat {
  chat_id: number;
  user_id?: number;
  username: string;
  first_name: string;
  is_admin: boolean;
  alerts_enabled: boolean;
  created_at: string;
}

export interface TelegramSettings {
  enabled: boolean;
  bot_token: string;
  bot_username: string;
  admin_secret: string;
  web_app_url?: string;
  notify_on_node_down: boolean;
  notify_on_node_recover: boolean;
  notify_on_new_user: boolean;
  notify_on_billing_reminders?: boolean;
}

export interface TelegramStatusResponse {
  enabled: boolean;
  bot_username: string;
  settings?: TelegramSettings;
  subscribers: TelegramChat[];
  total_subscribers: number;
}

export interface UserTelegramStatus {
  bot_username: string;
  bot_enabled: boolean;
  is_linked: boolean;
  telegram_chat_id?: number;
  telegram_username?: string;
  alerts_enabled: boolean;
  deep_link: string;
}

export type NewsCategory = 'general' | 'maintenance' | 'incident' | 'billing' | 'keys';

export interface NewsItem {
  id: number;
  title: string;
  content: string;
  category: NewsCategory;
  is_pinned: boolean;
  author_name: string;
  notify_telegram?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateNewsPayload {
  title: string;
  content: string;
  category: NewsCategory;
  is_pinned: boolean;
  notify_telegram: boolean;
}

export interface UpdateNewsPayload {
  title: string;
  content: string;
  category: NewsCategory;
  is_pinned: boolean;
}








export interface NodeStatus {
  state: 'green' | 'yellow' | 'red' | 'unknown';
  checked_at?: string;
  reason?: string;
}
export interface NetworkProbe extends NodeStatus {
  interface?: string;
  node_id: number;
  source: string;
  checks: { kind: string; target: string; ok: boolean; latency_ms: number; error?: string }[];
}

export interface TelegramMiniAppAuthRequest {
  init_data: string;
}

export interface TelegramMiniAppAuthResponse {
  token: string;
  user: User;
  is_admin: boolean;
  is_linked: boolean;
}

// Telegram WebApp API types for window.Telegram.WebApp
export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramWebAppData {
  user?: TelegramWebAppUser;
  auth_date: number;
  query_id?: string;
  hash: string;
}

export interface TelegramWebAppHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export interface TelegramWebAppThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe: TelegramWebAppData;
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramWebAppThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  HapticFeedback: TelegramWebAppHapticFeedback;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebAppInstance;
    };
  }
}
