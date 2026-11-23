---
phase: "6"
slug: "out-of-sync-detection"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `06-RESEARCH.md` §Validation Architecture and `06-UI-SPEC.md` "Validation Hooks". PHPUnit feature tests and Playwright run only in GitHub CI on this host; Vitest, vue-tsc, tsc, ESLint, Prettier, Pint and PHPStan run locally. The pure rules matrix, the Graph lookup mapping, the updater contract and the lang parity are DB-free PHP unit tests that run locally with `$PHP_BIN`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (feature tests: CI only; DB-free unit tests in `tests/Unit/Microsoft365`: local) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60 (CI) |
| **Config file** | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run resources/js/m365` · `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365` · `"$PHP_BIN" vendor/bin/pint --test <files>` · `"$PHP_BIN" vendor/bin/phpstan analyse` (full app) |
| **Full suite command** | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check` · CI: PHPUnit (Microsoft365 PASS lines), PHPStan, Pint, Playwright, fork image all green on HEAD |
| **Estimated runtime** | JS ~45 s locally · PHP unit ~10 s locally · PHP CI ~10 min · Playwright up to ~60 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched m365 files>` + `npx prettier --check <files>`; PHP tasks: Pint on the touched files + full-app PHPStan + the local DB-free unit tests (`OutOfSyncRulesTest`, `GraphEventLookupTest`, `CoreTimeEntryUpdaterContractTest`, `MicrosoftLangTest`)
- **After every plan wave:** push, then the CI gate on the merged wave sha: PHPUnit Microsoft365 PASS count ≥ 3 × classes (wave 1: 111 / 37 classes; wave 2: 123 / 41; wave 3: 135 / 45), PHPStan, Pint, NPM workflows; Playwright on wave 5
- **Before `/gsd-verify-work`:** all ten CI workflows green on the release sha R (06-16)
- **Max feedback latency:** JS and PHP unit 60 s; PHP feature and Playwright one CI cycle (~10 min / ~60 min)

---

## Per-Task Verification Map

Task IDs are `6-<plan>-<task>` from the 06-NN-PLAN.md files (planned 2026-11-23). PHP feature rows run in CI only (orchestrator wave gate); every task also has a local gate (Gate P / Gate U / Gate F) in its plan.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 06-01 | 1 | OSYNC-02 | T-06-01, T-06-04, T-06-05 | Tracer: not-started moved meeting with an unedited entry -> entry moved through core `TimeEntryController::update` on a complete sync (recalc job dispatched), snapshot updated, auto_adjusted_at recorded; unlinked entries untouched; partial traversal applies nothing; partial unique index allows a released + an active link; backfill fills only null snapshots | PHP feature | CI `--filter OutlookOutOfSyncSyncTest` | ❌ W0 (created by 6-01-01) | ⬜ pending |
| 6-01-02 | 06-01 | 1 | OSYNC-01, OSYNC-02 | T-06-01, T-06-03 | Rules matrix D-01..D-07, D-10, D-16..D-18 (started boundary `start == now`, 60-day boundary, all-day never auto-adjusted, flagged-before-start stays, Unknown never acts, Observation has no subject) | PHP unit (local, no DB) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/OutOfSyncRulesTest.php` | ❌ W0 (6-01-02) | ⬜ pending |
| 6-01-03 | 06-01 | 1 | OSYNC-02 (D-12) | — | `.claude/CLAUDE.md`, `.planning/PROJECT.md` and the sync docblock state the D-12 exception | grep | `test "$(grep -c 'meetings that already started' .claude/CLAUDE.md)" = "1"` | ✅ | ⬜ pending |
| 6-02-01, 6-02-02 | 06-02 | 1 | OSYNC-01, OSYNC-02 | T-06-06, T-06-07, T-06-08 | Lookup mapping: S3 -> cancelled, S4 -> removed, S5/S5b -> present; other 404 / 5xx / timeout / non-UTC -> unknown; 401 -> one refresh + retry, twice -> reconnect; 429 -> throttled + Retry-After, no retry; id rawurlencoded; Prefer header; config block without env | PHP unit (local, Http::fake) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/GraphEventLookupTest.php tests/Unit/Microsoft365/GraphCalendarClientTest.php` | ❌ W0 (6-02-01) | ⬜ pending |
| 6-03-01 | 06-03 | 1 | OSYNC-01..03 (D-13) | T-06-09 | 47 en/es keys (177 labels), lang parity; defensive parse of out_of_sync / auto_adjusted / moved_from / sync auto_adjusted; reason text same-week vs cross-week, 12/24 h | Vitest + PHP unit (local) + PHP feature | `npx vitest run resources/js/m365/calendar/meetingsApi.test.ts resources/js/m365/calendar/syncFlagReason.test.ts`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php`; CI `--filter OutlookCalendarPropTest` | ❌ W0 (syncFlagReason.test.ts) / ✅ extend | ⬜ pending |
| 6-03-02, 6-03-03 | 06-03 | 1 | OSYNC-03 | T-06-10 | keep / adjust / move calls and error mapping (404/409 stale, 422 message, 403 forbidden); aria-describedby helper; amber contrast rows ≥ 3:1 | Vitest | `npx vitest run resources/js/m365/calendar/conversionApi.test.ts resources/js/m365/calendar/describeBlock.test.ts resources/js/branding/contrast.test.ts` | ❌ W0 (describeBlock.test.ts) / ✅ extend | ⬜ pending |
| 6-04-01 | 06-04 | 2 | OSYNC-02 | T-06-11, T-06-13, T-06-14 | Updater contract (signature, route name, check-organization-blocked); job context sets and forgets the user (also when core throws); HTTP context refuses another user; entry's organization; blocked org refused; only start/end change | PHP unit (local) + PHP feature | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php`; CI `--filter CoreTimeEntryUpdaterTest` | ❌ W0 (6-04-01) | ⬜ pending |
| 6-04-02, 6-04-03 | 06-04 | 2 | OSYNC-02 | T-06-12 | Stale observation skipped (Pitfall 1); overlap / blocked org -> flag moved; release moves the cached meeting row (Pitfall 5); busy lock skips; out-of-window, released, detached, reassigned links untouched; never deletes; counts-only log | PHP feature | CI `--filter OutOfSyncApplierTest` | ❌ W0 (6-04-02) | ⬜ pending |
| 6-05-01, 6-05-02, 6-05-03 | 06-05 | 2 | OSYNC-01, OSYNC-02 | T-06-15, T-06-16, T-06-17, T-06-18 | Absent linked id of a complete window -> lookup -> removed flag; lookup 5xx / partial window -> nothing; moved out of window via lookup -> auto adjust; cancelled sighting -> flag + subject still scrubbed; edited -> flag moved; started moved -> released; started cancelled -> nothing; subject-only -> nothing; D-17 auto clear; throttled lookup persists back-off; budget 5; failed traversal applies nothing; sync answer auto_adjusted | PHP feature | CI `--filter OutlookOutOfSyncSyncTest` | ✅ extend (6-01-01) | ⬜ pending |
| 6-06-01, 6-06-02, 6-06-03 | 06-06 | 2 | OSYNC-01..03 | T-06-19, T-06-20, T-06-21, T-06-22 | out_of_sync items of the whole window (current org, 60 days, active, owned, cap 200, no subject / graph id); empty under impersonation / no account / disconnected, served in reconnect; only active links hide a meeting; moved_from for released links (own, live, current org, latest); auto_adjusted 7 days in range; resource 14 keys; constant query count | PHP feature | CI `--filter OutlookOutOfSyncReadTest`, `--filter OutlookMeetingEndpointTest`, `--filter OutlookMeetingPrivacyTest`, `--filter OutlookMeetingSuggestionTest` | ❌ W0 (6-06-01) / ✅ extend | ⬜ pending |
| 6-07-01, 6-07-02, 6-07-03 | 06-07 | 2 | OSYNC-01..03 | T-06-23, T-06-24, T-06-25 | Context flags / panel request / keep / adjust / delete (core API) / move with toasts, announcements, stale and failure results; inert without canAct; hook options; jump in place, via navigator, 3 s counter fallback, jumpBusy; auto-adjust announcement after a sync | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts` | ✅ extend | ⬜ pending |
| 6-08-01, 6-08-02 | 06-08 | 3 | OSYNC-03 | T-06-26, T-06-27, T-06-28, T-06-31 | Keep re-baselines a moved flag (D-16, no re-flag) and detaches cancelled / removed; adjust through core with stored target, body ignored, core refusal keeps the flag, all-day / non-moved 404; 404 for foreign / unknown / settled ids, impersonation and disconnect; throttles; core DELETE cascades the link; route count 11 with `entry` parameter; prop urls | PHP feature | CI `--filter OutlookOutOfSyncActionTest`, `--filter OutlookMeetingPrivacyTest`, `--filter OutlookCalendarPropTest` | ❌ W0 (6-08-01) / ✅ extend | ⬜ pending |
| 6-08-03 | 06-08 | 3 | OSYNC-01 | T-06-29, T-06-30 | Create on a released meeting -> second entry and link, old entry untouched; move-entry moves the latest released link's entry and reactivates the link; 'existing' with an active link; 404 for foreign / gone / other-org / reassigned; 403 non-member; blocked org; body ignored | PHP feature | CI `--filter OutlookMovedMeetingTest` | ❌ W0 (6-08-03) | ⬜ pending |
| 6-09-01, 6-09-02 | 06-09 | 3 | OSYNC-01, OSYNC-02 | T-06-32, T-06-33, T-06-35, T-06-36 | Command fans out only to connected users without back-off and with links (dry run sends nothing; counts-only output); job looks up active links in the window, least recently checked first, cap 300, stops on throttle (back-off persisted) / reconnect / unknown, releases itself while backed off, releases started moved meetings and moves their cached row, flags cancelled / removed; Auth::user() null after; not blocked by GraphAccessGuard (A1); schedule '30 5 * * *' Europe/Madrid withoutOverlapping, filtered when unconfigured | PHP feature | CI `--filter OutlookOutOfSyncJobTest`, `--filter OutlookOutOfSyncScheduleTest` | ❌ W0 (6-09-01, 6-09-02) | ⬜ pending |
| 6-09-03 | 06-09 | 3 | OSYNC-01 (D-20) | T-06-34 | SOLIDTIME_MICROSOFT_* on scheduler and queue via `${VAR:-}` only | grep + docs gate | `test "$(grep -c 'SOLIDTIME_MICROSOFT_' docs/deploy/dokploy-compose.fork.yml)" = "21" && node tests/Tools/m365-spike/validate-docs.mjs secrets` | ✅ | ⬜ pending |
| 6-10-01, 6-10-02, 6-10-03 | 06-10 | 3 | OSYNC-01..03 | T-06-37, T-06-38 | Marker only for flagged ids with canAct, reason title, aria-describedby, pointerdown / click isolated from the block; badge auto-adjust note (7 days) and data-auto-adjusted; "Review Outlook change" menu item; "Move my entry here" menu item with date hint and pending | Vitest | `npx vitest run resources/js/m365/calendar/OutlookSyncFlagMarker.test.ts resources/js/m365/calendar/OutlookEntryBadge.test.ts resources/js/m365/calendar/OutlookEntryMenuItems.test.ts resources/js/m365/calendar/OutlookMeetingContextItems.test.ts` | ❌ W0 (marker, menu items) / ✅ extend | ⬜ pending |
| 6-11-01, 6-11-02, 6-11-03 | 06-11 | 3 | OSYNC-02, OSYNC-03 | T-06-39, T-06-40, T-06-41 | Popover per kind (Adjust hidden for all-day), two-step delete (one click never deletes), loading / failure / stale / focus / Esc layering, counter anchor with not-in-view line, re-anchor | Vitest | `npx vitest run resources/js/m365/calendar/OutlookSyncFlagPanel.test.ts` | ❌ W0 (6-11-01) | ⬜ pending |
| 6-12-01, 6-12-02 | 06-12 | 3 | OSYNC-01 | T-06-42, T-06-43 | D-03 moved block in the panel (Create stays default), move from the panel with focus and alert, hover note, aria suffix, data-moved-from, pending block for menu moves | Vitest | `npx vitest run resources/js/m365/calendar/OutlookMovedMeeting.test.ts resources/js/m365/calendar/OutlookGhostDetail.test.ts resources/js/m365/calendar/OutlookMeetingHoverCard.test.ts resources/js/m365/calendar/OutlookGhostLayer.test.ts` | ❌ W0 (OutlookMovedMeeting.test.ts) / ✅ extend | ⬜ pending |
| 6-13-01, 6-13-02 | 06-13 | 3 | OSYNC-02 | T-06-44 | "N out of sync" (1 vs many, aria, tooltip), hidden at 0 / without canAct, jump on click with aria-busy, placement in connected / reconnect / hook mode | Vitest | `npx vitest run resources/js/m365/calendar/OutlookSyncFlagCounter.test.ts resources/js/m365/calendar/OutlookCalendarControls.test.ts` | ❌ W0 (6-13-01) / ✅ extend | ⬜ pending |
| 6-14-01, 6-14-02 | 06-14 | 4 | OSYNC-02, OSYNC-03 (D-13) | T-06-45, T-06-46 | Two additive core seams (entry-menu slot, goToDate) and Calendar.vue fills; ledger Phase 6 section; CalendarDayColumn / FullCalendarEventContent untouched | Vitest + type-check + grep | `npx vitest run resources/js/packages/ui/src/FullCalendar resources/js/m365 && npm run type-check` | ✅ | ⬜ pending |
| 6-15-01, 6-15-02, 6-15-03 | 06-15 | 5 | OSYNC-01..03 | T-06-47 | Browser: marker click opens the review not the edit modal; adjust and keep via page.route; confirmed delete via the real core API with the counter going to 0; jump to another week without reload; entry menu review; Move my entry here and a second entry on a D-03 meeting | Playwright (CI) | CI `e2e/outlook-out-of-sync.spec.ts`; local `npx playwright test e2e/outlook-out-of-sync.spec.ts --list --project=chromium` | ❌ W0 (6-15-01) | ⬜ pending |
| 6-16-01, 6-16-02, 6-17-01, 6-17-02 | 06-16, 06-17 | 6, 7 | OSYNC-01..03 | T-06-48, T-06-49, T-06-50, T-06-51, T-06-52 | Release sha green in all ten workflows (≥ 135 Microsoft365 PASS lines); ledger reconciled; compose pinned; public checks after the orchestrator's deploy (D-15); runbook row; STATE updated | CI + public HTTP | ten-workflow gate on R; `curl` checks of 06-17 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**E2E note:** CI runs with the integration off. Flags (`outOfSync`), auto-adjusts and D-03 meetings (`moved_from`) are injected through the test hook; `page.route()` answers the keep, adjust, move-entry and convert URLs by performing the real core calls; delete uses the real core API. Server behaviour stays covered by PHPUnit.

---

## Wave 0 Requirements

Each Wave 0 file is created by the task that first needs it (no separate stub wave):

- [ ] `tests/Unit/Microsoft365/OutOfSyncRulesTest.php` — OSYNC-01/02 rules matrix (pure, local) — 06-01 Task 2
- [ ] `tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php` — tracer + sync matrix — 06-01 Task 1, extended by 06-05
- [ ] `tests/Unit/Microsoft365/GraphEventLookupTest.php` — lookup mapping with the S3/S4/S5/S5b fixtures (local) — 06-02 Task 1
- [ ] `tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php`, `tests/Feature/Microsoft365/CoreTimeEntryUpdaterTest.php`, `tests/Feature/Microsoft365/OutOfSyncApplierTest.php` — 06-04
- [ ] `tests/Feature/Microsoft365/OutlookOutOfSyncReadTest.php` — 06-06 Task 1
- [ ] `tests/Feature/Microsoft365/OutlookOutOfSyncActionTest.php`, `tests/Feature/Microsoft365/OutlookMovedMeetingTest.php` — 06-08
- [ ] `tests/Feature/Microsoft365/OutlookOutOfSyncJobTest.php`, `tests/Feature/Microsoft365/OutlookOutOfSyncScheduleTest.php` — 06-09
- [ ] Shared helpers stay inside each test class (`linkedEntry()`, `graphEvent()`, fixture-to-response), copied from the 06-01 test: no change to `tests/Feature/Microsoft365/Support/` (avoids same-wave conflicts)
- [ ] `resources/js/m365/calendar/syncFlagReason.test.ts`, `describeBlock.test.ts` (06-03), `OutlookSyncFlagMarker.test.ts`, `OutlookEntryMenuItems.test.ts` (06-10), `OutlookSyncFlagPanel.test.ts` (06-11), `OutlookMovedMeeting.test.ts` (06-12), `OutlookSyncFlagCounter.test.ts` (06-13)
- [ ] `e2e/outlook-out-of-sync.spec.ts` — 06-15 Task 1
- [ ] Update hard-coded counts and shapes: labels 130 → 177 (3 places, 06-03); empty-read exact JSON (5 places) + top-level keys + resource keys 13 → 14 (06-06); route count 8 → 11 with the `entry` parameter (06-08); prop urls scoped assertion (06-08)
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto adjust of an unedited future entry after a real Outlook move | OSYNC-02 | Real Graph change on a real mailbox | Owner UAT after deploy (06-17 human check 1) |
| Flags for an edited entry, a cancelled meeting and a deleted / declined meeting; Keep / Adjust / Delete | OSYNC-02, OSYNC-03 | Series cancellations (A4) and organizer deletes (A5) were not captured in Phase 1 | Owner UAT (06-17 human check 2) |
| Started meeting dragged to another day: no flag, resurfaces, Move my entry here / Create | OSYNC-01 | Owner's "second session" scenario on real data | Owner UAT (06-17 human check 3) |
| Daily check keeps the counter right for unopened weeks | OSYNC-01 (D-11) | Needs the production scheduler and a night | Orchestrator post-deploy: `schedule:list` + `--dry-run`; owner sees the counter next morning |
| Layout backstops (title row with two icons, toolbar with counter, Spanish popover) | UI-SPEC backstops | Visual judgement | Owner UAT at 1366x768 and 1024px, en/es, light/dark (06-17 human check 6) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (JS / PHP unit) / one CI cycle (PHP feature, Playwright)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
