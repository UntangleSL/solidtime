---
phase: 06-out-of-sync-detection
plan: 01
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, rules, migration, unit-tests]
status: complete
requires: []
provides:
  - "outlook_meeting_links sync state columns (flag_reason, flagged_at, outlook_starts_at/ends_at, outlook_all_day, released_at, detached_at, last_checked_at, auto_adjusted_at, auto_adjusted_from_starts_at/ends_at)"
  - "partial unique index outlook_meeting_links_active_unique (user_id, graph_id) WHERE released_at IS NULL; index (user_id, meeting_starts_at); null-snapshot backfill"
  - "App\\Microsoft365\\OutOfSync\\{ObservationKind, Observation, LinkState, DecisionAction, Decision, OutOfSyncRules, OutOfSyncScope, LinkedSightings}"
  - "OutOfSyncRules::decide(LinkState, Observation, CarbonImmutable): Decision, pure, WINDOW_DAYS = 60"
  - "OutOfSyncScope::activeLinks(User, now): Builder<OutlookMeetingLink> and activeGraphIds(User, now): array<string, true>"
  - "LinkedSightings::observe(array, now): Observation and collect(iterable, array, now): array<string, Observation>"
affects: [06-05, 06-06, 06-08, 06-09, 06-10, 06-15]
requirements-completed: [OSYNC-01, OSYNC-02]
tech-stack:
  added: []
  patterns:
    - "Pure decision function with now passed in; the applier only moves data"
    - "UTC 'Y-m-d H:i:s' string compares for all slot equality"
    - "tpetry uniqueIndex()->where() partial unique index on a fork-owned table"
key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_23_000001_add_sync_state_to_outlook_meeting_links.php
    - app/Microsoft365/OutOfSync/ObservationKind.php
    - app/Microsoft365/OutOfSync/Observation.php
    - app/Microsoft365/OutOfSync/LinkState.php
    - app/Microsoft365/OutOfSync/DecisionAction.php
    - app/Microsoft365/OutOfSync/Decision.php
    - app/Microsoft365/OutOfSync/OutOfSyncRules.php
    - app/Microsoft365/OutOfSync/OutOfSyncScope.php
    - app/Microsoft365/OutOfSync/LinkedSightings.php
    - tests/Unit/Microsoft365/OutOfSyncRulesTest.php
  modified:
    - app/Microsoft365/Models/OutlookMeetingLink.php
decisions:
  - "Flag reasons are typed string constants on Decision (REASON_MOVED / REASON_CANCELLED / REASON_REMOVED), matching the string(20) flag_reason column"
  - "OutOfSyncScope qualifies its predicates on the base query (getQuery()) so callers can join time_entries without ambiguous columns; Larastan rejects qualified names on the Eloquent builder"
  - "LinkState::fromModels falls back to the entry's times for a link without a snapshot (same order as the migration backfill); such links are never in OutOfSyncScope"
  - "OutlookMeetingLink gets $attributes outlook_all_day = false, mirroring the column default for unsaved models"
completed: 2026-11-24
duration: ~45 min
metrics:
  tasks: 2
  files: 11
estimate:
  tokens: 70000
  tasks: 2
actuals:
  tokens: 13800
  tasks: 2
  commits: 2
plan_head_before: fef7d29fe1aebc808c44d15a3f532a6f6889e3a4
plan_head_after: a06f9a2e510c79bde7e24a195f19a0f3e6a7830c
---

# Phase 6 Plan 01: Out-of-sync data and decision core Summary

Link state schema with an active-only partial unique index, the Observation / LinkState / Decision value types, a pure `OutOfSyncRules::decide` that holds every owner rule (D-01..D-07, D-10, D-16..D-18), the shared `OutOfSyncScope` query and Graph-event-to-observation extraction. A 76-test local matrix that needs no database proves all of it.

## What was built

