---
phase: "4"
slug: "assign-meetings-to-projects"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-17"
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `04-RESEARCH.md` §Validation Architecture. PHPUnit and Playwright run only in GitHub CI on this host; Vitest, vue-tsc, tsc, ESLint, Prettier, Pint and PHPStan run locally.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (CI only) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60+ (CI; chromium locally only if the app runs) |
| **Config file** | `phpunit.xml`, `vitest.config.ts` (setup `resources/js/test-setup.ts`, include `resources/js/**/*.{test,spec}.{ts,tsx}`), `playwright.config.ts` |
| **Quick run command** | `npx vitest run resources/js/m365 resources/js/packages/ui/src/FullCalendar` · PHP: `"$PHP_BIN" vendor/bin/pint --test <files>` and `"$PHP_BIN" vendor/bin/phpstan analyse <files>` |
| **Full suite command** | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check` · CI: PHPUnit (`--filter Microsoft365`), PHPStan, Pint, Playwright workflows green for HEAD |
| **Estimated runtime** | JS ~40 s locally · fast CI ~10 min · PHP CI ~10 min · Playwright up to ~60 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched m365 files>` + `npx prettier --check <files>`; PHP tasks: Pint + PHPStan on the touched files with `$PHP_BIN`
- **After every plan wave:** local JS full suite, push, then the PHPUnit / PHPStan / Pint CI runs for the sha
- **Before `/gsd-verify-work`:** all CI workflows green (including Playwright) for the release sha
- **Max feedback latency:** JS 60 s; PHP and Playwright one CI cycle (~10 min / ~60 min)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-XX-XX | XX | X | ASGN-01 | — | Conversion creates the entry with the meeting's start/end, project, task, tags, billable, description; converting a dismissed meeting clears `dismissed_at` | PHP feature | CI `--filter OutlookMeetingConversionTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-01 | — | Action present in hover card, panel and context menu (gated by `canAct`); form prefill (subject, times, last project, billable from project); Enter submits | Vitest | `npx vitest run resources/js/m365/calendar/OutlookConvertForm.test.ts OutlookGhostDetail.test.ts OutlookMeetingContextItems.test.ts OutlookMeetingHoverCard.test.ts` | ❌ W0 / ✅ extend | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-02 | T-4 permissions | Employee without project visibility → failed `validation`; no `time-entries:create:own` → `forbidden`; org `prevent_overlapping_time_entries` → `overlapping_time_entry` (same entry without the flag succeeds); billable forced false when `BillingContract` disallows; `RecalculateSpentTimeForProject`/`Task` dispatched (`Queue::fake`); `billable_rate` set; blocked org → error | PHP feature | CI `--filter OutlookMeetingConversionTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-02 | — | Contract: `TimeEntryController::store(Organization, TimeEntryStoreRequest): JsonResource` signature unchanged | PHP unit (reflection) | CI `--filter CoreTimeEntryCreatorContractTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-03 | — | Repeat request returns `existing` with the same id; entry count stays 1; direct duplicate link insert raises the unique violation; index excludes the converted meeting; link survives a re-sync (fixture replay via `InteractsWithGraphFixtures`) and a disconnect/reconnect | PHP feature | CI `--filter OutlookMeetingLinkLifecycleTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-03 | — | Double submit sends one request (button disabled while saving); optimistic removal and rollback on failure | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts` | ✅ extend | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-04 | T-4 cross-user | Batch of 3: 1 created, 1 foreign/gone id → `meeting_not_found`, 1 already converted → `existing`; per-item times and subjects come from each row; ids max 50, distinct | PHP feature | CI `--filter OutlookMeetingConversionTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-04 | — | Ctrl/Cmd/Shift click selects without opening the panel; range by start order; Escape and outside click clear; bar shows N; results keep failed ones selected | Vitest | `npx vitest run resources/js/m365/calendar/OutlookGhostLayer.test.ts resources/js/m365/calendar/OutlookSelectionBar.test.ts` | ✅ extend / ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-05 | — | Delete via `DELETE /api/v1/.../time-entries/{id}`, bulk `DELETE /time-entries`, member removal and org deletion all remove the link and re-surface the meeting; editing the entry's times keeps it hidden; a reassigned entry re-surfaces | PHP feature | CI `--filter OutlookMeetingLinkLifecycleTest` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-05 | — | Meetings refetch after a `timeEntries` fetch (debounced); badge renders only for linked ids | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts resources/js/m365/calendar/OutlookEntryBadge.test.ts` | ✅ extend / ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | D-13 | T-4 privacy | Impersonation → 404 and no entry created; foreign meeting id → `meeting_not_found`; `OutlookMeetingLink` not Auditable and not in Filament; client-supplied `member_id` ignored | PHP feature | CI `--filter OutlookMeetingPrivacyTest` | ✅ extend | ⬜ pending |
| 4-XX-XX | XX | X | D-12 | — | Fork route not under `api/` (openapi untouched); core slot chain renders identically without slot content | PHP route test + Vitest | CI `--filter OutlookMeetingConversionTest`; `npx vitest run resources/js/packages/ui/src/FullCalendar` | ❌ W0 | ⬜ pending |
| 4-XX-XX | XX | X | ASGN-01..05 (UI) | — | Mini form from panel/menu; Ctrl-click multi-select + bar; nested dropdowns keep the panel open (A1) | Playwright | `npx playwright test e2e/outlook-convert.spec.ts --project=chromium` (CI) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**E2E note:** CI runs with the integration off. Ghosts come from `window.__TEST_SET_OUTLOOK_MEETINGS__` and in that mode `canAct` is false (`useOutlookMeetings.ts:424`), so the actions are hidden. The UI flow needs a test-hook extension (optional third argument, e.g. `{ actions: true, convertUrl }`) that enables actions in test mode; the spec fulfils conversion with `page.route()` and creates a real entry through `createTimeEntryViaApi(ctx, …)` (`e2e/utils/api.ts:408`) so the calendar shows it, injecting linked ids for the badge. Server behaviour stays covered by PHPUnit. Without the hook extension the browser checks for the new actions fall back to manual UAT.

*Task IDs, plan and wave columns are placeholders until the planner assigns tasks.*

---

## Wave 0 Requirements

- [ ] `tests/Feature/Microsoft365/OutlookMeetingConversionTest.php` — stubs for ASGN-01/02/04, route not under `api/`
- [ ] `tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php` — stubs for ASGN-03/05 (delete paths, re-sync, disconnect, reassignment)
- [ ] `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` — core signature guard
- [ ] `resources/js/m365/calendar/OutlookConvertForm.test.ts`, `OutlookSelectionBar.test.ts`, `OutlookEntryBadge.test.ts`, `conversionApi.test.ts`, `lastProject.test.ts`
- [ ] `e2e/outlook-convert.spec.ts` + test-hook extension in `useOutlookMeetings.ts`
- [ ] Shared fixture helper `meeting(User, graphId, overrides)` (inline in `OutlookMeetingDismissTest.php` lines 59-75): copy it or move it into `Support/` for the new tests
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser checks of the new actions if the Playwright test-hook extension is not built | ASGN-01..05 | CI runs with the integration off and `canAct` false in test mode | Owner converts, multi-selects and bulk-converts real Outlook meetings on the deployed fork |

*Otherwise all phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (JS) / one CI cycle (PHP, Playwright)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
