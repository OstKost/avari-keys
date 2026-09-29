import { useState, useEffect } from 'react';
import { Key, Server, Users, LogOut, Plus, QrCode as QrIcon, Trash2, Smartphone, Laptop, AlertCircle, Sparkles, ShieldCheck, User as UserIcon, ScrollText, Radio, CreditCard, Settings, Newspaper } from 'lucide-react';
import { api, isMockMode, setMockMode } from './api/client';
import { User, NodePublic, ClientConfigSummary, ClientConfigDetail, BillingStatus, NewsItem } from './types';
import { AuthModal } from './components/AuthModal';
import { KeyModal } from './components/KeyModal';
import { CreateKeyModal } from './components/CreateKeyModal';
import { ConfirmModal } from './components/ConfirmModal';
import { useToast } from './context/ToastContext';
import { AdminUsers } from './components/AdminUsers';
import { AdminNodes } from './components/AdminNodes';
import { AdminAllKeys } from './components/AdminAllKeys';
import { AdminAuditLogs } from './components/AdminAuditLogs';
import { AdminSettings } from './components/AdminSettings';
import { NetworkDashboard } from './components/NetworkDashboard';
import { Loader } from './components/Loader';
import { UserProfile } from './components/UserProfile';
import { BillingPage } from './components/BillingPage';
import { BillingReminderModal } from './components/BillingReminderModal';
import { TelegramBanner } from './components/TelegramBanner';
import { NewsBanner } from './components/NewsBanner';
import { NewsPage } from './components/NewsPage';
import { Tooltip } from './components/Tooltip';
import { formatNodeRouting } from './utils/country';
import { FloatingMascot, MascotFaqModal } from './components/MascotAssistant';
import { OnboardingTour } from './components/OnboardingTour';

