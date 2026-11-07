---
name: qa-tester
description: >-
  Automated testing, race condition checking, linting, Linux cross-compilation,
  and production frontend build verification for Avari Keys. Use this skill when
  running test suites, diagnosing test failures, validating Zero-CGo builds,
  or certifying code changes before merge.
---

# QA Tester & Verifier Skill (Avari Keys)

This skill provides step-by-step procedures, runbooks, and failure-diagnosis matrices for verifying code changes across the backend and frontend of Avari Keys. It is optimized for fast, targeted execution.

---

## 1. Quick Verification Pipeline

Execute the following sequential verification pipeline:

```bash
# Step 1: Run all backend tests with race detection
cd apps/backend && go test -v -race ./...

# Step 2: Static analysis (Go vet)
cd apps/backend && go vet ./...

# Step 3: Zero-CGo Linux cross-compilation check (amd64)
cd apps/backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /dev/null ./cmd/master
cd apps/backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /dev/null ./cmd/slave

# Step 4: Frontend TypeScript check & production bundling
cd apps/frontend && npm run build
```

---

## 2. Common Failure Modes & Diagnostics

| Symptom / Error | Probable Root Cause | Resolution |
|---|---|---|
| `fatal error: cgo/libc not found` | Package imported requiring CGo or missing `CGO_ENABLED=0`. | Replace with pure Go alternative (`modernc.org/sqlite` instead of `mattn/go-sqlite3`). |
| `SO_BINDTODEVICE undefined` on Darwin/macOS | Platform-specific socket call not isolated by build tags. | Ensure `//go:build linux` is present on Linux-only files and dummy fallback `//go:build !linux` exists (see [`apps/backend/internal/netprobe`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/backend/internal/netprobe)). |
| `database is locked` / `busy` in tests | SQLite concurrent read/write collision or unclosed connection. | Verify WAL mode is configured and transactions properly close rows (`defer rows.Close()`). |
| Frontend `npm run dev:mock` returns empty/404 | Method added to [`client.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/client.ts) but forgotten in [`mockClient.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/mockClient.ts). | Add corresponding mock handler with mock state in `mockClient.ts`. |
| TypeScript `Property 'xyz' does not exist on type` | Contract DTO mismatch between Go backend and Frontend. | Update TypeScript interface in [`apps/frontend/src/types/index.ts`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/types/index.ts). |

---

## 3. Verification Report Template

After executing the verification suite, format the report:

```markdown
### Verification Report (QA)
- **Backend Tests (`go test -v -race ./...`)**: PASS (0 failures, 0 races detected)
- **Go Vet (`go vet ./...`)**: PASS
- **Static Binary Linux Compilation (`CGO_ENABLED=0`)**: PASS
- **Frontend Build (`tsc && vite build`)**: PASS
- **Mock Mode Parity**: VERIFIED (`mockClient.ts` matches all active contracts)
- **Verdict**: APPROVED FOR MERGE / ACTION REQUIRED: [Details]
```
