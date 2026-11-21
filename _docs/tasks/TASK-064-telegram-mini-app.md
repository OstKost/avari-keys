# TASK-064 — Telegram Mini App (TMA) для пользователей и администраторов

## Статус: ✅ Done
**Ветка**: `feature/TASK-064-telegram-mini-app`

---

## 1. Цели и скоуп

Реализовать встроенное веб-приложение **Telegram Mini App (TMA)** для Telegram-бота Avari Keys с разделением функционала по ролям и строгой криптографической аутентификацией.

### Ключевые требования:
1. **Безопасность и контроль доступа**:
   - Доступ только для пользователей и администраторов, чей Telegram-чат привязан к системе (`telegram_chats.user_id IS NOT NULL` или `is_admin == 1`).
   - Аутентификация через Telegram WebApp `initData` с проверкой HMAC-SHA256 подписи токеном бота на стороне Go Master Backend.
   - Для непривязанных Telegram-аккаунтов — экран-заглушка в стиле Decoy с предложением привязать аккаунт через команду `/link`.
2. **Интерфейс обычного пользователя (User TMA)**:
   - **Статус**: состояние учетной записи (активен, тариф Standard/PRO), статус подключения к боту, индикатор здоровья VPN-сети, счетчик использованного трафика (Rx/Tx).
   - **Ключ**: карточка активного ключа (страна, протокол AmneziaWG / Hysteria2), крупный **QR-код** для быстрого сканирования/импорта, копирование AWG-конфига в 1 клик, скачивание `.conf`, быстрое создание ключа.
   - **Биллинг**: статус членского взноса (оплачен / требуется), сумма, реквизиты СБП с кнопкой копирования, кнопка «✅ Оплатил взнос» с отправкой уведомления администратору.
3. **Интерфейс администратора (Admin TMA)**:
   - **Сводка кластера**: количество серверов Online/Degraded/Offline, число пользователей и ключей, активный Egress каскада.
   - **Статусы серверов**: список всех нод (M0, S1, S2, S3, S4, SBOX и др.) с живым пингом (RTT мс), потерями пакетов, активными пирами и флагами роли.
   - **Управление серверами**:
     - Быстрое переключение Egress-шлюза каскада в 1 клик (S1 / S4 / S3 / S5P).
     - Тумблер отключаемого Auto-Failover.
     - Принудительный запуск проверки доступности / Ping всех серверов.
     - Быстрый перезапуск служб AWG/Slave на ноде.
   - Доступ к вкладкам «Мой ключ» и «Биллинг».
4. **Интеграция в Telegram-бота**:
   - Поддержка команды `/app`.
   - Кнопка WebApp в `/start` и `/status`.
   - Поддержка меню-кнопки бота (`setChatMenuButton`).
5. **UX и тактильный отклик**:
   - Адаптация под темную тему Cyber-Fantasy и Telegram WebApp Theme.
   - Использование `Telegram.WebApp.HapticFeedback` для тактильного отклика при кликах, копировании и переключениях.
6. **Автономность и Mock-режим (Invariant 5)**:
   - Полная эмуляция Telegram WebApp окружения в `mockClient.ts` и `dev:mock` с переключателем ролей (User / Admin / Unlinked).

---

## 2. Затронутые модули и файлы

### Бэкенд (Go 1.22+ Zero CGo):
- `apps/backend/internal/models/models.go` — DTO для запроса авторизации TMA (`TelegramMiniAppAuthRequest`, `TelegramMiniAppAuthResponse`).
- `apps/backend/internal/auth/telegram_webapp.go` — модуль криптографической валидации Telegram WebApp `initData` (HMAC-SHA256, проверка даты, парсинг user JSON).
- `apps/backend/internal/master/server.go` — эндпоинт `POST /api/v1/auth/telegram-miniapp`.
- `apps/backend/internal/telegram/bot.go` — отправка WebApp кнопок и обработка `/app`.
- `apps/backend/internal/master/server_test.go` — тесты валидации `initData` и авторизации.

### Фронтенд (React 18.3 / TS / Tailwind):
- `apps/frontend/src/types/index.ts` — типизация TMA контрактов и WebApp API.
- `apps/frontend/src/utils/telegram.ts` — хелпер работы с `window.Telegram.WebApp` и HapticFeedback.
- `apps/frontend/src/utils/route.ts` — добавление маршрута `/miniapp`.
- `apps/frontend/src/components/TelegramMiniApp.tsx` — компонент Telegram Mini App (пользовательский и админский режимы).
- `apps/frontend/src/api/client.ts` & `mockClient.ts` — метод `authenticateTelegramMiniApp`.
- `apps/frontend/src/App.tsx` — подключение роута `/miniapp`.

---

## 3. Чек-лист верификации

- [x] HMAC-SHA256 валидация `initData` корректно проверяет подлинность данных Telegram.
- [x] Непривязанные Telegram-аккаунты получают 403 и экран Decoy с подсказкой привязать аккаунт.
- [x] Пользовательский режим корректно отображает статус, QR-код, конфиг ключа, скачивание .conf и статус взноса СБП.
- [x] Поддерживается создание новых ключей прямо из Mini App с выбором локации и протокола.
- [x] Администратор видит карточки всех серверов с живым пингом и может мгновенно переключать Egress-выход каскада.
- [x] Кнопка WebApp работает в Telegram-боте (`/start`, `/app`).
- [x] В `npm run dev:mock` доступен симулятор TMA с выбором ролей (User / Admin / Unlinked).
- [x] Тесты `make test` и проверка статической компиляции `make build-linux` проходят успешно.
- [x] Сборка фронтенда `npm run build` завершается без ошибок.
