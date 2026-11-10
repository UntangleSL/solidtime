---
phase: 03-outlook-meetings-in-the-calendar
verified: 2026-11-10T14:10:00Z
status: passed
score: 5/5 must-haves verified
covered_files:
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-01-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-01-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-02-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-02-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-03-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-03-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-04-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-04-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-05-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-05-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-06-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-06-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-07-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-07-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-08-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-08-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-09-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-09-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-10-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-10-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-11-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-11-SUMMARY.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-12-PLAN.md"
  - ".planning/phases/03-outlook-meetings-in-the-calendar/03-12-SUMMARY.md"
  - "app/Microsoft365/Graph/GraphAccessGuard.php"
  - "app/Microsoft365/Graph/GraphCalendarClient.php"
  - "app/Microsoft365/Graph/MicrosoftTokenService.php"
  - "app/Microsoft365/Graph/OutlookMeetingEligibility.php"
  - "app/Microsoft365/Graph/OutlookMeetingSyncService.php"
  - "app/Microsoft365/Http/Controllers/OutlookMeetingController.php"
  - "app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php"
  - "app/Microsoft365/routes/microsoft365.php"
  - "e2e/outlook-ghosts.spec.ts"
  - "resources/js/Pages/Calendar.vue"
  - "resources/js/m365/calendar/OutlookGhostLayer.vue"
  - "resources/js/m365/calendar/ghostLayout.ts"
  - "resources/js/m365/calendar/useOutlookMeetings.ts"
  - "resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue"
  - "resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue"
  - "resources/js/packages/ui/src/FullCalendar/useSlotSelection.ts"
covered_digest: "v3:sha256:4853f4de6686cbd9f388fcc90af8bbc7e60090a3d976fe4b616edad50286c75c"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Real week incl. DST (SYNC-03, SYNC-04): on production, open /calendar as a Microsoft-connected user on a week with a recurring meeting (ideally crossing a DST change) and compare with Outlook"
    expected: "Ghost blocks sit at the same local times as in Outlook, look distinct from time entries; private, cancelled, all-day and declined items are absent; day/week totals unchanged"
    why_human: "Needs a real mailbox and a real week; automated proof uses Phase 1 fixtures (S2 08:00Z/09:00Z both 10:00 Europe/Madrid) only"
  - test: "Sync twice + navigation (SYNC-02, SYNC-05): press Sync Outlook twice quickly, then navigate several weeks back and forth"
    expected: "One Graph traversal per week, status 'Last synced HH:MM', no error, button cools down about 10 s, time entries never wait for it"
    why_human: "Real Graph latency and throttling behaviour; UX feel"
  - test: "Dismiss / Show dismissed / Restore (CAL-04): open a ghost, Dismiss; in calendar settings turn on 'Show dismissed meetings'; Restore"
    expected: "Ghost disappears at once, returns faded with the switch on, becomes normal after Restore; reload keeps the state"
    why_human: "End-to-end against production data and real browser focus/visual behaviour"
  - test: "Entra revocation -> Reconnect (SEC-02): revoke the test user's sessions in the Entra admin center, wait a few minutes, open /calendar and press Sync"
    expected: "'Reconnect Microsoft' replaces Sync with no error banner; clicking it completes the Microsoft flow and lands back on /calendar with the meetings"
    why_human: "Requires real token revocation / Conditional Access; the unit proofs fake the token endpoint"
  - test: "Connect from a password-only (or disconnected) user (D-09): open /calendar and click 'Connect Microsoft 365'"
    expected: "After the Microsoft flow the user lands on /calendar with a success notice and the meetings load"
    why_human: "Real Entra round trip"
  - test: "Second account + impersonation (CAL-03, D-22): sign in as the second non-admin tenant account; then as admin impersonate that user (Filament) and open /calendar"
    expected: "Each account sees only its own meetings; while impersonating, no Outlook controls or ghosts appear"
    why_human: "Needs two real accounts; privacy of real mailbox data cannot be proven from fixtures"
---

# Phase 3: Outlook Meetings in the Calendar - Verification Report

