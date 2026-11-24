import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UserCheck,
  UserX,
  Trash2,
  Users,
  ShieldPlus,
  ShieldMinus,
  Sparkles,
  KeyRound,
  XCircle,
  Search,
  CheckCircle2,
  X,
  ChevronRight,
  Key,
  Shield,
  Activity,
} from 'lucide-react';
import { api } from '../api/client';
import { User, ClientConfigSummary } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';
import { animatedPortal as createPortal } from './animatedPortal';

type UserFilterTab = 'all' | 'pending' | 'pwd_reset' | 'pro' | 'inactive';

interface UserDetailDrawerProps {
  user: User;
  onClose: () => void;
  onToggleActive: (u: User) => void;
  onTogglePro: (u: User, newPro: boolean) => void;
  onToggleRole: (u: User, newRole: 'admin' | 'user') => void;
  onPasswordReset: (u: User, action: 'approve' | 'reject') => void;
  onDeleteUser: (u: User) => void;
}

function UserDetailDrawer({
  user,
  onClose,
  onToggleActive,
  onTogglePro,
  onToggleRole,
  onPasswordReset,
  onDeleteUser,
}: UserDetailDrawerProps) {
  const { toast } = useToast();
  const [userKeys, setUserKeys] = useState<ClientConfigSummary[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [keyToDelete, setKeyToDelete] = useState<ClientConfigSummary | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  const fetchUserKeys = useCallback(async () => {
    try {
      setLoadingKeys(true);
      const res = await api.getAdminKeys({ search: user.username, limit: 50 });
      // Filter exactly by user id to prevent substring collisions
      const matched = (res?.keys || []).filter((k) => k.user_id === user.id);
      setUserKeys(matched);
    } catch {
      // Fallback
    } finally {
      setLoadingKeys(false);
    }
  }, [user.id, user.username]);

  useEffect(() => {
    fetchUserKeys();
  }, [fetchUserKeys]);

  const handleRevokeKey = async () => {
    if (!keyToDelete) return;
    try {
      setDeletingKey(true);
      await api.deleteKey(keyToDelete.id);
      toast.success(`Ключ «${keyToDelete.device_name}» отозван`);
      setKeyToDelete(null);
      fetchUserKeys();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления ключа');
    } finally {
      setDeletingKey(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#02080D]/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="relative w-full max-w-xl bg-[#06141B] border-l border-[#1C3945] shadow-2xl h-full flex flex-col z-10 animate-slideInRight overflow-y-auto">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-[#1C3945] flex items-center justify-between sticky top-0 bg-[#06141B]/95 backdrop-blur-md z-20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#102833] to-[#1C3945] border border-[#D9B96E]/30 flex items-center justify-center text-[#F0D48D] font-bold font-mono text-base shadow-md">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold font-serif text-[#F2F0E8]">{user.username}</h3>
                <span className="text-xs font-mono text-[#718187]">#{user.id}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    user.role === 'admin'
                      ? 'bg-[#D9B96E]/20 text-[#F0D48D] border border-[#D9B96E]/40'
                      : 'bg-[#102833] text-[#A8B4B7] border border-[#1C3945]'
                  }`}
                >
                  {user.role === 'admin' ? 'Администратор' : 'Пользователь'}
                </span>

                {user.is_pro && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40 flex items-center space-x-1">
                    <Sparkles className="w-3 h-3 text-purple-300" />
                    <span>PRO</span>
                  </span>
                )}

                <span
                  className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    user.is_active
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                      : 'bg-amber-950/80 text-amber-300 border border-amber-600/40 animate-pulse'
                  }`}
                >
                  {user.is_active ? 'Активен' : 'Ожидает одобрения'}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#A8B4B7] hover:text-[#F2F0E8] hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-6 flex-1">
          {/* Quick status alerts */}
          {user.has_pending_password_reset && (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-600/50 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <KeyRound className="w-5 h-5 text-amber-300 animate-pulse" />
                <div>
                  <div className="text-sm font-semibold text-amber-200">Запрос на смену пароля</div>
                  <div className="text-xs text-amber-300/80">Пользователь ожидает подтверждения сброса</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => onPasswordReset(user, 'approve')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition shadow-sm"
                >
                  Одобрить
                </button>
                <button
                  onClick={() => onPasswordReset(user, 'reject')}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-900/40 hover:bg-rose-900/70 text-rose-300 border border-rose-800/40 text-xs font-mono transition"
                >
                  Отклонить
                </button>
              </div>
            </div>
          )}

          {!user.is_active && (
            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-600/40 flex items-center justify-between">
              <div className="text-xs text-amber-300">
                Новый пользователь. Доступ к созданию VPN-ключей заблокирован до одобрения.
              </div>
              <button
                onClick={() => onToggleActive(user)}
                className="px-3.5 py-1.5 rounded-xl bg-[#D9B96E] hover:bg-[#F0D48D] text-[#06141B] font-bold text-xs font-mono transition shadow-md shrink-0 ml-3"
              >
                Одобрить доступ
              </button>
            </div>
          )}

          {/* User Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-[#0A1D26] border border-[#1C3945]/60">
              <div className="text-[11px] font-mono text-[#718187] uppercase tracking-wider">Регистрация</div>
              <div className="text-sm font-mono text-[#F2F0E8] mt-1">
                {new Date(user.created_at).toLocaleDateString()}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#0A1D26] border border-[#1C3945]/60">
              <div className="text-[11px] font-mono text-[#718187] uppercase tracking-wider">Трафик за месяц</div>
              <div className="text-sm font-mono text-[#F2F0E8] font-bold mt-1">
                {user.month_traffic_formatted || '0 B'}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#0A1D26] border border-[#1C3945]/60">
              <div className="text-[11px] font-mono text-[#718187] uppercase tracking-wider">Устройств / Ключей</div>
              <div className="text-sm font-mono text-[#D9B96E] font-bold mt-1">
                {userKeys.length} {userKeys.length === 1 ? 'ключ' : 'ключей'}
              </div>
            </div>
          </div>

          {/* User VPN Keys List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7] flex items-center space-x-1.5">
                <Key className="w-3.5 h-3.5 text-[#D9B96E]" />
                <span>Устройства и конфигурации пользователя</span>
              </h4>
              <span className="text-xs font-mono text-[#718187]">{userKeys.length} шт.</span>
            </div>

            {loadingKeys ? (
              <div className="py-6 text-center text-xs text-[#718187] font-mono">Загрузка ключей...</div>
            ) : userKeys.length === 0 ? (
              <div className="p-5 rounded-2xl bg-[#0A1D26]/60 border border-[#1C3945]/60 text-center text-xs text-[#718187] font-mono">
                У пользователя пока нет созданных конфигураций
              </div>
            ) : (
              <div className="space-y-2">
                {userKeys.map((k) => (
                  <div
                    key={k.id}
                    className="p-3.5 rounded-2xl bg-[#0A1D26]/90 border border-[#1C3945] flex items-center justify-between gap-3 hover:border-[#D9B96E]/30 transition"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm text-[#F2F0E8] truncate">
                          {k.device_name}
                        </span>
                        {k.protocol === 'hysteria2' ? (
                          <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-violet-950 text-violet-300 border border-violet-500/40">
                            Hy2
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30">
                            AWG
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-[#A8B4B7] flex items-center space-x-2">
                        <span>{k.node_name || 'Узел'}</span>
                        <span>•</span>
                        <span className="text-[#718187]">
                          {k.last_handshake || 'Не подключался'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setKeyToDelete(k)}
                      title="Отозвать этот ключ"
                      className="p-2 rounded-xl border border-rose-900/40 bg-rose-950/30 text-rose-400 hover:bg-rose-900/60 transition shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Management Actions */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-mono uppercase tracking-wider text-[#A8B4B7] flex items-center space-x-1.5">
              <Shield className="w-3.5 h-3.5 text-[#D9B96E]" />
              <span>Действия с учетной записью</span>
            </h4>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onToggleActive(user)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-mono font-semibold transition ${
                  user.is_active
                    ? 'border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/50'
                    : 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50'
                }`}
              >
                {user.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                <span>{user.is_active ? 'Деактивировать' : 'Активировать'}</span>
              </button>

              <button
                onClick={() => onTogglePro(user, !user.is_pro)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-mono font-semibold transition ${
                  user.is_pro
                    ? 'border-purple-600/50 bg-purple-950/40 text-purple-300 hover:bg-purple-900/60'
                    : 'border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#D9B96E] hover:border-[#D9B96E]/40'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{user.is_pro ? 'Отозвать PRO' : 'Выдать PRO'}</span>
              </button>

              <button
                onClick={() => onToggleRole(user, user.role === 'admin' ? 'user' : 'admin')}
                className="flex items-center justify-center space-x-2 p-2.5 rounded-xl border border-[#D9B96E]/40 bg-[#102833] text-[#D9B96E] hover:bg-[#153442] text-xs font-mono font-semibold transition"
              >
                {user.role === 'admin' ? <ShieldMinus className="w-3.5 h-3.5" /> : <ShieldPlus className="w-3.5 h-3.5" />}
                <span>{user.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</span>
              </button>

              {user.role !== 'admin' && (
                <button
                  onClick={() => onDeleteUser(user)}
                  className="flex items-center justify-center space-x-2 p-2.5 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 text-xs font-mono font-semibold transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Удалить аккаунт</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Delete Single Key Modal */}
        <ConfirmModal
          isOpen={Boolean(keyToDelete)}
          title="Отозвать ключ?"
          message={`Вы уверены, что хотите отозвать ключ «${keyToDelete?.device_name}»? Устройство пользователя потеряет доступ к VPN-серверу.`}
          confirmText="Отозвать"
          cancelText="Отмена"
          variant="danger"
          isLoading={deletingKey}
          onConfirm={handleRevokeKey}
          onClose={() => setKeyToDelete(null)}
        />
      </div>
    </div>,
    document.body
  );
}

export function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<UserFilterTab>('all');
  const [sortByTraffic, setSortByTraffic] = useState(false);

  // Selected User for Drawer
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Modals state
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ user: User; newRole: 'admin' | 'user' } | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [proChangeTarget, setProChangeTarget] = useState<{ user: User; newPro: boolean } | null>(null);
  const [changingPro, setChangingPro] = useState(false);
  const [pwdResetTarget, setPwdResetTarget] = useState<{ user: User; action: 'approve' | 'reject' } | null>(null);
  const [processingPwdReset, setProcessingPwdReset] = useState(false);

  // Bulk approval state
  const [approvingAll, setApprovingAll] = useState(false);

  const fetchUsers = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await api.getAdminUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки пользователей');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(false);
  }, []);

  // Update selectedUser if users list refreshes
  useEffect(() => {
    if (selectedUser) {
      const updated = users.find((u) => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
    }
  }, [users, selectedUser]);

  const handleToggleActive = async (user: User) => {
    const previousUsers = [...users];
    const willBeActive = !user.is_active;

    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, is_active: willBeActive } : u))
    );

    try {
      if (user.is_active) {
        await api.deactivateUser(user.id);
        toast.info(`Пользователь «${user.username}» деактивирован`);
      } else {
        await api.activateUser(user.id);
        toast.success(`Пользователь «${user.username}» успешно одобрен и активирован`);
      }
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка изменения статуса пользователя');
      setUsers(previousUsers);
    }
  };

  const handleBulkApprove = async () => {
    const pending = users.filter((u) => !u.is_active);
    if (pending.length === 0) return;

    try {
      setApprovingAll(true);
      const results = await Promise.allSettled(pending.map((u) => api.activateUser(u.id)));
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      toast.success(`Успешно одобрено пользователей: ${succeeded} из ${pending.length}`);
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка при массовом одобрении');
    } finally {
      setApprovingAll(false);
    }
  };

  const handleConfirmRoleChange = async () => {
    if (!roleChangeTarget) return;
    const target = roleChangeTarget;
    const previousUsers = [...users];

    setUsers((prev) =>
      prev.map((u) => (u.id === target.user.id ? { ...u, role: target.newRole } : u))
    );
    setRoleChangeTarget(null);

    try {
      setChangingRole(true);
      await api.setUserRole(target.user.id, target.newRole);
      toast.success(
        `Роль «${target.user.username}» успешно изменена на ${
          target.newRole === 'admin' ? 'Администратор' : 'Пользователь'
        }`
      );
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка изменения роли');
      setUsers(previousUsers);
    } finally {
      setChangingRole(false);
    }
  };

  const handleConfirmProChange = async () => {
    if (!proChangeTarget) return;
    const target = proChangeTarget;
    const previousUsers = [...users];

    setUsers((prev) =>
      prev.map((u) => (u.id === target.user.id ? { ...u, is_pro: target.newPro } : u))
    );
    setProChangeTarget(null);

    try {
      setChangingPro(true);
      await api.setUserPro(target.user.id, target.newPro);
      toast.success(
        `Статус PRO для «${target.user.username}» ${target.newPro ? 'активирован' : 'отозван'}`
      );
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка изменения статуса PRO');
      setUsers(previousUsers);
    } finally {
      setChangingPro(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    const previousUsers = [...users];

    setUsers((prev) => prev.filter((u) => u.id !== target.id));
    if (selectedUser?.id === target.id) setSelectedUser(null);
    setUserToDelete(null);

    try {
      setDeleting(true);
      await api.deleteUser(target.id);
      toast.success(`Пользователь «${target.username}» успешно удален`);
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления пользователя');
      setUsers(previousUsers);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmPasswordReset = async () => {
    if (!pwdResetTarget) return;
    const { user, action } = pwdResetTarget;
    const previousUsers = [...users];

    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, has_pending_password_reset: false } : u))
    );
    setPwdResetTarget(null);

    try {
      setProcessingPwdReset(true);
      if (action === 'approve') {
        await api.approvePasswordReset(user.id);
        toast.success(`Сброс пароля для «${user.username}» одобрен`);
      } else {
        await api.rejectPasswordReset(user.id);
        toast.info(`Запрос на сброс пароля для «${user.username}» отклонен`);
      }
      fetchUsers(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обработки запроса сброса пароля');
      setUsers(previousUsers);
    } finally {
      setProcessingPwdReset(false);
    }
  };

  // Counts for filter pills
  const pendingCount = useMemo(() => users.filter((u) => !u.is_active).length, [users]);
  const pwdResetCount = useMemo(() => users.filter((u) => u.has_pending_password_reset).length, [users]);
  const proCount = useMemo(() => users.filter((u) => u.is_pro).length, [users]);
  const inactiveCount = useMemo(() => users.filter((u) => !u.is_active).length, [users]);

  // Filtered & Searched Users
  const filteredUsers = useMemo(() => {
    let list = users;

    // Filter tab
    if (activeTab === 'pending') {
      list = list.filter((u) => !u.is_active);
    } else if (activeTab === 'pwd_reset') {
      list = list.filter((u) => u.has_pending_password_reset);
    } else if (activeTab === 'pro') {
      list = list.filter((u) => u.is_pro);
    } else if (activeTab === 'inactive') {
      list = list.filter((u) => !u.is_active);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          String(u.id).includes(q) ||
          (u.role || '').toLowerCase().includes(q)
      );
    }

    // Sort by traffic if enabled
    if (sortByTraffic) {
      list = [...list].sort(
        (a, b) => (b.month_traffic_bytes || 0) - (a.month_traffic_bytes || 0)
      );
    }

    return list;
  }, [users, activeTab, searchQuery, sortByTraffic]);

  if (loading && users.length === 0) {
    return <Loader size="section" text="Загрузка списка пользователей..." />;
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header & Bulk Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#F2F0E8] flex items-center space-x-2">
            <Users className="w-5 h-5 text-[#D9B96E]" />
            <span>Управление пользователями</span>
          </h3>
          <p className="text-sm text-[#A8B4B7] mt-1 font-sans">
            Модерация заявок, назначение ролей, аудит устройств и детализация учетных записей.
          </p>
        </div>

        {pendingCount > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={approvingAll}
            className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 via-amber-400 to-[#D9B96E] hover:from-amber-400 hover:to-[#F0D48D] text-[#06141B] font-bold text-xs sm:text-sm font-mono px-4 py-2.5 rounded-xl shadow-lg shadow-amber-900/30 transition duration-200 cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{approvingAll ? 'Одобрение...' : `Одобрить все заявки (${pendingCount})`}</span>
          </button>
        )}
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition ${
              activeTab === 'all'
                ? 'bg-[#D9B96E] text-[#06141B] shadow-sm'
                : 'bg-[#0A1D26] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945]'
            }`}
          >
            Все ({users.length})
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
              activeTab === 'pending'
                ? 'bg-amber-500 text-[#06141B] shadow-sm'
                : 'bg-[#0A1D26] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945]'
            }`}
          >
            <span>Ожидают</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-950 text-amber-300 font-bold animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('pwd_reset')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
              activeTab === 'pwd_reset'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-[#0A1D26] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945]'
            }`}
          >
            <span>Сброс пароля</span>
            {pwdResetCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950 text-rose-300 font-bold">
                {pwdResetCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('pro')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
              activeTab === 'pro'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-[#0A1D26] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945]'
            }`}
          >
            <Sparkles className="w-3 h-3 text-purple-300" />
            <span>PRO ({proCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('inactive')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition ${
              activeTab === 'inactive'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'bg-[#0A1D26] text-[#718187] hover:text-[#A8B4B7] border border-[#1C3945]'
            }`}
          >
            Неактивные ({inactiveCount})
          </button>

          <button
            onClick={() => setSortByTraffic((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition flex items-center space-x-1 border ${
              sortByTraffic
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'bg-[#0A1D26] text-[#A8B4B7] hover:text-[#F2F0E8] border-[#1C3945]'
            }`}
            title="Сортировка по объему потребления трафика за календарный месяц"
          >
            <Activity className="w-3.5 h-3.5 text-[#D9B96E]" />
            <span>Топ трафика {sortByTraffic ? '↓' : ''}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-[#718187] absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Поиск по имени или ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-9 pr-8 py-2 text-xs sm:text-sm text-[#F2F0E8] placeholder-[#718187] focus:outline-none font-mono transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-[#718187] hover:text-[#F2F0E8]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto border border-[#1C3945] rounded-2xl bg-[#06141B]/60 shadow-xl">
        <table className="w-full text-left text-sm text-[#F2F0E8] min-w-[660px]">
          <thead className="bg-[#102833]/90 text-xs sm:text-sm font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
            <tr>
              <th className="px-5 py-3.5">ID</th>
              <th className="px-5 py-3.5">Имя пользователя</th>
              <th className="px-5 py-3.5">Роль</th>
              <th className="px-5 py-3.5">Тариф</th>
              <th className="px-5 py-3.5">Статус</th>
              <th
                className="px-5 py-3.5 cursor-pointer hover:text-[#D9B96E] transition select-none"
                onClick={() => setSortByTraffic((prev) => !prev)}
                title="Нажмите для сортировки по расходу за месяц"
              >
                <div className="flex items-center space-x-1">
                  <span>Трафик/мес</span>
                  {sortByTraffic && <span className="text-[#D9B96E]">↓</span>}
                </div>
              </th>
              <th className="px-5 py-3.5">Регистрация</th>
              <th className="px-5 py-3.5 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C3945]/70 bg-[#0A1D26]/40 font-sans">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-xs text-[#718187] font-mono">
                  Пользователи не найдены
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="hover:bg-[#102833]/70 transition duration-150 cursor-pointer group"
                >
                  <td className="px-5 py-3.5 text-[#718187] font-mono text-sm">#{u.id}</td>
                  <td className="px-5 py-3.5 font-medium text-[#F2F0E8] text-sm">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold group-hover:text-[#F0D48D] transition-colors">
                        {u.username}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#718187] group-hover:text-[#D9B96E] opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-0.5" />
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-xs font-mono font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                        u.role === 'admin'
                          ? 'bg-[#D9B96E]/20 text-[#F0D48D] border border-[#D9B96E]/40'
                          : 'bg-[#102833] text-[#A8B4B7] border border-[#1C3945]'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {u.is_pro ? (
                      <span className="inline-flex items-center space-x-1 text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-600/40 shadow-sm">
                        <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                        <span>PRO</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs font-mono text-[#718187] px-2 py-0.5 rounded-full bg-[#06141B] border border-[#1C3945]">
                        Стандарт
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col space-y-1">
                      <span
                        className={`inline-flex items-center text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full w-fit ${
                          u.is_active
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-600/40 animate-pulse'
                        }`}
                      >
                        {u.is_active ? 'Активен' : 'Ожидает одобрения'}
                      </span>
                      {u.has_pending_password_reset && (
                        <span className="inline-flex items-center space-x-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-950/90 text-rose-300 border border-rose-500/50 animate-pulse w-fit">
                          <KeyRound className="w-3 h-3 text-rose-300" />
                          <span>Сброс пароля</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`font-semibold ${
                          u.month_traffic_bytes &&
                          u.month_traffic_bytes > 100 * 1024 * 1024 * 1024
                            ? 'text-amber-400'
                            : 'text-[#F2F0E8]'
                        }`}
                      >
                        {u.month_traffic_formatted || '0 B'}
                      </span>
                      {u.month_traffic_bytes &&
                        u.month_traffic_bytes > 100 * 1024 * 1024 * 1024 && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold"
                            title="Повышенный расход трафика"
                          >
                            Heavy
                          </span>
                        )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-[#A8B4B7] font-mono">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td
                    className="px-5 py-3.5 text-right space-x-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Password Reset Actions */}
                    {u.has_pending_password_reset && (
                      <>
                        <Tooltip content="Одобрить новый пароль">
                          <button
                            onClick={() => setPwdResetTarget({ user: u, action: 'approve' })}
                            className="p-1.5 rounded-lg border border-emerald-500/60 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/70 transition"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>

                        <Tooltip content="Отклонить сброс пароля">
                          <button
                            onClick={() => setPwdResetTarget({ user: u, action: 'reject' })}
                            className="p-1.5 rounded-lg border border-rose-800/60 bg-rose-950/40 text-rose-400 hover:bg-rose-900/60 transition"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </>
                    )}

                    {/* Toggle Active / Deactivate */}
                    <Tooltip content={u.is_active ? 'Деактивировать' : 'Одобрить и активировать'}>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`p-1.5 rounded-lg border transition ${
                          u.is_active
                            ? 'border-amber-700/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/50'
                            : 'border-emerald-700/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/50'
                        }`}
                      >
                        {u.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                      </button>
                    </Tooltip>

                    {/* Toggle PRO Status */}
                    <Tooltip content={u.is_pro ? 'Отозвать тариф PRO' : 'Предоставить тариф PRO'}>
                      <button
                        onClick={() => setProChangeTarget({ user: u, newPro: !u.is_pro })}
                        className={`p-1.5 rounded-lg border transition ${
                          u.is_pro
                            ? 'border-purple-600/50 bg-purple-950/40 text-purple-300 hover:bg-purple-900/60'
                            : 'border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#D9B96E]'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>

                    {/* Promote / Demote Admin */}
                    {u.role !== 'admin' ? (
                      <Tooltip content="Повысить до Администратора">
                        <button
                          onClick={() => setRoleChangeTarget({ user: u, newRole: 'admin' })}
                          className="p-1.5 rounded-lg border border-[#D9B96E]/40 bg-[#102833] text-[#D9B96E] hover:bg-[#1C3945] transition"
                        >
                          <ShieldPlus className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Снять права Администратора">
                        <button
                          onClick={() => setRoleChangeTarget({ user: u, newRole: 'user' })}
                          className="p-1.5 rounded-lg border border-[#1C3945] bg-[#06141B] text-[#718187] hover:text-[#F2F0E8] transition"
                        >
                          <ShieldMinus className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    )}

                    {/* Delete User */}
                    {u.role !== 'admin' && (
                      <Tooltip content="Удалить пользователя">
                        <button
                          onClick={() => setUserToDelete(u)}
                          className="p-1.5 rounded-lg border border-rose-800/50 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-over User Detail Drawer */}
      {selectedUser && (
        <UserDetailDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggleActive={handleToggleActive}
          onTogglePro={(u, newPro) => setProChangeTarget({ user: u, newPro })}
          onToggleRole={(u, newRole) => setRoleChangeTarget({ user: u, newRole })}
          onPasswordReset={(u, action) => setPwdResetTarget({ user: u, action })}
          onDeleteUser={(u) => setUserToDelete(u)}
        />
      )}

      {/* PRO Change Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(proChangeTarget)}
        title={proChangeTarget?.newPro ? 'Предоставить тариф PRO?' : 'Отозвать тариф PRO?'}
        variant={proChangeTarget?.newPro ? 'gold' : 'warning'}
        confirmText={proChangeTarget?.newPro ? 'Да, предоставить PRO' : 'Да, отозвать PRO'}
        cancelText="Отмена"
        isLoading={changingPro}
        onConfirm={handleConfirmProChange}
        onClose={() => setProChangeTarget(null)}
        message={
          proChangeTarget && (
            <div>
              Вы собираетесь {proChangeTarget.newPro ? 'предоставить' : 'отозвать'} статус{' '}
              <span className="text-purple-300 font-bold font-mono">PRO</span> пользователю{' '}
              <strong className="text-[#F2F0E8]">«{proChangeTarget.user.username}»</strong>.
            </div>
          )
        }
      />

      {/* Role Change Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(roleChangeTarget)}
        title={roleChangeTarget?.newRole === 'admin' ? 'Повысить до Администратора?' : 'Снять права Администратора?'}
        variant={roleChangeTarget?.newRole === 'admin' ? 'warning' : 'danger'}
        confirmText={roleChangeTarget?.newRole === 'admin' ? 'Да, назначить администратором' : 'Да, снять права'}
        cancelText="Отмена"
        isLoading={changingRole}
        onConfirm={handleConfirmRoleChange}
        onClose={() => setRoleChangeTarget(null)}
        message={
          roleChangeTarget && (
            <div>
              Вы собираетесь изменить роль пользователя{' '}
              <strong className="text-[#F2F0E8]">«{roleChangeTarget.user.username}»</strong> на{' '}
              <span className="text-[#D9B96E] font-semibold">
                {roleChangeTarget.newRole === 'admin' ? 'Администратор' : 'Пользователь'}
              </span>.
            </div>
          )
        }
      />

      {/* Delete User Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(userToDelete)}
        title="Удалить пользователя?"
        variant="danger"
        confirmText="Да, удалить аккаунт"
        cancelText="Отмена"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setUserToDelete(null)}
        message={
          userToDelete && (
            <div>
              Вы собираетесь полностью удалить аккаунт пользователя{' '}
              <strong className="text-[#F2F0E8]">«{userToDelete.username}»</strong>.
              Все привязанные к пользователю VPN-ключи будут удалены.
            </div>
          )
        }
      />

      {/* Password Reset Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(pwdResetTarget)}
        title={pwdResetTarget?.action === 'approve' ? 'Одобрить сброс пароля?' : 'Отклонить сброс пароля?'}
        variant={pwdResetTarget?.action === 'approve' ? 'gold' : 'danger'}
        confirmText={pwdResetTarget?.action === 'approve' ? 'Да, одобрить пароль' : 'Да, отклонить сброс'}
        cancelText="Отмена"
        isLoading={processingPwdReset}
        onConfirm={handleConfirmPasswordReset}
        onClose={() => setPwdResetTarget(null)}
        message={
          pwdResetTarget && (
            <div>
              {pwdResetTarget.action === 'approve' ? (
                <p className="text-sm text-[#A8B4B7]">
                  Вы собираетесь подтвердить новый пароль для <strong className="text-[#F2F0E8]">«{pwdResetTarget.user.username}»</strong>.
                </p>
              ) : (
                <p className="text-sm text-[#A8B4B7]">
                  Вы собираетесь отклонить смену пароля для <strong className="text-[#F2F0E8]">«{pwdResetTarget.user.username}»</strong>.
                </p>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
