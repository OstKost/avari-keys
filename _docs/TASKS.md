# TASKS.md — Kanban Board (Avari Keys MVP)

## 📋 Kanban Board

| 📥 Backlog | 📝 To Do | ⚙️ In Progress | 🔍 In Review / Testing | ✅ Done |
|---|---|---|---|---|
| | | | | [TASK-001](./tasks/TASK-001-project-scaffolding.md) |
| | | | | [TASK-002](./tasks/TASK-002-slave-api-core.md) |
| | | | | [TASK-003](./tasks/TASK-003-master-backend-auth-db.md) |
| | | | | [TASK-004](./tasks/TASK-004-master-backend-node-client-manager.md) |
| | | | | [TASK-005](./tasks/TASK-005-master-frontend-ui.md) |
| | | | | [TASK-006](./tasks/TASK-006-contract-integration-tests.md) |
| | | | | [TASK-007](./tasks/TASK-007-deployment-and-docs.md) |
| | | | | [TASK-008](./tasks/TASK-008-cicd-github-actions.md) |
| | | | | [TASK-009](./tasks/TASK-009-billing-system.md) |
| | | | | [TASK-010](./tasks/TASK-010-mascot-assistant.md) |
| | | | | [TASK-018](./tasks/TASK-018-mobile-tablet-responsive.md) |
| | | | | [TASK-019](./tasks/TASK-019-stats-tg-billing-settings-fixes.md) |
| | | | | [TASK-020](./tasks/TASK-020-telegram-user-banner-and-linking.md) |
| | | | | [TASK-021](./tasks/TASK-021-secure-telegram-linking-and-decoy.md) |
| | | | | [TASK-022](./tasks/TASK-022-stats-telemetry-redesign.md) |
| | | | | [TASK-023](./tasks/TASK-023-telegram-user-approval-inline-buttons.md) |
| | | | | [TASK-024](./tasks/TASK-024-healthcheck-resilience-and-lightweight-probe.md) |
| | | | | [TASK-026](./tasks/TASK-026-onboarding-tour-layout-fix.md) |
| | | | | [TASK-025](./tasks/TASK-025-cicd-server-migration.md) |
| | | | | [TASK-027](./tasks/TASK-027-news-and-announcements-system.md) |
| | | | | [TASK-028](./tasks/TASK-028-backup-servers-and-pro-tier.md) |
| | | | | [TASK-058](./tasks/TASK-058-s5p-premium-dashboard.md) |
| | | | | [TASK-059](./tasks/TASK-059-route-preservation-and-chibi-mascot.md) |

---

## 📌 Список задач с кратким статусом

