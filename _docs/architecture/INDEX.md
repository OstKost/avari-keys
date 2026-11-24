# Архитектурный навигатор и реестр подсистем Avari Keys

Этот каталог содержит модульные архитектурные и кодовые руководства по каждой подсистеме проекта.

> [!TIP]
> **Для AI-агентов (Codex, Antigravity) и разработчиков**:
> Не читайте всю кодовую базу целиком! Найдите вашу задачу в таблице ниже и откройте **только соответствующий документ** (100–250 строк целевого описания, контрактов, инвариантов и типичных граблей).

---

## 🧭 Навигационная матрица подсистем

| Что вы делаете? (Задача) | Целевой документ | Ключевые файлы кода |
|---|---|---|
| Добавить/изменить API эндпоинт, middleware, обработчик Master или Slave | [**BACKEND_STRUCTURE.md**](./BACKEND_STRUCTURE.md) | `apps/backend/internal/master/handlers_*.go`<br/>`apps/backend/cmd/master/main.go`<br/>`apps/backend/internal/slave/` |
| Добавить таблицу, колонку, миграцию SQLite, настроить очистку данных | [**STORAGE_AND_MIGRATIONS.md**](./STORAGE_AND_MIGRATIONS.md) | `apps/backend/internal/storage/sqlite.go`<br/>`apps/backend/internal/retention/worker.go` |
| Настроить маршрутизацию каскада, проверки доступности, Auto-Failover, Watchdog | [**CASCADE_AND_EGRESS.md**](./CASCADE_AND_EGRESS.md) | `apps/backend/internal/egress/`<br/>`apps/backend/internal/monitor/healthchecker.go` |
| Изменить расчет трафика, Delta Engine, учет за месяц, формулу биллинга | [**TELEMETRY_AND_BILLING.md**](./TELEMETRY_AND_BILLING.md) | `apps/backend/internal/storage/sqlite.go`<br/>`apps/backend/internal/master/handlers_billing.go` |
| Безопасность, Rate Limiting, защита от DoS, токены, права доступа, Decoy | [**SECURITY_AND_AUTH.md**](./SECURITY_AND_AUTH.md) | `apps/backend/internal/master/ratelimit.go`<br/>`apps/backend/internal/auth/`<br/>`apps/backend/internal/slave/` |
| Изменить Telegram-бота, модерацию через inline-кнопки или Telegram Mini App | [**TELEGRAM_AND_TMA.md**](./TELEGRAM_AND_TMA.md) | `apps/backend/internal/telegram/`<br/>`apps/frontend/src/components/TelegramMiniApp.tsx` |
| Создать/изменить UI экран, модалку, компонент, маршрут, синхронизировать моки | [**FRONTEND_SPA.md**](./FRONTEND_SPA.md) | `apps/frontend/src/components/`<br/>`apps/frontend/src/api/client.ts`<br/>`apps/frontend/src/api/mockClient.ts` |

---

## 🏛️ Ключевые архитектурные инварианты (Recap)

1. **Zero CGo / Static Single Binary**:
   - Master (`cmd/master`) и Slave (`cmd/slave`) компилируются строго с `CGO_ENABLED=0`.
   - БД — только чистый Go SQLite (`modernc.org/sqlite`).
2. **Изоляция приватных ключей**:
   - В SQLite Master **запрещено** сохранять приватные ключи клиентов (только `public_key` и метаданные).
3. **Decoy-маскировка**:
   - Корневой эндпоинт Slave `/` всегда отдает нейтральную заглушку для сканеров.
   - Telegram-бот не раскрывает функционал VPN неавторизованным чатам.
4. **Синхронизация Mock Mode (Frontend)**:
   - Любое изменение сигнатуры в `client.ts` **обязано зеркально отражаться** в `mockClient.ts` (`npm run dev:mock`).
5. **Телеметрия Delta Engine**:
   - Подсчет трафика ведется через дельты счетчиков; сброс интерфейса ноды не обнуляет накопленный объем.
6. **Brand Neutrality (Суверенитет ядра)**:
   - Никаких брендов внешних коммерческих дистрибутивов в Upstream-репозитории.
