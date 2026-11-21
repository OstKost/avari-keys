# TASK-062 — Страница конкретного сервера (Диагностика доступности и статусы)

## Статус: ✅ Done
**Ветка**: `feature/TASK-062-server-diagnostics-detail-page`

---

## 1. Цели и скоуп

Разработать отдельную полноэкранную страницу конкретного сервера (ноды кластера) с подробными результатами диагностики доступности, статусами сетевых проверок, управлением Egress-маршрутами, метриками телеметрии и сервисными действиями.

### Ключевые возможности:
1. **URL & Навигация**:
   - Поддержка канонического пути `/admin/nodes/:id` (и `/nodes/:id`) в HTML5 History API.
   - Сохранение выбранного сервера при перезагрузке страницы (F5) и навигация по истории браузера (`popstate`).
   - Хлебные крошки и быстрая кнопка возврата ко всем серверам (`/admin/nodes`).
2. **Результаты диагностики доступности (Availability Diagnostics)**:
   - Общий статус сервера (`ServerStatus`: state, checked_at, reason).
   - Агрегированный статус сети (`NetworkStatus`: state, checked_at, reason).
   - Задержка API в миллисекундах с цветовой шкалой качества связи.
   - Детальная таблица/карточки проверок зондов (M0 Ingress, S0 Egress):
     - Типы проверок: `DNS`, `ICMP Ping (IP)`, `ICMP Ping (Domain)`, `TCP Handshake`, `UDP AWG Probe`.
     - Целевой хост/IP, статус прохождения, задержка отклика, текст ошибки при сбое.
     - Кнопка немедленного запуска живой диагностики («Запустить проверку сейчас») с анимацией опроса.
3. **Статусы служб и протоколов**:
   - Статус службы AmneziaWG (AWG daemon, доступность, версия).
   - Статус протокола Hysteria 2 (QUIC / UDP 443).
   - Оптимизация под мобильные сети (443 LTE) и принадлежность к PRO/запасным узлам.
4. **Управление выходом каскада (для Cascade нод)**:
   - Отображение активного шлюза выхода (Active Egress).
   - Список доступных маршрутов (S1, S3, S4, S5P и др.) с проверкой доступности.
   - Быстрое переключение Egress шлюза прямо со страницы сервера.
5. **Телеметрия трафика и подключенные пиры**:
   - Общий трафик сервера (Rx / Tx / Всего).
   - Количество настроенных и активных устройств онлайн.
   - Таблица привязанных ключей с последним рукопожатием (handshake) и потреблением трафика.
6. **Быстрые действия над сервером**:
   - Перезапуск службы AWG.
   - Создание и выгрузка бэкапа конфигурации.
   - Восстановление конфигурации из файла/текста.
   - Редактирование параметров сервера (модальное окно).
   - Переход в панель VPS провайдера (Aeza, Hetzner, VDSina и др.).

---

## 2. Затронутые модули и файлы

### Бэкенд (Go 1.22+ Zero CGo):
- `apps/backend/internal/models/models.go` — структура `NodeDetailResponse`.
- `apps/backend/internal/storage/sqlite.go` — выборка клиентских ключей ноды `ListClientConfigsByNodeID`.
- `apps/backend/internal/monitor/healthchecker.go` — методы `GetNodeDetail` и `DiagnoseNode` (live probe & check).
- `apps/backend/internal/master/server.go` — эндпоинты `GET /api/v1/admin/nodes/{id}` и `POST /api/v1/admin/nodes/{id}/diagnose`.
- `apps/backend/internal/master/server_test.go` — контрактные и модульные тесты новых эндпоинтов.

### Фронтенд (React 18.3 / TS / Tailwind):
- `apps/frontend/src/types/index.ts` — DTO `NodeDetailResponse`.
- `apps/frontend/src/utils/route.ts` — поддержка `/admin/nodes/:id`, сохранение `nodeId` в состоянии и истории.
- `apps/frontend/src/api/client.ts` — методы `getAdminNode(id)` и `diagnoseAdminNode(id)`.
- `apps/frontend/src/api/mockClient.ts` — синхронная mock-реализация с симуляцией детальной диагностики.
- `apps/frontend/src/components/ServerDetailPage.tsx` — новый компонент страницы конкретного сервера.
- `apps/frontend/src/components/AdminNodes.tsx` — интеграция перехода на страницу сервера из списка.
- `apps/frontend/src/App.tsx` — роутинг и рендеринг страницы сервера.

