# TASK-089: Детекция блокировок серверов по IP, статус «Заблокирован», авто-новости и лаконичные уведомления Telegram

## 1. Цели и скоуп
- **Проблема**: При блокировке IP-адресов зарубежных нод из РФ (ТСПУ/РКН) серверы часто остаются полностью исправными в европейском контуре, но помечаются системой как упавшие (`Offline / Сбой`), заставляя воркер мониторинга тратить по 15–30 секунд на таймауты каждый цикл. Пользователи не понимают причину сбоя и пытаются выпускать ключи на недоступный узел. Уведомления Telegram-бота перегружены псевдографикой и шаблонным текстом.
- **Решение**:
  1. Детектирование блокировки IP через перекрестную пробу (RU Fail + EU Egress OK) и ручное переключение.
  2. Выделенный визуальный статус узла **`Заблокирован`** (`[🚫 Заблокирован]`) с поясняющим тултипом.
  3. Исключение заблокированных узлов из тяжелого цикла проверок (Fast-path bypass).
  4. Периодический легкий опрос снятия блокировки раз в 15 минут (`UnblockProber`) с авто-восстановлением.
  5. Автоматическая публикация инцидента в новости (и верхний `NewsBanner`) при блокировке и автоматическое снятие при восстановлении (без спама).
  6. Блокировка выбора заблокированного сервера при создании ключей для обычных пользователей.
  7. Полная ревизия шаблонов Telegram-бота: сокращение всех алертов до ультра-лаконичного формата в 2–3 строки.

## 2. Затронутые модули и компоненты
- **Backend**:
  - `apps/backend/internal/models/models.go` (расширение `Node`, `NodePublic`, `NodeWithStatus`, `StatusDetail`)
  - `apps/backend/internal/storage/sqlite.go` (миграция v5: `is_blocked`, `blocked_reason`, `blocked_at`, `unblock_check_at`; методы работы с блокировками и новостями)
  - `apps/backend/internal/monitor/healthchecker.go` (Fast-path bypass, перекрестная верификация, 15-минутный `UnblockProber`, авто-новости)
  - `apps/backend/internal/master/handlers_nodes.go` (эндпоинты `/block`, `/unblock`, `/check-unblock`)
  - `apps/backend/internal/telegram/bot.go` (ультра-лаконичные алерты без псевдографики: `NotifyNodeDown`, `NotifyNodeRecovered`, `NotifyNodeBlocked`, `NotifyNodeUnblocked`, `NotifyCascadeFailover`, `NotifyNewUser`, `NotifyPasswordReset`, `SendTestAlert`)
- **Frontend**:
  - `apps/frontend/src/types/index.ts`
  - `apps/frontend/src/api/client.ts` и `apps/frontend/src/api/mockClient.ts`
  - `apps/frontend/src/components/AdminNodes.tsx`
  - `apps/frontend/src/components/ServerDetailPage.tsx`
  - `apps/frontend/src/components/CreateKeyModal.tsx`
  - `apps/frontend/src/components/NetworkDashboard.tsx`

## 3. Архитектурные инварианты
- Zero-CGo: чистый Go SQLite через `modernc.org/sqlite`.
- Обязательный паритет Mock Mode: полная поддержка `npm run dev:mock` в `mockClient.ts`.
- Чистота формулировок: статус отображается как «Заблокирован» (без слова ТСПУ в основном бейдже, с детальным тултипом при наведении).
- Отсутствие спама: дедупликация новостей и сообщений бота при дребезге сети.

## 4. Чек-лист верификации
- [x] Миграция v5 в SQLite проходит успешно.
- [x] Сервер со статусом `is_blocked = true` пропускается основным циклом `CheckHealth` без таймаутов.
- [x] Воркер `UnblockProber` корректно опрашивает заблокированные узлы раз в 15 минут.
- [x] При снятии блокировки сервер переходит в активное состояние, а новость-инцидент снимается.
- [x] Все алерты в Telegram выводятся в компактном 2–3 строчном виде.
- [x] Все тесты `go test -v -race ./...` проходят.
- [x] Сборка Linux (`make build-linux`) проходит без CGo.
- [x] Сборка фронтенда (`npm run build`) успешна.
