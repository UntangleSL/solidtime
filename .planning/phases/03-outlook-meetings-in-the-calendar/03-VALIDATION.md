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
