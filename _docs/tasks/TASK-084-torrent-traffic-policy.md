# TASK-084: Политика фильтрации торрент-трафика (off / soft / strict)

## Цель и скоуп

Добавить глобальный переключатель политики фильтрации торрент-трафика на выходных нодах:

- `off` — трафик не фильтруется (текущее поведение, пассивный режим).
- `soft` — сетевая фильтрация без L7/DPI: порты BitTorrent + блокировка DHT/трекер-доменов через `ipset` с периодическим резолвом. Реализуется в текущем стеке без новых зависимостей.
- `strict` — резерв на будущее (L7/DPI, nDPI). В этой задаче только резервируется в enum/UI (задизейблен «скоро»), Slave возвращает «не реализовано».

Цель `soft` — устранить перерасход трафика на каскаде и убрать торрент с прямых нод **без** чтения payload и **без** нарушения инвариантов Zero CGo.

Вне скоупа: per-node/per-tariff/per-key override (политика глобальная), L7/DPI-детект (`strict`), блокировка по конкретным `info_hash`.

## Архитектурные решения

1. **Точка фильтрации каскада — M0 Ingress (единый choke point).** Весь каскадный трафик после дешифровки проходит FORWARD-цепочку M0 до входа во внутренний туннель `awg1/awg3`. Отбрасывание на M0 экономит внутренний трафик M0→S1/S4 и не зависит от активного egress/failover.
2. **Механизм node-agnostic.** Один и тот же `firewall`-компонент и slave-эндпоинт применяется на M0 (каскад) и на прямых нодах (S2/SBOX, Hysteria2/Mieru/VLESS). Правила протокол-агностичны (после дешифровки это обычный TCP/UDP): AWG — FORWARD, proxy-демоны — OUTPUT.
3. **Политика глобальная.** Один режим на все ноды разом. Egress S1/S4 включаются в рассылку опционально (если на них крутится `avari-slave`); иначе — вручную скриптом.
4. **Slave не читает БД Master.** Master хранит политику и домен-лист, рассылает их на ноды через `SlaveClient` (`X-API-Key`). Slave персистит последнее применённое состояние в локальный файл и переприменяет при старте; Master дополнительно синхронизирует при изменении и периодически (лечит дрифт/рестарты нод).

## Модули

- **Storage (`internal/storage/sqlite.go`)**: аддитивная миграция — таблица `torrent_blocklist` + сид дефолтного списка; ключи `app_settings`: `torrent_policy`, `torrent_policy_updated_at`. Методы CRUD блок-листа и чтения/записи политики.
- **Models (`internal/models/contracts.go`)**: DTO политики и блок-листа, константы режимов.
- **Firewall (`internal/firewall/` — новый)**: обёртка `iptables`/`ipset` через `CommandExecutor`, генерация правил `soft`, `clear`, резолв доменов → `ipset`. Изоляция Linux/Darwin build-тегами (на Darwin — no-op, в dev — mock).
- **Slave (`internal/slave/server.go`)**: эндпоинты `POST/GET /api/v1/firewall` и `POST /api/v1/firewall/blocklist` под `authMiddleware`; фоновый воркер-резолвер; локальный state-файл.
- **Master (`internal/master/`)**: admin-эндпоинты политики и блок-листа, fan-out по активным нодам, audit-log.
- **Client (`internal/client/slave_client.go`)**: `ApplyFirewall`, `ApplyBlocklist`, `GetFirewallStatus`.
- **Frontend (`api/client.ts`, `api/mockClient.ts`, `types/index.ts`, компоненты)**: переключатель off/soft/strict (strict — задизейблен) + редактор домен-листа; обязательный мок-паритет.
- **Deploy**: `deploy/systemd/avari-firewall.service` (или применение при старте slave), `scripts/apply_torrent_policy.sh` для ручного/отладочного применения.

## Контракты

### Режимы

