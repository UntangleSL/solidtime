---
phase: 06-out-of-sync-detection
plan: 05
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, tracer, core-update, sync, docs]
status: complete
requires: [06-01]
provides:
  - "App\\Microsoft365\\OutOfSync\\ApplyResult (adjusted, flagged, released, cleared, resynced, skipped; total(); toArray())"
  - "App\\Microsoft365\\OutOfSync\\OutOfSyncApplier::apply(User, array<graphId, Observation>, CarbonImmutable): ApplyResult"
  - "App\\Microsoft365\\TimeEntries\\CoreTimeEntryUpdater::updateTimes(User, TimeEntry, string, string): TimeEntry, ROUTE = 'api.v1.time-entries.update', static format('Y-m-d H:i:s') -> MeetingConversionRequest::FORMAT"
  - "OutlookMeetingSyncService: linked sightings before the eligibility filter, applied after a complete, failure-free traversal inside the sync lock"
  - "tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php (8 tests, CI)"
  - "D-12 data-safety wording in .claude/CLAUDE.md, .planning/PROJECT.md and the OutlookMeetingSyncService docblock"
affects: [06-08, 06-09, 06-10, 06-15]
requirements-completed: [OSYNC-01, OSYNC-02]
tech-stack:
  added: []
  patterns:
    - "In-process core update: real FormRequest bound to a CLONE of the named core route (no shared route state, Octane)"
    - "Acting user: session user must equal the actor (HTTP); nobody signed in -> setUser + forgetUser in finally (job)"
    - "Per-link DB transaction with lockForUpdate on link then entry; nested transaction (savepoint) around the core call so a refusal rolls back and becomes a flag"
key-files:
  created:
    - app/Microsoft365/OutOfSync/ApplyResult.php
    - app/Microsoft365/OutOfSync/OutOfSyncApplier.php
    - app/Microsoft365/TimeEntries/CoreTimeEntryUpdater.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php
  modified:
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - .claude/CLAUDE.md
    - .planning/PROJECT.md
decisions:
  - "The core update route's full name is api.v1.time-entries.update (routes/api.php sits in the 'api.' name group); the plan's 'v1.time-entries.update' was the inner name. CoreTimeEntryUpdater::ROUTE holds the real name"
  - "A repeated identical flag keeps its first flagged_at; a changed flag (reason, times or all-day) restamps it"
  - "A busy per-user lock (2 s wait) skips the whole batch and logs the skipped count; the next sync or the daily job sees the change again"
  - "The stale-observation guard (skip when last_checked_at > observedAt) is left to 06-08, which owns it; 06-05 writes last_checked_at = observedAt on every applied observation"
completed: 2026-11-24
duration: ~70 min
metrics:
  tasks: 3
  files: 7
estimate:
  tokens: 95000
  tasks: 3
actuals:
  tokens: 12500
  tasks: 3
  commits: 3
plan_head_before: 6d8a5ccfbdf1339717e71ede7f3fc43c02fe503b
plan_head_after: dc48517324c51130975f17079e2591e49962562c
---

# Phase 6 Plan 05: Out-of-sync tracer (sync -> rules -> core update) Summary

A not-started meeting that moves in Outlook now carries its unedited entry to the new slot on the next complete calendar sync. The entry changes only through core's own `TimeEntryController::update`, and the change is recorded on the link. The plan also proves 06-01's migration against Postgres (in CI) and aligns the project docs with the owner's D-12 exception.

## What was built

- **`CoreTimeEntryUpdater`** (not final, so tests can bind a double): `updateTimes(User $actor, TimeEntry $entry, string $start, string $end)`.
  - Builds a `TimeEntryUpdateRequest` that carries only `start` and `end` and is bound to a clone of the real core route `api.v1.time-entries.update`. Then it runs core's `update()` in-process, so permissions, the opt-in overlap check, validation and the `RecalculateSpentTimeFor*` jobs all apply unchanged.
  - Uses the entry's own organization and checks a blocked organization first, as `check-organization-blocked` does.
  - Acting user: in HTTP, the session user must be the actor. In a job (nobody signed in), it sets the actor on the web guard and calls `forgetUser()` in `finally`. Any other signed-in user, or a default guard that does not resolve to the actor, throws `LogicException`.
  - Also throws `LogicException` when the route is gone or core stops returning a `TimeEntry`.
