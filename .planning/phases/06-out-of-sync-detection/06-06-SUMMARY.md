---
phase: 06-out-of-sync-detection
plan: 06
subsystem: microsoft365-read
tags: [m365, outlook, out-of-sync, calendar-read, privacy]
requires: [06-01]
provides:
  - "App\\Microsoft365\\OutOfSync\\OutOfSyncFlags (items, autoAdjusted, movedFrom)"
  - "MeetingHints::$movedFrom"
  - "OutlookMeetingResource key moved_from (14 allow-listed keys)"
  - "GET /m365/meetings: out_of_sync.items, auto_adjusted, data[].moved_from; only active links hide a converted meeting"
affects: [06-07, 06-08, 06-10]
requirements-completed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created:
    - app/Microsoft365/OutOfSync/OutOfSyncFlags.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncReadTest.php
  modified:
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Resources/OutlookMeetingResource.php
    - app/Microsoft365/Suggestions/MeetingHints.php
    - tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php
    - tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php
    - tests/Feature/Microsoft365/OutlookMeetingSuggestionTest.php
commits: 3
plan_head_before: 6d8a5ccf
plan_head_after: 92b2b404
actuals:
  tasks: 3
  commits: 3
---

# Phase 6 Plan 06: Out-of-sync data in the calendar read

The meetings read now carries the flagged entries of the whole 60-day window (`out_of_sync.items`), the entries of the range that were adjusted automatically in the last 7 days (`auto_adjusted`), and the D-03 resurfacing: a started meeting whose link was released shows again at its new slot with `moved_from`, the entry it was logged on. Each part costs one query per read, so the read cost does not grow with the number of rows.

## What was built

- **`OutOfSyncFlags`** (stateless, Octane-safe):
  - `items(User, Organization, now)`: built on `OutOfSyncScope::activeLinks` (active, 60-day window, live entry owned by the user), filtered to flagged links whose entry is in the current organization. Ordered by entry start, then entry id, at most 200 (`MAX_ITEMS`). Times are UTC `Y-m-d\TH:i:s\Z`. `new_start`/`new_end` are served only for `moved`. `description` is the entry's own, `''` when null.
  - `autoAdjusted(User, Organization, start, end, now)`: links with `auto_adjusted_at >= now - microsoft365.out_of_sync.auto_adjusted_days` (default 7), own entry in the organization overlapping `[start, end)` (same predicate as `linked_time_entry_ids`). `to_*` is the snapshot the adjust recorded.
  - `movedFrom(User, Organization, meetings)`: one `DISTINCT ON (graph_id)` query over released links of the given graph ids, picking the latest `released_at` whose entry is live, owned, in the organization and has an end. The result is keyed by meeting id. There is no query when no meetings are given.
- **Controller** `OutlookMeetingController::index()`:
  - The empty branch (impersonation, no account, not_connected) adds `out_of_sync: {items: []}` and `auto_adjusted: []`.
  - The normal branch serves both, or empty lists when there is no current organization.
  - The converted-meeting `whereNotExists` now counts only links with `released_at IS NULL` (D-03).
  - `movedFrom` is resolved once per read and passed through `MeetingHints(movedFrom: …)`.
  - The docblock is updated.
- **`MeetingHints`** gains `?array $movedFrom = null` as its last parameter. **`OutlookMeetingResource`** gains `moved_from`, which makes 14 keys. Dismiss and restore keep `MeetingHints::none()`, so they serve null.
- **Tests**:
  - The new `OutlookOutOfSyncReadTest` has 16 tests and 760 lines. The clock is fixed at 2026-11-24 10:00 UTC.
  - Exact-shape assertions updated in Endpoint (`assertExactJson`, top-level keys, 14 resource keys, `moved_from` null), Privacy (3 `assertExactJson`) and Suggestion (1 `assertExactJson`).
  - Before editing, all of `tests/Feature/Microsoft365` was grepped for `assertExactJson`, `array_keys` and key lists. No other read-shape assertions exist.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 7be0e386 | feat(06-06): serve the flagged entries of the whole window in the meetings read |
| 2 | d9781ea3 | feat(06-06): show a released meeting again with the entry it was logged on |
| 3 | 92b2b404 | feat(06-06): serve recent auto-adjusts in the meetings read at constant cost |

## Gates

- Pint (`app/Microsoft365` plus the four test files): passed.
- PHPStan, full app, level 7, with the worktree-first autoload: no errors.
- DB-free unit PHPUnit `tests/Unit/Microsoft365`: 284 tests. The only failures are the 12 known `SocialiteMicrosoftGatewayTest` failures caused by local OpenSSL.
- `php -l` on all touched test files: clean.
- Feature PHPUnit (`OutlookOutOfSyncReadTest`, updated Endpoint, Privacy and Suggestion tests): **PENDING CI (orchestrator)**. These tests need Postgres and were not run locally.

## Deviations from Plan

1. **[Rule 2 - Consistency] moved_from also skips occurrences of an ignored series.** The plan says "visible, non-dismissed meetings". The read also shows ignored-series occurrences, faded like dismissed ones, when `include_dismissed` is set. They now get the same filter as the series assignment, so a faded item never offers "Move my entry here".
2. **[Rule 2 - Contract] movedFrom requires an entry end.** The client type `OutlookMovedFrom.entry_end` is a non-null string, so a running entry never produces a `moved_from`.
3. **[Rule 2 - Privacy/contract] new_start/new_end are served only for `moved` flags.** A leftover Outlook slot on a cancelled or removed link is never served. A test covers this.
4. **Extra tests beyond the listed behaviors:**
   - A null description is served as `''`, and `all_day` is passed through.
   - No current organization gives empty lists.
   - A dismissed released meeting has no `moved_from`.
   - The Disconnect and reconnect survival case has its own test.
   - The endpoint allow-list test also asserts `moved_from` null.
5. **Worktree setup:**
   - The worktree was cut from an old upstream commit (b46f0157), so it was reset to BASE 6d8a5ccf while the tree was clean.
   - A `vendor` junction to the main checkout was created. It is gitignored.
   - The PHPStan and PHPUnit loaders are `wt-autoload-af67.php` and `wt-phpunit-bootstrap-af67.php` in the scratchpad.

## Notes for later plans

- `auto_adjusted` does not filter released or detached links. It lists every entry auto-adjusted in the last 7 days, using the link's current snapshot as `to_*`. If a later "Keep as is" re-baselines the snapshot of an auto-adjusted link (D-16), `to_*` follows the new snapshot.
- The conversion's `linkOf` must ignore released links (RESEARCH Pattern 3). That change belongs to 06-05 or a later plan, not to this one.
- The Privacy route count stays at 8 here. 06-10 changes it.

## Known Stubs

None.

## Threat Flags

None. All new surface is covered by T-06-19..T-06-22:
- Owner and organization scoping is tested.
- Impersonation and disconnected accounts get the empty branch.
- No subject or Graph id appears in the new fields (tested).
- The read issues a constant number of queries (tested).

## Self-Check: PASSED

- FOUND: app/Microsoft365/OutOfSync/OutOfSyncFlags.php
- FOUND: tests/Feature/Microsoft365/OutlookOutOfSyncReadTest.php
- FOUND: 7be0e386, d9781ea3, 92b2b404 (ancestors of HEAD)