```go
type TrafficPolicy string
const (
    PolicyOff    TrafficPolicy = "off"
    PolicySoft   TrafficPolicy = "soft"
    PolicyStrict TrafficPolicy = "strict" // зарезервирован, не реализован
)
```

### DTO

```go
type TrafficPolicyRequest struct {
    Mode TrafficPolicy `json:"mode"`
}

type TrafficPolicyResponse struct {
    Mode    TrafficPolicy `json:"mode"`
    Applied bool          `json:"applied"`
    Message string        `json:"message,omitempty"`
}

type FirewallStatusResponse struct {
    Mode           TrafficPolicy `json:"mode"`
    RulesCount     int           `json:"rules_count"`
    BlockedDomains []string      `json:"blocked_domains"`
    LastAppliedAt  string        `json:"last_applied_at,omitempty"`
}

type TorrentBlocklistEntry struct {
    ID        int64     `json:"id"`
    Domain    string    `json:"domain"`
    AddedBy   string    `json:"added_by"`
    CreatedAt time.Time `json:"created_at"`
}

type TorrentBlocklistRequest struct {
    Domain string `json:"domain"`
}

type TorrentBlocklistApplyRequest struct {
    Domains []string `json:"domains"`
}
```

### Slave API

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/v1/firewall` | `{"mode":"off\|soft\|strict"}` | `TrafficPolicyResponse` (strict → 501) |
| GET | `/api/v1/firewall` | — | `FirewallStatusResponse` |
| POST | `/api/v1/firewall/blocklist` | `{"domains":[...]}` | `TrafficPolicyResponse` |

Все под `X-API-Key`.

### Master API (admin)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/admin/traffic-policy` | текущая политика + блок-лист |
| PUT | `/api/v1/admin/traffic-policy` | сохранить `{"mode"}` + fan-out + audit |
| GET | `/api/v1/admin/torrent-blocklist` | список доменов |
| POST | `/api/v1/admin/torrent-blocklist` | добавить `{"domain"}` + re-fan-out |
| DELETE | `/api/v1/admin/torrent-blocklist/{id}` | удалить + re-fan-out |

### Состав правил `soft`

1. **Порты (TCP+UDP)** в цепочках FORWARD и OUTPUT: `6881-6889`, `6969`, `1337`, `2710`, `51413`.
2. **`ipset avari_torrent_trackers`** — домены блок-листа (публичные трекеры + DHT bootstrap-ноды), резолвятся в IP периодическим воркером (по умолчанию 15 мин) и на изменение листа.
3. `off` — снимает все правила и очищает ipset; `strict` — no-op (501).

### Дефолтный сид-лист

Публичные трекеры + DHT bootstrap: `openbittorrent.com`, `tracker.opentrackr.org`, `thetracker.org`, `tracker.leechers-paradise.org`, `router.bittorrent.com`, `router.utorrent.com`, `dht.transmissionbt.com`, `dht.libtorrent.org`. Список редактируемый, с «сбросить к дефолту».

## Проверка

- [x] Аддитивная миграция БД, совместимость со старыми Slave (новые эндпоинты — опциональны).
- [x] `soft` применяет правила и корректно снимает при `off` (идемпотентность, юнит-тесты с mock executor).
- [x] Резолв доменов → ipset, переживание рестарта slave (локальный state-файл + RestoreState), повторная рассылка Master при изменении.
- [x] `strict` возвращает 501 на Slave и 400 на Master, не трогает правила.
- [x] Контракты API, права доступа (admin-only), audit-log.
- [x] Мок-паритет `mockClient.ts`, `npm run dev:mock` работает.
- [x] `go test -v -race ./...`, `go vet ./...`, Zero-CGO сборки master+slave (linux amd64/arm64), `npm run build`.
- [ ] Ручная проверка на тестовой каскадной ноде: торрент не проходит при `soft`, проходит при `off`.

## Результаты проверки

Инструкция для оператора находится в [TRAFFIC-POLICY.md](../TRAFFIC-POLICY.md).
