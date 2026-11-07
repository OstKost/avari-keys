import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Server,
  Users,
  Key,
  ShieldCheck,
  Radio,
  ArrowRight,
  Sparkles,
  Zap,
  Globe,
  RotateCw,
  HardDrive,
  Lock,
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardStats, User } from '../types';
import { AnalogGauge } from './AnalogGauge';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { formatNodeRouting } from '../utils/country';

interface NetworkDashboardProps {
  currentUser: User;
  onNavigateTab?: (tab: 'keys' | 'nodes' | 'users' | 'all-keys' | 'logs' | 'profile' | 'dashboard') => void;
}

export function NetworkDashboard({ currentUser, onNavigateTab }: NetworkDashboardProps) {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async (isManual = false) => {
    try {
      if (isManual) setRefreshing(true);
      const data = await api.getDashboardStats(isManual);
      setStats(data);
      if (isManual) {
        toast.success('Метрики сети обновлены');
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки статуса сети');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStats();
    // Auto refresh every 3 minutes (180,000 ms) matching cache TTL
    const interval = setInterval(() => {
      fetchStats();
    }, 180000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading && !stats) {
    return <Loader size="section" text="Опрос узлов и сбор телеметрии AmneziaWG..." />;
  }

  if (!stats) {
    return (
      <div className="text-center py-16 text-[#A8B4B7] text-xs font-mono">
        Не удалось загрузить данные мониторинга сети.
      </div>
    );
  }

  // Monthly traffic in TB (Scale 0 to 10 TB)
  const monthTB = stats.month_traffic_bytes / (1024 * 1024 * 1024 * 1024);
  const monthValue = Math.max(0, Math.round(monthTB * 100) / 100);

  // Active concurrency calculation
  const concurrencyPct = stats.total_keys > 0 ? Math.round((stats.active_devices_online * 100) / stats.total_keys) : 0;

  // Latency gauge
  const latencyVal = typeof stats.avg_latency_ms === 'number' ? stats.avg_latency_ms : 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] flex items-center space-x-2.5">
              <Radio className="w-5 h-5 sm:w-6 sm:h-6 text-[#D9B96E] animate-pulse shrink-0" />
              <span>Состояние и статус сети Avari Keys</span>
            </h3>
            <span className="text-xs sm:text-sm font-mono uppercase tracking-wider px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-600/40">
              ● Live Telemetry
            </span>
            <span className="text-xs font-mono tracking-wider px-2 py-0.5 sm:py-1 rounded-full bg-[#102833] text-[#A8B4B7] border border-[#1C3945]">
              Кеш: 3 мин
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#A8B4B7] mt-1 font-sans">
            Открытый мониторинг инфраструктуры, объема пропущенного шифрованного трафика и доступности узлов.
          </p>
        </div>

        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] hover:border-[#D9B96E]/40 text-[#D9B96E] text-xs sm:text-sm font-mono transition shadow-sm self-start sm:self-auto disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#F0D48D]' : ''}`} />
          <span>Обновить данные</span>
        </button>
      </div>

      {/* Admin Notice Banner (If pending users exist) */}
      {currentUser.role === 'admin' && stats.pending_users !== undefined && stats.pending_users > 0 && (
        <div className="bg-[#102833] border border-amber-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-950/60 border border-amber-600/50 text-amber-300">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-serif font-bold text-amber-300 text-sm">
                В очереди на модерацию: {stats.pending_users} {stats.pending_users === 1 ? 'заявка' : 'заявок'}
              </h4>
              <p className="text-xs sm:text-sm text-[#A8B4B7]">
                Новые участники ожидают подтверждения администратора для получения доступа к ключам.
              </p>
            </div>
          </div>

          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('users')}
              className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold text-xs sm:text-sm uppercase tracking-wider font-mono rounded-xl shadow-md hover:shadow-lg transition shrink-0"
            >
              <span>Перейти к модерации</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* SECTION 1: Analog Gauges Cluster */}
      <div>
        <div className="flex items-center space-x-2 mb-4">
          <Activity className="w-4 h-4 text-[#D9B96E]" />
          <h4 className="font-serif font-bold text-[#F2F0E8] text-sm sm:text-base">
            Аналоговые индикаторы телеметрии
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {/* Gauge 1: Monthly Traffic (0 to 10 TB) */}
          <AnalogGauge
            title="Трафик за месяц"
            subtitle="Объем пропущенного трафика с 1-го числа"
            value={monthValue}
            min={0}
            max={10}
            tickCount={11}
            unit="ТБ / Месяц"
            displayValue={stats.month_traffic_formatted}
            colorScheme="gold"
            statusText="Шкала 0–10 ТБ (с 1-го числа)"
            statusType="info"
          />

          {/* Gauge 2: Active Devices Ratio */}
          <AnalogGauge
            title="Активность пиров"
            subtitle="Доля устройств онлайн (активный handshake)"
            value={concurrencyPct}
            min={0}
            max={100}
            tickCount={11}
            unit="% Активности"
            displayValue={`${concurrencyPct}%`}
            colorScheme="emerald"
            statusText={`${stats.active_devices_online} из ${stats.total_keys} онлайн`}
            statusType={concurrencyPct > 0 ? 'success' : 'info'}
          />

          {/* Gauge 3: Latency & Health Dial */}
          <AnalogGauge
            title="Задержка сети (Ping)"
            subtitle="Среднее время отклика управляющих узлов"
            value={latencyVal}
            min={0}
            max={120}
            tickCount={13}
            unit="мс Задержка"
            displayValue={`${latencyVal} ms`}
            colorScheme={latencyVal < 50 ? 'cyan' : latencyVal < 80 ? 'gold' : 'amber'}
            statusText={latencyVal < 50 ? 'Отличный отклик' : 'Рабочая задержка'}
            statusType={latencyVal < 50 ? 'success' : 'warning'}
          />
        </div>
      </div>

      {/* SECTION 2: Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Traffic */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-4 shadow-lg flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-[#102833] border border-[#1C3945] text-[#D9B96E]">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-[#A8B4B7] uppercase tracking-wider font-mono">
              Трафик за все время
            </div>
            <div className="text-xl font-bold font-mono text-[#F2F0E8] mt-0.5">
              {stats.total_traffic_formatted}
            </div>
            <div className="text-sm text-[#718187] font-mono mt-0.5">
              Шифрование ChaCha20-Poly1305
            </div>
          </div>
        </div>

        {/* Card 2: Community Members */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-4 shadow-lg flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-[#102833] border border-[#1C3945] text-[#34D399]">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-[#A8B4B7] uppercase tracking-wider font-mono">
              Хранители (Участники)
            </div>
            <div className="text-xl font-bold font-mono text-[#F2F0E8] mt-0.5">
              {stats.active_users} <span className="text-sm text-[#718187] font-normal">/ {stats.total_users}</span>
            </div>
            <div className="text-sm text-emerald-400 font-mono mt-0.5">
              {stats.active_users} активных аккаунтов
            </div>
          </div>
        </div>

        {/* Card 3: VPN Devices */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-4 shadow-lg flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-[#102833] border border-[#1C3945] text-[#38BDF8]">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-[#A8B4B7] uppercase tracking-wider font-mono">
              Выпущено ключей
            </div>
            <div className="text-xl font-bold font-mono text-[#F2F0E8] mt-0.5">
              {stats.total_keys}
            </div>
            <div className="text-sm text-[#38BDF8] font-mono mt-0.5">
              {stats.active_devices_online} онлайн прямо сейчас
            </div>
          </div>
        </div>

        {/* Card 4: Infrastructure Nodes */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-4 shadow-lg flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-[#102833] border border-[#1C3945] text-[#FBBF24]">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-[#A8B4B7] uppercase tracking-wider font-mono">
              Узлы сети (Ноды)
            </div>
            <div className="text-xl font-bold font-mono text-[#F2F0E8] mt-0.5">
              {stats.online_nodes} <span className="text-sm text-[#718187] font-normal">/ {stats.total_nodes}</span>
            </div>
            <div className="text-sm text-emerald-400 font-mono mt-0.5">
              {stats.system_status === 'operational' ? '● Все узлы доступны' : '● Деградация узлов'}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Topology Breakdown & Node Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Topology Breakdown (1 Col) */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <Zap className="w-4 h-4 text-[#D9B96E]" />
              <h4 className="font-serif font-bold text-[#F2F0E8] text-base">
                Распределение топологии
              </h4>
            </div>

            <p className="text-sm text-[#A8B4B7] font-sans mb-6">
              Соотношение сетевого трафика между каскадными узлами сокрытия и прямыми шлюзами.
            </p>

            {/* Split Progress Bar */}
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm font-mono">
                <span className="text-amber-300 font-bold">Каскад ({stats.topology_breakdown.cascade_percentage}%)</span>
                <span className="text-[#6EA8C4] font-bold">Прямой ({stats.topology_breakdown.direct_percentage}%)</span>
              </div>

              <div className="w-full h-3.5 bg-[#06141B] rounded-full overflow-hidden border border-[#1C3945] flex">
                <div
                  style={{ width: `${stats.topology_breakdown.cascade_percentage}%` }}
                  className="bg-gradient-to-r from-amber-600 to-amber-400 h-full transition-all duration-700"
                  title={`Каскад: ${stats.topology_breakdown.cascade_traffic_formatted}`}
                />
                <div
                  style={{ width: `${stats.topology_breakdown.direct_percentage}%` }}
                  className="bg-gradient-to-r from-[#2A6E94] to-[#6EA8C4] h-full transition-all duration-700"
                  title={`Прямой: ${stats.topology_breakdown.direct_traffic_formatted}`}
                />
              </div>
            </div>

            <div className="space-y-3 font-sans text-sm">
              <div className="flex justify-between items-center bg-[#06141B]/70 p-3 rounded-xl border border-[#1C3945]/70">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-[#F2F0E8] font-medium">Каскадные подключения:</span>
                </div>
                <span className="font-mono text-[#D9B96E]">
                  {stats.topology_breakdown.cascade_traffic_formatted}
                </span>
              </div>

              <div className="flex justify-between items-center bg-[#06141B]/70 p-3 rounded-xl border border-[#1C3945]/70">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6EA8C4]" />
                  <span className="text-[#F2F0E8] font-medium">Прямые подключения:</span>
                </div>
                <span className="font-mono text-[#6EA8C4]">
                  {stats.topology_breakdown.direct_traffic_formatted}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#1C3945]/80 text-sm text-[#718187] font-mono">
            Состав кластера и доступность узлов загружаются из мониторинга. Премиум-узлы доступны для выпуска ключей с тарифом PRO.
          </div>
        </div>

        {/* Nodes Cluster Overview (2 Cols) */}
        <div className="lg:col-span-2 bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-[#D9B96E]" />
              <h4 className="font-serif font-bold text-[#F2F0E8] text-base">
                Серверы AWG и Hysteria 2
              </h4>
            </div>

            <span className="text-sm font-mono text-[#A8B4B7]">
              Онлайн {stats.online_nodes} из {stats.total_nodes}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(stats.nodes || []).map((n) => (
              <div
                key={n.id}
                className="bg-[#06141B]/80 border border-[#1C3945] hover:border-[#D9B96E]/40 rounded-2xl p-4 flex flex-col justify-between transition group"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-[#102833] border border-[#1C3945] text-[#D9B96E]">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="font-serif font-bold text-sm text-[#F2F0E8] group-hover:text-gold-gradient transition">
                          {n.name}
                        </h5>
                        <span className="text-sm text-[#718187] font-mono">ID #{n.id}{n.is_backup ? ' · PRO' : ''}</span>
                      </div>
                    </div>

                    <span
                      className={`text-sm font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                        n.type === 'cascade'
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                          : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40'
                      }`}
                    >
                      {n.type === 'cascade' ? 'Каскад' : formatNodeRouting(n.type, n.country_code).fullText}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm font-sans text-[#A8B4B7] bg-[#0A1D26]/70 p-3.5 rounded-xl border border-[#1C3945]/50">
                    {n.type === 'cascade' && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-sm text-[#718187]">Выход каскада:</span>
                        <span className="font-mono text-sm text-[#D9B96E]">{n.active_egress || 'Не подтверждён'}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#718187]">Статус:</span>
                      <div className="flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${n.online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                        <span className={n.online ? 'text-emerald-400 font-mono text-sm' : 'text-rose-400 font-mono text-sm'}>
                          {n.online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#718187]">Задержка:</span>
                      <span className="font-mono text-sm text-[#F2F0E8]">{n.latency_ms} ms</span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#718187]">Пиров подключено:</span>
                      <span className="font-mono text-sm text-[#D9B96E]">{n.peer_count} устройств</span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[#718187]">Трафик узла:</span>
                      <span className="font-mono text-sm text-[#F2F0E8]">{n.total_traffic_formatted}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {(stats.nodes || []).length === 0 && (
              <div className="col-span-2 text-center py-8 text-[#718187] text-sm font-mono uppercase tracking-wider">
                Узлы сети еще не настроены.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 4: Security & Protocol Guarantees */}
      <div className="bg-[#0A1D26]/60 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-[#D9B96E]" />
          <h4 className="font-serif font-bold text-[#F2F0E8] text-base">
            Гарантии безопасности и защита протокола
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans text-sm">
          <div className="bg-[#0D222C]/80 p-4 rounded-2xl border border-[#1C3945]/70 flex items-start space-x-3">
            <Lock className="w-5 h-5 text-[#D9B96E] flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-base text-[#F2F0E8]">Обфускация AmneziaWG</div>
              <p className="text-[#A8B4B7] mt-1 leading-relaxed text-sm">
                Случайные байты в начале сессии (Jc, Jmin, Jmax) и подмена сигнатур пакетов (H1–H4) делают протокол невидимым для DPI.
              </p>
            </div>
          </div>

          <div className="bg-[#0D222C]/80 p-4 rounded-2xl border border-[#1C3945]/70 flex items-start space-x-3">
            <Sparkles className="w-5 h-5 text-[#34D399] flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-base text-[#F2F0E8]">Политика No-Logs</div>
              <p className="text-[#A8B4B7] mt-1 leading-relaxed text-sm">
                Никаких сетевых логов активности клиентов, посещаемых сайтов или DNS-запросов. Master Backend хранит только публичные метаданные.
              </p>
            </div>
          </div>

          <div className="bg-[#0D222C]/80 p-4 rounded-2xl border border-[#1C3945]/70 flex items-start space-x-3">
            <Zap className="w-5 h-5 text-[#38BDF8] flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-base text-[#F2F0E8]">Сквозное шифрование</div>
              <p className="text-[#A8B4B7] mt-1 leading-relaxed text-sm">
                Криптографический стек Curve25519, ChaCha20-Poly1305 и BLAKE2s обеспечивает максимальную скорость и защищенность.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
