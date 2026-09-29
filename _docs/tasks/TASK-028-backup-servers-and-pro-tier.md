# TASK-028: Backup Servers Indicator and PRO Tier System

## 📌 Описание задачи
Реализация признака «Запасной сервер» (`is_backup`), пользовательского тарифа «PRO» (`is_pro`), разграничения прав на создание ключей, обновленной формулы расчета взноса (300 ₽ + 50 ₽ за ключ выше 3) и информационных UI-блоков.

## 🎯 Чек-лист реализации

### 1. Бэкенд (Go & SQLite)
- [x] Добавление `is_backup` в `nodes` (схема, модель, миграция)
- [x] Добавление `is_pro` в `users` (схема, модель, миграция)
- [x] Метод `SetUserPro(ctx, id, isPro)` в хранилище SQLite
- [x] Обновление `GetBillingStatus` с учетом `is_pro` (300 ₽ + 50 ₽ за ключ)
- [x] Эндпоинт `POST /api/v1/admin/users/{id}/pro` для управления PRO-статусом с аудит-логированием
- [x] Валидация в `POST /api/v1/keys`: отклонение запросов не-PRO пользователей на запасных серверах (`403 Forbidden`)
- [x] Модульные и контрактные тесты бэкенда

### 2. Фронтенд (React & TypeScript)
- [x] Обновление интерфейсов `User`, `NodePublic`, `AdminNode`, `BillingStatus` в `types/index.ts`
- [x] Обновление `api.setUserPro` в `client.ts` и `mockClient.ts`
- [x] `AdminNodes.tsx`: чекбокс «Запасной сервер» при создании/редактировании и бейдж `[Запасной (PRO)]`
- [x] `AdminUsers.tsx`: отображение статуса `PRO` и переключение с подтверждением в `ConfirmModal`
- [x] `CreateKeyModal.tsx`: визуальное выделение и блокировка запасных серверов для не-PRO пользователей
- [x] `App.tsx`: инфо-блок на странице ключей с перечнем запасных серверов и условиями получения PRO
- [x] `BillingPage.tsx`: отображение активного тарифа (Базовый / PRO) и формулы 300+50 ₽

### 3. Верификация
- [x] `go vet ./...` & `go test -v -race ./...`
- [x] `CGO_ENABLED=0 go build -o /dev/null ./cmd/master`
- [x] `npm run build`
