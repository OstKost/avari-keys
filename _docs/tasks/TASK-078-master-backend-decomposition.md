# TASK-078: Master Backend Decomposition & Versioned Migrations

## 1. Цели и скоуп
- **Проблема**: Файл `apps/backend/internal/master/server.go` разросся до 2340+ строк кода, объединяя разнородные доменные области (авторизация, ключи, ноды, биллинг, новости, администрирование пользователей и аудит). В `apps/backend/internal/storage/sqlite.go` миграции выполнялись через длинный процедурный метод `initSchema` с ручными `PRAGMA table_info` без версионирования в БД. В `apps/backend/internal/telegram/bot.go` присутствовали вызовы `ListUsers` для точечного поиска пользователей.
- **Цель**:
  1. Декомпозировать `server.go` на чистые доменные обработчики в пакете `master`:
     - `handlers_auth.go` — авторизация, регистрация, профиль, сброс паролей, Telegram MiniApp auth.
     - `handlers_keys.go` — создание, удаление, просмотр конфигураций AWG и VLESS, транслитерация.
     - `handlers_nodes.go` — публичные ноды, администрирование узлов, Egress статус, switch, restart.
     - `handlers_billing.go` — статус биллинга, отметка платежей, реквизиты СБП.
     - `handlers_news.go` — новости, анонсы и рассылки.
     - `handlers_admin.go` — управление пользователями, модерация, аудит-логи, Telegram-настройки.
     - `server.go` — инициализация Server, роутинг, middleware (CORS, Rate Limit, Security Headers, MaxBytes).
  2. Внедрить таблицу `schema_migrations` в `apps/backend/internal/storage/sqlite.go`:
     - Фиксация примененных версий миграций (`version INT PRIMARY KEY`, `applied_at TIMESTAMP`).
     - Линейный упорядоченный список версионных миграций для воспроизводимого старта.
  3. Оптимизировать выборки в `telegram/bot.go` (использовать целевые индексы и `GetUserByID`).
  4. Сохранить 100% обратную совместимость API и Zero-CGo сборку.

## 2. Затронутые модули и файлы
- `apps/backend/internal/master/server.go`
- `apps/backend/internal/master/handlers_auth.go`
- `apps/backend/internal/master/handlers_keys.go`
- `apps/backend/internal/master/handlers_nodes.go`
- `apps/backend/internal/master/handlers_billing.go`
- `apps/backend/internal/master/handlers_news.go`
- `apps/backend/internal/master/handlers_admin.go`
- `apps/backend/internal/storage/sqlite.go`
- `apps/backend/internal/storage/sqlite_test.go`
- `apps/backend/internal/telegram/bot.go`
- `_docs/TASKS.md`

## 3. Чек-лист верификации
- [x] Декомпозиция handlers без циклических зависимостей.
- [x] Таблица `schema_migrations` корректно фиксирует накат схемы при инициализации SQLite.
- [x] Все тесты бэкенда (`go test -race ./...`) проходят успешно.
- [x] `make lint` и `make build-linux` компилируются без ошибок.
