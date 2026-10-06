import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Zap, ShieldCheck, Smartphone, HelpCircle, Lock, Sparkles } from 'lucide-react';
import { User, NodePublic, ProtocolType } from '../types';
import { formatNodeRouting } from '../utils/country';
import { MascotModalCompanion, MascotFaqModal } from './MascotAssistant';

interface Props {
  nodes: NodePublic[];
  currentUser?: User | null;
  onClose: () => void;
  onCreate: (nodeId: number, deviceName: string, psk: boolean, protocol?: ProtocolType) => Promise<void>;
}

export function CreateKeyModal({ nodes, currentUser, onClose, onCreate }: Props) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const isUserProOrAdmin = Boolean(currentUser?.is_pro || currentUser?.role === 'admin');
  const defaultNode = safeNodes.find((n) => !n.is_backup || isUserProOrAdmin) || safeNodes[0];
  const [selectedNodeId, setSelectedNodeId] = useState<number>(defaultNode?.id || 0);
  const [protocol, setProtocol] = useState<ProtocolType>('awg');
  const [deviceName, setDeviceName] = useState<string>('');
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
    // Only allow Latin letters, digits, underscore, and dash
    const filtered = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
    setDeviceName(filtered);
  };

  const handleSelectNode = (node: NodePublic) => {
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
    if (targetNode?.is_backup && !isUserProOrAdmin) {
      setError('Выбранный сервер доступен только для тарифа PRO');
      return;
    }

    const cleanName = deviceName.trim();
    if (!cleanName) {
      setError('Пожалуйста, укажите имя устройства');
      return;
    }

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanName)) {
      setError('Имя устройства может содержать только латинские буквы, цифры, дефис и подчеркивание (a-z, 0-9, _, -)');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onCreate(selectedNodeId, cleanName, psk, protocol);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка создания ключа');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-[#06141B]/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      {/* Centered Area: Modal in Dead Center + Mascot to the Left on Desktop */}
      <div className="relative max-w-2xl lg:max-w-3xl w-full my-auto flex flex-col items-center">
        
        {/* Mascot Character Standing to the Left of the Modal (Desktop lg+) */}
        <div className="hidden lg:block absolute right-[calc(100%+2rem)] xl:right-[calc(100%+3.5rem)] bottom-0 w-80">
          <MascotModalCompanion onClickFaq={() => setShowFaq(true)} />
        </div>

        {/* Mascot on Mobile (Above modal, compact banner) */}
        <div className="lg:hidden mb-3 w-full flex justify-center">
          <MascotModalCompanion onClickFaq={() => setShowFaq(true)} compact={true} />
        </div>

        {/* Modal Window Card */}
        <div className="w-full bg-[#0A1D26]/95 backdrop-blur-xl border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-3xl p-4 sm:p-6 sm:p-8 shadow-2xl shadow-black/90 relative transition-all duration-300">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 sm:top-5 sm:right-5 text-[#A8B4B7] hover:text-[#F2F0E8] p-2 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition cursor-pointer"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-3 sm:space-x-3.5 mb-5 sm:mb-6 pr-8">
            <div className="bg-[#102833] p-2.5 sm:p-3.5 rounded-2xl text-[#D9B96E] border border-[#1C3945] shrink-0">
              <Plus className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] tracking-wide">Создать VPN Ключ</h3>
              <p className="text-xs sm:text-sm text-[#A8B4B7] mt-0.5 font-sans">Выберите тип туннелирования и назовите устройство</p>
            </div>
          </div>

          {error && (
            <div className="bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs sm:text-sm p-3.5 sm:p-4 rounded-xl mb-4 sm:mb-5 shadow-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {/* Informative Note for Backup / PRO Servers */}
            {hasBackupNodes && (
              <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-800/40 text-xs text-[#A8B4B7] flex items-start space-x-2.5">
                <Sparkles className="w-4 h-4 text-purple-300 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-serif font-bold text-purple-200">
                    Резервные серверы высокой надежности
                  </span>
                  <p className="font-sans leading-relaxed text-[11px] text-[#A8B4B7]">
                    {isUserProOrAdmin
                      ? 'Вам доступен выбор всех основных и запасных узлов сети для максимальной отказоустойчивости.'
                      : 'Серверы с отметкой [Запасной (PRO)] обеспечивают дополнительную надежность и доступны на тарифе PRO.'}
                  </p>
                </div>
              </div>
            )}

            {/* Node Selection */}
            <div>
              <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider mb-2">
                Тип подключения / Сервер
              </label>
              <div className="space-y-2 sm:space-y-2.5">
                {safeNodes.map((node) => {
                  const isExpanded = !!expandedNodeIds[node.id];
                  const isSelected = selectedNodeId === node.id;
                  const routing = formatNodeRouting(node.type, node.country_code);
                  const isNodeLocked = Boolean(node.is_backup) && !isUserProOrAdmin;

                  return (
                    <div
                      key={node.id}
                      onClick={() => handleSelectNode(node)}
                      className={`p-3 sm:p-4 rounded-2xl border transition-all duration-200 ${
                        isNodeLocked
                          ? 'opacity-65 bg-[#091820] border-[#1C3945]/60 hover:border-purple-800/50 cursor-pointer'
                          : isSelected
                          ? 'border-[#D9B96E] bg-[#102833] shadow-lg shadow-[#D9B96E]/10 cursor-pointer'
                          : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80 cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3">
                        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0 flex-1">
                          <input
                            type="radio"
                            name="node"
                            value={node.id}
                            checked={isSelected}
                            disabled={isNodeLocked}
                            onChange={() => handleSelectNode(node)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 text-[#D9B96E] focus:ring-[#D9B96E] accent-[#D9B96E] cursor-pointer shrink-0 disabled:opacity-40"
                          />
                          <span className={`font-serif font-bold text-sm sm:text-base truncate ${isNodeLocked ? 'text-[#A8B4B7]' : 'text-[#F2F0E8]'}`}>
                            {node.name}
                          </span>
                        </div>

                        {/* Badges & Pulsing Info Button */}
                        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
                          {node.is_backup && (
                            <span
                              className="inline-flex items-center space-x-1 text-[11px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40 shadow-sm"
                              title="Запасной сервер — доступен только для тарифа PRO"
                            >
                              <Sparkles className="w-3 h-3 text-purple-300" />
                              <span>Запасной (PRO)</span>
                            </span>
                          )}
                          {isNodeLocked && (
                            <span
                              className="inline-flex items-center space-x-1 text-[11px] sm:text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-[#102833] text-amber-300 border border-amber-500/30"
                              title="Доступно на тарифе PRO"
                            >
                              <Lock className="w-3 h-3 text-amber-300" />
                              <span>Только PRO</span>
                            </span>
                          )}
                          {node.is_mobile_optimized && (
                            <span 
                              className="inline-flex items-center space-x-1 text-[11px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#06141B] text-[#D9B96E] border border-[#D9B96E]/40" 
                              title="Оптимизирован для мобильных сетей (порт 443/UDP)"
                            >
                              <Smartphone className="w-3 h-3" />
                              <span>LTE</span>
                            </span>
                          )}
                          <span
                            className={`text-[11px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2 sm:px-2.5 py-0.5 rounded-full ${
                              node.type === 'cascade'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                                : 'bg-[#06141B] text-[#6EA8C4] border border-[#6EA8C4]/40'
                            }`}
                          >
                            {routing.fullText}
                          </span>

                          {/* Subtle pulsating question icon to reveal details */}
                          <button
                            type="button"
                            onClick={(e) => toggleNodeInfo(node.id, e)}
                            className="p-1 rounded-lg text-[#718187] hover:text-[#D9B96E] hover:bg-[#06141B] transition cursor-pointer"
                            title={isExpanded ? 'Скрыть пояснение' : 'Показать пояснение о сервере'}
                          >
                            <HelpCircle className={`w-4 h-4 sm:w-5 sm:h-5 ${isExpanded ? 'text-[#D9B96E]' : 'text-[#D9B96E]/70 animate-pulse'}`} />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Info Block */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-[#1C3945]/60 text-xs sm:text-sm text-[#A8B4B7] font-sans leading-relaxed animate-fadeIn">
                          {node.is_backup && (
                            <div className="text-purple-300 mb-1 font-medium flex items-center space-x-1">
                              <span>🛡️ Запасной сервер для повышенной надежности (тариф PRO).</span>
                            </div>
                          )}
                          {node.type === 'cascade' ? (
                            <span>Вход через РФ, выход за рубежом — максимальная защита от блокировок и DPI провайдеров.</span>
                          ) : (
                            <span>Прямой туннель к зарубежному серверу с минимальной задержкой.</span>
                          )}
                          {node.is_mobile_optimized && (
                            <div className="text-[#F0D48D] mt-1 font-medium flex items-center space-x-1">
                              <span>⭐ Рекомендуется для смартфонов и мобильных операторов (порт 443/UDP).</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Protocol Selection: AmneziaWG vs Hysteria 2 */}
            <div>
              <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider mb-2">
                Протокол подключения
              </label>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setProtocol('awg')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    protocol === 'awg'
                      ? 'border-[#D9B96E] bg-[#102833] shadow-md shadow-[#D9B96E]/10'
                      : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    <ShieldCheck className={`w-4 h-4 ${protocol === 'awg' ? 'text-[#D9B96E]' : 'text-[#718187]'}`} />
                    <span className="font-serif font-bold text-sm text-[#F2F0E8]">AmneziaWG</span>
                  </div>
                  <p className="text-[11px] text-[#A8B4B7] leading-tight">
                    WireGuard с обфускацией. Универсален для AmneziaVPN и WireGuard.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setProtocol('hysteria2')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    protocol === 'hysteria2'
                      ? 'border-[#D9B96E] bg-[#102833] shadow-md shadow-[#D9B96E]/10'
                      : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    <Zap className={`w-4 h-4 ${protocol === 'hysteria2' ? 'text-[#D9B96E]' : 'text-[#718187]'}`} />
                    <span className="font-serif font-bold text-sm text-[#F2F0E8]">Hysteria 2</span>
                  </div>
                  <p className="text-[11px] text-[#A8B4B7] leading-tight">
                    QUIC / UDP. Максимальная скорость при потерях и мобильном интернете.
                  </p>
                </button>
              </div>
            </div>

            {/* Device Name Input */}
            <div>
              <label className="block text-xs font-mono font-semibold text-[#D9B96E] uppercase tracking-wider mb-2">
                Имя устройства / Заметка
              </label>
              <input
                type="text"
                placeholder="например: iphone_15, macbook-pro, home_pc"
                value={deviceName}
                onChange={handleDeviceNameChange}
                pattern="^[a-zA-Z0-9_-]{1,64}$"
                title="Только латинские буквы, цифры, дефис и знак подчеркивания"
                className="w-full bg-[#0D222C] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-3 text-sm sm:text-base text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:ring-1 focus:ring-[#D9B96E]/50 transition shadow-inner font-mono"
                required
              />
              <p className="text-xs text-[#8C9BA0] font-sans mt-1.5">
                * Разрешены латинские буквы (a-z, A-Z), цифры (0-9), дефис (-) и подчеркивание (_)
              </p>
            </div>

            {/* PSK / Shadowrocket Option */}
            <div
              onClick={() => setPsk(!psk)}
              className={`p-3.5 sm:p-4 rounded-2xl border cursor-pointer transition-all duration-200 ${
                psk
                  ? 'border-[#D9B96E] bg-[#102833] shadow-lg shadow-[#D9B96E]/10'
                  : 'border-[#1C3945] bg-[#0D222C] hover:border-[#1C3945]/80 hover:bg-[#0D222C]/80'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    id="psk-toggle"
                    checked={psk}
                    onChange={(e) => setPsk(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded text-[#D9B96E] bg-[#06141B] border-[#1C3945] focus:ring-[#D9B96E] focus:ring-offset-0 accent-[#D9B96E] cursor-pointer shrink-0"
                  />
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className={`w-4 h-4 ${psk ? 'text-[#D9B96E]' : 'text-[#718187]'}`} />
                    <span className="font-serif font-bold text-sm sm:text-base text-[#F2F0E8]">
                      PresharedKey (PSK)
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#06141B] text-[#D9B96E] border border-[#D9B96E]/30">
                    iPhone / MacBook / Shadowrocket
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowPskInfo(!showPskInfo);
                    }}
                    className="p-1.5 rounded-lg text-[#718187] hover:text-[#D9B96E] hover:bg-[#06141B] transition cursor-pointer"
                    title={showPskInfo ? 'Скрыть пояснение' : 'Показать подробности о PSK'}
                  >
                    <HelpCircle className={`w-5 h-5 ${showPskInfo ? 'text-[#D9B96E]' : 'text-[#D9B96E]/70 animate-pulse'}`} />
                  </button>
                </div>
              </div>

              {showPskInfo && (
                <p className="text-xs text-[#A8B4B7] mt-2.5 pt-2.5 border-t border-[#1C3945]/60 font-sans leading-relaxed animate-fadeIn">
                  Добавляет ключ <code className="text-[#D9B96E] font-mono text-xs px-1.5 py-0.5 bg-[#06141B] rounded">PresharedKey</code> (<code className="text-[#D9B96E] font-mono text-xs px-1.5 py-0.5 bg-[#06141B] rounded">--psk</code>). Обязательно для подключения клиентов Shadowrocket на iPhone, iPad и Mac.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-3 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold font-mono text-sm sm:text-base uppercase tracking-wider py-3.5 sm:py-4 px-4 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 disabled:opacity-50 transition-all duration-300 flex items-center justify-center space-x-2 cursor-pointer"
            >
              {loading ? (
                <span>Генерация AmneziaWG ключа...</span>
              ) : (
                <>
                  <Zap className="w-5 h-5 fill-current" />
                  <span>Сгенерировать ключ</span>
                </>
              )}
            </button>
          </form>

          {/* 5 Popular Questions & Answers Modal */}
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