**Phase Goal:** As a team member tracking time, I want to see my Outlook meetings as suggestions in the solidtime calendar, so that I can see which meetings still need logging without switching to Outlook.
**Verified:** 2026-11-10T14:10:00Z
**Status:** human_needed
**Re-verification:** No - initial verification
**Branch/HEAD:** feature/m365-integration @ f18468d7 (release sha 22fbbabecc3f75d4b2be1419933d51e5bbd0030b; only docs/compose changed after it)

Every automatable truth is verified in code and CI. The only open items are the six real-tenant owner UAT checks, which were never done. No code gap was found.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Calendar shows time entries first, then Outlook ghosts at correct local times incl. DST; Sync button refreshes; repeated presses / fast navigation cause no errors or throttling | VERIFIED (automated); real-tenant DST pending UAT | `resources/js/Pages/Calendar.vue` calls `useOutlookMeetings(...)` and keeps `:loading` bound to the time-entry query only; meetings are a separate TanStack query (`useOutlookMeetings.ts`, `enabled` gated, `retry:false`, no refocus refetch). Cache-only GET never calls Graph (`OutlookMeetingController::index`). UTC stored (`OutlookMeetingSyncService::parseGraphUtc`, non-UTC skipped), local wall-clock layout (`ghostLayout.ts`), week buckets via `localDateToUtc`. Debounce 400 ms, single-flight latest-wins, 10 s cooldown, 60 s server reuse window, 10 s forced minimum interval, per-user lock (`Cache::lock`), route throttles `m365-read:`/`m365-sync:`. Vitest m365: 8 files / 149 tests pass locally (rerun by me); tests include 'keeps local midnights across the DST change in Europe/Madrid' and 'S2 occurrences render at 10:00 Europe/Madrid across DST'. PHPUnit `OutlookSyncResilienceTest`, `OutlookMeetingSyncTest` pass in CI x3. |
| 2 | All timed meetings regardless of response status appear (incl. personal blocks without attendees); declined, cancelled, all-day, private/confidential never appear | VERIFIED | `OutlookMeetingEligibility::isEligible` fails closed: `isCancelled !== false`, `isAllDay !== false`, `sensitivity !== 'normal'`, residual `declined` all rejected; any other response status eligible. Filter runs before a row is built (subject of ineligible events never stored); previously cached rows that turn ineligible are gone-marked and scrubbed (`scrubIneligible`); unseen rows only gone after a complete traversal. Graph `$select`/`Prefer` (UTC + ImmutableId on every page incl. nextLink, host-checked) in `GraphCalendarClient`. `OutlookMeetingEligibilityTest` (scenario verdicts incl. `other_response_statuses_stay_eligible`), `GraphCalendarClientTest`, `OutlookMeetingSyncTest` pass in CI. (`personal` sensitivity is also excluded, fail-closed per DECISIONS-graph.md; SYNC-03 names private/confidential - documented decision, not a gap.) |
| 3 | Ghosts not draggable/resizable, don't interfere with creating/editing entries, not counted in tracked time/totals/reports/exports; others never see another user's meetings | VERIFIED (automated); real second account pending UAT | Ghosts live in the `overlay` slot in a reserved right-hand lane (D-23); no `.fc-event` class, no event id; `useSlotSelection.ts` selector extended with `[data-calendar-overlay]`; core events container inset only on days with ghosts. Ghosts never touch time-entry code: `grep TimeEntry app/Microsoft365` returns nothing; `OutlookMeetingPrivacyTest::test_reports_and_time_entry_listing_are_identical_before_and_after_a_meetings_sync`, `test_phase_3_paths_never_touch_time_entries`, `OutlookMeetingSyncTest::test_sync_does_not_change_time_entries`. Owner scoping: no user-id input anywhere (`test_no_meetings_route_takes_a_user_parameter`), every query `where user_id = session user`, dismiss/restore foreign id = 404, `test_each_role_sees_only_its_own_meetings`, impersonation blocked at the single choke point (`GraphAccessGuard`, used by token service, sync service, controller, shared prop). Resource is an explicit allow-list. `e2e/outlook-ghosts.spec.ts` (5 tests: overlap/reachability, totals unchanged, click opens panel not create dialog, 5 overlapping ghosts reachable, off switch) in the all-green Playwright run (shards 144/144/143/145/145/144/143/143 passed). |
| 4 | User can dismiss a suggestion so it stops appearing, and show dismissed again to undo | VERIFIED (automated); production UAT pending | `OutlookMeetingController::dismiss`/`restore` (idempotent, uuid-validated, own rows only), `dismissed_at` excluded from the upsert update list so a resync never resurrects it (`OutlookMeetingDismissTest::test_dismissal_survives_a_resync`), `include_dismissed` read flag, optimistic UI with rollback in `useOutlookMeetings.changeDismissal`, `OutlookDismissedSetting.vue` in the ledgered `settings-extra` slot chain. 8 PHP tests + 14 Vitest cases. |
| 5 | Graph slow/down/throttled: calendar keeps working with non-blocking status; expired tokens refresh silently; unrecoverable refresh shows "Reconnect Microsoft" not an error | VERIFIED (automated); real revocation pending UAT | Timeouts 3 s connect / 8 s request / 15 s deadline, page cap, no in-request retry on 429, persisted `graph_backoff_until` honoured without Graph calls, `retry_after` surfaced by the read. Every sync outcome is HTTP 200 with a status; front end maps transport/5xx/429 to `unavailable` and keeps cached ghosts. `MicrosoftTokenService`: refresh under `lockForUpdate` with post-lock reuse, terminal errors (`invalid_grant`, `interaction_required`, `consent_required`) set `reconnect_required_at`; operator errors (`invalid_client`...) stay "unavailable"; Graph 401/403 -> one forced refresh + one retry, then Reconnect. `OutlookCalendarControls.vue` renders `outlook-reconnect-button` in the Sync position (no banner). `MicrosoftTokenRefreshTest` (18), `OutlookSyncResilienceTest` (24), `MicrosoftCalendarConnectTest` pass in CI x3. |

