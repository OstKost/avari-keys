---
name: developer
description: >-
  Fullstack implementation, testing, and debugging guide for developers in Avari Keys.
  Use this skill when developing Go backend logic (Master/Slave), writing pure Go SQLite queries,
  implementing React/TypeScript/Tailwind UI components, updating mockClient.ts,
  or writing unit and contract tests.
---

# Fullstack Developer Skill (Avari Keys)

This skill provides implementation standards, coding guidelines, and verification procedures for any agent acting as the **Fullstack Developer** in the Avari Keys project.

---

## 1. Core Development Rules

### 1.1 Backend (Go 1.22+)
- **Zero CGo**: Always ensure compilation succeeds with `CGO_ENABLED=0`. Never import packages that link to `libc` or require C compilers.
- **Database Access**:
  - Use `modernc.org/sqlite` via `database/sql`.
  - Use parameterized queries to avoid SQL injection (`?` placeholder).
  - Schema migrations are handled in [`apps/backend/internal/storage/sqlite.go`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/storage/sqlite.go). Always add additive, backwards-compatible migration steps.
- **WireGuard / AmneziaWG Execution**:
  - Never call external system binaries directly without wrapping them in [`internal/runner/runner.go`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/runner/runner.go).
  - In unit tests, rely on [`internal/runner/mock_runner.go`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/runner/mock_runner.go).
- **Cross-Platform Network Probes**:
  - Low-level network operations (like socket device binding `SO_BINDTODEVICE`) must be isolated with build tags (`//go:build linux` vs `//go:build !linux`) as done in [`apps/backend/internal/netprobe`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/netprobe).
- **Telegram Bot**:
  - Maintain Decoy mode for unauthorized users.
  - Require token-based verification (`/link <token>`).
  - Restrict inline-button callbacks (user approval, password reset) to admin telegram IDs.

### 1.2 Frontend (React 18.3 + TypeScript + Tailwind)
- **MANDATORY Mock Client Parity**:
  - Any new method added to [`apps/frontend/src/api/client.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/client.ts) **MUST** have an exact counterpart in [`apps/frontend/src/api/mockClient.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/mockClient.ts).
  - `npm run dev:mock` must always work out of the box with rich sample data.
- **UI Design System (Cyber-Fantasy)**:
  - Background: Deep dark tones (`bg-[#0c0d12]`, `bg-[#13151f]`, `bg-[#181a27]`).
  - Primary Accent: Amber gold (`text-[#d9b96e]`, `border-[#d9b96e]/30`, `bg-[#d9b96e]`).
  - Glassmorphism: `backdrop-blur-md`, subtle borders `border-white/5` or `border-amber-500/20`.
- **Modals & Portals**:
  - Use [`apps/frontend/src/components/animatedPortal.tsx`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/components/animatedPortal.tsx) for all overlay dialogs and modals to ensure smooth backdrop transitions.
- **Routing & State Preservation**:
  - Use [`apps/frontend/src/utils/route.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/utils/route.ts) for history-backed tab and view switches.
  - Do not introduce heavy router packages like `react-router` without architectural approval.

---

## 2. Standard Implementation Workflow

1. **Review Task Specification**:
   - Read the relevant `_docs/tasks/TASK-XXX-<slug>.md`.
   - Check existing contracts in [`apps/backend/internal/models/contracts.go`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/models/contracts.go) and [`apps/frontend/src/types/index.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/types/index.ts).
2. **Implement Backend**:
   - Add/update storage methods in `apps/backend/internal/storage/sqlite.go`.
   - Implement handler in `apps/backend/internal/master/server.go` or `slave/server.go`.
   - Add unit/contract tests in `*_test.go`.
3. **Implement Frontend**:
   - Update TypeScript interfaces in `apps/frontend/src/types/index.ts`.
   - Implement API call in `apps/frontend/src/api/client.ts`.
   - **Implement mock behavior in `apps/frontend/src/api/mockClient.ts`**.
   - Build or update UI components in `apps/frontend/src/components/`.
4. **Local Verification**:
   - Execute verification commands before committing or creating a handoff report.

---

## 3. Verification Checklist

Run these commands and ensure every step passes:

```bash
# 1. Backend tests with race detector
cd apps/backend && go test -v -race ./...

# 2. Go static analysis
cd apps/backend && go vet ./...

# 3. Static binary compilation (Zero CGO)
cd apps/backend && CGO_ENABLED=0 go build -o /dev/null ./cmd/master
cd apps/backend && CGO_ENABLED=0 go build -o /dev/null ./cmd/slave
cd apps/backend && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o /dev/null ./cmd/master

# 4. Frontend TypeScript and production bundle
cd apps/frontend && npm run build
```

---

## 4. Handoff Protocol to Orchestrator

When completing a task, formulate the handoff:

```markdown
### Handoff: [Developer -> Orchestrator]
- **Ветка**: `feature/TASK-XXX-...`
- **Задача**: `_docs/tasks/TASK-XXX.md`
- **Выполненные изменения**: [Краткое описание реализации]
- **Ключевые файлы**:
  - [`apps/backend/...`](file:///...)
  - [`apps/frontend/...`](file:///...)
- **Синхронизация Mock Mode**: Проверено, `mockClient.ts` обновлен, `npm run dev:mock` работает.
- **Результаты проверки**:
  - `go test -v -race ./...` — PASS
  - `go vet ./...` — PASS
  - `npm run build` (tsc) — PASS
- **Готовность к слиянию**: Ветка протестирована и готова к мержу в `develop`.
```
