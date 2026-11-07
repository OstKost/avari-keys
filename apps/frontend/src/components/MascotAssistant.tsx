import React, { useState } from 'react';
import { animatedPortal as createPortal } from './animatedPortal';
import { Sparkles, HelpCircle, X, ChevronRight, ChevronDown, BookOpen, RotateCcw, Shield } from 'lucide-react';
import { MASCOT_FAQ_QUESTIONS } from '../utils/faqData';

// Mascot Avatar sub-component
export function MascotAvatar({ 
  size = 'md', 
  className = '',
  withGlow = true,
  onClick
}: { 
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; 
  className?: string;
  withGlow?: boolean;
  onClick?: () => void;
}) {
  const sizeClasses = {
    xs: 'w-7 h-7',
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
    xl: 'w-28 h-28',
  };

  return (
    <div 
      onClick={onClick}
      className={`relative inline-flex items-center justify-center flex-shrink-0 group ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {withGlow && (
        <div className="absolute -inset-1.5 bg-gradient-to-r from-[#D9B96E]/50 via-[#F0D48D]/40 to-[#6EA8C4]/40 rounded-full blur-md opacity-80 group-hover:opacity-100 group-hover:scale-110 transition duration-300 pointer-events-none animate-pulse" />
      )}
      <div className={`relative ${sizeClasses[size]} rounded-full overflow-hidden border-2 border-[#D9B96E] bg-[#0A1D26] shadow-xl shadow-black/80 transition-transform duration-300 group-hover:scale-105`}>
        <img 
          src="/assets/mascot_avatar.png" 
          alt="Ари" 
          className="w-full h-full object-cover filter contrast-[1.05]"
        />
      </div>
    </div>
  );
}

// Full / Mid Mascot Character Figure (Standing companion beside windows)
export function MascotFigure({
  height = 'md',
  speech,
  interactive = false,
  badgeText = 'Хранитель Forve',
  onClick,
  className = '',
}: {
  height?: 'sm' | 'md' | 'lg';
  speech?: React.ReactNode;
  speechPosition?: 'top' | 'right' | 'left';
  interactive?: boolean;
  badgeText?: string;
  onClick?: () => void;
  className?: string;
}) {
  const heightClasses = {
    sm: 'w-28 h-40',
    md: 'w-36 h-52 sm:w-44 sm:h-64',
    lg: 'w-52 h-76 sm:w-64 sm:h-96',
  };

  return (
    <div className={`relative flex flex-col items-center select-none ${className} ${interactive ? 'cursor-pointer group' : ''}`} onClick={onClick}>
      {/* Speech Bubble */}
      {speech && (
        <div className="animate-bubble-float mb-2 z-20 max-w-xs sm:max-w-sm">
          <div className="relative bg-[#0A1D26]/95 border-2 border-[#D9B96E] p-3 sm:p-3.5 rounded-2xl shadow-2xl backdrop-blur-xl text-xs sm:text-sm text-[#F2F0E8] font-sans shadow-black/90">
            {speech}
            {/* Bubble Tail */}
            <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-[#D9B96E]" />
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-[#0A1D26]" />
          </div>
        </div>
      )}

      {/* Character Figure Container with Portal frame & Floating animation */}
      <div className={`relative ${heightClasses[height]} animate-mascot-float`}>
        {/* Magical Glowing Aura behind character */}
        <div className="absolute -inset-2 bg-gradient-to-t from-[#D9B96E]/40 via-[#F0D48D]/20 to-[#6EA8C4]/30 rounded-3xl blur-xl opacity-80 group-hover:opacity-100 transition duration-500 pointer-events-none" />

        {/* Character Card / Cutout Frame */}
        <div className="relative w-full h-full rounded-3xl overflow-hidden border-2 border-[#D9B96E]/80 bg-gradient-to-b from-[#102833]/90 via-[#0A1D26]/95 to-[#06141B] shadow-2xl shadow-black/90 transition-all duration-300 group-hover:border-[#F0D48D] group-hover:shadow-[#D9B96E]/20">
          <img 
            src="/assets/mascot.png" 
            alt="Avari Companion" 
            className="w-full h-full object-cover object-top filter contrast-[1.08] transition-transform duration-500 group-hover:scale-105"
          />
          {/* Subtle Bottom Fog Gradient */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0A1D26] via-[#0A1D26]/60 to-transparent pointer-events-none" />

          {/* Badge at Bottom */}
          {badgeText && (
            <div className="absolute bottom-2 inset-x-2 flex items-center justify-center">
              <span className="bg-[#06141B]/90 border border-[#D9B96E]/60 text-[#F0D48D] text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-lg flex items-center space-x-1">
                <Sparkles className="w-3 h-3 text-[#D9B96E]" />
                <span>{badgeText}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 5 Popular Questions & Answers Modal
export function MascotFaqModal({
  isOpen,
  onClose,
  initialQuestionId
}: {
  isOpen: boolean;
  onClose: () => void;
  initialQuestionId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialQuestionId || MASCOT_FAQ_QUESTIONS[0].id);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-[#06141B]/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
      <div className="bg-[#0A1D26] border border-[#1C3945] hover:border-[#D9B96E]/50 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl shadow-black/90 relative my-auto transition-all duration-300 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between pb-5 border-b border-[#1C3945]/80">
          <div className="flex items-center space-x-3.5">
            <MascotAvatar size="md" />
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-serif text-2xl font-bold text-[#F2F0E8] tracking-wide">
                  База знаний Ари
                </h3>
                <span className="text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#102833] text-[#D9B96E] border border-[#D9B96E]/30">
                  5 ответов
                </span>
              </div>
              <p className="text-sm text-[#A8B4B7] mt-0.5 font-sans">
                Самые популярные вопросы и подсказки для комфортного использования Avari Keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#A8B4B7] hover:text-[#F2F0E8] p-2 rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Questions Accordion / List */}
        <div className="overflow-y-auto flex-1 my-5 pr-1 space-y-3 custom-scrollbar">
          {MASCOT_FAQ_QUESTIONS.map((faq, index) => {
            const isExpanded = selectedId === faq.id;
            return (
              <div 
                key={faq.id}
                className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                  isExpanded 
                    ? 'border-[#D9B96E]/80 bg-[#102833] shadow-lg shadow-[#D9B96E]/5' 
                    : 'border-[#1C3945] bg-[#0D222C]/90 hover:border-[#1C3945]/80 hover:bg-[#0D222C]'
                }`}
              >
                <button
                  onClick={() => setSelectedId(isExpanded ? null : faq.id)}
                  className="w-full p-4 text-left flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center space-x-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#06141B] border border-[#1C3945] text-[#D9B96E] font-mono text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap gap-1">
                        <span className="font-serif font-bold text-base text-[#F2F0E8]">
                          {faq.question}
                        </span>
                        {faq.badge && (
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#06141B] text-[#6EA8C4] border border-[#6EA8C4]/30">
                            {faq.badge}
                          </span>
                        )}
                      </div>
                      {!isExpanded && (
                        <p className="text-xs text-[#A8B4B7] mt-1 font-sans line-clamp-1">
                          {faq.shortAnswer}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-[#A8B4B7] flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-5 h-5 text-[#D9B96E]" /> : <ChevronRight className="w-5 h-5" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 text-sm text-[#F2F0E8] font-sans border-t border-[#1C3945]/50 bg-[#0A1D26]/60">
                    <div className="whitespace-pre-line leading-relaxed text-[#D9E1E3] space-y-2 mt-2">
                      {faq.fullAnswer}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-[#1C3945]/80 flex items-center justify-between">
          <span className="text-xs text-[#718187] font-mono flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-[#D9B96E]" />
            <span>Avari Keys • AmneziaWG Guide by Ari</span>
          </span>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold py-2.5 px-6 rounded-xl shadow-lg shadow-[#D9B96E]/20 text-sm uppercase tracking-wider font-mono cursor-pointer transition"
          >
            Понятно, спасибо!
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Modal Companion Character (Stands to the left of CreateKeyModal with gold rotating bubble)
export function MascotModalCompanion({
  onClickFaq,
  compact = false,
}: {
  onClickFaq: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div 
        onClick={onClickFaq}
        className="w-full max-w-md gold-rotating-border cursor-pointer group transition-transform hover:scale-[1.01]"
        title="Нажмите, чтобы открыть 5 частых вопросов (FAQ)"
      >
        <div className="gold-rotating-border-content p-3 sm:p-4 text-xs sm:text-sm text-[#F2F0E8] font-sans flex items-center space-x-3">
          <MascotAvatar size="sm" withGlow={false} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1.5 mb-0.5">
              <span className="font-serif font-bold text-xs sm:text-sm text-[#F0D48D] group-hover:text-gold-gradient transition truncate">
                Нужна помощь с выбором?
              </span>
              <span className="bg-[#06141B] text-[#D9B96E] text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#D9B96E]/40 shrink-0">
                5 ответов
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-[#A8B4B7] truncate">
              Объясню разницу между Direct и Cascade, имя устройства и PSK.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-[#D9B96E] shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center select-none">
      {/* Speech Bubble with Rotating Gold Sheen Border */}
      <div 
        onClick={onClickFaq}
        className="mb-3 w-full max-w-[300px] relative z-20 cursor-pointer group transition-transform hover:scale-[1.02]"
        title="Нажмите, чтобы открыть 5 частых вопросов (FAQ)"
      >
        <div className="gold-rotating-border">
          <div className="gold-rotating-border-content p-4 text-xs sm:text-sm text-[#F2F0E8] font-sans">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-serif font-bold text-sm text-[#F0D48D] group-hover:text-gold-gradient transition">
                Нужна помощь с выбором?
              </span>
              <span className="bg-[#06141B] text-[#D9B96E] text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#D9B96E]/40 shrink-0">
                5 ответов
              </span>
            </div>
            <p className="leading-relaxed text-[#D9E1E3] text-left text-xs">
              Нажмите сюда, и я объясню разницу между каскадом и прямым сервером, имя устройства и опцию PSK.
            </p>
            <div className="flex items-center justify-between mt-2 pt-1 border-t border-[#1C3945]/40 text-xs">
              <span className="text-[#D9B96E] font-mono text-[11px] group-hover:underline flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Открыть FAQ</span>
              </span>
              <span className="font-serif font-bold text-[#D9B96E] tracking-wider">
                — Ари
              </span>
            </div>
          </div>
        </div>

        {/* Downward Bubble Tail */}
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-[#D9B96E] z-10" />
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-[#0A1D26] z-10" />
      </div>

      {/* Pure Cutout Mascot (No frame/container box, natural shadow & soft glow) */}
      <div 
        onClick={onClickFaq}
        className="relative flex justify-center items-end cursor-pointer group"
      >
        <img 
          src="/assets/mascot.png" 
          alt="Ари" 
          className="w-52 sm:w-60 lg:w-72 max-h-[460px] object-contain object-bottom filter drop-shadow-[0_15px_30px_rgba(0,0,0,0.9)] drop-shadow-[0_0_20px_rgba(217,185,110,0.25)] transition-transform duration-300 group-hover:scale-105 pointer-events-none"
        />
      </div>
    </div>
  );
}

// Auth Screen Companion (Standing to the left of centered form)
export function MascotAuthCompanion({
  isRegister = false,
  mode,
  compact = false,
}: {
  isRegister?: boolean;
  mode?: 'login' | 'register' | 'forgot_password';
  compact?: boolean;
}) {
  const currentMode = mode || (isRegister ? 'register' : 'login');
  let speech = 'Рад снова приветствовать тебя в Avari Keys! Войди в систему, чтобы управлять своими ключами.';
  if (currentMode === 'register') {
    speech = 'Приветствую тебя! Создай учетную запись, и я помогу настроить твой первый защищенный ключ.';
  } else if (currentMode === 'forgot_password') {
    speech = 'Забыли пароль? Укажите логин и новый пароль — администратор проверит заявку и подтвердит доступ.';
  }

  if (compact) {
    return (
      <div className="w-full max-w-md gold-rotating-border">
        <div className="gold-rotating-border-content p-3 sm:p-4 text-xs sm:text-sm text-[#F2F0E8] font-sans flex items-center space-x-3">
          <MascotAvatar size="sm" withGlow={false} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#D9E1E3] leading-tight">
              {speech}
            </p>
            <div className="text-right mt-1 text-[11px] font-serif font-bold text-[#D9B96E]">
              — Ари
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center select-none">
      {/* Speech Bubble with Rotating Gold Sheen Border */}
      <div className="mb-3 w-full max-w-[300px] relative z-20 cursor-pointer group transition-transform hover:scale-[1.02]">
        <div className="gold-rotating-border">
          <div className="gold-rotating-border-content p-4 text-xs sm:text-sm text-[#F2F0E8] font-sans">
            <p className="leading-relaxed text-[#D9E1E3] text-left">
              {speech}
            </p>
            <div className="text-right mt-2 text-xs font-serif font-bold text-[#D9B96E] tracking-wider">
              — Ари
            </div>
          </div>
        </div>

        {/* Downward Bubble Tail */}
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-[#D9B96E] z-10" />
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-[#0A1D26] z-10" />
      </div>

      {/* Pure Cutout Mascot (No frame/container box, natural shadow & soft glow) */}
      <div className="relative flex justify-center items-end cursor-pointer group">
        <img 
          src="/assets/mascot.png" 
          alt="Ари" 
          className="w-52 sm:w-60 lg:w-72 max-h-[460px] object-contain object-bottom filter drop-shadow-[0_15px_30px_rgba(0,0,0,0.9)] drop-shadow-[0_0_20px_rgba(217,185,110,0.25)] transition-transform duration-300 group-hover:scale-105 pointer-events-none"
        />
      </div>
    </div>
  );
}

// Floating mascot in the corner with interactive drawer / quick menu
export function FloatingMascot({
  onOpenFaq,
  onStartOnboarding,
}: {
  onOpenFaq: () => void;
  onStartOnboarding: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem('avari_mascot_collapsed') === 'true';
  });

  const handleToggleCollapse = () => {
    const next = !isDismissed;
    setIsDismissed(next);
    localStorage.setItem('avari_mascot_collapsed', String(next));
    if (next) setIsOpen(false);
  };

  if (isDismissed) {
    return (
      <div className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40">
        <button
          onClick={handleToggleCollapse}
          title="Открыть помощника Ари"
          className="relative group p-0.5 rounded-full overflow-hidden border-2 border-[#D9B96E] bg-[#0A1D26] shadow-2xl shadow-black/90 hover:scale-110 transition-transform duration-300 cursor-pointer"
        >
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden">
            <img 
              src="/assets/mascot_avatar.png" 
              alt="Ари" 
              className="w-full h-full object-cover filter contrast-[1.05]"
            />
          </div>
          <span className="absolute top-0 right-0 w-3 h-3 bg-[#D9B96E] rounded-full border-2 border-[#06141B] animate-ping" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end select-none">
      {/* Quick Menu Popover (Safe bounds on small mobile screens) */}
      {isOpen && (
        <div className="mb-3 w-80 max-w-[calc(100vw-2rem)] gold-rotating-border animate-slideUp">
          <div className="gold-rotating-border-content p-4 sm:p-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1C3945]">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-[#D9B96E] bg-[#06141B] shrink-0">
                  <img src="/assets/mascot_avatar.png" alt="Ари" className="w-full h-full object-cover" />
                </div>
                <span className="font-serif font-bold text-sm sm:text-base text-[#F2F0E8]">Хранитель Ари</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#A8B4B7] hover:text-[#F2F0E8] p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#A8B4B7] my-3 font-sans leading-relaxed">
              Я помогу с настройкой и отвечу на любые вопросы по работе AmneziaWG VPN.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenFaq();
                }}
                className="w-full text-left p-3 rounded-2xl bg-[#102833] hover:bg-[#163442] border border-[#1C3945] hover:border-[#D9B96E]/60 text-[#F2F0E8] text-xs font-medium flex items-center justify-between transition cursor-pointer group"
              >
                <div className="flex items-center space-x-2.5">
                  <HelpCircle className="w-4 h-4 text-[#D9B96E]" />
                  <span className="font-semibold">5 частых вопросов (FAQ)</span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#718187] group-hover:text-[#D9B96E] transition" />
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  onStartOnboarding();
                }}
                className="w-full text-left p-3 rounded-2xl bg-[#102833] hover:bg-[#163442] border border-[#1C3945] hover:border-[#D9B96E]/60 text-[#F2F0E8] text-xs font-medium flex items-center justify-between transition cursor-pointer group"
              >
                <div className="flex items-center space-x-2.5">
                  <RotateCcw className="w-4 h-4 text-[#6EA8C4]" />
                  <span className="font-semibold">Пройти обучение заново</span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#718187] group-hover:text-[#6EA8C4] transition" />
              </button>
            </div>

            <div className="mt-4 pt-3 text-center border-t border-[#1C3945]/50 flex justify-between items-center text-[11px] text-[#718187]">
              <button
                onClick={handleToggleCollapse}
                className="hover:text-[#A8B4B7] transition cursor-pointer"
              >
                Свернуть в иконку
              </button>
              <span className="font-serif font-bold text-[#D9B96E]">— Ари</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Trigger Button with Circular Face Avatar and Rotating Sheen Bubble */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2.5 sm:space-x-3 cursor-pointer group"
      >
        {!isOpen && (
          <div className="gold-rotating-border">
            <div className="gold-rotating-border-content py-1.5 px-3 sm:py-2 sm:px-3.5 text-xs font-sans flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-serif font-bold text-[#F0D48D]">Нужна помощь?</span>
            </div>
          </div>
        )}

        {/* Circular Portrait Avatar of Ari's Face */}
        <div className="relative flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-[#D9B96E] bg-[#0A1D26] shadow-2xl shadow-black/90 group-hover:border-[#F0D48D] group-hover:shadow-[0_0_25px_rgba(217,185,110,0.4)] transition-all duration-300">
            <img 
              src="/assets/mascot_avatar.png" 
              alt="Ари" 
              className="w-full h-full object-cover filter contrast-[1.05] pointer-events-none"
            />
          </div>
          <span className="absolute bottom-0 right-0 w-3 sm:w-3.5 h-3 sm:h-3.5 bg-emerald-400 rounded-full border-2 border-[#06141B]" />
        </div>
      </div>
    </div>
  );
}

