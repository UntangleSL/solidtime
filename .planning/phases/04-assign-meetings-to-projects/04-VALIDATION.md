---
phase: "4"
slug: "assign-meetings-to-projects"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
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
| **Quick run command** | `npx vitest run resources/js/m365 resources/js/packages/ui/src/FullCalendar` · PHP: `"$PHP_BIN" vendor/bin/pint --test <files>` and `"$PHP_BIN" vendor/bin/phpstan analyse` (full app) |
| **Full suite command** | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check` · CI: PHPUnit (Microsoft365 PASS lines), PHPStan, Pint, Playwright workflows green for HEAD |
| **Estimated runtime** | JS ~40 s locally · fast CI ~10 min · PHP CI ~10 min · Playwright up to ~60 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched m365 files>` + `npx prettier --check <files>`; PHP tasks: Gate P (Pint on the touched files + full-app PHPStan with `$PHP_BIN`)
- **After every plan wave:** the wave anchor runs the CI gate on the merged wave sha: wave 1 = 04-01 (Gate W + Gate B ≥ 81), wave 2 = 04-02 (Gate W + Gate B ≥ 84), wave 3 = 04-08 (NPM workflows + Playwright)
- **Before `/gsd-verify-work`:** all ten CI workflows green (including Playwright and the fork image) for the release sha (04-09)
- **Max feedback latency:** JS 60 s; PHP and Playwright one CI cycle (~10 min / ~60 min)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | ASGN-01 | T-04-01, T-04-08 | One meeting becomes one core-created entry with the meeting's times, linked in the same transaction; unknown id → `meeting_not_found`; route is a web session route outside `api/` | PHP feature | Gate P locally; CI `OutlookMeetingConversionTest` | ❌ W0 (created by the task) | ⬜ pending |
| 4-01-02 | 01 | 1 | ASGN-02 | T-04-02, T-04-06 | Project visibility → `validation`; no create permission → `forbidden`; org overlap flag → `overlapping_time_entry` (same entry without the flag succeeds); billable lock; `billable_rate`; Recalculate jobs (`Queue::fake`); blocked org creates nothing; client `member_id` ignored; core `store()` signature guard; en/es key parity (84 keys) | PHP feature + unit | Gate P; lang parity script; CI `OutlookMeetingConversionTest`, `CoreTimeEntryCreatorContractTest` | ❌ W0 (created by the task) | ⬜ pending |
| 4-01-03 | 01 | 1 | ASGN-03 | T-04-04 | Converted meeting hidden from the read (also with dismissed shown); reassigned entry re-lists; `urls.convert` in the prop; 5 meetings routes, parameters only `meeting`/`organization` | PHP feature | Gate P; CI Gate W + Gate B ≥ 81 | ✅ extend | ⬜ pending |
| 4-02-01 | 02 | 2 | ASGN-03 | T-04-09 | Repeat → `existing` with the same id, one entry; duplicate link insert violates the unique index; unique violation never answers 500; stale link replaced | PHP feature | Gate P; CI `OutlookMeetingConversionTest` | ✅ extend | ⬜ pending |
| 4-02-02 | 02 | 2 | ASGN-05 | T-04-10, T-04-11 | `DELETE` single, bulk `DELETE /time-entries`, member removal and org deletion remove the link and re-list the meeting; edits keep it hidden; reassignment re-lists; link survives re-sync and disconnect/reconnect (D-15); `linked_time_entry_ids` by entry overlap, empty when impersonating | PHP feature | Gate P; CI `OutlookMeetingLinkLifecycleTest` | ❌ W0 (created by the task) | ⬜ pending |
| 4-02-03 | 02 | 2 | ASGN-04, D-13 | T-04-12, T-04-13 | Batch of 3: created / `meeting_not_found` (foreign id) / `existing`, per-item times and subjects, independent transactions; impersonation → 404 and nothing created; `OutlookMeetingLink` not Auditable and not in Filament | PHP feature | Gate P; CI Gate W + Gate B ≥ 84 | ✅ extend | ⬜ pending |
| 4-03-01 | 03 | 1 | ASGN-01 | T-04-14 | Panel "Create time entry" → form → POST → created meeting removed from every cached read; failures remove nothing; request failure → generic message | Vitest | `npx vitest run resources/js/m365/calendar/conversionApi.test.ts resources/js/m365/calendar/useOutlookMeetings.test.ts resources/js/m365/calendar/OutlookGhostDetail.test.ts resources/js/m365/calendar/OutlookGhostLayer.test.ts` | ❌ W0 / ✅ extend | ⬜ pending |
| 4-03-02 | 03 | 1 | ASGN-01 | T-04-15, T-04-16 | Prefill (subject, times, last project → last entry's project → empty, billable from project, lock); focus rule; Enter / Ctrl+Enter; validation; busy state blocks re-entry; failure keeps values and shows the reason | Vitest | `npx vitest run resources/js/m365/calendar/OutlookConvertForm.test.ts resources/js/m365/calendar/lastProject.test.ts` | ❌ W0 (created by the task) | ⬜ pending |
| 4-03-03 | 03 | 1 | ASGN-03 | T-04-15, T-04-17 | Second convert for an in-flight id sends nothing (button also disabled); removal only after the server confirms created/existing (UI-SPEC: pessimistic single form), failures keep the meeting; openForm channel; selection prune/clear; canAct false ignores selection | Vitest | `npx vitest run resources/js/m365` | ❌ W0 / ✅ extend | ⬜ pending |
| 4-04-01 | 04 | 2 | ASGN-01 | T-04-18 | Menu "Create time entry" opens the form after the menu closed; hidden when canAct is false | Vitest | `npx vitest run resources/js/m365/calendar/OutlookMeetingContextItems.test.ts` | ✅ extend | ⬜ pending |
| 4-04-02 | 04 | 2 | ASGN-01 | T-04-19 | Hover card "Create time entry" → openForm; select hint (⌘ on macOS) only with canAct | Vitest | `npx vitest run resources/js/m365/calendar/OutlookMeetingHoverCard.test.ts` | ✅ extend | ⬜ pending |
| 4-04-03 | 04 | 2 | ASGN-04 | T-04-19 | Ctrl/Cmd/Shift click selects without opening the panel; range by start over rendered meetings; keyboard routes; plain click clears; selected look and aria; hover suppression; menu Select/Deselect | Vitest | `npx vitest run resources/js/m365` | ✅ extend | ⬜ pending |
| 4-05-01 | 05 | 2 | ASGN-04 | T-04-21 | Bar shows N; batch form lists the selection without description/time fields; one request with all ids | Vitest | `npx vitest run resources/js/m365/calendar/OutlookSelectionBar.test.ts resources/js/m365/calendar/OutlookConvertForm.test.ts` | ❌ W0 (created by the task) | ⬜ pending |
| 4-05-02 | 05 | 2 | ASGN-04 | T-04-20, T-04-22 | Per-row pending/created/existing/failed with reason; summary + focus; retry only failed; all done → close, one toast and announcement; failed stay selected | Vitest | `npx vitest run resources/js/m365/calendar/OutlookAssignResults.test.ts resources/js/m365/calendar/OutlookConvertForm.test.ts resources/js/m365/calendar/OutlookSelectionBar.test.ts` | ❌ W0 (created by the task) | ⬜ pending |
| 4-05-03 | 05 | 2 | ASGN-04 | — | Escape and outside pointerdown clear (not inside blocks, bar, popover, nested pickers); count announcements; narrow-screen and motion classes | Vitest | `npx vitest run resources/js/m365` | ✅ extend | ⬜ pending |
| 4-06-01 | 06 | 2 | ASGN-05 | T-04-23 | Meetings refetch once, 500 ms after a refetch of loaded time entries; not on first loads, failures or other keys; not in test mode | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts` | ✅ extend | ⬜ pending |
| 4-06-02 | 06 | 2 | ASGN-05 | T-04-24, T-04-25 | `linked_time_entry_ids` parsed defensively; `linkedTimeEntryIds` in the context; test hook `{ actions, convertUrl, linkedTimeEntryIds }` enables conversion in test mode; two-argument hook unchanged | Vitest | `npx vitest run resources/js/m365` | ❌ W0 (`meetingsApi.test.ts`) / ✅ extend | ⬜ pending |
| 4-07-01 | 07 | 3 | ASGN-05 (D-04) | T-04-26 | Badge renders only for linked ids, with title and sr-only text | Vitest | `npx vitest run resources/js/m365/calendar/OutlookEntryBadge.test.ts resources/js/packages/ui/src/FullCalendar` | ❌ W0 (created by the task) | ⬜ pending |
| 4-07-02 | 07 | 3 | D-12 | T-04-27 | Core slot chain renders identically without slot content; Phase 4 ledger section; docs secrets gate | Vitest + docs gate | `npx vitest run resources/js/packages/ui/src/FullCalendar resources/js/m365`; `node tests/Tools/m365-spike/validate-docs.mjs secrets` | ❌ W0 (`FullCalendarEventContent.test.ts`) | ⬜ pending |
| 4-08-01 | 08 | 3 | ASGN-01, ASGN-03 | — | Browser: panel form, nested pickers keep it open, request body, meeting leaves, real entry with the icon, no core create dialog | Playwright (CI) | Local `npx playwright test e2e/outlook-convert.spec.ts --list --project=chromium`; CI Playwright Tests | ❌ W0 (created by the task) | ⬜ pending |
| 4-08-02 | 08 | 3 | ASGN-01..05 | T-04-28 | Browser: menu and hover entry points; Ctrl-click multi-select, partial failure, retry; Shift range; Escape; read-only without actions; 1366x768 backstops (popover in viewport, bar ≤ 64 px, lane vanishes) | Playwright (CI) | Wave-3 gate: NPM workflows + Playwright Tests = success for the merged sha | ✅ extend | ⬜ pending |
| 4-09-01 | 09 | 4 | ASGN-01..05 | T-04-30, T-04-32 | Ten workflows green for R; ≥ 84 Microsoft365 PASS lines; ledger reconciled; compose pinned to sha-<R7> | CI gate | `gh run list --commit R ...` (ten `=success`), Gate B, `validate-docs.mjs secrets`, pin count 3 | n/a | ⬜ pending |
| 4-09-02 | 09 | 4 | ASGN-01..05 | T-04-29, T-04-31, T-04-33 | Owner-approved deploy; migration DONE; health 200; login prop; `/m365/meetings` 401; convert route 401/419; Phase 4 markers in the Calendar bundle | Public checks | `curl` checks in the task's verify block | n/a | ⬜ pending |
| 4-09-03 | 09 | 4 | ASGN-01..05 | — | Runbook row; owner UAT on real Outlook meetings queued | Docs gate + human | `node tests/Tools/m365-spike/validate-docs.mjs runbook && node tests/Tools/m365-spike/validate-docs.mjs secrets` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**E2E note:** CI runs with the integration off. Ghosts come from `window.__TEST_SET_OUTLOOK_MEETINGS__`; 04-06 adds the optional third argument `{ actions: true, convertUrl, linkedTimeEntryIds }` that enables the actions in test mode, and 04-08 fulfils the conversion with `page.route()`, creating the real entry through the core API (`ctx.request`) so the calendar shows it and the Outlook icon is checked. Server behaviour stays covered by PHPUnit (04-01, 04-02).

---

## Wave 0 Requirements

Each Wave 0 file is created by the task that first needs it (no separate stub wave):

- [ ] `tests/Feature/Microsoft365/OutlookMeetingConversionTest.php` — 4-01-01 (ASGN-01/02/04, route not under `api/`)
- [ ] `tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php` — 4-02-02 (ASGN-03/05: delete paths, re-sync, disconnect, reassignment)
- [ ] `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` — 4-01-02 (core signature guard)
- [ ] `resources/js/m365/calendar/conversionApi.test.ts` — 4-03-01; `OutlookConvertForm.test.ts`, `lastProject.test.ts` — 4-03-02; `useOutlookSelection.test.ts` — 4-03-03; `OutlookSelectionBar.test.ts` — 4-05-01; `OutlookAssignResults.test.ts` — 4-05-02; `meetingsApi.test.ts` — 4-06-02; `OutlookEntryBadge.test.ts` — 4-07-01; `resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.test.ts` — 4-07-02
- [ ] `e2e/outlook-convert.spec.ts` — 4-08-01, with the test-hook extension in `useOutlookMeetings.ts` — 4-06-02
- [ ] Meeting fixture helper `meeting(User, graphId, overrides)` copied from `OutlookMeetingDismissTest.php` lines 59-75 into the new PHP test classes — 4-01-01, 4-02-02
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Conversions on real Outlook meetings in production (hover, panel, menu; prefill of the last project) | ASGN-01 | Real Graph data and the owner's projects | 04-09 Task 3 human check 1 |
| Billable rate and project totals equal to a manual entry in production | ASGN-02 | Production billing settings and the queue worker | 04-09 Task 3 human check 2 |
| Double click and two tabs on one real meeting | ASGN-03 | Real network timing | 04-09 Task 3 human check 3 |
| Multi-assign with real permissions | ASGN-04 | Real permissions and meetings | 04-09 Task 3 human check 4 |
| Edit, delete, disconnect/reconnect with real Graph re-sync | ASGN-05 | Real disconnect flow and Graph | 04-09 Task 3 human check 5 |
| Layout on the owner's 1366x768 laptop, light and dark | UI-SPEC backstops | Visual judgement (also screenshot-backed in 04-08) | 04-09 Task 3 human check 6 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (JS) / one CI cycle (PHP, Playwright)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
