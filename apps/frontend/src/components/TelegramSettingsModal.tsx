import React, { useState, useEffect } from 'react';
import { animatedPortal as createPortal } from './animatedPortal';
import {
  X,
  Bot,
  Key,
  Bell,
  Eye,
  EyeOff,
  CheckCircle2,
  Trash2,
  Send,
  ExternalLink,
  Power,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { TelegramSettings, TelegramChat } from '../types';
import { useToast } from '../context/ToastContext';

interface TelegramSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function TelegramSettingsModal({ isOpen, onClose, onSaved }: TelegramSettingsModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Settings State
  const [enabled, setEnabled] = useState(true);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [notifyOnNodeDown, setNotifyOnNodeDown] = useState(true);
  const [notifyOnNodeRecover, setNotifyOnNodeRecover] = useState(true);
  const [notifyOnNewUser, setNotifyOnNewUser] = useState(true);

  // Subscribers
  const [subscribers, setSubscribers] = useState<TelegramChat[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      try {
        setLoading(true);
        const [settings, status] = await Promise.all([
          api.getTelegramSettings(),
          api.getTelegramStatus(),
        ]);

        if (settings) {
          setEnabled(settings.enabled);
          setBotToken(settings.bot_token || '');
          setBotUsername(settings.bot_username || '');
          setAdminSecret(settings.admin_secret || '');
          setNotifyOnNodeDown(settings.notify_on_node_down ?? true);
          setNotifyOnNodeRecover(settings.notify_on_node_recover ?? true);
          setNotifyOnNewUser(settings.notify_on_new_user ?? true);
        }
        if (status && Array.isArray(status.subscribers)) {
          setSubscribers(status.subscribers);
        }
      } catch (err: any) {
        toast.error(err.message || 'Ошибка загрузки настроек Telegram');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload: TelegramSettings = {
        enabled,
        bot_token: botToken.trim(),
        bot_username: botUsername.trim(),
        admin_secret: adminSecret.trim(),
        notify_on_node_down: notifyOnNodeDown,
        notify_on_node_recover: notifyOnNodeRecover,
        notify_on_new_user: notifyOnNewUser,
      };

      const updated = await api.updateTelegramSettings(payload);
      setBotUsername(updated.bot_username);
      toast.success('Настройки Telegram-бота успешно сохранены и применены!');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения настроек Telegram');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendTest = async () => {
    try {
      setTestingAlert(true);
      const res = await api.sendTelegramTestAlert();
      toast.success(res.message || 'Тестовое оповещение отправлено');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки теста');
    } finally {
      setTestingAlert(false);
    }
  };

  const handleDeleteSubscriber = async (chatId: number) => {
    try {
      await api.deleteTelegramSubscriber(chatId);
      setSubscribers((prev) => prev.filter((s) => s.chat_id !== chatId));
      toast.success('Получатель удален из рассылки');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления получателя');
    }
  };

  const handleToggleSubscriber = async (chatId: number, current: boolean) => {
    try {
      const next = !current;
      await api.toggleTelegramSubscriber(chatId, next);
      setSubscribers((prev) =>
        prev.map((s) => (s.chat_id === chatId ? { ...s, alerts_enabled: next } : s))
      );
      toast.success(next ? 'Оповещения включены для чата' : 'Оповещения отключены для чата');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка переключения статуса');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#0B1E28] border border-[#1C3945] w-full max-w-2xl rounded-2xl p-6 shadow-2xl relative my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#1C3945]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#102833] border border-[#D9B96E]/30 flex items-center justify-center text-[#D9B96E] shadow-md shadow-[#D9B96E]/10">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">
                Настройки Telegram-бота
              </h3>
              <p className="text-xs text-[#A8B4B7] font-mono">
                Управление токеном, параметрами рассылки и администраторами
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#A8B4B7] hover:text-[#F2F0E8] transition p-1.5 rounded-lg hover:bg-[#102833] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="py-16 text-center text-[#A8B4B7] font-mono text-sm">
            <div className="inline-block w-8 h-8 border-2 border-[#D9B96E] border-t-transparent rounded-full animate-spin mb-3"></div>
            <div>Загрузка настроек Telegram...</div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto pr-1 space-y-6 pt-4">
            {/* Enable/Disable Banner */}
            <div className="flex items-center justify-between bg-[#102833] border border-[#1C3945] rounded-xl p-4">
              <div className="flex items-center space-x-3">
                <Power className={`w-5 h-5 ${enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-sm font-semibold text-[#F2F0E8]">
                    Статус бота и рассылки
                  </div>
                  <div className="text-xs text-[#A8B4B7]">
                    {enabled ? 'Бот активен и отправляет уведомления' : 'Бот выключен'}
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#06141B] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#A8B4B7] peer-checked:after:bg-[#06141B] after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#D9B96E]"></div>
              </label>
            </div>

            {/* Token & Identity Fields */}
            <div className="space-y-4">
              <h4 className="text-xs font-mono uppercase tracking-wider text-[#D9B96E] font-semibold flex items-center space-x-1.5">
                <Key className="w-3.5 h-3.5" />
                <span>Авторизация Telegram Bot API</span>
              </h4>

              {/* Bot Token Input */}
              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                  Токен бота (Bot Token) <span className="text-amber-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600"
                    required={enabled}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A8B4B7] hover:text-[#F2F0E8] transition cursor-pointer"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-[#A8B4B7] mt-1 font-sans">
                  Получить токен можно у{' '}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D9B96E] hover:underline inline-flex items-center space-x-0.5"
                  >
                    <span>@BotFather</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                  </a>
                </p>
              </div>

              {/* Grid: Bot Username & Admin Secret */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5">
                    Username бота
                  </label>
                  <input
                    type="text"
                    placeholder="например: AvariKeysBot"
                    value={botUsername}
                    onChange={(e) => setBotUsername(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none"
                  />
                  <p className="text-[11px] text-[#A8B4B7] mt-1">
                    Без символа @
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase mb-1.5 flex items-center justify-between">
                    <span>Секретный ключ (Admin Secret)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="например: my_secret_token_123"
                    value={adminSecret}
                    onChange={(e) => setAdminSecret(e.target.value)}
                    className="w-full bg-[#06141B] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none"
                  />
                  <p className="text-[11px] text-[#A8B4B7] mt-1">
                    Опционально: пароль для команды <code>/bind &lt;ключ&gt;</code>
                  </p>
                </div>
              </div>
            </div>

            {/* Notification Event Toggles */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-mono uppercase tracking-wider text-[#D9B96E] font-semibold flex items-center space-x-1.5">
                <Bell className="w-3.5 h-3.5" />
                <span>События для отправки оповещений</span>
              </h4>

              <div className="space-y-2 bg-[#06141B] border border-[#1C3945] rounded-xl p-3.5">
                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notifyOnNodeDown}
                    onChange={(e) => setNotifyOnNodeDown(e.target.checked)}
                    className="w-4 h-4 rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#102833]"
                  />
                  <div className="text-xs text-[#F2F0E8]">
                    🚨 <span className="font-semibold">Падение серверов:</span> отправлять алерт при переходе ноды в Offline / сбое
                  </div>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notifyOnNodeRecover}
                    onChange={(e) => setNotifyOnNodeRecover(e.target.checked)}
                    className="w-4 h-4 rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#102833]"
                  />
                  <div className="text-xs text-[#F2F0E8]">
                    ✅ <span className="font-semibold">Восстановление нод:</span> отправлять отчет при возврате сервера в Online
                  </div>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notifyOnNewUser}
                    onChange={(e) => setNotifyOnNewUser(e.target.checked)}
                    className="w-4 h-4 rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#102833]"
                  />
                  <div className="text-xs text-[#F2F0E8]">
                    👤 <span className="font-semibold">Новые пользователи:</span> уведомлять о регистрации аккаунта на модерацию
                  </div>
                </label>
              </div>
            </div>

            {/* Subscribers Section */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono uppercase tracking-wider text-[#D9B96E] font-semibold flex items-center space-x-1.5">
                  <Users className="w-3.5 h-3.5" />
                  <span>Подключенные получатели ({subscribers.length})</span>
                </h4>
                {botUsername && (
                  <a
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#D9B96E] hover:underline flex items-center space-x-1 font-mono"
                  >
                    <span>Открыть @{botUsername}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {subscribers.length === 0 ? (
                <div className="bg-[#06141B] border border-[#1C3945] rounded-xl p-4 text-center text-xs text-[#A8B4B7]">
                  Пока нет подключенных Telegram-чатов. Откройте диалог с ботом и отправьте команду{' '}
                  <code className="text-[#F2F0E8] font-bold">/start</code>
                </div>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {subscribers.map((sub) => (
                    <div
                      key={sub.chat_id}
                      className="bg-[#06141B] border border-[#1C3945] rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-[#102833] border border-[#1C3945] flex items-center justify-center text-[#D9B96E] font-bold font-mono text-xs flex-shrink-0">
                          {sub.first_name ? sub.first_name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#F2F0E8] truncate">
                            {sub.first_name || 'Пользователь'} {sub.username ? `@${sub.username}` : ''}
                          </div>
                          <div className="text-[11px] text-[#A8B4B7] font-mono">
                            ID: {sub.chat_id}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSubscriber(sub.chat_id, sub.alerts_enabled)}
                          className={`px-2 py-1 rounded-md text-[11px] font-mono transition cursor-pointer ${
                            sub.alerts_enabled
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {sub.alerts_enabled ? 'Активен' : 'Отключен'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteSubscriber(sub.chat_id)}
                          className="p-1.5 text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                          title="Удалить чат"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="pt-4 border-t border-[#1C3945] flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleSendTest}
                disabled={testingAlert || !enabled || !botToken}
                className="w-full sm:w-auto flex items-center justify-center space-x-1.5 text-xs font-mono uppercase tracking-wider bg-[#102833] hover:bg-[#1C3945] text-[#D9B96E] hover:text-[#F0D48D] px-3.5 py-2.5 rounded-xl border border-[#1C3945] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Send className={`w-3.5 h-3.5 ${testingAlert ? 'animate-spin' : ''}`} />
                <span>{testingAlert ? 'Отправка теста...' : 'Проверить доставку'}</span>
              </button>

              <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-mono uppercase text-[#A8B4B7] hover:text-[#F2F0E8] hover:bg-[#102833] transition border border-[#1C3945] cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto flex items-center justify-center space-x-1.5 text-xs font-mono font-bold uppercase tracking-wider bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] px-5 py-2.5 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? 'Сохранение...' : 'Сохранить'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
