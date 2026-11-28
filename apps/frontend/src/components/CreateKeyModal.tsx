import { useState } from 'react';
import { animatedPortal as createPortal } from './animatedPortal';
import {
  X,
  Plus,
  Zap,
  ShieldCheck,
  Smartphone,
  HelpCircle,
  Sparkles,
  Eye,
  Check,
} from 'lucide-react';
import { User, NodePublic, ProtocolType } from '../types';
import { formatNodeRouting, getCountryFlag } from '../utils/country';
import { MascotModalCompanion, MascotFaqModal } from './MascotAssistant';

interface Props {
  nodes: NodePublic[];
  currentUser?: User | null;
  onClose: () => void;
  onCreate: (nodeId: number, deviceName: string, psk: boolean, protocol?: ProtocolType) => Promise<void>;
}

interface ProtocolMeta {
  type: ProtocolType;
  title: string;
  badge: string;
  shortDesc: string;
  icon: typeof ShieldCheck;
  iconColor: string;
  activeBorder: string;
  activeBg: string;
  badgeBg: string;
  badgeColor: string;
}

const PROTOCOLS: ProtocolMeta[] = [
  {
    type: 'awg',
    title: 'AmneziaWG',
    badge: 'Рекомендуется',
    shortDesc: 'Фирменный AWG с маскировкой заголовков. Универсален для всех устройств.',
    icon: ShieldCheck,
    iconColor: 'text-[#D9B96E]',
    activeBorder: 'border-[#D9B96E]',
    activeBg: 'bg-[#102833]',
    badgeBg: 'bg-[#06141B]',
    badgeColor: 'text-[#D9B96E]',
  },
  {
    type: 'hysteria2',
    title: 'Hysteria 2',
    badge: 'Ультра-скорость',
    shortDesc: 'Скоростной UDP на базе QUIC. Высокая скорость для видео 4K и стриминга.',
    icon: Zap,
    iconColor: 'text-purple-400',
    activeBorder: 'border-purple-400',
    activeBg: 'bg-purple-950/30',
    badgeBg: 'bg-purple-950/80',
    badgeColor: 'text-purple-300',
  },
  {
    type: 'mieru',
    title: 'Mieru',
    badge: 'Скрытный TCP',
    shortDesc: 'Скрытный TCP-протокол обхода блокировок. Надежен при фильтрации UDP.',
    icon: Eye,
    iconColor: 'text-emerald-400',
    activeBorder: 'border-emerald-400',
    activeBg: 'bg-emerald-950/30',
    badgeBg: 'bg-emerald-950/80',
    badgeColor: 'text-emerald-300',
  },
  {
    type: 'vless',
    title: 'VLESS+Reality',
    badge: 'Direct Reality',
    shortDesc: 'Прямой туннель с TLS-мимикрией под реальные зарубежные сайты.',
    icon: Sparkles,
    iconColor: 'text-sky-400',
    activeBorder: 'border-sky-400',
    activeBg: 'bg-sky-950/30',
    badgeBg: 'bg-sky-950/80',
    badgeColor: 'text-sky-300',
  },
];

export function isNodeProtocolSupported(node: NodePublic, proto: ProtocolType): boolean {
  switch (proto) {
    case 'awg':
      return true;
    case 'hysteria2':
      return Boolean(node.has_hysteria);
    case 'mieru':
      return Boolean(node.has_mieru);
    case 'vless':
      return Boolean(node.has_vless && node.type === 'direct');
    default:
      return true;
  }
}

export function getProtocolDisplayName(proto: ProtocolType): string {
  const meta = PROTOCOLS.find((p) => p.type === proto);
  return meta ? meta.title : proto.toUpperCase();
}

const DEVICE_SUGGESTIONS = ['iPhone', 'Android', 'MacBook', 'Windows', 'Роутер'];

