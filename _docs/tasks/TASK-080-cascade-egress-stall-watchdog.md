# TASK-080: Cascade Egress Stall Watchdog & One-Click Recovery

## 1. Цели и скоуп
- **Проблема**: При скрытных блокировках или сетевых аномалиях туннели WireGuard/AWG Egress на ноде M0 могут войти в состояние «зависания» (Silent Blackout / Frozen Session: исходящие пакеты уходят в туннель $TX > 50\text{ KB}$, но входящих нет $RX == 0$, либо возраст последнего рукопожатия $> 180\text{ с}$). В текущей версии система только фиксирует флаг `isFrozen: true` и шлет алерт в Telegram с рекомендацией вручную зайти по SSH и выполнить `systemctl restart awg-quick@...`.
- **Цель**:
  1. Реализовать программный перезапуск туннеля Egress:
     - `Manager.RestartInterface(ctx, iface)` в `internal/egress`.
     - Метод `RestartEgress(ctx, iface)` в интерфейсе `Runner` (`real_runner.go` и `mock_runner.go`).
  2. Добавить API эндпоинт в Slave:
     - `POST /api/v1/cascade/egress/restart` (`{"interface": "awg1"}`).
  3. Добавить клиентский метод в `client.SlaveClient`:
     - `RestartCascadeEgress(ctx, iface)`.
  4. Добавить админский эндпоинт в Master:
     - `POST /api/v1/admin/nodes/{id}/egress/restart`.
  5. Интегрировать Watchdog в `HealthChecker`:
     - Если активный egress-шлюз каскада завис (`activeTarget.IsFrozen`), watchdog выполняет попытку автоматического восстановления (перезапуск туннеля), а при сохранении зависания инициирует немедленный Auto-Failover.
  6. Добавить UI-действие в веб-панель:
     - Кнопка «Перезапустить туннель» на странице диагностики каскада (`ServerDetailPage.tsx`) и в карточке узла (`AdminNodes.tsx`), а также синхронизировать `client.ts` и `mockClient.ts`.

## 2. Затронутые модули и файлы
- `apps/backend/internal/egress/manager.go`
- `apps/backend/internal/egress/egress_test.go`
- `apps/backend/internal/runner/runner.go`
- `apps/backend/internal/runner/real_runner.go`
- `apps/backend/internal/runner/mock_runner.go`
- `apps/backend/internal/slave/server.go`
- `apps/backend/internal/slave/server_test.go`
- `apps/backend/internal/client/slave.go`
- `apps/backend/internal/master/server.go`
- `apps/backend/internal/master/server_test.go`
- `apps/backend/internal/monitor/healthchecker.go`
- `apps/frontend/src/api/client.ts`
- `apps/frontend/src/api/mockClient.ts`
- `apps/frontend/src/components/ServerDetailPage.tsx`
- `_docs/TASKS.md`

## 3. Чек-лист верификации
- [x] Модульные тесты `RestartInterface` в `egress_test.go`.
- [x] Контрактные тесты Slave эндпоинта `POST /api/v1/cascade/egress/restart` в `slave/server_test.go`.
- [x] Тесты Master эндпоинта `POST /api/v1/admin/nodes/{id}/egress/restart` в `master/server_test.go`.
- [x] Тест Watchdog в `healthchecker_test.go`.
- [x] Сборка Linux Zero-CGo (`make build-linux`).
- [x] Синхронизация `mockClient.ts` и `npm run build`.
