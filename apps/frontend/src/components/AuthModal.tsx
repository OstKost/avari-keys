import { useState } from 'react';
import { LogIn, UserPlus, AlertCircle, CheckCircle2, User as UserIcon, ShieldCheck, KeyRound } from 'lucide-react';
import { api, loginAsDemoUser } from '../api/client';
import { User } from '../types';
import { MascotAuthCompanion } from './MascotAssistant';

interface Props {
  onSuccess: (user: User) => void;
}

type AuthMode = 'login' | 'register' | 'forgot_password';

export function AuthModal({ onSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === 'register') {
        await api.register(username.trim(), password);
        setSuccessMsg('Учетная запись создана. Ожидайте подтверждения администратором Forve.');
        setMode('login');
        setPassword('');
      } else if (mode === 'forgot_password') {
        const res = await api.requestPasswordReset(username.trim(), password);
        setSuccessMsg(res.message || 'Запрос на сброс пароля отправлен администратору. Ожидайте одобрения.');
        setMode('login');
        setPassword('');
      } else {
        const data = await api.login(username.trim(), password);
        onSuccess(data.user);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка выполнения операции');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoUsername: string) => {
    const user = await loginAsDemoUser(demoUsername);
    onSuccess(user);
  };

  const getSubtitle = () => {
    if (mode === 'register') return 'Регистрация аккаунта';
    if (mode === 'forgot_password') return 'Запрос сброса пароля';
    return 'Управление конфигурациями';
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6 bg-[#06141B] overflow-hidden">
      {/* Fantasy Elven Background Art */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 mix-blend-luminosity scale-105 transition duration-1000"
        style={{ backgroundImage: "url('/assets/background_main.png')" }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#06141B] via-[#06141B]/80 to-[#06141B]/60" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(217,185,110,0.08)_0%,transparent_60%)]" />

      {/* Centered Area: Form in Dead Center + Mascot to the Left on Desktop */}
      <div className="relative z-10 max-w-md w-full my-auto flex flex-col items-center">
        
        {/* Mascot Character Standing to the Left of the Centered Form (Desktop lg+) */}
        <div className="hidden lg:block absolute right-[calc(100%+2rem)] xl:right-[calc(100%+3.5rem)] bottom-0 w-80">
          <MascotAuthCompanion mode={mode} />
        </div>

        {/* Mascot on Mobile (Above card, compact banner) */}
        <div className="lg:hidden mb-4 w-full flex justify-center">
          <MascotAuthCompanion mode={mode} compact={true} />
        </div>

        {/* Login Card (Exact Center) */}
        <div className="w-full bg-[#0A1D26]/90 backdrop-blur-xl border border-[#1C3945] hover:border-[#D9B96E]/40 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-black/80 transition-all duration-500">
          
          {/* Brand Logo & Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-3 group">
              <div className="absolute -inset-2 bg-[#D9B96E]/20 rounded-full blur-lg opacity-70 group-hover:opacity-100 transition" />
              <img 
                src="/assets/logo_star.png" 
                alt="Avari Keys Star" 
                className="relative w-14 h-14 object-contain filter drop-shadow-[0_0_12px_rgba(217,185,110,0.5)]" 
              />
            </div>
            
            <h1 className="font-serif text-3xl font-bold tracking-wider text-gold-gradient uppercase">
              Avari Keys
            </h1>
            <p className="text-sm text-[#A8B4B7] tracking-wider uppercase mt-1.5 font-mono">
              {getSubtitle()}
            </p>
          </div>

          {/* Status Alerts */}
        {error && (
          <div className="flex items-start space-x-2.5 bg-rose-950/60 border border-rose-800/80 text-rose-300 text-sm p-3.5 rounded-xl mb-5 shadow-lg">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start space-x-2.5 bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-sm p-3.5 rounded-xl mb-5 shadow-lg">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {mode === 'forgot_password' && (
          <div className="bg-[#102833]/90 border border-[#D9B96E]/30 rounded-xl p-3.5 mb-5 text-xs text-[#A8B4B7] leading-relaxed shadow-inner">
            <span className="text-[#F0D48D] font-semibold block mb-1">Сброс пароля через администратора</span>
            Укажите логин вашей учетной записи и новый пароль. Запрос на подтверждение поступит администратору в Telegram и веб-панель.
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 font-mono">
              Имя пользователя {mode === 'forgot_password' ? '(Логин)' : ''}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="например: Forve или user1"
              className="w-full bg-[#0D222C] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-3 text-base text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:ring-1 focus:ring-[#D9B96E]/50 transition shadow-inner font-sans"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#A8B4B7] uppercase tracking-wider mb-1.5 font-mono">
              {mode === 'forgot_password' ? 'Новый пароль' : 'Пароль'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'forgot_password' ? 'минимум 6 символов' : '••••••••'}
              className="w-full bg-[#0D222C] border border-[#1C3945] focus:border-[#D9B96E] rounded-xl px-4 py-3 text-base text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:ring-1 focus:ring-[#D9B96E]/50 transition shadow-inner font-sans"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 disabled:opacity-50 transition-all duration-300 flex items-center justify-center space-x-2 text-sm uppercase tracking-wider font-mono cursor-pointer"
          >
            {loading ? (
              <span>Обработка...</span>
            ) : mode === 'register' ? (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Создать аккаунт</span>
              </>
            ) : mode === 'forgot_password' ? (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Отправить запрос на сброс</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Войти в систему</span>
              </>
            )}
          </button>
        </form>

        {/* Demo Mode / Quick Logins (Visible only in DEV or when explicitly enabled) */}
        {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true') && (
          <div className="mt-6 pt-5 border-t border-[#1C3945]/80 flex flex-col space-y-2.5">
            <div className="text-sm text-center font-mono uppercase tracking-wider text-[#718187] mb-1">
              Быстрый демо-вход (Mock-режим)
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => handleDemoLogin('alice')}
                type="button"
                className="flex items-center justify-center space-x-1.5 bg-[#102833]/80 hover:bg-[#102833] text-[#6EA8C4] hover:text-[#9cd0e6] border border-[#6EA8C4]/30 hover:border-[#6EA8C4]/60 font-medium py-2.5 px-3 rounded-xl text-sm transition shadow-sm font-mono cursor-pointer"
              >
                <UserIcon className="w-4 h-4 text-[#6EA8C4]" />
                <span>Клиент (Alice)</span>
              </button>

              <button
                onClick={() => handleDemoLogin('Forve')}
                type="button"
                className="flex items-center justify-center space-x-1.5 bg-[#102833]/80 hover:bg-[#102833] text-[#F0D48D] hover:text-white border border-[#D9B96E]/30 hover:border-[#D9B96E]/60 font-medium py-2.5 px-3 rounded-xl text-sm transition shadow-sm font-mono cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-[#D9B96E]" />
                <span>Админ (Forve)</span>
              </button>
            </div>
          </div>
        )}

        {/* Links Navigation */}
        <div className="mt-5 pt-3 border-t border-[#1C3945]/60 flex flex-col items-center space-y-2">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="text-sm text-[#A8B4B7] hover:text-[#F2F0E8] transition text-center font-medium cursor-pointer"
              >
                Новый пользователь? Зарегистрироваться
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot_password');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="text-sm text-[#D9B96E]/80 hover:text-[#F0D48D] transition text-center font-medium cursor-pointer"
              >
                Забыли пароль? Сбросить
              </button>
            </>
          ) : mode === 'register' ? (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setSuccessMsg(null);
              }}
              className="text-sm text-[#A8B4B7] hover:text-[#F2F0E8] transition text-center font-medium cursor-pointer"
            >
              Уже есть учетная запись? Войти
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setSuccessMsg(null);
              }}
              className="text-sm text-[#A8B4B7] hover:text-[#F2F0E8] transition text-center font-medium cursor-pointer"
            >
              Вспомнили пароль? Вернуться ко входу
            </button>
          )}
        </div>

        </div>
      </div>
    </div>
  );
}
