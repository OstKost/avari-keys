# TASK-066: Нативный Go-контроллер Egress каскада, мультипроверка (IP, Telegram, ChatGPT) и интервал HealthCheck 3 мин

## Статус: ✅ Done
**Ветка**: `feature/TASK-066-go-native-cascade-egress`

---

## 1. Цели и скоуп

1. **Интервал HealthCheck 3 минуты**:
   - Увеличить дефолтный интервал проверки доступности серверов и каскада `HEALTHCHECK_INTERVAL_SEC` с 60 секунд (1 мин) до 180 секунд (3 мин) в демоне Master (`cmd/master/main.go` и `internal/monitor/healthchecker.go`).
   - Сохранить возможность переопределения через переменную окружения `HEALTHCHECK_INTERVAL_SEC`.

2. **Замена `avari-egress.py` на нативный Go-код**:
   - Реализовать пакет `apps/backend/internal/egress`, инкапсулирующий всю логику управления Egress-выходами каскада (таблица маршрутизации 100, Telegram CIDR подсети, iptables NAT Masquerade, атомарные транзакции, откат при сбоях и CLI-интерфейс).
   - Интегрировать Go-модуль напрямую в `RealRunner` (`internal/runner/real_runner.go`), устранив зависимость от Python и внешних скриптов во время работы Slave API.
   - Поддержать CLI-подкоманды в `cmd/slave/main.go` (`avari-slave status`, `avari-slave switch <iface>`, `avari-slave recover`), чтобы бинарник `avari-slave` мог использоваться системным сервисом `awg-routing.service` (`ExecStartPre`) и администраторами в консоли.

3. **Расширенная мультипроверка Egress-выходов**:
   - Вместо проверки только `https://api.ipify.org`, зонд проверяет 3 критических сервиса для каждого направления:
     1. **`https://api.ipify.org`** (или `https://api4.ipify.org`): проверка исходящей IPv4-связности и строгое соответствие внешнего IP адресу эндпоинта зарубежного узла.
     2. **Telegram (`https://api.telegram.org`)**: проверка доступности инфраструктуры Telegram (которая маршрутизируется напрямую через каскадный Egress).
     3. **ChatGPT (`https://chatgpt.com`)**: проверка доступности OpenAI/Cloudflare (отсутствие блокировок 403 Forbidden / Cloudflare challenge, запрещающих доступ пользователям VPN).
   - Направление считается доступным (`available: true`) только при успешном прохождении всех трех проверок. При сбое любой из них в `reason` фиксируется точная причина (например: `chatgpt заблокирован (HTTP 403)` или `telegram недоступен: timeout`).

---

## 2. Затронутые модули и файлы

- `apps/backend/cmd/master/main.go` — дефолт `intervalSec = 180`.
- `apps/backend/internal/monitor/healthchecker.go` — дефолт `interval = 180 * time.Second`.
- `apps/backend/internal/egress/` (новый пакет):
  - `config.go` — чтение реестра `/etc/avari-keys/egress.json`, валидация интерфейсов и IP.
  - `routes.go` — чтение активного маршрута таблицы 100, управление маршрутами Telegram подсетей, iptables NAT.
  - `probe.go` — многопоточная проверка каналов (IP match, Telegram HTTP status, ChatGPT HTTP status).
  - `manager.go` — транзакционное переключение (`Switch`), откат (`Recover`), статус (`GetStatus`), блокировка (`flock`).
  - `egress_test.go` — модульные тесты для всех сценариев (успех, сбой IP, сбой Telegram, бан ChatGPT 403, откат транзакций, параллельные вызовы).
- `apps/backend/internal/runner/real_runner.go` — вызов нативного Go `egress.Manager` вместо Python-хелпера.
- `apps/backend/cmd/slave/main.go` — CLI-обработчик аргументов (`status`, `switch`, `recover`).
- `scripts/install_egress.sh` — обновление скрипта развертывания под бинарник `avari-slave`.
- `_docs/TASKS.md` — обновление статуса в канбан-доске.

---

## 3. Чек-лист верификации

- [x] `go test -v -race ./...` проходит без ошибок и гонок данных.
- [x] Тесты `egress` покрывают проверку `ipify`, `telegram`, `chatgpt` (включая сценарии ошибок 403/timeout).
- [x] Дефолтный интервал в `cmd/master` и `healthchecker` равен 180 секундам.
- [x] `cmd/slave` корректно обрабатывает CLI аргументы (`status`, `switch`, `recover`).
- [x] Кросс-компиляция `make build-linux` (`CGO_ENABLED=0`, amd64 и arm64) и `make lint` проходят успешно.
