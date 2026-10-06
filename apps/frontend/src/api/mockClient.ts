import {
  User,
  NodePublic,
  AdminNode,
  ClientConfigSummary,
  ClientConfigDetail,
  PaginatedKeysResponse,
  AuditLog,
  PaginatedAuditLogsResponse,
  AuditLogFilterParams,
  CleanupLogsResponse,
  DashboardStats,
  BillingRecord,
  BillingStatus,
  AdminBillingSummary,
  BillingRequisites,
  TelegramStatusResponse,
  TelegramSettings,
  TelegramChat,
  UserTelegramStatus,
  NewsItem,
  CreateNewsPayload,
  UpdateNewsPayload,
  TelegramProxyInfo,
  ProtocolType,
} from '../types';

// In-memory mock storage for standalone FE development
let mockUsers: User[] = [
  {
    id: 1,
    username: 'Forve',
    role: 'admin',
    is_active: true,
    is_pro: true,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 2,
    username: 'alice',
    role: 'user',
    is_active: true,
    is_pro: true,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 3,
    username: 'bob_new',
    role: 'user',
    is_active: false,
    is_pro: false,
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
  },
];

let mockLogs: AuditLog[] = [
  {
    id: 1,
    user_id: 1,
    username: 'Forve',
    action: 'auth_login',
    category: 'auth',
    ip_address: '192.168.1.10',
    details: 'Успешная авторизация в системе',
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: 2,
    user_id: 1,
    username: 'Forve',
    action: 'admin_user_activate',
    category: 'admin',
    ip_address: '192.168.1.10',
    details: 'Активирован доступ для пользователя «alice» (ID #2)',
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 3,
    user_id: 2,
    username: 'alice',
    action: 'auth_login',
    category: 'auth',
    ip_address: '178.62.204.15',
    details: 'Успешная авторизация в системе',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 4,
    user_id: 2,
    username: 'alice',
    action: 'key_create',
    category: 'keys',
    ip_address: '178.62.204.15',
    details: 'Создан VPN-ключ «iPhone 15» (u2_iphone15) на сервере «Каскад M0 -> S1»',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: 5,
    user_id: 2,
    username: 'alice',
    action: 'key_view',
    category: 'keys',
    ip_address: '178.62.204.15',
    details: 'Просмотр конфигурации / QR-кода ключа «iPhone 15» (u2_iphone15)',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3 + 1000 * 30).toISOString(),
  },
  {
    id: 6,
    user_id: 3,
    username: 'bob_new',
    action: 'auth_register',
    category: 'auth',
    ip_address: '94.25.180.44',
    details: 'Регистрация нового аккаунта (ожидает подтверждения администратора)',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: 7,
    user_id: 3,
    username: 'bob_new',
    action: 'auth_login_blocked',
    category: 'auth',
    ip_address: '94.25.180.44',
    details: 'Попытка входа в неактивированный аккаунт',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 11).toISOString(),
  },
  {
    id: 8,
    user_id: 1,
    username: 'Forve',
    action: 'admin_node_restart',
    category: 'admin',
    ip_address: '192.168.1.10',
    details: 'Перезапущен сервис AmneziaWG на узле «Каскад M0 -> S1»',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: 9,
    user_id: 1,
    username: 'Forve',
    action: 'admin_node_backup',
    category: 'admin',
    ip_address: '192.168.1.10',
    details: 'Выгружена резервная копия конфигурации узла «Прямой S2»',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
  {
    id: 10,
    user_id: 1,
    username: 'Forve',
    action: 'profile_update',
    category: 'profile',
    ip_address: '192.168.1.10',
    details: 'Обновлены учетные данные профиля',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
];

let mockCurrentUser: User = mockUsers[0];

let mockNodes: AdminNode[] = [
  {
    id: 1,
    name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    type: 'cascade',
    country_code: 'NLD',
    provider_url: 'https://aeza.net',
    api_url: 'http://127.0.0.1:8081',
    is_mobile_optimized: true,
    is_backup: false,
    is_active: true,
    online: true,
    latency_ms: 24,
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: 2,
    name: 'Каскад M0 (Москва) -> S2 (Франкфурт)',
    type: 'cascade',
    country_code: 'DEU',
    provider_url: 'https://hetzner.com',
    api_url: 'http://127.0.0.1:8081',
    is_mobile_optimized: true,
    is_backup: true,
    is_active: true,
    online: true,
    latency_ms: 31,
    created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
  {
    id: 3,
    name: 'Прямой туннель S2 (Франкфурт)',
    type: 'direct',
    country_code: 'DEU',
    provider_url: 'https://hetzner.com',
    api_url: 'http://127.0.0.1:8082',
    is_mobile_optimized: false,
    is_backup: false,
    is_active: true,
    online: true,
    latency_ms: 38,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
];

let mockKeys: (ClientConfigDetail & {
  user_id: number;
  last_handshake?: string;
  total_traffic_bytes?: number;
  month_traffic_bytes?: number;
  total_traffic_formatted?: string;
  month_traffic_formatted?: string;
})[] = [
  {
    id: 1,
    user_id: 1, // Forve Admin
    client_name: 'u1_iphone15',
    device_name: 'iphone_15_pro',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: '3 минуты назад',
    total_traffic_bytes: 1520435200,
    month_traffic_bytes: 1520435200,
    total_traffic_formatted: '1.42 GB',
    month_traffic_formatted: '1.42 GB',
    config: `[Interface]
Address = 10.7.0.3/32
PrivateKey = aMockPrivateKeyForDemoPurposesOnly1234567=
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 25
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyForDemoPurposes8901234=
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`,
    vpn_uri: 'vpn://eyJob3N0TmFtZSI6IjE5OC41MS4xMDAuMSIsImRlc2NyaXB0aW9uIjoiQXZhcmkgS2V5cyBDYXNjYWRlIE0wLT5TMSIsImNvbmZpZyI6IntcImRuczFcIjpcIjEuMS4xLjFcIixcInBvcnRcIjo1MTgyMCxcInByb3RvY29sXCI6XCJhd2dcIn0ifQ==',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 2,
    user_id: 1, // Forve Admin
    client_name: 'u1_macbook',
    device_name: 'macbook_m3_max',
    node_id: 2,
    node_name: 'Прямой туннель S2 (Франкфурт)',
    node_type: 'direct',
    last_handshake: '42 минуты назад',
    total_traffic_bytes: 471859200,
    month_traffic_bytes: 471859200,
    total_traffic_formatted: '450.00 MB',
    month_traffic_formatted: '450.00 MB',
    config: `[Interface]
Address = 10.8.0.4/32
PrivateKey = aMockPrivateKeyDirectTunnelMacBook7654321=
Jc = 3
Jmin = 50
Jmax = 80
S1 = 20
S2 = 30
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyDirectTunnel1234567=
Endpoint = 203.0.113.50:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`,
    vpn_uri: 'vpn://eyJob3N0TmFtZSI6IjIwMy4wLjExMy41MCIsImRlc2NyaXB0aW9uIjoiQXZhcmkgS2V5cyBEaXJlY3QgUzIiLCJjb25maWciOiJ7XCJkbnMxXCI6XCI4LjguOC44XCIsXCJwb3J0XCI6NTE4MjAsXCJwcm90b2NvbFwiOlwiYXdnXCJ9In0=',
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 3,
    user_id: 2, // Alice User
    client_name: 'u2_alice_phone',
    device_name: 'alice_iphone14',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: '2 часа назад',
    total_traffic_bytes: 93323264,
    month_traffic_bytes: 93323264,
    total_traffic_formatted: '89.00 MB',
    month_traffic_formatted: '89.00 MB',
    config: `[Interface]
Address = 10.7.0.5/32
PrivateKey = aMockAlicePrivateKeyCascade99887766=
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 25
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyForDemoPurposes8901234=
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`,
    vpn_uri: 'vpn://eyJob3N0TmFtZSI6IjE5OC41MS4xMDAuMSIsImRlc2NyaXB0aW9uIjoiQXZhcmkgS2V5cyBBbGljZSBQaG9uZSIsImNvbmZpZyI6IntcImRuczFcIjpcIjEuMS4xLjFcIixcInBvcnRcIjo1MTgyMCxcInByb3RvY29sXCI6XCJhd2dcIn0ifQ==',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 4,
    user_id: 1, // Forve Admin
    client_name: 'u1_ipad_pro',
    device_name: 'ipad_pro_13',
    node_id: 2,
    node_name: 'Каскад M0 (Москва) -> S2 (Франкфурт)',
    node_type: 'cascade',
    last_handshake: '15 минут назад',
    total_traffic_bytes: 754974720,
    month_traffic_bytes: 754974720,
    total_traffic_formatted: '720.00 MB',
    month_traffic_formatted: '720.00 MB',
    config: `[Interface]
Address = 10.7.0.8/32
PrivateKey = aMockPrivateKeyForDemoIPadProCascade123=
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 25
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyForDemoPurposes8901234=
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`,
    vpn_uri: 'vpn://eyJob3N0TmFtZSI6IjE5OC41MS4xMDAuMSIsImRlc2NyaXB0aW9uIjoiQXZhcmkgS2V5cyBDYXNjYWRlIE0wLT5TMiIsImNvbmZpZyI6IntcImRuczFcIjpcIjEuMS4xLjFcIixcInBvcnRcIjo1MTgyMCxcInByb3RvY29sXCI6XCJhd2dcIn0ifQ==',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 5,
    user_id: 2, // alice
    client_name: 'u2_macbook_air',
    device_name: 'macbook_air_m2',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: '10 минут назад',
    total_traffic_bytes: 3221225472,
    month_traffic_bytes: 1073741824,
    total_traffic_formatted: '3.00 GB',
    month_traffic_formatted: '1.00 GB',
    config: `[Interface]\nAddress = 10.7.0.9/32\nPrivateKey = aMockKey5=`,
    vpn_uri: 'vpn://mock5',
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 6,
    user_id: 1, // Forve Admin
    client_name: 'u1_home_pc',
    device_name: 'windows_workstation',
    node_id: 3,
    node_name: 'Прямой туннель S2 (Франкфурт)',
    node_type: 'direct',
    last_handshake: '1 час назад',
    total_traffic_bytes: 5368709120,
    month_traffic_bytes: 2147483648,
    total_traffic_formatted: '5.00 GB',
    month_traffic_formatted: '2.00 GB',
    config: `[Interface]\nAddress = 10.8.0.7/32\nPrivateKey = aMockKey6=`,
    vpn_uri: 'vpn://mock6',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 7,
    user_id: 2, // alice
    client_name: 'u2_ipad_mini',
    device_name: 'ipad_mini_6',
    node_id: 2,
    node_name: 'Каскад M0 (Москва) -> S2 (Франкфурт)',
    node_type: 'cascade',
    last_handshake: '4 часа назад',
    total_traffic_bytes: 419430400,
    month_traffic_bytes: 419430400,
    total_traffic_formatted: '400.00 MB',
    month_traffic_formatted: '400.00 MB',
    config: `[Interface]\nAddress = 10.7.0.12/32\nPrivateKey = aMockKey7=`,
    vpn_uri: 'vpn://mock7',
    created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
  },
  {
    id: 8,
    user_id: 1, // Forve
    client_name: 'u1_travel_laptop',
    device_name: 'thinkpad_x1',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: 'Вчера',
    total_traffic_bytes: 891289600,
    month_traffic_bytes: 891289600,
    total_traffic_formatted: '850.00 MB',
    month_traffic_formatted: '850.00 MB',
    config: `[Interface]\nAddress = 10.7.0.15/32\nPrivateKey = aMockKey8=`,
    vpn_uri: 'vpn://mock8',
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: 9,
    user_id: 3, // bob_new
    client_name: 'u3_pixel_8',
    device_name: 'google_pixel_8',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: 'Никогда',
    total_traffic_bytes: 0,
    month_traffic_bytes: 0,
    total_traffic_formatted: '0 B',
    month_traffic_formatted: '0 B',
    config: `[Interface]\nAddress = 10.7.0.18/32\nPrivateKey = aMockKey9=`,
    vpn_uri: 'vpn://mock9',
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 10,
    user_id: 1, // Forve
    client_name: 'u1_backup_phone',
    device_name: 'iphone_se_2022',
    node_id: 3,
    node_name: 'Прямой туннель S2 (Франкфурт)',
    node_type: 'direct',
    last_handshake: '3 дня назад',
    total_traffic_bytes: 209715200,
    month_traffic_bytes: 209715200,
    total_traffic_formatted: '200.00 MB',
    month_traffic_formatted: '200.00 MB',
    config: `[Interface]\nAddress = 10.8.0.10/32\nPrivateKey = aMockKey10=`,
    vpn_uri: 'vpn://mock10',
    created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
  {
    id: 11,
    user_id: 2, // alice
    client_name: 'u2_linux_desk',
    device_name: 'arch_linux_box',
    node_id: 3,
    node_name: 'Прямой туннель S2 (Франкфурт)',
    node_type: 'direct',
    last_handshake: '18 минут назад',
    total_traffic_bytes: 12884901888,
    month_traffic_bytes: 4294967296,
    total_traffic_formatted: '12.00 GB',
    month_traffic_formatted: '4.00 GB',
    config: `[Interface]\nAddress = 10.8.0.14/32\nPrivateKey = aMockKey11=`,
    vpn_uri: 'vpn://mock11',
    created_at: new Date(Date.now() - 86400000 * 9).toISOString(),
  },
  {
    id: 12,
    user_id: 1, // Forve
    client_name: 'u1_tv_box',
    device_name: 'apple_tv_4k',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: '5 минут назад',
    total_traffic_bytes: 26843545600,
    month_traffic_bytes: 8589934592,
    total_traffic_formatted: '25.00 GB',
    month_traffic_formatted: '8.00 GB',
    config: `[Interface]\nAddress = 10.7.0.22/32\nPrivateKey = aMockKey12=`,
    vpn_uri: 'vpn://mock12',
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: 13,
    user_id: 2, // alice
    client_name: 'u2_office_mac',
    device_name: 'imac_m1',
    node_id: 2,
    node_name: 'Каскад M0 (Москва) -> S2 (Франкфурт)',
    node_type: 'cascade',
    last_handshake: '6 часов назад',
    total_traffic_bytes: 1610612736,
    month_traffic_bytes: 1610612736,
    total_traffic_formatted: '1.50 GB',
    month_traffic_formatted: '1.50 GB',
    config: `[Interface]\nAddress = 10.7.0.25/32\nPrivateKey = aMockKey13=`,
    vpn_uri: 'vpn://mock13',
    created_at: new Date(Date.now() - 86400000 * 11).toISOString(),
  },
  {
    id: 14,
    user_id: 1, // Forve
    client_name: 'u1_router_branch',
    device_name: 'keenetic_giga_router',
    node_id: 1,
    node_name: 'Каскад M0 (Москва) -> S1 (Амстердам)',
    node_type: 'cascade',
    last_handshake: '1 минуту назад',
    total_traffic_bytes: 53687091200,
    month_traffic_bytes: 18253611008,
    total_traffic_formatted: '50.00 GB',
    month_traffic_formatted: '17.00 GB',
    config: `[Interface]\nAddress = 10.7.0.28/32\nPrivateKey = aMockKey14=`,
    vpn_uri: 'vpn://mock14',
    created_at: new Date(Date.now() - 86400000 * 12).toISOString(),
  },
  {
    id: 15,
    user_id: 3, // bob_new
    client_name: 'u3_mac_work',
    device_name: 'macbook_pro_14',
    node_id: 3,
    node_name: 'Прямой туннель S2 (Франкфурт)',
    node_type: 'direct',
    last_handshake: 'Никогда',
    total_traffic_bytes: 0,
    month_traffic_bytes: 0,
    total_traffic_formatted: '0 B',
    month_traffic_formatted: '0 B',
    config: `[Interface]\nAddress = 10.8.0.20/32\nPrivateKey = aMockKey15=`,
    vpn_uri: 'vpn://mock15',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 16,
    user_id: 1, // Forve
    client_name: 'u1_tablet_s9',
    device_name: 'galaxy_tab_s9',
    node_id: 2,
    node_name: 'Каскад M0 (Москва) -> S2 (Франкфурт)',
    node_type: 'cascade',
    last_handshake: '35 минут назад',
    total_traffic_bytes: 1258291200,
    month_traffic_bytes: 1258291200,
    total_traffic_formatted: '1.17 GB',
    month_traffic_formatted: '1.17 GB',
    config: `[Interface]\nAddress = 10.7.0.32/32\nPrivateKey = aMockKey16=`,
    vpn_uri: 'vpn://mock16',
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
];

export const mockApi = {
  async login(username: string, _password: string): Promise<{ token: string; user: User }> {
    const user = mockUsers.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      throw new Error('Пользователь не найден (в Mock режиме)');
    }
    if (!user.is_active) {
      throw new Error('Учетная запись ожидает подтверждения администратором.');
    }
    mockCurrentUser = user;
    localStorage.setItem('token', 'mock-jwt-token-' + user.username);
    return { token: 'mock-jwt-token-' + user.username, user };
  },

  async setDemoUser(username: string): Promise<User> {
    const user = mockUsers.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (user) {
      mockCurrentUser = user;
      localStorage.setItem('token', 'mock-jwt-token-' + user.username);
      return user;
    }
    return mockCurrentUser;
  },

  async register(username: string, _password: string): Promise<{ message: string; user: User }> {
    const newUser: User = {
      id: mockUsers.length + 1,
      username,
      role: 'user',
      is_active: false,
      is_pro: false,
      created_at: new Date().toISOString(),
    };
    mockUsers.push(newUser);
    return { message: 'Регистрация успешна, ожидайте модерации', user: newUser };
  },

  async getMe(): Promise<User> {
    return mockCurrentUser;
  },

  async updateProfile(data: { username?: string; password?: string }): Promise<{ token: string; user: User }> {
    if (data.username) {
      mockCurrentUser.username = data.username;
      const found = mockUsers.find((u) => u.id === mockCurrentUser.id);
      if (found) found.username = data.username;
    }
    return {
      token: 'mock-jwt-token-' + mockCurrentUser.username,
      user: { ...mockCurrentUser },
    };
  },

  logout() {
    localStorage.removeItem('token');
  },

  async getNodes(): Promise<NodePublic[]> {
    return mockNodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      country_code: n.country_code,
      is_mobile_optimized: n.is_mobile_optimized,
      is_backup: n.is_backup,
      is_active: n.is_active,
      created_at: n.created_at,
    }));
  },

  async getKeys(): Promise<ClientConfigSummary[]> {
    return mockKeys
      .filter((k) => k.user_id === mockCurrentUser.id)
      .map((k) => {
        const matchedNode = mockNodes.find((n) => n.id === k.node_id);
        return {
          id: k.id,
          user_id: k.user_id,
          node_id: k.node_id,
          client_name: k.client_name,
          device_name: k.device_name,
          node_name: k.node_name,
          node_type: k.node_type,
          node_country_code: matchedNode?.country_code,
          last_handshake: k.last_handshake || '10 минут назад',
          total_traffic_bytes: k.total_traffic_bytes || 524288000,
          month_traffic_bytes: k.month_traffic_bytes || 524288000,
          total_traffic_formatted: k.total_traffic_formatted || '500.00 MB',
          month_traffic_formatted: k.month_traffic_formatted || '500.00 MB',
          created_at: k.created_at,
        };
      });
  },

  async getTelegramProxies(): Promise<TelegramProxyInfo[]> {
    return [
      {
        id: 's2-fin',
        name: 'Финляндия (FIN)',
        country_code: 'FIN',
        server: 's2.avari.dev',
        port: 8443,
        secret: 'ee9cbceb37d7e8416b6ffaa076a610be1f73322e61766172692e646576',
        link: 'tg://proxy?server=s2.avari.dev&port=8443&secret=ee9cbceb37d7e8416b6ffaa076a610be1f73322e61766172692e646576',
        status: 'online',
      },
    ];
  },

  async createKey(nodeId: number, deviceName: string, psk?: boolean, protocol?: ProtocolType): Promise<ClientConfigDetail> {
    const node = mockNodes.find((n) => n.id === nodeId);
    const nodeName = node ? node.name : 'Unknown Node';
    const nodeType = node ? node.type : 'direct';
    const id = mockKeys.length + 1;
    const clientName = `u${mockCurrentUser.id}_${deviceName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
    const pskLine = psk ? '\nPresharedKey = aMockPresharedKeyForShadowrocket12345=' : '';

    let config = `[Interface]
Address = 10.${nodeType === 'cascade' ? '7' : '8'}.0.${id + 4}/32
PrivateKey = aMockGeneratedPrivateKeyForDemo_${clientName}=
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 25
H1 = 1
H2 = 2
H3 = 3
H4 = 4

[Peer]
PublicKey = aMockServerPublicKeyForNode_${nodeId}=${pskLine}
Endpoint = 198.51.100.${nodeId}:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`;

    let vpnUri = `vpn://eyJob3N0TmFtZSI6IjE5OC41MS4xMDAuJHtub2RlSWR9IiwiZGVzY3JpcHRpb24iOiJBdmFyaSBLZXlzICR7ZGV2aWNlTmFtZX0iLCJjb25maWciOiJ7XCJkbnMxXCI6XCIxLjEuMS4xXCIsXCJwb3J0XCI6NTE4MjAsXCJwcm90b2NvbFwiOlwiYXdnXCJ9In0=`;

    if (protocol === 'hysteria2') {
      vpnUri = `hysteria2://demo_password_123@s2.avari.dev:443/?sni=s2.avari.dev&insecure=0#${clientName}`;
      config = `server: s2.avari.dev:443
auth: demo_password_123
tls:
  sni: s2.avari.dev
  insecure: false
bandwidth:
  up: 50 mbps
  down: 200 mbps`;
    }

    const newKeyDetail: ClientConfigDetail & { user_id: number } = {
      id,
      user_id: mockCurrentUser.id,
      client_name: clientName,
      device_name: deviceName,
      node_id: nodeId,
      node_name: nodeName,
      node_type: nodeType,
      protocol: protocol || 'awg',
      config,
      vpn_uri: vpnUri,
      created_at: new Date().toISOString(),
    };

    mockKeys.unshift(newKeyDetail);
    return newKeyDetail;
  },

  async getKey(id: number): Promise<ClientConfigDetail> {
    const key = mockKeys.find((k) => k.id === id);
    if (!key) throw new Error('Ключ не найден');
    return key;
  },

  async deleteKey(id: number): Promise<{ success: boolean; message: string }> {
    mockKeys = mockKeys.filter((k) => k.id !== id);
    return { success: true, message: 'Ключ успешно удален' };
  },

  // Admin
  async getAdminUsers(): Promise<User[]> {
    return [...mockUsers];
  },

  async activateUser(id: number): Promise<{ success: boolean }> {
    const user = mockUsers.find((u) => u.id === id);
    if (user) user.is_active = true;
    return { success: true };
  },

  async deactivateUser(id: number): Promise<{ success: boolean }> {
    const user = mockUsers.find((u) => u.id === id);
    if (user) user.is_active = false;
    return { success: true };
  },

  async setUserRole(id: number, role: 'admin' | 'user'): Promise<{ success: boolean; message: string }> {
    const user = mockUsers.find((u) => u.id === id);
    if (user) {
      user.role = role;
      if (mockCurrentUser.id === id) {
        mockCurrentUser.role = role;
      }
    }
    return { success: true, message: `Роль изменена на ${role}` };
  },

  async setUserPro(id: number, isPro: boolean): Promise<{ success: boolean; message: string }> {
    const user = mockUsers.find((u) => u.id === id);
    if (user) {
      user.is_pro = isPro;
      if (mockCurrentUser.id === id) {
        mockCurrentUser.is_pro = isPro;
      }
    }
    return { success: true, message: `Статус PRO ${isPro ? 'активирован' : 'деактивирован'}` };
  },

  async deleteUser(id: number): Promise<{ success: boolean }> {
    mockUsers = mockUsers.filter((u) => u.id !== id);
    return { success: true };
  },

  async getAdminNodes(): Promise<AdminNode[]> {
    // Simulate minor ping variance
    return mockNodes.map((n) => ({
      ...n,
      latency_ms: n.online ? Math.floor(20 + Math.random() * 25) : undefined,
    }));
  },

  async addAdminNode(
    name: string,
    type: 'cascade' | 'direct',
    apiUrl: string,
    _apiKey: string,
    isMobileOptimized?: boolean,
    countryCode?: string,
    providerUrl?: string,
    isBackup?: boolean
  ): Promise<AdminNode> {
    const newNode: AdminNode = {
      id: mockNodes.length + 1,
      name,
      type,
      country_code: countryCode?.toUpperCase() || '',
      provider_url: providerUrl || '',
      api_url: apiUrl,
      is_mobile_optimized: Boolean(isMobileOptimized),
      is_backup: Boolean(isBackup),
      is_active: true,
      online: true,
      latency_ms: Math.floor(20 + Math.random() * 20),
      created_at: new Date().toISOString(),
    };
    mockNodes.push(newNode);
    return newNode;
  },

  async updateAdminNode(
    id: number,
    data: {
      name: string;
      type: 'cascade' | 'direct';
      apiUrl: string;
      apiKey?: string;
      isMobileOptimized?: boolean;
      isBackup?: boolean;
      countryCode?: string;
      providerUrl?: string;
    }
  ): Promise<AdminNode> {
    const node = mockNodes.find((n) => n.id === id);
    if (!node) {
      throw new Error('Узел не найден');
    }
    node.name = data.name;
    node.type = data.type;
    node.api_url = data.apiUrl;
    node.country_code = data.countryCode?.toUpperCase() || '';
    node.provider_url = data.providerUrl || '';
    node.is_mobile_optimized = Boolean(data.isMobileOptimized);
    if (data.isBackup !== undefined) {
      node.is_backup = Boolean(data.isBackup);
    }
    return { ...node };
  },

  async deleteAdminNode(id: number): Promise<{ success: boolean }> {
    mockNodes = mockNodes.filter((n) => n.id !== id);
    return { success: true };
  },

  async restartNode(id: number): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 800)); // simulate brief restart time
    const node = mockNodes.find((n) => n.id === id);
    return {
      success: true,
      message: `Сервис AmneziaWG на ноде "${node?.name || id}" успешно перезапущен`,
    };
  },

  async backupNode(id: number): Promise<{ timestamp: string; backup_data: string }> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      timestamp: new Date().toISOString(),
      backup_data: `UEsDBBQAAAAIAAWG...mock_tar_gz_backup_data_for_node_${id}...`,
    };
  },

  async restoreNode(id: number, _backupData: string): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const node = mockNodes.find((n) => n.id === id);
    return {
      success: true,
      message: `Конфигурация ноды "${node?.name || id}" успешно восстановлена из резервной копии`,
    };
  },

  async getNodeEgress(_id: number): Promise<{ active_interface: string; available_interfaces: string[]; details?: string }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      active_interface: 'awg1',
      available_interfaces: ['awg1', 'awg3'],
      details: 'Mock active egress dev in table 100 is awg1',
    };
  },

  async switchNodeEgress(_id: number, targetInterface: string): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      success: true,
      message: `Шлюз выхода каскада переключен на ${targetInterface}`,
    };
  },

  async getAdminKeys(params?: {
    search?: string;
    nodeId?: number;
    page?: number;
    limit?: number;
  }): Promise<PaginatedKeysResponse> {
    let filtered = [...mockKeys];

    if (params?.nodeId) {
      filtered = filtered.filter((k) => k.node_id === params.nodeId);
    }

    if (params?.search) {
      const q = params.search.toLowerCase().trim();
      filtered = filtered.filter((k) => {
        const u = mockUsers.find((user) => user.id === k.user_id);
        const userName = u ? u.username.toLowerCase() : '';
        return (
          k.device_name.toLowerCase().includes(q) ||
          k.client_name.toLowerCase().includes(q) ||
          (k.node_name && k.node_name.toLowerCase().includes(q)) ||
          userName.includes(q)
        );
      });
    }

    // Sort ID descending
    filtered.sort((a, b) => b.id - a.id);

    const page = params?.page && params.page > 0 ? params.page : 1;
    const limit = params?.limit && params.limit > 0 ? params.limit : 10;
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit).map((k) => {
      const u = mockUsers.find((user) => user.id === k.user_id);
      return {
        id: k.id,
        user_id: k.user_id,
        username: u ? u.username : 'User',
        node_id: k.node_id,
        client_name: k.client_name,
        device_name: k.device_name,
        node_name: k.node_name,
        node_type: k.node_type,
        last_handshake: k.last_handshake || '5 минут назад',
        total_traffic_bytes: k.total_traffic_bytes || 524288000,
        month_traffic_bytes: k.month_traffic_bytes || 524288000,
        total_traffic_formatted: k.total_traffic_formatted || '500.00 MB',
        month_traffic_formatted: k.month_traffic_formatted || '500.00 MB',
        created_at: k.created_at,
      };
    });

    return {
      keys: paged,
      total_count: totalCount,
      page,
      limit,
      total_pages: totalPages,
    };
  },

  async getAdminAuditLogs(params?: AuditLogFilterParams): Promise<PaginatedAuditLogsResponse> {
    let filtered = [...mockLogs];

    if (params?.userId) {
      filtered = filtered.filter((l) => l.user_id === params.userId);
    }

    if (params?.username) {
      const u = params.username.toLowerCase().trim();
      filtered = filtered.filter((l) => l.username.toLowerCase().includes(u));
    }

    if (params?.category) {
      filtered = filtered.filter((l) => l.category === params.category);
    }

    if (params?.action) {
      filtered = filtered.filter((l) => l.action === params.action);
    }

    if (params?.from) {
      const fromTime = new Date(params.from).getTime();
      filtered = filtered.filter((l) => new Date(l.created_at).getTime() >= fromTime);
    }

    if (params?.to) {
      const toTime = new Date(params.to).getTime() + 86400000; // end of day
      filtered = filtered.filter((l) => new Date(l.created_at).getTime() <= toTime);
    }

    const page = params?.page && params.page > 0 ? params.page : 1;
    const limit = params?.limit && params.limit > 0 ? params.limit : 50;
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit);

    return {
      logs: paged,
      total_count: totalCount,
      page,
      limit,
      total_pages: totalPages,
    };
  },

  async cleanupAdminAuditLogs(days: number = 90): Promise<CleanupLogsResponse> {
    const cutoff = Date.now() - days * 86400000;
    const beforeCount = mockLogs.length;
    mockLogs = mockLogs.filter((l) => new Date(l.created_at).getTime() >= cutoff);
    const deleted = beforeCount - mockLogs.length;

    // Log the cleanup action in mock
    mockLogs.unshift({
      id: mockLogs.length + 1,
      user_id: mockCurrentUser.id,
      username: mockCurrentUser.username,
      action: 'admin_logs_cleanup',
      category: 'admin',
      ip_address: '127.0.0.1',
      details: `Очищен журнал аудита старше ${days} дней (удалено записей: ${deleted})`,
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Успешно удалено записей старше ${days} дней: ${deleted}`,
      deleted_count: deleted,
    };
  },

  async getDashboardStats(_fresh?: boolean): Promise<DashboardStats> {
    const totalUsers = mockUsers.length;
    const activeUsers = mockUsers.filter((u) => u.is_active).length;
    const pendingUsers = mockUsers.filter((u) => !u.is_active).length;
    const totalKeys = mockKeys.length;
    const activeDevicesOnline = mockKeys.filter(
      (k) => k.last_handshake && !k.last_handshake.includes('Не')
    ).length;

    let totalTrafficBytes = 0;
    let monthTrafficBytes = 0;
    let cascadeTrafficBytes = 0;
    let directTrafficBytes = 0;

    for (const k of mockKeys) {
      const bytes = k.total_traffic_bytes || 524288000;
      const mBytes = k.month_traffic_bytes || 524288000;
      totalTrafficBytes += bytes;
      monthTrafficBytes += mBytes;
      if (k.node_type === 'cascade') {
        cascadeTrafficBytes += bytes;
      } else {
        directTrafficBytes += bytes;
      }
    }

    const combined = cascadeTrafficBytes + directTrafficBytes;
    const cascadePercentage = combined > 0 ? Math.round((cascadeTrafficBytes * 100) / combined) : 50;
    const directPercentage = 100 - cascadePercentage;

    const onlineNodes = mockNodes.filter((n) => n.online).length;
    const avgLatencyMs =
      onlineNodes > 0
        ? Math.round(
            mockNodes.reduce((acc, n) => acc + (n.latency_ms || 25), 0) / mockNodes.length
          )
        : 0;

    const nodesOverview = mockNodes.map((n) => {
      const nodeKeys = mockKeys.filter((k) => k.node_id === n.id);
      const nodeTraffic = nodeKeys.reduce((acc, k) => acc + (k.total_traffic_bytes || 0), 0);
      return {
        id: n.id,
        name: n.name,
        type: n.type,
        country_code: n.country_code,
        online: n.online,
        latency_ms: n.latency_ms || 25,
        peer_count: nodeKeys.length,
        total_traffic_formatted: (nodeTraffic / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
      };
    });

    const formatB = (b: number) => {
      if (b <= 0) return '0 B';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(2) + ' KB';
      if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
      if (b < 1024 * 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      return (b / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
    };

    return {
      total_users: totalUsers,
      active_users: activeUsers,
      pending_users: mockCurrentUser.role === 'admin' ? pendingUsers : undefined,
      total_keys: totalKeys,
      active_devices_online: activeDevicesOnline,
      total_traffic_bytes: totalTrafficBytes,
      month_traffic_bytes: monthTrafficBytes,
      total_traffic_formatted: formatB(totalTrafficBytes),
      month_traffic_formatted: formatB(monthTrafficBytes),
      total_nodes: mockNodes.length,
      online_nodes: onlineNodes,
      avg_latency_ms: avgLatencyMs,
      system_status: onlineNodes === mockNodes.length ? 'operational' : 'degraded',
      topology_breakdown: {
        cascade_traffic_bytes: cascadeTrafficBytes,
        direct_traffic_bytes: directTrafficBytes,
        cascade_traffic_formatted: formatB(cascadeTrafficBytes),
        direct_traffic_formatted: formatB(directTrafficBytes),
        cascade_percentage: cascadePercentage,
        direct_percentage: directPercentage,
      },
      nodes: nodesOverview,
      generated_at: new Date().toISOString(),
    };
  },

  // Billing Mock Methods
  async getBillingStatus(): Promise<BillingStatus> {
    await new Promise((r) => setTimeout(r, 100));
    const user = mockCurrentUser;
    const history = mockBillingRecords.filter((r) => r.user_id === user.id);
    
    let lastPaidAt: string | undefined = undefined;
    let nextDueAt: Date;
    
    if (history.length > 0) {
      lastPaidAt = history[0].created_at;
      nextDueAt = new Date(new Date(lastPaidAt).getTime() + 30 * 24 * 3600 * 1000);
    } else {
      nextDueAt = new Date(new Date(user.created_at).getTime() + 30 * 24 * 3600 * 1000);
    }

    const now = Date.now();
    const daysRemaining = Math.ceil((nextDueAt.getTime() - now) / (1000 * 3600 * 24));
    const snoozedUntil = mockSnoozeMap[user.id];

    let isDue = false;
    let status: 'paid' | 'due' | 'snoozed' = 'paid';

    if (now >= nextDueAt.getTime() || daysRemaining <= 0) {
      if (snoozedUntil && now < new Date(snoozedUntil).getTime()) {
        isDue = false;
        status = 'snoozed';
      } else {
        isDue = true;
        status = 'due';
      }
    } else {
      isDue = false;
      status = 'paid';
    }

    const userKeys = mockKeys.filter((k) => k.user_id === user.id);
    const keyCount = userKeys.length;
    const isPro = Boolean(user.is_pro);
    const baseAmount = isPro ? 300 : 200;
    const extraPerKey = isPro ? 50 : 30;
    const recommendedAmount = keyCount <= 3 ? baseAmount : baseAmount + (keyCount - 3) * extraPerKey;

    return {
      is_due: isDue,
      days_remaining: daysRemaining,
      next_due_at: nextDueAt.toISOString(),
      last_paid_at: lastPaidAt,
      snoozed_until: snoozedUntil,
      status: status,
      is_pro: isPro,
      key_count: keyCount,
      recommended_amount: recommendedAmount,
      history: history,
    };
  },

  async payDues(amount?: number, note?: string): Promise<BillingStatus> {
    await new Promise((r) => setTimeout(r, 150));
    const user = mockCurrentUser;
    const currentMonth = new Date().toISOString().substring(0, 7);
    
    const newRecord: BillingRecord = {
      id: mockBillingRecords.length + 1,
      user_id: user.id,
      username: user.username,
      amount: amount || 0,
      currency: 'RUB',
      period_month: currentMonth,
      status: 'confirmed',
      note: note || '',
      created_at: new Date().toISOString(),
    };

    mockBillingRecords.unshift(newRecord);
    delete mockSnoozeMap[user.id];

    mockLogs.unshift({
      id: mockLogs.length + 1,
      user_id: user.id,
      username: user.username,
      action: 'payment_recorded',
      category: 'billing',
      ip_address: '192.168.1.10',
      details: `Подтверждение оплаты взноса: период ${currentMonth}`,
      created_at: new Date().toISOString(),
    });

    return this.getBillingStatus();
  },

  async snoozeReminder(days: number = 1): Promise<BillingStatus> {
    await new Promise((r) => setTimeout(r, 100));
    const user = mockCurrentUser;
    const snoozeDate = new Date(Date.now() + (days || 1) * 24 * 3600 * 1000).toISOString();
    mockSnoozeMap[user.id] = snoozeDate;

    mockLogs.unshift({
      id: mockLogs.length + 1,
      user_id: user.id,
      username: user.username,
      action: 'reminder_snoozed',
      category: 'billing',
      ip_address: '192.168.1.10',
      details: `Напоминание о взносе отложено на ${days || 1} дн. (до завтра)`,
      created_at: new Date().toISOString(),
    });

    return this.getBillingStatus();
  },

  async getAdminBilling(): Promise<AdminBillingSummary> {
    await new Promise((r) => setTimeout(r, 150));
    const totalPayments = mockBillingRecords.length;
    let dueCount = 0;
    
    for (const u of mockUsers) {
      if (!u.is_active) continue;
      const history = mockBillingRecords.filter((r) => r.user_id === u.id);
      let nextDue = new Date(new Date(u.created_at).getTime() + 30 * 24 * 3600 * 1000);
      if (history.length > 0) {
        nextDue = new Date(new Date(history[0].created_at).getTime() + 30 * 24 * 3600 * 1000);
      }
      if (Date.now() >= nextDue.getTime()) {
        dueCount++;
      }
    }

    return {
      total_payments: totalPayments,
      users_due_count: dueCount,
      total_users: mockUsers.length,
      records: [...mockBillingRecords],
    };
  },

  async getBillingRequisites(): Promise<BillingRequisites> {
    return { ...mockRequisites };
  },

  async updateBillingRequisites(req: BillingRequisites): Promise<BillingRequisites> {
    mockRequisites = { ...req };
    return { ...mockRequisites };
  },

  async getTelegramStatus(): Promise<TelegramStatusResponse> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      enabled: mockTelegramSettings.enabled,
      bot_username: mockTelegramSettings.bot_username || 'AvariKeysBot',
      settings: { ...mockTelegramSettings },
      subscribers: [...mockTelegramSubscribers],
      total_subscribers: mockTelegramSubscribers.length,
    };
  },

  async getTelegramSettings(): Promise<TelegramSettings> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { ...mockTelegramSettings };
  },

  async updateTelegramSettings(settings: TelegramSettings): Promise<TelegramSettings> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    mockTelegramSettings = { ...settings };
    return { ...mockTelegramSettings };
  },

  async deleteTelegramSubscriber(chatId: number): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    mockTelegramSubscribers = mockTelegramSubscribers.filter((s) => s.chat_id !== chatId);
    return { success: true, message: 'Получатель удален' };
  },

  async toggleTelegramSubscriber(chatId: number, alertsEnabled: boolean): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sub = mockTelegramSubscribers.find((s) => s.chat_id === chatId);
    if (sub) {
      sub.alerts_enabled = alertsEnabled;
    }
    return { success: true, message: alertsEnabled ? 'Оповещения включены' : 'Оповещения отключены' };
  },

  async sendTelegramTestAlert(): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      success: true,
      message: `Тестовое оповещение успешно отправлено в Telegram @${mockTelegramSettings.bot_username || 'AvariKeysBot'}`,
    };
  },

  async getUserTelegramStatus(): Promise<UserTelegramStatus> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const sub = mockTelegramSubscribers.find((s) => s.user_id === mockCurrentUser.id || s.username === mockCurrentUser.username);
    const botName = mockTelegramSettings.bot_username || 'AvariKeysBot';
    return {
      bot_username: botName,
      bot_enabled: mockTelegramSettings.enabled,
      is_linked: !!sub,
      telegram_chat_id: sub ? sub.chat_id : undefined,
      telegram_username: sub ? sub.username : undefined,
      alerts_enabled: sub ? sub.alerts_enabled : false,
      deep_link: `https://t.me/${botName}?start=link_mock_sec_${mockCurrentUser.id}_tkn`,
    };
  },

  async unlinkUserTelegram(): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    mockTelegramSubscribers = mockTelegramSubscribers.filter((s) => s.user_id !== mockCurrentUser.id && s.username !== mockCurrentUser.username);
    return { success: true, message: 'Telegram успешно отвязан от вашего аккаунта' };
  },

  // News & Announcements
  async getNews(): Promise<NewsItem[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return [...mockNews].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  },

  async createNews(payload: CreateNewsPayload): Promise<NewsItem> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const newItem: NewsItem = {
      id: Math.max(...mockNews.map((n) => n.id), 0) + 1,
      title: payload.title,
      content: payload.content,
      category: payload.category,
      is_pinned: payload.is_pinned,
      author_name: mockCurrentUser.username,
      notify_telegram: payload.notify_telegram,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockNews.unshift(newItem);
    return newItem;
  },

  async updateNews(id: number, payload: UpdateNewsPayload): Promise<NewsItem> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const idx = mockNews.findIndex((n) => n.id === id);
    if (idx === -1) {
      throw new Error('Новость не найдена');
    }
    mockNews[idx] = {
      ...mockNews[idx],
      title: payload.title,
      content: payload.content,
      category: payload.category,
      is_pinned: payload.is_pinned,
      updated_at: new Date().toISOString(),
    };
    return mockNews[idx];
  },

  async deleteNews(id: number): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    mockNews = mockNews.filter((n) => n.id !== id);
    return { success: true, message: 'Новость успешно удалена' };
  },
};

