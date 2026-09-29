import React, { useState, useEffect } from 'react';
import {
  Megaphone,
  Wrench,
  AlertTriangle,
  CreditCard,
  Key,
  Plus,
  Pin,
  Edit2,
  Trash2,
  Search,
  CheckCircle2,
  Send,
  X,
  Clock,
  User as UserIcon,
  Sparkles,
} from 'lucide-react';
import { User, NewsItem, NewsCategory, CreateNewsPayload, UpdateNewsPayload } from '../types';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { ConfirmModal } from './ConfirmModal';
import { Loader } from './Loader';

interface NewsPageProps {
  currentUser: User;
}

export const NewsPage: React.FC<NewsPageProps> = ({ currentUser }) => {
  const { toast } = useToast();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingItem, setEditingItem] = useState<NewsItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<NewsItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState<NewsCategory>('general');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formNotifyTelegram, setFormNotifyTelegram] = useState(true);

  const loadNews = async () => {
    try {
      setLoading(true);
      const data = await api.getNews();
      const safeData = Array.isArray(data) ? data : [];
      setNews(safeData);

      // Mark newest item as read in localStorage
      if (safeData.length > 0) {
        const maxId = Math.max(...safeData.map((n) => n.id));
        localStorage.setItem('avari_last_viewed_news_id', maxId.toString());
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки новостей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingItem(null);
    setFormTitle('');
    setFormContent('');
    setFormCategory('general');
    setFormIsPinned(false);
    setFormNotifyTelegram(true);
    setShowEditorModal(true);
  };

  const handleOpenEditModal = (item: NewsItem) => {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormContent(item.content);
    setFormCategory(item.category);
    setFormIsPinned(item.is_pinned);
    setFormNotifyTelegram(false);
    setShowEditorModal(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) {
      toast.error('Заполните заголовок и текст публикации');
      return;
    }

    try {
      setSubmitting(true);
      if (editingItem) {
        const payload: UpdateNewsPayload = {
          title: formTitle.trim(),
          content: formContent.trim(),
          category: formCategory,
          is_pinned: formIsPinned,
        };
        const updated = await api.updateNews(editingItem.id, payload);
        setNews((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        toast.success('Новость успешно обновлена');
      } else {
        const payload: CreateNewsPayload = {
          title: formTitle.trim(),
          content: formContent.trim(),
          category: formCategory,
          is_pinned: formIsPinned,
          notify_telegram: formNotifyTelegram,
        };
        const created = await api.createNews(payload);
        setNews((prev) => [created, ...prev]);
        toast.success(
          formNotifyTelegram
            ? 'Новость опубликована и отправлена в Telegram!'
            : 'Новость успешно опубликована'
        );
      }
      setShowEditorModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения новости');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteNews = async () => {
    if (!itemToDelete) return;
    try {
      setSubmitting(true);
      await api.deleteNews(itemToDelete.id);
      setNews((prev) => prev.filter((n) => n.id !== itemToDelete.id));
      toast.success('Новость удалена');
      setItemToDelete(null);
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления новости');
    } finally {
      setSubmitting(false);
    }
  };

  const getCategoryMeta = (category: NewsCategory) => {
    switch (category) {
      case 'maintenance':
        return {
          label: 'Техработы',
          icon: <Wrench className="w-3.5 h-3.5" />,
          colorClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
          accentBorder: 'hover:border-amber-500/40',
        };
      case 'incident':
        return {
          label: 'Сбой / Авария',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          colorClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
          accentBorder: 'hover:border-rose-500/40',
        };
      case 'billing':
        return {
          label: 'Взносы и оплата',
          icon: <CreditCard className="w-3.5 h-3.5" />,
          colorClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
          accentBorder: 'hover:border-emerald-500/40',
        };
      case 'keys':
        return {
          label: 'Обновление ключей',
          icon: <Key className="w-3.5 h-3.5" />,
          colorClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
          accentBorder: 'hover:border-indigo-500/40',
        };
      default:
        return {
          label: 'Новости сети',
          icon: <Megaphone className="w-3.5 h-3.5" />,
          colorClass: 'bg-[#D9B96E]/15 text-[#F0D48D] border-[#D9B96E]/40',
          accentBorder: 'hover:border-[#D9B96E]/40',
        };
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const filteredNews = news.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch =
      searchQuery === '' ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categoriesList: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Все события', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'maintenance', label: 'Техработы', icon: <Wrench className="w-4 h-4 text-amber-400" /> },
    { id: 'incident', label: 'Сбои / Аварии', icon: <AlertTriangle className="w-4 h-4 text-rose-400" /> },
    { id: 'billing', label: 'Взносы', icon: <CreditCard className="w-4 h-4 text-emerald-400" /> },
    { id: 'keys', label: 'Ключи', icon: <Key className="w-4 h-4 text-indigo-400" /> },
    { id: 'general', label: 'Общее', icon: <Sparkles className="w-4 h-4 text-[#F0D48D]" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl sm:text-2xl font-bold text-[#F2F0E8] tracking-wide flex items-center space-x-2.5">
            <Megaphone className="w-6 h-6 text-[#D9B96E]" />
            <span>Новости и события сети</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#A8B4B7] mt-1 font-sans">
            Уведомления об обновлениях серверов, технических работах и важных объявлениях
          </p>
        </div>

        {currentUser.role === 'admin' && (
          <button
            onClick={handleOpenCreateModal}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs sm:text-sm uppercase tracking-wider font-mono px-5 py-3 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 transition-all duration-300 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Опубликовать новость</span>
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-[#06141B]/60 border border-[#1C3945]/70 p-3 sm:p-4 rounded-2xl backdrop-blur-md">
        {/* Category Filters */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {categoriesList.map((cat) => {
            const count =
              cat.id === 'all' ? news.length : news.filter((n) => n.category === cat.id).length;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex-shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-mono font-medium transition cursor-pointer ${
                  active
                    ? 'bg-[#D9B96E] text-[#06141B] font-bold shadow-md shadow-[#D9B96E]/20'
                    : 'bg-[#0A1D26] hover:bg-[#102833] text-[#A8B4B7] hover:text-[#F2F0E8] border border-[#1C3945]/70'
                }`}
              >
                {cat.icon}
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    active ? 'bg-[#06141B]/20 text-[#06141B]' : 'bg-[#102833] text-[#718187]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Box */}
        <div className="relative min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#718187]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по новостям..."
            className="w-full bg-[#0A1D26] border border-[#1C3945] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:border-[#D9B96E] transition font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718187] hover:text-[#F2F0E8]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* News Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader />
        </div>
      ) : filteredNews.length === 0 ? (
        <div className="bg-[#0A1D26]/60 border border-[#1C3945]/80 rounded-2xl p-12 text-center shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-[#102833] border border-[#1C3945] flex items-center justify-center mx-auto mb-4 text-[#D9B96E]">
            <Megaphone className="w-8 h-8 opacity-60" />
          </div>
          <h3 className="font-serif text-lg font-bold text-[#F2F0E8] mb-1">
            {searchQuery ? 'Ничего не найдено' : 'Новостей пока нет'}
          </h3>
          <p className="text-xs sm:text-sm text-[#A8B4B7] max-w-md mx-auto">
            {searchQuery
              ? 'Попробуйте изменить поисковый запрос или сбросить фильтр по категории.'
              : 'Здесь будут публиковаться важные объявления по серверам, техработам и изменениям в сети.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {filteredNews.map((item) => {
            const meta = getCategoryMeta(item.category);
            return (
              <div
                key={item.id}
                className={`bg-[#0A1D26] border ${
                  item.is_pinned
                    ? 'border-[#D9B96E]/50 shadow-lg shadow-[#D9B96E]/5 bg-gradient-to-br from-[#102833]/80 via-[#0A1D26] to-[#0A1D26]'
                    : 'border-[#1C3945]/80 hover:border-[#1C3945]'
                } ${meta.accentBorder} rounded-2xl sm:rounded-3xl p-5 sm:p-6 transition-all duration-200 relative group overflow-hidden`}
              >
                {/* Subtle pin glow accent */}
                {item.is_pinned && (
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle_at_100%_0%,rgba(217,185,110,0.1)_0%,transparent_70%)] pointer-events-none" />
                )}

                {/* Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
                    {item.is_pinned && (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-[#D9B96E]/20 text-[#F0D48D] border border-[#D9B96E]/40 shadow-sm">
                        <Pin className="w-3 h-3" />
                        <span>ЗАКРЕПЛЕНО</span>
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg text-xs font-mono font-semibold border ${meta.colorClass}`}
                    >
                      {meta.icon}
                      <span>{meta.label}</span>
                    </span>

                    <span className="inline-flex items-center space-x-1 text-xs text-[#718187] font-mono">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(item.created_at)}</span>
                    </span>

                    {item.author_name && (
                      <span className="inline-flex items-center space-x-1 text-xs text-[#718187] font-mono">
                        <UserIcon className="w-3 h-3" />
                        <span>@{item.author_name}</span>
                      </span>
                    )}
                  </div>

                  {/* Admin Actions */}
                  {currentUser.role === 'admin' && (
                    <div className="flex items-center space-x-1 sm:opacity-90 group-hover:opacity-100 transition">
                      <button
                        onClick={() => handleOpenEditModal(item)}
                        title="Редактировать"
                        className="p-1.5 text-[#A8B4B7] hover:text-[#F0D48D] hover:bg-[#102833] rounded-lg transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setItemToDelete(item)}
                        title="Удалить"
                        className="p-1.5 text-[#A8B4B7] hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Card Title */}
                <h3 className="font-serif text-base sm:text-lg font-bold text-[#F2F0E8] mb-2.5 leading-snug">
                  {item.title}
                </h3>

                {/* Card Content with whitespace-pre-line formatting */}
                <div className="text-xs sm:text-sm text-[#A8B4B7] font-sans leading-relaxed whitespace-pre-line break-words bg-[#06141B]/40 p-3.5 sm:p-4 rounded-xl border border-[#1C3945]/40">
                  {item.content}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showEditorModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-[#06141B]/85 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="bg-[#0A1D26] border border-[#D9B96E]/40 rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl shadow-black/90 relative transform transition-all my-auto">
            <button
              type="button"
              onClick={() => setShowEditorModal(false)}
              disabled={submitting}
              className="absolute top-5 right-5 text-[#718187] hover:text-[#F2F0E8] p-1.5 rounded-xl hover:bg-[#102833] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="bg-[#102833] p-3 rounded-2xl border border-[#1C3945] text-[#D9B96E]">
                {editingItem ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-serif text-lg font-bold text-[#F2F0E8]">
                  {editingItem ? 'Редактирование новости' : 'Новая публикация'}
                </h3>
                <p className="text-xs text-[#A8B4B7] font-sans mt-0.5">
                  {editingItem
                    ? 'Обновите текст или параметры объявления'
                    : 'Опубликуйте новость для всех пользователей сети'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-mono uppercase text-[#A8B4B7] mb-1.5">
                  Заголовок новости *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Например: Плановые техработы на сервере Германия S2"
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:border-[#D9B96E] transition font-sans"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-mono uppercase text-[#A8B4B7] mb-1.5">
                  Категория события *
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as NewsCategory)}
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] focus:outline-none focus:border-[#D9B96E] transition font-sans cursor-pointer"
                >
                  <option value="general">📢 Новости сети (Общее)</option>
                  <option value="maintenance">🛠️ Технические работы (Maintenance)</option>
                  <option value="incident">🚨 Сбой / Авария (Incident)</option>
                  <option value="billing">💳 Взносы и оплата (Billing)</option>
                  <option value="keys">🔑 Обновление ключей и конфигураций (Keys)</option>
                </select>
              </div>

              {/* Content */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-mono uppercase text-[#A8B4B7]">
                    Текст публикации *
                  </label>
                  <span className="text-[10px] text-[#718187] font-mono">
                    {formContent.length} симв.
                  </span>
                </div>
                <textarea
                  required
                  rows={5}
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Подробное описание изменений, времени проведения работ или инструкций..."
                  className="w-full bg-[#06141B] border border-[#1C3945] rounded-xl px-4 py-2.5 text-sm text-[#F2F0E8] placeholder-[#718187] focus:outline-none focus:border-[#D9B96E] transition font-sans resize-y"
                />
              </div>

              {/* Options */}
              <div className="bg-[#06141B]/70 p-4 rounded-2xl border border-[#1C3945]/70 space-y-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIsPinned}
                    onChange={(e) => setFormIsPinned(e.target.checked)}
                    className="w-4 h-4 rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#0A1D26] cursor-pointer"
                  />
                  <div className="flex items-center space-x-1.5 text-xs text-[#F2F0E8]">
                    <Pin className="w-3.5 h-3.5 text-[#F0D48D]" />
                    <span className="font-semibold">Закрепить вверху ленты</span>
                  </div>
                </label>

                {!editingItem && (
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formNotifyTelegram}
                      onChange={(e) => setFormNotifyTelegram(e.target.checked)}
                      className="w-4 h-4 rounded border-[#1C3945] text-[#D9B96E] focus:ring-[#D9B96E] bg-[#0A1D26] cursor-pointer"
                    />
                    <div className="flex items-center space-x-1.5 text-xs text-[#F2F0E8]">
                      <Send className="w-3.5 h-3.5 text-sky-400" />
                      <span className="font-semibold">
                        Отправить в Telegram-бот всем подписчикам
                      </span>
                    </div>
                  </label>
                )}
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  disabled={submitting}
                  className="px-4 py-2.5 text-sm font-mono uppercase tracking-wider text-[#A8B4B7] hover:text-[#F2F0E8] rounded-xl hover:bg-[#102833] border border-transparent hover:border-[#1C3945] transition disabled:opacity-40 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center space-x-2 bg-gradient-to-r from-[#F0D48D] via-[#D9B96E] to-[#A98A48] hover:from-[#F0D48D] hover:to-[#D9B96E] text-[#06141B] font-bold text-xs sm:text-sm uppercase tracking-wider font-mono px-5 py-2.5 rounded-xl shadow-lg shadow-[#D9B96E]/20 hover:shadow-[#D9B96E]/40 transition disabled:opacity-40 cursor-pointer"
                >
                  {submitting ? (
                    <span>Сохранение...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{editingItem ? 'Сохранить изменения' : 'Опубликовать'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!itemToDelete}
        title="Удаление новости"
        message={
          itemToDelete ? (
            <div>
              Вы уверены, что хотите удалить публикацию «<strong className="text-[#F2F0E8]">{itemToDelete.title}</strong>»?
              Это действие нельзя отменить.
            </div>
          ) : (
            ''
          )
        }
        confirmText="Удалить"
        cancelText="Отмена"
        variant="danger"
        isLoading={submitting}
        onConfirm={handleDeleteNews}
        onClose={() => setItemToDelete(null)}
      />
    </div>
  );
};
