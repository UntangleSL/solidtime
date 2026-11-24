---
phase: 06-out-of-sync-detection
plan: 10
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, time-entries, routes, d-03, d-16]
status: complete
requires: [06-05, 06-06]
provides:
  - "POST /m365/out-of-sync/{entry}/keep (microsoft.meetings.out-of-sync.keep)"
  - "POST /m365/out-of-sync/{entry}/adjust (microsoft.meetings.out-of-sync.adjust)"
  - "POST /m365/organizations/{organization}/meetings/{meeting}/move-entry (microsoft.meetings.move-entry)"
  - "Active-only MeetingConversionController::linkOf(): a released occurrence converts again"
  - "Calendar prop urls.out_of_sync and urls.organization_meetings"
affects: [06-12, 06-13, 06-14]
requirements-completed: [OSYNC-01, OSYNC-03]
key-files:
  created:
    - app/Microsoft365/Http/Controllers/OutOfSyncController.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncActionTest.php
    - tests/Feature/Microsoft365/OutlookMovedMeetingTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/MeetingConversionController.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php
    - tests/Feature/Microsoft365/OutlookCalendarPropTest.php
decisions:
  - "Keep on an all-day moved flag detaches the link (like cancelled/removed) instead of re-baselining: the rules only accept a timed sighting as 'at the recorded slot', so an all-day snapshot would re-flag the same move on every sync"
  - "move-entry only takes a released link whose entry has an end (same condition as the read's moved_from); a running timer is never stopped by it"
  - "move-entry unique-index race with no winner of the user answers 409 (client treats 404/409 as stale)"
completed: 2026-11-24
actuals:
  tasks: 3
  commits: 4
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
---

# Phase 6 Plan 10: Out-of-sync actions and "Move my entry here" Summary

Keep as is, Adjust to Outlook and "Move my entry here" as session-only web routes under /m365. All three go through core's update path, take the target from server-side data only, and answer a plain 404 for anything that is not the user's own. The conversion's `linkOf()` now only sees active links, so a released meeting can get a second entry.

## What was built

- **`OutOfSyncController`** (constructor-injected `GraphAccessGuard`):
  - `keep()`: a timed moved flag re-baselines (snapshot := Outlook slot, D-16). A cancelled, removed or all-day moved flag detaches the link. Both clear the flag and stamp `last_checked_at`. The entry is never touched.
  - `adjust()`: only for a timed moved flag (anything else is a 404, D-18). It calls `CoreTimeEntryUpdater::updateTimes()` with the stored Outlook slot, then re-baselines and clears the flag in the same transaction. Core refusals pass through unchanged (422 validation, 403, ApiException 400 for an overlap or a blocked organization), and the rollback keeps the flag.
  - `moveEntry()`: 404 while impersonating or disconnected, then the membership check (403). Inside one transaction it locks the user's own non-gone meeting row. An active owned link answers `existing`; a stale active link is dropped. Otherwise it takes the latest released link whose entry is live, owned, ended and in `{organization}`, moves that entry through core to the meeting's slot, and reactivates the link (released_at and detached_at null, snapshot = slot, flag cleared, last_checked_at). If the unique index loses a race, the answer is the winner's entry, or a 409 when the winner's entry is not the user's.
  - Shared lookup: the link must have the user's `user_id`, be active and flagged, and its entry must still exist with `user_id` = the session user, under `lockForUpdate`. Impersonation, a missing account and `not_connected` all return a 404. A reconnect-state account can still act, matching the read.
