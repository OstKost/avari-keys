# TASK-085: Автообновление и мониторинг релизов на нодах

## Цель и скоуп

Ноды раз в сутки (ночью) самостоятельно проверяют GitHub Releases на наличие новой версии `avari-slave`/`avari-master`. Режим поведения настраивается глобально через веб-приложение:

- `off` — не проверять (по умолчанию).
- `notify` — проверять; при наличии новой версии уведомить администратора (Telegram-алерт).
- `auto` — проверять; при наличии новой версии скачать бинарник из GitHub Release, заменить, перезапустить сервис.

Вне скоупа: выборочные версии (pin), откат, сигнатуры/checksum-верификация релизов (можно добавить позже), автообновление Master (только slave-ноды, Master обновляется вручную/через CI).

## Архитектурные решения

1. **Централизация версии**: вынести строку версии в единую константу (`internal/version/version.go`, `const Version = "v1.10.2"`), использовать в health-эндпоинтах Master/Slave и в сравнении релизов. `mockClient.ts` — паритет.
2. **Воркер на Slave** (`internal/update/`): фоновый ticker с запуском ночью (например, 03:00 по локальному времени узла + jitter), опрашивает `GET /repos/OstKost/avari-keys/releases/latest`, сравнивает `tag_name` со своей версией.
3. **Политика хранится на Master** (`app_settings.update_mode`), рассылается на ноды через Slave API (`POST /api/v1/update/mode`), персистится локально (state-файл по аналогии с firewall).
4. **Автоустановка (`auto`)**: скачать бинарник из asset'а релиза (amd64/arm64 по `GOARCH`), атомарно заменить `/usr/local/bin/avari-slave`, `systemctl restart avari-slave`. Только для slave; для master `auto` недоступен.
5. **Уведомление (`notify`)**: Slave сообщает Master (`POST /api/v1/update/notify`), Master шлёт Telegram-алерт администратору (через существующий бот).

## Модули

- **`internal/version`** (новый): единая константа версии.
- **`internal/update`** (новый): воркер проверки релизов, сравнение версий, загрузка asset'ов, атомарная установка; build-теги Linux/Darwin.
- **Storage**: `app_settings.update_mode` + методы чтения/записи.
- **Slave** (`server.go`, `main.go`): эндпоинты `GET/POST /api/v1/update/mode`, запуск воркера, state-файл.
- **Master** (`handlers_*`): admin-эндпоинт `GET/PUT /api/v1/admin/update-mode`, fan-out на ноды, обработка `notify` → Telegram.
- **Client** (`slave_client.go`): `SetUpdateMode`, `NotifyUpdate`.
- **Frontend**: тумблер off/notify/auto в админке; `client.ts` + `mockClient.ts` (паритет).
- **CI/CD**: уже публикует бинарники в GitHub Release (TASK-084 follow-up) — воркер использует их.

## Контракты

```go
type UpdateMode string
const (
    UpdateOff    UpdateMode = "off"
    UpdateNotify UpdateMode = "notify"
    UpdateAuto   UpdateMode = "auto"
)

type UpdateModeRequest struct {
    Mode UpdateMode `json:"mode"`
}

type UpdateCheckResponse struct {
    CurrentVersion string `json:"current_version"`
    LatestVersion  string `json:"latest_version,omitempty"`
    UpdateAvailable bool  `json:"update_available"`
    Mode           UpdateMode `json:"mode"`
}
```

Slave API: `GET/POST /api/v1/update/mode`, `POST /api/v1/update/notify`.
Master API (admin): `GET/PUT /api/v1/admin/update-mode`.

## Проверка

- [ ] Сравнение semver-тегов корректно (v1.10.2 > v1.10.1 > v1.9.0).
- [ ] `notify` шлёт Telegram-алерт при новой версии; `off` — молчит.
- [ ] `auto` скачивает asset по архитектуре и атомарно заменяет бинарник (тест с мок-загрузчиком).
- [ ] Режим персистится на ноде и переживает рестарт.
- [ ] Контракты API, admin-only, мок-паритет фронтенда.
- [ ] `go test -race`, `go vet`, Zero-CGO сборки, `npm run build`.
