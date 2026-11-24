import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  CreditCard,
  Activity,
  Server,
  RefreshCw,
  Copy,
  Check,
  Download,
  Plus,
  Smartphone,
  ChevronRight,
  ArrowRightLeft,
  Radio,
  Globe,
  User as UserIcon,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { api, isMockMode } from '../api/client';
import {
  User,
  NodePublic,
  AdminNode,
  ClientConfigSummary,
  ClientConfigDetail,
  BillingStatus,
  BillingRequisites,
  EgressStatusResponse,
  ProtocolType,
} from '../types';
import { formatCountry, getCountryFlag } from '../utils/country';
import {
  initTelegramWebApp,
  getTelegramInitData,
  triggerHaptic,
  triggerNotificationHaptic,
} from '../utils/telegram';

type TmaUserTab = 'status' | 'keys' | 'billing';
type TmaAdminTab = 'servers' | 'cascade' | 'user_view';

interface TelegramMiniAppProps {
  onExitToWeb?: () => void;
}

export const TelegramMiniApp: React.FC<TelegramMiniAppProps> = ({ onExitToWeb }) => {
  // Auth & Mode states
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isUnlinked, setIsUnlinked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tabs
  const [userTab, setUserTab] = useState<TmaUserTab>('status');
  const [adminTab, setAdminTab] = useState<TmaAdminTab>('servers');

  // User Mode Data
  const [keys, setKeys] = useState<ClientConfigSummary[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [keyDetail, setKeyDetail] = useState<ClientConfigDetail | null>(null);
  const [keyDetailLoading, setKeyDetailLoading] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [requisites, setRequisites] = useState<BillingRequisites | null>(null);
  const [billingPaidSent, setBillingPaidSent] = useState(false);

  // Key creation modal
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [availableNodes, setAvailableNodes] = useState<NodePublic[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolType>('awg');
  const [creatingKey, setCreatingKey] = useState(false);

  // Admin Mode Data
  const [adminNodes, setAdminNodes] = useState<AdminNode[]>([]);
  const [refreshingNodes, setRefreshingNodes] = useState(false);
  const [egressStatus, setEgressStatus] = useState<EgressStatusResponse | null>(null);
  const [switchingEgress, setSwitchingEgress] = useState(false);
  const [checkingEgress, setCheckingEgress] = useState(false);
  const [egressSuccessMsg, setEgressSuccessMsg] = useState<string | null>(null);

  // Mock Mode Switcher state
  const mock = isMockMode();
  const [mockRole, setMockRole] = useState<'user' | 'admin' | 'unlinked'>(() => {
    return (localStorage.getItem('mock_tma_role') as any) || 'user';
  });

  // 1. Initialize Telegram WebApp window & Auth
  const authenticate = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    setIsUnlinked(false);

    try {
      initTelegramWebApp();
      const initData = getTelegramInitData();

      // If mock mode, handle simulated role
      if (mock) {
        if (mockRole === 'unlinked') {
          setIsUnlinked(true);
          setLoading(false);
          return;
        }
        const resp = await api.authenticateTelegramMiniApp(
          mockRole === 'admin' ? 'role=admin' : 'role=user'
        );
        setCurrentUser(resp.user);
        setIsAdmin(resp.is_admin);
        setLoading(false);
        return;
      }

      if (!initData) {
        // Opened outside Telegram without initData: check existing token
        const me = await api.getMe();
        if (me) {
          setCurrentUser(me);
          setIsAdmin(me.role === 'admin');
          setLoading(false);
          return;
        }
        setIsUnlinked(true);
        setLoading(false);
        return;
      }

      const resp = await api.authenticateTelegramMiniApp(initData);
      setCurrentUser(resp.user);
      setIsAdmin(resp.is_admin);
    } catch (err: any) {
      console.warn('[Telegram Mini App] Auth failed:', err);
      if (err?.error === 'unlinked_chat' || !err?.is_linked) {
        setIsUnlinked(true);
      } else {
        setAuthError(err.message || 'Ошибка авторизации Telegram');
      }
    } finally {
      setLoading(false);
    }
  }, [mock, mockRole]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  // 2. Fetch User Data
  const loadUserData = useCallback(async () => {
    try {
      const [userKeys, billing, reqs, nodesList] = await Promise.all([
        api.getKeys(),
        api.getBillingStatus().catch(() => null),
        api.getBillingRequisites().catch(() => null),
        api.getNodes().catch(() => []),
      ]);
      setKeys(userKeys);
      setBillingStatus(billing);
      setRequisites(reqs);
      setAvailableNodes(nodesList);

      if (userKeys.length > 0 && selectedKeyId === null) {
        setSelectedKeyId(userKeys[0].id);
      }
    } catch (err) {
      console.error('[Telegram Mini App] Failed to load user data:', err);
    }
  }, [selectedKeyId]);

  // 3. Fetch Admin Data
  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setRefreshingNodes(true);
      const nodesList = await api.getAdminNodes();
      setAdminNodes(nodesList);

      // Find cascade node and fetch its egress status
      const cascade = nodesList.find((n) => n.type === 'cascade');
      if (cascade) {
        const egress = await api.getNodeEgress(cascade.id).catch(() => null);
        setEgressStatus(egress);
      }
    } catch (err) {
      console.error('[Telegram Mini App] Failed to load admin nodes:', err);
    } finally {
      setRefreshingNodes(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (currentUser) {
      loadUserData();
      if (isAdmin) {
        loadAdminData();
      }
    }
  }, [currentUser, isAdmin, loadUserData, loadAdminData]);

  // 4. Fetch Selected Key Detail & generate QR code
  useEffect(() => {
    if (!selectedKeyId) {
      setKeyDetail(null);
      setQrCodeUrl('');
      return;
    }

    setKeyDetailLoading(true);
    api.getKey(selectedKeyId)
      .then(async (detail) => {
        setKeyDetail(detail);
        const qrContent = detail.vpn_uri || detail.config;
        if (qrContent) {
          try {
            const url = await QRCode.toDataURL(qrContent, {
              width: 300,
              margin: 2,
              color: { dark: '#06141B', light: '#FFFFFF' },
            });
            setQrCodeUrl(url);
          } catch (e) {
            console.error('Failed to generate QR code', e);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to fetch key details', err);
      })
      .finally(() => {
        setKeyDetailLoading(false);
      });
  }, [selectedKeyId]);

  // Actions
  const handleCopy = (text: string) => {
    triggerHaptic('medium');
    navigator.clipboard.writeText(text);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const handleDownloadConf = (key: ClientConfigDetail) => {
    triggerHaptic('light');
    const isMieruKey = key.protocol === 'mieru' || key.protocol === 'vless';
    const isHysteriaKey = key.protocol === 'hysteria2';
    const ext = isMieruKey ? 'json' : isHysteriaKey ? 'yaml' : 'conf';
    const mime = isMieruKey ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([key.config || key.vpn_uri || ''], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key.client_name || 'avari-vpn'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNotifyPaid = async () => {
    triggerHaptic('heavy');
    try {
      const amount = billingStatus?.recommended_amount || (keys.length ? keys.length * 150 : 150);
      const updated = await api.payDues(amount, 'Оплата через Telegram Mini App');
      setBillingStatus(updated);
      setBillingPaidSent(true);
      triggerNotificationHaptic('success');
      setTimeout(() => setBillingPaidSent(false), 5000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateNewKey = async () => {
    if (!selectedNodeId) return;
    setCreatingKey(true);
    triggerHaptic('medium');
    try {
      const deviceName = newKeyName.trim() || 'Telegram Устройство';
      const created = await api.createKey(selectedNodeId, deviceName, false, selectedProtocol);
      triggerNotificationHaptic('success');
      setShowCreateKey(false);
      setNewKeyName('');
      await loadUserData();
      setSelectedKeyId(created.id);
    } catch (err: any) {
      alert(err.message || 'Ошибка создания ключа');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleSwitchCascadeEgress = async (cascadeNodeId: number, targetInterface: string, targetLabel: string) => {
    triggerHaptic('heavy');
    setSwitchingEgress(true);
    setEgressSuccessMsg(null);
    try {
      const res = await api.switchNodeEgress(cascadeNodeId, targetInterface);
      triggerNotificationHaptic('success');
      setEgressSuccessMsg(res.message || `Каскад успешно переключен на ${targetLabel}!`);
      await loadAdminData();
      setTimeout(() => setEgressSuccessMsg(null), 4000);
    } catch (err: any) {
      triggerNotificationHaptic('error');
      alert(`Ошибка переключения каскада: ${err.message}`);
    } finally {
      setSwitchingEgress(false);
    }
  };

  const handleCheckCascadeEgress = async (cascadeNodeId: number) => {
    triggerHaptic('medium');
    setCheckingEgress(true);
    try {
      const egress = await api.getNodeEgress(cascadeNodeId);
      setEgressStatus(egress);
      triggerNotificationHaptic('success');
    } catch (err: any) {
      triggerNotificationHaptic('error');
      alert(`Ошибка проверки шлюзов: ${err.message}`);
    } finally {
      setCheckingEgress(false);
    }
  };

  // Mock Role Switcher (for browser/demo testing)
  const switchMockRole = (role: 'user' | 'admin' | 'unlinked') => {
    setMockRole(role);
    localStorage.setItem('mock_tma_role', role);
    triggerHaptic('light');
  };

  // Calculated traffic summary
  const totalTrafficFormatted = keys.reduce((acc, k) => acc + (k.total_traffic_bytes || 0), 0);
  const formattedTraffic = totalTrafficFormatted > 1073741824
    ? `${(totalTrafficFormatted / 1073741824).toFixed(2)} GB`
    : `${(totalTrafficFormatted / 1048576).toFixed(1)} MB`;

  const userMonthTrafficFormatted =
    currentUser?.month_traffic?.formatted ||
    currentUser?.month_traffic_formatted ||
    (() => {
      const sum = keys.reduce((acc, k) => acc + (k.month_traffic_bytes || 0), 0);
      return sum > 1073741824
        ? `${(sum / 1073741824).toFixed(2)} GB`
        : `${(sum / 1048576).toFixed(1)} MB`;
    })();

  // -------------------------------------------------------------
  // RENDER: Loading State
  // -------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-[#040B0F] text-slate-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center animate-pulse">
            <Radio className="w-7 h-7 text-cyan-400 animate-spin" />
          </div>
        </div>
        <div className="text-sm font-medium text-cyan-300">Подключение к Avari Keys...</div>
        <div className="text-xs text-slate-500 mt-1">Проверка Telegram-сессии</div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: Unlinked / Decoy Access Restricted State
  // -------------------------------------------------------------
  if (isUnlinked) {
    return (
      <div className="min-h-screen bg-[#040B0F] text-slate-100 flex flex-col justify-between p-5 select-none font-sans">
        {/* Mock switcher bar */}
        {mock && (
          <div className="bg-slate-900/90 border border-slate-700/60 rounded-xl p-2 mb-4 flex items-center justify-between text-xs">
            <span className="text-slate-400 font-mono">Mock Mode:</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => switchMockRole('user')}
                className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-cyan-400"
              >
                👤 Alice (User)
              </button>
              <button
                onClick={() => switchMockRole('admin')}
                className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-cyan-400"
              >
                👑 Admin
              </button>
              <button
                onClick={() => switchMockRole('unlinked')}
                className="px-2 py-1 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-700/50"
              >
                🚫 Unlinked
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto">
          <div className="w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-5 shadow-lg shadow-amber-500/5">
            <ShieldAlert className="w-10 h-10 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Доступ ограничен</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Ваш Telegram-аккаунт еще не подключен к системе <span className="text-cyan-400 font-medium">Avari Keys</span>.
          </p>

          <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 text-left mb-6 text-xs text-slate-300 space-y-2">
            <div className="font-semibold text-slate-200 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-cyan-400" /> Как подключиться:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1">
              <li>Откройте веб-панель Avari Keys в браузере.</li>
              <li>Перейдите в раздел «Настройки» или нажмите на баннер Telegram.</li>
              <li>Скопируйте персональный код или нажмите кнопку привязки в боте.</li>
            </ol>
          </div>

          {onExitToWeb && (
            <button
              onClick={onExitToWeb}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors border border-slate-700/60"
            >
              Перейти в веб-панель
            </button>
          )}
        </div>

        <div className="text-center text-[11px] text-slate-600 pb-2">
          Avari Keys • Telegram Mini App v1.6.0
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // USER VIEW TABS & CONTENT
  // -------------------------------------------------------------
  const renderUserMode = () => {
    const activeKey = keys.find((k) => k.id === selectedKeyId) || keys[0];

    return (
      <div className="space-y-4">
        {/* User Segmented Control Tabs */}
        <div className="grid grid-cols-3 gap-1 bg-slate-900/90 border border-slate-800/80 p-1 rounded-2xl">
          <button
            onClick={() => {
              triggerHaptic('light');
              setUserTab('status');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              userTab === 'status'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Статус</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('light');
              setUserTab('keys');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              userTab === 'keys'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Ключи</span>
            {keys.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] flex items-center justify-center font-mono">
                {keys.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              triggerHaptic('light');
              setUserTab('billing');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              userTab === 'billing'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Биллинг</span>
            {billingStatus?.is_due && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* TAB 1: STATUS */}
        {userTab === 'status' && (
          <div className="space-y-3">
            {/* Account card */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-sm">
                    {currentUser?.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      {currentUser?.username}
                      {currentUser?.is_pro && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          PRO
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Аккаунт активен
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500 block">Устройств</span>
                  <span className="text-sm font-semibold text-white font-mono">{keys.length}</span>
                </div>
              </div>

              {/* Bot status badge */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-cyan-400" /> Telegram-бот:
                </span>
                <span className="text-emerald-400 font-medium flex items-center gap-1 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Подключен
                </span>
              </div>
            </div>

            {/* Network Health Card */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-cyan-400" /> Состояние VPN-сети
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Штатно
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-500 block text-[10px] truncate">За месяц</span>
                  <span className="text-cyan-400 font-semibold font-mono text-xs truncate block">
                    {userMonthTrafficFormatted}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-500 block text-[10px] truncate">Всего</span>
                  <span className="text-slate-200 font-semibold font-mono text-xs truncate block">
                    {formattedTraffic}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-slate-500 block text-[10px] truncate">Взнос</span>
                  <span className="text-slate-200 font-semibold text-xs truncate block">
                    {billingStatus?.is_due ? 'Ожидается' : 'Оплачен'}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Action: Open Active Key */}
            {activeKey && (
              <button
                onClick={() => {
                  triggerHaptic('light');
                  setUserTab('keys');
                }}
                className="w-full bg-gradient-to-r from-cyan-900/30 via-slate-900/80 to-blue-900/30 border border-cyan-500/30 hover:border-cyan-500/50 p-3.5 rounded-2xl flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-300">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Активный ключ</div>
                    <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <span>{getCountryFlag(activeKey.node_country_code || 'NLD')}</span>
                      <span>{activeKey.client_name || activeKey.device_name}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-300 transition-colors" />
              </button>
            )}
          </div>
        )}

        {/* TAB 2: KEYS */}
        {userTab === 'keys' && (
          <div className="space-y-4">
            {/* Key Selector if multiple keys */}
            {keys.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {keys.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => {
                      triggerHaptic('light');
                      setSelectedKeyId(k.id);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-all ${
                      selectedKeyId === k.id
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-semibold'
                        : 'bg-slate-900/80 text-slate-400 border border-slate-800'
                    }`}
                  >
                    <span>{getCountryFlag(k.node_country_code || 'NLD')}</span>
                    <span>{k.client_name || k.device_name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Active Key Detail Card */}
            {activeKey ? (
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{getCountryFlag(activeKey.node_country_code || 'NLD')}</span>
                    <div>
                      <div className="text-sm font-bold text-white">
                        {activeKey.client_name || activeKey.device_name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatCountry(activeKey.node_country_code || 'NLD')} • {activeKey.node_name || 'Кластер'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      (activeKey.protocol === 'mieru' || activeKey.protocol === 'vless')
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : activeKey.protocol === 'hysteria2'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    }`}
                  >
                    {activeKey.protocol === 'vless' ? 'VLESS+Reality' : activeKey.protocol === 'mieru' ? 'Mieru' : activeKey.protocol === 'hysteria2' ? 'Hysteria 2' : 'AmneziaWG'}
                  </span>
                </div>

                {/* QR Code Container */}
                <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl shadow-inner my-2">
                  {keyDetailLoading ? (
                    <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin text-slate-600" />
                    </div>
                  ) : qrCodeUrl ? (
                    <img
                      src={qrCodeUrl}
                      alt="VPN QR Code"
                      className="w-48 h-48 rounded-lg select-none"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs text-center p-4">
                      Не удалось сформировать QR-код
                    </div>
                  )}
                  <span className="text-[11px] text-slate-600 mt-1 font-medium">
                    {(activeKey.protocol === 'mieru' || activeKey.protocol === 'vless')
                      ? 'Сканируйте в Hiddify / NekoBox'
                      : activeKey.protocol === 'hysteria2'
                      ? 'Сканируйте в v2rayNG / NekoBox'
                      : 'Сканируйте в приложении AmneziaVPN'}
                  </span>
                </div>

                {/* Actions: Copy & Download */}
                {keyDetail && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => handleCopy(keyDetail.vpn_uri || keyDetail.config)}
                      className="py-2.5 px-3 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {copiedConfig ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedConfig ? 'Скопировано!' : 'Скопировать'}</span>
                    </button>
                    <button
                      onClick={() => handleDownloadConf(keyDetail)}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {keyDetail.protocol === 'mieru' || keyDetail.protocol === 'vless'
                          ? 'Скачать .json'
                          : keyDetail.protocol === 'hysteria2'
                          ? 'Скачать .yaml'
                          : 'Скачать .conf'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl">
                <Key className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <div className="text-sm font-medium text-slate-300">У вас пока нет ключей</div>
                <div className="text-xs text-slate-500 mt-1 mb-4">
                  Создайте первый ключ для подключения к защищенной сети.
                </div>
              </div>
            )}

            {/* Create Key Button */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setShowCreateKey(true);
                if (availableNodes.length > 0 && selectedNodeId === null) {
                  setSelectedNodeId(availableNodes[0].id);
                }
              }}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Создать новый ключ</span>
            </button>
          </div>
        )}

        {/* TAB 3: BILLING */}
        {userTab === 'billing' && (
          <div className="space-y-3">
            {/* Status overview */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400 font-medium">Статус взноса</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
                    billingStatus?.is_due
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  {billingStatus?.is_due ? (
                    <>
                      <Clock className="w-3 h-3" /> Требуется взнос
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3 h-3" /> Оплачено
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-baseline justify-between mb-2">
                <span className="text-2xl font-bold text-white font-mono">
                  {billingStatus?.recommended_amount || (keys.length ? keys.length * 150 : 150)} ₽
                </span>
                <span className="text-xs text-slate-400">ориентировочный взнос</span>
              </div>

              <div className="text-xs text-slate-300 mt-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 leading-relaxed">
                {billingStatus?.is_due
                  ? 'Ожидается очередной кооперативный взнос для поддержания серверной инфраструктуры.'
                  : 'Все взносы оплачены. Спасибо за поддержку независимой сети Avari Keys! ✨'}
              </div>
            </div>

            {/* Requisites Card */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 space-y-3">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-cyan-400" /> Реквизиты для перевода (СБП)
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-500 block">Номер телефона</span>
                  <span className="text-sm font-semibold text-white font-mono">
                    {requisites?.sbp_phone || '+7 (999) 000-00-00'}
                  </span>
                </div>
                <button
                  onClick={() => handleCopy(requisites?.sbp_phone || '')}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-medium flex items-center gap-1 border border-slate-700 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Копировать
                </button>
              </div>

              <div className="px-3 py-2 rounded-xl bg-slate-950/40 text-xs text-slate-400 flex items-center justify-between">
                <span>Банк-получатель:</span>
                <span className="text-slate-200 font-medium">
                  {requisites?.sbp_bank || 'Т-Банк / Сбербанк'}
                </span>
              </div>
            </div>

            {/* "I paid" Button */}
            <button
              onClick={handleNotifyPaid}
              disabled={billingPaidSent}
              className={`w-full py-3.5 px-4 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 transition-all ${
                billingPaidSent
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{billingPaidSent ? 'Уведомление отправлено!' : '✅ Я оплатил взнос'}</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------
  // ADMIN VIEW TABS & CONTENT
  // -------------------------------------------------------------
  const renderAdminMode = () => {
    const cascadeNode = adminNodes.find((n) => n.type === 'cascade');
    const egressTargets = egressStatus?.targets || [];

    return (
      <div className="space-y-4">
        {/* Admin Segmented Control Tabs */}
        <div className="grid grid-cols-3 gap-1 bg-slate-900/90 border border-slate-800/80 p-1 rounded-2xl">
          <button
            onClick={() => {
              triggerHaptic('light');
              setAdminTab('servers');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              adminTab === 'servers'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Серверы</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('light');
              setAdminTab('cascade');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              adminTab === 'cascade'
                ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Каскад</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('light');
              setAdminTab('user_view');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              adminTab === 'user_view'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Мой аккаунт</span>
          </button>
        </div>

        {/* ADMIN TAB 1: SERVERS OVERVIEW & HEALTH */}
        {adminTab === 'servers' && (
          <div className="space-y-3">
            {/* Cluster Stats Bar */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-3.5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span>Кластер Avari Keys</span>
                </div>
                <button
                  onClick={loadAdminData}
                  disabled={refreshingNodes}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition-colors border border-slate-700"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingNodes ? 'animate-spin text-amber-400' : ''}`} />
                  <span>{refreshingNodes ? 'Опрос...' : 'Обновить'}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Всего нод</span>
                  <span className="font-bold text-slate-200 font-mono text-sm">{adminNodes.length}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Online</span>
                  <span className="font-bold text-emerald-400 font-mono text-sm">
                    {adminNodes.filter((n) => n.online).length}
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Offline</span>
                  <span className="font-bold text-rose-400 font-mono text-sm">
                    {adminNodes.filter((n) => !n.online).length}
                  </span>
                </div>
              </div>
            </div>

            {/* Nodes List */}
            <div className="space-y-2">
              {adminNodes.map((node) => (
                <div
                  key={node.id}
                  className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{getCountryFlag(node.country_code || 'NLD')}</span>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>{node.name}</span>
                        {node.type === 'cascade' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            КАСКАД
                          </span>
                        )}
                        {node.is_backup && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            РЕЗЕРВ
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatCountry(node.country_code || 'NLD')} • {node.type}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                        node.online
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      <span className="relative flex h-2 w-2 items-center justify-center">
                        {node.online ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        ) : (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500 animate-beacon-red" />
                          </>
                        )}
                      </span>
                      <span className="whitespace-nowrap">{node.online ? `${node.latency_ms || 24} ms` : 'Offline'}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ADMIN TAB 2: CASCADE SWITCHING */}
        {adminTab === 'cascade' && (
          <div className="space-y-3">
            {egressSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{egressSuccessMsg}</span>
              </div>
            )}

            {cascadeNode ? (
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      Каскадный Ingress (M0)
                    </span>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>🇷🇺</span>
                      <span>{cascadeNode.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={checkingEgress || switchingEgress}
                      onClick={() => handleCheckCascadeEgress(cascadeNode.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-amber-300 border border-slate-700 text-xs font-medium transition active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${checkingEgress ? 'animate-spin text-amber-400' : ''}`} />
                      <span>{checkingEgress ? '...' : 'Проверить'}</span>
                    </button>
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-semibold">
                      Double-Hop
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold text-slate-300 block mb-2">
                    Шлюзы выхода и диагностика:
                  </span>
                  <div className="grid grid-cols-1 gap-2.5">
                    {egressTargets.map((target) => {
                      const isActive = egressStatus?.active_interface === target.interface;
                      return (
                        <div
                          key={target.interface}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isActive
                              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 shadow-sm'
                              : target.is_frozen
                              ? 'bg-cyan-950/20 border-cyan-800/40 text-slate-300'
                              : !target.available
                              ? 'bg-rose-950/20 border-rose-900/40 text-slate-300'
                              : 'bg-slate-950/80 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="text-base shrink-0">🌐</span>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                                  <span className="truncate">{target.label || target.node}</span>
                                  {isActive && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      АКТИВЕН
                                    </span>
                                  )}
                                  {target.is_frozen && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                      ❄️ ЗАВИС
                                    </span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                      target.available
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    }`}
                                  >
                                    {target.available ? `✓ ${target.passed_checks ?? 5}/${target.total_checks ?? 5}` : 'СБОЙ'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                  {target.interface} • {target.endpoint || 'VPN'}
                                  {target.handshake_age_sec !== undefined && target.handshake_age_sec > 0 && (
                                    <span className={target.is_frozen ? ' text-cyan-400 font-bold ml-1' : ' text-slate-500 ml-1'}>
                                      • Хэндшейк: {target.handshake_age_sec < 60 ? `${target.handshake_age_sec}с` : `${Math.round(target.handshake_age_sec / 60)}м`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              disabled={switchingEgress || isActive || !target.available}
                              onClick={() => handleSwitchCascadeEgress(cascadeNode.id, target.interface, target.label)}
                              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${
                                isActive
                                  ? 'bg-amber-500 text-slate-950 border-amber-400 opacity-90 cursor-default'
                                  : !target.available
                                  ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 active:scale-95'
                              }`}
                            >
                              {isActive ? 'Текущий' : switchingEgress ? '...' : 'Выбрать'}
                            </button>
                          </div>

                          {/* Check badges */}
                          {target.checks && target.checks.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-slate-800/80 text-[9px]">
                              {target.checks.map((c) => (
                                <span
                                  key={c.name}
                                  className={`px-1 py-0.2 rounded font-mono ${
                                    c.ok
                                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                                      : 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                                  }`}
                                  title={c.error || `HTTP ${c.status || 200}`}
                                >
                                  {c.name.toUpperCase()} {c.ok ? '✓' : '✗'}
                                </span>
                              ))}
                            </div>
                          )}

                          {!target.available && target.reason && (
                            <div className="text-[10px] text-rose-400 mt-1.5 font-sans leading-tight">
                              {target.reason}
                            </div>
                          )}

                          {target.recommendation && (
                            <div className="mt-2 p-1.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-[10px] text-cyan-200">
                              <span className="font-semibold text-cyan-300">💡 Рекомендация по сбросу: </span>
                              <code className="text-amber-300 font-mono text-[9px] block bg-slate-950 px-1 py-0.5 rounded select-all break-all mt-0.5">
                                {target.recommendation}
                              </code>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-900/60 rounded-2xl border border-slate-800">
                Каскадный узел не найден в кластере
              </div>
            )}
          </div>
        )}

        {/* ADMIN TAB 3: USER VIEW (Admin's personal keys/billing) */}
        {adminTab === 'user_view' && renderUserMode()}
      </div>
    );
  };

  // -------------------------------------------------------------
  // MAIN COMPONENT RETURN
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#040B0F] text-slate-100 flex flex-col justify-between p-4 max-w-md mx-auto font-sans select-none pb-8">
      <div>
        {/* Mock role switcher banner for developer testing */}
        {mock && (
          <div className="bg-slate-900/90 border border-slate-700/60 rounded-xl p-2 mb-3 flex items-center justify-between text-xs">
            <span className="text-slate-400 font-mono text-[11px]">Mock Mode:</span>
            <div className="flex gap-1">
              <button
                onClick={() => switchMockRole('user')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  mockRole === 'user'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                👤 User
              </button>
              <button
                onClick={() => switchMockRole('admin')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  mockRole === 'admin'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                👑 Admin
              </button>
              <button
                onClick={() => switchMockRole('unlinked')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  mockRole === 'unlinked'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                🚫 Unlinked
              </button>
            </div>
          </div>
        )}

        {authError && (
          <div className="p-3 mb-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {authError}
          </div>
        )}

        {/* App Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">Avari Keys</h1>
              <span className="text-[10px] text-cyan-400/80 font-mono">Telegram Mini App</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                АДМИН
              </span>
            )}
            {onExitToWeb && (
              <button
                onClick={onExitToWeb}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                Веб-версия →
              </button>
            )}
          </div>
        </div>

        {/* Render Mode */}
        {isAdmin ? renderAdminMode() : renderUserMode()}
      </div>

      {/* CREATE KEY MODAL / BOTTOM SHEET */}
      {showCreateKey && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" /> Новый VPN-ключ
              </h3>
              <button
                onClick={() => setShowCreateKey(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Отмена
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Имя устройства</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Например: iPhone или Ноутбук"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Сервер / Локация</label>
                <select
                  value={selectedNodeId || ''}
                  onChange={(e) => {setSelectedNodeId(Number(e.target.value)); setSelectedProtocol("awg");}}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
                >
                  {availableNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {getCountryFlag(n.country_code || 'NLD')} {n.name} (
                      {formatCountry(n.country_code || 'NLD')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Протокол</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProtocol('awg')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold ${
                      selectedProtocol === 'awg'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    AmneziaWG
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProtocol('hysteria2')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold ${
                      selectedProtocol === 'hysteria2'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Hysteria 2
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProtocol('mieru')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold ${
                      selectedProtocol === 'mieru'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    Mieru
                  </button>
                <button
                    type="button" disabled={!availableNodes.some(node => node.id === selectedNodeId && node.has_vless && node.type === "direct")}
                    onClick={() => setSelectedProtocol('vless')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold ${
                      selectedProtocol === 'vless'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    VLESS+Reality
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateNewKey}
              disabled={creatingKey}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold text-xs shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2"
            >
              {creatingKey ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>{creatingKey ? 'Генерация ключа...' : 'Создать ключ'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="text-center text-[10px] text-slate-600 mt-6">
        Avari Keys • Telegram Mini App
      </div>
    </div>
  );
};
