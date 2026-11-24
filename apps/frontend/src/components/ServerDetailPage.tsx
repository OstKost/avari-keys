import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  ArrowLeft,
  Activity,
  RotateCw,
  RotateCcw,
  Download,
  Upload,
  Pencil,
  ExternalLink,
  Globe,
  Radio,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ArrowUp,
  ArrowDown,
  Zap,
  Smartphone,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  HardDrive,
  Key,
  Clock,
  ArrowRightLeft,
  Layers,
  Cpu,
  Eye,
} from 'lucide-react';
import { api } from '../api/client';
import { NodeDetailResponse } from '../types';
import { COUNTRIES, formatNodeRouting, getCountryInfo } from '../utils/country';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { ConfirmModal } from './ConfirmModal';

interface ServerDetailPageProps {
  nodeId: number;
  onBack: () => void;
  onNodeUpdated?: () => void;
}

export function ServerDetailPage({ nodeId, onBack, onNodeUpdated }: ServerDetailPageProps) {
  const { toast } = useToast();
  const [node, setNode] = useState<NodeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnosing, setDiagnosing] = useState(false);
  const [switchingEgress, setSwitchingEgress] = useState(false);
  const [restartingEgress, setRestartingEgress] = useState<string | null>(null);
  const [checkingEgress, setCheckingEgress] = useState(false);

  // Restart modal
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  // Backup state
  const [isBackingUp, setIsBackingUp] = useState(false);

  // Restore state
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreContent, setRestoreContent] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'cascade' | 'direct'>('cascade');
  const [editCountryCode, setEditCountryCode] = useState('NLD');
  const [editProviderUrl, setEditProviderUrl] = useState('');
  const [editApiUrl, setEditApiUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editIsMobileOptimized, setEditIsMobileOptimized] = useState(false);
  const [editIsBackup, setEditIsBackup] = useState(false);
  const [editHasHysteria, setEditHasHysteria] = useState(false);
  const [editHasMieru, setEditHasMieru] = useState(false);
  const [editHasVless, setEditHasVless] = useState(false);
  const [editAutoFailoverEnabled, setEditAutoFailoverEnabled] = useState(false);
  const [savingFailover, setSavingFailover] = useState(false);
  const [isEditingSubmitting, setIsEditingSubmitting] = useState(false);

  // Fetch node detail
  const fetchDetail = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await api.getAdminNode(nodeId);
      setNode(data);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки данных сервера');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [nodeId, toast]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Run live diagnostic
  const handleRunDiagnostic = async () => {
    try {
      setDiagnosing(true);
      const data = await api.diagnoseAdminNode(nodeId);
      setNode(data);
      toast.success(`Диагностика сервера «${data.name}» завершена`);
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка выполнения диагностики');
    } finally {
      setDiagnosing(false);
    }
  };

  // Restart AWG
  const handleRestart = async () => {
    if (!node) return;
    try {
      setIsRestarting(true);
      const res = await api.restartNode(node.id);
      toast.success(res.message || `Служба AWG на сервере «${node.name}» перезапущена`);
      setShowRestartConfirm(false);
      fetchDetail(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка перезапуска службы AWG');
    } finally {
      setIsRestarting(false);
    }
  };

  // Backup configuration
  const handleBackup = async () => {
    if (!node) return;
    try {
      setIsBackingUp(true);
      const res = await api.backupNode(node.id);
      toast.success(`Резервная копия для «${node.name}» сформирована`);

      // Trigger file download
      const blob = new Blob([res.backup_data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup_node_${node.id}_${new Date().toISOString().slice(0, 10)}.bak`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка создания резервной копии');
    } finally {
      setIsBackingUp(false);
    }
  };

  // Restore configuration
  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!node || !restoreContent.trim()) return;
    try {
      setIsRestoring(true);
      const res = await api.restoreNode(node.id, restoreContent.trim());
      toast.success(res.message || `Конфигурация сервера «${node.name}» восстановлена`);
      setShowRestoreModal(false);
      setRestoreContent('');
      fetchDetail(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка восстановления конфигурации');
    } finally {
      setIsRestoring(false);
    }
  };

  // Switch Cascade Egress
  const handleSwitchEgress = async (targetInterface: string) => {
    if (!node || node.type !== 'cascade' || switchingEgress) return;
    try {
      setSwitchingEgress(true);
      const res = await api.switchNodeEgress(node.id, targetInterface);
      toast.success(res.message || `Каскад переключён на ${targetInterface}`);
      fetchDetail(true);
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка переключения выхода каскада');
    } finally {
      setSwitchingEgress(false);
    }
  };

  // Restart Cascade Egress Tunnel
  const handleRestartEgress = async (targetInterface: string) => {
    if (!node || node.type !== 'cascade' || restartingEgress) return;
    try {
      setRestartingEgress(targetInterface);
      const res = await api.restartNodeEgress(node.id, targetInterface);
      toast.success(res.message || `Туннель ${targetInterface} успешно перезапущен`);
      fetchDetail(true);
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || `Ошибка перезапуска туннеля ${targetInterface}`);
    } finally {
      setRestartingEgress(null);
    }
  };

  // Check Cascade Egress Gateways
  const handleCheckEgress = async () => {
    if (!node || node.type !== 'cascade' || checkingEgress) return;
    try {
      setCheckingEgress(true);
      const freshEgress = await api.getNodeEgress(node.id);
      setNode((prev) => (prev ? { ...prev, egress: freshEgress } : null));
      toast.success('Проверка шлюзов выходов завершена');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка проверки шлюзов выходов');
    } finally {
      setCheckingEgress(false);
    }
  };

  const handleToggleAutoFailover = async () => {
    if (!node || savingFailover) return;
    const newEnabled = !node.auto_failover_enabled;
    const currentPriority = node.failover_priority && node.failover_priority.length > 0
      ? node.failover_priority
      : (node.egress?.targets?.map((t) => t.interface) || ['awg1', 'awg4', 'awg3', 'awg5']);

    setSavingFailover(true);
    try {
      const updated = await api.updateAdminNodeFailover(node.id, newEnabled, currentPriority);
      setNode((prev) => prev ? {
        ...prev,
        auto_failover_enabled: updated.auto_failover_enabled,
        failover_priority: updated.failover_priority,
      } : null);
      toast.success(
        newEnabled
          ? 'Auto-Failover включен: шлюзы будут переключаться при сбое'
          : 'Auto-Failover отключен: маршрут фиксирован'
      );
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обновления настроек Auto-Failover');
    } finally {
      setSavingFailover(false);
    }
  };

  const handleMovePriority = async (iface: string, direction: 'up' | 'down') => {
    if (!node || savingFailover) return;
    const allInterfaces = node.egress?.targets?.map((t) => t.interface) || ['awg1', 'awg3', 'awg4', 'awg5'];
    let priority = [...(node.failover_priority && node.failover_priority.length > 0 ? node.failover_priority : allInterfaces)];

    for (const item of allInterfaces) {
      if (!priority.includes(item)) {
        priority.push(item);
      }
    }

    const index = priority.indexOf(iface);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      const temp = priority[index - 1];
      priority[index - 1] = priority[index];
      priority[index] = temp;
    } else if (direction === 'down' && index < priority.length - 1) {
      const temp = priority[index + 1];
      priority[index + 1] = priority[index];
      priority[index] = temp;
    } else {
      return;
    }

    setSavingFailover(true);
    try {
      const updated = await api.updateAdminNodeFailover(node.id, Boolean(node.auto_failover_enabled), priority);
      setNode((prev) => prev ? {
        ...prev,
        auto_failover_enabled: updated.auto_failover_enabled,
        failover_priority: updated.failover_priority,
      } : null);
      toast.success('Приоритет Egress шлюзов обновлен');
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обновления приоритетов');
    } finally {
      setSavingFailover(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = () => {
    if (!node) return;
    setEditName(node.name);
    setEditType(node.type);
    setEditCountryCode(node.country_code || 'NLD');
    setEditProviderUrl(node.provider_url || '');
    setEditApiUrl(node.api_url);
    setEditApiKey('');
    setEditIsMobileOptimized(Boolean(node.is_mobile_optimized));
    setEditIsBackup(Boolean(node.is_backup));
    setEditHasHysteria(Boolean(node.has_hysteria));
    setEditHasMieru(Boolean(node.has_mieru));
    setEditHasVless(Boolean(node.has_vless));
    setEditAutoFailoverEnabled(Boolean(node.auto_failover_enabled));
    setShowEditModal(true);
  };

  // Submit Edit Node
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!node) return;
    try {
      setIsEditingSubmitting(true);
      await api.updateAdminNode(node.id, {
        name: editName,
        type: editType,
        apiUrl: editApiUrl,
        apiKey: editApiKey || undefined,
        isMobileOptimized: editIsMobileOptimized,
        isBackup: editIsBackup,
        hasHysteria: editHasHysteria,
        hasMieru: editHasMieru,
        hasVless: editHasVless,
        countryCode: editCountryCode,
        providerUrl: editProviderUrl,
      });

      if (editType === 'cascade' && editAutoFailoverEnabled !== node.auto_failover_enabled) {
        await api.updateAdminNodeFailover(node.id, editAutoFailoverEnabled, node.failover_priority || []);
      }

      toast.success(`Параметры сервера «${editName}» обновлены`);
      setShowEditModal(false);
      fetchDetail(true);
      if (onNodeUpdated) onNodeUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения параметров');
    } finally {
      setIsEditingSubmitting(false);
    }
  };

  const formatUrl = (url?: string) => {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  };

  const getDomainFromUrl = (url?: string) => {
    if (!url) return '';
    try {
      return new URL(formatUrl(url)).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const renderStatusBadge = (state?: 'green' | 'yellow' | 'red' | 'unknown', label?: string) => {
    const map = {
      green: { icon: CheckCircle2, text: 'В порядке', bg: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40' },
      yellow: { icon: AlertTriangle, text: 'Замечания', bg: 'bg-amber-950/80 text-amber-300 border-amber-600/40' },
      red: { icon: XCircle, text: 'Недоступен', bg: 'bg-rose-950/80 text-rose-400 border-rose-600/40' },
      unknown: { icon: HelpCircle, text: 'Нет данных', bg: 'bg-slate-900/80 text-slate-400 border-slate-700/40' },
    };
    const current = map[state || 'unknown'];
    const Icon = current.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-bold px-2.5 py-1 rounded-lg border ${current.bg}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label ? `${label}: ` : ''}{current.text}</span>
      </span>
    );
  };

  if (loading && !node) {
    return <Loader size="section" text="Опрос сервера и сбор результатов диагностики..." />;
  }

  if (!node) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-rose-400 font-mono text-sm">Сервер не найден или удален из кластера.</div>
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-[#102833] text-[#D9B96E] border border-[#1C3945] hover:border-[#D9B96E]/50 font-mono text-xs uppercase"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Вернуться к списку</span>
        </button>
      </div>
    );
  }

  const routing = formatNodeRouting(node.type, node.country_code);
  const country = getCountryInfo(node.country_code);
  const latency = typeof node.latency_ms === 'number' ? node.latency_ms : null;
  const isStaleServer = !!node.server_status?.checked_at && Date.now() - new Date(node.server_status.checked_at).getTime() > 180_000;
  const serverState = isStaleServer ? 'yellow' : (node.server_status?.state || (node.online ? 'green' : 'red'));

  return (
    <div className="space-y-6 sm:space-y-8 animate-fadeIn pb-12">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 text-xs sm:text-sm font-mono uppercase tracking-wider text-[#A8B4B7] hover:text-[#D9B96E] transition cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          <span>← Серверы кластера</span>
        </button>

        <div className="flex items-center space-x-2 text-xs font-mono text-[#718187]">
          <span>Кластер</span>
          <span>/</span>
          <span className="text-[#D9B96E] font-bold">{node.name}</span>
          <span>(ID #{node.id})</span>
        </div>
      </div>

      {/* Server Header Hero Card */}
      <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-[#D9B96E]/10 via-transparent to-transparent pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <span className="text-2xl">{country?.flag || '🌐'}</span>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#F2F0E8] tracking-wide">
                {node.name}
              </h2>
              <span className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#102833] text-[#A8B4B7] border border-[#1C3945]">
                ID #{node.id}
              </span>
            </div>

            <p className="text-xs sm:text-sm text-[#A8B4B7] font-sans flex items-center flex-wrap gap-x-3 gap-y-1">
              <span>Страна выхода: <strong className="text-[#F2F0E8]">{country?.name || node.country_code || 'Зарубеж'}</strong></span>
              <span>•</span>
              <span>Тип: <strong className="text-[#F2F0E8]">{node.type === 'cascade' ? 'Каскадное туннелирование (Double-Hop)' : 'Прямой туннель (Direct)'}</strong></span>
              <span>•</span>
              <span>Добавлен: <strong className="text-[#F2F0E8] font-mono">{new Date(node.created_at).toLocaleDateString('ru-RU')}</strong></span>
            </p>

            {/* Badges / Capabilities */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {/* Online indicator */}
              <div className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border whitespace-nowrap shrink-0 ${
                node.online
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40'
                  : 'bg-rose-950/80 text-rose-400 border-rose-600/40'
              }`}>
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  {node.online ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  ) : (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 animate-beacon-red" />
                    </>
                  )}
                </span>
                <span>{node.online ? 'LIVE ONLINE' : 'OFFLINE'}</span>
              </div>

              {/* Cascade / Direct Badge */}
              <span className={`text-xs font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full border whitespace-nowrap shrink-0 ${
                node.type === 'cascade'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-600/40'
                  : 'bg-[#102833] text-[#6EA8C4] border-[#6EA8C4]/40'
              }`}>
                {node.type === 'cascade' ? '🇷🇺 RUS ➔ Выход Зарубеж' : `${country?.flag || '🌐'} ${routing.fullText}`}
              </span>

              {/* Protocol Tags */}
              <span className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-xs font-mono px-2.5 py-1 rounded-full font-bold whitespace-nowrap shrink-0">
                <Shield className="w-3.5 h-3.5 text-[#D9B96E]" />
                <span>AmneziaWG</span>
              </span>

              {node.has_hysteria && (
                <span className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-500/40 text-xs font-mono px-2.5 py-1 rounded-full font-bold">
                  <Zap className="w-3.5 h-3.5 text-purple-300" />
                  <span>Hysteria 2 (UDP 443)</span>
                </span>
              )}

              {node.has_vless && <span>VLESS+Reality</span>}
              {node.has_mieru && (
                <span className="inline-flex items-center space-x-1 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-mono px-2.5 py-1 rounded-full font-bold">
                  <Eye className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Mieru (TCP 28443)</span>
                </span>
              )}

              {node.is_mobile_optimized && (
                <span className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-xs font-mono px-2.5 py-1 rounded-full font-bold">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>443 LTE</span>
                </span>
              )}

              {node.is_backup && (
                <span className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-600/40 text-xs font-mono px-2.5 py-1 rounded-full font-bold">
                  <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                  <span>PRO / Запасной</span>
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={handleRunDiagnostic}
              disabled={diagnosing}
              className="flex items-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono px-4 py-2.5 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition disabled:opacity-50 cursor-pointer"
              title="Запустить немедленный опрос и проверку доступности"
            >
              <RotateCw className={`w-4 h-4 ${diagnosing ? 'animate-spin' : ''}`} />
              <span>{diagnosing ? 'Диагностика...' : 'Запустить проверку'}</span>
            </button>

            <button
              onClick={() => setShowRestartConfirm(true)}
              className="p-2.5 rounded-xl border border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#F2F0E8] hover:border-[#D9B96E]/50 transition cursor-pointer"
              title="Перезапустить службу AmneziaWG"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={handleBackup}
              disabled={isBackingUp}
              className="p-2.5 rounded-xl border border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#F2F0E8] hover:border-[#D9B96E]/50 transition cursor-pointer"
              title="Скачать резервную копию конфигурации сервера"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowRestoreModal(true)}
              className="p-2.5 rounded-xl border border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#F2F0E8] hover:border-[#D9B96E]/50 transition cursor-pointer"
              title="Восстановить конфигурацию из бэкапа"
            >
              <Upload className="w-4 h-4" />
            </button>

            <button
              onClick={handleOpenEdit}
              className="p-2.5 rounded-xl border border-[#1C3945] bg-[#102833] text-[#D9B96E] hover:border-[#D9B96E] transition cursor-pointer"
              title="Редактировать параметры сервера"
            >
              <Pencil className="w-4 h-4" />
            </button>

            {node.provider_url && (
              <a
                href={formatUrl(node.provider_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 px-3 py-2.5 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#6EA8C4] hover:text-[#F0D48D] transition text-xs font-mono"
                title={`Панель VPS провайдера (${node.provider_url})`}
              >
                <Globe className="w-3.5 h-3.5 text-[#D9B96E]" />
                <span>{getDomainFromUrl(node.provider_url)}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: Status & Diagnostics Overview Grid */}
      <div>
        <div className="flex items-center space-x-2 mb-4">
          <Activity className="w-5 h-5 text-[#D9B96E]" />
          <h3 className="font-serif font-bold text-lg text-[#F2F0E8]">
            Сводка диагностики и состояние служб
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Server Status */}
          <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">
                  Статус сервера
                </span>
                <Server className="w-4 h-4 text-[#D9B96E]" />
              </div>
              <div className="my-2">
                {renderStatusBadge(serverState as any, 'Сервер')}
              </div>
              <p className="text-xs text-[#A8B4B7] font-sans mt-2 leading-relaxed">
                {node.server_status?.reason || (node.online ? 'Служба отвечает нормально' : 'Узел не отвечает на запросы Slave API')}
              </p>
            </div>
            {node.server_status?.checked_at && (
              <div className="text-[11px] text-[#718187] font-mono mt-3 pt-2 border-t border-[#1C3945]/60">
                Проверено: {new Date(node.server_status.checked_at).toLocaleTimeString('ru-RU')}
              </div>
            )}
          </div>

          {/* Card 2: Network Availability Status */}
          <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">
                  Сетевая доступность
                </span>
                <Radio className="w-4 h-4 text-[#6EA8C4]" />
              </div>
              <div className="my-2">
                {renderStatusBadge(node.network_status?.state, 'Сеть')}
              </div>
              <p className="text-xs text-[#A8B4B7] font-sans mt-2 leading-relaxed">
                {node.network_status?.reason || 'Агрегированный результат контрольных точек M0/S0'}
              </p>
            </div>
            <div className="text-[11px] text-[#718187] font-mono mt-3 pt-2 border-t border-[#1C3945]/60 flex justify-between">
              <span>Зондов проверено:</span>
              <span className="text-[#F2F0E8] font-bold">{(node.network_probes || []).length}</span>
            </div>
          </div>

          {/* Card 3: API Latency */}
          <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">
                  Отклик API
                </span>
                <Clock className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-baseline space-x-2 my-1">
                <span className={`text-2xl font-bold font-mono ${
                  !latency ? 'text-slate-500' : latency < 45 ? 'text-emerald-400' : latency < 90 ? 'text-amber-400' : 'text-rose-400'
                }`}>
                  {latency ? `${latency} ms` : '—'}
                </span>
                <span className="text-xs font-mono text-[#718187]">
                  {latency ? (latency < 45 ? '● Отличный' : latency < 90 ? '● Нормальный' : '● Высокий') : 'Недоступно'}
                </span>
              </div>
              {/* Latency meter */}
              <div className="w-full h-2 bg-[#06141B] rounded-full overflow-hidden mt-2 border border-[#1C3945]">
                <div
                  className={`h-full transition-all duration-500 ${
                    !latency ? 'w-0' : latency < 45 ? 'bg-emerald-400' : latency < 90 ? 'bg-amber-400' : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(5, (latency || 0) / 1.5))}%` }}
                />
              </div>
            </div>
            <div className="text-[11px] text-[#718187] font-mono mt-3 pt-2 border-t border-[#1C3945]/60">
              RTT эндпоинта Slave API
            </div>
          </div>

          {/* Card 4: Services Status */}
          <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-2xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7]">
                  Службы и протоколы
                </span>
                <Cpu className="w-4 h-4 text-purple-400" />
              </div>
              <div className="space-y-1.5 text-xs font-mono my-2">
                <div className="flex justify-between items-center bg-[#06141B] px-2.5 py-1 rounded-lg border border-[#1C3945]/60">
                  <span className="text-[#A8B4B7]">AmneziaWG:</span>
                  <span className={`font-bold ${node.health?.awg_available || node.online ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {node.health?.awg_available || node.online ? '● Активна' : '● Сбой'}
                  </span>
                </div>
                <div className="flex justify-between items-center bg-[#06141B] px-2.5 py-1 rounded-lg border border-[#1C3945]/60">
                  <span className="text-[#A8B4B7]">Hysteria 2:</span>
                  <span className={`font-bold ${node.health?.hysteria_available ? 'text-emerald-400' : node.has_hysteria ? 'text-amber-400' : 'text-[#718187]'}`}>
                    {node.health?.hysteria_available ? '● Активна' : node.has_hysteria ? '● Не запущена' : 'Отключен'}
                  </span>
                </div>
                <div className="flex justify-between items-center bg-[#06141B] px-2.5 py-1 rounded-lg border border-[#1C3945]/60">
                  <span className="text-[#A8B4B7]">Mieru:</span>
                  <span className={`font-bold ${node.health?.mieru_available ? 'text-emerald-400' : node.has_mieru ? 'text-amber-400' : 'text-[#718187]'}`}>
                    {node.health?.mieru_available ? '● Активна' : node.has_mieru ? '● Не запущена' : 'Отключен'}
                  </span>
                </div>
                <div className="flex justify-between items-center bg-[#06141B] px-2.5 py-1 rounded-lg border border-[#1C3945]/60">
                  <span className="text-[#A8B4B7]">VLESS+Reality</span>
                  <span className={`font-bold ${node.health?.vless_available ? 'text-emerald-400' : node.has_vless ? 'text-amber-400' : 'text-[#718187]'}`}>
                    {node.health?.vless_available ? '● Активна' : node.has_vless ? '● Не запущена' : 'Отключен'}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-[#718187] font-mono mt-2 pt-2 border-t border-[#1C3945]/60 flex justify-between">
              <span>Версия демона:</span>
              <span className="text-[#F2F0E8]">{node.health?.version || '1.6.0'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Detailed Availability Diagnostics (Network Probes) */}
      <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center space-x-2.5">
            <Radio className="w-5 h-5 text-[#D9B96E]" />
            <div>
              <h4 className="font-serif font-bold text-lg text-[#F2F0E8]">
                Результаты сетевой диагностики (Зонды M0 / S0)
              </h4>
              <p className="text-xs text-[#A8B4B7] font-sans mt-0.5">
                Независимый опрос доступности сервера с контрольных узлов кластера по протоколам DNS, ICMP, TCP и UDP
              </p>
            </div>
          </div>

          <button
            onClick={handleRunDiagnostic}
            disabled={diagnosing}
            className="flex items-center space-x-1.5 text-xs font-mono font-bold text-[#D9B96E] hover:text-[#F0D48D] uppercase tracking-wider px-3.5 py-2 rounded-xl bg-[#06141B] hover:bg-[#102833] border border-[#D9B96E]/30 transition self-start sm:self-auto cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${diagnosing ? 'animate-spin' : ''}`} />
            <span>Обновить зонды</span>
          </button>
        </div>

        {/* Probes List */}
        {(node.network_probes || []).length > 0 ? (
          <div className="space-y-4">
            {node.network_probes!.map((probe, idx) => {
              const hasTcpFailure = probe.checks.some((c) => (c.kind.endsWith('_tcp') || c.kind === 'tcp') && !c.ok);
              const hasIcmpSuccess = probe.checks.some((c) => c.kind.endsWith('_icmp') && c.ok);
              const isTspuFiltered = hasTcpFailure && hasIcmpSuccess;

              return (
                <div
                  key={idx}
                  className="bg-[#06141B]/80 border border-[#1C3945] rounded-2xl p-4 sm:p-5 transition hover:border-[#1C3945]/90"
                >
                  {/* Probe Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-[#1C3945]/70">
                    <div className="flex items-center space-x-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#D9B96E]" />
                      <span className="font-serif font-bold text-sm text-[#F2F0E8]">
                        Источник зонда: <span className="text-[#D9B96E]">{probe.source}</span>
                      </span>
                      {probe.interface && (
                        <span className="text-xs font-mono text-[#A8B4B7] bg-[#102833] px-2 py-0.5 rounded border border-[#1C3945]">
                          Интерфейс: {probe.interface}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3">
                      {renderStatusBadge(probe.state as any)}
                      {probe.checked_at && (
                        <span className="text-[11px] text-[#718187] font-mono">
                          {new Date(probe.checked_at).toLocaleTimeString('ru-RU')}
                        </span>
                      )}
                    </div>
                  </div>

                  {probe.reason && (
                    <div className="text-xs text-amber-300/90 font-sans mb-3 bg-amber-950/30 p-2.5 rounded-xl border border-amber-800/40">
                      {probe.reason}
                    </div>
                  )}

                  {/* Informative TSPU / Protocol Distinction Banner */}
                  {isTspuFiltered && (
                    <div className="text-xs text-amber-200/95 font-sans mb-4 bg-amber-950/40 p-3 rounded-xl border border-amber-600/40 flex items-start space-x-2.5 shadow-inner">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-bold text-amber-300">
                          Дифференциация протоколов: ТСПУ фильтрует веб-порт TCP
                        </div>
                        <div className="text-[#C2CCD0] leading-relaxed">
                          Прямой веб-порт TCP (:443/HTTP) не отвечает из РФ через физический интерфейс провайдера. 
                          <strong className="text-emerald-400 font-semibold"> VPN-трафик по UDP не затронут</strong>: протоколы AmneziaWG и Hysteria 2 используют независимые замаскированные UDP-пакеты с обфускацией.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Checks Table / Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
                    {probe.checks.map((check, cIdx) => {
                      const isDns = check.kind === 'dns';
                      const isIcmp = check.kind.endsWith('_icmp');
                      const isTcp = check.kind.endsWith('_tcp') || check.kind === 'tcp';
                      const isUdp = check.kind.includes('udp');

                      const protoTag = isDns
                        ? { label: 'DNS', cls: 'bg-sky-950/80 text-sky-400 border-sky-800/60' }
                        : isIcmp
                        ? { label: 'ICMP', cls: 'bg-cyan-950/80 text-cyan-400 border-cyan-800/60' }
                        : isTcp
                        ? { label: 'TCP Веб', cls: 'bg-amber-950/80 text-amber-400 border-amber-800/60' }
                        : isUdp
                        ? { label: 'UDP VPN', cls: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60' }
                        : { label: 'OTHER', cls: 'bg-slate-950/80 text-slate-400 border-slate-800/60' };

                      const checkTitle = isDns
                        ? 'DNS Резолвинг'
                        : check.kind === 'ip_icmp'
                        ? 'Ping IP (ICMP)'
                        : check.kind === 'domain_icmp'
                        ? 'Ping Host (ICMP)'
                        : check.kind === 'ip_tcp'
                        ? 'TCP Handshake (IP)'
                        : isTcp
                        ? 'TCP Handshake (Host)'
                        : check.kind === 'udp_awg'
                        ? 'UDP AWG Порт'
                        : check.kind;

                      return (
                        <div
                          key={cIdx}
                          className={`p-3 rounded-xl border flex flex-col justify-between ${
                            check.ok
                              ? 'bg-[#0A1D26]/70 border-[#1C3945]'
                              : 'bg-rose-950/30 border-rose-800/50'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5 gap-1">
                              <div className="flex items-center space-x-1.5 truncate">
                                <span className={`text-[9px] px-1.5 py-0.2 rounded border font-bold ${protoTag.cls}`}>
                                  {protoTag.label}
                                </span>
                                <span className="font-bold text-[#F2F0E8] uppercase tracking-wider text-[11px] truncate">
                                  {checkTitle}
                                </span>
                              </div>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                check.ok ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                              }`}>
                                {check.ok ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <div className="text-[#A8B4B7] text-[11px] break-all truncate" title={check.target}>
                              Цель: {check.target}
                            </div>
                          </div>

                          <div className="mt-2 pt-1.5 border-t border-[#1C3945]/50 flex justify-between items-center text-[11px]">
                            <span className="text-[#718187]">Задержка:</span>
                            <span className={check.ok ? 'text-[#D9B96E] font-bold' : 'text-rose-400'}>
                              {check.ok
                                ? `${check.latency_ms} ms`
                                : isTcp && (check.error?.includes('timeout') || check.error?.includes('timed out'))
                                ? 'Блок ТСПУ / Таймаут'
                                : (check.error || 'Ошибка')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-[#06141B]/60 border border-[#1C3945] rounded-2xl p-8 text-center space-y-2">
            <Radio className="w-8 h-8 text-[#718187] mx-auto opacity-50" />
            <div className="text-sm font-mono text-[#A8B4B7]">
              Результаты зондов публичной сети пока не получены.
            </div>
            <p className="text-xs text-[#718187] font-sans max-w-md mx-auto">
              Нажмите кнопку «Запустить проверку» выше, чтобы произвести live-опрос доступности контрольных точек.
            </p>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-[#1C3945]/70 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-sans">
            <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945]/70">
              <div className="font-bold text-[#F2F0E8] flex items-center space-x-1.5 mb-1">
                <span>🇷🇺</span>
                <span>Зонд M0 (Москва)</span>
              </div>
              <p className="text-[#A8B4B7] text-[11px] leading-relaxed">
                Проверяет маршрут <strong>изнутри РФ</strong> через физический сетевой интерфейс. Успех (PASS) подтверждает доступность хоста в сети оператора.
              </p>
            </div>

            <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945]/70">
              <div className="font-bold text-[#F2F0E8] flex items-center space-x-1.5 mb-1">
                <span>🌐</span>
                <span>Зонд S0 (Зарубеж)</span>
              </div>
              <p className="text-[#A8B4B7] text-[11px] leading-relaxed">
                Контрольная точка в европейском дата-центре. Позволяет отличить аварию у хостера от фильтрации ТСПУ в РФ.
              </p>
            </div>

            <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945]/70">
              <div className="font-bold text-[#F2F0E8] flex items-center space-x-1.5 mb-1">
                <span>🛡️</span>
                <span>Защита от DPI</span>
              </div>
              <p className="text-[#A8B4B7] text-[11px] leading-relaxed">
                Пакеты AmneziaWG маскируются пресетом мусорных данных (Jc/Jmin) и заголовками H1–H4, оставаясь нераспознаваемыми для DPI.
              </p>
            </div>

            <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945]/70">
              <div className="font-bold text-[#D9B96E] flex items-center space-x-1.5 mb-1">
                <span>⚡</span>
                <span>TCP vs UDP в РФ</span>
              </div>
              <p className="text-[#A8B4B7] text-[11px] leading-relaxed">
                Блокировка веб-порта TCP (:443) на магистралях РФ <strong>не препятствует</strong> работе VPN, использующего замаскированный UDP.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Cascade Egress Routing (Only for Cascade Nodes) */}
      {node.type === 'cascade' && (() => {
        const egressTargets = node.egress?.targets || [
          { interface: 'awg1', node: 'S1', label: 'S1 Нидерланды (Амстердам)', endpoint: '192.0.2.20:51821', available: true },
          { interface: 'awg3', node: 'S3', label: 'S3 Германия (Франкфурт)', endpoint: '192.0.2.22:51820', available: true },
          { interface: 'awg4', node: 'S4', label: 'S4 Швеция (Стокгольм)', endpoint: '192.0.2.24:51820', available: true },
          { interface: 'awg5', node: 'S5P', label: 'S5P Нидерланды PRO (Амстердам)', endpoint: '192.0.2.26:51820', available: true },
        ];

        const priorityList = node.failover_priority && node.failover_priority.length > 0
          ? node.failover_priority
          : egressTargets.map((t) => t.interface);

        const sortedTargets = [...egressTargets].sort((a, b) => {
          let indexA = priorityList.indexOf(a.interface);
          let indexB = priorityList.indexOf(b.interface);
          if (indexA === -1) indexA = 999;
          if (indexB === -1) indexB = 999;
          return indexA - indexB;
        });

        return (
          <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div className="flex items-center space-x-2.5">
                <ArrowRightLeft className="w-5 h-5 text-[#D9B96E]" />
                <div>
                  <h4 className="font-serif font-bold text-lg text-[#F2F0E8]">
                    Каскадная маршрутизация (Egress шлюз выхода)
                  </h4>
                  <p className="text-xs text-[#A8B4B7] font-sans mt-0.5">
                    Трафик клиентов поступает на этот узел (M0 Ingress) и перенаправляется на зарубежный сервер
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {node.egress?.active_interface && (
                  <div className="flex items-center space-x-2 bg-[#06141B] px-3 py-1.5 rounded-xl border border-[#D9B96E]/30">
                    <span className="text-xs font-mono text-[#A8B4B7]">Активный выход:</span>
                    <span className="text-xs font-mono font-bold text-[#D9B96E]">
                      {node.egress.targets?.find((t) => t.interface === node.egress?.active_interface)?.label || node.egress.active_interface}
                    </span>
                  </div>
                )}

                <button
                  onClick={handleCheckEgress}
                  disabled={checkingEgress}
                  title="Запустить немедленную проверку всех шлюзов выхода каскада"
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-[#1C3945] bg-[#06141B] text-[#A8B4B7] hover:text-[#D9B96E] hover:border-[#D9B96E]/50 text-xs font-mono font-bold transition cursor-pointer disabled:opacity-50"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${checkingEgress ? 'animate-spin text-[#D9B96E]' : ''}`} />
                  <span>{checkingEgress ? 'Проверка...' : 'Проверить шлюзы'}</span>
                </button>

                <button
                  onClick={handleToggleAutoFailover}
                  disabled={savingFailover}
                  title={node.auto_failover_enabled ? 'Нажмите для отключения автоматического переключения' : 'Нажмите для активации автоматического переключения'}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition cursor-pointer disabled:opacity-50 ${
                    node.auto_failover_enabled
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/40'
                      : 'bg-[#06141B] text-[#718187] border-[#1C3945] hover:border-[#718187]/60 hover:text-[#A8B4B7]'
                  }`}
                >
                  {node.auto_failover_enabled ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Auto-Failover: ВКЛ</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-4 h-4 text-[#718187]" />
                      <span>Auto-Failover: ВЫКЛ</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Status Banner */}
            {node.auto_failover_enabled ? (
              <div className={`mb-5 p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-sans ${
                node.failover?.in_cooldown
                  ? 'bg-amber-950/20 border-amber-600/40 text-amber-200'
                  : (node.failover?.consecutive_failures || 0) > 0
                  ? 'bg-rose-950/20 border-rose-600/40 text-rose-200'
                  : 'bg-emerald-950/20 border-emerald-600/40 text-emerald-200'
              }`}>
                <div className="flex items-center space-x-2.5">
                  {node.failover?.in_cooldown ? (
                    <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (node.failover?.consecutive_failures || 0) > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold">
                      {node.failover?.in_cooldown
                        ? 'Режим охлаждения (Cooldown) активен:'
                        : (node.failover?.consecutive_failures || 0) > 0
                        ? `Внимание: сбой активного шлюза (${node.failover?.consecutive_failures}/2):`
                        : 'Автоматическая защита активна:'}
                    </span>{' '}
                    <span className="opacity-90">
                      {node.failover?.in_cooldown
                        ? 'Автопереключение временно приостановлено на 5 минут для стабилизации сессий и защиты от флаппинга.'
                        : (node.failover?.consecutive_failures || 0) > 0
                        ? 'Следующий неудачный опрос вызовет автоматический переход на первый доступный резервный шлюз.'
                        : 'При 2 последовательных сбоях активного направления трафик автоматически переключится на резервный шлюз по порядку приоритета.'}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-left sm:text-right font-mono text-[11px] opacity-80 pl-6 sm:pl-0">
                  Порог: 2 сбоя | Cooldown: 5 мин
                </div>
              </div>
            ) : (
              <div className="mb-5 p-3 rounded-2xl border border-[#1C3945] bg-[#06141B]/60 text-xs font-sans text-[#718187] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-[#718187] shrink-0" />
                  <span>
                    Auto-Failover отключен: каскад зафиксирован на выбранном шлюзе. В случае блокировки или сбоя за рубежом трафик не будет перенаправлен автоматически.
                  </span>
                </div>
                <button
                  onClick={handleToggleAutoFailover}
                  disabled={savingFailover}
                  className="shrink-0 text-[11px] font-mono text-[#D9B96E] hover:underline cursor-pointer pl-6 sm:pl-0"
                >
                  Включить защиту
                </button>
              </div>
            )}

            {/* Targets Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {sortedTargets.map((target, idx) => {
                const isActive = node.egress?.active_interface === target.interface;
                const priorityRank = idx + 1;
                return (
                  <div
                    key={target.interface}
                    className={`p-4 rounded-2xl border transition flex flex-col justify-between ${
                      isActive
                        ? 'bg-amber-950/20 border-[#D9B96E] shadow-lg shadow-[#D9B96E]/10'
                        : 'bg-[#06141B]/70 border-[#1C3945] hover:border-[#1C3945]/90'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#102833] text-[#A8B4B7] border border-[#1C3945] shrink-0"
                            title="Приоритет в цепочке автопереключения"
                          >
                            #{priorityRank}
                          </span>
                          <span className="font-serif font-bold text-sm text-[#F2F0E8] truncate" title={target.label}>
                            {target.label}
                          </span>
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-600/40 shrink-0">
                            Активен
                          </span>
                        )}
                        {target.is_frozen && (
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shrink-0" title="Рукопожатие WireGuard зависло (0 B получено)">
                            ❄️ Завис
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-xs font-mono text-[#A8B4B7] bg-[#0A1D26] p-2.5 rounded-xl border border-[#1C3945]/50">
                        <div className="flex justify-between">
                          <span className="text-[#718187]">Интерфейс:</span>
                          <span className="text-[#D9B96E]">{target.interface}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#718187]">Шлюз:</span>
                          <span className="text-[#F2F0E8]">{target.node}</span>
                        </div>
                        <div className="flex justify-between truncate" title={target.endpoint}>
                          <span className="text-[#718187]">Эндпоинт:</span>
                          <span className="text-[#A8B4B7] truncate max-w-[120px]">{target.endpoint}</span>
                        </div>
                        {target.handshake_age_sec !== undefined && target.handshake_age_sec > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[#718187]">Хэндшейк:</span>
                            <span className={target.is_frozen ? 'text-cyan-400 font-bold' : 'text-[#A8B4B7]'}>
                              {target.handshake_age_sec < 60
                                ? `${target.handshake_age_sec} с назад`
                                : `${Math.round(target.handshake_age_sec / 60)} мин назад`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Micro-badges for multi-target health checks */}
                      {target.checks && target.checks.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-[#1C3945]/40 text-[10px]">
                          {target.checks.map((c) => (
                            <span
                              key={c.name}
                              className={`px-1.5 py-0.5 rounded font-mono flex items-center gap-0.5 ${
                                c.ok
                                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-700/40'
                                  : 'bg-rose-950/50 text-rose-300 border border-rose-700/40'
                              }`}
                              title={c.error || `HTTP ${c.status || 200}`}
                            >
                              <span>{c.name.toUpperCase()}</span>
                              <span>{c.ok ? '✓' : '✗'}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {!target.available && target.reason && (
                        <div className="text-[10px] text-rose-400 font-sans mt-1.5 line-clamp-2 leading-tight" title={target.reason}>
                          {target.reason}
                        </div>
                      )}

                      {target.recommendation && (
                        <div className="mt-2 p-2 bg-cyan-950/30 border border-cyan-600/40 rounded-xl text-[10px] text-cyan-200">
                          <div className="font-semibold flex items-center gap-1 mb-1 text-cyan-300">
                            <AlertTriangle className="w-3 h-3 text-cyan-400 shrink-0" />
                            <span>Рекомендация по сбросу:</span>
                          </div>
                          <code className="block bg-[#06141B] px-1.5 py-1 rounded text-[#D9B96E] font-mono text-[9px] break-all select-all">
                            {target.recommendation}
                          </code>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#1C3945]/50 flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-mono flex items-center space-x-1 ${
                        target.available ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${target.available ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                        <span>{target.available ? `Доступен (${target.passed_checks ?? 5}/${target.total_checks ?? 5})` : 'Недоступен'}</span>
                      </span>

                      <div className="flex items-center space-x-1.5">
                        <div className="flex items-center space-x-0.5">
                          <button
                            onClick={() => handleMovePriority(target.interface, 'up')}
                            disabled={idx === 0 || savingFailover}
                            title="Повысить приоритет в очереди"
                            className="p-1 rounded bg-[#102833] hover:bg-[#1C3945] text-[#A8B4B7] hover:text-[#D9B96E] border border-[#1C3945] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleMovePriority(target.interface, 'down')}
                            disabled={idx === sortedTargets.length - 1 || savingFailover}
                            title="Понизить приоритет в очереди"
                            className="p-1 rounded bg-[#102833] hover:bg-[#1C3945] text-[#A8B4B7] hover:text-[#D9B96E] border border-[#1C3945] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        <button
                          onClick={() => handleRestartEgress(target.interface)}
                          disabled={Boolean(restartingEgress)}
                          title="Перезапустить туннель (systemctl restart awg-quick@...) без SSH"
                          className="text-xs font-mono font-medium text-[#A8B4B7] hover:text-[#F0D48D] uppercase tracking-wider px-2 py-1 rounded-lg bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] transition cursor-pointer disabled:opacity-50 flex items-center space-x-1"
                        >
                          <RotateCw className={`w-3 h-3 ${restartingEgress === target.interface ? 'animate-spin text-[#D9B96E]' : ''}`} />
                          <span className="hidden sm:inline">Перезапуск</span>
                        </button>

                        {!isActive && target.available && (
                          <button
                            onClick={() => handleSwitchEgress(target.interface)}
                            disabled={switchingEgress}
                            className="text-xs font-mono font-bold text-[#D9B96E] hover:text-[#F0D48D] uppercase tracking-wider px-2.5 py-1 rounded-lg bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] transition cursor-pointer disabled:opacity-50"
                          >
                            {switchingEgress ? '...' : 'Выбрать'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* SECTION 4: Traffic & Connected Peers Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Telemetry Stats (1 Col) */}
        <div className="bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <HardDrive className="w-5 h-5 text-[#D9B96E]" />
              <h4 className="font-serif font-bold text-base text-[#F2F0E8]">
                Нагрузка и трафик узла
              </h4>
            </div>

            <div className="space-y-3 font-sans text-xs">
              <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
                <div className="text-[#A8B4B7] font-mono uppercase tracking-wider text-[11px]">
                  Всего пропущено трафика
                </div>
                <div className="text-xl font-bold font-mono text-[#F2F0E8] mt-1">
                  {node.stats?.total_rx && node.stats?.total_tx
                    ? `${((node.stats.total_rx + node.stats.total_tx) / (1024 * 1024 * 1024)).toFixed(2)} GB`
                    : '—'}
                </div>
                <div className="flex justify-between text-[#718187] font-mono text-[11px] mt-2 pt-2 border-t border-[#1C3945]/60">
                  <span>Входящий (Rx): {node.stats?.total_rx ? `${(node.stats.total_rx / (1024 * 1024)).toFixed(1)} MB` : '—'}</span>
                  <span>Исходящий (Tx): {node.stats?.total_tx ? `${(node.stats.total_tx / (1024 * 1024)).toFixed(1)} MB` : '—'}</span>
                </div>
              </div>

              <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
                <div className="text-[#A8B4B7] font-mono uppercase tracking-wider text-[11px]">
                  Активные пиры (Устройства)
                </div>
                <div className="text-xl font-bold font-mono text-[#D9B96E] mt-1">
                  {node.client_keys?.length || node.stats?.active_peers || 0}
                  <span className="text-xs text-[#718187] font-normal font-sans ml-2">устройств привязано</span>
                </div>
              </div>

              <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
                <div className="text-[#A8B4B7] font-mono uppercase tracking-wider text-[11px]">
                  Аптайм демона AWG
                </div>
                <div className="text-sm font-bold font-mono text-[#F2F0E8] mt-1">
                  {node.stats?.uptime || 'Служба активна'}
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-[#718187] font-mono mt-6 pt-4 border-t border-[#1C3945]/70">
            Статистика обновляется фоновым сборщиком каждые 60 секунд.
          </div>
        </div>

        {/* Connected Client Keys Table (2 Cols) */}
        <div className="lg:col-span-2 bg-[#0D222C]/90 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Key className="w-5 h-5 text-[#D9B96E]" />
              <h4 className="font-serif font-bold text-base text-[#F2F0E8]">
                Привязанные конфигурации и пиры ({node.client_keys?.length || 0})
              </h4>
            </div>
          </div>

          <div className="overflow-x-auto border border-[#1C3945] rounded-2xl bg-[#06141B]/70">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-[#102833]/90 text-[11px] font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
                <tr>
                  <th className="px-4 py-3">Устройство / Ключ</th>
                  <th className="px-4 py-3">Пользователь</th>
                  <th className="px-4 py-3">Последний Handshake</th>
                  <th className="px-4 py-3 text-right">Трафик</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C3945]/60 text-[#F2F0E8]">
                {(node.client_keys || []).map((key) => (
                  <tr key={key.id} className="hover:bg-[#102833]/50 transition">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#F2F0E8]">{key.device_name || key.client_name}</div>
                      <div className="text-[11px] font-mono text-[#718187]">{key.client_name}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#D9B96E]">
                      {key.username || `User #${key.user_id}`}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <div className="flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${key.last_handshake && !key.last_handshake.includes('Никогда') ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        <span className="text-[#A8B4B7]">{key.last_handshake || 'Не выходил в сеть'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[#F2F0E8]">
                      {key.total_traffic_formatted || '0 B'}
                    </td>
                  </tr>
                ))}

                {(node.client_keys || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[#718187] font-mono">
                      К данному серверу пока не привязано ни одного ключа.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-[11px] text-[#718187] font-mono flex items-center justify-between flex-wrap gap-2">
            <span>● Зеленый индикатор: устройство передавало трафик менее 3 минут назад через провайдера</span>
            <span>Телеметрия Curve25519 & Delta Engine</span>
          </div>
        </div>
      </div>

      {/* SECTION 5: Technical Details & Obfuscation Parameters */}
      <div className="bg-[#0A1D26]/70 border border-[#1C3945] rounded-3xl p-6 shadow-xl">
        <div className="flex items-center space-x-2 mb-4">
          <Layers className="w-5 h-5 text-[#D9B96E]" />
          <h4 className="font-serif font-bold text-base text-[#F2F0E8]">
            Технические параметры узла и настройки обфускации
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
          <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
            <div className="text-[#718187] uppercase text-[10px]">API Endpoint (Slave API)</div>
            <div className="text-[#F2F0E8] font-bold mt-1 break-all">{node.api_url}</div>
          </div>

          <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
            <div className="text-[#718187] uppercase text-[10px]">Провайдер VPS</div>
            <div className="text-[#6EA8C4] font-bold mt-1 truncate">
              {node.provider_url ? (
                <a href={formatUrl(node.provider_url)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {node.provider_url}
                </a>
              ) : 'Не указан'}
            </div>
          </div>

          <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
            <div className="text-[#718187] uppercase text-[10px]">Параметры AWG Junk-пакетов</div>
            <div className="text-[#D9B96E] font-bold mt-1">Jc: 4, Jmin: 40, Jmax: 70</div>
          </div>

          <div className="bg-[#06141B] p-3.5 rounded-xl border border-[#1C3945]">
            <div className="text-[#718187] uppercase text-[10px]">Спец-заголовки AmneziaWG</div>
            <div className="text-[#D9B96E] font-bold mt-1">H1–H4 Obfuscated Headers</div>
          </div>
        </div>
      </div>

      {/* CONFIRM MODAL: Restart AWG Service */}
      <ConfirmModal
        isOpen={showRestartConfirm}
        title={`Перезапустить службу на «${node.name}»?`}
        message="Служба AmneziaWG на ноде будет перезапущена. Кратковременный разрыв текущих активных сессий клиентов (на 1-2 секунды) возможен."
        confirmText="Перезапустить"
        cancelText="Отмена"
        variant="warning"
        isLoading={isRestarting}
        onConfirm={handleRestart}
        onClose={() => setShowRestartConfirm(false)}
      />

      {/* MODAL: Restore Configuration */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-[#06141B]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D222C] border border-[#1C3945] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <h4 className="font-serif text-lg font-bold text-[#F2F0E8] flex items-center space-x-2">
              <Upload className="w-5 h-5 text-[#D9B96E]" />
              <span>Восстановление конфигурации сервера</span>
            </h4>
            <p className="text-xs text-[#A8B4B7] font-sans">
              Вставьте содержимое файла резервной копии (.bak) для восстановления настроек AmneziaWG на данном узле.
            </p>

            <form onSubmit={handleRestoreSubmit} className="space-y-4">
              <textarea
                value={restoreContent}
                onChange={(e) => setRestoreContent(e.target.value)}
                rows={8}
                placeholder="[Interface]&#10;Address = ...&#10;PrivateKey = ..."
                className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl p-3 text-xs font-mono text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                required
              />

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowRestoreModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isRestoring || !restoreContent.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] font-bold text-xs font-mono uppercase transition disabled:opacity-50"
                >
                  {isRestoring ? 'Восстановление...' : 'Восстановить конфигурацию'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Node */}
      {showEditModal && (
        <div className="fixed inset-0 bg-[#06141B]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D222C] border border-[#D9B96E]/40 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <h4 className="font-serif text-lg font-bold text-[#F2F0E8] flex items-center space-x-2">
              <Pencil className="w-5 h-5 text-[#D9B96E]" />
              <span>Редактирование параметров сервера</span>
            </h4>

            <form onSubmit={handleEditSubmit} className="space-y-4 font-sans text-xs">
              <div>
                <label className="block font-mono uppercase text-[#A8B4B7] mb-1">Название сервера</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono uppercase text-[#A8B4B7] mb-1">Тип соединения</label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as any)}
                    className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                  >
                    <option value="cascade">Каскад (Cascade)</option>
                    <option value="direct">Прямой (Direct)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-mono uppercase text-[#A8B4B7] mb-1">Страна выхода</label>
                  <select
                    value={editCountryCode}
                    onChange={(e) => setEditCountryCode(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none font-mono"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-mono uppercase text-[#A8B4B7] mb-1">API URL (Slave Endpoint)</label>
                <input
                  type="text"
                  value={editApiUrl}
                  onChange={(e) => setEditApiUrl(e.target.value)}
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 font-mono text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block font-mono uppercase text-[#A8B4B7] mb-1">
                  Новый API Key (оставьте пустым, если не меняется)
                </label>
                <input
                  type="password"
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 font-mono text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-mono uppercase text-[#A8B4B7] mb-1">Панель VPS Провайдера</label>
                <input
                  type="text"
                  value={editProviderUrl}
                  onChange={(e) => setEditProviderUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-3 py-2 font-mono text-[#F2F0E8] focus:border-[#D9B96E] focus:outline-none"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsMobileOptimized}
                    onChange={(e) => setEditIsMobileOptimized(e.target.checked)}
                    className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                  />
                  <span className="text-[#F2F0E8]">Оптимизирован для мобильных сетей (443 UDP)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsBackup}
                    onChange={(e) => setEditIsBackup(e.target.checked)}
                    className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                  />
                  <span className="text-[#F2F0E8]">Запасной / Резервный сервер (PRO-доступ)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editHasHysteria}
                    onChange={(e) => setEditHasHysteria(e.target.checked)}
                    className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                  />
                  <span className="text-[#F2F0E8]">Поддерживать протокол Hysteria 2</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editHasMieru}
                    onChange={(e) => setEditHasMieru(e.target.checked)}
                    className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                  />
                  <span className="text-[#F2F0E8]">Поддерживать протокол Mieru</span>
                </label>
                {editType === "direct" && <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editHasVless}
                    onChange={(e) => setEditHasVless(e.target.checked)}
                    className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                  />
                  <span className="text-[#F2F0E8]">Поддерживать протокол VLESS+Reality</span>
                </label>}

                {editType === 'cascade' && (
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editAutoFailoverEnabled}
                      onChange={(e) => setEditAutoFailoverEnabled(e.target.checked)}
                      className="rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945]"
                    />
                    <span className="text-[#F2F0E8]">Включить автопереключение выходов каскада (Auto-Failover)</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-[#1C3945]">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isEditingSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] font-bold text-xs font-mono uppercase transition disabled:opacity-50"
                >
                  {isEditingSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
