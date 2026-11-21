import { useState, useEffect, useMemo } from 'react';
import {
  Server,
  Users,
  Key,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  Radio,
  ArrowRight,
  Zap,
  Globe,
  Plus,
  Newspaper,
  CheckCircle2,
  Layers,
  ChevronRight,
  CreditCard,
  Lock,
} from 'lucide-react';
import { api } from '../api/client';
import { AdminNode, User, ClientConfigSummary, EgressStatusResponse, AdminBillingSummary } from '../types';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { ConfirmModal } from './ConfirmModal';

interface AdminOverviewProps {
  onNavigateTab: (tab: 'overview' | 'nodes' | 'users' | 'all-keys' | 'logs' | 'settings' | 'news', nodeId?: number | null) => void;
  onRefreshGlobal?: () => void;
}

export function AdminOverview({ onNavigateTab }: AdminOverviewProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Core Data
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [keys, setKeys] = useState<ClientConfigSummary[]>([]);
  const [egressStatus, setEgressStatus] = useState<EgressStatusResponse | null>(null);
  const [billingSummary, setBillingSummary] = useState<AdminBillingSummary | null>(null);

  // Egress quick switch modal
  const [switchingTarget, setSwitchingTarget] = useState<string | null>(null);
  const [switchingInProgress, setSwitchingInProgress] = useState(false);

  const cascadeIngress = useMemo(() => nodes.find((n) => n.type === 'cascade'), [nodes]);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const [nodesData, usersData, keysRes, billingData] = await Promise.allSettled([
        api.getAdminNodes(),
        api.getAdminUsers(),
        api.getAdminKeys({ limit: 100 }),
        api.getAdminBilling(),
      ]);

      const safeNodes = nodesData.status === 'fulfilled' && Array.isArray(nodesData.value) ? nodesData.value : [];
      setNodes(safeNodes);
      if (usersData.status === 'fulfilled') setUsers(Array.isArray(usersData.value) ? usersData.value : []);
      if (keysRes.status === 'fulfilled') setKeys(keysRes.value?.keys || []);
      if (billingData.status === 'fulfilled') setBillingSummary(billingData.value);

      const cascade = safeNodes.find((n) => n.type === 'cascade');
      if (cascade) {
        try {
          const egress = await api.getNodeEgress(cascade.id);
          setEgressStatus(egress);
        } catch {
          // Fallback if egress probe fails
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки данных сводки');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Pending Actions Counts
  const pendingUsers = useMemo(() => users.filter((u) => !u.is_active), [users]);
  const pwdResetUsers = useMemo(() => users.filter((u) => u.has_pending_password_reset), [users]);
  const offlineNodes = useMemo(() => nodes.filter((n) => !n.online), [nodes]);
  const dueUsersCount = billingSummary?.users_due_count || 0;

  const totalActionsCount = pendingUsers.length + pwdResetUsers.length + offlineNodes.length;

  // Direct nodes
  const directNodes = useMemo(() => nodes.filter((n) => n.type === 'direct'), [nodes]);

  // Active Egress Node info
  const activeEgress = useMemo(() => {
    if (!egressStatus?.targets || !egressStatus.active_interface) return null;
    return egressStatus.targets.find((t) => t.interface === egressStatus.active_interface) || null;
  }, [egressStatus]);

  // Standby Egress targets
  const standbyEgresses = useMemo(() => {
    if (!egressStatus?.targets) return [];
    return egressStatus.targets.filter((t) => t.interface !== egressStatus.active_interface);
  }, [egressStatus]);

  // Zombie Keys Count (no handshake or month+ old)
  const zombieKeysCount = useMemo(() => {
    return keys.filter((k) => {
      const hs = (k.last_handshake || '').toLowerCase();
      return !hs || hs.includes('не') || hs.includes('never') || hs.includes('мес') || hs.includes('month');
    }).length;
  }, [keys]);

  // Online peers count (handshake in minutes/seconds)
  const onlinePeersCount = useMemo(() => {
    return keys.filter((k) => {
      const hs = (k.last_handshake || '').toLowerCase();
      return hs && !hs.includes('не') && (hs.includes('сек') || hs.includes('мин') || hs.includes('min') || hs.includes('sec'));
    }).length;
  }, [keys]);

  const handleQuickSwitchEgress = (iface: string) => {
    setSwitchingTarget(iface);
  };

  const confirmSwitchEgress = async () => {
    if (!switchingTarget || !cascadeIngress) return;
    try {
      setSwitchingInProgress(true);
      const resp = await api.switchNodeEgress(cascadeIngress.id, switchingTarget);
      toast.success(resp.message || `Egress переключен на ${switchingTarget}`);
      setSwitchingTarget(null);
      loadData(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка переключения Egress');
    } finally {
      setSwitchingInProgress(false);
    }
  };

  if (loading) {
    return <Loader size="section" text="Загрузка командного центра..." />;
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn">
      {/* Top Headline & Quick Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1C3945]/60 pb-5">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse" />
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#F2F0E8] tracking-wide flex items-center gap-2">
              <span>Центр управления кластером</span>
              <span className="text-xs font-mono font-normal uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#1C3945]">
                Mission Control
              </span>
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-[#A8B4B7] mt-1 font-sans">
            Оперативная сводка, топология двухкаскадного туннеля, модерация и состояние сетевых узлов.
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-mono font-semibold text-[#A8B4B7] hover:text-[#F2F0E8] bg-[#0A1D26] hover:bg-[#102833] border border-[#1C3945] transition shadow-sm disabled:opacity-50"
            title="Обновить метрики"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#D9B96E]' : ''}`} />
            <span>{refreshing ? 'Опрос...' : 'Обновить'}</span>
          </button>

          <button
            onClick={() => onNavigateTab('nodes')}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-mono font-semibold bg-[#102833] hover:bg-[#153442] text-[#D9B96E] border border-[#D9B96E]/40 transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить ноду</span>
          </button>

          <button
            onClick={() => onNavigateTab('news')}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-mono font-semibold bg-[#0A1D26] hover:bg-[#102833] text-[#F2F0E8] border border-[#1C3945] transition shadow-sm"
          >
            <Newspaper className="w-3.5 h-3.5 text-[#D9B96E]" />
            <span>Оповещение</span>
          </button>
        </div>
      </div>

      {/* 1. Pending Action Center (Требуют внимания) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-mono uppercase tracking-wider text-[#A8B4B7] flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-[#D9B96E]" />
            <span>Оперативные задачи</span>
            {totalActionsCount > 0 ? (
              <span className="px-2 py-0.2 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                {totalActionsCount}
              </span>
            ) : (
              <span className="px-2 py-0.2 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                Очередь чиста
              </span>
            )}
          </h3>
        </div>

        {totalActionsCount === 0 ? (
          <div className="flex items-center justify-between p-4 rounded-2xl bg-[#06141B]/80 border border-emerald-900/40 shadow-inner">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-950/80 border border-emerald-600/40 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#F2F0E8]">Все очереди пусты, система работает штатно</div>
                <div className="text-xs text-[#A8B4B7]">
                  Нет ожидающих пользователей, сбросов паролей и критических сбоев узлов.
                </div>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('users')}
              className="text-xs font-mono text-[#D9B96E] hover:underline hidden sm:block"
            >
              Перейти к списку пользователей →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Pending User Activations */}
            {pendingUsers.length > 0 && (
              <div
                onClick={() => onNavigateTab('users')}
                className="group cursor-pointer p-4 rounded-2xl bg-gradient-to-br from-[#06141B] to-[#120F0A] border border-amber-600/50 hover:border-amber-500 shadow-lg shadow-amber-950/20 transition duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-amber-400 uppercase tracking-wider font-semibold">
                    Новые пользователи
                  </span>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold font-mono text-amber-300">{pendingUsers.length}</span>
                  <span className="text-xs text-[#A8B4B7]">ожидают модерации</span>
                </div>
                <div className="mt-3 flex items-center text-xs font-mono text-amber-300/80 group-hover:text-amber-200 transition">
                  <span>Одобрить в 1 клик</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            )}

            {/* Pending Password Resets */}
            {pwdResetUsers.length > 0 && (
              <div
                onClick={() => onNavigateTab('users')}
                className="group cursor-pointer p-4 rounded-2xl bg-gradient-to-br from-[#06141B] to-[#120A10] border border-rose-600/50 hover:border-rose-500 shadow-lg shadow-rose-950/20 transition duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-rose-400 uppercase tracking-wider font-semibold">
                    Сброс паролей
                  </span>
                  <Lock className="w-4 h-4 text-rose-400" />
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold font-mono text-rose-300">{pwdResetUsers.length}</span>
                  <span className="text-xs text-[#A8B4B7]">запросов сброса</span>
                </div>
                <div className="mt-3 flex items-center text-xs font-mono text-rose-300/80 group-hover:text-rose-200 transition">
                  <span>Рассмотреть</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            )}

            {/* Offline Servers */}
            {offlineNodes.length > 0 && (
              <div
                onClick={() => onNavigateTab('nodes')}
                className="group cursor-pointer p-4 rounded-2xl bg-gradient-to-br from-[#06141B] to-[#160B0B] border border-red-600/60 hover:border-red-500 shadow-lg shadow-red-950/20 transition duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-red-400 uppercase tracking-wider font-semibold">
                    Сбои серверов
                  </span>
                  <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold font-mono text-red-300">{offlineNodes.length}</span>
                  <span className="text-xs text-[#A8B4B7]">узлов офлайн</span>
                </div>
                <div className="mt-3 flex items-center text-xs font-mono text-red-300/80 group-hover:text-red-200 transition">
                  <span>Перейти к диагностике</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            )}

            {/* Dues / Overdue Billing */}
            {dueUsersCount > 0 && (
              <div
                onClick={() => onNavigateTab('users')}
                className="group cursor-pointer p-4 rounded-2xl bg-gradient-to-br from-[#06141B] to-[#0A161D] border border-cyan-800/60 hover:border-cyan-600 shadow-lg shadow-cyan-950/20 transition duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider font-semibold">
                    Взносы / Биллинг
                  </span>
                  <CreditCard className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold font-mono text-cyan-300">{dueUsersCount}</span>
                  <span className="text-xs text-[#A8B4B7]">ожидают оплаты</span>
                </div>
                <div className="mt-3 flex items-center text-xs font-mono text-cyan-300/80 group-hover:text-cyan-200 transition">
                  <span>Сверка платежей</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Interactive Cascade & Cluster Topology Flow */}
      <div className="border border-[#1C3945] rounded-3xl bg-[#06141B]/80 p-5 sm:p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-900/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="text-base sm:text-lg font-serif font-bold text-[#F2F0E8] flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#D9B96E]" />
              <span>Топология двухкаскадного туннелирования (Double-Hop)</span>
            </h3>
            <p className="text-xs text-[#A8B4B7] mt-0.5">
              Сквозная маршрутизация: клиентские пиры ➔ Входной шлюз РФ (M0) ➔ Выходной узел Egress ➔ Интернет.
            </p>
          </div>

          {cascadeIngress && (
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#0A1D26] border border-[#1C3945] text-xs font-mono">
              <span className="text-[#A8B4B7]">Auto-Failover:</span>
              <span
                className={`font-bold ${
                  cascadeIngress.auto_failover_enabled
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {cascadeIngress.auto_failover_enabled ? '🟢 Активен' : 'Отключен'}
              </span>
            </div>
          )}
        </div>

        {/* Visual Pipeline Flow */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center">
          {/* Step 1: Client Peers */}
          <div className="p-4 rounded-2xl bg-[#0A1D26]/90 border border-[#1C3945] flex flex-col justify-between h-full shadow-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono text-[#D9B96E] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>1. Клиентский сегмент</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
            </div>

            <div className="space-y-2 my-2">
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-[#A8B4B7]">Всего устройств:</span>
                <span className="text-base font-bold font-mono text-[#F2F0E8]">{keys.length}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-[#A8B4B7]">Онлайн:</span>
                <span className="text-sm font-bold font-mono text-emerald-400">{onlinePeersCount} пиров</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-[#A8B4B7]">Пользователей:</span>
                <span className="text-xs font-mono text-[#A8B4B7]">{users.length} (PRO: {users.filter((u) => u.is_pro).length})</span>
              </div>
            </div>

            <div className="pt-2 border-t border-[#1C3945]/60 text-[11px] text-[#718187] font-mono">
              Маскировка AWG Junk / Init
            </div>
          </div>

          {/* Step 2: M0 Ingress (Moscow) */}
          <div className="p-4 rounded-2xl bg-[#0A1D26]/90 border border-[#1C3945] flex flex-col justify-between h-full shadow-md relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" />
                <span>2. Входной шлюз РФ</span>
              </span>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                  cascadeIngress?.online
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                    : 'bg-rose-950/80 text-rose-400 border border-rose-800/60 animate-pulse'
                }`}
              >
                {cascadeIngress?.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="space-y-1.5 my-2">
              <div className="text-sm font-bold font-mono text-[#F2F0E8]">
                {cascadeIngress?.name || 'M0 Ingress'} (Москва)
              </div>
              <div className="text-xs text-[#A8B4B7]">Прием замаскированного трафика</div>
              <div className="flex items-center space-x-2 pt-1">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#06141B] text-[#D9B96E] border border-[#1C3945]">
                  WireGuard / AWG
                </span>
                <span className="text-xs font-mono text-emerald-400">~14 ms</span>
              </div>
            </div>

            <div className="pt-2 border-t border-[#1C3945]/60 flex items-center justify-between text-[11px] font-mono text-[#718187]">
              <span>Туннельный транзит</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#D9B96E]" />
            </div>
          </div>

          {/* Step 3: Active Egress Node */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0A1D26] to-[#120D22] border-2 border-purple-500/50 shadow-lg shadow-purple-950/30 flex flex-col justify-between h-full relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono text-purple-300 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-purple-400" />
                <span>3. Активный Egress</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-600/40 shadow-sm animate-pulse">
                ACTIVE
              </span>
            </div>

            <div className="space-y-1.5 my-2">
              <div className="text-sm font-bold font-mono text-[#F2F0E8] flex items-center gap-2">
                <span>{activeEgress?.label || egressStatus?.active_interface || 'S1 (Германия)'}</span>
              </div>
              <div className="text-xs text-[#A8B4B7]">Выход в зарубежный Интернет</div>

              {activeEgress?.checks && (
                <div className="flex items-center space-x-1.5 pt-1 text-[11px] font-mono">
                  <span className="text-[#A8B4B7]">Кворум:</span>
                  <span className="text-emerald-400 font-bold">
                    {activeEgress.passed_checks ?? 5}/{activeEgress.total_checks ?? 5} проверок
                  </span>
                </div>
              )}
            </div>

            {/* Quick Standby Switch Buttons */}
            <div className="pt-2 border-t border-purple-900/50">
              <div className="text-[10px] font-mono text-purple-300/80 mb-1.5 uppercase tracking-wider">
                Быстрое переключение:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {standbyEgresses.map((st) => (
                  <button
                    key={st.interface}
                    onClick={() => handleQuickSwitchEgress(st.interface)}
                    className="px-2 py-1 rounded-lg text-[10px] font-mono font-semibold bg-[#06141B] hover:bg-purple-900/40 text-purple-200 border border-purple-800/40 hover:border-purple-500 transition shadow-sm flex items-center gap-1 cursor-pointer"
                  >
                    <span>{st.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step 4: Direct Nodes & Alternatives */}
          <div className="p-4 rounded-2xl bg-[#0A1D26]/90 border border-[#1C3945] flex flex-col justify-between h-full shadow-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono text-[#D9B96E] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>Прямые ноды (Direct)</span>
              </span>
              <span className="text-xs font-mono text-[#A8B4B7]">{directNodes.length} узла</span>
            </div>

            <div className="space-y-2 my-1">
              {directNodes.slice(0, 3).map((dn) => (
                <div
                  key={dn.id}
                  onClick={() => onNavigateTab('nodes', dn.id)}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-[#06141B]/80 hover:bg-[#102833] border border-[#1C3945]/60 transition cursor-pointer"
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-semibold text-[#F2F0E8]">{dn.name}</span>
                    {dn.has_hysteria && (
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-violet-950 text-violet-300 border border-violet-700/50">
                        Hy2
                      </span>
                    )}
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      dn.online ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'
                    }`}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={() => onNavigateTab('nodes')}
              className="pt-2 border-t border-[#1C3945]/60 text-[11px] font-mono text-[#D9B96E] hover:underline flex items-center justify-between w-full"
            >
              <span>Все серверы кластера</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Core KPI & Analytics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Users */}
        <div
          onClick={() => onNavigateTab('users')}
          className="p-5 rounded-2xl bg-[#06141B]/80 border border-[#1C3945] hover:border-[#D9B96E]/50 transition duration-200 cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">Пользователи</span>
            <Users className="w-4 h-4 text-[#D9B96E] group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-[#F2F0E8]">{users.length}</span>
            <span className="text-xs text-[#A8B4B7]">всего аккаунтов</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono text-[#718187] pt-2 border-t border-[#1C3945]/50">
            <span>PRO: {users.filter((u) => u.is_pro).length}</span>
            <span className="text-emerald-400">{users.filter((u) => u.is_active).length} активны</span>
          </div>
        </div>

        {/* KPI 2: VPN Keys & Zombie Hygiene */}
        <div
          onClick={() => onNavigateTab('all-keys')}
          className="p-5 rounded-2xl bg-[#06141B]/80 border border-[#1C3945] hover:border-[#D9B96E]/50 transition duration-200 cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">Реестр устройств</span>
            <Key className="w-4 h-4 text-[#D9B96E] group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-[#F2F0E8]">{keys.length}</span>
            <span className="text-xs text-[#A8B4B7]">конфигураций</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono text-[#718187] pt-2 border-t border-[#1C3945]/50">
            <span className="text-emerald-400">{onlinePeersCount} онлайн</span>
            <span className={zombieKeysCount > 0 ? 'text-amber-400' : 'text-[#718187]'}>
              {zombieKeysCount} спящих
            </span>
          </div>
        </div>

        {/* KPI 3: Servers & Health */}
        <div
          onClick={() => onNavigateTab('nodes')}
          className="p-5 rounded-2xl bg-[#06141B]/80 border border-[#1C3945] hover:border-[#D9B96E]/50 transition duration-200 cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">Узлы кластера</span>
            <Server className="w-4 h-4 text-[#D9B96E] group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-[#F2F0E8]">
              {nodes.filter((n) => n.online).length} / {nodes.length}
            </span>
            <span className="text-xs text-[#A8B4B7]">онлайн</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono text-[#718187] pt-2 border-t border-[#1C3945]/50">
            <span>Каскад + Direct</span>
            <span className="text-purple-400">{egressStatus?.active_interface || 'Egress'}</span>
          </div>
        </div>

        {/* KPI 4: Financial Balance & Dues */}
        <div
          onClick={() => onNavigateTab('users')}
          className="p-5 rounded-2xl bg-[#06141B]/80 border border-[#1C3945] hover:border-[#D9B96E]/50 transition duration-200 cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">Фонд кластера</span>
            <CreditCard className="w-4 h-4 text-[#D9B96E] group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-emerald-400">
              {billingSummary?.total_payments ? `${billingSummary.total_payments} ₽` : 'Порядок'}
            </span>
            <span className="text-xs text-[#A8B4B7]">взносов</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono text-[#718187] pt-2 border-t border-[#1C3945]/50">
            <span className={dueUsersCount > 0 ? 'text-amber-400' : 'text-emerald-400'}>
              {dueUsersCount > 0 ? `${dueUsersCount} к оплате` : 'Все оплачено'}
            </span>
            <span className="text-[#A8B4B7]">300+50 ₽/мес</span>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Quick Egress Switch */}
      <ConfirmModal
        isOpen={Boolean(switchingTarget)}
        title="Переключение Egress шлюза"
        message={`Вы уверены, что хотите переключить выходной узел каскада на интерфейс «${switchingTarget}»? Трафик пользователей будет мгновенно перенаправлен на новый зарубежный сервер.`}
        confirmText={switchingInProgress ? 'Переключение...' : 'Переключить Egress'}
        cancelText="Отмена"
        variant="gold"
        isLoading={switchingInProgress}
        onConfirm={confirmSwitchEgress}
        onClose={() => setSwitchingTarget(null)}
      />
    </div>
  );
}
