# TASK-083: Модульная архитектурная документация и навигатор подсистем для AI-агентов

## 1. Цели и скоуп
- **Проблема**: В результате масштабных доработок и рефакторингов кодовая база значительно выросла. AI-агенты (Codex, Antigravity), приступая к решению точечных задач, тратят контекстное окно на чтение больших файлов или сканирование дерева каталогов.
- **Решение**:
  1. Создать каталог модульной документации `_docs/architecture/` с компактными (100–250 строк), высокоинформативными руководствами по каждой подсистеме.
  2. Добавить в `AGENTS.md` быстрый навигатор подсистем (Subsystem Quick Index) с прямыми ссылками на документы и ключевые файлы.
  3. Обновить дерево каталогов в `AGENTS.md` и обновить `.agents/skills/developer/SKILL.md` и `.agents/skills/orchestrator/SKILL.md`.

## 2. Затронутые модули и файлы
- `_docs/architecture/INDEX.md` [NEW]
- `_docs/architecture/BACKEND_STRUCTURE.md` [NEW]
- `_docs/architecture/STORAGE_AND_MIGRATIONS.md` [NEW]
- `_docs/architecture/CASCADE_AND_EGRESS.md` [NEW]
- `_docs/architecture/TELEMETRY_AND_BILLING.md` [NEW]
- `_docs/architecture/SECURITY_AND_AUTH.md` [NEW]
- `_docs/architecture/TELEGRAM_AND_TMA.md` [NEW]
- `_docs/architecture/FRONTEND_SPA.md` [NEW]
- `AGENTS.md` [MODIFY]
- `.agents/skills/developer/SKILL.md` [MODIFY]
- `.agents/skills/orchestrator/SKILL.md` [MODIFY]
- `_docs/TASKS.md` [MODIFY]

## 3. Чек-лист верификации
- [ ] Все 8 документов в `_docs/architecture/` созданы и содержат конкретные контракты, архитектурные инварианты и типичные грабли.
- [ ] В `AGENTS.md` добавлен раздел «Архитектурный навигатор по подсистемам» с прямыми ссылками.
- [ ] Локальные скиллы разработчика и оркестратора актуализированы (заменены упоминания монолитного `server.go` на `handlers_*.go`).
- [ ] `go test -race ./...` — 100% pass.
- [ ] `make lint` и `make build-linux` — успешная проверка.
- [ ] `npm run build` — чистая сборка фронтенда.
