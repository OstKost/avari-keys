# Безопасность, Rate Limiting и аутентификация

## 1. Фундаментальные инварианты безопасности

1. **Изоляция приватных ключей**:
   - Приватные ключи генерируются исключительно на соответствующей ноде через `manage_amneziawg.sh` при создании конфигурации.
   - Master Backend сохраняет в SQLite только метаданные (`client_name`, `public_key`, `node_id`, `user_id`, `created_at`).
   - **В БД Master категорически запрещено хранить клиентские приватные ключи**.
2. **Decoy-маскировка**:
   - Корневой эндпоинт Slave API `GET /` отдает нейтральную страницу-заглушку, не раскрывающую наличие VPN-демона перед сканерами портов (ZMap, Shodan).
   - Telegram-бот для неизвестных чатов работает в режиме Decoy (не раскрывает принадлежность к VPN-сервису).
3. **Защита от Timing Attacks**:
   - Сравнение API-ключа между Master и Slave производится через `subtle.ConstantTimeCompare([]byte(got), []byte(expected))`.
4. **Изоляция локальных хуков**:
   - HTTP-эндпоинт проверки паролей Hysteria2 на Slave жестко ограничен loopback-адресами (`127.0.0.1`, `::1`). Внешние запросы отсекаются с кодом 403 Forbidden.

---

## 2. In-Memory Rate Limiting (TASK-077)

Для защиты от брутфорса и исчерпания ресурсов разработан потокобезопасный скользящий Rate Limiter ([`apps/backend/internal/master/ratelimit.go`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/master/ratelimit.go)):

### Лимиты эндпоинтов:
- **Авторизация и регистрация** (`/api/v1/auth/register`, `/api/v1/auth/login`): **5 запросов в минуту**.
- **Запрос на сброс пароля** (`/api/v1/auth/reset-password`): **3 запроса в минуту**.
- **Авторизация Telegram Mini App** (`/api/v1/auth/telegram-miniapp`): **15 запросов в минуту**.

### Поведение при превышении:
Возвращается статус `HTTP 429 Too Many Requests` с заголовком `Retry-After: <секунды>` и понятным текстом ошибки на русском языке.

---

## 3. Защита от L7 DoS (Ограничение размера запросов)

- В цепочку middleware Master внедрен `maxBytesMiddleware(1<<20)`.
- Если размер тела запроса превышает **1 МБ**, поток чтения прерывается с ошибкой `http.MaxBytesError`, а клиент получает ответ `HTTP 413 Request Entity Too Large` вместо аварийного падения сервера из-за нехватки памяти (OOM).

---

## 4. Защитные HTTP-заголовки

Все HTTP-ответы Master Backend снабжаются строгими защитными заголовками:
```http
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; frame-ancestors 'self' https://web.telegram.org;
```
Политика CSP разрешает встраивание приложения во фрейм веб-клиента Telegram (`frame-ancestors https://web.telegram.org`) для работы Telegram Mini App.

---

## 5. Аутентификация, JWT и RBAC

### Структура сессий:
- Аутентификация построена на базе JWT (HMAC-SHA256).
- `Claims` содержат `user_id`, `username`, `role` (`user` или `admin`) и срок жизни токена.
- Контекст авторизованного пользователя извлекается в хэндлерах через `auth.GetUserFromContext(r.Context())`.

### Хэширование паролей:
- Пароли хранятся в базе исключительно в виде хэшей bcrypt (`golang.org/x/crypto/bcrypt`, `DefaultCost = 10`).

### Сброс паролей:
1. Пользователь отправляет запрос на сброс (`POST /api/v1/auth/reset-password`).
2. В таблице `password_reset_requests` создается запись со статусом `pending`.
3. Администратору в Telegram-бот и Mission Control приходит уведомление с кнопками «Одобрить» и «Отклонить».
4. Пароль активируется в базе только после явного подтверждения администратором.