**Score:** 5/5 truths verified by code and CI evidence; 0 behavior-unverified (every state-transition/cancellation/ordering invariant has a named passing test: single-flight/latest-wins and cooldown in Vitest, lock/coalesce/back-off/post-lock refresh in PHPUnit). The real-tenant behaviour of truths 1, 3, 4, 5 is routed to human verification below.

### Required Artifacts (all 12 PLAN must_haves)

`gsd-tools verify.artifacts` and `verify.key-links` were run for 03-01..03-12: all_passed / all_verified true for every plan. Spot-read for substance (not stubs): `OutlookMeetingSyncService`, `GraphCalendarClient`, `MicrosoftTokenService`, `OutlookMeetingController`, `ShareMicrosoftInertiaData`, `useOutlookMeetings.ts`, `ghostLayout.ts`, `OutlookGhostLayer.vue`, both Phase 3 migrations (cascading FKs to `users` on `outlook_meetings` and `outlook_sync_windows`).

### Key Link Verification

| From | To | Status | Details |
| ---- | -- | ------ | ------- |
| `Calendar.vue` | `useOutlookMeetings` / `OutlookGhostLayer` / `OutlookCalendarControls` / `OutlookDismissedSetting` | WIRED | Imports and slot templates present (`#day-overlay`, `#toolbar-extra`, `#settings-extra`) |
| `TimeEntryCalendar.vue` -> `CalendarDayColumn.vue` | `overlay` slot + `overlayLaneWidth` | WIRED | Diff verified against the ledger |
| `CalendarToolbar.vue` / `CalendarSettingsPopover.vue` | `extra` / `settings-extra` slots | WIRED | Slot forwarded only when content exists, so no-integration render equals upstream |
| `ShareMicrosoftInertiaData` -> `microsoft.calendar` prop | `useOutlookMeetings.calendar` | WIRED | Prop only on the calendar route, omitted while impersonating, no token/meeting data (`OutlookCalendarPropTest`) |
| `routes/microsoft365.php` -> `OutlookMeetingController` | `/m365/meetings*` | WIRED | web group + `auth:web` + `auth.session` + `verified` + `EnsureMicrosoftIsEnabled`; not under `api/`; `openapi.json`/`routes/api.php` untouched |
| `OutlookMeetingSyncService` -> `MicrosoftTokenService` -> `GraphCalendarClient` | token closure per page | WIRED | `accessToken($account, $rejected)` invoked before each page |
| `MicrosoftAccountController::destroy` | purge meetings, windows, dismissals | WIRED | lines 39-40; `test_disconnect_purges_meetings_windows_and_dismissals` |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
| -------- | ------------- | ------ | --------- | ------ |
| `OutlookGhostLayer.vue` | `meetings` prop | `useOutlookMeetings.meetings` <- `fetchMeetings(GET /m365/meetings)` <- `outlook_meetings` rows <- Graph calendarView sync | Yes (test hook `__TEST_SET_OUTLOOK_MEETINGS__` only overrides when test code calls it) | FLOWING |
| `OutlookCalendarControls.vue` | status / `syncedAt` | read `sync.last_synced_at` + sync answer | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Fork JS unit tests | `npx vitest run resources/js/m365` | 8 files, 149 tests passed | PASS |
| Type check | `npm run type-check` (vue-tsc) | no errors | PASS |
| CI for release sha 22fbbab | `gh run list --commit 22fbbab...` | all ten workflows `success` | PASS |
| Microsoft365 PHPUnit | `gh run view 42806663152 --log` | 75 PASS lines = 25 classes x 3 Postgres (15/16/17), 0 FAIL, 1732 tests passed per shard | PASS |
| Playwright | `gh run view 42806663029 --log` | all 8 shards green; one firefox retry in unrelated core `e2e/profile.spec.ts:359` (flaky, passed) | PASS |
| Production liveness | `curl https://time.untangle.es/health-check/up` | 200 | PASS |
| Production off-session | `curl -H "Accept: application/json" .../m365/meetings` | 401 | PASS |
| Compose pin | `docs/deploy/dokploy-compose.fork.yml` | app, scheduler, queue pinned to `sha-22fbbab` | PASS |

