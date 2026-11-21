import { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  ArrowRightLeft,
  RotateCcw,
  ChevronRight,
} from 'lucide-react';
import { api } from '../api/client';
import { EgressStatusResponse, AdminNode } from '../types';
import { useToast } from '../context/ToastContext';
import { ConfirmModal } from './ConfirmModal';

interface EgressPanicBarProps {
  onNavigateNodes?: () => void;
}

export function EgressPanicBar({ onNavigateNodes }: EgressPanicBarProps) {
  const { toast } = useToast();
  const [egressData, setEgressData] = useState<EgressStatusResponse | null>(null);
  const [nodes, setNodes] = useState<AdminNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetToSwitch, setTargetToSwitch] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const cascadeNode = useMemo(() => nodes.find((n) => n.type === 'cascade'), [nodes]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const nodesList = await api.getAdminNodes();
      const safeNodes = Array.isArray(nodesList) ? nodesList : [];
      setNodes(safeNodes);

      const cascade = safeNodes.find((n) => n.type === 'cascade');
      if (cascade) {
        const egress = await api.getNodeEgress(cascade.id);
        setEgressData(egress);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const activeTarget = useMemo(() => {
    if (!egressData?.targets || !egressData.active_interface) return null;
    return egressData.targets.find((t) => t.interface === egressData.active_interface) || null;
  }, [egressData]);

  const standbyTargets = useMemo(() => {
    if (!egressData?.targets) return [];
    return egressData.targets.filter((t) => t.interface !== egressData.active_interface);
  }, [egressData]);

  const onlineNodesCount = useMemo(() => nodes.filter((n) => n.online).length, [nodes]);

  const handleConfirmSwitch = async () => {
    if (!targetToSwitch || !cascadeNode) return;
    try {
      setSwitching(true);
      const resp = await api.switchNodeEgress(cascadeNode.id, targetToSwitch);
      toast.success(resp.message || `Egress переключен на ${targetToSwitch}`);
      setTargetToSwitch(null);
      fetchStatus();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка переключения Egress');
    } finally {
      setSwitching(false);
    }
  };

  if (!egressData?.active_interface && nodes.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 p-3 sm:p-4 rounded-2xl bg-gradient-to-r from-[#06141B] via-[#0D1826] to-[#120B22] border border-[#1C3945] shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
      {/* Active Egress Info */}
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-xl bg-purple-950/80 border border-purple-600/40 flex items-center justify-center text-purple-300 shrink-0">
          <Zap className="w-4 h-4 text-purple-300 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[11px] uppercase tracking-wider text-[#A8B4B7]">
              Каскадный Egress:
            </span>
            <span className="font-bold text-[#F0D48D] text-sm">
              {activeTarget?.label || egressData?.active_interface || 'Авто'}
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
          </div>
          <div className="text-[11px] text-[#718187] flex items-center space-x-2 mt-0.5">
            <span>Кластер: {onlineNodesCount}/{nodes.length} онлайн</span>
            {activeTarget?.passed_checks !== undefined && (
              <>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">
                  Кворум {activeTarget.passed_checks}/{activeTarget.total_checks ?? 5}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Standby Targets Quick-Switch */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[#A8B4B7] hidden lg:inline">Экстренный переход:</span>

        {standbyTargets.map((st) => (
          <button
            key={st.interface}
            onClick={() => setTargetToSwitch(st.interface)}
            className="px-2.5 py-1 rounded-xl bg-[#06141B] hover:bg-purple-950/80 text-purple-200 border border-purple-800/40 hover:border-purple-500 font-semibold transition shadow-sm flex items-center space-x-1 cursor-pointer"
          >
            <ArrowRightLeft className="w-3 h-3 text-purple-400" />
            <span>{st.label}</span>
          </button>
        ))}

        {onNavigateNodes && (
          <button
            onClick={onNavigateNodes}
            className="px-2.5 py-1 rounded-xl bg-[#0A1D26] hover:bg-[#102833] text-[#D9B96E] border border-[#1C3945] transition flex items-center space-x-1"
          >
            <span>Серверы</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={fetchStatus}
          disabled={loading}
          title="Обновить статус каскада"
          className="p-1.5 rounded-xl bg-[#0A1D26] hover:bg-[#102833] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945] transition disabled:opacity-50"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#D9B96E]' : ''}`} />
        </button>
      </div>

      {/* Confirm Switch Modal */}
      <ConfirmModal
        isOpen={Boolean(targetToSwitch)}
        title="Экстренное переключение каскада"
        message={`Перенаправить весь каскадный трафик пользователей через зарубежный узел «${targetToSwitch}»?`}
        confirmText={switching ? 'Переключение...' : 'Переключить сейчас'}
        cancelText="Отмена"
        variant="gold"
        isLoading={switching}
        onConfirm={handleConfirmSwitch}
        onClose={() => setTargetToSwitch(null)}
      />
    </div>
  );
}
