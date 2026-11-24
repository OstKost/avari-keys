# TASK-081: Внедрение структурированного логирования log/slog и фонового воркера ротации логов и телеметрии

## 1. Контекст и цели
- В проекте на Master и Slave использовался стандартный пакет `log.Printf`, выводящий неструктурированный текст в stdout/stderr. При развертывании в production через systemd и сборе логов в journald/promtail/loki это затрудняет парсинг и фильтрацию инцидентов.
- Таблицы `audit_logs`, `peer_traffic_daily`, `node_traffic_daily`, `password_reset_requests` и `telegram_link_tokens` в SQLite со временем непрерывно растут, занимая место на диске VPS и замедляя выборки.
- Требуется внедрить:
  1. Стандартный структурированный логгер Go 1.22+ (`log/slog`) с поддержкой JSON-формата (в проде) и текстового формата (в dev), с фильтрацией уровня логирования (`DEBUG`, `INFO`, `WARN`, `ERROR`).
  2. Фоновый воркер ротации и очистки устаревших данных (`RetentionWorker`), запускаемый раз в 24 часа (и при старте сервиса) для автоматической очистки устаревших аудит-логов (по умолчанию 30 дней), старой посуточной телеметрии (по умолчанию 90 дней) и просроченных токенов.

## 2. Скоуп работ
1. **Пакет `internal/logger`**:
   - Инициализация глобального `slog.Logger` с атрибутами сервиса (`service`, `version`).
   - Поддержка форматов `json` и `text` (через переменную окружения `LOG_FORMAT`, по умолчанию `text` если tty/dev, иначе `json`).
   - Настройка уровня логирования через `LOG_LEVEL` (`debug`, `info`, `warn`, `error`).
   - Перенаправление стандартного `log.SetOutput` на `slog.NewLogLogger`.
2. **Методы очистки в `internal/storage/sqlite.go`**:
   - `PurgeAuditLogsOlderThan(ctx, days int) (int64, error)`
   - `PurgeTelemetryOlderThan(ctx, days int) (int64, error)`
   - `PurgeExpiredResetRequests(ctx, days int) (int64, error)`
   - `PurgeExpiredTelegramTokens(ctx) (int64, error)`
   - `RunRetention(ctx, auditDays, telemetryDays int) (RetentionStats, error)`
3. **Фоновый воркер `internal/retention`**:
   - `Worker` с таймером (интервал 24h, конфигурируемый) и немедленным запуском после старта.
   - Graceful shutdown через `context.Context` / `Stop()`.
   - Интеграция в `Server.StartBackgroundWorkers` и `Server.StopBackgroundWorkers`.
4. **Обновление `cmd/master/main.go` и `cmd/slave/main.go`**:
   - Инициализация `logger.Init("avari-master")` и `logger.Init("avari-slave")`.
   - Замена ключевых `log.Printf` на структурированные `slog.Info`, `slog.Warn`, `slog.Error`.
5. **Тестирование**:
   - Модульные тесты `storage_retention_test.go` и `retention_worker_test.go`.
   - Проверка `go test -race ./...`, `make lint`, `make build-linux`.
