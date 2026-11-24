---
phase: 06-out-of-sync-detection
plan: 09
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, graph, lookups, sync]
status: complete
requires: [06-02, 06-05]
provides:
  - "Observation::fromLookup(EventLookup, CarbonImmutable): Present (both times) -> present UTC strings + allDay; Cancelled -> cancelled; Removed -> removed; anything else -> unknown"
  - "App\\Microsoft365\\OutOfSync\\OutOfSyncLookups::lookUp(MicrosoftAccount, list<string>, int $max, ?CarbonImmutable $deadline): array{observations, stopped: throttled|reconnect|unknown|budget|deadline|null, looked_up}"
  - "OutlookMeetingSyncService: after a complete, failure-free traversal, active links overlapping the window that the window did not return are looked up (not-started first, soonest first), then applied once with the sightings"
  - "SyncOutcome::$autoAdjusted (last constructor parameter, default 0); POST /m365/meetings/sync answers auto_adjusted"
  - "tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php: 24 tests (8 from 06-05 + 16 new), CI"
affects: [06-15]
requirements-completed: [OSYNC-01, OSYNC-02]
tech-stack:
  added: []
  patterns:
    - "Absence is never evidence: an absent linked id is acted on only through a lookup answer; Unknown answers produce no observation (so last_checked_at is not stamped)"
    - "Lookup loop stops on the first throttle / reconnect / unknown answer, on the budget and on the traversal deadline; one counts-only log line"
key-files:
  created:
    - app/Microsoft365/OutOfSync/OutOfSyncLookups.php
  modified:
    - app/Microsoft365/OutOfSync/Observation.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - app/Microsoft365/Graph/SyncOutcome.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php
decisions:
  - "An Unknown lookup answer yields no observation at all (not Observation::unknown), so the applier does not stamp last_checked_at on a link Graph could not confirm"
  - "Absent ids are ordered not-started first (soonest first), then started ones: only not-started meetings can still be flagged or moved, so the 5-lookup budget goes to them first"
  - "The lookup deadline is the sync start + microsoft365.graph.deadline_seconds (15), checked before each lookup; a lookup started just before the deadline may still run up to its own HTTP timeout"
  - "A throttled or reconnect lookup does not change the sync answer (status stays ok): the window itself synced; the persisted back-off / reconnect marker answers the next request"
completed: 2026-11-24
duration: ~45 min
metrics:
  tasks: 3
  files: 5
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 11200
  tasks: 3
  commits: 3
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: de0ae04ba2430459b42807d9bf2c0bb89d49a5f2
---

# Phase 6 Plan 09: Lookups for absent linked meetings, sync matrix, auto_adjusted count Summary

The interactive sync now confirms every linked meeting that a complete window did not return with a direct Graph lookup before acting on it. A meeting is flagged "removed" only on a 404 ErrorItemNotFound; any other error leaves everything unchanged. The plan also proves the owner's rules on Graph-shaped answers, and the sync answer now reports how many entries it moved.

## What was built

- **`Observation::fromLookup()`**: maps an `EventLookup` to an `Observation`:
  - Present with both times becomes present, with UTC `Y-m-d H:i:s` strings and the all-day bit.
  - Cancelled becomes cancelled.
  - Removed becomes removed.
  - Everything else (Unknown, Throttled, Reconnect, or a Present answer without usable times) becomes unknown.
- **`OutOfSyncLookups`** (stateless, takes `GraphCalendarClient` and `MicrosoftTokenService`; 06-15 reuses it): `lookUp()` looks the ids up one at a time, using the same token closure as `traverse()`. It stops on any of these:
  - The `$max` budget is used up (`budget`).
  - The deadline has passed (`deadline`).
  - Graph throttles. It persists `graph_backoff_until = answer time + (retryAfter ?? RetryAfter::DEFAULT_SECONDS)` on the account (`throttled`).
  - Graph rejects the token. It calls `markReconnectRequired()` (`reconnect`).
  - An Unknown answer (`unknown`), which adds no observation.

  Each observation's `observedAt` is the time of its answer. It logs one `Outlook out-of-sync lookups` line with counts and the stop reason only.
- **`OutlookMeetingSyncService::traverse()`**: the lookup step runs only on the complete branch. That branch already sits after the failure return, so the traversal is also failure-free. The step comes after `markUnseenGone()` and before the single `apply()`:
  - It collects the absent ids: active links (`OutOfSyncScope::activeLinks`) that have no sighting and whose recorded slot overlaps `[start, end)` (the `markUnseenGone()` predicate).
  - It looks them up with `lookups_per_sync` (default 5) and deadline `syncStartedAt + deadline_seconds`.
  - It merges the lookup observations into the sightings.

  The order store, scrub, failure, markUnseenGone, recordWindow is unchanged.
