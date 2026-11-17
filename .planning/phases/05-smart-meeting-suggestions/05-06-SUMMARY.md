---
phase: 05-smart-meeting-suggestions
plan: 06
subsystem: microsoft365-series-controls
tags: [m365, outlook, series, ignore, forget, privacy]
status: complete
requires: [05-01, 05-04]
provides:
  - outlook_series_settings table and OutlookSeriesSetting model (ids and times only)
  - OutlookSeriesController ignore / unignore / forget
  - routes microsoft.meetings.series.ignore (POST), .unignore (DELETE), .forget (DELETE /series/assignment)
  - read filter for ignored series and seriesIgnored hints with include_dismissed
  - forget filter in SeriesAssignmentResolver (links created after forgotten_at only)
  - OutlookSeriesSettingsTest helpers (employee, week, occurrence, ignore, unignore, forget, convertTo, item, assignedProjectOf, settingOf)
affects: [05-05, 05-07, 05-09]
requirements-completed: [RULE-04, RULE-05]
tech-stack:
  added: []
  patterns:
    - insertOrIgnore on the unique (user_id, series_master_id) + conditional update for race-free idempotent series settings
key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_18_000003_create_outlook_series_settings_table.php
    - app/Microsoft365/Models/OutlookSeriesSetting.php
    - app/Microsoft365/Http/Controllers/OutlookSeriesController.php
    - tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Suggestions/SeriesAssignmentResolver.php
    - tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php
decisions:
  - "Series settings rows are created with insertOrIgnore and then updated conditionally (ignored_at only when null; forgotten_at always moves to now), so concurrent calls never hit the unique index and every call is idempotent"
  - "Stop ignoring never creates a settings row (204 without a row); ignore and forget do"
  - "Ignored series ids are loaded with one extra query only when include_dismissed is set; the default read filters them with an inline whereNotExists, so the read's query count is unchanged"
  - "The forget filter keeps a link only when forgotten_at is null or l.created_at > forgotten_at (second precision): a conversion in the same second as the forget does not count"
completed: 2026-11-17
duration: ~35 min
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 12600
  tasks: 3
  commits: 3
plan_head_before: 7bee5345dbb5a9914789c0e34dee357cfab84647
plan_head_after: 74a4dc6bbc58cdaf820feb85309cc7b2e6530a0d
---

# Phase 5 Plan 06: Series Controls (ignore, stop ignoring, forget) Summary

Server side of "Always ignore this series", "Stop ignoring" and "Forget this series": a per-user `outlook_series_settings` table (ids and times only), three web-group routes keyed by one of the user's own meetings, the read filter and `series_ignored` hints, and a forget cut-off in the series pre-assignment resolver.

## What was built

- **Table + model:** `outlook_series_settings` (uuid id, user_id FK users cascade, series_master_id, nullable ignored_at / forgotten_at, timestamps, unique user+series). No FK to the meetings table, so it survives Disconnect and re-syncs like the links; it goes away with the user. `OutlookSeriesSetting` is not audited and not in Filament.
- **Controller (`OutlookSeriesController`):** `ignore` (POST `/m365/meetings/{meeting}/series/ignore`), `unignore` (DELETE same URL), `forget` (DELETE `/m365/meetings/{meeting}/series/assignment`), all 204 and idempotent. The lookup matches the dismiss lookup: impersonation, foreign, unknown and gone ids, plus single meetings (no series), all give the same 404. It writes only `outlook_series_settings`.
- **Routes:** `whereUuid('meeting')`, `throttle:60,1,m365-series:`, names `microsoft.meetings.series.{ignore,unignore,forget}`, inside the m365 web group. There are now eight `microsoft.meetings.*` routes.
- **Read (`OutlookMeetingController::index`):** without include_dismissed, occurrences of an ignored series are left out with an inline `whereNotExists`. With include_dismissed they come back with `series_ignored: true` and no assignment, and they keep their own `dismissed` flag.
- **Resolver (`SeriesAssignmentResolver`):** left-joins the settings and counts only links where `forgotten_at` is null or `l.created_at > forgotten_at`. After a forget the series has no assignment until its next conversion.
- **Tests:** new `OutlookSeriesSettingsTest` (12 tests, 589 lines): hide all occurrences, undo, a no-op undo, the include_dismissed variant, idempotent ignore, the forget lifecycle, forget moving forward, the 404 matrix incl. impersonation, the web-session route stack, surviving Disconnect, deletion with the user, and conversion not un-ignoring (D-18). `OutlookMeetingPrivacyTest`: `assertCount(8, $routes)`, the needles now include `OutlookSeriesSetting` and `outlook_series_settings`, a not-Auditable assertion, and the new `test_series_actions_never_touch_time_entries` (D-12 snapshot around ignore, read, unignore, forget, read).

## Commits

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | 8bf5866c | feat(05-06): always ignore a recurring series in the meetings read |
| 2 | 825206be | feat(05-06): stop ignoring, faded ignored series and forget this series |
| 3 | 74a4dc6b | test(05-06): privacy, data-safety and lifecycle invariants for series settings |

## Gates

- Pint `--test app/Microsoft365 tests/Feature/Microsoft365`: passed.
- PHPStan (full app, level 7, worktree-first autoload loader): `[OK] No errors` after each task. In one run during Task 1 a parallel worker crashed (host contention from other agents); the re-run was clean.
- PHPStan over the two touched test files (informational, tests are not in phpstan.neon paths): only the same generic-TestResponse / `create()` array-shape noise the existing M365 tests already have. No unknown classes or methods.
- PHPUnit feature tests need Postgres and run in CI only (Gate W / Gate B belong to the orchestrator).

## Exact-shape check

I grepped all tests for route counts, `assertExactJson`, `getRoutes()` and needle lists. Only `OutlookMeetingPrivacyTest` needed changes (5 -> 8 routes, needles). `OutlookMeetingEndpointTest::test_meetings_routes_are_not_under_api_and_use_the_web_group` (m365/ prefix, web, auth:web, verified) also holds for the new routes. The resource key list is unchanged (`series_ignored` already existed). The query-count test in `OutlookSeriesAssignmentTest` is unaffected because the default read adds no query.

## Deviations from Plan

**1. [Rule 3 - Blocking] vendor junction in the worktree.** The worktree had no `vendor`. I created a junction to the main checkout's vendor (it is gitignored, so nothing was committed) and used a worktree-first loader at `scratchpad/wt-autoload-ab62.php`.

**2. [Rule 2 - Correctness] extra tests beyond the behavior list:** `test_stop_ignoring_a_series_that_was_never_ignored_is_a_no_op` and `test_every_forget_moves_the_moment_forward` pin down the idempotency and "every forget moves it forward" rules the action text states.

Otherwise the plan was executed as written. TDD note: the feature tests cannot run locally (no Postgres), so each task commits its tests together with the implementation. CI is the RED/GREEN judge.

## Known Stubs

None.

## Threat Flags

None. The new surface (three routes) is exactly the one in the plan's threat register (T-05-20..24), and the tests cover each mitigation.

## Self-Check: PASSED

- FOUND: app/Microsoft365/database/migrations/2026_11_18_000003_create_outlook_series_settings_table.php
- FOUND: app/Microsoft365/Models/OutlookSeriesSetting.php
- FOUND: app/Microsoft365/Http/Controllers/OutlookSeriesController.php
- FOUND: tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php
- FOUND commits: 8bf5866c, 825206be, 74a4dc6b
