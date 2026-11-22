# TASK-073: Интеграция протокола Mieru и транслитерация названий ключей

## 1. Цели и скоуп задачи
1. **Интеграция протокола Mieru (`enfein/mieru` & `avari-gate`/`mieru-admin`)**:
   - Поддержка Mieru как третьего протокола наряду с AmneziaWG и Hysteria 2.
   - Поддержка флага `has_mieru` у нод в БД SQLite, Master API и Slave API.
   - Управление пользователями Mieru через локальный API `mieru-admin` (`http://127.0.0.1:9081/v1` с Bearer-токеном из `/etc/mieru-admin/token`) с fallback на CLI `mieru-admin user add`.
   - Генерация клиентского AvariGate JSON-профиля (`server`, `server_port: 28443`, `transport: "TCP"`, `username`, `password`) и URI-ссылки быстрого импорта `mierus://...` с QR-кодом для Hiddify / NekoBox.
   - Мониторинг доступности службы Mieru (`mieru_available`) в `HealthChecker`.
2. **Транслитерация названий ключей**:
   - Разрешить пользователю вводить имя устройства на кириллице (например, «Айфон рабочий», «Ноутбук»).
   - При сохранении переводить название в чистую латиницу (транслит, например «Ayfon rabochiy», «Noutbuk») и формировать `client_name` как `u{userID}_Ayfon_rabochiy` вместо прежней замены всех кириллических букв на `_`.
3. **Фронтенд и синхронизация Mock Mode**:
   - Обновление селектора протоколов в `CreateKeyModal.tsx` и `TelegramMiniApp.tsx` (AmneziaWG, Hysteria 2, Mieru).
   - Поддержка Mieru в `KeyModal.tsx` (QR-код `mierus://`, копирование ссылки, скачивание `.json`).
   - Отображение бейджей Mieru в `AdminNodes`, `ServerDetailPage`, `ClientKeysView`, `AdminAllKeys`.
   - Полная синхронизация `mockClient.ts` для автономного режима `npm run dev:mock`.

---

## 2. Затронутые модули и файлы
- `apps/backend/internal/models/models.go` & `contracts.go`
- `apps/backend/internal/storage/sqlite.go` & `sqlite_test.go`
- `apps/backend/internal/mieru/store.go` & `store_test.go` [NEW]
- `apps/backend/internal/slave/server.go` & `server_test.go`
- `apps/backend/internal/master/server.go` & `server_test.go`
- `apps/backend/internal/master/translit.go` & `translit_test.go` [NEW]
- `apps/backend/internal/monitor/healthchecker.go`
- `apps/frontend/src/types/index.ts`
- `apps/frontend/src/api/client.ts` & `mockClient.ts`
- `apps/frontend/src/components/CreateKeyModal.tsx`
- `apps/frontend/src/components/KeyModal.tsx`
- `apps/frontend/src/components/AdminNodes.tsx`
- `apps/frontend/src/components/ServerDetailPage.tsx`
- `apps/frontend/src/components/ClientKeysView.tsx`
- `apps/frontend/src/components/AdminAllKeys.tsx`
- `apps/frontend/src/components/TelegramMiniApp.tsx`
- `_docs/TASKS.md`

---

## 3. Чек-лист верификации
- [x] Транслитерация кириллицы в латиницу в `apps/backend/internal/master/translit.go` + тесты `translit_test.go`
- [x] Поле `has_mieru` в SQLite хранилище с безопасной миграцией
- [x] Пакет `apps/backend/internal/mieru` с интеграцией `mieru-admin` API (`:9081/v1`) и формированием AvariGate JSON + `mierus://` URI
- [x] Slave API поддержка Mieru для создания, получения, удаления и проверки работоспособности службы
- [x] Master API валидация доступности `has_mieru` и транслитерация названий ключей
- [x] Синхронизация `mockClient.ts` с транслитерацией и генерацией демо-профилей Mieru
- [x] Frontend компоненты: модалки `CreateKeyModal`, `KeyModal`, `AdminNodes`, `ServerDetailPage`, `ClientKeysView`, `AdminAllKeys`, `TelegramMiniApp`
- [x] `make test` (все тесты бэкенда с флагом `-race` пройдены успешно)
- [x] `make lint` (`go vet` пройден)
- [x] `make build-linux` (Linux amd64/arm64 Zero-CGO компиляция успешно пройдена)
- [x] `cd apps/frontend && npm run build` (сборка фронтенда TypeScript + Vite успешно завершена)

## 4. Результаты
Задача полностью выполнена в соответствии с архитектурными инвариантами `AGENTS.md` (Zero CGo, чистый Go SQLite, строгая синхронизация `mockClient.ts`, отсутствие сторонних тяжелых библиотек). Протокол Mieru успешно интегрирован на всех слоях системы.
