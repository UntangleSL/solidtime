---
phase: 03-outlook-meetings-in-the-calendar
plan: 11
subsystem: privacy
tags: [outlook, privacy, impersonation, disconnect-purge, laravel, filament-impersonate]
status: complete

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: MicrosoftTokenService (03-03), OutlookMeetingSyncService (03-04), OutlookMeetingController read/sync/dismiss/restore (03-04, 03-09), ShareMicrosoftInertiaData calendar block (03-06, 03-08)
provides:
  - GraphAccessGuard, the single fail-closed impersonation check
  - Impersonation handling in the token service, sync service, meetings endpoints and calendar prop
  - Disconnect purge of outlook_meetings and outlook_sync_windows (D-21)
  - OutlookMeetingPrivacyTest, the CAL-03 / D-21 / D-22 privacy and leak matrix
affects: [04-assign-to-project, 07-security-hardening]

actuals:
  tokens: 11000
  tasks: 2
  commits: 2
  plan_head_before: ec8d9ae6b7eba5689195b9a9d16599cc413fd077
  plan_head_after: 8198fbf3bd54c4abc91c423a142d24eca65266c1

tech-stack:
  added: []
  patterns:
    - "One class (GraphAccessGuard) knows about impersonation; every Outlook surface asks it, so the rule cannot drift"
    - "Fail closed: an exception while reading the impersonation state counts as blocked"
    - "Impersonation answers like a foreign id (404) so there is no existence oracle"

key-files:
  created:
    - app/Microsoft365/Graph/GraphAccessGuard.php
    - tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php
  modified:
    - app/Microsoft365/Graph/MicrosoftTokenService.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Controllers/MicrosoftAccountController.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php
    - tests/Feature/Microsoft365/OutlookMeetingDismissTest.php
    - tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php

key-decisions:
  - "While impersonating: GET /m365/meetings answers an empty list, sync answers not_connected, dismiss and restore answer 404, the calendar prop block is omitted, and MicrosoftTokenService::accessToken throws NotConnected before it reads or locks the row"
  - "GET /m365/meetings answers an empty list for no link or a disconnected link; a reconnect-state account still serves its last known meetings"
  - "Disconnect deletes the user's meetings and sync windows in the existing transaction, also when no link row exists; the identity row stays (Phase 2 D-19)"

requirements-completed: [CAL-03, CAL-01]

duration: about 1h
completed: 2026-11-10
---

# Phase 3 Plan 11: Privacy edges of the meeting overlay Summary

**An impersonating admin never sees a user's Outlook meetings and never causes a Graph call with that user's token (single GraphAccessGuard choke point), Disconnect purges the cached meetings, sync windows and dismissals, and a 14-test privacy matrix covers roles, time entries, reports, logs, audits and admin screens.**

## Performance

- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto)
- **Commits:** 2 (measured from the plan ledger: `ec8d9ae6..8198fbf3`)

## Accomplishments