export default function App() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'keys' | 'dashboard' | 'news' | 'nodes' | 'users' | 'all-keys' | 'logs' | 'profile' | 'billing' | 'settings'>('keys');

  // News State
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [hasUnreadNews, setHasUnreadNews] = useState(false);

  // Keys State
  const [keys, setKeys] = useState<ClientConfigSummary[]>([]);
  const [nodes, setNodes] = useState<NodePublic[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing State
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [dismissedReminder, setDismissedReminder] = useState(false);

  // Modals
  const [viewingKey, setViewingKey] = useState<ClientConfigDetail | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ClientConfigSummary | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  // Mascot Assistant & Onboarding State
  const [showGlobalFaq, setShowGlobalFaq] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);

  // Check existing session
  useEffect(() => {
    const token = localStorage.getItem('token');
    const mock = isMockMode();
    if (!token && !mock) {
      setAuthLoading(false);
      return;
    }

    api.getMe()
      .then((user) => {
        setCurrentUser(user);
        api.getBillingStatus()
          .then((b) => setBillingStatus(b))
          .catch(() => {});
      })
      .catch(() => {
        api.logout();
        setMockMode(false);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  // Check billing status whenever user is set
  useEffect(() => {
    if (currentUser) {
      api.getBillingStatus()
        .then((b) => setBillingStatus(b))
        .catch(() => {});
    }
  }, [currentUser]);

  // Load keys & nodes & news when user logs in
  const loadDashboardData = async (silent = false) => {
    if (!currentUser) return;
    try {
      if (!silent) setKeysLoading(true);
      setError(null);
      const [keysData, nodesData] = await Promise.all([api.getKeys(), api.getNodes()]);
      const safeKeys = Array.isArray(keysData) ? keysData : [];
      setKeys(safeKeys);
      setNodes(Array.isArray(nodesData) ? nodesData : []);

      // Auto-trigger onboarding for users with no keys
      if (safeKeys.length === 0 && !silent) {
        const completed = localStorage.getItem('avari_onboarding_completed') === 'true';
        if (!completed) {
          setShowOnboarding(true);
          setOnboardingStep(1);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки данных');
    } finally {
      if (!silent) setKeysLoading(false);
    }

    // Load news and check unread status
    loadNewsData();
  };

  const loadNewsData = async () => {
    try {
      const data = await api.getNews();
      const safeNews = Array.isArray(data) ? data : [];
      setNewsList(safeNews);
      if (safeNews.length > 0) {
        const lastViewed = parseInt(localStorage.getItem('avari_last_viewed_news_id') || '0', 10);
        const maxId = Math.max(...safeNews.map((n) => n.id));
        if (maxId > lastViewed) {
          setHasUnreadNews(true);
        }
      }
    } catch {
      // Ignore background fetch error
    }
  };

  const handleOpenNewsTab = () => {
    setActiveTab('news');
    setHasUnreadNews(false);
    if (newsList.length > 0) {
      const maxId = Math.max(...newsList.map((n) => n.id));
      localStorage.setItem('avari_last_viewed_news_id', maxId.toString());
    }
  };

  const handleStartOnboarding = () => {
    setActiveTab('keys');
    setShowOnboarding(true);
    setOnboardingStep(1);
  };

  const handleCompleteOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('avari_onboarding_completed', 'true');
  };

  const handleOpenCreateModal = () => {
    setShowCreateModal(true);
    if (showOnboarding) {
      setOnboardingStep(2);
    }
  };

  useEffect(() => {
    if (currentUser && activeTab === 'keys') {
      loadDashboardData();
    }
  }, [currentUser, activeTab]);

  const handleLogout = () => {
    api.logout();
    setMockMode(false);
    setCurrentUser(null);
    toast.info('Вы успешно вышли из системы');
  };

  const handleCreateKey = async (nodeId: number, deviceName: string, psk: boolean) => {
    try {
      const newKey = await api.createKey(nodeId, deviceName, psk);
      setViewingKey(newKey);
      if (showOnboarding) {
        setOnboardingStep(4);
      }
      toast.success(`Ключ «${deviceName}» успешно создан`);
      const targetNode = nodes.find((n) => n.id === nodeId);
      const newSummary: ClientConfigSummary = {
        id: newKey.id,
        user_id: currentUser ? currentUser.id : 0,
        node_id: newKey.node_id,
        node_name: newKey.node_name || (targetNode ? targetNode.name : 'Node'),
        node_type: newKey.node_type || (targetNode ? targetNode.type : 'direct'),
        node_country_code: targetNode ? targetNode.country_code : undefined,
        client_name: newKey.client_name,
        device_name: newKey.device_name,
        created_at: newKey.created_at,
        total_traffic_bytes: 0,
        month_traffic_bytes: 0,
        total_traffic_formatted: '0 B',
        month_traffic_formatted: '0 B',
      };
      setKeys((prev) => [newSummary, ...(prev || []).filter((k) => k.id !== newKey.id)]);
      loadDashboardData(true);
    } catch (err: any) {
      toast.error(err.message || 'Не удалось создать ключ');
    }
  };

  const handleViewKey = async (id: number) => {
    try {
      const keyDetail = await api.getKey(id);
      setViewingKey(keyDetail);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка получения конфигурации');
    }
  };

  const handleConfirmDeleteKey = async () => {
    if (!keyToDelete) return;
    const targetKey = keyToDelete;
    // Optimistically remove from list and close modal
    setKeys((prev) => prev.filter((k) => k.id !== targetKey.id));
    setKeyToDelete(null);
    try {
      setDeletingKey(true);
      await api.deleteKey(targetKey.id);
      toast.success(`Ключ «${targetKey.device_name}» успешно отозван`);
      loadDashboardData(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления ключа');
      loadDashboardData(true);
    } finally {
      setDeletingKey(false);
    }
  };

  if (authLoading) {
    return <Loader size="fullscreen" text="Загрузка Avari Keys..." />;
  }

  if (!currentUser) {
    return <AuthModal onSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div className="min-h-screen bg-[#06141B] text-[#F2F0E8] flex flex-col selection:bg-[#D9B96E]/30 selection:text-[#F0D48D]">
      {/* Header */}
      <header className="border-b border-[#1C3945]/80 bg-[#0A1D26]/80 backdrop-blur-md sticky top-0 z-40 transition-all">
        <div className="max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-10 h-16 sm:h-20 flex items-center justify-between">
          
          {/* Logo & Subtitle */}
          <div className="flex items-center space-x-2.5 sm:space-x-3.5 min-w-0">
            <div className="relative group flex items-center justify-center p-1.5 rounded-2xl bg-[#102833]/80 border border-[#1C3945] hover:border-[#D9B96E]/50 transition shrink-0">
              <img 
                src="/assets/logo_star.png" 
                alt="Logo Star" 
                className="w-7 h-7 sm:w-8 sm:h-8 object-contain filter drop-shadow-[0_0_8px_rgba(217,185,110,0.4)]" 
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <span className="font-serif text-lg sm:text-xl font-bold tracking-wider text-gold-gradient uppercase truncate">
                  Avari Keys
                </span>
                <span className="text-xs sm:text-sm font-mono font-semibold uppercase tracking-wider px-2 sm:px-2.5 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#1C3945] shrink-0">
                  AWG
                </span>
                {isMockMode() && (
                  <span className="text-xs sm:text-sm font-bold px-2 sm:px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-600/40 shadow-sm font-mono shrink-0">
                    ⚡ Mock
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-[#A8B4B7] tracking-wider font-mono hidden sm:block">
                Кооперативная виртуальная сеть
              </p>
            </div>
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
            <button
              onClick={() => setActiveTab('profile')}
              title="Перейти в Мой профиль"
              className="text-right hidden sm:block px-3 py-1.5 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition group cursor-pointer"
            >
              <div className="text-sm font-semibold text-[#F2F0E8] group-hover:text-gold-gradient flex items-center justify-end space-x-1.5 transition">
                <span>{currentUser.username}</span>
                {currentUser.role === 'admin' ? (
                  <ShieldCheck className="w-4 h-4 text-[#D9B96E]" />
                ) : (
                  <UserIcon className="w-4 h-4 text-[#A8B4B7] group-hover:text-[#D9B96E]" />
                )}
              </div>
              <div className="text-sm text-[#D9B96E] uppercase tracking-wider font-mono font-medium">
                {currentUser.role === 'admin' ? 'Администратор' : 'Хранитель'}
              </div>
            </button>

            <Tooltip content="Выйти из системы">
              <button
                onClick={handleLogout}
                aria-label="Выйти"
                className="text-[#A8B4B7] hover:text-[#F2F0E8] p-2 sm:p-2.5 rounded-xl bg-[#0D222C] border border-[#1C3945] hover:border-[#D9B96E]/40 hover:bg-[#102833] transition shadow-sm"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-10 py-5 sm:py-8 w-full">
        
        {/* Navigation Tabs (Smooth horizontal swipe on mobile) */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 mb-6 sm:mb-8 border-b border-[#1C3945]/80 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
              activeTab === 'keys'
                ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Мои устройства</span>
          </button>

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
              activeTab === 'dashboard'
                ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Статус сети</span>
          </button>

          <button
            onClick={handleOpenNewsTab}
            className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
              activeTab === 'news'
                ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
            }`}
          >
            <Newspaper className="w-4 h-4" />
            <span>Новости</span>
            {hasUnreadNews && (
              <span className="w-2 h-2 rounded-full bg-[#F0D48D] shadow-sm shadow-[#F0D48D] animate-pulse ml-0.5" />
            )}
          </button>

          {currentUser.role === 'admin' && (
            <>
              <button
                onClick={() => setActiveTab('nodes')}
                className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
                  activeTab === 'nodes'
                    ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                    : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
                }`}
              >
                <Server className="w-4 h-4" />
                <span>Серверы (Ноды)</span>
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
                  activeTab === 'users'
                    ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                    : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Пользователи</span>
              </button>

              <button
                onClick={() => setActiveTab('all-keys')}
                className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
                  activeTab === 'all-keys'
                    ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                    : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span>Все ключи</span>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
                  activeTab === 'logs'
                    ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                    : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
                }`}
              >
                <ScrollText className="w-4 h-4" />
                <span>Логи действий</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
                  activeTab === 'settings'
                    ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                    : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Настройки</span>
              </button>
            </>
          )}

          <button
            onClick={() => setActiveTab('billing')}
            className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
              activeTab === 'billing'
                ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Биллинг</span>
            {billingStatus?.is_due && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-0.5" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-shrink-0 whitespace-nowrap flex items-center space-x-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium text-xs sm:text-sm uppercase tracking-wider font-mono transition duration-200 ${
              activeTab === 'profile'
                ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold shadow-lg shadow-[#D9B96E]/20'
                : 'text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945]'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Мой профиль</span>
          </button>
        </div>

        {/* Tab Container */}
        <div className="bg-[#0A1D26]/70 border border-[#1C3945] rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          
          {/* Subtle Elven Glow Overlay */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-[radial-gradient(circle_at_100%_0%,rgba(217,185,110,0.05)_0%,transparent_70%)] pointer-events-none" />

          {activeTab === 'keys' && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
                <div>
                  <h2 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] tracking-wide flex items-center space-x-2">
                    <span>VPN Конфигурации</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-[#A8B4B7] mt-1 font-sans">
                    Создавайте и управляйте конфигурациями доступа к виртуальной сети
                  </p>
                </div>

                <button
                  onClick={handleOpenCreateModal}
                  disabled={(nodes || []).length === 0}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs sm:text-sm uppercase tracking-wider font-mono px-5 py-3 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 disabled:opacity-50 transition-all duration-300 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Создать новый ключ</span>
                </button>
              </div>

              {/* Top News Announcement Banner */}
              <NewsBanner news={newsList} onNavigateToNews={handleOpenNewsTab} />

              {/* Telegram Bot Alerts Invitation Banner */}
              <TelegramBanner currentUser={currentUser} />

              {error && (
                <div className="flex items-center space-x-2 bg-rose-950/60 border border-rose-800/80 text-rose-300 text-sm p-4 rounded-xl mb-6 shadow-lg">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}

              {(nodes || []).length === 0 && !keysLoading && (
                <div className="bg-[#102833] border border-[#D9B96E]/30 text-[#D9B96E] text-sm p-5 rounded-2xl mb-6 flex items-start space-x-3">
                  <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#F0D48D]" />
                  <div>
                    <div className="font-semibold text-base text-[#F0D48D]">Нет доступных серверов</div>
                    <p className="text-[#A8B4B7] mt-0.5">
                      {isMockMode() || import.meta.env.DEV
                        ? 'В системе пока нет активных Slave-нод. Добавьте первую ноду во вкладке «Серверы (Ноды)» или войдите в Demo Mock режим.'
                        : 'В системе пока нет активных серверов. Обратитесь к администратору или добавьте узел во вкладке «Серверы (Ноды)». '}
                    </p>
                  </div>
                </div>
              )}

              {/* Keys Grid */}
              {keysLoading ? (
                <Loader size="section" text="Получение ключей из хранилища..." />
              ) : (keys || []).length === 0 ? (
                <div className="py-10 px-4 sm:px-6 flex flex-col md:flex-row items-center justify-center gap-6 max-w-2xl mx-auto">
                  <div className="shrink-0 select-none">
                    <img 
                      src="/assets/mascot.png" 
                      alt="Ари" 
                      className="w-36 sm:w-44 max-h-60 object-contain object-bottom filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] drop-shadow-[0_0_15px_rgba(217,185,110,0.25)] pointer-events-none"
                    />
                  </div>
                  <div className="flex-1 w-full gold-rotating-border">
                    <div className="gold-rotating-border-content p-6">
                      <h4 className="font-serif text-xl font-bold text-[#F2F0E8] mb-2">
                        У вас пока нет созданных ключей
                      </h4>
                      <p className="text-sm text-[#A8B4B7] font-sans leading-relaxed">
                        Я помогу настроить ваш первый AmneziaWG ключ для смартфона или компьютера за пару секунд.
                      </p>
                      <div className="text-right mt-2 mb-4 text-xs font-serif font-bold text-[#D9B96E]">
                        — Ари
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={handleOpenCreateModal}
                          disabled={(nodes || []).length === 0}
                          className="flex items-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono px-5 py-2.5 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Создать первый ключ</span>
                        </button>
                        <button
                          onClick={() => setShowGlobalFaq(true)}
                          className="flex items-center space-x-1.5 text-xs font-mono font-bold text-[#D9B96E] hover:text-[#F0D48D] uppercase tracking-wider px-4 py-2.5 rounded-xl bg-[#06141B] hover:bg-[#102833] border border-[#D9B96E]/30 transition cursor-pointer"
                        >
                          <span>5 частых вопросов</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {(keys || []).map((k) => (
                    <div
                      key={k.id}
                      className="bg-[#0D222C]/90 border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-2xl p-5 shadow-xl hover:shadow-2xl hover:shadow-[#D9B96E]/5 flex flex-col justify-between transition-all duration-300 group"
                    >
                      <div>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="bg-[#102833] p-2.5 rounded-xl text-[#D9B96E] border border-[#1C3945] group-hover:border-[#D9B96E]/40 transition">
                              {k.device_name.toLowerCase().includes('phone') || k.device_name.toLowerCase().includes('iphone') ? (
                                <Smartphone className="w-5 h-5" />
                              ) : (
                                <Laptop className="w-5 h-5" />
                              )}
                            </div>
                            <div>
                              <h4 className="font-serif font-bold text-[#F2F0E8] text-base group-hover:text-gold-gradient transition">
                                {k.device_name}
                              </h4>
                              <span className="text-sm text-[#718187] font-mono tracking-wider">{k.client_name}</span>
                            </div>
                          </div>

                          <span
                            className={`text-sm font-mono font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                              k.node_type === 'cascade'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40 shadow-sm'
                                : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40 shadow-sm'
                            }`}
                          >
                            {formatNodeRouting(k.node_type || 'direct', k.node_country_code).fullText}
                          </span>
                        </div>

                        <div className="text-sm text-[#A8B4B7] space-y-2 mb-5 bg-[#06141B]/70 p-3.5 rounded-xl border border-[#1C3945]/70 font-sans">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-[#718187]">Сервер:</span>
                            <span className="text-[#F2F0E8] font-medium truncate max-w-[180px]">{k.node_name || 'Node'}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-[#718187]">Трафик:</span>
                            <span className="text-[#F2F0E8] font-mono text-sm">
                              {k.total_traffic_formatted || '0 B'} <span className="text-[#718187]">({k.month_traffic_formatted || '0 B'}/мес)</span>
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-[#718187]">Срок действия:</span>
                            <span className="text-emerald-400 font-mono text-sm">∞ Бессрочный</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-[#718187]">Создан:</span>
                            <span className="text-[#A8B4B7] font-mono text-sm">{new Date(k.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 pt-3 border-t border-[#1C3945]/80">
                        <button
                          onClick={() => handleViewKey(k.id)}
                          className="flex-1 flex items-center justify-center space-x-2 bg-[#102833] hover:bg-[#1C3945] text-[#D9B96E] hover:text-[#F0D48D] border border-[#D9B96E]/30 hover:border-[#D9B96E]/60 font-mono text-sm uppercase tracking-wider py-2.5 px-3 rounded-xl transition shadow-sm"
                        >
                          <QrIcon className="w-4 h-4" />
                          <span>QR & Конфиг</span>
                        </button>
                        <Tooltip content="Отозвать VPN-ключ">
                          <button
                            onClick={() => setKeyToDelete(k)}
                            aria-label="Отозвать ключ"
                            className="p-2.5 text-[#718187] hover:text-rose-400 bg-[#06141B] hover:bg-rose-950/30 rounded-xl border border-[#1C3945] hover:border-rose-800/60 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'dashboard' && (
            <NetworkDashboard
              currentUser={currentUser}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}
          {activeTab === 'news' && <NewsPage currentUser={currentUser} />}
          {activeTab === 'nodes' && <AdminNodes />}
          {activeTab === 'users' && <AdminUsers />}
          {activeTab === 'all-keys' && <AdminAllKeys />}
          {activeTab === 'logs' && <AdminAuditLogs />}
          {activeTab === 'settings' && <AdminSettings />}
          {activeTab === 'billing' && <BillingPage currentUser={currentUser} />}
          {activeTab === 'profile' && <UserProfile user={currentUser} onUserUpdated={(u) => setCurrentUser(u)} />}
        </div>
      </main>

      {/* Modals */}
      {viewingKey && <KeyModal keyData={viewingKey} onClose={() => setViewingKey(null)} />}
      {showCreateModal && (
        <CreateKeyModal
          nodes={nodes}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateKey}
        />
      )}

      {/* 30-Day Billing Reminder Modal */}
      {billingStatus?.is_due && !dismissedReminder && (
        <BillingReminderModal
          daysRemaining={billingStatus.days_remaining}
          recommendedAmount={billingStatus.recommended_amount}
          keyCount={billingStatus.key_count}
          onPay={async (note) => {
            const updated = await api.payDues(0, note);
            setBillingStatus(updated);
            setDismissedReminder(true);
            toast.success('Оплата взноса успешно зафиксирована!');
          }}
          onSnooze={async (days) => {
            const updated = await api.snoozeReminder(days || 1);
            setBillingStatus(updated);
            setDismissedReminder(true);
            toast.info(`Напоминание отложено на ${days || 1} дн. (до завтра)`);
          }}
          onOpenBillingTab={() => {
            setDismissedReminder(true);
            setActiveTab('billing');
          }}
        />
      )}

      {/* Confirm Delete Key Modal */}
      <ConfirmModal
        isOpen={Boolean(keyToDelete)}
        title="Отозвать VPN-ключ?"
        variant="danger"
        confirmText="Да, отозвать ключ"
        cancelText="Отмена"
        isLoading={deletingKey}
        onConfirm={handleConfirmDeleteKey}
        onClose={() => setKeyToDelete(null)}
        message={
          keyToDelete && (
            <div>
              Вы собираетесь отозвать и удалить ключ для устройства{' '}
              <strong className="text-[#F2F0E8]">«{keyToDelete.device_name}»</strong> (узел{' '}
              <span className="text-[#D9B96E]">{keyToDelete.node_name || 'Node'}</span>).
              Конфигурация на устройстве перестанет подключаться к сети.
            </div>
          )
        }
      />

      {/* Persistent Floating Mascot Assistant */}
      <FloatingMascot
        onOpenFaq={() => setShowGlobalFaq(true)}
        onStartOnboarding={handleStartOnboarding}
      />

      {/* Global 5 Questions & Answers Modal */}
      <MascotFaqModal
        isOpen={showGlobalFaq}
        onClose={() => setShowGlobalFaq(false)}
      />

      {/* Step-by-Step Onboarding Walkthrough */}
      <OnboardingTour
        isActive={showOnboarding}
        currentStep={onboardingStep}
        onComplete={handleCompleteOnboarding}
      />

      {/* Footer */}
      <footer className="border-t border-[#1C3945]/60 py-6 text-center text-sm text-[#718187] font-mono tracking-wider">
        Avari Keys &copy; 2026 — «Добровольный кооператив • Частная виртуальная сеть»
      </footer>
    </div>
  );
}
