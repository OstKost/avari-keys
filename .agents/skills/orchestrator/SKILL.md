---
name: orchestrator
description: >-
  Orchestration, task planning, architecture design, Gitflow control, and release
  management for the Avari Keys project. Use this skill when breaking down tasks,
  managing the kanban board in _docs/TASKS.md, coordinating Gitflow branches,
  preparing handoffs, or cutting new releases.
---

# Orchestrator & Architect Skill (Avari Keys)

This skill provides step-by-step procedures and runbooks for any agent operating as the **Orchestrator and Architect** in the Avari Keys project.

---

## 1. Responsibilities

- **System Architecture**: Enforce architectural invariants (Zero-CGo, Decoy safety, key isolation, mock-first frontend, Curve25519 telemetry).
- **Task Lifecycle**: Deconstruct features into discrete tasks, maintain [`_docs/TASKS.md`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/_docs/TASKS.md) and task specifications in `_docs/tasks/`.
- **Gitflow Oversight**: Manage branching (`develop`, `feature/TASK-XXX-...`, `release/vX.Y.Z`, `main`), review diffs, and ensure zero regressions.
- **Agent Handoff**: Formulate clear, actionable directives for the Developer / Implementer role.
- **Release Management**: Bump versions, update documentation, generate release notes (`_docs/RELEASE-vX.Y.Z.md`), and tag releases.

---

## 2. Task Intake & Decomposition Runbook

When receiving a new feature request or architectural change:

1. **Verify Architectural Invariants**:
   - Review [AGENTS.md](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/AGENTS.md) Section 2.
   - Ensure the proposal does not introduce CGo, private key leakage to Master DB, unmocked frontend dependencies, or unhandled cross-platform socket issues.
2. **Assign Task Identifier**:
   - Inspect [`_docs/TASKS.md`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/_docs/TASKS.md) to find the next available task ID (e.g., `TASK-060`).
3. **Draft Task Specification**:
   - Create `_docs/tasks/TASK-XXX-<slug>.md`.
   - Specify:
     - Objective & Background.
     - Affected modules (`apps/backend`, `apps/frontend`, `deploy`, `scripts`).
     - Data models & API contracts (Request/Response DTOs).
     - Synchronous requirement for both [`apps/frontend/src/api/client.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/client.ts) and [`apps/frontend/src/api/mockClient.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/mockClient.ts).
     - Verification checklist.
4. **Update Kanban Board**:
   - Add the task to [`_docs/TASKS.md`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/_docs/TASKS.md) under `To Do` or `In Progress`.
5. **Prepare Gitflow Branch**:
   - Ensure working directory is clean (`git status`).
   - Create branch: `git checkout -b feature/TASK-XXX-<slug> develop`.

---

## 3. Handoff Protocol to Developer

When delegating implementation to the Developer role, use the standard handoff format:

```markdown
### Handoff: [Orchestrator -> Developer]
- **Ветка**: `feature/TASK-XXX-<slug>`
- **Спецификация задачи**: [`_docs/tasks/TASK-XXX-<slug>.md`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/_docs/tasks/TASK-XXX-<slug>.md)
- **Целевые файлы**:
  - Backend: `apps/backend/internal/...`
  - Frontend: `apps/frontend/src/...`
- **Особые требования**:
  - Чистый Go SQLite (без CGo).
  - Обязательно синхронизировать `mockClient.ts`.
  - Покрыть логику тестами `*_test.go`.
- **Команды верификации**: `make test && cd apps/frontend && npm run build`
```

---

## 4. Release Runbook

When all tasks for a milestone are completed:

1. **Verify Integrity**:
   - Run full verification:
     ```bash
     make test
     make lint
     make build-linux
     cd apps/frontend && npm run build
     ```
2. **Create Release Branch**:
   ```bash
   git checkout -b release/vX.Y.Z develop
   ```
3. **Bump Versions**:
   - Update `apps/frontend/package.json` version.
   - Update version strings in `README.md` and UI banners if applicable.
4. **Draft Release Notes**:
   - Create `_docs/RELEASE-vX.Y.Z.md` summarizing new features, architectural improvements, and bugfixes.
5. **Merge to Main & Develop**:
   ```bash
   git checkout main
   git merge --no-ff release/vX.Y.Z -m "chore(release): release vX.Y.Z"
   git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
   git checkout develop
   git merge --no-ff release/vX.Y.Z -m "chore(release): merge release/vX.Y.Z into develop"
   git branch -d release/vX.Y.Z
   ```