let mockNews: NewsItem[] = [
  {
    id: 1,
    title: 'Плановые технические работы на сервере Германия S2',
    content: 'В ночь на воскресенье с 02:00 до 04:00 МСК будут проводиться технические работы по обновлению ядра AmneziaWG и оптимизации сетевых маршрутов. Возможны кратковременные прерывания соединения до 5 минут.',
    category: 'maintenance',
    is_pinned: true,
    author_name: 'Forve',
    notify_telegram: true,
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 2,
    title: 'Обновление протоколов и оптимизация каскадных туннелей',
    content: 'Мы завершили настройку автоматической балансировки и мониторинга каскада M0 -> S2. Задержка в европейском сегменте снизилась в среднем на 15-20 мс.',
    category: 'general',
    is_pinned: false,
    author_name: 'Forve',
    notify_telegram: true,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 3,
    title: 'Напоминание о кооперативных взносах за октябрь',
    content: 'Напоминаем о своевременном внесении взносов за поддержание выделенных зарубежных серверов. Проверить статус взносов и реквизиты СБП можно во вкладке «Биллинг» или через Telegram-бота.',
    category: 'billing',
    is_pinned: false,
    author_name: 'Forve',
    notify_telegram: true,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

// Mock state helpers
let mockTelegramSettings: TelegramSettings = {
  enabled: true,
  bot_token: '123456789:AAFakeTokenForDevelopmentOnly_XYZ',
  bot_username: 'AvariKeysBot',
  admin_secret: 'secret123',
  notify_on_node_down: true,
  notify_on_node_recover: true,
  notify_on_new_user: true,
};

let mockTelegramSubscribers: TelegramChat[] = [
  {
    chat_id: 123456789,
    username: 'ForveAdmin',
    first_name: 'Forve',
    is_admin: true,
    alerts_enabled: true,
    created_at: new Date().toISOString(),
  },
];

let mockRequisites: BillingRequisites = {
  sbp_phone: '+7 (999) 000-00-00',
  sbp_bank: 'Т-Банк / Сбербанк',
};
const mockBillingRecords: BillingRecord[] = [
  {
    id: 1,
    user_id: 2,
    username: 'alice',
    amount: 150,
    currency: 'RUB',
    period_month: '2026-08',
    status: 'confirmed',
    note: 'Кооперативный взнос (СБП)',
    created_at: new Date(Date.now() - 32 * 86400000).toISOString(),
  },
  {
    id: 2,
    user_id: 1,
    username: 'Forve',
    amount: 300,
    currency: 'RUB',
    period_month: '2026-09',
    status: 'confirmed',
    note: 'Поддержание VPS нод M0/S1',
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
  }
];

const mockSnoozeMap: Record<number, string> = {};