- **`OutOfSyncApplier::apply()`**: takes a per-user `Cache::lock('m365:osync:{user}', microsoft365.out_of_sync.lock_seconds)` with a 2 s wait. Each link gets its own `DB::transaction`, which re-reads the active link (through `OutOfSyncScope`, so a link that left the scope is skipped) and its entry `lockForUpdate`. A missing or foreign entry is skipped. Then it calls `OutOfSyncRules::decide()` and applies the effect:
  - **Nothing**: no change.
  - **ClearFlag**: the flag columns are emptied and `outlook_all_day` is set to false.
  - **Release**: sets `released_at`.
  - **AutoAdjust**: calls the updater inside a nested transaction, then writes the new snapshot, clears the flag, sets `auto_adjusted_at` and copies the previous snapshot into `auto_adjusted_from_*`. If core refuses with `ValidationException`, `AuthorizationException`, `ApiException` or `LogicException`, the link is flagged `moved` instead.
  - **Resync**: writes the new snapshot and clears the flag.
  - **Flag**: writes the reason, the seen times (null for cancelled or removed) and the all-day bit.

  Every applied observation writes `last_checked_at = observedAt`. The log carries counts only (`Outlook out-of-sync applied`), and only when `total() > 0`. No code path deletes an entry.
- **`ApplyResult`**: a final readonly class of counts, with `total()` and `toArray()`.
- **`OutlookMeetingSyncService`**: injects `OutOfSyncScope`, `LinkedSightings` and `OutOfSyncApplier`.
  - Before the event loop, `traverse()` loads `activeGraphIds($user, $syncStartedAt)`.
  - Inside the loop, before the eligibility filter, it records `LinkedSightings::observe()` for every tracked id, so a cancelled event is seen as cancelled (Pitfall 2).
  - The sightings are applied only on the `complete` branch. That branch comes after `store()`, `scrubIneligible()` and the failure return, so the traversal is complete and failure-free (D-07). It is still inside the `m365:meetings-sync` lock.
- **`OutlookOutOfSyncSyncTest`** (Feature, CI, 8 tests): the tracer converts through the real endpoint and syncs through the real HTTP route. Its private helpers are `linkedEntry()`, `graphEvent()`, `fakeWindow()`, `syncWeek()`, `linkOf()` and `utc()`.

## Docs change: owner decisions D-04 and D-12

