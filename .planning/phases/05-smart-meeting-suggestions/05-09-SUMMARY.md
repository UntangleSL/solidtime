---
phase: 05-smart-meeting-suggestions
plan: 09
subsystem: microsoft365-suggestions
tags: [suggestions, calendar-read, privacy, forget, ignore, confirm]
requires: [05-01, 05-02, 05-03, 05-05, 05-06]
provides:
  - "App\\Microsoft365\\Suggestions\\SuggestionHistory::load(User, Organization)"
  - "App\\Microsoft365\\Suggestions\\MeetingSuggester::forMeetings(User, Organization, meetings)"
  - "GET /m365/meetings fills `suggestions` for meetings without assignment (not dismissed, not series-ignored)"
affects: [05-10, 05-11, 05-12]
requirements-completed: [RULE-03, RULE-05]
key-files:
  created:
    - app/Microsoft365/Suggestions/SuggestionHistory.php
    - app/Microsoft365/Suggestions/MeetingSuggester.php
    - tests/Feature/Microsoft365/OutlookMeetingSuggestionTest.php
  modified:
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php
    - tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php
decisions:
  - "History is loaded once per read (one query, 2000 links / 365 days, user's own links whose entry is still theirs in the current organization); forgotten flag computed in SQL (l.created_at <= s.forgotten_at), consistent with SeriesAssignmentResolver"
  - "No candidate meeting or empty history means no further query; the bookable filter runs once on the distinct history project ids"
  - "Engine is called statically (ProjectSuggestionEngine::rank, the 05-02 API) with MeetingSignals::labels() of the target as labels and excludeSeries = the target's series"
status: complete
completed: 2026-11-17
metrics:
  duration: ~25min
  started: 2026-11-17T17:50:00Z
  finished: 2026-11-17T18:17:00Z
actuals:
  tokens: 11500
  tasks: 3
  commits: 3
plan_head_before: 3424999b3264166b8874f5c341e7468b4f1d5b36
plan_head_after: 895554a44ef96bb74d94545ba41d878b84d94ba7
---

# Phase 5 Plan 09: Learned suggestions in the calendar read Summary

Every meeting of GET /m365/meetings that has no series assignment and is neither dismissed nor of an ignored series now carries up to three projects ranked by the pure engine from the session user's own conversions in the current organization, each with project name, color, client name, `confident` and a one-line reason (display name or bare domain, count); the score and any attendee data stay on the server.

## What was built

- **SuggestionHistory** (`app/Microsoft365/Suggestions/SuggestionHistory.php`): one query over `outlook_meeting_links l` joined to `time_entries te` (`te.id = l.time_entry_id AND te.user_id = l.user_id`), left-joined to `outlook_series_settings s`; scoped to `l.user_id` = session user, `te.organization_id` = current organization, project not null, signals not null, `created_at` within `WINDOW_DAYS = 365`, newest first, `MAX_ROWS = 2000`. Rows with an unknown signals `v` are skipped. Returns `{project_id, age_days, series, forgotten, signals}`.
- **MeetingSuggester** (`app/Microsoft365/Suggestions/MeetingSuggester.php`): returns `[]` without touching the DB when there is no meeting; otherwise loads the history once, drops non-bookable projects (`BookableProjects::projects`, one call), computes identity and secret once, then per meeting builds features via `MeetingSignalInput::fromMeeting()`, hashes them, passes `MeetingSignals::labels()` as labels, ranks with `excludeSeries = series_master_id`, and merges project display data into `Suggestion::toArray()`.
- **OutlookMeetingController::index**: calls the suggester once per read with the meetings without assignment, not dismissed and not series-ignored; fills `MeetingHints.suggestions`. Impersonation still returns the early empty answer. Without a current organization there are no suggestions.
- **Tests**: new `OutlookMeetingSuggestionTest` (12 tests: tracer, no suggestions on pre-assigned occurrences, other users, other organizations + reassigned entries, archived/unbookable, impersonation, privacy, dismissed/ignored, 365-day window, constant query count 1 vs 15, read never writes, forgotten series does not suggest itself). `OutlookSeriesSettingsTest` gained `test_confirm_after_forget_answers_no_assignment` and `test_confirming_an_ignored_occurrence_keeps_the_series_ignored`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 18f82a8f | feat(05-09): learned project suggestions in the calendar read |
| 2 | f44306dd | test(05-09): scoping, privacy and cost of learned suggestions |
| 3 | 895554a4 | test(05-09): forget and ignore end to end with confirm and suggestions |

## Gates

- Gate P (Pint `--test` on `app/Microsoft365` + `tests/Feature/Microsoft365`, full-app PHPStan): passed after every task, `[OK] No errors`.
- Gate U (`tests/Unit/Microsoft365/ProjectSuggestionEngineTest.php`): `OK (22 tests, 69 assertions)`.
- PHPUnit feature tests need Postgres and run only in CI. Not run locally.
- **Gate W and Gate B (at least 102 Microsoft365 PASS lines, 34 classes) are handed over to the orchestrator** for the merged and pushed wave-3 sha (this plan is the wave-3 anchor). If any test in this plan's classes fails there, it gets fixed in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Exact-shape assertion broken by filled `suggestions`**
- **Found during:** Task 1 (grep of every test asserting on `suggestions`)
- **Issue:** `OutlookSeriesAssignmentTest::test_converting_one_occurrence_pre_assigns_the_others` asserted `suggestions === []` for every row. With learning live, the single meeting `single-d` shares the subject word "subject" with the converted occurrence ("Subject occ-a"), so it now gets a low-confidence subject suggestion. The plan expected that no exact-shape test would need an update.
- **Fix:** the empty-list assertion now covers only the pre-assigned occurrences B and C. The single meeting may carry a suggestion.
- **Files modified:** tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php. This file is not in files_modified, but no parallel wave-3 plan touches it (05-10..12 are frontend).
- **Commit:** 18f82a8f

**2. [Acceptance wording] `->rank(` grep**
- The criterion `grep -cF -e "->rank(" MeetingSuggester.php` prints 0: the 05-02 engine API is static, so the call is `ProjectSuggestionEngine::rank(` (exactly one call). I did not inject the engine just to satisfy the grep.

**3. Test design choice**
- Meetings in `OutlookMeetingSuggestionTest` default to `subject = null`, so subject words do not add noise and the expected reasons and confidence stay deterministic.

## Known Stubs

None.

## Threat Flags

None. No new endpoint. The read's payload gains only project display data and a reason, as the 05-01 resource shape planned (T-05-30..34 are covered by tests).

## Self-Check: PASSED

- FOUND: app/Microsoft365/Suggestions/SuggestionHistory.php
- FOUND: app/Microsoft365/Suggestions/MeetingSuggester.php
- FOUND: tests/Feature/Microsoft365/OutlookMeetingSuggestionTest.php
- FOUND: 18f82a8f, f44306dd, 895554a4 (ancestors of HEAD)