- **`SyncOutcome`**: `int $autoAdjusted = 0` is the last constructor parameter, and `toArray()` adds `auto_adjusted`. The Ok outcome carries `ApplyResult::$adjusted`. Every other outcome (reused, coalesced, throttled, failures, not connected) answers 0.
- **`OutlookOutOfSyncSyncTest`** (Feature, CI): `employee()` now calls `Http::preventStrayRequests()`, so a lookup that was not scripted fails the test. New helpers: `fakeLookups()`, `lookupFixture()` (copied from `GraphEventLookupTest`), `lookupAt()`, `lookupRequests()` and `account()`. New tests:
  - Task 1: removed via lookup (exactly one request, with the `Prefer` header); outage (503 without Retry-After) changes nothing; partial window sends no lookup.
  - Task 2: moved out of the window via S5b follows; S3 cancelled lookup flags cancelled; cancelled sighting flags and the cached row is still scrubbed (T-03-13), with no lookup; an edited entry is flagged moved and left unchanged; a started meeting moved via lookup is released; a started meeting cancelled (sighting) or removed (lookup) changes nothing; subject, attendee, location and body changes do nothing (D-06); a flag clears when Outlook returns to the recorded slot (D-17); a throttled lookup persists the back-off and stops; a lookup rejected twice marks the account for reconnect and stops; the budget is capped at 5; a failed traversal applies nothing and looks nothing up.
  - Task 3: `auto_adjusted` is 2 on the sync that moved two entries, then 0 on an unchanged, reused, coalesced and throttled answer.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | adb9248c | feat(06-09): confirm absent linked meetings with a direct lookup before flagging them removed |
| 2 | 778d7e89 | test(06-09): sync matrix of the out-of-sync rules on Graph-shaped answers |
| 3 | de0ae04b | feat(06-09): the sync answer reports how many entries it moved |

## Gates

- Pint (`--test app/Microsoft365` plus the test file): passed.
- PHPStan, full app (`phpstan.neon`, worktree-first autoload): no errors.
- An ad-hoc PHPStan level 7 run on the test file reports only the existing missing generic on `syncWeek(): TestResponse`, which predates this plan.
- Unit PHPUnit: `OutOfSyncRulesTest` + `GraphEventLookupTest` gave OK (106 tests). `GraphCalendarClientTest` gave OK (41). In all of `tests/Unit/Microsoft365`, the only failures are the 12 local-only OpenSSL failures in `SocialiteMicrosoftGatewayTest`.
- Feature PHPUnit (Postgres): PENDING CI (orchestrator). `OutlookOutOfSyncSyncTest` cannot run locally.
- Exact-shape check: no test asserts the exact JSON of POST /m365/meetings/sync. The `assertExactJson` calls in `tests/Feature/Microsoft365` are all on the GET meetings read, whose shape is unchanged. Tests that sync with links (`OutlookMeetingLinkLifecycleTest`, `OutlookSeriesAssignmentTest`, `OutlookMeetingPrivacyTest`) re-sync the same round, so every linked meeting is sighted and no lookup is sent. `OutlookMeetingSyncTest`, `OutlookSyncResilienceTest` and `MicrosoftTokenRefreshTest` create no links, so their request counts are unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Unqualified column names in the absent-id query**
- **Found during:** Task 1 (PHPStan)
- **Issue:** Larastan rejects table-qualified column names (`outlook_meeting_links.meeting_starts_at`) on `Builder<OutlookMeetingLink>::where()/get()`.
- **Fix:** Used plain column names. The query has no join, so they are unambiguous.
- **Commit:** adb9248c

**2. [Rule 2 - Correctness] Extra matrix cases from the plan's must-have truths**
- The truths list "a 200 cancelled flags 'cancelled'" and "a lookup rejected twice marks the account for reconnect", but the behavior list had no test for either. Added `test_cancelled_lookup_answer_flags_the_entry_cancelled` (S3) and `test_lookup_rejected_twice_marks_the_account_for_reconnect`.

No disagreement with the 06-01 rules matrix was found.

## Note for the owner's UAT (D-01, RESEARCH Pitfall 4)

"Started" is judged when the change is detected, not when Outlook made it. Suppose a meeting is moved before it started, but the move is seen only after its recorded start. For example, nobody opens the calendar until after the original time and the daily job has not run yet. That meeting counts as started: its entry stays as it is, the link is released, and the meeting shows up again at its new slot so it can be logged there. The entry is not moved.

## Open items

- Feature PHPUnit for `OutlookOutOfSyncSyncTest` (24 tests) runs only in CI after the orchestrator merges.
- The frontend does not read `auto_adjusted` from the sync answer yet; the calendar notice belongs to a UI plan of this phase.

## Threat Flags

None. The lookups use the existing Graph client, token closure and per-user sync lock; no new endpoint or trust boundary was added.

## Self-Check: PASSED

- FOUND: app/Microsoft365/OutOfSync/OutOfSyncLookups.php, app/Microsoft365/OutOfSync/Observation.php, app/Microsoft365/Graph/OutlookMeetingSyncService.php, app/Microsoft365/Graph/SyncOutcome.php, tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php
- FOUND commits: adb9248c, 778d7e89, de0ae04b (ancestors of HEAD)
- Acceptance: `function fromLookup` = 1; `lookUp(` in the sync service >= 1; `public function test_` = 24 (>= 18); `graph_backoff_until` in OutOfSyncLookups = 2; `'auto_adjusted'` in SyncOutcome = 1; `git status --porcelain -- app/Microsoft365 tests/Feature/Microsoft365` is empty