The owner decisions **D-04** (a not-started meeting moved in Outlook: its unedited entry follows the new time through core's update path; an edited entry is flagged) and **D-12** (this auto adjust is an explicit exception to "Outlook never modifies entries"; it covers only unedited entries of not-started meetings, and deletion is never automatic) drive three text changes:

- **`.claude/CLAUDE.md` "Data safety"** now reads exactly like `.planning/PROJECT.md` line 71: never delete, never modify entries of meetings that already started, and the only automatic change is the unedited entry of a not-started meeting moving to its new Outlook time (owner, 2026-11-23). The old wording "never modify or delete existing time entries automatically" is gone. Nothing else in the file changed.
- **`.planning/PROJECT.md`** has three changes:
  - The Active out-of-sync item now states the started / not-started rule, the auto adjust, the flag for everything else and no automatic delete (D-04, D-12).
  - The Out of Scope item "Automatically adjusting or deleting time entries when Outlook changes" is replaced by "Automatically deleting time entries, or adjusting entries of meetings that already started or that the user edited, when Outlook changes — flag instead (D-12)".
  - The background-sync item notes the daily check of linked meetings since Phase 6 (D-11). Meeting import stays on open + Sync.

  Line 71 was already correct and is unchanged.
- **`OutlookMeetingSyncService` class docblock**: the old line "Read-only towards Graph and never touches time entries" is replaced. The class is still read-only towards Graph, it never deletes an entry, and it never changes the entry of a started meeting. The one automatic change (D-04, D-12) goes only through `CoreTimeEntryUpdater`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 8989516f | feat(06-05): moved not-started meeting moves its unedited entry on the next sync |
| 2 | e6e381ef | test(06-05): prove the link migration and that a cancellation never deletes an entry |
| 3 | dc485173 | docs(06-05): state the D-12 data-safety exception in CLAUDE.md and PROJECT.md |

## Gates

- **Gate P (local, PHP 8.3.36 toolchain, worktree-first autoloader)**:
  - Pint `--test` passed on `app/Microsoft365` and the test file.
  - Full-app PHPStan reports `[OK] No errors`.
  - `phpunit tests/Unit/Microsoft365/OutOfSyncRulesTest.php` gives `OK (76 tests, 358 assertions)`.
- **DB-free unit suite** `tests/Unit/Microsoft365`: 284 tests. The only failures are the 12 known `SocialiteMicrosoftGatewayTest` ones (local OpenSSL in the portable PHP, out of scope).
- **Extra local check (scratch, not committed)**: a DB-free test built the updater's request through reflection. It confirmed four things: the route resolves; `validated()` holds only start and end; `$request->organization` and `route('timeEntry')` resolve; the shared router route keeps no parameters after the call. An end before the start raises `ValidationException`. This is how the route-name deviation below was found.
- **Tracer feedback gate**: the Task 1 `<verify>` was re-run before expansion and passed.
- **Acceptance greps**:
  - `v1.time-entries.update` in the updater: 3. `forgetUser`: 1. `LinkedSightings` in the sync service: 2.
  - The forbidden `TimeEntry::query()...->update|delete(` / `forceDelete(` grep over `app/Microsoft365` is empty.
  - `backfill()` in the test: 1. `public function test_`: 8.
  - CLAUDE.md `meetings that already started`: 1. Old CLAUDE.md wording: 0. `never touches time entries`: 0.
  - PROJECT.md `D-12`: 2. Old Out of Scope wording: 0.
  - `git status --porcelain` on the plan paths is empty.
- **PENDING CI (orchestrator)**: `OutlookOutOfSyncSyncTest` (Postgres feature tests, including the 06-01 migration proofs), the unchanged `OutlookMeetingSyncTest::test_sync_does_not_change_time_entries`, **Gate W** (eight workflows green) and **Gate B** (at least 114 Microsoft365 PASS lines, 38 classes). These are handed to the orchestrator for the merged wave-2 sha. This plan is the wave-2 CI anchor.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Core route name is `api.v1.time-entries.update`, not `v1.time-entries.update`**
- **Found during:** Task 1, scratch request test.
- **Issue:** `routes/api.php` is loaded inside an `api.` name group, so `getByName('v1.time-entries.update')` returns null and every auto adjust would have become a `LogicException` and then a moved flag. The existing tests already use `route('api.v1.time-entries.store')`, which confirms the prefix.
- **Fix:** `CoreTimeEntryUpdater::ROUTE = 'api.v1.time-entries.update'`. The docblock explains the full name. The acceptance grep still matches as a substring. 06-08's contract test should assert `CoreTimeEntryUpdater::ROUTE` or the full name.
- **Commit:** 8989516f

**2. [Rule 2 - Defensive] Default-guard check in the updater**
- **Issue:** core's `PermissionStore` reads `Auth::user()` through the default guard. If something had switched the default guard away from `web`, the actor set on `web` would not be the user core sees.
- **Fix:** after the guard setup, `Auth::id()` must equal the actor, otherwise `LogicException` (fails closed, becomes a moved flag). Commit 8989516f.

### Additions beyond the plan's behavior list

- Two extra Task 1 tests: `test_moved_meeting_whose_entry_was_edited_is_flagged_not_adjusted` (D-04 flag path) and `test_started_meeting_moved_keeps_its_entry_and_releases_the_link` (D-02 / D-03 release path). The file has 8 tests, and the plan requires at least 6.
- `ApplyResult::toArray()` for the counts-only log line.

## Notes for later plans

- 06-08: add the stale-observation skip (`last_checked_at` > `observedAt`) and the release cache-row update. Keep the core-refusal mapping. The lock already reads `microsoft365.out_of_sync.lock_seconds` (default 30) with a 2 s `block()`.
- 06-09: `traverse()` holds `$tracked` and `$sightings` before the loop. Unsighted tracked ids that overlap the window are the lookup candidates. The applier is called only on the complete branch.
- Pitfall 4 (locked behavior, not a bug): a move made before the meeting started but detected only after its recorded start counts as started, so the link is released instead of auto adjusted.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-06-01 and T-06-02 are mitigated in `CoreTimeEntryUpdater` and `OutOfSyncApplier`.
- T-06-04 is mitigated: sightings apply only on the complete, failure-free branch, and the partial-traversal test covers it.
- T-06-05 is mitigated: scope by user, entry ownership re-checked under the row lock.
- T-06-SC: no package installs.

## Self-Check: PASSED

- Files exist: `app/Microsoft365/OutOfSync/ApplyResult.php`, `app/Microsoft365/OutOfSync/OutOfSyncApplier.php`, `app/Microsoft365/TimeEntries/CoreTimeEntryUpdater.php`, `tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php` (497 lines).
- Commits 8989516f, e6e381ef and dc485173 are ancestors of HEAD on `worktree-agent-aeb0981ff919488be`.
