---
phase: 05-smart-meeting-suggestions
plan: 01
subsystem: microsoft365-suggestions
status: complete
tags: [m365, outlook, series, pre-assignment, resolver, migration]
requires: []
provides:
  - "outlook_meeting_links.series_master_id (+ index, backfill), signals jsonb, prefill_source, prefill_kept"
  - "App\\Microsoft365\\Suggestions\\{Assignment, MeetingHints, SeriesKey, BookableProjects, SeriesAssignmentResolver}"
  - "OutlookMeetingResource(OutlookMeeting, ?MeetingHints) with series_key, series_ignored, assignment, suggestions (final Phase 5 shape)"
  - "OutlookMeetingController::index resolves series assignments once per read (current organization)"
affects: [05-04, 05-05, 05-06, 05-09]
requirements-completed: [RULE-01, RULE-05]
completed: 2026-11-17
key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php
    - app/Microsoft365/Suggestions/Assignment.php
    - app/Microsoft365/Suggestions/MeetingHints.php
    - app/Microsoft365/Suggestions/SeriesKey.php
    - app/Microsoft365/Suggestions/BookableProjects.php
    - app/Microsoft365/Suggestions/SeriesAssignmentResolver.php
    - tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php
  modified:
    - app/Microsoft365/Models/OutlookMeetingLink.php
    - app/Microsoft365/Http/Controllers/MeetingConversionController.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Resources/OutlookMeetingResource.php
    - tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php
decisions:
  - "Series assignment is derived live from the time entry behind the latest link (DISTINCT ON series, created_at desc, meeting_starts_at desc nulls last, id desc); nothing is copied into a rule"
  - "SeriesAssignmentResolver is injected into OutlookMeetingController::index as a method parameter (not the constructor) so its PermissionStore-backed BookableProjects is fresh per request under Octane"
  - "Unbookable latest conversion gives assignment null with no fallback; a reassigned or other-organization entry is excluded by the join (so an older own link in the current organization can still win)"
metrics:
  duration: "~55 min"
  tasks: 3
  files: 12
estimate:
  tokens: 95000
  tasks: 3
actuals:
  tokens: 15700
  tasks: 3
  commits: 3
plan_head_before: 1468222e0d2dc3d85d93c43b0785c199037fc33c
plan_head_after: cd043343b2b4419c634740ef87dd04f4bd2eed3c
---

# Phase 5 Plan 01: Series pre-assignment (server side) Summary

Converting one occurrence of a recurring Outlook series now makes every other unconverted, non-dismissed occurrence come back from `GET /m365/meetings` carrying an `assignment` (project, client, task, tags, billable, converted_at) read live from the time entry behind the series' most recent link, filtered through the core booking rules; every meeting carries an opaque HMAC `series_key` and the final Phase 5 payload shape.

## What was built

- **Migration `2026_11_18_000001`**: `outlook_meeting_links` gains `series_master_id` (string 255, nullable) with index `(user_id, series_master_id, created_at)`, `signals` jsonb, `prefill_source` string(20), `prefill_kept` boolean; `up()` calls a public `backfill()` (one `UPDATE ... FROM outlook_meetings` by user_id + graph_id). Docblock records the D-16 hit-rate query and the APP_KEY rotation caveat.
- **Link capture**: `MeetingConversionController::convertOne` writes `series_master_id` from the locked meeting row; `OutlookMeetingLink` fillable/casts/@property updated.
- **Value objects**: `Assignment` (toArray in UTC `Y-m-d\TH:i:s\Z`), `MeetingHints` (`none()`), `SeriesKey::of()` (first 16 hex of `hash_hmac('sha256', 'series|'.$id, app.key)`).
- **`BookableProjects`**: mirrors the core `TimeEntryStoreRequest` project rule via `PermissionStore::userHas` (`time-entries:create:all` / `projects:view:all`, else `visibleByEmployee`), plus `archived_at` null; `openTasks()` (done_at null), `existingTags()`.
- **`SeriesAssignmentResolver`**: one DISTINCT ON query over links joined to time_entries (`te.user_id = l.user_id`, `te.organization_id` = current org, `l.user_id` = session user) for all visible series, then batched project/task/tag lookups; single meetings, dismissed occurrences and other users' meetings never get an assignment.
- **Read wiring**: `OutlookMeetingController::index` resolves the current organization (current_team_id + Member row, else null) and builds one `OutlookMeetingResource($meeting, MeetingHints)` per meeting; early-empty path unchanged; top-level keys unchanged.
- **Resource**: adds `series_key`, `series_ignored`, `assignment`, `suggestions`; no Graph id or series id is serialized.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 502d5ebb | feat(05-01): pre-assign the other occurrences of a converted series in the meetings read |
| 2 | 74311c0f | feat(05-01): series assignment obeys core booking rules and stays in the user's own data |
| 3 | cd043343 | test(05-01): series history survives disconnect and re-sync, backfill, bounded read cost |

