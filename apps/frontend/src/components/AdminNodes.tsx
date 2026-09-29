import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
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
} from 'lucide-react';
import { api } from '../api/client';
import { AdminNode, EgressStatusResponse, TelegramStatusResponse } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { TelegramSettingsModal } from './TelegramSettingsModal';

import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';
import { COUNTRIES, formatNodeRouting, getCountryInfo } from '../utils/country';

export function AdminNodes() {
  const { toast } = useToast();
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  // Telegram status state
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusResponse | null>(null);
  const [isSendingTestAlert, setIsSendingTestAlert] = useState(false);
  const [showTelegramSettingsModal, setShowTelegramSettingsModal] = useState(false);

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
      setTargetEgressIf(status.active_interface === 'awg1' ? 'awg3' : 'awg1');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка получения данных Egress');
    } finally {
      setLoadingEgress(false);
    }
  };

  const handleSwitchEgressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!egressNode || !targetEgressIf) return;
    try {
      setSwitchingEgress(true);
      const res = await api.switchNodeEgress(egressNode.id, targetEgressIf);
      toast.success(res.message || `Шлюз выхода каскада переключен на ${targetEgressIf}`);
      const updated = await api.getNodeEgress(egressNode.id);
      setEgressStatus(updated);
      setTargetEgressIf(updated.active_interface === 'awg1' ? 'awg3' : 'awg1');
      fetchNodes(false, true);
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
        nodeBackup
      );
      setName('');
      setCountryCode('NLD');
      setProviderUrl('');
      setApiUrl('');
      setApiKey('');
      setIsMobileOptimized(false);
      setIsBackup(false);
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

    // Optimistic local state update
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

  if (loading) {
    return <Loader size="section" text="Опрос и получение списка Slave-серверов..." />;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#F2F0E8] flex items-center space-x-2">
            <Server className="w-5 h-5 text-[#D9B96E]" />
            <span>Управление Slave-нодами AmneziaWG</span>
          </h3>
          <p className="text-sm text-[#A8B4B7] mt-1 font-sans">
            Подключение и редактирование серверов AWG (Каскад M0 $\to$ S1 или автономных S2) с привязкой локации (Флаг + Код) и быстрым переходом к панели VPS.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => fetchNodes(true)}
            disabled={isChecking}
            className="flex items-center space-x-1.5 text-sm font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#A8B4B7] hover:text-[#F2F0E8] px-3.5 py-2.5 rounded-xl border border-[#1C3945] transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin text-[#D9B96E]' : ''}`} />
            <span>{isChecking ? 'Проверка...' : 'Health Check'}</span>
          </button>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center space-x-1.5 text-sm font-mono font-bold uppercase tracking-wider bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] px-4 py-2.5 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить Сервер</span>
          </button>
        </div>
      </div>

      {/* Telegram Bot Alert Status Card */}
      <div className="bg-[#0B1E28] border border-[#1C3945] rounded-2xl p-4 sm:p-5 mb-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#102833] border border-[#D9B96E]/30 flex items-center justify-center flex-shrink-0 text-[#D9B96E] shadow-md shadow-[#D9B96E]/10">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5 flex-wrap">
                <span className="font-serif font-bold text-[#F2F0E8] text-base">
                  Оповещения в Telegram
                </span>
                {telegramStatus?.bot_username ? (
                  <span className="text-xs font-mono text-[#D9B96E] bg-[#102833] px-2 py-0.5 rounded-md border border-[#1C3945]">
                    @{telegramStatus.bot_username}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-[#718187] bg-[#102833] px-2 py-0.5 rounded-md border border-[#1C3945]">
                    Не настроен
                  </span>
                )}
                {telegramStatus?.enabled ? (
                  <span className="inline-flex items-center space-x-1 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Бот активен</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                    <span>Токен не задан</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#A8B4B7] mt-1">
                Мгновенные уведомления о сбоях серверов, восстановлении работы и регистрации новых пользователей.
                {telegramStatus?.total_subscribers ? (
                  <span className="text-[#D9B96E] ml-1 font-semibold">
                    (Подключено получателей: {telegramStatus.total_subscribers})
                  </span>
                ) : (
                  <span className="text-amber-300 ml-1">
                    Откройте бота и отправьте <code className="text-[#F2F0E8]">/start</code> для подписки.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 flex-wrap sm:flex-nowrap">
            <button
              onClick={() => setShowTelegramSettingsModal(true)}
              className="flex items-center space-x-1.5 text-xs font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#D9B96E] hover:text-[#F0D48D] px-3.5 py-2 rounded-xl border border-[#1C3945] transition cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Настройки бота</span>
            </button>

            {telegramStatus?.bot_username ? (
              <a
                href={`https://t.me/${telegramStatus.bot_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1.5 text-xs font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#A8B4B7] hover:text-[#F2F0E8] px-3.5 py-2 rounded-xl border border-[#1C3945] transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Открыть бота</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            ) : null}

            <button
              onClick={handleSendTelegramTestAlert}
              disabled={isSendingTestAlert || !telegramStatus?.enabled}
              className="flex items-center space-x-1.5 text-xs font-mono uppercase tracking-wider bg-[#163645] hover:bg-[#1E485D] text-[#F2F0E8] px-3.5 py-2 rounded-xl border border-[#2A5266] transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <BellRing className={`w-3.5 h-3.5 ${isSendingTestAlert ? 'animate-bounce text-[#D9B96E]' : ''}`} />
              <span>{isSendingTestAlert ? 'Отправка...' : 'Тест алерта'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAddNode} className="bg-[#102833] border border-[#D9B96E]/40 rounded-2xl p-6 mb-6 shadow-2xl space-y-4">
          <h4 className="font-serif text-lg font-bold text-[#F2F0E8]">Параметры нового Slave API</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                Название сервера
              </label>
              <input
                type="text"
                placeholder="например: Амстердам Каскад M0->S1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                Тип соединения
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'cascade' | 'direct')}
                className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none"
              >
                <option value="cascade">Каскад (Cascade M0 $\to$ S1)</option>
                <option value="direct">Прямой туннель (Direct S2)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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
              <span className="text-sm text-[#D9B96E] font-mono mt-1.5 block">
                {type === 'cascade'
                  ? `Маршрут: 🇷🇺 RUS ➔ ${getCountryInfo(countryCode)?.flag || '🌐'} ${countryCode.toUpperCase()}`
                  : `Маршрут: ${getCountryInfo(countryCode)?.flag || '🌐'} ${countryCode.toUpperCase()}`}
              </span>
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                API URL (Slave Endpoint)
              </label>
              <input
                type="text"
                placeholder="например: https://s1.vpn.test или http://127.0.0.1:8081"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                Секретный API Key (X-API-Key)
              </label>
              <input
                type="password"
                placeholder="Сгенерированный при запуске Slave ключ"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                Адрес VPS провайдера (Панель / Биллинг)
              </label>
              <input
                type="text"
                placeholder="например: https://aeza.net или https://hetzner.com"
                value={providerUrl}
                onChange={(e) => setProviderUrl(e.target.value)}
                className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono placeholder-[#718187]"
              />
              <span className="text-sm text-[#718187] font-mono mt-1.5 block">
                Для быстрого перехода к оплате и контролю VPS
              </span>
            </div>
          </div>

          {/* Mobile Optimization Checkbox */}
          <div
            onClick={() => setIsMobileOptimized(!isMobileOptimized)}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
              isMobileOptimized
                ? 'border-[#D9B96E] bg-[#06141B] shadow-lg shadow-[#D9B96E]/10'
                : 'border-[#1C3945] bg-[#06141B]/60 hover:border-[#1C3945]/80'
            }`}
          >
            <div className="flex items-start">
              <input
                type="checkbox"
                checked={isMobileOptimized}
                onChange={(e) => setIsMobileOptimized(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer"
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-serif font-bold text-sm text-[#F2F0E8]">
                    Оптимизирован для мобильных сетей (--mobile / 443 UDP)
                  </span>
                  <span className="text-sm font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30">
                    LTE / 5G
                  </span>
                </div>
                <p className="text-sm text-[#A8B4B7] mt-1 font-sans leading-relaxed">
                  Отмечает данный сервер как использующий порт <code className="text-[#D9B96E] font-mono text-sm">443/UDP</code> и мобильный пресет обфускации. Рекомендуется для обхода жестких блокировок мобильных операторов.
                </p>
              </div>
            </div>
          </div>

          {/* Backup / Reserve PRO Server Checkbox */}
          <div
            onClick={() => setIsBackup(!isBackup)}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
              isBackup
                ? 'border-[#D9B96E] bg-[#06141B] shadow-lg shadow-[#D9B96E]/10'
                : 'border-[#1C3945] bg-[#06141B]/60 hover:border-[#1C3945]/80'
            }`}
          >
            <div className="flex items-start">
              <input
                type="checkbox"
                checked={isBackup}
                onChange={(e) => setIsBackup(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer"
              />
              <div className="ml-3 flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-serif font-bold text-sm text-[#F2F0E8]">
                    Запасной сервер (доступен только для тарифа PRO)
                  </span>
                  <span className="text-sm font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40">
                    PRO
                  </span>
                </div>
                <p className="text-sm text-[#A8B4B7] mt-1 font-sans leading-relaxed">
                  Отмечает данный сервер как резервный. Ключи на этом сервере смогут выпускать только пользователи с активным тарифом PRO.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#06141B]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-sm font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition"
            >
              {submitting ? 'Сохранение...' : 'Сохранить и подключить'}
            </button>
          </div>
        </form>
      )}

      {/* Nodes Table */}
      <div className="overflow-x-auto border border-[#1C3945] rounded-2xl bg-[#06141B]/60 shadow-xl">
        <table className="w-full text-left text-sm text-[#F2F0E8] min-w-[760px]">
          <thead className="bg-[#102833]/90 text-sm font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
            <tr>
              <th className="px-5 py-3.5">Статус / Ping</th>
              <th className="px-5 py-3.5">Маршрут / Страна</th>
              <th className="px-5 py-3.5">Название</th>
              <th className="px-5 py-3.5">API URL</th>
              <th className="px-5 py-3.5">VPS Провайдер</th>
              <th className="px-5 py-3.5">Добавлен</th>
              <th className="px-5 py-3.5 text-right">Действия & Сервис</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C3945]/70 bg-[#0A1D26]/40 font-sans">
            {(nodes || []).map((node) => {
              const routing = formatNodeRouting(node.type, node.country_code);
              return (
                <tr key={node.id} className="hover:bg-[#102833]/50 transition duration-150">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`inline-flex items-center space-x-1.5 text-sm font-mono font-semibold px-2.5 py-0.5 rounded-full ${
                          node.online
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                            : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                        }`}
                      >
                        {node.online ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        <span>{node.online ? 'Online' : 'Offline'}</span>
                      </span>
                      {node.online && typeof node.latency_ms === 'number' && (
                        <span className="text-sm font-mono font-semibold px-2 py-0.5 rounded-md bg-[#102833] text-emerald-300 border border-[#1C3945]">
                          {node.latency_ms} ms
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Route & Country (Flag + 3 letters) */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`text-sm font-mono font-bold tracking-wider px-2.5 py-1 rounded-lg border flex items-center space-x-1 shadow-sm ${
                          node.type === 'cascade'
                            ? 'bg-amber-950/80 text-amber-300 border-amber-600/40'
                            : 'bg-[#102833] text-[#6EA8C4] border-[#6EA8C4]/40'
                        }`}
                        title={
                          node.type === 'cascade'
                            ? `Каскадная маршрутизация: РФ ➔ ${getCountryInfo(node.country_code)?.name || node.country_code || 'Зарубеж'}`
                            : `Прямой туннель: ${getCountryInfo(node.country_code)?.name || node.country_code || 'Зарубеж'}`
                        }
                      >
                        {routing.prefix && <span>{routing.prefix}</span>}
                        {routing.arrow && <span className="text-[#D9B96E] font-bold">{routing.arrow}</span>}
                        <span>{routing.targetFlag}</span>
                        <span>{routing.targetCode}</span>
                      </span>
                    </div>
                  </td>

                  {/* Name & Mobile / Backup Tags */}
                  <td className="px-5 py-3.5 font-medium text-[#F2F0E8]">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-semibold text-sm">{node.name}</span>
                      {node.is_backup && (
                        <span
                          className="inline-flex items-center space-x-1 bg-purple-950/80 text-purple-300 border border-purple-600/40 text-xs font-mono px-2 py-0.5 rounded-full font-bold shadow-sm"
                          title="Запасной сервер — доступен только для тарифа PRO"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                          <span>Запасной (PRO)</span>
                        </span>
                      )}
                      {node.is_mobile_optimized && (
                        <span
                          className="inline-flex items-center space-x-1 bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 text-xs font-mono px-2 py-0.5 rounded-full font-bold"
                          title="Оптимизирован для мобильных сетей (--mobile 443/UDP)"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>443 LTE</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* API URL */}
                  <td className="px-5 py-3.5 text-sm font-mono text-[#A8B4B7]">{node.api_url}</td>

                  {/* Provider URL Note / Quick Link */}
                  <td className="px-5 py-3.5 text-sm font-mono">
                    {node.provider_url ? (
                      <a
                        href={formatUrl(node.provider_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Открыть панель управления / биллинг VPS (${node.provider_url})`}
                        className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] hover:border-[#D9B96E]/50 text-[#6EA8C4] hover:text-[#F0D48D] transition text-sm"
                      >
                        <Globe className="w-3.5 h-3.5 text-[#D9B96E]" />
                        <span className="font-medium max-w-[120px] truncate">{getDomainFromUrl(node.provider_url)}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-[#718187]" />
                      </a>
                    ) : (
                      <span className="text-[#718187] text-sm">—</span>
                    )}
                  </td>

                  {/* Added Date */}
                  <td className="px-5 py-3.5 text-sm text-[#718187] font-mono">
                    {new Date(node.created_at).toLocaleDateString()}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end space-x-1.5">
                      {/* Egress Switcher (Only for Cascade nodes) */}
                      {node.type === 'cascade' && (
                        <Tooltip content="Управление шлюзом выхода каскада (Egress: S1 ↔ S2)">
                          <button
                            onClick={() => handleOpenEgress(node)}
                            aria-label="Управление шлюзом выхода каскада"
                            className="p-2 rounded-xl border border-[#D9B96E]/50 bg-[#102833]/80 text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition shadow-sm"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}

                      {/* Edit Node */}
                      <Tooltip content="Редактировать параметры сервера">
                        <button
                          onClick={() => handleOpenEdit(node)}
                          aria-label="Редактировать параметры сервера"
                          className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </Tooltip>

                      {/* Restart Service */}
                      <Tooltip content="Перезапустить службу AmneziaWG">
                        <button
                          onClick={() => setRestartingNode(node)}
                          aria-label="Перезапустить службу AmneziaWG"
                          className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] hover:text-[#F0D48D] transition"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </Tooltip>

                      {/* Backup */}
                      <Tooltip content="Экспорт резервной копии (Backup)">
                        <button
                          onClick={() => handleBackupClick(node)}
                          disabled={isBackingUp}
                          aria-label="Экспорт резервной копии"
                          className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#6EA8C4] hover:bg-[#1C3945] hover:text-[#A8B4B7] transition disabled:opacity-50"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </Tooltip>

                      {/* Restore */}
                      <Tooltip content="Восстановить из копии (Restore)">
                        <button
                          onClick={() => setRestoringNode(node)}
                          aria-label="Восстановить из копии"
                          className="p-2 rounded-xl border border-[#1C3945] bg-[#102833]/80 text-[#A8B4B7] hover:bg-[#1C3945] hover:text-[#F2F0E8] transition"
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                      </Tooltip>

                      {/* Delete */}
                      <Tooltip content="Удалить сервер">
                        <button
                          onClick={() => setNodeToDelete(node)}
                          aria-label="Удалить сервер"
                          className="p-2 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(nodes || []).length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-[#718187] text-sm font-mono uppercase tracking-wider">
                  Нет подключенных Slave-серверов.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Тип соединения
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as 'cascade' | 'direct')}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] focus:outline-none"
                  >
                    <option value="cascade">Каскад (Cascade M0 $\to$ S1)</option>
                    <option value="direct">Прямой туннель (Direct S2)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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
                  <span className="text-sm text-[#D9B96E] font-mono mt-1.5 block">
                    {editType === 'cascade'
                      ? `Маршрут: 🇷🇺 RUS ➔ ${getCountryInfo(editCountryCode)?.flag || '🌐'} ${editCountryCode.toUpperCase()}`
                      : `Маршрут: ${getCountryInfo(editCountryCode)?.flag || '🌐'} ${editCountryCode.toUpperCase()}`}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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
                  <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
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

              {/* Mobile Optimization Checkbox */}
              <div
                onClick={() => setEditIsMobileOptimized(!editIsMobileOptimized)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                  editIsMobileOptimized
                    ? 'border-[#D9B96E] bg-[#06141B] shadow-lg shadow-[#D9B96E]/10'
                    : 'border-[#1C3945] bg-[#06141B]/60 hover:border-[#1C3945]/80'
                }`}
              >
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    checked={editIsMobileOptimized}
                    onChange={(e) => setEditIsMobileOptimized(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-serif font-bold text-sm text-[#F2F0E8]">
                        Оптимизирован для мобильных сетей (--mobile / 443 UDP)
                      </span>
                      <span className="text-sm font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30">
                        LTE / 5G
                      </span>
                    </div>
                    <p className="text-sm text-[#A8B4B7] mt-1 font-sans leading-relaxed">
                      Отмечает данный сервер как использующий порт <code className="text-[#D9B96E] font-mono text-sm">443/UDP</code>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Backup / Reserve PRO Server Checkbox */}
              <div
                onClick={() => setEditIsBackup(!editIsBackup)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                  editIsBackup
                    ? 'border-[#D9B96E] bg-[#06141B] shadow-lg shadow-[#D9B96E]/10'
                    : 'border-[#1C3945] bg-[#06141B]/60 hover:border-[#1C3945]/80'
                }`}
              >
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    checked={editIsBackup}
                    onChange={(e) => setEditIsBackup(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-serif font-bold text-sm text-[#F2F0E8]">
                        Запасной сервер (доступен только для тарифа PRO)
                      </span>
                      <span className="text-sm font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40">
                        PRO
                      </span>
                    </div>
                    <p className="text-sm text-[#A8B4B7] mt-1 font-sans leading-relaxed">
                      Резервный сервер для повышенной отказоустойчивости (только для тарифа PRO).
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingNode(null)}
                  className="px-4 py-2 text-sm font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#06141B]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isEditingSubmitting}
                  className="px-5 py-2.5 text-sm font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50"
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
                <button onClick={() => setBackupNodeState(null)} className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[#A8B4B7]">
                Архив конфигураций клиентов и ключей с ноды{' '}
                <strong className="text-[#F2F0E8]">«{backupNodeState.node.name}»</strong> от{' '}
                <span className="font-mono text-emerald-400">{new Date(backupNodeState.timestamp).toLocaleString()}</span>.
              </p>
              <div className="bg-[#06141B] p-3 rounded-xl border border-[#1C3945] font-mono text-sm text-[#A8B4B7] max-h-36 overflow-y-auto break-all select-all">
                {backupNodeState.data}
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadBackupFile}
                  className="flex items-center space-x-2 px-5 py-2.5 text-sm font-mono font-bold uppercase bg-gradient-to-r from-[#6EA8C4] to-[#407B98] text-[#06141B] rounded-xl shadow-lg transition"
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
                <button type="button" onClick={() => setRestoringNode(null)} className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-[#A8B4B7]">
                Загрузите или вставьте архив резервной копии для развертывания на ноде{' '}
                <strong className="text-[#F2F0E8]">«{restoringNode.name}»</strong>.
              </p>
              <div>
                <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                  Загрузить из файла (.bak)
                </label>
                <input
                  type="file"
                  accept=".bak,.txt,.json"
                  onChange={handleRestoreFileUpload}
                  className="block w-full text-sm text-[#A8B4B7] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-mono file:bg-[#102833] file:text-[#D9B96E] hover:file:bg-[#1C3945]"
                />
              </div>
              <div>
                <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                  Или вставьте данные архива:
                </label>
                <textarea
                  rows={4}
                  value={restoreData}
                  onChange={(e) => setRestoreData(e.target.value)}
                  placeholder="Вставьте base64 строку резервной копии..."
                  className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl p-3 text-sm text-[#F2F0E8] focus:outline-none font-mono"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRestoringNode(null)}
                  disabled={isRestoring}
                  className="px-4 py-2 text-sm font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isRestoring || !restoreData.trim()}
                  className="px-5 py-2.5 text-sm font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50"
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
                <button type="button" onClick={() => setEgressNode(null)} className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-[#A8B4B7] font-sans">
                Узел <strong className="text-[#F2F0E8]">«{egressNode.name}»</strong>. Переключение шлюза зарубежного выхода на лету без изменения клиентских ключей.
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
                          {egressStatus.active_interface === 'awg1' ? 'awg1 — Выход через S1 (Германия)' : 'awg3 — Выход через S2 (Нидерланды)'}
                        </span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                        Active Egress
                      </span>
                    </div>
                  </div>

                  {/* Switch Target Options */}
                  <div>
                    <label className="block text-sm font-mono font-semibold text-[#A8B4B7] uppercase mb-2">
                      Выберите целевой шлюз выхода:
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setTargetEgressIf('awg1')}
                        className={`p-3.5 rounded-2xl border text-left transition flex flex-col justify-between space-y-1 ${
                          targetEgressIf === 'awg1'
                            ? 'bg-[#102833] border-[#D9B96E] text-[#F2F0E8] shadow-md shadow-[#D9B96E]/10 ring-1 ring-[#D9B96E]'
                            : 'bg-[#06141B] border-[#1C3945] text-[#A8B4B7] hover:border-[#1C3945]/80'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-sm">🇩🇪 Шлюз S1</span>
                          {egressStatus.active_interface === 'awg1' && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                              Текущий
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[#A8B4B7] font-mono">dev awg1 (Германия)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTargetEgressIf('awg3')}
                        className={`p-3.5 rounded-2xl border text-left transition flex flex-col justify-between space-y-1 ${
                          targetEgressIf === 'awg3'
                            ? 'bg-[#102833] border-[#D9B96E] text-[#F2F0E8] shadow-md shadow-[#D9B96E]/10 ring-1 ring-[#D9B96E]'
                            : 'bg-[#06141B] border-[#1C3945] text-[#A8B4B7] hover:border-[#1C3945]/80'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-sm">🇳🇱 Шлюз S2</span>
                          {egressStatus.active_interface === 'awg3' && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                              Текущий
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[#A8B4B7] font-mono">dev awg3 (Нидерланды)</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#102833]/60 border border-[#1C3945] text-xs text-[#A8B4B7] font-sans leading-relaxed">
                    ℹ️ Маршрут будет мгновенно заменен в таблице 100 ядра Linux. Подключенные клиенты на смартфонах и ПК продолжат работать без необходимости перевыпускать конфигурации.
                  </div>
                </div>
              ) : (
                <div className="py-4 text-sm text-rose-400 font-mono">
                  Не удалось получить статус Egress с узла.
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEgressNode(null)}
                  disabled={switchingEgress}
                  className="px-4 py-2 text-sm font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833]"
                >
                  Закрыть
                </button>
                <button
                  type="submit"
                  disabled={switchingEgress || loadingEgress || !egressStatus || targetEgressIf === egressStatus?.active_interface}
                  className="px-5 py-2.5 text-sm font-mono font-bold uppercase bg-gradient-to-r from-[#F0D48D] to-[#D9B96E] text-[#06141B] rounded-xl shadow-lg transition disabled:opacity-50 flex items-center space-x-1.5"
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