- `GraphAccessGuard::blocked()` reads `ImpersonateManager::isImpersonating()` per call (Octane safe) and fails closed. It is the only file in `app/Microsoft365` that mentions impersonation.
- `MicrosoftTokenService::accessToken()` refuses first, so no refresh and no Graph request can carry the impersonated user's token; `OutlookMeetingSyncService::sync()` returns `not_connected` before any query, lock or request.
- `OutlookMeetingController`: read answers the empty payload, dismiss and restore answer 404 while blocked. `ShareMicrosoftInertiaData` omits `microsoft.calendar` (no Sync, Connect, Reconnect, toggle or ghost layer).
- Read endpoint answers an empty list for a user with no link or a disconnected link (reconnect keeps the cache).
- `MicrosoftAccountController::destroy()` deletes the user's `outlook_meetings` and `outlook_sync_windows` rows in the same transaction that nulls the tokens (D-21), including the no-link-row branch.
- `OutlookMeetingPrivacyTest` (14 tests): impersonation matrix (read, sync, dismiss, restore, token service, sync service, calendar prop), disconnect purge (with another user's rows untouched, and without a link row), reconnect refetch without old dismissals, no-link / disconnected / reconnect reads, owner/admin/manager/employee isolation with `user_id` / `member_id` parameters and cross-user dismiss/restore 404, time entries untouched across sync / dismiss / restore / failing sync / disconnect, aggregate and listing JSON identical before and after a sync (`test_reports_and_time_entry_listing_are_identical_before_and_after_a_meetings_sync`), log leak search (tokens, client secret, token description, fixture subjects, organizer names, `@odata`, links), models not auditable and absent from `app/Filament`, no meetings route with a user parameter.

## Task Commits

1. **Task 1 (tracer): impersonation guard** - `09ad10f6` (guard, token service, sync service, controller, shared prop, privacy test file)
2. **Task 2: Disconnect purge and test fixes** - `8198fbf3` (account controller purge, endpoint and dismiss tests, fixture trait)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing tests read cached meetings for users without a linked account**
- **Found during:** Task 2
- **Issue:** The new rule "no usable link means an empty list" (plan Task 2 step 2) made `OutlookMeetingEndpointTest` (5 tests) and `OutlookMeetingDismissTest` (4 tests) read an empty list, because they seed meetings for users that have no `microsoft_accounts` row.
- **Fix:** Those tests now call `connectedAccount($user)` before reading. The multi-user role test needs distinct Microsoft object ids (unique per tenant and object), so `InteractsWithGraphFixtures::connectedAccount()` got an optional `?string $objectId = null` third parameter (default unchanged).
- **Files modified:** `tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php`, `OutlookMeetingDismissTest.php`, `Support/InteractsWithGraphFixtures.php` (outside the plan's file list; test-only, required to keep Gate B green)
- **Commit:** `8198fbf3`

**2. [Environment] Worktree base and vendor**
- The worktree started on an upstream commit (`b46f0157`) with no commits of mine; reset to `ec8d9ae6` as instructed. Directory junctions are blocked by the agent sandbox (`mklink`, PowerShell and `ln -s` all refused), so `vendor/` was copied (gitignored, never committed) instead of junctioned.

None of the plan's behaviors were changed.

## Local gates (actual results)

- Pint (`vendor/bin/pint app/Microsoft365 tests/Feature/Microsoft365`): `{"tool":"pint","result":"passed"}`
- Full-app PHPStan (`phpstan analyse --configuration=phpstan.neon`, memory 2G): `[OK] No errors`
- PHPUnit was not run locally (the host has no Postgres; it runs in CI). Test correctness was reviewed by reading against existing tests; CI is the first execution.
- CI: deferred to orchestrator combined gate (wave 9). Gate B classes: OutlookMeetingPrivacyTest, MicrosoftAccountTest, OutlookCalendarPropTest, OutlookMeetingEndpointTest, MicrosoftTokenRefreshTest (expect 15). Because I also changed `OutlookMeetingEndpointTest` and `OutlookMeetingDismissTest`, those two classes should be watched in the same run.

## Acceptance greps (all as specified)

`isImpersonating` appears on 1 line in the guard and in 1 file under `app/Microsoft365`; `blocked()` is used in the token service and the shared-data middleware; 14 `test_` methods; `OutlookMeeting::query()` and `OutlookSyncWindow::query()` appear once each in `MicrosoftAccountController`; 0 files mention `TimeEntry` / `time_entries` in the account controller, the meeting controller or `Graph/`; 0 Filament references; 0 `Auditable` in `app/Microsoft365`.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: oauth-during-impersonation | app/Microsoft365/Http/Controllers/MicrosoftAuthController.php, app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php (profile `account` block) | The profile page still shares `connect_url` and `disconnect_url`, and `microsoft.redirect?intent=connect` is not blocked while impersonating. An admin impersonating a user could therefore start a Microsoft connect for that user or disconnect (and purge) their data. Outside this plan's file list and the plan's calendar-only scope; to be closed by Phase 7 SEC-04 (block connect/disconnect while `GraphAccessGuard::blocked()`). |
| threat_flag: disconnect-sync-race | app/Microsoft365/Http/Controllers/MicrosoftAccountController.php | A sync that already holds a token when Disconnect runs could re-insert meetings after the purge. They stay invisible (read answers empty without a usable link) and are purged by the next Disconnect; not mitigated here. |

## Requirements

CAL-03 (meetings visible only to their owner, every role and during impersonation) and CAL-01 (no meeting data in reports or time-entry listings, no Phase 3 path touches time entries) are fully delivered by this plan on the backend side. CI has not yet confirmed the new tests; that is the orchestrator's combined gate.

## Self-Check: PASSED

- Files exist: `app/Microsoft365/Graph/GraphAccessGuard.php`, `tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php`
- Commits exist on the branch: `09ad10f6`, `8198fbf3`

## CI result (orchestrator combined gate, wave 9)

Nine workflows green at 7cab2150 (after test-only fix 7cab2150 for OutlookMeetingPrivacyTest guard switch); all 24 Microsoft365 feature classes PASS x3 Postgres.
