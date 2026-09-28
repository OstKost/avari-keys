import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, ArrowRight, ArrowLeft, Check, X, Smartphone, Zap, QrCode } from 'lucide-react';
import { MascotAvatar } from './MascotAssistant';

export interface OnboardingStep {
  step: number;
  title: string;
  description: string;
  targetHint?: string;
  icon?: React.ReactNode;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    step: 1,
    title: 'Шаг 1: Создание первого ключа',
    description: 'Добро пожаловать в Avari Keys! Давайте создадим ваш первый AmneziaWG ключ для безопасного доступа к свободному интернету.',
    targetHint: 'Нажмите золотую кнопку «Создать новый ключ» в правом верхнем углу списка.',
    icon: <Sparkles className="w-5 h-5 text-[#D9B96E]" />
  },
  {
    step: 2,
    title: 'Шаг 2: Выбор сервера и имя устройства',
    description: 'Выберите нужный сервер (Direct для скорости или Cascade для обхода блокировок) и укажите понятное имя устройства (например, iPhone-Alex или Mac-Work).',
    targetHint: 'Для каждого телефона или ноутбука рекомендуется создавать свой отдельный ключ.',
    icon: <Smartphone className="w-5 h-5 text-[#6EA8C4]" />
  },
  {
    step: 3,
    title: 'Шаг 3: Дополнительная защита (PSK)',
    description: 'Опция PSK добавляет симметричный 256-битный ключ постквантового шифрования, который защищает трафик даже от будущих суперкомпьютеров.',
    targetHint: 'Рекомендуем оставлять эту опцию включенной.',
    icon: <Zap className="w-5 h-5 text-[#F0D48D]" />
  },
  {
    step: 4,
    title: 'Шаг 4: Подключение в AmneziaWG',
    description: 'После создания ключа откройте приложение AmneziaWG на телефоне и отсканируйте появившийся QR-код. Для ПК просто скачайте файл .conf.',
    targetHint: 'Включите тумблер в приложении — и ваш интернет защищен!',
    icon: <QrCode className="w-5 h-5 text-emerald-400" />
  }
];

interface OnboardingTourProps {
  isActive: boolean;
  onComplete: () => void;
  currentStep?: number;
}

export function OnboardingTour({
  isActive,
  onComplete,
  currentStep: propStep,
}: OnboardingTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (propStep !== undefined && propStep >= 1 && propStep <= ONBOARDING_STEPS.length) {
      setCurrentStepIndex(propStep - 1);
    }
  }, [propStep]);

  if (!isActive) return null;

  const currentStepData = ONBOARDING_STEPS[currentStepIndex];
  const isLast = currentStepIndex === ONBOARDING_STEPS.length - 1;

  const handlePrev = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentStepIndex((prev) => Math.min(prev + 1, ONBOARDING_STEPS.length - 1));
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return createPortal(
    <div className="fixed bottom-20 sm:bottom-8 left-3 right-3 sm:left-auto sm:right-8 z-[10000] max-w-2xl w-auto sm:w-full flex items-end gap-3 sm:gap-4 animate-slideUp">
      {/* Standing Cutout Mascot to the left of the dialog card */}
      <div className="hidden sm:flex flex-col items-center shrink-0 select-none">
        <img 
          src="/assets/mascot.png" 
          alt="Avari Companion" 
          className="w-28 sm:w-36 max-h-48 object-contain object-bottom filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] drop-shadow-[0_0_15px_rgba(217,185,110,0.25)] pointer-events-none"
        />
      </div>

      {/* Speech Dialog Card with Rotating Golden Border Sheen */}
      <div className="flex-1 min-w-0 gold-rotating-border">
        <div className="gold-rotating-border-content p-4 sm:p-6 relative overflow-hidden">
          {/* Glow decoration */}
          <div className="absolute top-0 right-0 w-36 h-36 bg-[radial-gradient(circle_at_100%_0%,rgba(217,185,110,0.15)_0%,transparent_70%)] pointer-events-none" />

          {/* Top Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div className="sm:hidden">
                <MascotAvatar size="sm" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#D9B96E]">
                    Обучение ({currentStepIndex + 1} из {ONBOARDING_STEPS.length})
                  </span>
                </div>
                <h4 className="font-serif font-bold text-base text-[#F2F0E8] leading-tight mt-0.5">
                  {currentStepData.title}
                </h4>
              </div>
            </div>
            <button
              onClick={handleSkip}
              title="Пропустить обучение"
              className="text-[#718187] hover:text-[#F2F0E8] p-1.5 rounded-lg hover:bg-[#102833] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Description & Hint */}
          <p className="text-xs sm:text-sm text-[#D9E1E3] font-sans leading-relaxed mb-3">
            {currentStepData.description}
          </p>

          {currentStepData.targetHint && (
            <div className="bg-[#102833]/80 border border-[#D9B96E]/30 rounded-xl p-2.5 text-xs text-[#F0D48D] flex items-start space-x-2 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-[#D9B96E] flex-shrink-0 mt-0.5" />
              <span>{currentStepData.targetHint}</span>
            </div>
          )}

          {/* Progress Bar & Responsive Action Buttons */}
          <div className="pt-3 border-t border-[#1C3945]/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            {/* Step Dots Indicator */}
            <div className="flex items-center justify-between sm:justify-start space-x-1.5" role="tablist" aria-label="Шаги обучения">
              <div className="flex items-center space-x-1.5">
                {ONBOARDING_STEPS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentStepIndex(idx)}
                    title={`Перейти к шагу ${idx + 1}`}
                    aria-label={`Шаг ${idx + 1}`}
                    className={`h-1.5 sm:h-2 rounded-full transition-all duration-300 cursor-pointer focus:outline-none ${
                      idx === currentStepIndex
                        ? 'w-6 bg-[#D9B96E]'
                        : idx < currentStepIndex
                        ? 'w-3 bg-[#6EA8C4] hover:bg-[#D9B96E]/80'
                        : 'w-2 bg-[#1C3945] hover:bg-[#6EA8C4]/60'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[11px] font-mono text-[#A8B4B7] sm:hidden">
                {currentStepIndex + 1} / {ONBOARDING_STEPS.length}
              </span>
            </div>

            {/* Action Buttons: Full-width stacked on mobile with vertical gap, inline on desktop */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={handleNext}
                className="w-full sm:w-auto order-1 sm:order-3 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold py-2.5 sm:py-2 px-4 rounded-xl text-xs uppercase tracking-wider font-mono shadow-md shadow-[#D9B96E]/20 flex items-center justify-center space-x-1.5 transition cursor-pointer shrink-0"
              >
                {isLast ? (
                  <>
                    <Check className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    <span>Завершить</span>
                  </>
                ) : (
                  <>
                    <span>Далее</span>
                    <ArrowRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  </>
                )}
              </button>

              {currentStepIndex > 0 && (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="w-full sm:w-auto order-2 sm:order-2 text-xs font-mono uppercase tracking-wider text-[#D9E1E3] hover:text-[#F2F0E8] bg-[#102833] hover:bg-[#1C3945] border border-[#1C3945] hover:border-[#D9B96E]/40 py-2.5 sm:py-2 px-3.5 rounded-xl flex items-center justify-center space-x-1.5 transition cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  <span>Назад</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSkip}
                className="w-full sm:w-auto order-3 sm:order-1 text-xs font-mono uppercase tracking-wider text-[#A8B4B7] hover:text-[#F2F0E8] py-2 sm:py-1.5 px-3 rounded-lg transition cursor-pointer text-center shrink-0 hover:bg-[#102833]/60"
              >
                Пропустить
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
