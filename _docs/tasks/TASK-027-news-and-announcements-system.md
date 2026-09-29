# TASK-027: Страница «Новости» (Announcements) с публикацией, категориями, рассылкой в Telegram и баннером

- **Статус**: ✅ Done
- **Ветка**: `feature/TASK-027-news-announcements-tg` $\rightarrow$ `develop`
- **Исполнитель**: Antigravity (Pair Programming)

---

## 🎯 Цели и решенные задачи

1. **Модель данных и SQLite хранилище**:
   - Создана таблица `announcements` с полями `id`, `title`, `content`, `category`, `is_pinned`, `author_name`, `created_at`, `updated_at`.
   - Добавлены индексы `idx_announcements_created_at` и `idx_announcements_is_pinned`.
   - Реализованы методы CRUD: `ListNews`, `GetNewsByID`, `CreateNews`, `UpdateNews`, `DeleteNews`.

2. **Master Backend API**:
   - `GET /api/v1/news` (`RequireAuth`) — получение списка новостей с сортировкой (закрепленные вверху, затем по дате).
   - `POST /api/v1/admin/news` (`RequireAdmin`) — публикация новости с опциональной мгновенной рассылкой в Telegram.
   - `PUT /api/v1/admin/news/{id}` (`RequireAdmin`) — редактирование существующей новости.
   - `DELETE /api/v1/admin/news/{id}` (`RequireAdmin`) — удаление новости.
   - Запись действий в аудит-логи (`admin_news_create`, `admin_news_update`, `admin_news_delete`).

3. **Интеграция с Telegram-ботом (`BroadcastNews`)**:
   - При публикации новости с флагом `notify_telegram = true` бот форматирует красивое HTML-сообщение с эмодзи категории, меткой закрепления и автором, и рассылает всем подписчикам сети.

4. **Frontend UI (React + Tailwind CSS)**:
   - Вкладка **«Новости»** в главном меню с бейджем-индикатором непрочитанных событий.
   - Компонент `NewsPage`:
     - Фильтрация по 5 категориям (*Техработы, Сбои / Аварии, Взносы, Ключи, Новости сети*) и поиск по тексту.
     - Модальное окно создания / редактирования новости (с чекбоксами закрепления и отправки в Telegram).
     - Модальное окно подтверждения удаления (`ConfirmModal`).
   - Компонент `NewsBanner`:
     - Компактная плашка важного/закрепленного объявления над списком ключей на главной вкладке с кнопкой быстрого перехода и закрытия.

---

## 🧪 Верификация

- `apps/backend`: `go vet ./...` (PASS).
- `apps/backend`: `go test -v -race ./...` (PASS, включая новые тесты `TestNewsEndpointsFlow` и `TestAnnouncementsStorage`).
- `apps/backend`: `CGO_ENABLED=0 go build -o /dev/null ./cmd/slave && CGO_ENABLED=0 go build -o /dev/null ./cmd/master` (PASS).
- `apps/frontend`: `npm run build` (PASS).