PHPUnit cannot run locally (no Postgres); the CI log is the evidence. Migrations on production and the login prop `microsoft.enabled: true` are per the 03-12 deploy record (owner-approved) and were not re-probed beyond the two public curls above.

### Probe Execution

Step 7c: SKIPPED (no probes declared by Phase 3 plans).

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
| ----------- | -------------- | ------ | -------- |
| SYNC-01 | 03-01, 03-02, 03-06 | SATISFIED | Cache-only read + separate meetings query after entries; `:loading` unchanged |
| SYNC-02 | 03-04, 03-06, 03-07 | SATISFIED | Debounce/single-flight/cooldown/reuse window/lock/route throttle; tests above |
| SYNC-03 | 03-01, 03-02 | SATISFIED | Fail-closed eligibility; unit + sync tests |
| SYNC-04 | 03-01, 03-05, 03-06 | SATISFIED in code and tests; real DST week in UAT | UTC storage, wall-clock layout, Madrid DST tests |
| SYNC-05 | 03-04, 03-07 | SATISFIED | Back-off, outage, no-mailbox quiet statuses; calendar keeps cache |
| CAL-01 | 03-05, 03-06, 03-11 | SATISFIED | Distinct dashed ghosts; totals/reports tests + e2e |
| CAL-02 | 03-05, 03-06 | SATISFIED | Inert pointer handling, reserved lane, e2e reachability |
| CAL-03 | 03-02, 03-11 | SATISFIED in code and tests; real second account in UAT | Owner scoping + role matrix + impersonation guard |
| CAL-04 | 03-09, 03-10 | SATISFIED | Dismiss/restore/include_dismissed |
| SEC-02 | 03-03, 03-08 | SATISFIED in code and tests; real revocation in UAT | Silent refresh, Reconnect classification |

No orphaned requirements: REQUIREMENTS.md maps exactly these ten IDs to Phase 3, all claimed by plans.

### Cross-phase constraints

