import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Key,
  Copy,
  Check,
  Download,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Activity,
  Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { ClientConfigSummary, ClientConfigDetail } from '../types';
import { formatCountry, getCountryFlag } from '../utils/country';
import { triggerHaptic, triggerNotificationHaptic } from '../utils/telegram';

interface CachedKey {
  detail?: ClientConfigDetail;
  qrUrl?: string;
  loading: boolean;
  error?: string;
}

interface TmaSwipeableKeyCardsProps {
  keys: ClientConfigSummary[];
  selectedKeyId: number | null;
  onSelectKey: (id: number) => void;
  onCreateKeyClick: () => void;
}

const SWIPE_THRESHOLD = 75; // px to commit swipe
const VELOCITY_THRESHOLD = 0.35; // px/ms for quick flick

export const TmaSwipeableKeyCards: React.FC<TmaSwipeableKeyCardsProps> = ({
  keys,
  selectedKeyId,
  onSelectKey,
  onCreateKeyClick,
}) => {
  // Key cache (detail + QR)
  const [cache, setCache] = useState<Record<number, CachedKey>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);

  // Gesture state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [flyOutDirection, setFlyOutDirection] = useState<'left' | 'right' | null>(null);

  const startCoordRef = useRef({ x: 0, y: 0, time: 0 });
  const hasMovedRef = useRef(false);
  const hasHapticThresholdRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Determine active index based on selectedKeyId
  const currentIndex = Math.max(
    0,
    keys.findIndex((k) => k.id === selectedKeyId)
  );
  const activeKey = keys[currentIndex] || keys[0] || null;

  // Check prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fetch key details and QR code into local in-memory cache
  const fetchKeyData = useCallback(async (keyId: number) => {
    setCache((prev) => {
      if (prev[keyId]?.detail || prev[keyId]?.loading) return prev;
      return { ...prev, [keyId]: { ...prev[keyId], loading: true } };
    });

    try {
      const detail = await api.getKey(keyId);
      let qrUrl = '';
      const qrContent = detail.vpn_uri || detail.config;
      if (qrContent) {
        qrUrl = await QRCode.toDataURL(qrContent, {
          width: 320,
          margin: 2,
          color: { dark: '#06141B', light: '#FFFFFF' },
        });
      }
      setCache((prev) => ({
        ...prev,
        [keyId]: { detail, qrUrl, loading: false },
      }));
    } catch (err: any) {
      setCache((prev) => ({
        ...prev,
        [keyId]: {
          loading: false,
          error: err.message || 'Ошибка загрузки конфигурации',
        },
      }));
    }
  }, []);

  // Pre-fetch active key and adjacent keys for instantaneous flipping
  useEffect(() => {
    if (!keys.length) return;
    const currentId = keys[currentIndex]?.id;
    if (currentId) fetchKeyData(currentId);

    // Pre-fetch next key
    if (keys.length > 1) {
      const nextId = keys[(currentIndex + 1) % keys.length]?.id;
      if (nextId) fetchKeyData(nextId);
    }
    // Pre-fetch previous key
    if (keys.length > 2) {
      const prevId = keys[(currentIndex - 1 + keys.length) % keys.length]?.id;
      if (prevId) fetchKeyData(prevId);
    }
  }, [keys, currentIndex, fetchKeyData]);

  // Handle switching cards
  const commitSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (keys.length <= 1) {
        setDragOffset({ x: 0, y: 0 });
        setIsDragging(false);
        return;
      }

      triggerNotificationHaptic('success');

      if (prefersReducedMotion) {
        const nextIndex =
          direction === 'left'
            ? (currentIndex + 1) % keys.length
            : (currentIndex - 1 + keys.length) % keys.length;
        onSelectKey(keys[nextIndex].id);
        setDragOffset({ x: 0, y: 0 });
        setIsDragging(false);
        return;
      }

      setFlyOutDirection(direction);
      setIsDragging(false);

      setTimeout(() => {
        const nextIndex =
          direction === 'left'
            ? (currentIndex + 1) % keys.length
            : (currentIndex - 1 + keys.length) % keys.length;
        onSelectKey(keys[nextIndex].id);
        setDragOffset({ x: 0, y: 0 });
        setFlyOutDirection(null);
      }, 210);
    },
    [keys, currentIndex, prefersReducedMotion, onSelectKey]
  );

  // Pointer event handlers (touch & mouse)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (flyOutDirection) return;
    // Don't drag if clicked on button or interactive control
    if ((e.target as HTMLElement).closest('button')) return;

    startCoordRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
    };
    hasMovedRef.current = false;
    hasHapticThresholdRef.current = false;
    setIsDragging(true);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture fails
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || flyOutDirection) return;

    const deltaX = e.clientX - startCoordRef.current.x;
    const deltaY = e.clientY - startCoordRef.current.y;

    if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
      hasMovedRef.current = true;
    }

    // Apply rubber-band resistance if user only has 1 key
    const effectiveX = keys.length <= 1 ? deltaX * 0.25 : deltaX;
    const effectiveY = deltaY * 0.15;

    setDragOffset({ x: effectiveX, y: effectiveY });

    // Haptic feedback when crossing swipe threshold
    if (keys.length > 1) {
      if (Math.abs(effectiveX) >= SWIPE_THRESHOLD && !hasHapticThresholdRef.current) {
        triggerHaptic('light');
        hasHapticThresholdRef.current = true;
      } else if (Math.abs(effectiveX) < SWIPE_THRESHOLD && hasHapticThresholdRef.current) {
        hasHapticThresholdRef.current = false;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const elapsed = Date.now() - startCoordRef.current.time;
    const deltaX = dragOffset.x;
    const velocity = Math.abs(deltaX) / (elapsed || 1);

    if (
      keys.length > 1 &&
      (Math.abs(deltaX) >= SWIPE_THRESHOLD || (velocity > VELOCITY_THRESHOLD && Math.abs(deltaX) > 30))
    ) {
      commitSwipe(deltaX < 0 ? 'left' : 'right');
    } else {
      // Spring back to center
      setDragOffset({ x: 0, y: 0 });
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (keys.length <= 1) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      commitSwipe('right');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      commitSwipe('left');
    }
  };

  // Copy config/URI
  const handleCopy = (keyId: number, text: string) => {
    triggerHaptic('medium');
    navigator.clipboard.writeText(text);
    setCopiedKeyId(keyId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  // Download config file
  const handleDownload = (key: ClientConfigDetail) => {
    triggerHaptic('light');
    const isMieruOrVless = key.protocol === 'mieru' || key.protocol === 'vless';
    const isHysteria = key.protocol === 'hysteria2';
    const ext = isMieruOrVless ? 'json' : isHysteria ? 'yaml' : 'conf';
    const mime = isMieruOrVless ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([key.config || key.vpn_uri || ''], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key.client_name || key.device_name || 'avari-vpn'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Empty state if no keys
  if (!keys.length) {
    return (
      <div className="space-y-4">
        <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-3xl backdrop-blur-sm">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Key className="w-7 h-7" />
          </div>
          <div className="text-base font-semibold text-slate-200">У вас пока нет ключей</div>
          <div className="text-xs text-slate-400 mt-1 mb-6 max-w-xs mx-auto leading-relaxed">
            Создайте первый ключ для мгновенного подключения к защищенной сети Avari Keys.
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              onCreateKeyClick();
            }}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Создать первый ключ</span>
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Reigns Card Physics & Stack Calculations
  // ------------------------------------------------------------------
  const rotation = dragOffset.x * 0.07; // Degrees rotation
  const dragProgress = flyOutDirection ? 1 : Math.min(Math.abs(dragOffset.x) / 100, 1);

  // Background card #1 (right below top card)
  const hasCard1 = keys.length > 1;
  const card1Index = (currentIndex + 1) % keys.length;
  const card1Key = hasCard1 ? keys[card1Index] : null;
  const card1Scale = 0.94 + 0.06 * dragProgress;
  const card1TranslateY = 12 * (1 - dragProgress);
  const card1Opacity = 0.82 + 0.18 * dragProgress;
  const card1Brightness = 0.75 + 0.25 * dragProgress;

  // Background card #2 (peeking in deep stack)
  const hasCard2 = keys.length > 2;
  const card2Index = (currentIndex + 2) % keys.length;
  const card2Key = hasCard2 ? keys[card2Index] : null;
  const card2Scale = 0.88 + 0.06 * dragProgress;
  const card2TranslateY = 24 - 12 * dragProgress;
  const card2Opacity = 0.45 + 0.35 * dragProgress;
  const card2Brightness = 0.55 + 0.2 * dragProgress;

  // Stamp opacities for Reigns decision labels
  const stampNextOpacity = Math.max(0, Math.min(1, (-dragOffset.x - 15) / 55));
  const stampPrevOpacity = Math.max(0, Math.min(1, (dragOffset.x - 15) / 55));

  // Current active key data
  const activeCached = activeKey ? cache[activeKey.id] : null;
  const activeDetail = activeCached?.detail;

  return (
    <div
      className="space-y-4 focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-roledescription="carousel"
      aria-label="VPN-ключи пользователя"
    >
      {/* 1. Quick Device Chips Selector */}
      {keys.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none select-none">
          {keys.map((k, idx) => {
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={k.id}
                onClick={() => {
                  triggerHaptic('light');
                  onSelectKey(k.id);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  isCurrent
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-semibold shadow-sm shadow-cyan-500/10'
                    : 'bg-slate-900/80 text-slate-400 border border-slate-800/80 hover:text-slate-300'
                }`}
                aria-label={`Выбрать ${k.client_name || k.device_name}`}
                aria-current={isCurrent ? 'true' : undefined}
              >
                <span>{getCountryFlag(k.node_country_code || 'NLD')}</span>
                <span>{k.client_name || k.device_name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. REIGNS CARD STACK DECK */}
      <div className="relative min-h-[460px] flex items-center justify-center pt-2 pb-3">
        {/* Card 2 (Bottom layer in 3D stack) */}
        {hasCard2 && card2Key && (
          <div
            className="absolute inset-x-2 top-2 rounded-3xl bg-slate-900/90 border border-slate-800/80 p-4 shadow-xl select-none pointer-events-none"
            style={{
              transform: `translate3d(0, ${card2TranslateY}px, 0) scale(${card2Scale})`,
              opacity: card2Opacity,
              filter: `brightness(${card2Brightness})`,
              zIndex: 10,
              transformOrigin: '50% 100%',
              transition: isDragging
                ? 'none'
                : 'transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease, filter 0.2s ease',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{getCountryFlag(card2Key.node_country_code || 'NLD')}</span>
                <span className="text-sm font-bold text-slate-300">{card2Key.client_name || card2Key.device_name}</span>
              </div>
            </div>
            <div className="h-56 bg-slate-950/40 rounded-2xl border border-slate-800/40 flex items-center justify-center text-slate-600 text-xs">
              <Key className="w-8 h-8 opacity-30" />
            </div>
          </div>
        )}

        {/* Card 1 (Middle layer in 3D stack) */}
        {hasCard1 && card1Key && (
          <div
            className="absolute inset-x-1 top-1 rounded-3xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-2xl select-none pointer-events-none"
            style={{
              transform: `translate3d(0, ${card1TranslateY}px, 0) scale(${card1Scale})`,
              opacity: card1Opacity,
              filter: `brightness(${card1Brightness})`,
              zIndex: 20,
              transformOrigin: '50% 100%',
              transition: isDragging
                ? 'none'
                : 'transform 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease, filter 0.2s ease',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{getCountryFlag(card1Key.node_country_code || 'NLD')}</span>
                <div>
                  <div className="text-sm font-bold text-white">
                    {card1Key.client_name || card1Key.device_name}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {formatCountry(card1Key.node_country_code || 'NLD')} • {card1Key.node_name || 'Кластер'}
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {card1Key.protocol === 'vless'
                  ? 'VLESS'
                  : card1Key.protocol === 'mieru'
                  ? 'Mieru'
                  : card1Key.protocol === 'hysteria2'
                  ? 'Hysteria 2'
                  : 'AmneziaWG'}
              </span>
            </div>
            <div className="h-56 bg-white/5 rounded-2xl border border-slate-800 flex items-center justify-center text-slate-600 text-xs">
              <Key className="w-10 h-10 opacity-30 text-cyan-400" />
            </div>
          </div>
        )}

        {/* Card 0 (Top Active Layer - Draggable & Swipable) */}
        {activeKey && (
          <div
            ref={cardRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            role="group"
            aria-roledescription="slide"
            aria-label={`${currentIndex + 1} из ${keys.length}: ${activeKey.client_name || activeKey.device_name}`}
            className="relative w-full rounded-3xl bg-slate-900/95 border border-slate-700/80 p-4 space-y-3 shadow-[0_16px_36px_rgba(0,0,0,0.65)] backdrop-blur-md cursor-grab active:cursor-grabbing select-none"
            style={{
              touchAction: 'pan-y',
              zIndex: 30,
              transformOrigin: '50% 90%',
              transform: flyOutDirection === 'left'
                ? 'translate3d(-460px, 0, 0) rotate(-22deg)'
                : flyOutDirection === 'right'
                ? 'translate3d(460px, 0, 0) rotate(22deg)'
                : `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${rotation}deg)`,
              opacity: flyOutDirection ? 0 : 1,
              transition: isDragging
                ? 'none'
                : 'transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.22s ease',
            }}
          >
            {/* Reigns Game Swipe Decision Stamps */}
            {keys.length > 1 && (
              <>
                {/* Stamp: NEXT KEY (when swiping left) */}
                <div
                  className="absolute top-4 right-4 pointer-events-none z-40 px-3 py-1.5 rounded-xl border-2 border-cyan-400 bg-cyan-950/90 text-cyan-300 font-extrabold text-xs tracking-wider uppercase shadow-[0_0_20px_rgba(6,182,212,0.6)] transform rotate-12 transition-opacity"
                  style={{ opacity: stampNextOpacity }}
                >
                  Следующий →
                </div>

                {/* Stamp: PREVIOUS KEY (when swiping right) */}
                <div
                  className="absolute top-4 left-4 pointer-events-none z-40 px-3 py-1.5 rounded-xl border-2 border-emerald-400 bg-emerald-950/90 text-emerald-300 font-extrabold text-xs tracking-wider uppercase shadow-[0_0_20px_rgba(16,185,129,0.6)] transform -rotate-12 transition-opacity"
                  style={{ opacity: stampPrevOpacity }}
                >
                  ← Предыдущий
                </div>
              </>
            )}

            {/* Header: Flag, Name, Protocol */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl filter drop-shadow-sm">
                  {getCountryFlag(activeKey.node_country_code || 'NLD')}
                </span>
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>{activeKey.client_name || activeKey.device_name}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {formatCountry(activeKey.node_country_code || 'NLD')} • {activeKey.node_name || 'Кластер'}
                  </div>
                </div>
              </div>

              {/* Protocol Badge */}
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  activeKey.protocol === 'mieru' || activeKey.protocol === 'vless'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                    : activeKey.protocol === 'hysteria2'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.2)]'
                }`}
              >
                {activeKey.protocol === 'vless'
                  ? 'VLESS+Reality'
                  : activeKey.protocol === 'mieru'
                  ? 'Mieru'
                  : activeKey.protocol === 'hysteria2'
                  ? 'Hysteria 2'
                  : 'AmneziaWG'}
              </span>
            </div>

            {/* QR Code Container */}
            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl shadow-inner my-2 select-none">
              {activeCached?.loading ? (
                <div className="w-44 h-44 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-slate-600" />
                  <span>Загрузка ключа...</span>
                </div>
              ) : activeCached?.qrUrl ? (
                <img
                  src={activeCached.qrUrl}
                  alt="VPN QR Code"
                  className="w-44 h-44 rounded-lg select-none pointer-events-none"
                  draggable={false}
                />
              ) : activeCached?.error ? (
                <div className="w-44 h-44 flex flex-col items-center justify-center text-rose-500 text-xs text-center p-3">
                  <span>{activeCached.error}</span>
                  <button
                    onClick={() => fetchKeyData(activeKey.id)}
                    className="mt-2 text-xs text-cyan-600 underline font-medium"
                  >
                    Повторить
                  </button>
                </div>
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-slate-400 text-xs text-center p-4">
                  Формирование QR-кода...
                </div>
              )}

              <span className="text-[11px] text-slate-600 mt-1.5 font-medium text-center">
                {activeKey.protocol === 'mieru' || activeKey.protocol === 'vless'
                  ? 'Сканируйте в Hiddify / NekoBox'
                  : activeKey.protocol === 'hysteria2'
                  ? 'Сканируйте в v2rayNG / NekoBox'
                  : 'Сканируйте в приложении AmneziaVPN'}
              </span>
            </div>

            {/* Key Traffic Stats Pill if available */}
            {(activeKey.month_traffic_formatted || activeKey.total_traffic_formatted) && (
              <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800/60 text-[11px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-cyan-400" /> Трафик за месяц:
                </span>
                <span className="font-semibold text-cyan-300 font-mono">
                  {activeKey.month_traffic_formatted || activeKey.total_traffic_formatted || '0 B'}
                </span>
              </div>
            )}

            {/* Actions: Copy & Download */}
            {activeDetail && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleCopy(activeKey.id, activeDetail.vpn_uri || activeDetail.config)}
                  className="py-2.5 px-3 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 active:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
                >
                  {copiedKeyId === activeKey.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Скопировать</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDownload(activeDetail)}
                  className="py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 active:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {activeDetail.protocol === 'mieru' || activeDetail.protocol === 'vless'
                      ? 'Скачать .json'
                      : activeDetail.protocol === 'hysteria2'
                      ? 'Скачать .yaml'
                      : 'Скачать .conf'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. REIGNS SWIPE HINT & ALTERNATIVE CONTROLS */}
      {keys.length > 1 ? (
        <div className="space-y-2 select-none">
          {/* Reigns swipe guidance label */}
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-medium px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800/60">
              <Sparkles className="w-3 h-3 text-cyan-400 animate-pulse" />
              <span>Листайте свайпом влево/вправо, как в Reigns</span>
            </span>
          </div>

          {/* Navigation Controls: Previous, Dots, Next */}
          <div className="flex items-center justify-between px-2 pt-1">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                commitSwipe('right');
              }}
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 active:scale-95 transition-all flex items-center gap-1 text-xs font-medium"
              aria-label="Предыдущий ключ"
            >
              <ChevronLeft className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Назад</span>
            </button>

            {/* Pagination Dots & Counter */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[11px] text-slate-400 font-mono">
                {currentIndex + 1} из {keys.length}
              </span>
              <div className="flex items-center gap-1.5">
                {keys.map((k, idx) => {
                  const isActive = idx === currentIndex;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        onSelectKey(k.id);
                      }}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        isActive
                          ? 'w-5 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                          : 'w-1.5 bg-slate-700 hover:bg-slate-500'
                      }`}
                      aria-label={`Перейти к ключу ${idx + 1}`}
                      aria-current={isActive ? 'true' : undefined}
                    />
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                commitSwipe('left');
              }}
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 active:scale-95 transition-all flex items-center gap-1 text-xs font-medium"
              aria-label="Следующий ключ"
            >
              <span className="hidden sm:inline">Вперед</span>
              <ChevronRight className="w-4 h-4 text-cyan-400" />
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center text-[11px] text-slate-500 py-1">
          Единственный активный ключ
        </div>
      )}

      {/* 4. Create New Key Button */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic('light');
          onCreateKeyClick();
        }}
        className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 active:scale-[0.98] transition-all"
      >
        <Plus className="w-4 h-4" />
        <span>Создать новый ключ</span>
      </button>
    </div>
  );
};
