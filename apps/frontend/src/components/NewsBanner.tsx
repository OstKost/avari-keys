import React, { useState, useEffect } from 'react';
import { Megaphone, Wrench, AlertTriangle, CreditCard, Key, ChevronRight, X, Pin } from 'lucide-react';
import { NewsItem } from '../types';

interface NewsBannerProps {
  news: NewsItem[];
  onNavigateToNews: () => void;
}

export const NewsBanner: React.FC<NewsBannerProps> = ({ news, onNavigateToNews }) => {
  const [dismissedId, setDismissedId] = useState<number | null>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem('avari_dismissed_banner_news_id');
    if (dismissed) {
      setDismissedId(parseInt(dismissed, 10));
    }
  }, []);

  // Find the top priority news item (pinned, or the latest non-general/important news)
  const bannerNews = news.find((n) => n.id !== dismissedId && (n.is_pinned || n.category === 'incident' || n.category === 'maintenance'));

  if (!bannerNews) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedId(bannerNews.id);
    localStorage.setItem('avari_dismissed_banner_news_id', bannerNews.id.toString());
  };

  const getCategoryConfig = (category: string) => {
    switch (category) {
      case 'maintenance':
        return {
          icon: <Wrench className="w-4 h-4 text-amber-400 shrink-0" />,
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          borderClass: 'border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-[#0A1D26] to-[#0A1D26]',
          label: 'Техработы',
        };
      case 'incident':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />,
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          borderClass: 'border-rose-500/40 bg-gradient-to-r from-rose-950/40 via-[#0A1D26] to-[#0A1D26]',
          label: 'Сбой / Авария',
        };
      case 'billing':
        return {
          icon: <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />,
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          borderClass: 'border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-[#0A1D26] to-[#0A1D26]',
          label: 'Взносы',
        };
      case 'keys':
        return {
          icon: <Key className="w-4 h-4 text-indigo-400 shrink-0" />,
          badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
          borderClass: 'border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-[#0A1D26] to-[#0A1D26]',
          label: 'Ключи',
        };
      default:
        return {
          icon: <Megaphone className="w-4 h-4 text-[#D9B96E] shrink-0" />,
          badgeClass: 'bg-[#D9B96E]/20 text-[#F0D48D] border-[#D9B96E]/40',
          borderClass: 'border-[#D9B96E]/30 bg-gradient-to-r from-[#D9B96E]/10 via-[#0A1D26] to-[#0A1D26]',
          label: 'Объявление',
        };
    }
  };

  const cfg = getCategoryConfig(bannerNews.category);

  return (
    <div
      onClick={onNavigateToNews}
      className={`border ${cfg.borderClass} rounded-2xl p-3.5 sm:p-4 mb-6 shadow-xl relative overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.008] group backdrop-blur-md`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="bg-[#102833] p-2 sm:p-2.5 rounded-xl border border-[#1C3945] shrink-0 group-hover:border-[#D9B96E]/50 transition">
            {cfg.icon}
          </div>

          <div className="min-w-0">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              {bannerNews.is_pinned && (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-mono font-bold bg-[#D9B96E]/20 text-[#F0D48D] border border-[#D9B96E]/40">
                  <Pin className="w-2.5 h-2.5" />
                  <span>ЗАКРЕПЛЕНО</span>
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-mono font-semibold border ${cfg.badgeClass}`}>
                {cfg.label}
              </span>
              <span className="font-semibold text-xs sm:text-sm text-[#F2F0E8] truncate group-hover:text-[#F0D48D] transition">
                {bannerNews.title}
              </span>
            </div>
            <p className="text-xs text-[#A8B4B7] font-sans line-clamp-1 mt-0.5 pr-2">
              {bannerNews.content}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            className="hidden sm:flex items-center space-x-1 text-xs font-mono text-[#D9B96E] hover:text-[#F0D48D] font-bold group-hover:translate-x-1 transition-transform"
          >
            <span>Подробнее</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            title="Скрыть оповещение"
            className="p-1.5 rounded-lg text-[#718187] hover:text-[#F2F0E8] hover:bg-[#102833] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
