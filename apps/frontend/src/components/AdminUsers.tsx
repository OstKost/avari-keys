import { useState, useEffect } from 'react';
import { UserCheck, UserX, Trash2, Users, ShieldPlus, ShieldMinus, Sparkles, KeyRound, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { User } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';

export function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ user: User; newRole: 'admin' | 'user' } | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [proChangeTarget, setProChangeTarget] = useState<{ user: User; newPro: boolean } | null>(null);
  const [changingPro, setChangingPro] = useState(false);
  const [pwdResetTarget, setPwdResetTarget] = useState<{ user: User; action: 'approve' | 'reject' } | null>(null);
  const [processingPwdReset, setProcessingPwdReset] = useState(false);

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

  const handleToggleActive = async (user: User) => {
    const previousUsers = [...users];
    const willBeActive = !user.is_active;

    // Optimistic toggle
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

  const handleConfirmRoleChange = async () => {
    if (!roleChangeTarget) return;
    const target = roleChangeTarget;
    const previousUsers = [...users];

    // Optimistic role change
    setUsers((prev) =>
      prev.map((u) => (u.id === target.user.id ? { ...u, role: target.newRole } : u))
    );
    setRoleChangeTarget(null);

    try {
      setChangingRole(true);
      await api.setUserRole(target.user.id, target.newRole);
      toast.success(
        `Роль пользователя «${target.user.username}» успешно изменена на ${
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

    // Optimistic pro change
    setUsers((prev) =>
      prev.map((u) => (u.id === target.user.id ? { ...u, is_pro: target.newPro } : u))
    );
    setProChangeTarget(null);

    try {
      setChangingPro(true);
      await api.setUserPro(target.user.id, target.newPro);
      toast.success(
        `Статус PRO для «${target.user.username}» успешно ${target.newPro ? 'активирован' : 'отозван'}`
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

    // Optimistic removal
    setUsers((prev) => prev.filter((u) => u.id !== target.id));
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

    // Optimistic reset request removal
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, has_pending_password_reset: false } : u))
    );
    setPwdResetTarget(null);

    try {
      setProcessingPwdReset(true);
      if (action === 'approve') {
        await api.approvePasswordReset(user.id);
        toast.success(`Сброс пароля для «${user.username}» успешно одобрен`);
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

  if (loading && users.length === 0) {
    return <Loader size="section" text="Загрузка списка пользователей..." />;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#F2F0E8] flex items-center space-x-2">
            <Users className="w-5 h-5 text-[#D9B96E]" />
            <span>Пользователи</span>
          </h3>
          <p className="text-sm text-[#A8B4B7] mt-1 font-sans">
            Управление учетными записями, активация и назначение ролей пользователей системы.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border border-[#1C3945] rounded-2xl bg-[#06141B]/60 shadow-xl">
        <table className="w-full text-left text-sm text-[#F2F0E8] min-w-[620px]">
          <thead className="bg-[#102833]/90 text-sm font-mono uppercase tracking-wider text-[#A8B4B7] border-b border-[#1C3945]">
            <tr>
              <th className="px-5 py-3.5">ID</th>
              <th className="px-5 py-3.5">Имя пользователя</th>
              <th className="px-5 py-3.5">Роль</th>
              <th className="px-5 py-3.5">Тариф</th>
              <th className="px-5 py-3.5">Статус</th>
              <th className="px-5 py-3.5">Дата регистрации</th>
              <th className="px-5 py-3.5 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C3945]/70 bg-[#0A1D26]/40 font-sans">
            {(users || []).map((u) => (
              <tr key={u.id} className="hover:bg-[#102833]/50 transition duration-150">
                <td className="px-5 py-3.5 text-[#718187] font-mono text-sm">#{u.id}</td>
                <td className="px-5 py-3.5 font-medium text-[#F2F0E8] text-sm">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold">{u.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`text-sm font-mono font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
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
                      className={`inline-flex items-center text-sm font-mono font-semibold px-2.5 py-0.5 rounded-full ${
                        u.is_active
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                          : 'bg-amber-950/80 text-amber-300 border border-amber-600/40 animate-pulse'
                      }`}
                    >
                      {u.is_active ? 'Активен (Одобрен)' : 'Ожидает модерации'}
                    </span>
                    {u.has_pending_password_reset && (
                      <span className="inline-flex items-center space-x-1 text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-500/50 animate-pulse shadow-sm w-fit">
                        <KeyRound className="w-3.5 h-3.5 text-amber-300" />
                        <span>Сброс пароля</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-[#A8B4B7] font-mono">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-5 py-3.5 text-right space-x-2">
                  {/* Password Reset Actions */}
                  {u.has_pending_password_reset && (
                    <>
                      <Tooltip content="Одобрить новый пароль">
                        <button
                          onClick={() => setPwdResetTarget({ user: u, action: 'approve' })}
                          aria-label="Одобрить новый пароль"
                          className="p-2 rounded-xl border border-emerald-500/60 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/70 hover:border-emerald-400 transition"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                      </Tooltip>

                      <Tooltip content="Отклонить сброс пароля">
                        <button
                          onClick={() => setPwdResetTarget({ user: u, action: 'reject' })}
                          aria-label="Отклонить сброс пароля"
                          className="p-2 rounded-xl border border-rose-800/60 bg-rose-950/40 text-rose-400 hover:bg-rose-900/60 transition"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </>
                  )}

                  {/* Toggle Active / Deactivate */}
                  <Tooltip content={u.is_active ? 'Деактивировать учетную запись' : 'Одобрить и активировать'}>
                    <button
                      onClick={() => handleToggleActive(u)}
                      aria-label={u.is_active ? 'Деактивировать учетную запись' : 'Одобрить и активировать'}
                      className={`p-2 rounded-xl border transition ${
                        u.is_active
                          ? 'border-amber-700/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/50'
                          : 'border-emerald-700/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/50'
                      }`}
                    >
                      {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                    </button>
                  </Tooltip>

                  {/* Toggle PRO Status */}
                  <Tooltip content={u.is_pro ? 'Отозвать тариф PRO' : 'Предоставить тариф PRO'}>
                    <button
                      onClick={() => setProChangeTarget({ user: u, newPro: !u.is_pro })}
                      aria-label={u.is_pro ? 'Отозвать тариф PRO' : 'Предоставить тариф PRO'}
                      className={`p-2 rounded-xl border transition ${
                        u.is_pro
                          ? 'border-purple-600/50 bg-purple-950/40 text-purple-300 hover:bg-purple-900/60'
                          : 'border-[#1C3945] bg-[#102833] text-[#A8B4B7] hover:text-[#D9B96E] hover:border-[#D9B96E]/40 hover:bg-[#1C3945]'
                      }`}
                    >
                      <Sparkles className="w-4 h-4" />
                    </button>
                  </Tooltip>

                  {/* Promote / Demote Admin */}
                  {u.role !== 'admin' ? (
                    <Tooltip content="Повысить до Администратора">
                      <button
                        onClick={() => setRoleChangeTarget({ user: u, newRole: 'admin' })}
                        aria-label="Повысить до Администратора"
                        className="p-2 rounded-xl border border-[#D9B96E]/40 bg-[#102833] text-[#D9B96E] hover:bg-[#1C3945] hover:text-[#F0D48D] transition"
                      >
                        <ShieldPlus className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Снять права Администратора (понизить до пользователя)">
                      <button
                        onClick={() => setRoleChangeTarget({ user: u, newRole: 'user' })}
                        aria-label="Снять права Администратора"
                        className="p-2 rounded-xl border border-[#1C3945] bg-[#06141B] text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833] transition"
                      >
                        <ShieldMinus className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}

                  {/* Delete User */}
                  {u.role !== 'admin' && (
                    <Tooltip content="Удалить пользователя">
                      <button
                        onClick={() => setUserToDelete(u)}
                        aria-label="Удалить пользователя"
                        className="p-2 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-400 hover:bg-rose-900/50 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              {proChangeTarget.newPro ? (
                <p className="mt-2 text-sm text-[#A8B4B7]">
                  Пользователь получит доступ к выпуску ключей на запасных (резервных) серверах. Рекомендуемый взнос в биллинге изменится на 300 ₽ (+50 ₽ за доп. ключи).
                </p>
              ) : (
                <p className="mt-2 text-sm text-[#A8B4B7]">
                  Пользователь вернется на стандартный тариф (200 ₽). Доступ к созданию новых ключей на запасных серверах будет ограничен.
                </p>
              )}
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
                {roleChangeTarget.newRole === 'admin' ? 'Администратор' : 'Пользователь (Хранитель)'}
              </span>.
              {roleChangeTarget.newRole === 'admin' ? (
                <p className="mt-2 text-sm text-[#A8B4B7]">
                  Пользователь получит полный доступ к управлению узлами сети, модерации и аудиту всех ключей.
                </p>
              ) : (
                <p className="mt-2 text-sm text-[#A8B4B7]">
                  Пользователь потеряет доступ к панели администрирования.
                </p>
              )}
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
              Все привязанные к пользователю VPN-ключи и конфигурации будут также удалены из системы.
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
                  Вы собираетесь подтвердить установку нового пароля для пользователя <strong className="text-[#F2F0E8]">«{pwdResetTarget.user.username}»</strong>.
                  После подтверждения пользователь сможет войти в систему с новым паролем.
                </p>
              ) : (
                <p className="text-sm text-[#A8B4B7]">
                  Вы собираетесь отклонить запрос на смену пароля для пользователя <strong className="text-[#F2F0E8]">«{pwdResetTarget.user.username}»</strong>.
                  Текущий пароль останется без изменений.
                </p>
              )}
            </div>
          )
        }
      />
    </div>
  );
}

