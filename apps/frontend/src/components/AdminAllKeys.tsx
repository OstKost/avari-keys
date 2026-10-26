import { useState, useEffect, useCallback } from 'react';
import { Key, Trash2, Search, Filter, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { api } from '../api/client';
import { ClientConfigSummary, AdminNode } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';
import { formatNodeRouting } from '../utils/country';

export function AdminAllKeys() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ClientConfigSummary[]>([]);
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Confirm delete modal state
  const [keyToDelete, setKeyToDelete] = useState<ClientConfigSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchNodes = async () => {
    try {
      const data = await api.getAdminNodes();
      setNodes(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  };

  const fetchKeys = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.getAdminKeys({
        search: search.trim() || undefined,
        nodeId: selectedNodeId,
        page,
        limit,
      });
      setKeys(Array.isArray(res?.keys) ? res.keys : []);
      setTotalPages(res?.total_pages || 1);
      setTotalCount(res?.total_count || 0);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки реестра ключей');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, selectedNodeId, page, limit, toast]);

  useEffect(() => {
    fetchNodes();
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleConfirmDelete = async () => {
    if (!keyToDelete) return;
    const target = keyToDelete;
    const prevKeys = [...keys];
    const prevTotal = totalCount;

    // Optimistic deletion
    setKeys((prev) => prev.filter((k) => k.id !== target.id));
    setTotalCount((prev) => Math.max(0, prev - 1));
    setKeyToDelete(null);

    try {
      setIsDeleting(true);
      await api.deleteKey(target.id);
      toast.success(`Ключ «${target.device_name}» (${target.client_name}) отозван`);
      fetchKeys(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления ключа');
      setKeys(prevKeys);
      setTotalCount(prevTotal);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1); // reset to page 1 on search
  };

  const handleNodeFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value ? Number(e.target.value) : undefined;
    setSelectedNodeId(val);
    setPage(1);
  };

  const handleLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLimit(Number(e.target.value));
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#F2F0E8] flex items-center space-x-2">
            <Key className="w-5 h-5 text-[#D9B96E]" />
            <span>Сводный реестр и аудит VPN-ключей</span>
          </h3>
          <p className="text-sm text-[#A8B4B7] mt-1 font-sans">
            Мониторинг активности, учет трафика (Total / Monthly) и управление ключами по всем узлам сети.
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 text-[#718187] absolute left-3.5 top-3.5" />
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Поиск по устройству, имени пира или ноде..."
            className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-10 pr-10 py-2.5 text-sm text-[#F2F0E8] placeholder-[#718187] focus:outline-none transition shadow-inner font-sans"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-3.5 top-3.5 text-[#718187] hover:text-[#F2F0E8]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="relative">
          <Filter className="w-4 h-4 text-[#D9B96E] absolute left-3.5 top-3.5 pointer-events-none" />
          <select
            value={selectedNodeId || ''}
            onChange={handleNodeFilterChange}
            className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-10 pr-9 py-2.5 text-sm text-[#F2F0E8] focus:outline-none font-mono transition appearance-none cursor-pointer"
          >
            <option value="">Все серверы / узлы</option>
            {(nodes || []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({formatNodeRouting(n.type, n.country_code).fullText})
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[#718187] absolute right-3.5 top-3.5 pointer-events-none" />
        </div>
      </div>

      {/* Keys Table */}
      <div className="overflow-x-auto border border-[#1C3945] rounded-2xl bg-[#06141B]/60 shadow-xl mb-4">
        <table className="w-full text-left text-sm text-[#F2F0E8] min-w-[760px]">
          <thead className="bg-[#102833]/90 text-sm font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
            <tr>
              <th className="px-5 py-3.5">ID</th>
              <th className="px-5 py-3.5">Устройство / Пир</th>
              <th className="px-5 py-3.5">User</th>
              <th className="px-5 py-3.5">Сервер</th>
              <th className="px-5 py-3.5">Активность (Handshake)</th>
              <th className="px-5 py-3.5">Трафик (Всего / Месяц)</th>
              <th className="px-5 py-3.5">Создан</th>
              <th className="px-5 py-3.5 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C3945]/70 bg-[#0A1D26]/40 font-sans">
            {(keys || []).map((k) => (
              <tr key={k.id} className="hover:bg-[#102833]/50 transition duration-150">
                <td className="px-5 py-3.5 text-[#718187] font-mono text-sm">#{k.id}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#F2F0E8] text-sm">{k.device_name}</span>
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
                  <div className="text-sm font-mono text-[#D9B96E] mt-0.5">{k.client_name}</div>
                </td>
                <td className="px-5 py-3.5 text-sm font-mono">
                  <span className="font-semibold text-[#F2F0E8]">{k.username || 'User'}</span>
                  <span className="text-[#D9B96E]">#{k.user_id}</span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex flex-col items-start gap-1">
                    <span
                      className={`text-sm font-mono font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-md ${
                        k.node_type === 'cascade'
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                          : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40'
                      }`}
                    >
                      {formatNodeRouting(k.node_type || 'direct', k.node_country_code).fullText}
                    </span>
                    <span className="text-sm font-mono text-[#A8B4B7] max-w-[190px] truncate" title={k.node_name}>
                      {k.node_name || 'Node'}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center space-x-1.5 text-sm font-mono text-[#A8B4B7]">
                    <span className={`w-2 h-2 rounded-full ${k.last_handshake && !k.last_handshake.includes('Не') ? 'bg-emerald-400 animate-pulse' : 'bg-[#718187]'}`} />
                    <span>{k.last_handshake || 'Не подключался'}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="text-sm font-mono font-semibold text-[#F2F0E8]">
                    {k.total_traffic_formatted || '0 B'}
                  </div>
                  <div className="text-sm font-mono text-[#718187]">
                    Месяц: {k.month_traffic_formatted || '0 B'}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-[#718187] font-mono">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Tooltip content="Отозвать и удалить VPN-ключ">
                    <button
                      onClick={() => setKeyToDelete(k)}
                      aria-label="Отозвать и удалить ключ"
                      className="p-2 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                </td>
              </tr>
            ))}
            {loading && (
              <Loader size="table" colSpan={8} text="Загрузка реестра VPN-ключей..." />
            )}
            {(keys || []).length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[#718187] text-sm font-mono uppercase tracking-wider">
                  {search || selectedNodeId ? 'По заданным фильтрам ключи не найдены.' : 'Пока не выпущено ни одной конфигурации.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-2 text-sm text-[#A8B4B7] font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              Показано {(page - 1) * limit + 1}–{Math.min(page * limit, totalCount)} из {totalCount} ключей
            </div>
            <div className="flex items-center space-x-2 text-xs text-[#718187]">
              <span>По:</span>
              <select
                value={limit}
                onChange={handleLimitChange}
                className="bg-[#06141B] border border-[#1C3945] rounded-lg px-2 py-1 text-xs text-[#D9B96E] font-mono focus:outline-none cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center space-x-1 px-3.5 py-2 rounded-lg border border-[#1C3945] bg-[#102833] hover:bg-[#1C3945] text-[#F2F0E8] disabled:opacity-40 disabled:hover:bg-[#102833] disabled:cursor-not-allowed cursor-pointer transition shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>

            {/* Page number buttons */}
            <div className="flex items-center space-x-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => {
                  const prev = arr[idx - 1];
                  const showEllipsis = prev && p - prev > 1;
                  return (
                    <div key={p} className="flex items-center space-x-1">
                      {showEllipsis && <span className="px-1 text-[#718187]">...</span>}
                      <button
                        onClick={() => setPage(p)}
                        className={`min-w-[36px] h-9 px-2.5 rounded-lg border text-sm font-mono font-bold transition cursor-pointer ${
                          page === p
                            ? 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] text-[#06141B] border-[#D9B96E] shadow-md shadow-[#D9B96E]/20'
                            : 'bg-[#06141B] border-[#1C3945] text-[#A8B4B7] hover:text-[#F2F0E8] hover:bg-[#102833]'
                        }`}
                      >
                        {p}
                      </button>
                    </div>
                  );
                })}
            </div>

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center space-x-1 px-3.5 py-2 rounded-lg border border-[#1C3945] bg-[#102833] hover:bg-[#1C3945] text-[#F2F0E8] disabled:opacity-40 disabled:hover:bg-[#102833] disabled:cursor-not-allowed cursor-pointer transition shadow-sm"
            >
              <span>Вперед</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Revoke Key Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(keyToDelete)}
        title="Отозвать и удалить ключ?"
        variant="danger"
        confirmText="Да, отозвать ключ"
        cancelText="Отмена"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setKeyToDelete(null)}
        message={
          keyToDelete && (
            <div>
              Вы собираетесь безвозвратно отозвать ключ устройства{' '}
              <strong className="text-[#F2F0E8]">«{keyToDelete.device_name}»</strong> (клиент{' '}
              <code className="text-[#D9B96E] font-mono">{keyToDelete.client_name}</code>, User #{keyToDelete.user_id}).
              Конфигурация на стороне пользователя и на ноде будет аннулирована.
            </div>
          )
        }
      />
    </div>
  );
}

