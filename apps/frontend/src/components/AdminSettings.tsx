import React, { useState, useEffect } from 'react';
import {
  Settings,
  Bot,
  Key,
  Bell,
  Eye,
  EyeOff,
  Trash2,
  Send,
  ExternalLink,
  Power,
  Users,
  CreditCard,
  Building,
  Phone,
  Save,
} from 'lucide-react';
import { api } from '../api/client';
import { TelegramSettings, TelegramChat, BillingRequisites } from '../types';
import { useToast } from '../context/ToastContext';
import { Loader } from './Loader';
import { Tooltip } from './Tooltip';

export function AdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  // --- Requisites State ---
  const [requisites, setRequisites] = useState<BillingRequisites>({
    sbp_phone: '+7 (999) 000-00-00',
    sbp_bank: 'Т-Банк / Сбербанк',
  });
  const [savingRequisites, setSavingRequisites] = useState(false);

  // --- Telegram Settings State ---
  const [tgEnabled, setTgEnabled] = useState(true);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [webAppUrl, setWebAppUrl] = useState('');
  const [notifyOnNodeDown, setNotifyOnNodeDown] = useState(true);
  const [notifyOnNodeRecover, setNotifyOnNodeRecover] = useState(true);
  const [notifyOnNewUser, setNotifyOnNewUser] = useState(true);
  const [notifyOnBillingReminders, setNotifyOnBillingReminders] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);

  // Subscribers
  const [subscribers, setSubscribers] = useState<TelegramChat[]>([]);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [reqsData, tgSettings, tgStatus] = await Promise.all([
        api.getBillingRequisites().catch(() => null),
        api.getTelegramSettings().catch(() => null),
        api.getTelegramStatus().catch(() => null),
      ]);

      if (reqsData) {
        setRequisites(reqsData);
      }
      if (tgSettings) {
        setTgEnabled(tgSettings.enabled);
        setBotToken(tgSettings.bot_token || '');
        setBotUsername(tgSettings.bot_username || '');
        setAdminSecret(tgSettings.admin_secret || '');
        setWebAppUrl(tgSettings.web_app_url || '');
        setNotifyOnNodeDown(tgSettings.notify_on_node_down ?? true);
        setNotifyOnNodeRecover(tgSettings.notify_on_node_recover ?? true);
        setNotifyOnNewUser(tgSettings.notify_on_new_user ?? true);
        setNotifyOnBillingReminders(tgSettings.notify_on_billing_reminders ?? true);
      }
      if (tgStatus && Array.isArray(tgStatus.subscribers)) {
        setSubscribers(tgStatus.subscribers);
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки настроек');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save Requisites
  const handleSaveRequisites = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingRequisites(true);
      const updated = await api.updateBillingRequisites(requisites);
      setRequisites(updated);
      toast.success('Реквизиты для взносов успешно сохранены');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения реквизитов');
    } finally {
      setSavingRequisites(false);
    }
  };

  // Save Telegram Settings
  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingTelegram(true);
      const payload: TelegramSettings = {
        enabled: tgEnabled,
        bot_token: botToken.trim(),
        bot_username: botUsername.trim(),
        admin_secret: adminSecret.trim(),
        web_app_url: webAppUrl.trim(),
        notify_on_node_down: notifyOnNodeDown,
        notify_on_node_recover: notifyOnNodeRecover,
        notify_on_new_user: notifyOnNewUser,
        notify_on_billing_reminders: notifyOnBillingReminders,
      };

      const updated = await api.updateTelegramSettings(payload);
      setBotUsername(updated.bot_username);
      toast.success('Настройки Telegram-бота успешно сохранены и применены');
      loadData(true);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения настроек Telegram');
    } finally {
      setSavingTelegram(false);
    }
  };

  // Test Alert
  const handleSendTest = async () => {
    try {
      setTestingAlert(true);
      await api.sendTelegramTestAlert();
      toast.success('Тестовое оповещение успешно отправлено');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка отправки тестового оповещения');
    } finally {
      setTestingAlert(false);
    }
  };

  // Toggle Subscriber Alerts
  const handleToggleSubscriber = async (chatId: number, currentStatus: boolean) => {
    try {
      await api.toggleTelegramSubscriber(chatId, !currentStatus);
      setSubscribers((prev) =>
        prev.map((s) => (s.chat_id === chatId ? { ...s, alerts_enabled: !currentStatus } : s))
      );
      toast.success(`Оповещения ${!currentStatus ? 'включены' : 'отключены'}`);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка изменения статуса подписчика');
    }
  };

  // Delete Subscriber
  const handleDeleteSubscriber = async (chatId: number) => {
    try {
      await api.deleteTelegramSubscriber(chatId);
      setSubscribers((prev) => prev.filter((s) => s.chat_id !== chatId));
      toast.success('Подписчик удален из рассылки');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления подписчика');
    }
  };

  if (loading) {
    return <Loader size="section" text="Загрузка настроек системы..." />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h3 className="font-serif text-xl font-bold text-[#F2F0E8] flex items-center space-x-2">
          <Settings className="w-5 h-5 text-[#D9B96E]" />
          <span>Настройки системы и интеграций</span>
        </h3>
        <p className="text-sm text-[#A8B4B7] mt-1 font-sans">
          Управление реквизитами для добровольных взносов и параметрами Telegram-бота оповещений.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Requisites */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#06141B]/70 border border-[#1C3945] rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-[#D9B96E] border border-amber-500/20">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-serif text-base font-bold text-[#F2F0E8]">
                  Реквизиты для взносов (СБП)
                </h4>
                <p className="text-xs text-[#A8B4B7] font-sans">
                  Отображаются пользователям на странице «Биллинг» и в Telegram-боте
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveRequisites} className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#D9B96E]" />
                  <span>Номер телефона (СБП)</span>
                </label>
                <input
                  type="text"
                  value={requisites.sbp_phone}
                  onChange={(e) => setRequisites({ ...requisites, sbp_phone: e.target.value })}
                  placeholder="+7 (999) 000-00-00"
                  required
                  className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                  <Building className="w-3.5 h-3.5 text-[#D9B96E]" />
                  <span>Банк получателя</span>
                </label>
                <input
                  type="text"
                  value={requisites.sbp_bank}
                  onChange={(e) => setRequisites({ ...requisites, sbp_bank: e.target.value })}
                  placeholder="Т-Банк / Сбербанк"
                  required
                  className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                />
              </div>

              <div className="p-3 rounded-xl bg-[#102833]/60 border border-[#1C3945] text-xs text-[#A8B4B7] font-sans">
                💡 <strong className="text-[#F2F0E8]">Формула взноса:</strong> до 3-х ключей = 200 ₽/мес, далее +30 ₽ за каждый ключ. Сумма носит рекомендательный характер.
              </div>

              <button
                type="submit"
                disabled={savingRequisites}
                className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono py-2.5 px-4 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingRequisites ? 'Сохранение...' : 'Сохранить реквизиты'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Telegram Bot Settings & Subscribers */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#06141B]/70 border border-[#1C3945] rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#1C3945]">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif text-base font-bold text-[#F2F0E8]">
                    Telegram-бот и оповещения
                  </h4>
                  <p className="text-xs text-[#A8B4B7] font-sans">
                    Мониторинг сбоев, новых регистраций и напоминания о взносах
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={tgEnabled}
                  onChange={(e) => setTgEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#0A1D26] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#A8B4B7] peer-checked:after:bg-[#06141B] after:border-[#1C3945] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#D9B96E]"></div>
              </label>
            </div>

            <form onSubmit={handleSaveTelegram} className="space-y-4">
              {/* Bot Token */}
              <div>
                <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Key className="w-3.5 h-3.5 text-[#D9B96E]" />
                    <span>Токен бота (Bot Token)</span>
                  </span>
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#D9B96E] hover:underline flex items-center space-x-1 font-sans font-normal"
                  >
                    <span>Получить в @BotFather</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-3 text-[#718187] hover:text-[#F2F0E8]"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Bot Username */}
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5">
                    Username бота
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-[#718187] font-mono text-sm">@</span>
                    <input
                      type="text"
                      placeholder="например: AvariKeysBot"
                      value={botUsername}
                      onChange={(e) => setBotUsername(e.target.value)}
                      className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl pl-8 pr-3.5 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                    />
                  </div>
                </div>

                {/* Admin Secret */}
                <div>
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5">
                    Секретный код привязки
                  </label>
                  <input
                    type="text"
                    placeholder="например: secret123"
                    value={adminSecret}
                    onChange={(e) => setAdminSecret(e.target.value)}
                    className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                  />
                </div>

                {/* WebApp URL */}
                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>URL Telegram Mini App</span>
                    <span className="text-[11px] text-[#718187] font-sans font-normal">
                      Ссылка на веб-приложение (/miniapp)
                    </span>
                  </label>
                  <input
                    type="text"
                    placeholder="например: https://m0.vpn.test/miniapp"
                    value={webAppUrl}
                    onChange={(e) => setWebAppUrl(e.target.value)}
                    className="w-full bg-[#0A1D26] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-3.5 py-2.5 text-sm text-[#F2F0E8] font-mono focus:outline-none placeholder:text-slate-600 transition"
                  />
                  <p className="text-[11px] text-[#718187] mt-1 font-sans">
                    Этот адрес будет открываться при нажатии на кнопку «🚀 Открыть Avari App» в боте и в меню WebApp.
                  </p>
                </div>
              </div>

              {/* Notification Toggles */}
              <div className="bg-[#0A1D26] border border-[#1C3945] rounded-xl p-4 space-y-3">
                <div className="text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                  <Bell className="w-3.5 h-3.5 text-[#D9B96E]" />
                  <span>Типы отправляемых оповещений</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <label className="flex items-center space-x-2.5 cursor-pointer text-[#F2F0E8]">
                    <input
                      type="checkbox"
                      checked={notifyOnNodeDown}
                      onChange={(e) => setNotifyOnNodeDown(e.target.checked)}
                      className="rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#06141B]"
                    />
                    <span className="text-xs font-sans">Падение серверов (Node Down)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-[#F2F0E8]">
                    <input
                      type="checkbox"
                      checked={notifyOnNodeRecover}
                      onChange={(e) => setNotifyOnNodeRecover(e.target.checked)}
                      className="rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#06141B]"
                    />
                    <span className="text-xs font-sans">Восстановление узлов (Recover)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-[#F2F0E8]">
                    <input
                      type="checkbox"
                      checked={notifyOnNewUser}
                      onChange={(e) => setNotifyOnNewUser(e.target.checked)}
                      className="rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#06141B]"
                    />
                    <span className="text-xs font-sans">Новые пользователи (Модерация)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-[#F2F0E8]">
                    <input
                      type="checkbox"
                      checked={notifyOnBillingReminders}
                      onChange={(e) => setNotifyOnBillingReminders(e.target.checked)}
                      className="rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#06141B]"
                    />
                    <span className="text-xs font-sans">Напоминания о взносах</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingTelegram}
                  className="w-full sm:flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs uppercase tracking-wider font-mono py-2.5 px-4 rounded-xl shadow-lg shadow-[#D9B96E]/20 transition disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingTelegram ? 'Сохранение...' : 'Сохранить настройки бота'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendTest}
                  disabled={testingAlert || !tgEnabled || !botToken}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-blue-500/40 bg-blue-950/40 text-blue-300 hover:bg-blue-900/40 text-xs font-mono uppercase tracking-wider font-bold transition disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{testingAlert ? 'Отправка...' : 'Тест связи'}</span>
                </button>
              </div>
            </form>

            {/* Subscribers Table */}
            <div className="pt-4 border-t border-[#1C3945]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-mono font-semibold text-[#A8B4B7] uppercase tracking-wider flex items-center space-x-1.5">
                  <Users className="w-3.5 h-3.5 text-[#D9B96E]" />
                  <span>Подключенные Telegram-чаты ({subscribers.length})</span>
                </div>
                {botUsername && (
                  <a
                    href={`https://t.me/${botUsername}?start=${adminSecret}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#D9B96E] hover:underline flex items-center space-x-1"
                  >
                    <span>Открыть бота</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {subscribers.length === 0 ? (
                <div className="text-center py-6 text-[#718187] text-xs font-mono border border-dashed border-[#1C3945] rounded-xl">
                  Пока нет привязанных Telegram-чатов. Отправьте /start в боте для подключения.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#1C3945] rounded-xl">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-[#0A1D26] text-[#A8B4B7] font-mono border-b border-[#1C3945]">
                      <tr>
                        <th className="px-3 py-2">Chat ID</th>
                        <th className="px-3 py-2">Пользователь</th>
                        <th className="px-3 py-2">Роль</th>
                        <th className="px-3 py-2">Статус</th>
                        <th className="px-3 py-2 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1C3945]/50 bg-[#06141B]">
                      {subscribers.map((s) => (
                        <tr key={s.chat_id} className="hover:bg-[#102833]/40 transition">
                          <td className="px-3 py-2 font-mono text-[#718187]">{s.chat_id}</td>
                          <td className="px-3 py-2 text-[#F2F0E8] font-medium">
                            {s.username ? `@${s.username}` : s.first_name || 'Anonymous'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                                s.is_admin
                                  ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                                  : 'bg-[#102833] text-[#6EA8C4] border border-[#6EA8C4]/40'
                              }`}
                            >
                              {s.is_admin ? 'Admin' : 'User'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                s.alerts_enabled
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/40'
                                  : 'bg-slate-900 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {s.alerts_enabled ? 'Активен' : 'Отключен'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right space-x-1.5">
                            <Tooltip content={s.alerts_enabled ? 'Отключить оповещения' : 'Включить оповещения'}>
                              <button
                                onClick={() => handleToggleSubscriber(s.chat_id, s.alerts_enabled)}
                                className={`p-1.5 rounded-lg border transition ${
                                  s.alerts_enabled
                                    ? 'border-amber-700/50 text-amber-400 hover:bg-amber-950/40'
                                    : 'border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/40'
                                }`}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            </Tooltip>
                            <Tooltip content="Удалить из рассылки">
                              <button
                                onClick={() => handleDeleteSubscriber(s.chat_id)}
                                className="p-1.5 rounded-lg border border-rose-800/50 text-rose-400 hover:bg-rose-950/40 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
