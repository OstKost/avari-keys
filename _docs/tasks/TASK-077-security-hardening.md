# TASK-077: Comprehensive Security Hardening

## Цель и скоуп

Устранить критические уязвимости безопасности, выявленные в ходе архитектурного аудита: внедрить in-memory Rate Limiter для защиты от брутфорса и спама auth-эндпоинтов, ограничить размер входящих HTTP-тел (`MaxBytesReader`), устранить предсказуемый дефолтный `JWT_SECRET`, перевести сравнение API-ключей Slave на константное время (`subtle.ConstantTimeCompare`), ограничить доступ к эндпоинту Hysteria Auth локальным интерфейсом (loopback) и добавить базовые Security Headers.

## Модули и затронутые файлы

- `apps/backend/internal/auth/jwt.go`:
  - Генерация криптографически стойкого эфемерного ключа в dev-режиме при отсутствии `JWT_SECRET`.
  - Запрет запуска с дефолтным секретом в production (`APP_ENV=production`).
- `apps/backend/internal/master/ratelimit.go` (новый):
  - Потокобезопасный in-memory Rate Limiter по IP (Sliding Window / Token Bucket) с автоматической очисткой устаревших записей (TTL).
  - Защита эндпоинтов `/api/v1/auth/login` (5/мин), `/api/v1/auth/register` (5/мин), `/api/v1/auth/reset-password` (3/мин), `/api/v1/auth/telegram-miniapp` (10/мин).
  - Ответ HTTP 429 Too Many Requests с заголовком `Retry-After`.
- `apps/backend/internal/master/server.go`:
  - Middleware ограничения размера тела запроса (`http.MaxBytesReader` 1 МБ).
  - Security Headers Middleware (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP с `frame-ancestors 'self' https://web.telegram.org`).
- `apps/backend/internal/slave/server.go`:
  - Замена строкового сравнения API-ключа на `crypto/subtle.ConstantTimeCompare`.
  - Ограничение вызова `/api/v1/hysteria/auth` только loopback-адресами (`127.0.0.1` / `::1`).

## Контракты

- При превышении лимита попыток: HTTP 429, заголовок `Retry-After: 60`, тело:
  ```json
  {"error": "Слишком много запросов. Пожалуйста, повторите попытку через минуту."}
  ```
- При превышении лимита размера тела (>1 МБ): HTTP 413 Payload Too Large.
- При обращении к `/api/v1/hysteria/auth` не с localhost: HTTP 403 Forbidden.

## Чек-лист верификации

- [ ] Rate limiter блокирует 6-ю попытку входа с одного IP в течение минуты (HTTP 429).
- [ ] Запрос с телом более 1 МБ отклоняется с HTTP 413.
- [ ] Slave API проверяет API-ключ за константное время.
- [ ] Внешний запрос к `/api/v1/hysteria/auth` отклоняется (403 Forbidden).
- [ ] Security Headers присутствуют во всех ответах Master API.
- [ ] При `APP_ENV=production` и пустом `JWT_SECRET` сервис безопасно останавливается с ошибкой.
- [ ] Все тесты `go test -race ./...` проходят успешно.