- Fork isolation / ledger: diff of `45836522..22fbbabe` outside fork paths touches exactly six core files (Calendar.vue, CalendarDayColumn.vue, CalendarSettingsPopover.vue, CalendarToolbar.vue, TimeEntryCalendar.vue, useSlotSelection.ts); each has a row in `docs/m365/TOUCHED-CORE-FILES.md` and the described seam matches the diff. PASS.
- Endpoints under `/m365/...` on web guard, not in `/api/v1`/openapi: PASS. Cascading FKs on both new tables: PASS. Gated on integration configured: PASS (`EnsureMicrosoftIsEnabled`, calendar prop omitted when not configured). Sync never writes time entries: PASS (no `TimeEntry` reference in `app/Microsoft365`). Graph requests use ImmutableId + UTC on every call incl. nextLink: PASS.

### Anti-Patterns Found

None blocking. No `TBD|FIXME|XXX|TODO|HACK`, no `console.log` in fork code or in the Phase 3 core-file diffs (the lone `TODO` in `routes/api.php:126` is upstream and untouched). `window.__TEST_SET_OUTLOOK_MEETINGS__` is a test hook present in production builds while the composable is mounted; it mirrors the existing `__TEST_SET_ACTIVITY_PERIODS__` pattern and only affects the local browser view (Info).

### Warnings (documentation state, not code gaps)

1. `.planning/REQUIREMENTS.md` marks SYNC-04 `[x]`/Complete (set in e5108ed4 at 03-01), while 03-12-SUMMARY says SYNC-04, SEC-02, CAL-03 are completed only after UAT; SEC-02 and CAL-03 are correctly still Pending. Decide whether SYNC-04 should return to Pending until the DST UAT passes.
2. `.planning/ROADMAP.md` Phase 3 checkbox is `[ ]` and `03-VALIDATION.md` is `status: draft`, `nyquist_compliant: false`, sign-off unchecked; `03-12-SUMMARY.md` has `requirements-completed: []`. Update after UAT.
3. Known Phase 7 carry-overs (from 03-12-SUMMARY, deliberately deferred): connect/disconnect URLs not blocked while impersonating (SEC-04); a sync racing a Disconnect can leave invisible rows until the next Disconnect; scheduler/queue Docker healthchecks; right-click on a ghost opens the empty-grid context menu. None affect Phase 3 success criteria. Covered by Phase 7 (hardening: impersonation guard, deletion cleanup).

### Human Verification Required

The six owner UAT checks in the frontmatter (03-12 Task 3). They are the only reason the status is `human_needed` rather than `passed`. Until done, SYNC-04, SEC-02 and CAL-03 should stay unconfirmed against real data (as 03-12 already states).

### Gaps Summary

No gaps. Every must-have is backed by code read and by green CI on the release sha; the open items are real-tenant observations that fixtures and fakes cannot prove (real DST week, real Graph throttling feel, real token revocation, real second account and impersonation).

---

_Verified: 2026-11-10T14:10:00Z_
_Verifier: Claude (gsd-verifier)_

## Owner UAT (production, 2026-11-10)

Status moved from human_needed to passed after the owner UAT below.

| # | Check | Result |
|---|-------|--------|
| 1 | Real week vs Outlook (times, eligibility, totals) | PASS. Owner compared side by side with Clockify's Outlook view: same meetings at the same local times |
| 2 | Sync twice + week navigation | PASS with UX note. Navigation updates meetings; after one press the button stays greyed out (designed 10 s cooldown, extended by each automatic navigation sync, with no visible countdown). Moved to Phase 3.1 as UX-06 |
| 3 | Dismiss / Show dismissed / Restore | PASS |
| 4 | Entra revocation -> Reconnect | PASS |
| 5 | Connect from a user without Microsoft | PASS |
| 6 | Second account + impersonation | WAIVED by the owner (impersonation is admin-only and will not be used). Covered by automated tests: OutlookMeetingPrivacyTest role matrix, impersonation guard and owner-only scoping, green x3 Postgres on the release sha |

Owner feedback captured as new scope (not Phase 3 gaps): calendar view options, meeting block contrast, hover tooltip, context-menu layering, wheel zoom/scroll, visible Sync cooldown (Phase 3.1, UX-01..06); themes, accent colour, Untangle default branding, organization icon (Phase 3.2, BRAND-01..04); create time entry from the tooltip (Phase 4, ASGN-01).
