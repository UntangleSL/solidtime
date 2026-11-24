---
phase: 06-out-of-sync-detection
plan: 08
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, core-update, safety, tests]
status: complete
requires: [06-05]
provides:
  - "OutOfSyncApplier stale-observation guard: an observation whose observedAt is before the link's last_checked_at (second precision) is skipped under the row locks"
  - "OutOfSyncApplier release also moves the cached outlook_meetings row of (user_id, graph_id) to the observed slot, times only, when it exists and gone_at is null"
  - "tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php (local contract, 4 tests)"
  - "tests/Feature/Microsoft365/CoreTimeEntryUpdaterTest.php (CI, 10 tests)"
  - "tests/Feature/Microsoft365/OutOfSyncApplierTest.php (CI, 15 tests)"
affects: [06-09, 06-10]
requirements-completed: [OSYNC-02]
tech-stack:
  added: []
  patterns:
    - "Stale guard compares UTC 'Y-m-d H:i:s' strings (the stored precision): same-second observations still apply"
    - "Release cache update is a query-builder update on outlook_meetings keyed by (user_id, graph_id) and gone_at IS NULL, never creating a row"
key-files:
  created:
    - tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php
    - tests/Feature/Microsoft365/CoreTimeEntryUpdaterTest.php
    - tests/Feature/Microsoft365/OutOfSyncApplierTest.php
  modified:
    - app/Microsoft365/OutOfSync/OutOfSyncApplier.php
decisions:
  - "The contract test asserts CoreTimeEntryUpdater::ROUTE === 'api.v1.time-entries.update' (the real full name), plus PUT, TimeEntryController@update, parameters [organization, timeEntry] and the check-organization-blocked middleware"
  - "CoreTimeEntryUpdater needed no change: the 06-05 implementation already met every Task 1 behavior (entry organization, blocked-org check, session user only when it is the actor, setUser/forgetUser in finally only when set here, no static state, PermissionStore resolved per call)"
  - "A stale observation counts as skipped and writes nothing (last_checked_at stays at the newer time)"
  - "Out-of-order guard is strict (>) at second precision: an observation in the same second as the last applied one still applies"
completed: 2026-11-24
duration: ~45 min
metrics:
  tasks: 3
  files: 4
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: f36a17bd
---

# Phase 6 Plan 08: Core update path and applier hardening Summary

The applier no longer moves an entry back to an older Outlook slot, and a release now updates the cached meeting row, so no ghost stays at the old slot. A local contract test breaks if upstream changes core's update action or route. Two CI test classes cover the failure paths of the core update (job and HTTP context, organization, blocked org, overlap, permission, validation) and of the applier (stale observations, core refusals, releases, busy lock, scope, foreign entries, no deletes, counts-only log).

## What was built

- **`OutOfSyncApplier`** (public signature unchanged: `apply(User, array<string, Observation>, CarbonImmutable): ApplyResult`):
  - **Stale guard (Pitfall 1, T-06-12).** After the link and entry row locks, `isStale()` compares `last_checked_at` and `observedAt` as UTC `Y-m-d H:i:s` strings. An older observation is counted as `skipped` and writes nothing. Every applied observation still stamps `last_checked_at = observedAt`.
  - **Release cache update (Pitfall 5).** `release()` now receives the observation. For a Present observation it updates `starts_at` and `ends_at` of the `outlook_meetings` row for `(user_id, graph_id)`, only where `gone_at IS NULL`. It touches nothing else and never creates a row.
  - **Core refusals.** The mapping is documented per exception: `ValidationException`, `AuthorizationException`, `ApiException` (overlap, blocked org) and `LogicException` (updater guards) each lead to a `moved` flag. The nested transaction still rolls back any partial write. Any other throwable rolls back the whole link transaction.
- **`CoreTimeEntryUpdater`**: no source change (see Decisions).
- **`CoreTimeEntryUpdaterContractTest`** (Unit, `#[CoversNothing]`, no DB, runs locally). It checks:
  - core `update(Organization, TimeEntry, TimeEntryUpdateRequest): JsonResource`;
  - route `api.v1.time-entries.update`: PUT, `TimeEntryController@update`, parameters `[organization, timeEntry]`, middleware contains `check-organization-blocked`;
  - updater signature `(User, TimeEntry, string, string): TimeEntry`, and the class is not final;
  - the updater has no static properties.
