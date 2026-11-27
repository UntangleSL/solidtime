---
phase: 07-hardening-release
plan: 03
subsystem: microsoft365-data-cleanup
tags: [sec-03, deletion, cascade, disconnect, sync, tests]
status: complete
requires:
  - 07-01 (upstream merge at BASE 34669a55)
provides:
  - "Tests\\Feature\\Microsoft365\\MicrosoftDataCleanupTest: deletion matrix over all five fork tables, schema cascade guard, disconnect-during-sync race"
  - "OutlookMeetingSyncService::purgeIfDisconnected(User): bool; sync() answers not_connected after a purge"
affects:
  - app/Microsoft365/Graph/OutlookMeetingSyncService.php
  - docs/deploy/MICROSOFT-SIGNIN.md ("Pendiente para la Fase 7", second bullet is now resolved; doc not edited here)
requirements-completed: [SEC-03]
key-files:
  created:
    - tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php
  modified:
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
tech-stack:
  added: []
  patterns:
    - "Schema guard derived from the fork migration directory (Schema::create) and checked against pg_constraint (confdeltype = 'c')"
    - "Post-traverse re-check under the microsoft_accounts row lock (same lock Disconnect takes), no cache lock or wait"
decisions:
  - "The race test disconnects at page 2 (more pages follow) and at page 22 (last page) through a data provider instead of only at the first page request: page 1 of round A is empty, so a first-page disconnect already passes before the fix and cannot be RED"
  - "Member removal is exercised through MemberService::removeMember(..., true) directly (the plan allowed either this or the API endpoint)"
completed: 2026-11-27
metrics:
  duration: ~45min
  completed: 2026-11-27
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 5500
  tasks: 3
  commits: 4
plan_head_before: 34669a55a7b6f941eae589724d4d4857b812dac8
plan_head_after: 7467352b785ebc1d7fbc8137259047055d37946c
---

# Phase 7 Plan 03: Deletion cleanup proof and disconnect-during-sync purge Summary

SEC-03 proven on every core deletion path by one consolidated test class (user, placeholder member, member removal with data, organization deletion, plus a pg_constraint cascade guard derived from the fork migrations), and the last D-21 residue closed: a sync that races a Disconnect now re-checks the account under its row lock after traversing and purges what it wrote.

## What was built

- `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` (new, 6 test methods, 7 cases):
  - helpers `seedMicrosoftData()` (one row in each of `microsoft_accounts`, `outlook_meetings`, `outlook_sync_windows`, `outlook_series_settings`, `outlook_meeting_links` plus the member's time entry; the account's object id is the user id so seeded users never collide on tenant + oid) and `rowsOf()` (raw `DB::table` counts per fork table);
  - `test_deleting_a_user_leaves_no_microsoft_row`: single-member owner deleted through `DeletionService::deleteUser`; all five counts 0, an unrelated user keeps 1 in each;
  - `test_every_fork_table_cascades_from_users`: table list parsed from `Schema::create(` in `app/Microsoft365/database/migrations/*.php` must equal the five known tables; `pg_constraint` (joined to `pg_attribute` for the column) must show `user_id -> users` with `confdeltype = 'c'` for each, plus `time_entry_id -> time_entries` for the links;
  - `test_deleting_a_member_user_keeps_entries_under_the_placeholder_and_drops_microsoft_rows`: entry survives under core's placeholder, deleted user has 0 rows everywhere, the placeholder 0, the owner 1;
  - `test_removing_a_member_with_their_data_drops_only_their_links`: employee entry and link gone, owner link kept, employee keeps account/meetings/windows/series (D-09);
  - `test_deleting_an_organization_drops_its_links_and_keeps_user_level_rows`: no link left, both users keep their user-level rows (D-09);
  - `test_disconnect_during_a_sync_leaves_no_cached_meeting` (data provider: page 2, page 22): Graph fake answers round A page by page and applies exactly what `MicrosoftAccountController::destroy` does while the chosen page is fetched; expects `not_connected`, 0 meetings, 0 windows, disconnect intact (null tokens), time entries unchanged (count and row snapshot), the link kept.
