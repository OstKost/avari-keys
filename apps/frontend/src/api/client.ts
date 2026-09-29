import {
  User,
  NodePublic,
  AdminNode,
  ClientConfigSummary,
  ClientConfigDetail,
  PaginatedKeysResponse,
  PaginatedAuditLogsResponse,
  AuditLogFilterParams,
  CleanupLogsResponse,
  DashboardStats,
  EgressStatusResponse,
  BillingStatus,
  AdminBillingSummary,
  BillingRequisites,
  TelegramStatusResponse,
  TelegramSettings,
  UserTelegramStatus,
  NewsItem,
  CreateNewsPayload,
  UpdateNewsPayload,
} from '../types';

import { mockApi } from './mockClient';

const API_BASE = '/api/v1';

// Check if Mock mode is active (via env var or localStorage)
export const isMockMode = (): boolean => {
  return (
    import.meta.env.VITE_USE_MOCK === 'true' ||
    localStorage.getItem('use_mock_mode') === 'true'
  );
};

export const setMockMode = (enabled: boolean) => {
  if (enabled) {
    localStorage.setItem('use_mock_mode', 'true');
  } else {
    localStorage.removeItem('use_mock_mode');
  }
};

export const loginAsDemoUser = async (username: string): Promise<User> => {
  setMockMode(true);
  return mockApi.setDemoUser(username);
};

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMsg = `HTTP Error ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) {
        errorMsg = data.error;
      }
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

const realApi = {
  // Auth
  async login(username: string, password: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await handleResponse<{ token: string; user: User }>(res);
    localStorage.setItem('token', data.token);
    return data;
  },

  async register(username: string, password: string): Promise<{ message: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse<{ message: string; user: User }>(res);
  },

  async getMe(): Promise<User> {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<User>(res);
  },

  async updateProfile(data: { username?: string; password?: string }): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ token: string; user: User }>(res);
    if (result.token) {
      localStorage.setItem('token', result.token);
    }
    return result;
  },

  logout() {
    localStorage.removeItem('token');
  },

  // User: Nodes & Keys
  async getNodes(): Promise<NodePublic[]> {
    const res = await fetch(`${API_BASE}/nodes`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<NodePublic[]>(res);
    return Array.isArray(data) ? data : [];
  },

  async getKeys(): Promise<ClientConfigSummary[]> {
    const res = await fetch(`${API_BASE}/keys`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<ClientConfigSummary[]>(res);
    return Array.isArray(data) ? data : [];
  },

  async createKey(nodeId: number, deviceName: string, psk?: boolean): Promise<ClientConfigDetail> {
    const res = await fetch(`${API_BASE}/keys`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ node_id: nodeId, device_name: deviceName, psk: psk || false }),
    });
    return handleResponse<ClientConfigDetail>(res);
  },

  async getKey(id: number): Promise<ClientConfigDetail> {
    const res = await fetch(`${API_BASE}/keys/${id}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<ClientConfigDetail>(res);
  },

  async deleteKey(id: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/keys/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Admin
  async getAdminUsers(): Promise<User[]> {
    const res = await fetch(`${API_BASE}/admin/users`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<User[]>(res);
    return Array.isArray(data) ? data : [];
  },

  async activateUser(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/admin/users/${id}/activate`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean }>(res);
  },

  async deactivateUser(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/admin/users/${id}/deactivate`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean }>(res);
  },

  async setUserRole(id: number, role: 'admin' | 'user'): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/users/${id}/role`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role }),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async deleteUser(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean }>(res);
  },

  async getAdminNodes(): Promise<AdminNode[]> {
    const res = await fetch(`${API_BASE}/admin/nodes`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<AdminNode[]>(res);
    return Array.isArray(data) ? data : [];
  },

  async addAdminNode(
    name: string,
    type: 'cascade' | 'direct',
    apiUrl: string,
    apiKey: string,
    isMobileOptimized?: boolean,
    countryCode?: string,
    providerUrl?: string
  ): Promise<AdminNode> {
    const res = await fetch(`${API_BASE}/admin/nodes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name,
        type,
        api_url: apiUrl,
        api_key: apiKey,
        is_mobile_optimized: isMobileOptimized || false,
        country_code: countryCode || '',
        provider_url: providerUrl || '',
      }),
    });
    return handleResponse<AdminNode>(res);
  },

  async updateAdminNode(
    id: number,
    data: {
      name: string;
      type: 'cascade' | 'direct';
      apiUrl: string;
      apiKey?: string;
      isMobileOptimized?: boolean;
      countryCode?: string;
      providerUrl?: string;
    }
  ): Promise<AdminNode> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: data.name,
        type: data.type,
        api_url: data.apiUrl,
        api_key: data.apiKey || '',
        is_mobile_optimized: data.isMobileOptimized || false,
        country_code: data.countryCode || '',
        provider_url: data.providerUrl || '',
      }),
    });
    return handleResponse<AdminNode>(res);
  },

  async deleteAdminNode(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean }>(res);
  },

  async restartNode(id: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}/restart`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async backupNode(id: number): Promise<{ timestamp: string; backup_data: string }> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}/backup`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{ timestamp: string; backup_data: string }>(res);
  },

  async restoreNode(id: number, backupData: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ backup_data: backupData }),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getNodeEgress(id: number): Promise<EgressStatusResponse> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}/egress`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<EgressStatusResponse>(res);
  },

  async switchNodeEgress(id: number, targetInterface: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/nodes/${id}/egress`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ interface: targetInterface }),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getAdminKeys(params?: {
    search?: string;
    nodeId?: number;
    page?: number;
    limit?: number;
  }): Promise<PaginatedKeysResponse> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.nodeId) query.set('node_id', params.nodeId.toString());
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/admin/keys${qs}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<PaginatedKeysResponse>(res);
    return {
      ...data,
      keys: Array.isArray(data?.keys) ? data.keys : [],
      total_count: data?.total_count || 0,
      page: data?.page || 1,
      limit: data?.limit || 10,
      total_pages: data?.total_pages || 1,
    };
  },

  async getAdminAuditLogs(params?: AuditLogFilterParams): Promise<PaginatedAuditLogsResponse> {
    const query = new URLSearchParams();
    if (params?.userId) query.set('user_id', params.userId.toString());
    if (params?.username) query.set('username', params.username);
    if (params?.category) query.set('category', params.category);
    if (params?.action) query.set('action', params.action);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/admin/logs${qs}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<PaginatedAuditLogsResponse>(res);
    return {
      ...data,
      logs: Array.isArray(data?.logs) ? data.logs : [],
      total_count: data?.total_count || 0,
      page: data?.page || 1,
      limit: data?.limit || 50,
      total_pages: data?.total_pages || 1,
    };
  },

  async cleanupAdminAuditLogs(days: number = 90): Promise<CleanupLogsResponse> {
    const res = await fetch(`${API_BASE}/admin/logs/cleanup`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ days }),
    });
    return handleResponse<CleanupLogsResponse>(res);
  },

  async getDashboardStats(fresh?: boolean): Promise<DashboardStats> {
    const qs = fresh ? '?fresh=true' : '';
    const res = await fetch(`${API_BASE}/stats/dashboard${qs}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<DashboardStats>(res);
    return {
      ...data,
      nodes: Array.isArray(data?.nodes) ? data.nodes : [],
    };
  },

  // Billing
  async getBillingStatus(): Promise<BillingStatus> {
    const res = await fetch(`${API_BASE}/billing/status`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<BillingStatus>(res);
    return {
      ...data,
      history: Array.isArray(data?.history) ? data.history : [],
    };
  },

  async payDues(amount?: number, note?: string): Promise<BillingStatus> {
    const res = await fetch(`${API_BASE}/billing/pay`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount: amount || 0, note: note || '' }),
    });
    const data = await handleResponse<BillingStatus>(res);
    return {
      ...data,
      history: Array.isArray(data?.history) ? data.history : [],
    };
  },

  async snoozeReminder(days: number = 1): Promise<BillingStatus> {
    const res = await fetch(`${API_BASE}/billing/snooze`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ days }),
    });
    const data = await handleResponse<BillingStatus>(res);
    return {
      ...data,
      history: Array.isArray(data?.history) ? data.history : [],
    };
  },

  async getAdminBilling(): Promise<AdminBillingSummary> {
    const res = await fetch(`${API_BASE}/admin/billing`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<AdminBillingSummary>(res);
    return {
      ...data,
      records: Array.isArray(data?.records) ? data.records : [],
    };
  },

  async getBillingRequisites(): Promise<BillingRequisites> {
    const res = await fetch(`${API_BASE}/billing/requisites`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<BillingRequisites>(res);
  },

  async updateBillingRequisites(req: BillingRequisites): Promise<BillingRequisites> {
    const res = await fetch(`${API_BASE}/admin/billing/requisites`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(req),
    });
    return handleResponse<BillingRequisites>(res);
  },

  async getTelegramStatus(): Promise<TelegramStatusResponse> {
    const res = await fetch(`${API_BASE}/admin/telegram/status`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TelegramStatusResponse>(res);
  },

  async getTelegramSettings(): Promise<TelegramSettings> {
    const res = await fetch(`${API_BASE}/admin/telegram/settings`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<TelegramSettings>(res);
  },

  async updateTelegramSettings(settings: TelegramSettings): Promise<TelegramSettings> {
    const res = await fetch(`${API_BASE}/admin/telegram/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings),
    });
    return handleResponse<TelegramSettings>(res);
  },

  async deleteTelegramSubscriber(chatId: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/telegram/subscribers/${chatId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async toggleTelegramSubscriber(chatId: number, alertsEnabled: boolean): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/telegram/subscribers/${chatId}/toggle`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ alerts_enabled: alertsEnabled }),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async sendTelegramTestAlert(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/telegram/test`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getUserTelegramStatus(): Promise<UserTelegramStatus> {
    const res = await fetch(`${API_BASE}/user/telegram`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<UserTelegramStatus>(res);
  },

  async unlinkUserTelegram(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/user/telegram/unlink`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // News & Announcements
  async getNews(): Promise<NewsItem[]> {
    const res = await fetch(`${API_BASE}/news`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<NewsItem[]>(res);
  },

  async createNews(data: CreateNewsPayload): Promise<NewsItem> {
    const res = await fetch(`${API_BASE}/admin/news`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<NewsItem>(res);
  },

  async updateNews(id: number, data: UpdateNewsPayload): Promise<NewsItem> {
    const res = await fetch(`${API_BASE}/admin/news/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<NewsItem>(res);
  },

  async deleteNews(id: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/admin/news/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },
};

// Dispatcher API: delegates to mockApi or realApi
export const api = new Proxy(realApi, {
  get(target, prop: keyof typeof realApi) {
    if (isMockMode()) {
      return (mockApi as any)[prop] || (target as any)[prop];
    }
    return (target as any)[prop];
  },
});
