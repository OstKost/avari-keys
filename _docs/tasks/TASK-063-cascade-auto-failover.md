# TASK-063 — Отключаемое автопереключение выходов каскада (Cascade Auto-Failover)

## Статус: ✅ Done
**Ветка**: `feature/TASK-063-cascade-auto-failover`

---

## 1. Цели и скоуп

Реализовать надежный и отключаемый механизм автоматического переключения Egress-шлюзов (Auto-Failover) для каскадных серверов (`type == 'cascade'`) в случае недоступности текущего активного направления (авария за рубежом или блокировка РКН/ТСПУ).

### Ключевые возможности:
1. **Отключаемость (Toggle)**:
   - Включение/отключение автопереключения через тумблер в веб-панели на странице конкретного сервера и при редактировании параметров ноды.
2. **Защита от флаппинга (Anti-Flapping)**:
   - Порог подтверждения сбоя (`FailureThreshold = 2` последовательных цикла сбоя активного шлюза).
   - Период охлаждения (`Cooldown = 5 минут`) после успешного переключения, предотвращающий частые обрывы сессий.
   - Политика Sticky: работа на новом здоровом шлюзе без паразитного обратного переключения.
3. **Список приоритетов (Priority Order)**:
   - Администратор может настраивать порядок предпочтения шлюзов (например: `S1 Нидерланды` $\to$ `S4 Швеция` $\to$ `S3 Германия` $\to$ `S5P PRO`).
   - При сбое активного выхода контроллер автоматически выбирает первый здоровый (`available == true`) шлюз из списка приоритетов.
4. **Оповещения и аудит**:
   - Автоматическая фиксация каждого переключения в журнале аудита (`admin_cascade_auto_failover`).
   - Мгновенное оповещение администраторов в Telegram-боте о факте сбоя и переключении маршрута.
5. **UI на странице сервера**:
   - Тумблер активации Auto-Failover в блоке «Каскадная маршрутизация».
   - Индикатор состояния контроллера (счетчик ошибок 0/2, активный таймер Cooldown).
   - Интерфейс настройки приоритетов направлений (стрелки перемещения `[↑]` / `[↓]`).
6. **Полная поддержка Mock-режима**:
   - Синхронная реализация в `mockClient.ts` для тестирования без реального бэкенда.

---

## 2. Затронутые модули и файлы

### Бэкенд (Go 1.22+ Zero CGo SQLite):
- `apps/backend/internal/models/models.go` — поля `AutoFailoverEnabled` и `FailoverPriority` в структурах ноды и DTO запросов, `FailoverRuntimeStatus`.
- `apps/backend/internal/storage/sqlite.go` — миграция БД (`ALTER TABLE nodes ADD COLUMN auto_failover_enabled...`), сохранение и чтение полей `auto_failover_enabled` и `failover_priority`.
- `apps/backend/internal/monitor/healthchecker.go` — алгоритм детекции падения активного шлюза, учет порога ошибок, cooldown и вызов `SwitchCascadeEgress`, методы `GetFailoverStatus` и `ResetFailover`.
- `apps/backend/internal/telegram/bot.go` — метод `NotifyCascadeFailover` отправки алерта об автопереключении администраторам в Telegram.
- `apps/backend/internal/master/server.go` — эндпоинт `POST /api/v1/admin/nodes/{id}/failover` и поддержка в `PUT /api/v1/admin/nodes/{id}`.
- `apps/backend/internal/master/server_test.go` — контрактный тест `TestAdminCascadeAutoFailoverSettingsFlow`.
- `apps/backend/internal/monitor/healthchecker_test.go` — модульный тест `TestCascadeAutoFailover`.

### Фронтенд (React 18.3 / TS / Tailwind):
- `apps/frontend/src/types/index.ts` — типизация полей `auto_failover_enabled`, `failover_priority` и `FailoverRuntimeStatus`.
- `apps/frontend/src/api/client.ts` & `mockClient.ts` — метод `updateAdminNodeFailover`, поддержка переключения и мок-данных.
- `apps/frontend/src/components/ServerDetailPage.tsx` — тумблер `Auto-Failover: ВКЛ/ВЫКЛ`, статус-баннер Cooldown/сбоев, интерактивные стрелки изменения приоритетов `[↑]` / `[↓]`.

---

## 3. Чек-лист верификации

- [x] Поля `auto_failover_enabled` и `failover_priority` корректно мигрируются и сохраняются в SQLite.
- [x] HealthChecker игнорирует узлы с `auto_failover_enabled == false`.
- [x] При падении активного шлюза переключение срабатывает ровно после порога ошибок (2 цикла).
- [x] Во время Cooldown повторные переключения блокируются.
- [x] В аудит-лог пишется запись, а в Telegram уходит алерт с именами старого и нового шлюза.
- [x] Все тесты `go test -v -race ./...` проходят без гонок данных.
- [x] Сборка фронтенда `npm run build` проходит без ошибок TypeScript.
- [x] Автономный режим `dev:mock` поддерживает тумблер и смену приоритетов.