---

## 3. Контракты API и структуры данных (DTO)

### `GET /api/v1/admin/nodes/{id}` & `POST /api/v1/admin/nodes/{id}/diagnose`
```json
{
  "id": 1,
  "name": "Каскад M0 (Москва) -> S1 (Амстердам)",
  "type": "cascade",
  "country_code": "NLD",
  "provider_url": "https://aeza.net",
  "api_url": "http://127.0.0.1:8081",
  "is_mobile_optimized": true,
  "is_backup": false,
  "has_hysteria": false,
  "is_active": true,
  "online": true,
  "latency_ms": 24,
  "server_status": {
    "state": "green",
    "checked_at": "2026-11-21T15:30:00Z",
    "reason": "Служба AWG активна, отклик 24 ms"
  },
  "network_status": {
    "state": "green",
    "checked_at": "2026-11-21T15:30:00Z",
    "reason": "Все контрольные точки M0/S0 доступны"
  },
  "network_probes": [
    {
      "node_id": 1,
      "source": "M0",
      "interface": "eth0",
      "state": "green",
      "checked_at": "2026-11-21T15:30:00Z",
      "checks": [
        { "kind": "dns", "target": "s1.vpn.test", "ok": true, "latency_ms": 5 },
        { "kind": "ip_icmp", "target": "192.0.2.20", "ok": true, "latency_ms": 24 },
        { "kind": "tcp", "target": "192.0.2.20:8081", "ok": true, "latency_ms": 25 },
        { "kind": "udp_awg", "target": "192.0.2.20:51820", "ok": true, "latency_ms": 24 }
      ]
    }
  ],
  "health": {
    "status": "ok",
    "service": "amneziawg-slave",
    "awg_available": true,
    "hysteria_available": false,
    "version": "1.2.1"
  },
  "stats": {
    "active_peers": 3,
    "uptime": "14 days, 6 hours",
    "total_rx": 15204352000,
    "total_tx": 24890124000
  },
  "egress": {
    "active_interface": "awg1",
    "available_interfaces": ["awg1", "awg3", "awg4", "awg5"],
    "targets": [
      { "interface": "awg1", "node": "S1", "label": "S1 Нидерланды", "endpoint": "192.0.2.20:51821", "available": true }
    ]
  },
  "client_keys": [
    {
      "id": 1,
      "client_name": "u1_iphone15",
      "device_name": "iPhone 15 Pro",
      "username": "Forve",
      "last_handshake": "2 минуты назад",
      "total_traffic_formatted": "1.42 GB"
    }
  ]
}
```

---

## 4. Чек-лист верификации

- [x] SQLite метод `ListClientConfigsByNodeID` корректно фильтрует конфигурации по `node_id`.
- [x] HealthChecker `GetNodeDetail` и `DiagnoseNode` собирают полные диагностические данные.
- [x] Роутинг `GET /api/v1/admin/nodes/{id}` и `POST /api/v1/admin/nodes/{id}/diagnose` защищены `RequireAdmin`.
- [x] Контрактные тесты бэкенда проходят без ошибок и гонок данных (`go test -v -race ./...`).
- [x] `mockClient.ts` полностью эмулирует `getAdminNode` и `diagnoseAdminNode` для автономного демо-режима (`npm run dev:mock`).
- [x] HTML5 History API корректно переходит на `/admin/nodes/:id`, сохраняет путь при F5, и возвращается по `popstate`.
- [x] UI страницы сервера выполнен в стилистике Cyber-Fantasy, адаптивен для мобильных устройств и планшетов.
- [x] Линтер бэкенда (`go vet`) и сборка фронтенда (`npm run build`) завершаются с кодом 0.
