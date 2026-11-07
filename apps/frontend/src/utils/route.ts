export type TabType = 
  | 'keys' 
  | 'dashboard' 
  | 'news' 
  | 'billing' 
  | 'profile' 
  | 'nodes' 
  | 'users' 
  | 'all-keys' 
  | 'logs' 
  | 'settings';

export const ADMIN_TABS: readonly TabType[] = ['nodes', 'users', 'all-keys', 'logs', 'settings'] as const;

export const TAB_TITLES: Record<TabType, string> = {
  keys: 'Мои устройства — Avari Keys',
  dashboard: 'Статус сети — Avari Keys',
  news: 'Новости — Avari Keys',
  billing: 'Биллинг и взносы — Avari Keys',
  profile: 'Мой профиль — Avari Keys',
  nodes: 'Серверы кластера — Avari Keys Admin',
  users: 'Управление пользователями — Avari Keys Admin',
  'all-keys': 'Все VPN-ключи — Avari Keys Admin',
  logs: 'Журнал аудита — Avari Keys Admin',
  settings: 'Настройки системы — Avari Keys Admin',
};

/**
 * Returns canonical pathname for a given tab.
 */
export function tabToPath(tab: TabType): string {
  switch (tab) {
    case 'keys':
      return '/keys';
    case 'dashboard':
      return '/dashboard';
    case 'news':
      return '/news';
    case 'billing':
      return '/billing';
    case 'profile':
      return '/profile';
    case 'nodes':
      return '/admin/nodes';
    case 'users':
      return '/admin/users';
    case 'all-keys':
      return '/admin/keys';
    case 'logs':
      return '/admin/logs';
    case 'settings':
      return '/admin/settings';
    default:
      return '/keys';
  }
}

/**
 * Resolves current tab from URL pathname, hash, or localStorage fallback.
 * Checks permissions if user role is provided.
 */
export function resolveTabFromUrl(userRole?: string): TabType {
  const path = (window.location.pathname || '').toLowerCase().replace(/\/$/, '') || '/';
  const hash = (window.location.hash || '').toLowerCase().replace(/^#\/?/, '');

  let detectedTab: TabType | null = null;

  // 1. Pathname match (explicit subpaths)
  switch (path) {
    case '/keys':
      detectedTab = 'keys';
      break;
    case '/dashboard':
    case '/network':
      detectedTab = 'dashboard';
      break;
    case '/news':
      detectedTab = 'news';
      break;
    case '/billing':
      detectedTab = 'billing';
      break;
    case '/profile':
      detectedTab = 'profile';
      break;
    case '/admin/nodes':
    case '/nodes':
      detectedTab = 'nodes';
      break;
    case '/admin/users':
    case '/users':
      detectedTab = 'users';
      break;
    case '/admin/keys':
    case '/admin/all-keys':
    case '/all-keys':
      detectedTab = 'all-keys';
      break;
    case '/admin/logs':
    case '/logs':
      detectedTab = 'logs';
      break;
    case '/admin/settings':
    case '/settings':
      detectedTab = 'settings';
      break;
    default:
      detectedTab = null;
      break;
  }

  // 2. Hash match fallback (e.g. /#billing or /#news or #dashboard)
  if (!detectedTab && hash) {
    const validTabs: TabType[] = [
      'keys', 'dashboard', 'news', 'billing', 'profile',
      'nodes', 'users', 'all-keys', 'logs', 'settings',
    ];
    if (validTabs.includes(hash as TabType)) {
      detectedTab = hash as TabType;
    } else if (hash === 'network') {
      detectedTab = 'dashboard';
    } else if (hash === 'admin/keys' || hash === 'admin/all-keys') {
      detectedTab = 'all-keys';
    }
  }

  // 3. Fallback from localStorage if at root path '/'
  if (!detectedTab) {
    try {
      const saved = localStorage.getItem('avari_active_tab') as TabType | null;
      const validTabs: TabType[] = [
        'keys', 'dashboard', 'news', 'billing', 'profile',
        'nodes', 'users', 'all-keys', 'logs', 'settings',
      ];
      if (saved && validTabs.includes(saved)) {
        detectedTab = saved;
      }
    } catch {
      // Ignore storage errors
    }
  }

  // 4. Default to keys
  const finalTab = detectedTab || 'keys';

  // Permission check for admin tabs
  if (ADMIN_TABS.includes(finalTab) && userRole && userRole !== 'admin') {
    return 'keys';
  }

  return finalTab;
}

/**
 * Updates document.title based on tab.
 */
export function updateDocumentTitle(tab: TabType): void {
  const title = TAB_TITLES[tab] || 'Avari Keys — Управление AmneziaWG';
  if (typeof document !== 'undefined') {
    document.title = title;
  }
}