## Tests

`OutlookSeriesAssignmentTest` (17 tests, 713 lines): pre-assigns others, opaque shared series key, read converts nothing, latest wins, entry edit moves the series, other organization ignored (positive control after switching current org), reassigned entry, archived project without fallback, project no longer bookable, done task and deleted tag dropped, dismissed and single meetings, no current organization, another user's conversions, link records series, backfill, disconnect + re-sync with round A fixtures, query count 2 vs 20 occurrences equal. `OutlookMeetingEndpointTest::test_resource_has_exactly_the_allow_listed_keys` updated to the 13 sorted keys.

Exact-shape grep run before the shape change: the only per-meeting key assertion was `OutlookMeetingEndpointTest` line 378 (updated). The `assertExactJson` calls in `OutlookMeetingEndpointTest:256` and `OutlookMeetingPrivacyTest:233/433/435` assert empty `data` arrays and the unchanged top level, so they still hold.

## Gates

- Gate P (Pint `--test` on app/Microsoft365 + tests/Feature/Microsoft365, full-app PHPStan): passed after every task.
- Extra: PHPStan level 5 on the new test file: only the pre-existing `create(array_merge(...))` argument-type pattern shared with the copied `meeting()` helper (tests are outside the phpstan.neon paths).
- Gate U: no unit tests in this plan. Running `tests/Unit/Microsoft365` locally shows 12 failures, all in `SocialiteMicrosoftGatewayTest` ("boolean is not OpenSSLAsymmetricKey"). That is a local portable-PHP OpenSSL key-generation issue in a file this plan did not touch.
- Gate W / Gate B: handed to the orchestrator for the merged wave-1 sha (target at least 96 Microsoft365 PASS lines, 32 classes). A red test in `OutlookSeriesAssignmentTest` or the endpoint keys test gets fixed in this plan when reported.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test class needs InteractsWithGraphFixtures for connectedAccount()**
- **Found during:** Task 2 (static check of the test file)
- **Issue:** `connectedAccount()` is defined in `InteractsWithGraphFixtures`, not in `InteractsWithMicrosoft365`. The Task 1 commit used only the latter, so the employee helper would have errored in CI.
- **Fix:** added `use InteractsWithGraphFixtures;` in the Task 2 commit (Task 3 needed it anyway).
- **Commit:** 74311c0f

**2. [Design note] Resolver injected per call, not in the controller constructor**
- `index(MeetingRangeRequest $request, SeriesAssignmentResolver $resolver)` follows the existing `sync()` method-injection pattern, so the PermissionStore-backed lookup is never held on a route-cached controller under Octane.

No core file touched (`git diff 1468222e -- app/Models/Project.php app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php app/Http/Controllers/Api/V1/TimeEntryController.php` is empty).

## CI expectations / open items

- PHPUnit feature tests could not run locally (no Postgres). Watch these in CI: the DISTINCT ON SQL, the anonymous-migration `require` in the backfill test, and the fixture disconnect/re-sync test.
- `test_latest_conversion_wins` and the archived test use `travel(5)->seconds()` between conversions because `created_at` has second precision. Two conversions in the same second fall back to the later occurrence (`meeting_starts_at desc`).

## Known Stubs

- `series_ignored` is always false and `suggestions` always `[]` on purpose. 05-06 (ignore/forget) and 05-09 (learned suggestions) fill them, as the plan intends.

## Self-Check: PASSED

- All 7 created files and 5 modified files exist.
- Commits 502d5ebb, 74311c0f and cd043343 are ancestors of HEAD.
