---
name: playwright
description: >-
  End-to-end browser automation, mobile and desktop responsive UI testing, and regression
  verification using Playwright for Avari Keys. Use this skill when writing or running
  browser E2E test suites, verifying mobile viewports, or diagnosing UI regressions.
---

# Playwright E2E Testing Skill (Avari Keys)

This skill provides testing standards, mobile-first browser verification workflows, and execution commands for running End-to-End (E2E) tests with Playwright across the Avari Keys frontend.

---

## 1. Quick Test Commands

```bash
# Run all Playwright E2E tests in headless mode
cd apps/frontend && npx playwright test

# Run tests targeting mobile viewport (iPhone / Android)
cd apps/frontend && npx playwright test --project=mobile-safari
# or
cd apps/frontend && npx playwright test --project=mobile-chrome

# Run specific spec file
cd apps/frontend && npx playwright test e2e/key-creation.spec.ts

# Show HTML test report
cd apps/frontend && npx playwright show-report
```

---

## 2. Configuration & Mock Mode Integration

Playwright tests run against the frontend in self-contained Mock Mode (`npm run dev:mock`), requiring no live backend or cluster:

1. **Local Vite Dev Server**: Automatically spawned on `http://localhost:5173` with `VITE_USE_MOCK=true`.
2. **Mobile Viewport Emulation**:
   - iPhone 14/15: Viewport `390x844`, touch-enabled, device scale factor 2.
   - Android (Pixel 7): Viewport `412x915`, touch-enabled.
   - Desktop: Viewport `1280x800`.
3. **Core Scenarios to Verify**:
   - Mobile-First key creation wizard (`CreateKeyModal`).
   - Protocol-first selection (AmneziaWG, Hysteria 2, Mieru, VLESS+Reality).
   - Incompatible server graying out (`opacity-40`, disabled radio) with proper badge.
   - Shadowrocket (PSK) toggle visibility only under AmneziaWG.
   - Quick device name suggestion chips (`iPhone`, `Android`, `MacBook`, `Windows`, `Роутер`).
   - Server details expandable accordion with zero text overlaps.