- `OutlookMeetingSyncService`: `sync()` stores the traverse outcome, then calls the new private `purgeIfDisconnected(User)`, which in one `DB::transaction` reads the account with `lockForUpdate()`; when it is missing or has `disconnected_at`, deletes the user's `OutlookMeeting` and `OutlookSyncWindow` rows, logs `Outlook sync: disconnected during sync` (no context) and the sync answers `SyncStatus::NotConnected`. Reconnect-required accounts are not purged. No time-entry or link code, no new cache lock.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 463342e4 | test(07-03): user deletion leaves no Microsoft row; fork tables cascade |
| 2 | 155294f8 | test(07-03): placeholder, member removal and organization deletion leave no stray links |
| 3 (RED) | 694363ca | test(07-03): a disconnect during a running sync must leave no cached meeting (RED) |
| 3 (GREEN) | 7467352b | fix(07-03): a disconnect during a sync leaves no cached meeting |

## Gates

- Pint `--test` on both files: passed.
- PHPStan full app (`phpstan.neon`, worktree-first autoload loader): `[OK] No errors`.
- PHPStan level 7 + Larastan on the new test file (scratchpad config): `[OK] No errors`.
- `php -l` on both files: no syntax errors.
- Gate U `tests/Unit/Microsoft365`: `OK (276 tests, 2075 assertions)` excluding `SocialiteMicrosoftGatewayTest` (its 12 failures are the known local-only OpenSSL issue; no other failure).
- Plan greps: 5 `Schema::create` tables; `purgeIfDisconnected` 1, `lockForUpdate` 1, `TimeEntry` 1 (baseline), `Cache::lock` 1 (baseline) in the sync service; 6 `function test_` methods (5 after Task 2); `git log --grep="(07-03)" -- app/Service` empty.
- PENDING CI (orchestrator): all of `MicrosoftDataCleanupTest` (Postgres), and the existing `OutlookMeetingSyncTest`, `OutlookMeetingLinkLifecycleTest`, `OutlookMeetingPrivacyTest`, `MicrosoftTokenRefreshTest` as regression for the sync change.

## TDD Gate Compliance

RED commit 694363ca precedes GREEN commit 7467352b. RED could not be executed locally (no Postgres); it was established by trace: round A page 2 holds one eligible meeting followed by more pages, so before the fix the page-2 case stores it (the next token check fails with not_connected after the rows were read, and `traverse()` stores them anyway), and the page-22 case completes, stores 12 meetings, records a window and answers `ok`. Both assertions fail before the fix and hold after it.

## Deviations from Plan

**1. [Rule 1 - Test that could not be RED] Disconnect moment of the race test**
- **Found during:** Task 3
- **Issue:** The plan applies the disconnect "on the FIRST page request only". Page 1 of round A is empty, so the next token check fails before any row is read: the test would already pass on the unfixed code, contradicting "It must fail before step 2".
- **Fix:** A data provider runs the race at page 2 (rows read, more pages follow) and at page 22 (last page, complete traversal, window recorded). The test asserts the fake served exactly up to that page so the race happens where intended.
- **Files modified:** tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php
- **Commit:** 694363ca

**2. [Rule 1 - Type] `createOne()` and `whereKey()->first()` in the test**
- **Found during:** Task 2 (PHPStan on the test file)
- **Issue:** `factory()->create()` and `find(mixed)` are typed `Model|Collection`, so `$entry->user_id` was an undefined property for Larastan.
- **Fix:** `createOne()` in the seed helper and `whereKey(...)->first()` for reads.
- **Commit:** 155294f8

No core file touched; no DeletionService hook or listener added.

## Open items

- `docs/deploy/MICROSOFT-SIGNIN.md` "Pendiente para la Fase 7 (SEC-04)", second bullet (sync racing a disconnect) is resolved by 7467352b but the doc is outside this plan's files; the orchestrator (or the docs plan) should mark it done.

## Threat Flags

None: no new endpoint, auth path or schema change. T-07-11, T-07-12 and T-07-13 are mitigated as planned.

## Self-Check: PASSED

- FOUND: tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php
- FOUND: app/Microsoft365/Graph/OutlookMeetingSyncService.php (purgeIfDisconnected)
- FOUND commits: 463342e4, 155294f8, 694363ca, 7467352b (all ancestors of HEAD)
