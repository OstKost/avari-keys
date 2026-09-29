export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  is_pro: boolean;
  created_at: string;
}

export interface NodePublic {
  id: number;
  name: string;
  type: 'cascade' | 'direct';
  country_code?: string;
  is_mobile_optimized?: boolean;
  is_backup?: boolean;
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
  is_active: boolean;
  online: boolean;
  latency_ms?: number;
  created_at: string;
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

export interface EgressStatusResponse {
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







