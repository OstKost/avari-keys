# TASK-082: Monthly Key & User Traffic Accounting & Stability Telemetry

## Цель и скоуп

Для повышения стабильности серверов (в первую очередь узлов Ingress M0 и зарубежных Egress-шлюзов) и соблюдения политики честного использования (Fair Use) реализовать точный поключевой и суммарный пользовательский учет трафика за текущий календарный месяц (YYYY-MM), устранить ошибку завышения месячных показателей в SQLite, добавить сводный виджет расхода трафика в клиентский кабинет/Telegram Mini App и инструмент контроля нагрузки в панель администратора.

## Модули и затронутые файлы

- **Backend (SQLite Storage & API)**:
  - `apps/backend/internal/storage/sqlite.go`:
    - Исправление логики `GetMonthTrafficMap`: если ключ не передавал трафик в текущем месяце (нет записей в `peer_traffic_daily`), отдавать `0`, а не исторический `TotalTrafficBytes`.
    - Метод `GetUserMonthTraffic(ctx, userID, yearMonth) (*models.UserMonthTraffic, error)` — подсчет суммарного RX/TX по всем ключам пользователя за календарный месяц.
    - Метод `GetUsersMonthTrafficMap(ctx, yearMonth) (map[int64]int64, error)` — массовое извлечение месячного трафика для списка пользователей в админке.
  - `apps/backend/internal/models/models.go`:
    - Структура `UserMonthTraffic` (`Month string`, `RxBytes int64`, `TxBytes int64`, `TotalBytes int64`, `Formatted string`, `RxFormatted string`, `TxFormatted string`).
    - Поле `UserMonthTraffic *UserMonthTraffic` в `models.UserPublic` / `models.UserWithKeys`.
    - Поле `MonthTrafficBytes int64` и `MonthTrafficFormatted string` в `models.UserPublic` для админ-списка пользователей.
  - `apps/backend/internal/master/server.go`:
    - В `handleMe` и `handleListUserKeys`: обогащение ответа суммарной статистикой пользователя за текущий календарный месяц.
    - В `handleAdminListUsers`: обогащение каждого пользователя данными о его суммарном месячном потреблении.
- **Frontend & Telegram Mini App**:
  - `apps/frontend/src/types/index.ts`: интерфейс `UserMonthTraffic` и обновление полей `User` и `AdminNode`/`AdminUser`.
  - `apps/frontend/src/api/client.ts` & `apps/frontend/src/api/mockClient.ts`: синхронная поддержка полей месячного трафика.
  - `apps/frontend/src/components/ClientKeysView.tsx`:
    - Сводная плашка/виджет активности: «Трафик за текущий месяц: **X.X GB**» с детализацией (скачано/отдано).
    - Корректное отображение `0 B` для неактивных в этом месяце ключей.
  - `apps/frontend/src/components/AdminUsers.tsx`:
    - Отображение суммарного месячного трафика пользователя в таблице/карточках.
    - Возможность сортировки пользователей по «Топ трафика за месяц» для выявления перегрузок.
    - Предупреждающий индикатор при потреблении >100 ГБ (Fair Use warning).
  - `apps/frontend/src/components/TelegramMiniApp.tsx`:
    - Компактный бейдж месячного трафика пользователя на главном экране.

## Контракты API

- `GET /api/v1/auth/me`:
  ```json
  {
    "user": {
      "id": 1,
      "username": "Forve",
      "month_traffic": {
        "month": "2026-11",
        "rx_bytes": 32212254720,
        "tx_bytes": 5368709120,
        "total_bytes": 37580963840,
        "formatted": "35.0 GB",
        "rx_formatted": "30.0 GB",
        "tx_formatted": "5.0 GB"
      }
    }
  }
  ```
- `GET /api/v1/admin/users`:
  Каждый объект пользователя включает `month_traffic_bytes: number` и `month_traffic_formatted: string`.

## Чек-лист верификации

- [x] Исправлен баг: ключ с нулевой активностью в текущем месяце возвращает `month_traffic_bytes: 0`.
- [x] Метод `GetUserMonthTraffic` корректно суммирует трафик всех ключей пользователя.
- [x] В `handleMe` и `handleAdminListUsers` возвращаются актуальные данные потребления.
- [x] Обновлены TypeScript типы и синхронизирован `mockClient.ts`.
- [x] Пользователь видит суммарный месячный трафик в личном кабинете и в Mini App.
- [x] В админке отображается колонка месячного трафика и работает сортировка.
- [x] `go test -v -race ./...` в `apps/backend` успешен.
- [x] `npm run build` в `apps/frontend` успешен.
- [x] Демо-режим `npm run dev:mock` полностью работоспособен.

## Результаты верификации

1. **Backend Unit & Contract Tests**:
   - `TestUserAndKeyMonthTrafficAccounting` в `apps/backend/internal/storage/sqlite_test.go` подтвердил:
     - Ключ с историческим трафиком, но 0 байт в текущем месяце возвращает `month_traffic_bytes == 0`.
     - Ключ с активным трафиком корректно учитывается в `MonthTrafficBytes`.
     - `GetUserMonthTraffic` агрегирует суммарный расход RX/TX по всем ключам пользователя за текущий календарный месяц.
     - `GetUsersMonthTrafficMap` и `ListUsers` обогащают список пользователей актуальными данными расхода.
   - `TestMeEndpointMonthTrafficAndAdminUserTraffic` в `apps/backend/internal/master/server_test.go` подтвердил:
     - `GET /api/v1/auth/me` возвращает объект `month_traffic` с детализацией (RX/TX/Total) и человекочитаемыми строками.
     - `GET /api/v1/admin/users` отдает `month_traffic_bytes` и `month_traffic_formatted` для админ-панели.
   - Полный прогон `go test -v -race ./...` успешно пройден без гонок памяти.

2. **Zero-CGo и кросс-компиляция**:
   - `make build-linux` успешно собрал статичные бинарники `avari-master` и `avari-slave` под `linux/amd64` и `linux/arm64`.

3. **Frontend & Mock Mode**:
   - `npm run build` завершился без ошибок TypeScript и сборки.
   - Сводный виджет месячного расхода в `ClientKeysView.tsx` отображает календарный месяц, общий расход и детализацию.
   - В `AdminUsers.tsx` добавлена колонка «Трафик/мес», сортировка по «Топ трафика» и индикатор `Heavy` (>100 GB) для предотвращения перегрузки серверов.
   - В Telegram Mini App добавлена карточка «За месяц».
   - Данные синхронизированы в `apps/frontend/src/api/mockClient.ts`.