- **[TASK-001](./tasks/TASK-001-project-scaffolding.md)**: ✅ Базовый каркас проекта, Go-модули, Makefile, Frontend React/Vite scaffold.
- **[TASK-002](./tasks/TASK-002-slave-api-core.md)**: ✅ Slave API демон с оберткой над `manage_amneziawg.sh`, токен-авторизацией и Decoy страницей.
- **[TASK-003](./tasks/TASK-003-master-backend-auth-db.md)**: ✅ Master Backend — SQLite хранилище, регистрация, модерация админом `Forve`, JWT сессии.
- **[TASK-004](./tasks/TASK-004-master-backend-node-client-manager.md)**: ✅ Управление нодами (Cascade M0/S1 & Direct S2), Slave HTTP-клиент, создание и отзыв ключей.
- **[TASK-005](./tasks/TASK-005-master-frontend-ui.md)**: ✅ React Web UI — Дашборд пользователя (QR, .conf, выбор ноды) и Админ-панель (пользователи, ноды, аудит).
- **[TASK-006](./tasks/TASK-006-contract-integration-tests.md)**: ✅ Контрактные тесты Master $\leftrightarrow$ Slave API, тесты модерации и прав доступа.
- **[TASK-007](./tasks/TASK-007-deployment-and-docs.md)**: ✅ Документация развертывания, Caddy auto-HTTPS конфиги, systemd unit-файлы.
- **[TASK-008](./tasks/TASK-008-cicd-github-actions.md)**: ✅ Безопасный CI/CD пайплайн в GitHub Actions с атомарным деплоем на VPS 192.0.2.20.
- **[TASK-009](./tasks/TASK-009-billing-system.md)**: ✅ Кооперативные взносы (каждые 30 дней) и страница «Биллинг».
- **[TASK-010](./tasks/TASK-010-mascot-assistant.md)**: ✅ Интерактивный UI-помощник (Маскот), онбординг первого ключа и база знаний FAQ.
- **[TASK-018](./tasks/TASK-018-mobile-tablet-responsive.md)**: ✅ Адаптация интерфейса под мобильные устройства (320px–640px) и планшеты (640px–1024px).
- **[TASK-019](./tasks/TASK-019-stats-tg-billing-settings-fixes.md)**: ✅ Метрики трафика через Curve25519 деривацию, Telegram бот фиксы и напоминания, расчет взносов, страница Настройки.
- **[TASK-020](./tasks/TASK-020-telegram-user-banner-and-linking.md)**: ✅ Баннер-приглашение в Telegram-бота над ключами, персональная привязка deep link и оповещения.
- **[TASK-021](./tasks/TASK-021-secure-telegram-linking-and-decoy.md)**: ✅ Безопасная привязка Telegram-бота по токену и Decoy-заглушка для неизвестных пользователей.
- **[TASK-022](./tasks/TASK-022-stats-telemetry-redesign.md)**: ✅ Полный редизайн сбора статистики и телеметрии AmneziaWG (PublicKey, Delta Engine, SQLite, Worker).
- **[TASK-023](./tasks/TASK-023-telegram-user-approval-inline-buttons.md)**: ✅ Модерация и одобрение новых пользователей через Inline-кнопки в Telegram-боте.
- **[TASK-024](./tasks/TASK-024-healthcheck-resilience-and-lightweight-probe.md)**: ✅ Устойчивость HealthChecker к сетевым задержкам и легковесный опрос Slave API.
- **[TASK-025](./tasks/TASK-025-cicd-server-migration.md)**: ✅ Перенастройка CI/CD пайплайна на VPS 192.0.2.10 (keys.example.net / OpenResty Manager).
- **[TASK-026](./tasks/TASK-026-onboarding-tour-layout-fix.md)**: ⚙️ Исправление разметки и мобильной адаптивности окна обучения (OnboardingTour).
- **[TASK-027](./tasks/TASK-027-news-and-announcements-system.md)**: ✅ Страница «Новости» с публикацией, категориями, рассылкой в Telegram-бота и баннером.
- **[TASK-028](./tasks/TASK-028-backup-servers-and-pro-tier.md)**: ⚙️ Запасные серверы (`is_backup`), тариф PRO (`is_pro`), разграничение доступа к ключам и формула взноса 300+50 ₽.
- **[TASK-053](./tasks/TASK-053-password-reset-flow.md)**: ✅ Функционал запроса сброса пароля и модерации администратором через Telegram-бота и веб-панель.







- **TASK-055**: ✅ Independent public network/server monitoring, S4 onboarding, persistent cascade selection, private runtime inventory and v0.9.0 release.

- **TASK-057**: ✅ v1.0.0: current cascade labels, switch feedback, expandable server diagnostics and portal modal animations.

- **[TASK-058](./tasks/TASK-058-s5p-premium-dashboard.md)**: ✅ S5P PRO-only direct/cascade ingress, isolated telemetry and current dashboard egress.
- **[TASK-059](./tasks/TASK-059-route-preservation-and-chibi-mascot.md)**: ✅ HTML5 History API навигация и сохранение роутов/вкладок при перезагрузке, милый чиби-маскот Ари.
