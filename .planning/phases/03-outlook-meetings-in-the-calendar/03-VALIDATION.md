---
phase: "3"
slug: "outlook-meetings-in-the-calendar"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-05"
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `03-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (CI only on this host) · Vitest 4 + happy-dom · Playwright 1.60 |
| **Config file** | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | JS: `npx vitest run resources/js/m365` · PHP: push, then grep `PASS.*Microsoft365` in the "PHPUnit Tests" run log for `$(git rev-parse HEAD)` |
| **Full suite command** | Local: `npm run test:unit && npm run type-check && npm run lint && npm run format:check` · CI: all ten workflows `success` for the HEAD sha |
| **Estimated runtime** | JS ~30 s locally · PHP CI ~10 min · full CI up to ~60 min (Playwright shards) |

---

## Sampling Rate

- **After every JS task commit:** `npx vitest run <touched path>` + `npx prettier --check <touched files>`
- **After every backend plan:** push once; check "PHPUnit Tests", "PHP Linting", "Static code analysis (PHPStan)" for the sha; count `PASS` lines per new class = classes × 3 (Postgres 15/16/17)
- **After every plan wave:** local JS full suite + the three PHP workflows green
- **Before `/gsd-verify-work`:** all ten workflows green for the release sha (Fork - Build image, NPM Build, NPM Format Check, NPM Lint, NPM Test Unit, NPM Typecheck, PHP Linting, PHPUnit Tests, Playwright Tests, Static code analysis (PHPStan))
- **Max feedback latency:** JS 60 s; PHP one CI cycle (~10 min)

---

## Per-Task Verification Map

Filled by the planner per task (each task's `<verify><automated>`). Requirement → test map from research:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| SYNC-01 | `GET /m365/meetings` reads cache, sends no HTTP; entries not blocked | PHP feature + Vitest | `--filter OutlookMeetingEndpointTest`; `npx vitest run resources/js/m365/calendar` | ❌ W0 | ⬜ pending |
| SYNC-02 | Reuse window, forced min-interval, lock coalescing, throttle, debounce, single flight, cooldown | PHP feature + Vitest fake timers | `--filter OutlookMeetingSyncTest`; vitest | ❌ W0 | ⬜ pending |
| SYNC-03 | Fixture replay: eligible shown, cancelled/private/confidential/all-day excluded | PHP unit/feature | `--filter OutlookMeetingEligibilityTest`, `OutlookMeetingSyncTest` | ❌ W0 | ⬜ pending |
| SYNC-04 | S2 DST: 08:00Z / 09:00Z both 10:00 Europe/Madrid | PHP + Vitest | `--filter OutlookMeetingSyncTest`; `ghostLayout.test.ts` | ❌ W0 | ⬜ pending |
| SYNC-05 | 429 Retry-After back-off, 5xx/timeout unavailable, no-mailbox quiet, partial traversal never marks gone | PHP + Vitest | `--filter OutlookMeetingSyncTest`; controls test | ❌ W0 | ⬜ pending |
| CAL-01 | Totals unchanged by ghosts; sync never changes time_entries | Vitest + PHP | vitest; PHP count assertion | ❌ W0 | ⬜ pending |
| CAL-02 | Pointerdown on ghost starts no selection (control: empty grid does) | Vitest component + Playwright | `OutlookGhostLayer.test.ts`; `npx playwright test e2e/outlook-ghosts.spec.ts` | ❌ W0 | ⬜ pending |
| CAL-03 | Foreign rows never returned; foreign dismiss 404; impersonation returns nothing (D-22) | PHP feature | `--filter OutlookMeetingEndpointTest` | ❌ W0 | ⬜ pending |
| CAL-04 | Dismiss/restore idempotent; survives re-sync; include_dismissed toggle | PHP feature + Vitest | same | ❌ W0 | ⬜ pending |
| SEC-02 | Silent refresh, rotated token stored encrypted, invalid_grant → reconnect, invalid_client → unavailable | PHP feature | `--filter MicrosoftTokenRefreshTest` | ❌ W0 | ⬜ pending |
| D-15 / D-17 / D-21 | No tokens/subjects in logs or props; routes not under `api/`; disconnect purges meetings | PHP | logging + route-list + disconnect tests | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Per-task map (filled by the planner, 2026-11-05; revised after plan-check iteration 1: 12 plans)

| Plan / Task | Requirements | Local automated verify | CI gate | Test files created / extended |
|-------------|--------------|------------------------|---------|-------------------------------|
| 03-01 T1 (tracer) | SYNC-01, SYNC-03, SYNC-04 | Pint + PHPStan (`$PHP_BIN`) | at T2 | OutlookMeetingSyncTest, Support/InteractsWithGraphFixtures |
| 03-01 T2 | SYNC-02 (not_connected), SYNC-04 | Pint + PHPStan | Gate A + Gate B = 3 | OutlookMeetingSyncTest |
| 03-02 T1 (tracer) | SYNC-01 | Pint + PHPStan | at T3 | OutlookMeetingEndpointTest |
| 03-02 T2 | SYNC-03, SYNC-04 | Pint + PHPStan | at T3 | OutlookMeetingEligibilityTest, GraphCalendarClientTest |
| 03-02 T3 | SYNC-01, CAL-03 | Pint + PHPStan | Gate A + Gate B = 12 | OutlookMeetingEndpointTest |
| 03-03 T1 (tracer) | SEC-02 | Pint + PHPStan | at T2 | MicrosoftTokenRefreshTest |
| 03-03 T2 | SEC-02 | Pint + PHPStan | Gate A + Gate B = 12 | MicrosoftTokenRefreshTest |
| 03-04 T1 (tracer) | SYNC-05 | Pint + PHPStan | at T3 | OutlookSyncResilienceTest |
| 03-04 T2 | SYNC-02 | Pint + PHPStan | at T3 | OutlookSyncResilienceTest |
| 03-04 T3 | SYNC-03, SYNC-05 | Pint + PHPStan | Gate A + Gate B = 12 | OutlookSyncResilienceTest, GraphCalendarClientTest |
| 03-05 T1 (tracer) | CAL-02 | `npx vitest run resources/js/m365 && npm run type-check` | at T2 | OutlookGhostLayer.test.ts |
| 03-05 T2 | CAL-01, CAL-02, SYNC-04 (D-01/D-23 geometry, totals) | Gate F | 9 workflows (incl. Playwright regression) | ghostLayout.test.ts, OutlookGhostLayer.test.ts |
| 03-06 T1 (tracer) | SYNC-01 | vitest + vue-tsc; Pint + PHPStan | at T3 | OutlookCalendarPropTest |
| 03-06 T2 | SYNC-02 | vitest + eslint + prettier | at T3 | useOutlookMeetings.test.ts |
| 03-06 T3 | CAL-01, CAL-02 (D-01 in the browser) | Playwright listing + eslint + prettier | 9 workflows + Gate B = 12 | e2e/outlook-ghosts.spec.ts |
| 03-07 T1 (tracer) | SYNC-02 | vitest + vue-tsc | at T2 | OutlookCalendarControls.test.ts |
| 03-07 T2 | SYNC-05 | Gate F | 9 workflows | OutlookCalendarControls.test.ts, useOutlookMeetings.test.ts |
| 03-08 T1 (tracer) | SEC-02 | vitest + vue-tsc; Pint + PHPStan | at T2 | MicrosoftCalendarConnectTest, OutlookCalendarControls.test.ts |
| 03-08 T2 | SEC-02 | Gate F | 9 workflows + Gate B = 12 | MicrosoftCalendarConnectTest, OutlookCalendarPropTest |
| 03-09 T1 (tracer) | CAL-04 | vitest + vue-tsc; Pint + PHPStan | at T3 | OutlookMeetingDismissTest, OutlookGhostDetail.test.ts |
| 03-09 T2 | CAL-04 | Pint + PHPStan | at T3 | OutlookMeetingDismissTest |
| 03-09 T3 | CAL-04 | Gate F + Playwright listing | 9 workflows + Gate B = 6 | OutlookGhostDetail.test.ts, OutlookGhostLayer.test.ts, useOutlookMeetings.test.ts, e2e/outlook-ghosts.spec.ts |
| 03-10 T1 (tracer) | CAL-04 | vitest (m365 + FullCalendar) + vue-tsc | at T2 | OutlookDismissedSetting.test.ts, useOutlookMeetings.test.ts |
| 03-10 T2 | CAL-04 | Gate F | 9 workflows | OutlookGhostLayer.test.ts, useOutlookMeetings.test.ts |
| 03-11 T1 (tracer) | CAL-03 | Pint + PHPStan | at T2 | OutlookMeetingPrivacyTest |
| 03-11 T2 | CAL-03, CAL-01 (reports unchanged) | Pint + PHPStan | Gate A + Gate B = 15 | OutlookMeetingPrivacyTest |
| 03-12 T1 (tracer) | all | docs secrets gate | 10 workflows + Microsoft365 PASS >= 75 | none |
| 03-12 T2 (owner checkpoint) | all | public curl checks (health 200, login prop, /m365/meetings 401) | n/a | none |
| 03-12 T3 | SYNC-04, SEC-02, CAL-03 | docs runbook + secrets gates; human-checks (end-of-phase) | n/a | none |

Sampling continuity: every task has an automated verify; no three consecutive tasks rely on CI only (each backend task runs Pint + PHPStan locally, each frontend task runs Vitest locally).

---

## Wave 0 Requirements

- [ ] `tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php` — manifest-driven fixture loader, `fakeGraphCalendar()`, expired-token account helper
- [ ] `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php`, `GraphCalendarClientTest.php`
- [ ] `tests/Feature/Microsoft365/OutlookMeetingSyncTest.php`, `OutlookMeetingEndpointTest.php`, `MicrosoftTokenRefreshTest.php`
- [ ] `resources/js/m365/calendar/*.test.ts`
- [ ] `e2e/outlook-ghosts.spec.ts` + `window.__TEST_SET_OUTLOOK_MEETINGS__` hook
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ghosts at right local time in a real DST-crossing week | SYNC-04 | Real tenant mailbox | Open /calendar on a week with a recurring meeting crossing DST; compare with Outlook |
| Reconnect after revocation returns to calendar | SEC-02 | Needs Entra revocation | Revoke sessions/app for the test user in Entra; open calendar; "Reconnect Microsoft"; complete; lands on /calendar |
| Non-admin member sees only own meetings | CAL-03 | Real second account | Sign in as the second tenant account; check calendar |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (JS) / one CI cycle (PHP)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
