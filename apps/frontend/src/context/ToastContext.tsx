import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, title?: string, duration?: number) => void;
  toast: {
    success: (message: string, title?: string, duration?: number) => void;
    error: (message: string, title?: string, duration?: number) => void;
    warning: (message: string, title?: string, duration?: number) => void;
    info: (message: string, title?: string, duration?: number) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', title?: string, duration = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, type, message, title, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const toast = {
    success: (message: string, title?: string, duration?: number) =>
      showToast(message, 'success', title, duration),
    error: (message: string, title?: string, duration?: number) =>
      showToast(message, 'error', title, duration),
    warning: (message: string, title?: string, duration?: number) =>
      showToast(message, 'warning', title, duration),
    info: (message: string, title?: string, duration?: number) =>
      showToast(message, 'info', title, duration),
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />;
      case 'info':
      default:
        return <Info className="w-5 h-5 text-[#D9B96E] shrink-0 mt-0.5" />;
    }
  };

  const getBorderColor = (type: ToastType) => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/40 hover:border-emerald-500/70 shadow-emerald-950/40';
      case 'error':
        return 'border-rose-500/40 hover:border-rose-500/70 shadow-rose-950/40';
      case 'warning':
        return 'border-amber-500/40 hover:border-amber-500/70 shadow-amber-950/40';
      case 'info':
      default:
        return 'border-[#D9B96E]/40 hover:border-[#D9B96E]/70 shadow-[#D9B96E]/10';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, toast }}>
      {children}

      {/* Top-Right Toast Container */}
      <div className="fixed top-5 right-5 z-[2000] flex flex-col space-y-3 max-w-sm w-full pointer-events-none sm:max-w-md">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto bg-[#0A1D26]/95 backdrop-blur-xl border ${getBorderColor(
              t.type
            )} rounded-2xl p-4 shadow-2xl transition-all duration-300 transform translate-y-0 opacity-100 flex items-start space-x-3.5 group`}
          >
            {getIcon(t.type)}
            <div className="flex-1 pr-2">
              {t.title && (
                <h5 className="font-serif font-bold text-sm text-[#F2F0E8] leading-tight mb-0.5">
                  {t.title}
                </h5>
              )}
              <p className="text-sm text-[#A8B4B7] font-sans leading-relaxed break-words">
                {t.message}
              </p>
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-[#718187] hover:text-[#F2F0E8] p-1 rounded-lg hover:bg-[#102833] transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
