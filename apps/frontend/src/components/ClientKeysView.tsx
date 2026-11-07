import React, { useState } from 'react';
import {
  Smartphone,
  Laptop,
  LayoutGrid,
  List,
  QrCode as QrIcon,
  Trash2,
  ChevronDown,
  Server,
  Activity,
  HardDrive,
  Calendar,
} from 'lucide-react';
import { ClientConfigSummary } from '../types';
import { Tooltip } from './Tooltip';
import { formatNodeRouting } from '../utils/country';

interface ClientKeysViewProps {
  keys: ClientConfigSummary[];
  onViewKey: (id: number) => void;
  onDeleteKey: (key: ClientConfigSummary) => void;
}

const STORAGE_VIEW_KEY = 'avari_keys_view_mode';

export const ClientKeysView: React.FC<ClientKeysViewProps> = ({
  keys,
  onViewKey,
  onDeleteKey,
}) => {
  // View mode: 'grid' (cards) or 'list' (minimalist list with accordion)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved === 'list' || saved === 'grid') return saved;
    } catch {
      // Ignore localStorage errors
    }
    return 'grid';
  });

  // Set of expanded key IDs for multi-open accordion in list mode
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const handleToggleView = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_VIEW_KEY, mode);
    } catch {
      // Ignore
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isDeviceMobile = (deviceName: string) => {
    const name = deviceName.toLowerCase();
    return name.includes('phone') || name.includes('iphone') || name.includes('android');
  };

  const isKeyActive = (lastHandshake?: string) => {
    if (!lastHandshake) return false;
    const lower = lastHandshake.toLowerCase();
    return !lower.includes('не') && !lower.includes('never');
  };

  return (
    <div className="space-y-4">
      {/* View Switcher Header Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-[#1C3945]/60">
        <div className="flex items-center space-x-2 text-xs font-mono text-[#A8B4B7]">
          <span>Всего конфигураций:</span>
          <span className="px-2 py-0.5 rounded-md bg-[#102833] text-[#D9B96E] font-bold border border-[#1C3945]">
            {keys.length}
          </span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-[#06141B] p-1 rounded-xl border border-[#1C3945] shadow-inner">
          <Tooltip content="Сетка карточек" position="top">
            <button
              onClick={() => handleToggleView('grid')}
              aria-label="Режим сетки"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition duration-150 cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-sm'
                  : 'text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833]/40'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Сетка</span>
            </button>
          </Tooltip>

          <Tooltip content="Компактный список" position="top">
            <button
              onClick={() => handleToggleView('list')}
              aria-label="Режим списка"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition duration-150 cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[#102833] text-[#D9B96E] font-bold border border-[#D9B96E]/40 shadow-sm'
                  : 'text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833]/40'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Список</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 1. MINIMALIST LIST VIEW */}
      {viewMode === 'list' && (
        <div className="space-y-2.5">
          {keys.map((k) => {
            const isExpanded = expandedIds.has(k.id);
            const isMobile = isDeviceMobile(k.device_name);
            const active = isKeyActive(k.last_handshake);
            const routing = formatNodeRouting(k.node_type || 'direct', k.node_country_code);

            return (
              <div
                key={k.id}
                className={`border rounded-2xl transition-all duration-200 overflow-hidden shadow-md ${
                  isExpanded
                    ? 'bg-[#0D222C] border-[#D9B96E]/60 shadow-lg shadow-[#D9B96E]/5'
                    : 'bg-[#0A1D26]/80 hover:bg-[#0D222C]/90 border-[#1C3945] hover:border-[#D9B96E]/40'
                }`}
              >
                {/* Main Minimalist Row (Accordion Header) */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpand(k.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(k.id);
                    }
                  }}
                  className="flex flex-col md:flex-row md:items-center justify-between p-3.5 sm:p-4 gap-3 cursor-pointer select-none group"
                >
                  {/* Left: Device Icon + Names */}
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl border shrink-0 transition duration-200 ${
                        isExpanded
                          ? 'bg-[#102833] text-[#D9B96E] border-[#D9B96E]/50'
                          : 'bg-[#06141B] text-[#A8B4B7] border-[#1C3945] group-hover:text-[#D9B96E] group-hover:border-[#D9B96E]/30'
                      }`}
                    >
                      {isMobile ? <Smartphone className="w-4 h-4 sm:w-5 sm:h-5" /> : <Laptop className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-serif font-bold text-sm sm:text-base text-[#F2F0E8] group-hover:text-gold-gradient transition truncate">
                          {k.device_name}
                        </span>
                        <span className="hidden xs:inline-block text-[11px] font-mono text-[#718187] truncate">
                          ({k.client_name})
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-xs font-mono text-[#718187] mt-0.5">
                        <span className="text-[#A8B4B7] truncate max-w-[160px] sm:max-w-[220px]" title={k.node_name}>
                          {k.node_name || 'Node'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Middle / Right: Badges, Telemetry & Actions */}
                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5 sm:gap-4 shrink-0">
                    {/* Routing & Protocol Badges */}
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`text-[11px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          k.node_type === 'cascade'
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40 shadow-sm'
                            : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40 shadow-sm'
                        }`}
                      >
                        {routing.fullText}
                      </span>

                      {k.protocol === 'hysteria2' ? (
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-500/40 shadow-sm">
                          Hysteria 2
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 shadow-sm">
                          AWG
                        </span>
                      )}
                    </div>

                    {/* Status & Last Handshake */}
                    <div className="hidden lg:flex items-center space-x-1.5 text-xs font-mono text-[#A8B4B7]">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-400 animate-pulse' : 'bg-[#718187]'}`} />
                      <span className="truncate max-w-[140px]">{k.last_handshake || 'Не подключался'}</span>
                    </div>

                    {/* Traffic indicator */}
                    <div className="text-right font-mono text-xs sm:text-sm">
                      <span className="font-semibold text-[#F2F0E8]">{k.total_traffic_formatted || '0 B'}</span>
                      <span className="hidden sm:inline text-xs text-[#718187] ml-1">
                        ({k.month_traffic_formatted || '0 B'})
                      </span>
                    </div>

                    {/* Quick Action Button & Chevron */}
                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewKey(k.id);
                        }}
                        className="flex items-center space-x-1 bg-[#102833] hover:bg-[#1C3945] text-[#D9B96E] hover:text-[#F0D48D] border border-[#D9B96E]/30 hover:border-[#D9B96E]/60 text-xs font-mono font-semibold px-2.5 py-1.5 rounded-lg transition shadow-sm cursor-pointer"
                        title="Показать QR-код и файл конфигурации"
                      >
                        <QrIcon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">QR</span>
                      </button>

                      <div className="p-1 text-[#718187] group-hover:text-[#D9B96E] transition">
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-300 ${
                            isExpanded ? 'rotate-180 text-[#D9B96E]' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Smooth Accordion Body (CSS Grid 0fr -> 1fr) */}
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                    isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="pt-3 pb-3.5 px-3.5 sm:px-5 border-t border-[#1C3945]/70 bg-[#06141B]/70 space-y-3.5">
                      {/* Telemetry & Details Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-sans">
                        {/* 1. Server info */}
                        <div className="bg-[#0A1D26]/80 border border-[#1C3945]/70 rounded-xl p-3">
                          <div className="flex items-center space-x-1.5 text-[#718187] font-mono text-[11px] uppercase mb-1">
                            <Server className="w-3 h-3 text-[#D9B96E]" />
                            <span>Сервер & Топология</span>
                          </div>
                          <div className="font-semibold text-[#F2F0E8] truncate" title={k.node_name}>
                            {k.node_name || 'Node'}
                          </div>
                          <div className="text-[#A8B4B7] text-[11px] mt-0.5">
                            {k.node_type === 'cascade' ? 'Двухкаскадный маршрут' : 'Прямой зарубежный узел'}
                          </div>
                        </div>

                        {/* 2. Traffic info */}
                        <div className="bg-[#0A1D26]/80 border border-[#1C3945]/70 rounded-xl p-3">
                          <div className="flex items-center space-x-1.5 text-[#718187] font-mono text-[11px] uppercase mb-1">
                            <HardDrive className="w-3 h-3 text-[#D9B96E]" />
                            <span>Трафик</span>
                          </div>
                          <div className="font-mono text-sm font-semibold text-[#F2F0E8]">
                            Всего: {k.total_traffic_formatted || '0 B'}
                          </div>
                          <div className="font-mono text-[11px] text-[#A8B4B7] mt-0.5">
                            За месяц: {k.month_traffic_formatted || '0 B'}
                          </div>
                        </div>

                        {/* 3. Activity & Status */}
                        <div className="bg-[#0A1D26]/80 border border-[#1C3945]/70 rounded-xl p-3">
                          <div className="flex items-center space-x-1.5 text-[#718187] font-mono text-[11px] uppercase mb-1">
                            <Activity className="w-3 h-3 text-[#D9B96E]" />
                            <span>Активность</span>
                          </div>
                          <div className="flex items-center space-x-1.5 font-mono text-[11px] text-[#F2F0E8]">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-400 animate-pulse' : 'bg-[#718187]'}`} />
                            <span className="truncate">{k.last_handshake || 'Не подключался'}</span>
                          </div>
                          <div className="text-emerald-400 font-mono text-[11px] mt-0.5">
                            ∞ Бессрочный доступ
                          </div>
                        </div>

                        {/* 4. Dates & Peer */}
                        <div className="bg-[#0A1D26]/80 border border-[#1C3945]/70 rounded-xl p-3">
                          <div className="flex items-center space-x-1.5 text-[#718187] font-mono text-[11px] uppercase mb-1">
                            <Calendar className="w-3 h-3 text-[#D9B96E]" />
                            <span>Метаданные</span>
                          </div>
                          <div className="font-mono text-[11px] text-[#F2F0E8] truncate">
                            Пир: {k.client_name} (#{k.id})
                          </div>
                          <div className="text-[#A8B4B7] font-mono text-[11px] mt-0.5">
                            Создан: {new Date(k.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-[#1C3945]/50">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewKey(k.id);
                          }}
                          className="flex items-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono py-2 px-4 rounded-xl shadow-md transition cursor-pointer"
                        >
                          <QrIcon className="w-4 h-4" />
                          <span>QR-код и файл .conf</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteKey(k);
                          }}
                          className="flex items-center space-x-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-200 border border-rose-800/60 font-mono text-xs uppercase tracking-wider py-2 px-3.5 rounded-xl transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Отозвать ключ</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. GRID / CARDS VIEW */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {keys.map((k) => {
            const isMobile = isDeviceMobile(k.device_name);
            const routing = formatNodeRouting(k.node_type || 'direct', k.node_country_code);

            return (
              <div
                key={k.id}
                className="bg-[#0D222C]/90 border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-2xl p-5 shadow-xl hover:shadow-2xl hover:shadow-[#D9B96E]/5 flex flex-col justify-between transition-all duration-300 group"
              >
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="bg-[#102833] p-2.5 rounded-xl text-[#D9B96E] border border-[#1C3945] group-hover:border-[#D9B96E]/40 transition">
                        {isMobile ? <Smartphone className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
                      </div>
                      <div>
                        <h4 className="font-serif font-bold text-[#F2F0E8] text-base group-hover:text-gold-gradient transition">
                          {k.device_name}
                        </h4>
                        <span className="text-sm text-[#718187] font-mono tracking-wider">{k.client_name}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-sm font-mono font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                          k.node_type === 'cascade'
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40 shadow-sm'
                            : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40 shadow-sm'
                        }`}
                      >
                        {routing.fullText}
                      </span>
                      {k.protocol === 'hysteria2' ? (
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-950/80 text-violet-300 border border-violet-500/40 shadow-sm">
                          Hysteria 2
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30 shadow-sm">
                          AWG
                        </span>
                      )}
                    </div>
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
                    onClick={() => onViewKey(k.id)}
                    className="flex-1 flex items-center justify-center space-x-2 bg-[#102833] hover:bg-[#1C3945] text-[#D9B96E] hover:text-[#F0D48D] border border-[#D9B96E]/30 hover:border-[#D9B96E]/60 font-mono text-sm uppercase tracking-wider py-2.5 px-3 rounded-xl transition shadow-sm cursor-pointer"
                  >
                    <QrIcon className="w-4 h-4" />
                    <span>QR & Конфиг</span>
                  </button>
                  <Tooltip content="Отозвать VPN-ключ">
                    <button
                      onClick={() => onDeleteKey(k)}
                      aria-label="Отозвать ключ"
                      className="p-2.5 text-[#718187] hover:text-rose-400 bg-[#06141B] hover:bg-rose-950/30 rounded-xl border border-[#1C3945] hover:border-rose-800/60 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
