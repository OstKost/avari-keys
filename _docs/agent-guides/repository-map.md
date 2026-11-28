## 4. Карта репозитория

```text
avari-keys-mvp/
├── .agents/                    # Локальные скиллы по ролям
│   └── skills/
│       ├── orchestrator/       # Скилл оркестратора (планирование, Gitflow, релизы)
│       ├── developer/          # Скилл разработчика (Go, React, mockClient, тесты)
│       └── qa-tester/          # Скилл тестировщика (go test, vet, build-linux)
├── apps/
│   ├── backend/                # Go 1.22+ backend (Zero CGo, CGO_ENABLED=0)
│   │   ├── cmd/
│   │   │   ├── master/         # Master API Gateway & Web Server (main.go)
│   │   │   └── slave/          # Slave Node Agent над manage_amneziawg.sh (main.go)
│   │   └── internal/
│   │       ├── auth/           # JWT, хэширование паролей bcrypt, контекст пользователя
│   │       ├── client/         # Master -> Slave HTTP API Client
│   │       ├── egress/         # Управление Egress-шлюзами каскада, кворум 5 целей
│   │       ├── hysteria/       # Хранилище и валидация Hysteria2 нод
│   │       ├── logger/         # log/slog структурированное логирование (JSON/Text)
│   │       ├── master/         # Декомпозированные доменные обработчики:
│   │       │   ├── server.go             # Config, Server struct, роутинг, middleware
│   │       │   ├── handlers_auth.go      # Авторизация, профиль, сброс пароля, TMA
│   │       │   ├── handlers_keys.go      # CRUD клиентских ключей, транслитерация
│   │       │   ├── handlers_nodes.go     # Управление нодами, диагностика, Egress
│   │       │   ├── handlers_admin.go     # Модерация пользователей, аудит-логи, TG
│   │       │   ├── handlers_billing.go   # Биллинг, реквизиты, дашборд
│   │       │   ├── handlers_news.go      # Новости и рассылка
│   │       │   └── ratelimit.go          # In-memory sliding-window IPRateLimiter
│   │       ├── mieru/          # Интеграция протокола Mieru (TCP-прокси, JSON, QR)
│   │       ├── models/         # DTO контракты и структуры данных
│   │       ├── monitor/        # HealthChecker доступности нод и телеметрия
│   │       ├── netprobe/       # Легковесные сетевые зонды с изоляцией Linux/Darwin
│   │       ├── retention/      # Периодическая ротация логов и телеметрии (24h)
│   │       ├── runner/         # Интерфейс вызова CLI AWG (Real + Mock runner)
│   │       ├── slave/          # Обработчики эндпоинтов Slave API (Decoy, ConstantTime)
│   │       ├── storage/        # Чистый Go SQLite (миграции, пользователи, ключи, аудит)
│   │       ├── telegram/       # Бот: алерты, инлайн-модерация, сброс паролей
│   │       └── vless/          # Контроллер и конфигурации VLESS Reality
│   └── frontend/               # React 18.3 SPA (Vite + Code-Splitting)
│       └── src/
│           ├── api/            # client.ts (боевой) и mockClient.ts (демо-режим dev:mock)
│           ├── components/     # UI-компоненты (Cyber-Fantasy стилистика, маскот Ари)
│           ├── context/        # ToastContext и глобальные состояния
│           ├── types/          # TypeScript интерфейсы
│           └── utils/          # route.ts, country.ts, faqData.ts
├── deploy/                     # Конфигурации развертывания (OpenResty, Caddy, Systemd, AWG)
├── scripts/                    # Автоматизация (deploy_slave_nodes.sh и др.)
├── _docs/                      # Документация, архитектура, задачи и релизы
│   ├── architecture/           # 📚 Модульные архитектурные справочники (INDEX.md и др.)
│   ├── tasks/                  # Отдельные спецификации задач (TASK-XXX-*.md)
│   ├── ARCHITECTURE.md         # Сетевая топология и физический реестр нод
│   ├── TASKS.md                # Канбан-доска проекта
│   └── RELEASE-vX.Y.Z.md       # Журналы версий и релизов
├── Makefile                    # Сборка, линтинг, тесты и локальный dev-запуск
└── AGENTS.md                   # Главный регламент для AI-агентов
```

---
