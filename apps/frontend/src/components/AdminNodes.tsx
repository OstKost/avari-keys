import { useState, useEffect, useMemo } from 'react';
import { animatedPortal as createPortal } from './animatedPortal';
import {
  Server,
  Activity,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  Download,
  Upload,
  X,
  Smartphone,
  Pencil,
  ExternalLink,
  Globe,
  ArrowRightLeft,
  Send,
  Bot,
  BellRing,
  Settings,
  Sparkles,
  Zap,
  Shield,
  Search,
  LayoutGrid,
  List,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
} from 'lucide-react';
import { api } from '../api/client';
import { AdminNode, EgressStatusResponse, TelegramStatusResponse } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { TelegramSettingsModal } from './TelegramSettingsModal';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';
import { COUNTRIES, formatNodeRouting, getCountryInfo } from '../utils/country';

const STORAGE_VIEW_KEY = 'avari_nodes_view_mode';

function NodeHealthBadge({ label, status }: { label: string; status?: AdminNode['server_status'] }) {
  const stale = !!status?.checked_at && Date.now() - new Date(status.checked_at).getTime() > 180_000;
  const state = stale ? 'yellow' : (status?.state || 'unknown');
  const reason = stale ? 'Результат проверки устарел' : status?.reason;
  const colors = {
    green: 'text-emerald-400 bg-emerald-950/70 border border-emerald-700/40',
    yellow: 'text-amber-300 bg-amber-950/70 border border-amber-700/40',
    red: 'text-rose-400 bg-rose-950/70 border border-rose-700/40',
    unknown: 'text-slate-400 bg-slate-900/70 border border-slate-700/40',
  };
  const dotColors = {
    green: 'bg-emerald-400',
    yellow: 'bg-amber-400 animate-pulse',
    red: 'bg-rose-400 animate-pulse',
    unknown: 'bg-slate-400',
  };
  const labels = {
    green: 'В порядке',
    yellow: 'Замечания',
    red: 'Недоступен',
    unknown: 'Нет данных',
  };
  const checked =
    status?.checked_at && !status.checked_at.startsWith('0001-')
      ? new Date(status.checked_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';

  return (
    <div className="space-y-0.5" title={reason}>
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${colors[state]}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[state]}`} aria-hidden="true" />
        <span>{label}: {labels[state]}</span>
      </span>
      {checked && <div className="text-[10px] text-[#A8B4B7] whitespace-nowrap">{checked}</div>}
      {reason && <div className="text-[10px] text-[#A8B4B7] max-w-[220px] truncate" title={reason}>{reason}</div>}
    </div>
  );
}

interface AdminNodesProps {
  onSelectNode?: (nodeId: number) => void;
}

export function AdminNodes({ onSelectNode }: AdminNodesProps = {}) {
  const { toast } = useToast();
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  // View mode: 'grid' (cards) or 'table' (streamlined list)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved === 'grid' || saved === 'table') return saved;
    } catch {}
    return 'grid';
  });

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'issues' | 'cascade' | 'direct' | 'pro'>('all');

  // Telegram status state
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusResponse | null>(null);
  const [isSendingTestAlert, setIsSendingTestAlert] = useState(false);
  const [showTelegramSettingsModal, setShowTelegramSettingsModal] = useState(false);
  const [showTelegramBanner, setShowTelegramBanner] = useState(true);

  // Form state for adding node
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'cascade' | 'direct'>('cascade');
  const [countryCode, setCountryCode] = useState('NLD');
  const [providerUrl, setProviderUrl] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isMobileOptimized, setIsMobileOptimized] = useState(false);
  const [isBackup, setIsBackup] = useState(false);
  const [hasHysteria, setHasHysteria] = useState(false);
  const [hasMieru, setHasMieru] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit node modal state
  const [editingNode, setEditingNode] = useState<AdminNode | null>(null);
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
  const [isEditingSubmitting, setIsEditingSubmitting] = useState(false);

  // Action modals state
  const [restartingNode, setRestartingNode] = useState<AdminNode | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  const [nodeToDelete, setNodeToDelete] = useState<AdminNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [backupNodeState, setBackupNodeState] = useState<{ node: AdminNode; data: string; timestamp: string } | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const [restoringNode, setRestoringNode] = useState<AdminNode | null>(null);
  const [restoreData, setRestoreData] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  const [egressByNode, setEgressByNode] = useState<Record<number, EgressStatusResponse>>({});
  const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({});

  const handleToggleView = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_VIEW_KEY, mode);
    } catch {}
  };

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      nodes.filter(n => n.type === 'cascade').forEach(async n => {
        try {
          const status = await api.getNodeEgress(n.id);
          if (alive) setEgressByNode(prev => ({ ...prev, [n.id]: status }));
        } catch { /* Keep the last known route. */ }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [nodes]);

  // Egress Switcher modal state
  const [egressNode, setEgressNode] = useState<AdminNode | null>(null);
  const [egressStatus, setEgressStatus] = useState<EgressStatusResponse | null>(null);
  const [loadingEgress, setLoadingEgress] = useState(false);
  const [switchingEgress, setSwitchingEgress] = useState(false);
  const [targetEgressIf, setTargetEgressIf] = useState<string>('awg3');

  const handleOpenEgress = async (node: AdminNode) => {
    setEgressNode(node);
    setLoadingEgress(true);
    setEgressStatus(null);
    try {
      const status = await api.getNodeEgress(node.id);
      setEgressStatus(status);
      setEgressByNode(prev => ({ ...prev, [node.id]: status }));
      setTargetEgressIf(status.active_interface);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка получения данных Egress');
    } finally {
      setLoadingEgress(false);
    }
  };

  const handleSwitchEgressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!egressNode || !targetEgressIf || !egressStatus?.targets?.some(t => t.interface === targetEgressIf && t.available)) return;

    try {
      setSwitchingEgress(true);
      const res = await api.switchNodeEgress(egressNode.id, targetEgressIf);
      if (!res.success) throw new Error(res.message || 'Не удалось переключить каскад');
      setEgressByNode(prev => ({ ...prev, [egressNode.id]: { ...egressStatus!, active_interface: targetEgressIf } }));
      toast.success(res.message || 'Каскад успешно переключён');
      setEgressNode(null);
      void fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка переключения шлюза выхода');
    } finally {
      setSwitchingEgress(false);
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const status = await api.getTelegramStatus();
      setTelegramStatus(status);
    } catch {
      // ignore
    }
  };

  const handleSendTelegramTestAlert = async () => {
    try {
      setIsSendingTestAlert(true);
      const res = await api.sendTelegramTestAlert();
      toast.success(res.message || 'Тестовое оповещение отправлено в Telegram');
      fetchTelegramStatus();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки тестового оповещения в Telegram');
    } finally {
      setIsSendingTestAlert(false);
    }
  };

  const fetchNodes = async (showSpin = false, silent = false) => {
    try {
      if (showSpin) setIsChecking(true);
      else if (!silent) setLoading(true);
      const [data, tg] = await Promise.all([
        api.getAdminNodes(),
        api.getTelegramStatus().catch(() => null),
      ]);
      const safeData = Array.isArray(data) ? data : [];
      setNodes(safeData);
      if (tg) setTelegramStatus(tg);
      if (showSpin) {
        const onlineCount = safeData.filter((n) => n.online).length;
        toast.success(`Health Check завершен: доступно ${onlineCount} из ${safeData.length} серверов`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки серверов');
    } finally {
      if (!silent) setLoading(false);
      setIsChecking(false);
    }
  };

  useEffect(() => {
    fetchNodes(false);
  }, []);

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault();
    const nodeName = name.trim();
    const nodeType = type;
    const nodeCountry = countryCode.trim().toUpperCase();
    const nodeProvider = providerUrl.trim();
    const nodeApi = apiUrl.trim();
    const nodeKey = apiKey.trim();
    const nodeMobile = isMobileOptimized;
    const nodeBackup = isBackup;
    const nodeHysteria = hasHysteria;
    const nodeMieru = hasMieru;
    try {
      setSubmitting(true);
      const res = await api.addAdminNode(
        nodeName,
        nodeType,
        nodeApi,
        nodeKey,
        nodeMobile,
        nodeCountry,
        nodeProvider,
        nodeBackup,
        nodeHysteria,
        nodeMieru
      );
      setName('');
      setCountryCode('NLD');
      setProviderUrl('');
      setApiUrl('');
      setApiKey('');
      setIsMobileOptimized(false);
      setIsBackup(false);
      setHasHysteria(false);
      setHasMieru(false);
      setShowAddForm(false);
      toast.success(`Сервер «${nodeName}» успешно подключен`);
      if (res && res.id) {
        setNodes((prev) => [...prev.filter((n) => n.id !== res.id), res]);
      }
      fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка добавления сервера');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (node: AdminNode) => {
    setEditingNode(node);
    setEditName(node.name);
    setEditType(node.type);
    setEditCountryCode(node.country_code || (node.type === 'cascade' ? 'NLD' : 'DEU'));
    setEditProviderUrl(node.provider_url || '');
    setEditApiUrl(node.api_url);
    setEditApiKey('');
    setEditIsMobileOptimized(Boolean(node.is_mobile_optimized));
    setEditIsBackup(Boolean(node.is_backup));
    setEditHasHysteria(Boolean(node.has_hysteria));
    setEditHasMieru(Boolean(node.has_mieru));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNode) return;
    const targetId = editingNode.id;
    const updatedName = editName.trim();
    const updatedType = editType;
    const updatedCountry = editCountryCode.trim().toUpperCase();
    const updatedProvider = editProviderUrl.trim();
    const updatedApiUrl = editApiUrl.trim();
    const updatedApiKey = editApiKey.trim();
    const updatedMobile = editIsMobileOptimized;
    const updatedBackup = editIsBackup;
    const updatedHysteria = editHasHysteria;
    const updatedMieru = editHasMieru;

    const previousNodes = [...nodes];
    setNodes((prev) =>
      prev.map((n) =>
        n.id === targetId
          ? {
              ...n,
              name: updatedName,
              type: updatedType,
              country_code: updatedCountry,
              provider_url: updatedProvider,
              api_url: updatedApiUrl,
              is_mobile_optimized: updatedMobile,
              is_backup: updatedBackup,
              has_hysteria: updatedHysteria,
              has_mieru: updatedMieru,
            }
          : n
      )
    );
    setEditingNode(null);

    try {
      setIsEditingSubmitting(true);
      await api.updateAdminNode(targetId, {
        name: updatedName,
        type: updatedType,
        apiUrl: updatedApiUrl,
        apiKey: updatedApiKey || undefined,
        isMobileOptimized: updatedMobile,
        isBackup: updatedBackup,
        hasHysteria: updatedHysteria,
        hasMieru: updatedMieru,
        countryCode: updatedCountry,
        providerUrl: updatedProvider,
      });
      toast.success(`Параметры сервера «${updatedName}» успешно обновлены`);
      fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обновления сервера');
      setNodes(previousNodes);
    } finally {
      setIsEditingSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!nodeToDelete) return;
    const target = nodeToDelete;
    const previousNodes = [...nodes];
    setNodes((prev) => prev.filter((n) => n.id !== target.id));
    setNodeToDelete(null);
    try {
      setIsDeleting(true);
      await api.deleteAdminNode(target.id);
      toast.success(`Сервер «${target.name}» удален`);
      fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления ноды');
      setNodes(previousNodes);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRestartConfirm = async () => {
    if (!restartingNode) return;
    try {
      setIsRestarting(true);
      const res = await api.restartNode(restartingNode.id);
      toast.success(res.message || `Служба AWG на сервере «${restartingNode.name}» успешно перезапущена`);
      setRestartingNode(null);
      fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка перезапуска службы AWG');
    } finally {
      setIsRestarting(false);
    }
  };

  const handleBackupClick = async (node: AdminNode) => {
    try {
      setIsBackingUp(true);
      const res = await api.backupNode(node.id);
      setBackupNodeState({
        node,
        data: res.backup_data,
        timestamp: res.timestamp,
      });
      toast.info(`Резервная копия для «${node.name}» подготовлена`);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка создания резервной копии');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackupFile = () => {
    if (!backupNodeState) return;
    const blob = new Blob([backupNodeState.data], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_node_${backupNodeState.node.id}_${new Date().toISOString().slice(0, 10)}.bak`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Файл резервной копии скачан');
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoringNode || !restoreData.trim()) return;
    try {
      setIsRestoring(true);
      const res = await api.restoreNode(restoringNode.id, restoreData.trim());
      toast.success(res.message || `Конфигурация сервера «${restoringNode.name}» успешно восстановлена`);
      setRestoringNode(null);
      setRestoreData('');
      fetchNodes(false, true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка восстановления из резервной копии');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) setRestoreData(content);
    };
    reader.readAsText(file);
  };

  const formatUrl = (url: string) => {
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      return `https://${url}`;
    }
    return url;
  };

  const getDomainFromUrl = (url: string) => {
    try {
      const parsed = new URL(formatUrl(url));
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  // Metrics computation
  const metrics = useMemo(() => {
    const total = nodes.length;
    const online = nodes.filter((n) => n.online).length;
    const issues = nodes.filter(
      (n) =>
        !n.online ||
        n.server_status?.state === 'yellow' ||
        n.server_status?.state === 'red' ||
        n.network_status?.state === 'yellow' ||
        n.network_status?.state === 'red'
    ).length;
    const cascades = nodes.filter((n) => n.type === 'cascade').length;
    const directs = nodes.filter((n) => n.type === 'direct').length;
    const pro = nodes.filter((n) => n.is_backup).length;
    return { total, online, issues, cascades, directs, pro };
  }, [nodes]);

  // Filtered and searched nodes list
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      // 1. Status Filter
      if (statusFilter === 'online') {
        if (!node.online) return false;
      } else if (statusFilter === 'issues') {
        const isProblem =
          !node.online ||
          node.server_status?.state === 'yellow' ||
          node.server_status?.state === 'red' ||
          node.network_status?.state === 'yellow' ||
          node.network_status?.state === 'red';
        if (!isProblem) return false;
      } else if (statusFilter === 'cascade') {
        if (node.type !== 'cascade') return false;
      } else if (statusFilter === 'direct') {
        if (node.type !== 'direct') return false;
      } else if (statusFilter === 'pro') {
        if (!node.is_backup) return false;
      }

      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const countryInfo = getCountryInfo(node.country_code);
        const matchName = node.name.toLowerCase().includes(q);
        const matchCountry =
          (node.country_code || '').toLowerCase().includes(q) ||
          (countryInfo?.name || '').toLowerCase().includes(q);
        const matchApi = (node.api_url || '').toLowerCase().includes(q);
        const matchProvider = (node.provider_url || '').toLowerCase().includes(q);
        const matchId = q === `${node.id}` || q === `#${node.id}`;
        if (!matchName && !matchCountry && !matchApi && !matchProvider && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [nodes, statusFilter, searchQuery]);

  if (loading) {
    return <Loader size="section" text="Опрос и получение списка Slave-серверов..." />;
  }

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h3 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] flex items-center space-x-2.5">
              <Server className="w-5 h-5 sm:w-6 sm:h-6 text-[#D9B96E]" />
              <span>Управление Slave-нодами AmneziaWG</span>
            </h3>
            <span className="text-xs font-mono tracking-wider px-2.5 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#1C3945]">
              Кластер
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#A8B4B7] mt-1 font-sans">
            Мониторинг инфраструктуры, переключение выходов каскада, глубокая диагностика и сервисное обслуживание серверов.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={() => fetchNodes(true)}
            disabled={isChecking}
            className="flex items-center space-x-1.5 text-xs sm:text-sm font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#A8B4B7] hover:text-[#F2F0E8] px-3.5 py-2 rounded-xl border border-[#1C3945] transition disabled:opacity-50 cursor-pointer shadow-sm"
            title="Запустить немедленный опрос доступности всех узлов"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin text-[#D9B96E]' : ''}`} />
            <span>{isChecking ? 'Проверка...' : 'Health Check'}</span>
          </button>

          <button
            onClick={() => setShowTelegramSettingsModal(true)}
            className="flex items-center space-x-1.5 text-xs sm:text-sm font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#38BDF8] hover:text-[#7DD3FC] px-3 py-2 rounded-xl border border-[#1C3945] transition cursor-pointer shadow-sm"
            title="Настройки Telegram-бота оповещений"
          >
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">Бот</span>
          </button>

          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center space-x-1.5 text-xs sm:text-sm font-mono font-bold uppercase tracking-wider bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] px-4 py-2 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить Сервер</span>
          </button>
        </div>
      </div>

      {/* Metrics Overview Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Metric 1: Total */}
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-[#102833] border-[#D9B96E] shadow-md shadow-[#D9B96E]/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>Всего</span>
            <Server className="w-3.5 h-3.5 text-[#D9B96E]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#F2F0E8] mt-1">
            {metrics.total}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">В кластере</div>
        </button>

        {/* Metric 2: Online */}
        <button
          onClick={() => setStatusFilter('online')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'online'
              ? 'bg-[#102833] border-emerald-500 shadow-md shadow-emerald-500/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>В сети</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 mt-1">
            {metrics.online}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">Доступны</div>
        </button>

        {/* Metric 3: Issues */}
        <button
          onClick={() => setStatusFilter('issues')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'issues'
              ? 'bg-[#102833] border-amber-500 shadow-md shadow-amber-500/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>Сбои</span>
            <AlertTriangle className={`w-3.5 h-3.5 ${metrics.issues > 0 ? 'text-amber-400' : 'text-[#718187]'}`} />
          </div>
          <div className={`text-xl sm:text-2xl font-bold font-mono mt-1 ${metrics.issues > 0 ? 'text-amber-400' : 'text-[#A8B4B7]'}`}>
            {metrics.issues}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">
            {metrics.issues === 0 ? 'Все в норме' : 'Требуют внимания'}
          </div>
        </button>

        {/* Metric 4: Cascades */}
        <button
          onClick={() => setStatusFilter('cascade')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'cascade'
              ? 'bg-[#102833] border-amber-400 shadow-md shadow-amber-400/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>Каскады</span>
            <ArrowRightLeft className="w-3.5 h-3.5 text-amber-300" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-amber-300 mt-1">
            {metrics.cascades}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">M0 ➔ Egress</div>
        </button>

        {/* Metric 5: Direct */}
        <button
          onClick={() => setStatusFilter('direct')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'direct'
              ? 'bg-[#102833] border-[#6EA8C4] shadow-md shadow-[#6EA8C4]/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>Прямые</span>
            <Globe className="w-3.5 h-3.5 text-[#6EA8C4]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#6EA8C4] mt-1">
            {metrics.directs}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">Автономные</div>
        </button>

        {/* Metric 6: PRO Tier */}
        <button
          onClick={() => setStatusFilter('pro')}
          className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
            statusFilter === 'pro'
              ? 'bg-[#102833] border-purple-500 shadow-md shadow-purple-500/10'
              : 'bg-[#0D222C]/80 border-[#1C3945] hover:border-[#1C3945]/80 hover:bg-[#102833]/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-[#A8B4B7] uppercase tracking-wider">
            <span>PRO</span>
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-purple-300 mt-1">
            {metrics.pro}
          </div>
          <div className="text-[11px] text-[#718187] font-mono mt-0.5">Резервные</div>
        </button>
      </div>

      {/* Telegram Bot Alert Status Card (Compact & Dismissible) */}
      {showTelegramBanner && (
        <div className="bg-[#0B1E28] border border-[#1C3945] rounded-2xl p-4 shadow-lg relative overflow-hidden transition-all">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#102833] border border-[#D9B96E]/30 flex items-center justify-center flex-shrink-0 text-[#D9B96E] shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span className="font-serif font-bold text-[#F2F0E8] text-sm sm:text-base">
                    Оповещения в Telegram
                  </span>
                  {telegramStatus?.bot_username ? (
                    <span className="text-xs font-mono text-[#D9B96E] bg-[#102833] px-2 py-0.5 rounded-md border border-[#1C3945]">
                      @{telegramStatus.bot_username}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-[#718187] bg-[#102833] px-2 py-0.5 rounded-md border border-[#1C3945]">
                      Бот не подключен
                    </span>
                  )}
                  {telegramStatus?.enabled ? (
                    <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-bold">
                      ● Алерты активны
                    </span>
                  ) : (
                    <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-800/40">
                      Отключены
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#A8B4B7] mt-0.5 font-sans truncate">
                  {telegramStatus?.enabled
                    ? `Уведомления направляются администраторам при сбоях нод и запросах модерации. Подключено получателей: ${telegramStatus.total_subscribers || 0}.`
                    : 'Оповещения отключены. Настройте бота для мгновенных алертов о недоступности серверов.'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
              {telegramStatus?.enabled && (
                <button
                  onClick={handleSendTelegramTestAlert}
                  disabled={isSendingTestAlert}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#D9B96E] text-xs font-mono uppercase tracking-wider transition disabled:opacity-50 cursor-pointer"
                  title="Отправить тестовое оповещение во все привязанные чаты администраторов"
                >
                  <BellRing className={`w-3.5 h-3.5 ${isSendingTestAlert ? 'animate-bounce text-[#D9B96E]' : ''}`} />
                  <span>{isSendingTestAlert ? 'Отправка...' : 'Тест'}</span>
                </button>
              )}
              {telegramStatus?.bot_username && (
                <a
                  href={`https://t.me/${telegramStatus.bot_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#A8B4B7] hover:text-[#F2F0E8] text-xs font-mono uppercase tracking-wider transition cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Чат</span>
                </a>
              )}
              <button
                onClick={() => setShowTelegramSettingsModal(true)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#38BDF8] text-xs font-mono uppercase tracking-wider transition cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Настройки</span>
              </button>
              <button
                onClick={() => setShowTelegramBanner(false)}
                className="p-1.5 rounded-lg text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833] transition"
                title="Скрыть блок"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control Toolbar: Search, Filters & View Toggle */}
      <div className="bg-[#0A1D26]/70 border border-[#1C3945] rounded-2xl p-3.5 sm:p-4 shadow-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#A8B4B7] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Поиск по названию, стране, IP или провайдеру..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-9 pr-8 py-2 text-xs sm:text-sm text-[#F2F0E8] focus:outline-none placeholder-[#718187] transition font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#718187] hover:text-[#F2F0E8] p-1 rounded-md"
              title="Очистить поиск"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills & View Mode Switcher */}
        <div className="flex items-center justify-between md:justify-end gap-2.5 overflow-x-auto no-scrollbar">
          {/* Quick Filter Select / Pills */}
          <div className="flex items-center space-x-1.5 bg-[#06141B] p-1 rounded-xl border border-[#1C3945]">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase tracking-wider transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40'
                  : 'text-[#A8B4B7] hover:text-[#F2F0E8]'
              }`}
            >
              Все ({metrics.total})
            </button>
            <button
              onClick={() => setStatusFilter('online')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase tracking-wider transition cursor-pointer ${
                statusFilter === 'online'
                  ? 'bg-[#102833] text-emerald-400 font-bold border border-emerald-500/40'
                  : 'text-[#A8B4B7] hover:text-[#F2F0E8]'
              }`}
            >
              Онлайн ({metrics.online})
            </button>
            {metrics.issues > 0 && (
              <button
                onClick={() => setStatusFilter('issues')}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase tracking-wider transition cursor-pointer ${
                  statusFilter === 'issues'
                    ? 'bg-[#102833] text-amber-300 font-bold border border-amber-500/40'
                    : 'text-amber-400/80 hover:text-amber-300'
                }`}
              >
                Сбои ({metrics.issues})
              </button>
            )}
          </div>

          {/* View Mode Toggle: Grid vs Table */}
          <div className="flex items-center bg-[#06141B] p-1 rounded-xl border border-[#1C3945] shadow-inner shrink-0">
            <Tooltip content="Сетка карточек" position="top">
              <button
                onClick={() => handleToggleView('grid')}
                aria-label="Режим сетки"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-mono transition duration-150 cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-sm'
                    : 'text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833]/40'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Сетка</span>
              </button>
            </Tooltip>

            <Tooltip content="Таблица" position="top">
              <button
                onClick={() => handleToggleView('table')}
                aria-label="Режим таблицы"
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-mono transition duration-150 cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-sm'
                    : 'text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833]/40'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Таблица</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* VIEW MODE 1: GRID VIEW (Cyber-Fantasy Cards) */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredNodes.map((node) => {
            const routing = formatNodeRouting(node.type, node.country_code);
            const countryInfo = getCountryInfo(node.country_code);
            const currentEgress = egressByNode[node.id];
            const currentLabel =
              currentEgress?.targets?.find((t) => t.interface === currentEgress.active_interface)?.label ||
              currentEgress?.active_interface ||
              'Выход недоступен';
            const isExpanded = Boolean(expandedNodes[node.id]);

            return (
              <div
                key={node.id}
                className="bg-[#0D222C]/90 border border-[#1C3945] hover:border-[#D9B96E]/40 rounded-3xl p-5 shadow-xl transition-all duration-200 flex flex-col justify-between group relative overflow-hidden"
              >
                {/* Status Accent Bar at top edge */}
                <div
                  className={`absolute top-0 left-0 right-0 h-1 ${
                    !node.online
                      ? 'bg-rose-500'
                      : node.server_status?.state === 'yellow' || node.network_status?.state === 'yellow'
                      ? 'bg-amber-400'
                      : 'bg-gradient-to-r from-[#D9B96E] to-[#6EA8C4]'
                  }`}
                />

                <div className="space-y-4">
                  {/* Card Header: Location + ID + Status + Ping */}
                  <div className="flex items-start justify-between gap-2 pt-1">
                    <div className="flex items-center space-x-2 min-w-0">
                      <div className="p-2 rounded-xl bg-[#102833] border border-[#1C3945] text-lg leading-none shadow-sm shrink-0">
                        {countryInfo?.flag || '🌐'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-mono font-bold text-[#D9B96E] uppercase tracking-wider whitespace-nowrap shrink-0">
                            {countryInfo?.code || node.country_code || 'VPN'}
                          </span>
                          <span className="text-xs font-mono text-[#718187] whitespace-nowrap shrink-0">#{node.id}</span>
                        </div>
                        <div className="text-xs text-[#A8B4B7] font-sans truncate max-w-[150px]">
                          {countryInfo?.name || 'Зарубежный шлюз'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      {node.online && typeof node.latency_ms === 'number' && (
                        <span
                          className="px-2 py-0.5 rounded-full bg-[#06141B] text-[#D9B96E] border border-[#1C3945] text-xs font-mono font-semibold whitespace-nowrap shrink-0"
                          title="Время отклика API узла"
                        >
                          ⚡ {node.latency_ms} ms
                        </span>
                      )}

                      <Tooltip content={node.online ? 'Узел в сети (Online)' : 'Внимание: узел недоступен (Offline)'}>
                        <div
                          className={`inline-flex items-center justify-center p-1.5 rounded-full border transition cursor-help shrink-0 ${
                            node.online
                              ? 'bg-emerald-950/60 border-emerald-700/50 hover:border-emerald-500'
                              : 'bg-rose-950/80 border-rose-600/70 hover:border-rose-400'
                          }`}
                        >
                          <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                            {node.online ? (
                              <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 duration-1000" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 animate-beacon-green" />
                              </>
                            ) : (
                              <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 animate-beacon-red" />
                              </>
                            )}
                          </span>
                        </div>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Server Name & Link to Diagnostics */}
                  <div>
                    {onSelectNode ? (
                      <button
                        onClick={() => onSelectNode(node.id)}
                        className="font-serif font-bold text-base sm:text-lg text-[#F2F0E8] hover:text-[#D9B96E] transition text-left cursor-pointer flex items-center space-x-1.5 group/title"
                        title="Открыть подробную страницу сервера и диагностики"
                      >
                        <span className="line-clamp-1">{node.name}</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover/title:opacity-100 transition-opacity text-[#D9B96E] shrink-0" />
                      </button>
                    ) : (
                      <h4 className="font-serif font-bold text-base sm:text-lg text-[#F2F0E8] line-clamp-1">
                        {node.name}
                      </h4>
                    )}

                    {/* Routing Box */}
                    <div className="mt-2.5 p-2.5 rounded-xl bg-[#06141B]/70 border border-[#1C3945]/60 flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-1.5 text-xs font-mono min-w-0">
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wider shrink-0 whitespace-nowrap ${
                            node.type === 'cascade'
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                              : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40'
                          }`}
                        >
                          {node.type === 'cascade' ? 'Каскад' : 'Прямой'}
                        </span>
                        <span className="text-[#A8B4B7] truncate whitespace-nowrap">
                          {node.type === 'cascade' ? (
                            <>Выход: <strong className="text-[#F2F0E8] font-bold whitespace-nowrap">{currentLabel}</strong></>
                          ) : (
                            routing.fullText
                          )}
                        </span>
                      </div>

                      {node.type === 'cascade' && (
                        <button
                          onClick={() => handleOpenEgress(node)}
                          className="px-2 py-1 rounded-lg bg-[#102833] hover:bg-[#1C3945] border border-[#D9B96E]/40 text-[#D9B96E] text-xs font-mono flex items-center space-x-1 transition shrink-0 cursor-pointer whitespace-nowrap"
                          title="Переключить выход каскада"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          <span className="hidden sm:inline">Шлюз</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Feature & Protocol Badges */}
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span
                      className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap shrink-0"
                      title="Поддерживается протокол AmneziaWG (AWG)"
                    >
                      <Shield className="w-3 h-3 text-[#D9B96E]" />
                      <span>AWG</span>
                    </span>

                    {node.has_hysteria && (
                      <span
                        className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-500/40 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap shrink-0"
                        title="Поддерживается высокоскоростной протокол Hysteria 2 (UDP 443)"
                      >
                        <Zap className="w-3 h-3 text-purple-300" />
                        <span>Hysteria 2</span>
                      </span>
                    )}

                    {node.has_mieru && (
                      <span
                        className="inline-flex items-center space-x-1 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap shrink-0"
                        title="Поддерживается скрытный протокол Mieru (TCP 28443)"
                      >
                        <Eye className="w-3 h-3 text-emerald-300" />
                        <span>Mieru</span>
                      </span>
                    )}

                    {node.is_mobile_optimized && (
                      <span
                        className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0"
                        title="Оптимизирован для мобильных сетей (--mobile 443/UDP)"
                      >
                        <Smartphone className="w-3 h-3" />
                        <span>443 LTE</span>
                      </span>
                    )}

                    {node.is_backup && (
                      <span
                        className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-600/40 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap shrink-0"
                        title="Запасной сервер — доступен только для тарифа PRO"
                      >
                        <Sparkles className="w-3 h-3 text-purple-300" />
                        <span>PRO Резерв</span>
                      </span>
                    )}
                  </div>

                  {/* Health Badges Mini-Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <NodeHealthBadge label="Сервер" status={node.server_status} />
                    <NodeHealthBadge label="Сеть" status={node.network_status} />
                  </div>

                  {/* Expandable M0 / S0 Probe Checks */}
                  {Boolean(node.network_probes?.length) && (
                    <div className="pt-1">
                      <button
                        onClick={() =>
                          setExpandedNodes((prev) => ({
                            ...prev,
                            [node.id]: !prev[node.id],
                          }))
                        }
                        className="text-xs font-mono text-[#D9B96E] hover:text-[#F0D48D] flex items-center space-x-1 cursor-pointer transition"
                      >
                        <span>Проверки M0 / S0 ({node.network_probes!.length})</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 p-2.5 rounded-xl bg-[#06141B] border border-[#1C3945] text-xs font-mono text-[#A8B4B7]">
                          {node.network_probes!.map((probe) => {
                            const hasTcpFailure = probe.checks.some((c) => (c.kind.endsWith('_tcp') || c.kind === 'tcp') && !c.ok);
                            const hasIcmpSuccess = probe.checks.some((c) => c.kind.endsWith('_icmp') && c.ok);
                            const isTspuFiltered = hasTcpFailure && hasIcmpSuccess;

                            return (
                              <div key={probe.source} className="space-y-1">
                                <NodeHealthBadge label={probe.interface ? `${probe.source} · ${probe.interface}` : probe.source} status={probe} />
                                {isTspuFiltered && (
                                  <div className="text-[10px] text-amber-300/90 bg-amber-950/30 px-2 py-1 rounded border border-amber-800/40 leading-snug">
                                    ⚠️ Веб-порт TCP фильтруется ТСПУ (UDP VPN работает)
                                  </div>
                                )}
                                {probe.checks.map((check) => {
                                  const isDns = check.kind === 'dns';
                                  const isIcmp = check.kind.endsWith('_icmp');
                                  const isTcp = check.kind.endsWith('_tcp') || check.kind === 'tcp';
                                  const protoLabel = isDns ? 'DNS' : isIcmp ? 'ICMP' : isTcp ? 'TCP' : 'UDP';
                                  return (
                                    <div key={check.kind} className="flex justify-between items-center text-[11px] text-[#718187]">
                                      <span className="flex items-center space-x-1.5 truncate pr-2">
                                        <span className="text-[9px] px-1 py-0.2 rounded border font-mono font-bold bg-[#102833] text-[#A8B4B7] border-[#1C3945]">
                                          {protoLabel}
                                        </span>
                                        <span className="truncate">{check.kind} ({check.target}):</span>
                                      </span>
                                      {check.ok ? (
                                        <span className="text-emerald-400 font-bold shrink-0">{check.latency_ms} ms</span>
                                      ) : (
                                        <span className="text-rose-400 shrink-0 truncate max-w-[140px]" title={check.error}>
                                          {isTcp && (check.error?.includes('timeout') || check.error?.includes('timed out'))
                                            ? 'Блок ТСПУ'
                                            : (check.error || 'Ошибка')}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Endpoint & Provider Info */}
                  <div className="pt-2 border-t border-[#1C3945]/70 flex items-center justify-between text-xs font-mono text-[#718187]">
                    <span className="truncate max-w-[140px]" title={node.api_url}>
                      {node.api_url.replace(/^https?:\/\//, '')}
                    </span>

                    {node.provider_url ? (
                      <a
                        href={formatUrl(node.provider_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-[#6EA8C4] hover:text-[#F0D48D] transition"
                        title={`Открыть панель управления VPS (${node.provider_url})`}
                      >
                        <Globe className="w-3 h-3 text-[#D9B96E]" />
                        <span>{getDomainFromUrl(node.provider_url)}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>

                {/* Card Footer: Action Bar */}
                <div className="mt-5 pt-3 border-t border-[#1C3945] flex items-center justify-between gap-2">
                  {onSelectNode && (
                    <button
                      onClick={() => onSelectNode(node.id)}
                      className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#38BDF8] hover:text-[#7DD3FC] text-xs font-mono font-bold uppercase tracking-wider transition cursor-pointer shadow-sm"
                      title="Страница сервера и подробная диагностика"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>Диагностика</span>
                    </button>
                  )}

                  {/* Icon Buttons Group */}
                  <div className="flex items-center space-x-1">
                    <Tooltip content="Редактировать параметры">
                      <button
                        onClick={() => handleOpenEdit(node)}
                        className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>

                    <Tooltip content="Перезапустить службу AWG">
                      <button
                        onClick={() => setRestartingNode(node)}
                        className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] hover:text-[#F2F0E8] transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>

                    <Tooltip content="Резервная копия (.bak)">
                      <button
                        onClick={() => handleBackupClick(node)}
                        disabled={isBackingUp}
                        className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#6EA8C4] hover:bg-[#1C3945] hover:text-[#A8B4B7] transition disabled:opacity-50 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>

                    <Tooltip content="Восстановить из копии">
                      <button
                        onClick={() => setRestoringNode(node)}
                        className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] hover:text-[#F2F0E8] transition cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>

                    <Tooltip content="Удалить сервер">
                      <button
                        onClick={() => setNodeToDelete(node)}
                        className="p-2 rounded-xl border border-rose-800/40 bg-rose-950/20 text-rose-400 hover:bg-rose-900/40 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: TABLE VIEW (Streamlined & Aligned) */}
      {viewMode === 'table' && (
        <div className="overflow-x-auto border border-[#1C3945] rounded-3xl bg-[#06141B]/70 shadow-xl">
          <table className="w-full text-left text-sm text-[#F2F0E8] min-w-[900px]">
            <thead className="bg-[#102833]/90 text-xs font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
              <tr>
                <th className="px-5 py-3.5">Сервер / Узел</th>
                <th className="px-5 py-3.5">Маршрутизация</th>
                <th className="px-5 py-3.5">Протоколы и теги</th>
                <th className="px-5 py-3.5">Здоровье & Пинг</th>
                <th className="px-5 py-3.5">Провайдер VPS</th>
                <th className="px-5 py-3.5 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1C3945]/70 bg-[#0A1D26]/40 font-sans">
              {filteredNodes.map((node) => {
                const routing = formatNodeRouting(node.type, node.country_code);
                const countryInfo = getCountryInfo(node.country_code);
                const currentEgress = egressByNode[node.id];
                const currentLabel =
                  currentEgress?.targets?.find((t) => t.interface === currentEgress.active_interface)?.label ||
                  currentEgress?.active_interface ||
                  'Выход недоступен';
                const isExpanded = Boolean(expandedNodes[node.id]);

                return (
                  <tr key={node.id} className="hover:bg-[#102833]/40 transition duration-150">
                    {/* Server Name & ID */}
                    <td className="px-5 py-4">
                      <div className="flex items-center space-x-3">
                        <span className="text-xl leading-none">{countryInfo?.flag || '🌐'}</span>
                        <div>
                          {onSelectNode ? (
                            <button
                              onClick={() => onSelectNode(node.id)}
                              className="font-serif font-bold text-sm sm:text-base text-[#F2F0E8] hover:text-[#D9B96E] transition text-left cursor-pointer flex items-center space-x-1.5 group/link"
                              title="Открыть страницу сервера и диагностику"
                            >
                              <span>{node.name}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover/link:opacity-100 transition-opacity text-[#D9B96E]" />
                            </button>
                          ) : (
                            <span className="font-serif font-bold text-sm sm:text-base text-[#F2F0E8]">
                              {node.name}
                            </span>
                          )}
                          <div className="flex items-center space-x-2 text-xs font-mono text-[#718187] mt-0.5">
                            <span>ID #{node.id}</span>
                            <span>•</span>
                            <span className="truncate max-w-[150px]" title={node.api_url}>
                              {node.api_url.replace(/^https?:\/\//, '')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Routing */}
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex items-center space-x-1 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                            node.type === 'cascade'
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                              : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40'
                          }`}
                        >
                          {node.type === 'cascade' ? 'Каскад' : routing.fullText}
                        </span>
                        {node.type === 'cascade' && (
                          <div className="text-xs font-mono text-[#D9B96E] flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[#718187]">Выход:</span>
                            <span className="font-bold whitespace-nowrap">{currentLabel}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Protocols & Badges */}
                    <td className="px-5 py-4">
                      <div className="flex items-center flex-wrap gap-1.5 max-w-[200px]">
                        <span className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-xs font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">
                          <Shield className="w-3 h-3 text-[#D9B96E]" />
                          <span>AWG</span>
                        </span>
                        {node.has_hysteria && (
                          <span className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-500/40 text-xs font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">
                            <Zap className="w-3 h-3" />
                            <span>Hysteria 2</span>
                          </span>
                        )}
                        {node.has_mieru && (
                          <span className="inline-flex items-center space-x-1 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">
                            <Eye className="w-3 h-3 text-emerald-300" />
                            <span>Mieru</span>
                          </span>
                        )}
                        {node.is_backup && (
                          <span className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-600/40 text-xs font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">
                            <Sparkles className="w-3 h-3" />
                            <span>PRO</span>
                          </span>
                        )}
                        {node.is_mobile_optimized && (
                          <span className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-xs font-mono px-2 py-0.5 rounded-full font-bold whitespace-nowrap shrink-0">
                            <Smartphone className="w-3 h-3" />
                            <span>LTE</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Health Badges & Ping */}
                    <td className="px-5 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center space-x-2">
                          <Tooltip content={node.online ? 'Узел в сети (Online)' : 'Внимание: узел недоступен (Offline)'}>
                            <div
                              className={`inline-flex items-center justify-center p-1.5 rounded-full border transition cursor-help shrink-0 ${
                                node.online
                                  ? 'bg-emerald-950/60 border-emerald-700/50 hover:border-emerald-500'
                                  : 'bg-rose-950/80 border-rose-600/70 hover:border-rose-400'
                              }`}
                            >
                              <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                                {node.online ? (
                                  <>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40 duration-1000" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 animate-beacon-green" />
                                  </>
                                ) : (
                                  <>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 animate-beacon-red" />
                                  </>
                                )}
                              </span>
                            </div>
                          </Tooltip>

                          {node.online && typeof node.latency_ms === 'number' && (
                            <span className="text-xs font-mono text-[#D9B96E] whitespace-nowrap shrink-0">
                              ⚡ {node.latency_ms} ms
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-2">
                          <NodeHealthBadge label="Сервер" status={node.server_status} />
                          <NodeHealthBadge label="Сеть" status={node.network_status} />
                        </div>

                        {Boolean(node.network_probes?.length) && (
                          <div>
                            <button
                              onClick={() =>
                                setExpandedNodes((prev) => ({
                                  ...prev,
                                  [node.id]: !prev[node.id],
                                }))
                              }
                              className="text-xs font-mono text-[#D9B96E] hover:text-[#F0D48D] flex items-center space-x-1 cursor-pointer transition mt-1"
                            >
                              <span>Зонды ({node.network_probes!.length})</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            {isExpanded && (
                              <div className="mt-1.5 space-y-1 p-2 rounded-xl bg-[#06141B] border border-[#1C3945] text-xs font-mono text-[#A8B4B7]">
                                {node.network_probes!.map((p) => (
                                  <div key={p.source} className="flex justify-between items-center text-[11px] gap-2">
                                    <span>{p.source}:</span>
                                    <span className={p.state === 'green' ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                                      {p.state === 'green' ? 'В норме' : 'Сбой'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Provider */}
                    <td className="px-5 py-4 text-xs font-mono">
                      {node.provider_url ? (
                        <a
                          href={formatUrl(node.provider_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#6EA8C4] hover:text-[#F0D48D] transition"
                        >
                          <Globe className="w-3.5 h-3.5 text-[#D9B96E]" />
                          <span className="max-w-[120px] truncate">{getDomainFromUrl(node.provider_url)}</span>
                          <ExternalLink className="w-3 h-3 text-[#718187]" />
                        </a>
                      ) : (
                        <span className="text-[#718187]">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        {onSelectNode && (
                          <Tooltip content="Страница сервера и диагностика">
                            <button
                              onClick={() => onSelectNode(node.id)}
                              aria-label="Страница сервера и диагностика"
                              className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#38BDF8] hover:bg-[#1C3945] hover:text-[#7DD3FC] transition cursor-pointer"
                            >
                              <Activity className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        )}

                        {node.type === 'cascade' && (
                          <Tooltip content="Управление выходом каскада">
                            <button
                              onClick={() => handleOpenEgress(node)}
                              aria-label="Управление выходом каскада"
                              className="p-2 rounded-xl border border-[#D9B96E]/50 bg-[#102833]/80 text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition cursor-pointer"
                            >
                              <ArrowRightLeft className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        )}

                        <Tooltip content="Редактировать параметры">
                          <button
                            onClick={() => handleOpenEdit(node)}
                            aria-label="Редактировать"
                            className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </Tooltip>

                        <Tooltip content="Перезапустить службу AWG">
                          <button
                            onClick={() => setRestartingNode(node)}
                            aria-label="Перезапустить"
                            className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] hover:text-[#F2F0E8] transition cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </Tooltip>

                        <Tooltip content="Резервная копия">
                          <button
                            onClick={() => handleBackupClick(node)}
                            disabled={isBackingUp}
                            aria-label="Резервная копия"
                            className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#6EA8C4] hover:bg-[#1C3945] transition disabled:opacity-50 cursor-pointer"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </Tooltip>

                        <Tooltip content="Восстановить">
                          <button
                            onClick={() => setRestoringNode(node)}
                            aria-label="Восстановить"
                            className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] transition cursor-pointer"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                        </Tooltip>

                        <Tooltip content="Удалить сервер">
                          <button
                            onClick={() => setNodeToDelete(node)}
                            aria-label="Удалить"
                            className="p-2 rounded-xl border border-rose-800/40 bg-rose-950/20 text-rose-400 hover:bg-rose-900/40 transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {filteredNodes.length === 0 && (
        <div className="bg-[#0A1D26]/70 border border-[#1C3945] rounded-3xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#102833] border border-[#1C3945] flex items-center justify-center mx-auto text-[#D9B96E]">
            <Server className="w-6 h-6" />
          </div>
          <h4 className="font-serif font-bold text-lg text-[#F2F0E8]">
            {searchQuery || statusFilter !== 'all' ? 'Серверы не найдены' : 'Список серверов пуст'}
          </h4>
          <p className="text-sm text-[#A8B4B7] max-w-md mx-auto font-sans">
            {searchQuery || statusFilter !== 'all'
              ? 'По текущему фильтру или поисковому запросу ничего не найдено. Попробуйте сбросить параметры поиска.'
              : 'В кластере еще нет добавленных Slave-серверов AmneziaWG.'}
          </p>
          {(searchQuery || statusFilter !== 'all') ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="mt-2 px-4 py-2 rounded-xl bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] text-[#D9B96E] text-xs font-mono uppercase tracking-wider transition cursor-pointer"
            >
              Сбросить фильтры
            </button>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] font-bold text-xs font-mono uppercase tracking-wider transition cursor-pointer"
            >
              Добавить первый сервер
            </button>
          )}
        </div>
      )}

      {/* Add Node Modal via Portal */}
      {showAddForm &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md overflow-y-auto">
            <form
              onSubmit={handleAddNode}
              className="bg-[#0A1D26] border border-[#D9B96E]/40 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl space-y-5 my-auto"
            >
              <div className="flex items-center justify-between border-b border-[#1C3945]/80 pb-3">
                <div className="flex items-center space-x-3 text-[#D9B96E]">
                  <Plus className="w-5 h-5" />
                  <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">
                    Подключение нового Slave-сервера
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Название сервера
                  </label>
                  <input
                    type="text"
                    placeholder="например: Каскад M0 -> S1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Тип соединения
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as 'cascade' | 'direct')}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                  >
                    <option value="cascade">Каскад (Cascade M0 ➔ S1)</option>
                    <option value="direct">Прямой туннель (Direct S2)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Страна выхода (Флаг + 3 буквы)
                  </label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    API URL (Slave Endpoint)
                  </label>
                  <input
                    type="text"
                    placeholder="http://192.0.2.1:8081"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    API Key (X-API-Key)
                  </label>
                  <input
                    type="password"
                    placeholder="Секретный токен Slave демона"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Адрес VPS провайдера (Панель / Биллинг)
                  </label>
                  <input
                    type="text"
                    placeholder="https://aeza.net или https://hetzner.com"
                    value={providerUrl}
                    onChange={(e) => setProviderUrl(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono placeholder-[#718187]"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="space-y-2.5 pt-1">
                <div
                  onClick={() => setIsMobileOptimized(!isMobileOptimized)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    isMobileOptimized ? 'border-[#D9B96E] bg-[#102833]' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={isMobileOptimized}
                      onChange={(e) => setIsMobileOptimized(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-[#D9B96E] accent-[#D9B96E]"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Оптимизирован для мобильных сетей (порт 443/UDP)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setIsBackup(!isBackup)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    isBackup ? 'border-purple-500 bg-purple-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={isBackup}
                      onChange={(e) => setIsBackup(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-purple-400 accent-purple-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Запасной сервер (доступен только для тарифа PRO)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setHasHysteria(!hasHysteria)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    hasHysteria ? 'border-purple-500 bg-purple-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={hasHysteria}
                      onChange={(e) => setHasHysteria(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-purple-400 accent-purple-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Поддержка Hysteria 2 (QUIC / UDP 443)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setHasMieru(!hasMieru)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    hasMieru ? 'border-emerald-500 bg-emerald-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={hasMieru}
                      onChange={(e) => setHasMieru(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-emerald-400 accent-emerald-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Поддержка Mieru (TCP 28443)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-xs font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50"
                >
                  {submitting ? 'Сохранение...' : 'Сохранить и подключить'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* Edit Node Modal */}
      {editingNode &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md overflow-y-auto">
            <form
              onSubmit={handleEditSubmit}
              className="bg-[#0A1D26] border border-[#D9B96E]/40 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl space-y-5 my-auto"
            >
              <div className="flex items-center justify-between border-b border-[#1C3945]/80 pb-3">
                <div className="flex items-center space-x-3 text-[#D9B96E]">
                  <Pencil className="w-5 h-5" />
                  <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">
                    Редактирование сервера «{editingNode.name}»
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingNode(null)}
                  className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Название сервера
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Тип соединения
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as 'cascade' | 'direct')}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                  >
                    <option value="cascade">Каскад (Cascade M0 ➔ S1)</option>
                    <option value="direct">Прямой туннель (Direct S2)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Страна выхода (Флаг + 3 буквы)
                  </label>
                  <select
                    value={editCountryCode}
                    onChange={(e) => setEditCountryCode(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    API URL (Slave Endpoint)
                  </label>
                  <input
                    type="text"
                    value={editApiUrl}
                    onChange={(e) => setEditApiUrl(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Новый API Key (X-API-Key)
                  </label>
                  <input
                    type="password"
                    placeholder="Оставьте пустым, чтобы не менять"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono placeholder-[#718187]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Адрес VPS провайдера (Панель / Биллинг)
                  </label>
                  <input
                    type="text"
                    placeholder="например: https://aeza.net или https://hetzner.com"
                    value={editProviderUrl}
                    onChange={(e) => setEditProviderUrl(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono placeholder-[#718187]"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="space-y-2.5 pt-1">
                <div
                  onClick={() => setEditIsMobileOptimized(!editIsMobileOptimized)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    editIsMobileOptimized ? 'border-[#D9B96E] bg-[#102833]' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={editIsMobileOptimized}
                      onChange={(e) => setEditIsMobileOptimized(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-[#D9B96E] accent-[#D9B96E]"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Оптимизирован для мобильных сетей (--mobile / 443 UDP)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setEditIsBackup(!editIsBackup)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    editIsBackup ? 'border-purple-500 bg-purple-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={editIsBackup}
                      onChange={(e) => setEditIsBackup(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-purple-400 accent-purple-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Запасной сервер (доступен только для тарифа PRO)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setEditHasHysteria(!editHasHysteria)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    editHasHysteria ? 'border-purple-500 bg-purple-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={editHasHysteria}
                      onChange={(e) => setEditHasHysteria(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-purple-400 accent-purple-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Поддержка Hysteria 2 (QUIC / UDP 443)
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setEditHasMieru(!editHasMieru)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    editHasMieru ? 'border-emerald-500 bg-emerald-950/30' : 'border-[#1C3945] bg-[#06141B]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      checked={editHasMieru}
                      onChange={(e) => setEditHasMieru(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-emerald-400 accent-emerald-500"
                    />
                    <div>
                      <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8]">
                        Поддержка Mieru (TCP 28443)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingNode(null)}
                  className="px-4 py-2 text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isEditingSubmitting}
                  className="px-5 py-2.5 text-xs font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50"
                >
                  {isEditingSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* Restart Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(restartingNode)}
        title="Перезапустить AmneziaWG?"
        variant="gold"
        confirmText="Да, перезапустить"
        cancelText="Отмена"
        isLoading={isRestarting}
        onConfirm={handleRestartConfirm}
        onClose={() => setRestartingNode(null)}
        message={
          restartingNode && (
            <div>
              Вы собираетесь перезапустить сервис AmneziaWG на сервере{' '}
              <strong className="text-[#F2F0E8]">«{restartingNode.name}»</strong>.
              Текущие сетевые сессии клиентов будут кратковременно перезапущены (~1-2 сек).
            </div>
          )
        }
      />

      {/* Delete Node Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(nodeToDelete)}
        title="Удалить Slave-сервер?"
        variant="danger"
        confirmText="Да, удалить сервер"
        cancelText="Отмена"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setNodeToDelete(null)}
        message={
          nodeToDelete && (
            <div>
              Вы собираетесь удалить сервер{' '}
              <strong className="text-[#F2F0E8]">«{nodeToDelete.name}»</strong>.
              Все выданные на этом сервере ключи клиентов будут также удалены из базы данных.
            </div>
          )
        }
      />

      {/* Backup Modal */}
      {backupNodeState &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md overflow-y-auto">
            <div className="bg-[#0A1D26] border border-[#6EA8C4]/40 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-4 my-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 text-[#6EA8C4]">
                  <Download className="w-6 h-6" />
                  <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">Резервная копия AWG</h3>
                </div>
                <button
                  onClick={() => setBackupNodeState(null)}
                  className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[#A8B4B7]">
                Архив конфигураций клиентов и ключей с ноды{' '}
                <strong className="text-[#F2F0E8]">«{backupNodeState.node.name}»</strong> от{' '}
                <span className="font-mono text-emerald-400">{new Date(backupNodeState.timestamp).toLocaleString()}</span>.
              </p>
              <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945] font-mono text-xs text-[#A8B4B7] max-h-36 overflow-y-auto break-all select-all">
                {backupNodeState.data}
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadBackupFile}
                  className="flex items-center space-x-2 px-5 py-2.5 text-xs font-mono font-bold uppercase bg-gradient-to-r from-[#6EA8C4] to-[#407B98] text-[#06141B] rounded-xl shadow-lg transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Скачать файл .bak</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Restore Modal */}
      {restoringNode &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md overflow-y-auto">
            <form onSubmit={handleRestoreSubmit} className="bg-[#0A1D26] border border-[#D9B96E]/40 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-4 my-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 text-[#D9B96E]">
                  <Upload className="w-6 h-6" />
                  <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">Восстановление AWG</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setRestoringNode(null)}
                  className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[#A8B4B7]">
                Загрузите или вставьте архив резервной копии для развертывания на ноде{' '}
                <strong className="text-[#F2F0E8]">«{restoringNode.name}»</strong>.
              </p>
              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                  Загрузить из файла (.bak)
                </label>
                <input
                  type="file"
                  accept=".bak,.txt,.json"
                  onChange={handleRestoreFileUpload}
                  className="block w-full text-xs text-[#A8B4B7] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-mono file:bg-[#102833] file:text-[#D9B96E] hover:file:bg-[#1C3945]"
                />
              </div>
              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                  Или вставьте данные архива:
                </label>
                <textarea
                  rows={4}
                  value={restoreData}
                  onChange={(e) => setRestoreData(e.target.value)}
                  placeholder="Вставьте base64 строку резервной копии..."
                  className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl p-3 text-xs text-[#F2F0E8] focus:outline-none font-mono"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRestoringNode(null)}
                  disabled={isRestoring}
                  className="px-4 py-2 text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isRestoring || !restoreData.trim()}
                  className="px-5 py-2.5 text-xs font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50"
                >
                  {isRestoring ? 'Восстановление...' : 'Восстановить конфигурацию'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* Egress Switcher Modal */}
      {egressNode &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md overflow-y-auto">
            <form onSubmit={handleSwitchEgressSubmit} className="bg-[#0A1D26] border border-[#D9B96E]/40 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-4 my-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 text-[#D9B96E]">
                  <ArrowRightLeft className="w-6 h-6" />
                  <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">Управление выходом каскада</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => egressNode && handleOpenEgress(egressNode)}
                    disabled={loadingEgress || switchingEgress}
                    title="Запустить немедленную проверку всех шлюзов"
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#102833] text-[#A8B4B7] hover:text-[#D9B96E] border border-[#1C3945] transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingEgress ? 'animate-spin text-[#D9B96E]' : ''}`} />
                    <span>Проверить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEgressNode(null)}
                    className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-[#A8B4B7] font-sans">
                Узел <strong className="text-[#F2F0E8]">«{egressNode.name}»</strong>. Выбор выхода каскада без изменения клиентских ключей.
              </p>

              {loadingEgress ? (
                <div className="py-8 flex justify-center">
                  <Loader size="section" text="Опрос статуса маршрутизации узла..." />
                </div>
              ) : egressStatus ? (
                <div className="space-y-4">
                  {/* Current Status Box */}
                  <div className="p-4 rounded-2xl bg-[#06141B] border border-[#1C3945]">
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-[#A8B4B7] mb-2">
                      Текущий активный шлюз (Таблица 100):
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-mono font-bold text-base text-[#F2F0E8]">
                          {egressStatus.targets?.find((t) => t.interface === egressStatus.active_interface)?.label || egressStatus.active_interface || 'Не определён'}
                        </span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                        Active Egress
                      </span>
                    </div>
                  </div>

                  {/* Detailed Target Health Badges */}
                  <div className="space-y-2">
                    <span className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase">
                      Доступность направлений (кворум 3/5 + IP Safety Gate):
                    </span>
                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                      {(egressStatus.targets || []).map((target) => (
                        <div
                          key={target.interface}
                          className={`p-2.5 rounded-xl border text-xs font-mono transition-all ${
                            target.available
                              ? target.interface === egressStatus.active_interface
                                ? 'bg-[#06141B] border-[#D9B96E]/50'
                                : 'bg-[#06141B]/60 border-[#1C3945]'
                              : 'bg-rose-950/20 border-rose-900/40 text-rose-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <span className="font-semibold text-[#F2F0E8] flex items-center gap-1.5">
                              {target.label || target.node} ({target.interface})
                              {target.interface === egressStatus.active_interface && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#D9B96E]/20 text-[#D9B96E] border border-[#D9B96E]/40 font-mono">
                                  АКТИВЕН
                                </span>
                              )}
                              {target.is_frozen && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 font-mono">
                                  ❄️ ЗАВИС
                                </span>
                              )}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                target.available
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {target.available ? `ДОСТУПЕН (${target.passed_checks ?? 5}/${target.total_checks ?? 5})` : 'СБОЙ КВОРУМА'}
                            </span>
                          </div>

                          {/* Micro-badges for checks */}
                          {target.checks && target.checks.length > 0 && (
                            <div className="flex items-center justify-between flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-[#1C3945]/60 text-[10px]">
                              <div className="flex flex-wrap gap-1">
                                {target.checks.map((c) => (
                                  <span
                                    key={c.name}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-0.5 ${
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
                              {target.handshake_age_sec !== undefined && target.handshake_age_sec > 0 && (
                                <span className={`text-[10px] font-mono ${target.is_frozen ? 'text-cyan-400 font-bold' : 'text-[#718187]'}`}>
                                  {target.handshake_age_sec < 60
                                    ? `${target.handshake_age_sec}с`
                                    : `${Math.round(target.handshake_age_sec / 60)}м`}
                                </span>
                              )}
                            </div>
                          )}

                          {!target.available && target.reason && (
                            <div className="text-[11px] text-rose-400 font-sans mt-1 leading-snug">
                              {target.reason}
                            </div>
                          )}

                          {target.recommendation && (
                            <div className="mt-1.5 p-1.5 bg-cyan-950/30 border border-cyan-600/40 rounded-lg text-[10px] text-cyan-200">
                              <span className="font-semibold text-cyan-300">Рекомендация: </span>
                              <code className="text-[#D9B96E] font-mono select-all text-[9px]">{target.recommendation}</code>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Switch Target Options */}
                  <div>
                    <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-2">
                      Выберите целевой шлюз выхода:
                    </label>
                    <select
                      value={targetEgressIf}
                      onChange={(e) => setTargetEgressIf(e.target.value)}
                      disabled={switchingEgress}
                      className="w-full p-3 rounded-xl bg-[#06141B] border border-[#1C3945] text-[#F2F0E8] text-sm focus:outline-none focus:border-[#D9B96E]"
                    >
                      {(egressStatus.targets || []).map((target) => (
                        <option key={target.interface} value={target.interface} disabled={!target.available}>
                          {target.label} ({target.interface}){target.interface === egressStatus.active_interface ? ' — текущий' : ''}{!target.available ? ` — ${target.reason || 'недоступен'}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#102833]/60 border border-[#1C3945] text-xs text-[#A8B4B7] font-sans leading-relaxed">
                    Выбранный выход будет проверен перед переключением. При ошибке прежний маршрут восстановится. Ключи сохранятся; действующим соединениям может потребоваться переподключение.
                  </div>
                </div>
              ) : (
                <div className="py-4 text-xs sm:text-sm text-rose-400 font-mono">
                  Не удалось получить статус Egress с узла.
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEgressNode(null)}
                  disabled={switchingEgress}
                  className="px-4 py-2 text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Закрыть
                </button>
                <button
                  type="submit"
                  disabled={
                    switchingEgress ||
                    loadingEgress ||
                    !egressStatus ||
                    targetEgressIf === egressStatus?.active_interface ||
                    !egressStatus?.targets?.some((t) => t.interface === targetEgressIf && t.available)
                  }
                  className="px-5 py-2.5 text-xs font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>{switchingEgress ? 'Переключение...' : `Переключить на ${targetEgressIf}`}</span>
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* Telegram Settings Modal */}
      <TelegramSettingsModal
        isOpen={showTelegramSettingsModal}
        onClose={() => setShowTelegramSettingsModal(false)}
        onSaved={() => fetchNodes(false, true)}
      />
    </div>
  );
}
