import React, { useState, useEffect } from 'react';
import { Shield, ShieldOff, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { TrafficPolicyMode, TorrentBlocklistEntry } from '../types';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';

const MODES: { value: TrafficPolicyMode; label: string; desc: string; disabled?: boolean }[] = [
  { value: 'off', label: 'Выключено', desc: 'Трафик не фильтруется' },
  { value: 'soft', label: 'Soft', desc: 'Порты + DHT/трекеры' },
  { value: 'strict', label: 'Strict', desc: 'L7/DPI · скоро', disabled: true },
];

export function TrafficPolicySettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<TrafficPolicyMode>('off');
  const [blocklist, setBlocklist] = useState<TorrentBlocklistEntry[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const view = await api.getTrafficPolicy();
      setMode(view.mode);
      setBlocklist(Array.isArray(view.blocklist) ? view.blocklist : []);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки политики трафика');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeChange = async (next: TrafficPolicyMode) => {
    if (next === 'strict') return;
    try {
      setSaving(true);
      const res = await api.updateTrafficPolicy(next);
      setMode(next);
      const suffix = res.failed_nodes ? `, ошибок: ${res.failed_nodes}` : '';
      toast.success(`Политика применена (нод: ${res.applied_nodes}${suffix})`);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка применения политики');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const domain = newDomain.trim();
    if (!domain) return;
    try {
      const entry = await api.addTorrentBlocklist(domain);
      setBlocklist((prev) => (prev.some((x) => x.id === entry.id) ? prev : [...prev, entry]));
      setNewDomain('');
      toast.success('Домен добавлен в блок-лист');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка добавления домена');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteTorrentBlocklist(id);
      setBlocklist((prev) => prev.filter((x) => x.id !== id));
      toast.success('Домен удален из блок-листа');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления домена');
    }
  };

  if (loading) {
    return <Loader size="section" text="Загрузка политики трафика..." />;
  }

  return (
    <div className="bg-[#06141B]/70 border border-[#1C3945] rounded-2xl p-6 shadow-xl relative overflow-hidden">
      <div className="flex items-center space-x-3 mb-5">
        <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-serif text-base font-bold text-[#F2F0E8]">Фильтрация торрент-трафика</h4>
          <p className="text-xs text-[#A8B4B7] font-sans">
            Глобальная политика для всех нод (каскад M0 и прямые серверы)
          </p>
        </div>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              disabled={m.disabled || saving}
              onClick={() => handleModeChange(m.value)}
              className={`relative rounded-xl border p-4 text-left transition ${
                active
                  ? 'border-[#D9B96E] bg-amber-500/10 shadow-lg shadow-amber-500/10'
                  : m.disabled
                    ? 'border-[#1C3945] bg-[#0A1D26]/50 opacity-50 cursor-not-allowed'
                    : 'border-[#1C3945] bg-[#0A1D26] hover:border-[#D9B96E]/50'
              }`}
            >
              <div className="flex items-center space-x-2">
                {m.value === 'off' && <ShieldOff className="w-4 h-4 text-slate-400" />}
                {m.value === 'soft' && <Shield className="w-4 h-4 text-[#D9B96E]" />}
                {m.value === 'strict' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
                <span className={`font-mono font-bold text-xs uppercase tracking-wider ${active ? 'text-[#D9B96E]' : 'text-[#F2F0E8]'}`}>
                  {m.label}
                </span>
              </div>
              <p className="text-[11px] text-[#A8B4B7] font-sans mt-1.5">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Blocklist editor */}
      <div className="border-t border-[#1C3945] pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider">
            Блок-лист трекеров и DHT ({blocklist.length})
          </div>
          <span className="text-[11px] text-[#718187] font-sans">
            Домены резолвятся в IP и блокируются на нодах
          </span>
        </div>

        <form onSubmit={handleAdd} className="flex gap-2 mb-3">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="например: tracker.example.com"
            className="flex-1 bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
          />
          <button
            type="submit"
            disabled={!newDomain.trim()}
            className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono shadow-lg shadow-[#D9B96E]/20 transition disabled:opacity-40 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить</span>
          </button>
        </form>

        {blocklist.length === 0 ? (
          <div className="text-center py-6 text-[#718187] text-xs font-mono border border-dashed border-[#1C3945] rounded-xl">
            Блок-лист пуст. Добавьте домен трекера или DHT-ноды.
          </div>
        ) : (
          <div className="border border-[#1C3945] rounded-xl divide-y divide-[#1C3945]/50 overflow-hidden">
            {blocklist.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-[#06141B] hover:bg-[#102833]/40 transition">
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="text-sm text-[#F2F0E8] font-mono truncate">{e.domain}</span>
                  {e.added_by === 'system' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40 shrink-0">
                      system
                    </span>
                  )}
                </div>
                <Tooltip content="Удалить из блок-листа">
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="p-1.5 rounded-lg border border-rose-800/50 text-rose-400 hover:bg-rose-950/40 transition shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