- **`CoreTimeEntryUpdaterTest`** (Feature, CI, 10 tests):
  - Job context: only start and end change; project, task, tags, description and billable are kept; the project and task recalculation jobs are pushed; `Auth::guard('web')` is null afterwards.
  - Job context with core throwing an overlap: the user is still forgotten.
  - An overlap is allowed when the organization does not forbid it.
  - HTTP context: the session user is kept. Another signed-in user gets a `LogicException`.
  - The update uses the entry's organization, not `current_team_id`.
  - A blocked organization gets `OrganizationHasNoSubscriptionButMultipleMembersException`.
  - Missing `time-entries:update:own` (custom role) and another member's entry (needs `update:all`) both get `AuthorizationException`.
  - Validation uses core's `after_or_equal` message.
- **`OutOfSyncApplierTest`** (Feature, CI, 15 tests):
  - Applier fixes: out-of-order observations; a same-second observation still applies; overlap and blocked organization become moved flags; the release cache update (live row moved, gone row kept, no row created).
  - Bookkeeping: the auto adjust records where the entry came from (`auto_adjusted_from_*`, `auto_adjusted_at`, `last_checked_at = observedAt`); a repeated flag keeps its `flagged_at`.
  - Guards: a busy lock skips the batch; links outside the 60-day window, released links, detached links, entries reassigned to a colleague and another user's link with the same Graph id are never changed; cancelled and removed observations never delete an entry and never flag a started meeting.
  - Logging: one info line with integer counts, and no Graph id, description or time anywhere in the log.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 5b3c89f9 | test(06-08): prove the core update path in job and HTTP context with a local contract |
| 2 | 488533c2 | feat(06-08): skip stale observations and move the cached meeting on release |
| 3 | f36a17bd | test(06-08): prove the applier guards: busy lock, scope, foreign entries, no deletes, counts-only log |

## Gates

- **Gate U (local):**
  - `CoreTimeEntryUpdaterContractTest`: OK (4 tests, 17 assertions).
  - `OutOfSyncRulesTest`: OK (76 tests, 358 assertions).
  - `tests/Unit/Microsoft365`: 288 tests. The only failures are the 12 known `SocialiteMicrosoftGatewayTest` ones (local OpenSSL only).
- **Gate P (local):** Pint `--test` passed on `app/Microsoft365/TimeEntries`, `app/Microsoft365/OutOfSync` and all three test files. Full-app PHPStan (worktree-first autoload) reports `[OK] No errors` after each task.
- **Tracer feedback gate (Task 1):** the `<verify>` passed before expansion.
- **Feature classes load:** `--list-tests` lists 10 tests in `CoreTimeEntryUpdaterTest` and 15 in `OutOfSyncApplierTest`.
- **Acceptance greps:**
  - `v1.time-entries.update` in the contract test: present.
  - `public function test_`: 10 in the updater test (at least 6 required) and 15 in the applier test (at least 12 required).
  - `last_checked_at` in the applier: 5 (at least 2 required). `gone_at`: 1 (baseline 0).
  - No core file changed: the diff against base touches only the four plan files.
  - `git status --porcelain` on `app/Microsoft365` and `tests/*/Microsoft365` is empty.
- **PENDING CI (orchestrator):** `CoreTimeEntryUpdaterTest` and `OutOfSyncApplierTest` (Postgres), inside Gate W / Gate B for wave 3 together with 06-10.

## Deviations from Plan

- **[Plan text] Route name.** The plan's behavior names `v1.time-entries.update`. The real full name is `api.v1.time-entries.update` (06-05 decision, wave brief), so the contract test asserts `CoreTimeEntryUpdater::ROUTE` and the full name. The acceptance grep still matches as a substring.
- **No updater source change.** Task 1 said to fix `CoreTimeEntryUpdater` until both tests pass. The 06-05 code already does every behavior, so Task 1 is a test-only commit.
- **Extra tests beyond the behavior list:**
  - updater: allowed overlap without the opt-in setting, another member's entry needing `update:all`;
  - applier: same-second observation, release without a cached row, another user's link with the same Graph id.
- **Busy-lock test timing.** The test waits for the applier's fixed 2 s `block()` and asserts that `apply()` returns in under 10 s. It does not use a configurable wait.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-06-11 (auth left after a job update) is covered by tests after success and after a core exception.
- T-06-12 is mitigated by the stale guard.
- T-06-13 is covered by the overlap and blocked-org flag tests and the updater tests.
- T-06-SC: no package installs.

## Self-Check: PASSED

- Files exist: `tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php`, `tests/Feature/Microsoft365/CoreTimeEntryUpdaterTest.php`, `tests/Feature/Microsoft365/OutOfSyncApplierTest.php`, `app/Microsoft365/OutOfSync/OutOfSyncApplier.php`.
- Commits 5b3c89f9, 488533c2 and f36a17bd are ancestors of HEAD on `worktree-agent-a08635d06fe5568f9`.