- **Migration `2026_11_23_000001`** (fork-owned path): adds the 11 link state columns from the interfaces block. It replaces the plain unique `(user_id, graph_id)` with `outlook_meeting_links_active_unique` (WHERE `released_at is null`) and adds index `(user_id, meeting_starts_at)`. A public `backfill()` fills only null snapshots, first from `outlook_meetings` and then from `time_entries`. It never re-snapshots from the cache. `down()` notes that restoring the plain unique fails while two links of one occurrence exist. The closure is typed with `Tpetry\PostgresqlEnhanced\Schema\Blueprint`, so PHPStan sees `uniqueIndex()` and `dropUniqueIndex()`.
- **`OutlookMeetingLink`**: fillable, casts (`datetime` and `boolean`), `@property` lines, and one docblock paragraph on the link state. The "ids, times and keyed hashes only" invariant is kept.
- **Value types**: `ObservationKind` (Present/Cancelled/Removed/Unknown) and `Observation` (kind, start, end, allDay, observedAt only, with named constructors). `LinkState` (UTC strings, `fromModels`), `DecisionAction` (Nothing/ClearFlag/Release/AutoAdjust/Resync/Flag) and `Decision` (named constructors per action, reason constants).
- **`OutOfSyncRules`**: final and stateless, `WINDOW_DAYS = 60`. `decide()` follows the ordered table of the plan exactly (scope -> unknown -> at snapshot -> started -> not started). It reads no clock and no DB (grep gate: 0 matches).
- **`OutOfSyncScope`**: `activeLinks` covers own links that are not released, not detached and have a snapshot, with start >= now - 60 days, and `whereExists` on an entry still owned by the user. `activeGraphIds` returns them as a set.
- **`LinkedSightings`**: `observe` maps isCancelled to Cancelled (checked first), a missing or non-UTC time to Unknown, and otherwise to Present with all-day from `isAllDay === true`. It reuses `OutlookMeetingSyncService::parseGraphUtc`. `collect` returns tracked ids only and skips malformed events. It never reads the subject, attendees or body.
- **`tests/Unit/Microsoft365/OutOfSyncRulesTest.php`** (472 lines): 8 tracer and link-state tests, 55 named rule rows (`'D-xx ...'` labels, 63 label matches), 8 sighting rows, a D-01 timezone test, a D-06 reflection test (constructor parameters and properties), a D-06 subject/attendee invisibility test, and a malformed-collect test. The models are built in memory and never saved.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | e1afe0da | feat(06-01): link sync state schema, out-of-sync rules, scope and sightings |
| 2 | a06f9a2e | test(06-01): out-of-sync rules matrix proven locally |

## Gates

- **Gate U** (local, PHP 8.3.36 toolchain): `phpunit tests/Unit/Microsoft365/OutOfSyncRulesTest.php` gives `OK (76 tests, 358 assertions)`. That meets the >= 30 tests criterion.
- **Gate P**: Pint `--test` passed on `app/Microsoft365` and the test file. Full-app PHPStan reports `[OK] No errors`.
- **Tracer feedback gate**: the Task 1 `<verify>` was re-run end-to-end before expansion and passed.
- **Mutation check** (extra): changing `started` from `<=` to `<` fails 2 D-01 rows. Dropping the "already flagged" guard on started links fails 2 D-02 rows. The rules file was restored from git after each check.
- Acceptance greps: `outlook_meeting_links_active_unique` 2, `function backfill` 1, `WINDOW_DAYS = 60` 1, `now(`/`DB::` outside comments in Rules and Sightings 0/0, D-labels 63. `git status --porcelain -- app/Microsoft365 tests/Unit/Microsoft365` is empty after the commits.
- **Gate W / Gate B (wave-1 anchor)**: PENDING CI (Actions disabled). This is handed over to the orchestrator for the merged wave-1 sha: the eight workflows green and at least 108 Microsoft365 PASS lines (36 classes). The migration's feature proofs (it runs in every CI feature test) also wait on CI. The dedicated migration feature proofs land in 06-05.

## Deviations from Plan

None in behavior. The plan was executed as written. No rule row contradicted a locked decision, and every row passed against the Task 1 implementation without changes to `OutOfSyncRules`, `LinkedSightings` or `Decision`.

Small notes:
- **[Rule 3 - Blocking] Qualified columns on the Eloquent builder fail Larastan** (`checkModelProperties`). `OutOfSyncScope` applies its predicates via `getQuery()`, the same precedent as `app/Auth/ActiveUserProvider.php`, so it keeps join-safe qualified names. Found during Task 1, fixed in e1afe0da.
- One Task 1 test expectation was wrong: setting a non-UTC Carbon on an Eloquent datetime attribute drops the zone, which is Laravel behavior. The test now uses UTC, because callers always pass UTC.
- The Task 2 commit body says "56 rule rows". The file has 55 rule rows plus 21 other tests. The commit was not amended.

## Out of scope (not fixed)

- Running the whole `tests/Unit/Microsoft365` folder locally gives 12 failures, all in `SocialiteMicrosoftGatewayTest` ("a boolean is an instance of OpenSSLAsymmetricKey"). The cause is that the portable Windows PHP toolchain cannot generate an OpenSSL key, probably because openssl.cnf is missing. This plan does not touch that test or the code it covers. Every other Microsoft365 unit test passes. CI (Linux) is the authority.

## Known Stubs

None.

## Threat Flags

None. T-06-03 is mitigated by the reflection test and by LinkedSightings reading only id, times, isCancelled and isAllDay. T-06-53 is mitigated by the partial unique index and the null-only backfill. Its feature proofs land in 06-05. T-06-SC: no package installs.

## Self-Check: PASSED

- All 11 files in key-files exist on disk.
- Commits e1afe0da and a06f9a2e are ancestors of HEAD on feature/m365-integration.