- **Routes** (inside the existing m365 web group, never under /api): keep and adjust use `whereUuid('entry')` and `throttle:60,1,m365-osync:`; move-entry uses `whereUuid(['organization','meeting'])` with `['check-organization-blocked', 'throttle:30,1,m365-move:']`.
- **`MeetingConversionController::linkOf()`** adds `->whereNull('released_at')` (RESEARCH Pattern 3). A released occurrence converts into a second entry with a second, active link. Converting an active occurrence twice still yields one entry (Phase 4 D-06).
- **Calendar prop**: `urls.out_of_sync` = `url('m365/out-of-sync')` and `urls.organization_meetings` = `url('m365/organizations/{current team}/meetings')`, or null without a current team. The array-shape docblock is updated.
- **Tests**:
  - `OutlookOutOfSyncActionTest`, 14 tests: keep re-baseline / no re-flag / later move detected, detach for cancelled and removed, all-day keep, keep scoping, adjust through core with project/tags/billable/description kept and recalculation dispatched, body ignored, overlap and blocked refusals, 422 passthrough, D-18 404s, adjust scoping, impersonation / disconnect / no-account 404s, reconnect state allowed, route middleware, core DELETE cascade.
  - `OutlookMovedMeetingTest`, 12 tests: second entry plus a double convert, move, existing, latest released link wins, access 404s (foreign, unknown, gone, never logged, deleted, reassigned, other organization, running timer), impersonation and disconnect, 403 outside the organization, blocked organization, core overlap refusal, body ignored, unique race, route.
  - Privacy route count changed from 8 to 11, with the allowed parameters now `meeting`, `organization` and `entry`.
  - Prop test: the five URL keys in `hasAll`, a check that the client-built URLs equal the named routes, and the null case without a current team.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 43b13586 | feat(06-10): keep a flagged entry as is (re-baseline a moved flag, detach the rest) |
| 2 | 41c7a9a6 | feat(06-10): adjust a flagged entry to Outlook through core, calendar action URLs |
| 3 | 4f4e70e1 | feat(06-10): move my entry to a moved meeting's new slot, second entry for released links |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Keep on an all-day moved flag detaches instead of re-baselining**
- **Found during:** Task 1
- **Issue:** `OutOfSyncRules` rule 3 counts a sighting as "at the recorded slot" only when it is timed. If the snapshot were an all-day slot, the next all-day sighting would land in rule 5c and flag the same move again, which breaks D-16 ("the same move never flags again").
- **Fix:** `keep()` re-baselines only timed moved flags. All-day moved flags detach, like cancelled and removed ones. Covered by `test_keep_on_an_all_day_moved_flag_detaches_the_link`.
- **Files:** app/Microsoft365/Http/Controllers/OutOfSyncController.php
- **Commit:** 43b13586

**2. [Rule 2 - Missing correctness] move-entry requires the released entry to have an end**
- **Found during:** Task 3
- **Issue:** Moving a running timer would quietly stop it. The read's `moved_from` already serves only ended entries.
- **Fix:** The released-link lookup requires `time_entries.end IS NOT NULL`; anything else is a 404 (tested).
- **Commit:** 4f4e70e1

**3. [Rule 2] move-entry clears a dismissal like a conversion does** (Phase 4 D-11 parity). Without it, a later release would bring the meeting back in the dismissed state. Commit 4f4e70e1.

### Notes
- The privacy test counts 11 routes and the prop test resolves `microsoft.meetings.move-entry` as of commit 41c7a9a6 (Task 2, as the plan places them). Both routes exist only from 4f4e70e1, so the tests pass only on the final head. CI runs only after the merge, so this has no effect.

## Gates

- Pint `--test` on app/Microsoft365 and the five test files: passed.
- PHPStan (full app, worktree-first autoload `wt-autoload-ab70.php`): no errors.
- DB-free unit PHPUnit `tests/Unit/Microsoft365`: 284 tests. The only failures are the 12 known local-only `SocialiteMicrosoftGatewayTest` OpenSSL failures.
- `git diff 7bcb5562 -- openapi.json routes/api.php`: empty.
- Feature PHPUnit (`OutlookOutOfSyncActionTest`, `OutlookMovedMeetingTest`, `OutlookMeetingPrivacyTest`, `OutlookCalendarPropTest`, `OutlookMeetingConversionTest`): pending in CI (orchestrator). They need Postgres.

## Known Stubs

None.

## Threat Flags

None. All new surface is the planned T-06-26..T-06-31 register, and each item is mitigated as planned.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Http/Controllers/OutOfSyncController.php
- FOUND: tests/Feature/Microsoft365/OutlookOutOfSyncActionTest.php
- FOUND: tests/Feature/Microsoft365/OutlookMovedMeetingTest.php
- FOUND: commits 43b13586, 41c7a9a6, 4f4e70e1 on HEAD
