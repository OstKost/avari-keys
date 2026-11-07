import React from 'react';
import { animatedPortal as createPortal } from './animatedPortal';
import { AlertTriangle, Trash2, HelpCircle, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'gold';
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  variant = 'danger',
  isLoading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <Trash2 className="w-6 h-6 text-rose-400" />;
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-amber-400" />;
      case 'gold':
      default:
        return <HelpCircle className="w-6 h-6 text-[#D9B96E]" />;
    }
  };

  const getConfirmButtonClasses = () => {
    switch (variant) {
      case 'danger':
        return 'bg-gradient-to-r from-rose-600 via-rose-700 to-rose-800 hover:from-rose-500 hover:to-rose-700 text-white shadow-rose-950/50';
      case 'warning':
        return 'bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white shadow-amber-950/50';
      case 'gold':
      default:
        return 'bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] shadow-[#D9B96E]/20';
    }
  };

  const getBorderColor = () => {
    switch (variant) {
      case 'danger':
        return 'border-rose-500/40';
      case 'warning':
        return 'border-amber-500/40';
      case 'gold':
      default:
        return 'border-[#D9B96E]/40';
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className={`bg-[#0A1D26] border ${getBorderColor()} rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl shadow-black/90 relative transform transition-all my-auto`}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-5 right-5 text-[#718187] hover:text-[#F2F0E8] p-1.5 rounded-xl hover:bg-[#102833] transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start space-x-3.5 mb-4">
          <div className="bg-[#102833] p-3 rounded-2xl border border-[#1C3945] shrink-0">
            {getIcon()}
          </div>
          <div className="pr-6">
            <h3 className="font-serif text-lg font-bold text-[#F2F0E8] tracking-wide leading-snug">
              {title}
            </h3>
          </div>
        </div>

        <div className="text-sm text-[#A8B4B7] font-sans leading-relaxed mb-6 bg-[#06141B]/60 p-4 rounded-2xl border border-[#1C3945]/70">
          {message}
        </div>

        <div className="flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 text-sm font-mono uppercase tracking-wider text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition disabled:opacity-40 cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2.5 text-sm font-mono font-bold uppercase tracking-wider rounded-xl shadow-lg transition disabled:opacity-50 cursor-pointer ${getConfirmButtonClasses()}`}
          >
            {isLoading ? 'Выполнение...' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