export function CreateKeyModal({ nodes, currentUser, onClose, onCreate }: Props) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const isUserProOrAdmin = Boolean(currentUser?.is_pro || currentUser?.role === 'admin');

  const mobileOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 'iPhone'
    : /Android/i.test(navigator.userAgent)
      ? 'Android'
      : '';

  const [protocol, setProtocol] = useState<ProtocolType>('awg');

  const findBestNode = (proto: ProtocolType, preferredId?: number): number => {
    if (preferredId) {
      const current = safeNodes.find((n) => n.id === preferredId);
      if (
        current &&
        !current.is_blocked &&
        isNodeProtocolSupported(current, proto) &&
        (!current.is_backup || isUserProOrAdmin)
      ) {
        return current.id;
      }
    }

    if (mobileOS) {
      const mobileOptimized = safeNodes.find(
        (n) =>
          !n.is_blocked &&
          n.is_mobile_optimized &&
          isNodeProtocolSupported(n, proto) &&
          (!n.is_backup || isUserProOrAdmin)
      );
      if (mobileOptimized) return mobileOptimized.id;
    }

    const availableStandard = safeNodes.find(
      (n) =>
        !n.is_blocked &&
        isNodeProtocolSupported(n, proto) &&
        (!n.is_backup || isUserProOrAdmin)
    );
    if (availableStandard) return availableStandard.id;

    const anyUnblocked = safeNodes.find(
      (n) => !n.is_blocked && isNodeProtocolSupported(n, proto)
    );
    if (anyUnblocked) return anyUnblocked.id;

    const anySupported = safeNodes.find((n) => isNodeProtocolSupported(n, proto));
    return anySupported?.id || safeNodes[0]?.id || 0;
  };

  const [selectedNodeId, setSelectedNodeId] = useState<number>(() =>
    findBestNode('awg')
  );

  const [deviceName, setDeviceName] = useState<string>(mobileOS || 'Моё устройство');
  const [psk, setPsk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFaq, setShowFaq] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Record<number, boolean>>({});
  const [showPskInfo, setShowPskInfo] = useState(false);

  const hasBackupNodes = safeNodes.some((n) => n.is_backup);

  const toggleNodeInfo = (nodeId: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedNodeIds((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const handleDeviceNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDeviceName(e.target.value.slice(0, 64));
  };

  const handleProtocolChange = (newProto: ProtocolType) => {
    setProtocol(newProto);
    setError(null);

    const bestId = findBestNode(newProto, selectedNodeId);
    setSelectedNodeId(bestId);

    const targetNode = safeNodes.find((n) => n.id === bestId);
    if (!targetNode || !isNodeProtocolSupported(targetNode, newProto)) {
      setError(
        `В кластере пока нет серверов с поддержкой протокола «${getProtocolDisplayName(
          newProto
        )}».`
      );
    }
  };

  const handleSelectNode = (node: NodePublic) => {
    if (!isNodeProtocolSupported(node, protocol)) {
      setError(
        `Сервер «${node.name}» не поддерживает протокол ${getProtocolDisplayName(
          protocol
        )}. Выберите другой сервер или протокол.`
      );
      return;
    }
    if (node.is_blocked) {
      setError(
        `Сервер «${node.name}» заблокирован: прямой доступ из РФ ограничен. Создание ключей временно приостановлено.`
      );
      return;
    }
    if (node.is_backup && !isUserProOrAdmin) {
      setError(`Сервер «${node.name}» является запасным и доступен только для тарифа PRO.`);
      return;
    }

    setError(null);
    setSelectedNodeId(node.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNodeId) {
      setError('Пожалуйста, выберите сервер');
      return;
    }

    const targetNode = safeNodes.find((n) => n.id === selectedNodeId);
    if (!targetNode) {
      setError('Выбранный сервер не найден');
      return;
    }

    if (!isNodeProtocolSupported(targetNode, protocol)) {
      setError(
        `Сервер «${targetNode.name}» не поддерживает протокол ${getProtocolDisplayName(
          protocol
        )}`
      );
      return;
    }

    if (targetNode.is_blocked) {
      setError('Выбранный сервер временно заблокирован для прямых подключений из РФ');
      return;
    }
    if (targetNode.is_backup && !isUserProOrAdmin) {
      setError('Выбранный сервер доступен только для тарифа PRO');
      return;
    }

    const cleanName = deviceName.trim();
    if (!cleanName) {
      setError('Пожалуйста, укажите имя устройства');
      return;
    }

    if (cleanName.length > 64) {
      setError('Название устройства должно быть не длиннее 64 символов');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onCreate(
        selectedNodeId,
        cleanName,
        protocol === 'awg' ? psk : false,
        protocol
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка создания ключа');
    } finally {
      setLoading(false);
    }
  };

  const selectedProtoMeta = PROTOCOLS.find((p) => p.type === protocol);

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-[#06141B]/90 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden">
      <div className="relative max-w-xl lg:max-w-2xl w-full my-auto flex flex-col items-center">
        {/* Mascot Character Standing to the Left on Desktop (lg+) */}
        <div className="hidden lg:block absolute right-[calc(100%+2rem)] xl:right-[calc(100%+3.5rem)] bottom-0 w-80">
          <MascotModalCompanion onClickFaq={() => setShowFaq(true)} />
        </div>

        {/* Modal Window Card */}
        <div className="w-full bg-[#0A1D26] border border-[#1C3945] hover:border-[#D9B96E]/40 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/90 flex flex-col max-h-[92dvh] sm:max-h-[90vh] overflow-hidden transition-all duration-300">
          
          {/* Sticky Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 pb-3 border-b border-[#1C3945]/70 shrink-0 bg-[#0A1D26]/95">
            <div className="flex items-center space-x-3 min-w-0 pr-4">
              <div className="bg-[#102833] p-2 sm:p-2.5 rounded-xl text-[#D9B96E] border border-[#1C3945] shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-serif text-lg sm:text-xl font-bold text-[#F2F0E8] tracking-wide truncate">
                  Подключить устройство
                </h3>
                <p className="text-xs text-[#8C9BA0] truncate">
                  Выберите протокол и сервер для создания профиля
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="text-[#A8B4B7] hover:text-[#F2F0E8] p-2 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition cursor-pointer shrink-0"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Form Body */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5">
            {error && (
              <div className="bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs sm:text-sm p-3.5 rounded-xl shadow-lg animate-in fade-in">
                {error}
              </div>
            )}

            {/* Mobile / Platform Guidance Banner */}
            <div className="rounded-2xl border border-[#D9B96E]/25 bg-[#102833]/70 p-3 sm:p-3.5 flex items-start gap-3">
              <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-[#D9B96E] shrink-0 mt-0.5" />
              <p className="text-xs sm:text-sm text-[#D9E1E3] leading-relaxed">
                {mobileOS
                  ? `Профиль для ${mobileOS === 'iPhone' ? 'iPhone / iPad' : 'Android-устройства'}. После создания скачайте файл и импортируйте его в приложение.`
                  : 'Создайте отдельный профиль для каждого устройства (компьютер, телефон или роутер).'}
              </p>
            </div>

            {/* Section: Device Name */}
            <div>
              <label
                className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider mb-1.5"
                htmlFor="device-name"
              >
                Название устройства
              </label>
              <input
                id="device-name"
                type="text"
                placeholder="Например, iPhone или Ноутбук"
                value={deviceName}
                onChange={handleDeviceNameChange}
                maxLength={64}
                className="w-full bg-[#0D222C] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 sm:py-3 text-sm sm:text-base text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:ring-1 focus:ring-[#D9B96E]/50 transition shadow-inner"
                required
              />

              {/* Quick Suggestion Chips */}
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <span className="text-[11px] text-[#718187] mr-1">Быстрый выбор:</span>
                {DEVICE_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setDeviceName(suggestion)}
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-lg border transition-all cursor-pointer ${
                      deviceName === suggestion
                        ? 'border-[#D9B96E] bg-[#102833] text-[#F0D48D]'
                        : 'border-[#1C3945]/70 bg-[#0D222C] text-[#8C9BA0] hover:text-[#D9E1E3] hover:border-[#1C3945]'
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 1: PROTOCOL SELECTION (BEFORE SERVER SELECTION) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider">
                    1. Выберите протокол
                  </label>
                  <p className="text-[11px] text-[#8C9BA0] mt-0.5">
                    Серверы ниже подстроятся под выбранный протокол
                  </p>
                </div>
              </div>

              {/* Responsive Protocol Grid (2 cols on mobile, 4 on desktop) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                {PROTOCOLS.map((p) => {
                  const isSelected = protocol === p.type;
                  const Icon = p.icon;

                  return (
                    <button
                      key={p.type}
                      type="button"
                      onClick={() => handleProtocolChange(p.type)}
                      className={`p-2.5 sm:p-3 rounded-2xl border text-left transition-all relative flex flex-col justify-between cursor-pointer ${
                        isSelected
                          ? `${p.activeBorder} ${p.activeBg} shadow-md shadow-black/50 ring-1 ring-inset ${p.activeBorder}`
                          : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <Icon className={`w-4 h-4 shrink-0 ${p.iconColor}`} />
                            <span className="font-serif font-bold text-xs sm:text-sm text-[#F2F0E8] truncate">
                              {p.title}
                            </span>
                          </div>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-[#D9B96E] text-[#06141B] flex items-center justify-center shrink-0">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>

                        <span
                          className={`text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md inline-block mb-1 ${p.badgeBg} ${p.badgeColor}`}
                        >
                          {p.badge}
                        </span>
                      </div>

                      <p className="text-[10px] sm:text-[11px] text-[#8C9BA0] leading-snug line-clamp-2 mt-1">
                        {p.shortDesc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: SERVER SELECTION */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider">
                    2. Выберите сервер
                  </label>
                  <p className="text-[11px] text-[#8C9BA0] mt-0.5">
                    Узлы для протокола <span className="text-[#F0D48D] font-medium">{selectedProtoMeta?.title}</span>
                  </p>
                </div>
              </div>

              {/* Informative Note for Backup / PRO Servers */}
              {hasBackupNodes && (
                <div className="mb-2.5 p-2.5 sm:p-3 rounded-xl bg-purple-950/30 border border-purple-800/40 text-xs text-[#A8B4B7] flex items-start space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
                  <p className="font-sans text-[11px] leading-relaxed text-[#A8B4B7]">
                    {isUserProOrAdmin
                      ? 'Вам доступны как основные, так и резервные серверы PRO.'
                      : 'Резервные серверы с повышенной стабильностью доступны на тарифе PRO.'}
                  </p>
                </div>
              )}

              {/* Server List (Clean Two-Row Mobile-First Layout Without Overlaps) */}
              <div className="space-y-2 sm:space-y-2.5">
                {safeNodes.map((node) => {
                  const isExpanded = !!expandedNodeIds[node.id];
                  const isSelected = selectedNodeId === node.id;
                  const isSupported = isNodeProtocolSupported(node, protocol);
                  const isNodeBlocked = Boolean(node.is_blocked);
                  const isProLocked = Boolean(node.is_backup) && !isUserProOrAdmin;
                  const isSelectable = isSupported && !isNodeBlocked && !isProLocked;
                  const routing = formatNodeRouting(node.type, node.country_code);
                  const flag = getCountryFlag(node.country_code);

                  return (
                    <div
                      key={node.id}
                      onClick={() => handleSelectNode(node)}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 select-none ${
                        !isSupported
                          ? 'opacity-40 bg-[#07141A]/70 border-[#142833] cursor-not-allowed'
                          : isNodeBlocked
                          ? 'opacity-55 bg-[#140b10] border-rose-900/40 hover:border-rose-700/50 cursor-pointer'
                          : isProLocked
                          ? 'opacity-60 bg-[#091820] border-[#1C3945]/60 hover:border-purple-800/50 cursor-pointer'
                          : isSelected
                          ? 'border-[#D9B96E] bg-[#102833] shadow-lg shadow-[#D9B96E]/10 cursor-pointer'
                          : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80 cursor-pointer'
                      }`}
                    >
                      {/* Row 1: Radio + Flag + Server Name + Info Button */}
                      <div className="flex items-start gap-2.5">
                        <div className="pt-0.5 shrink-0">
                          <input
                            type="radio"
                            name="node"
                            value={node.id}
                            checked={isSelected}
                            disabled={!isSelectable}
                            onChange={() => handleSelectNode(node)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 text-[#D9B96E] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer disabled:opacity-30"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-base sm:text-lg leading-none shrink-0" role="img" aria-label="country">
                                {flag}
                              </span>
                              <span
                                className={`font-serif font-bold text-sm sm:text-base leading-snug break-words ${
                                  !isSupported || isProLocked || isNodeBlocked
                                    ? 'text-[#8A989C]'
                                    : 'text-[#F2F0E8]'
                                }`}
                              >
                                {node.name}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => toggleNodeInfo(node.id, e)}
                              className="p-1 rounded-lg text-[#718187] hover:text-[#D9B96E] hover:bg-[#06141B] transition shrink-0 cursor-pointer"
                              title={isExpanded ? 'Скрыть пояснение' : 'Показать пояснение о сервере'}
                            >
                              <HelpCircle
                                className={`w-4 h-4 sm:w-4.5 sm:h-4.5 ${
                                  isExpanded ? 'text-[#D9B96E]' : 'text-[#718187]'
                                }`}
                              />
                            </button>
                          </div>

                          {/* Row 2: Badges row with wrap & gap (Prevents collision on narrow screens) */}
                          <div className="flex items-center flex-wrap gap-1.5 mt-2">
                            {/* If protocol is NOT supported on this node */}
                            {!isSupported && (
                              <span className="inline-flex items-center text-[10px] sm:text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-[#16222A] text-[#8A989C] border border-[#223540]">
                                Нет {selectedProtoMeta?.title}
                              </span>
                            )}

                            {/* If blocked */}
                            {isNodeBlocked && (
                              <span
                                className="inline-flex items-center text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-500/50 shrink-0"
                                title="Прямой доступ к IP заблокирован из РФ"
                              >
                                🚫 Заблокирован
                              </span>
                            )}

                            {/* If backup node */}
                            {node.is_backup && (
                              <span
                                className="inline-flex items-center space-x-1 text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40 shrink-0"
                                title={isUserProOrAdmin ? 'Запасной сервер PRO' : 'Доступен только для тарифа PRO'}
                              >
                                <Sparkles className="w-3 h-3 text-purple-300" />
                                <span>{isUserProOrAdmin ? 'Запасной (PRO)' : 'Только PRO'}</span>
                              </span>
                            )}

                            {/* Routing Badge */}
                            <span
                              className={`text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                                node.type === 'cascade'
                                  ? 'bg-amber-950/70 text-amber-300 border border-amber-600/40'
                                  : 'bg-[#06141B] text-[#6EA8C4] border border-[#6EA8C4]/40'
                              }`}
                            >
                              {routing.fullText}
                            </span>

                            {/* LTE / Mobile optimized */}
                            {node.is_mobile_optimized && (
                              <span
                                className="inline-flex items-center space-x-1 text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#06141B] text-[#D9B96E] border border-[#D9B96E]/40 shrink-0"
                                title="Оптимизирован для мобильных сетей"
                              >
                                <Smartphone className="w-3 h-3" />
                                <span>LTE</span>
                              </span>
                            )}
                          </div>

                          {/* Expandable Info Block */}
                          {isExpanded && (
                            <div className="mt-2.5 pt-2.5 border-t border-[#1C3945]/60 text-xs text-[#A8B4B7] font-sans leading-relaxed animate-in fade-in duration-150">
                              {node.is_backup && (
                                <p className="text-purple-300 mb-1 font-medium">
                                  Резервный сервер. Доступен на тарифе PRO.
                                </p>
                              )}
                              {node.type === 'cascade' ? (
                                <p>Двухкаскадный маршрут: вход через российский шлюз M0 и выход через защищенный зарубежный узел.</p>
                              ) : (
                                <p>Прямое подключение к зарубежному серверу без промежуточного каскада.</p>
                              )}
                              {node.is_mobile_optimized && (
                                <p className="text-[#F0D48D] mt-1 font-medium">
                                  Оптимизирован для сотовых операторов (порт 443 / UDP).
                                </p>
                              )}
                              {!isSupported && (
                                <p className="text-rose-300/90 mt-1">
                                  На этом сервере не развернут сервис {selectedProtoMeta?.title}.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SHADOWROCKET / PSK OPTION (Only applicable for AmneziaWG) */}
            {protocol === 'awg' && (
              <div
                onClick={() => setPsk(!psk)}
                className={`p-3.5 sm:p-4 rounded-2xl border cursor-pointer transition-all duration-200 select-none ${
                  psk
                    ? 'border-[#D9B96E] bg-[#102833] shadow-md shadow-[#D9B96E]/10'
                    : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80'
                }`}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      id="psk-toggle"
                      checked={psk}
                      onChange={(e) => setPsk(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-serif font-bold text-xs sm:text-sm text-[#F2F0E8] truncate">
                          Совместимость с Shadowrocket (PSK)
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8C9BA0] leading-tight truncate">
                        Для приложения Shadowrocket на iPhone и Mac
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#06141B] text-[#D9B96E] border border-[#D9B96E]/30 hidden sm:inline-block">
                      AmneziaWG
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowPskInfo(!showPskInfo);
                      }}
                      className="p-1 rounded-lg text-[#718187] hover:text-[#D9B96E] hover:bg-[#06141B] transition cursor-pointer"
                      title={showPskInfo ? 'Скрыть пояснение' : 'Показать подробности'}
                    >
                      <HelpCircle className={`w-4 h-4 ${showPskInfo ? 'text-[#D9B96E]' : 'text-[#718187]'}`} />
                    </button>
                  </div>
                </div>

                {showPskInfo && (
                  <p className="text-xs text-[#A8B4B7] mt-2.5 pt-2.5 border-t border-[#1C3945]/60 font-sans leading-relaxed animate-in fade-in">
                    Добавляет параметр <code className="text-[#D9B96E] font-mono text-xs px-1.5 py-0.5 bg-[#06141B] rounded">PresharedKey</code> в конфигурацию. Опция применима ко всем серверам AmneziaWG и необходима для импорта в Shadowrocket на iOS/macOS. Для протоколов Hysteria 2, Mieru и VLESS опция не нужна — они подключаются по ссылке напрямую.
                  </p>
                )}
              </div>
            )}
          </form>

          {/* Sticky Bottom Action Footer */}
          <div className="p-3.5 sm:p-5 bg-[#0A1D26]/95 border-t border-[#1C3945]/70 shrink-0">
            <button
              onClick={handleSubmit}
              disabled={loading || !selectedNodeId}
              className="w-full bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold font-mono text-xs sm:text-sm uppercase tracking-wider py-3.5 sm:py-4 px-4 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 disabled:opacity-50 transition-all duration-200 flex items-center justify-center space-x-2 cursor-pointer"
            >
              {loading ? (
                <span>
                  {protocol === 'vless'
                    ? 'Создание профиля VLESS+Reality...'
                    : protocol === 'mieru'
                    ? 'Создание профиля Mieru...'
                    : protocol === 'hysteria2'
                    ? 'Создание профиля Hysteria 2...'
                    : 'Генерация AmneziaWG ключа...'}
                </span>
              ) : (
                <>
                  <Zap className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  <span>
                    Создать профиль ({selectedProtoMeta?.title})
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Mascot FAQ Modal */}
          <MascotFaqModal
            isOpen={showFaq}
            onClose={() => setShowFaq(false)}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}