---
phase: 05-smart-meeting-suggestions
plan: 05
subsystem: microsoft365-conversion
tags: [convert-endpoint, confirm-mode, series-assignment, signals, hit-rate, phpunit]
status: complete
requires:
  - "05-01 SeriesAssignmentResolver::forMeeting(), link columns series_master_id/signals/prefill_source/prefill_kept"
  - "05-02 MeetingSignals::features() / hashed()"
  - "05-03 MeetingSignalInput::fromMeeting() / identity()"
  - "05-04 lang key microsoft365.calendar.error_no_assignment, client confirm body"
provides:
  - "POST /m365/organizations/{organization}/meetings/time-entries accepts {meeting_ids, use_series_assignment: true} (confirm mode)"
  - "Per-meeting failure key 'no_assignment' (message: microsoft365.calendar.error_no_assignment)"
  - "MeetingConversionRequest::usesSeriesAssignment(), prefillSource(), prefillProjectId(), PREFILL_SOURCES"
  - "Every new outlook_meeting_links row carries signals (keyed hashes), prefill_source and prefill_kept"
affects: [05-09, 05-10, 05-11, 05-12]
requirements-completed: [RULE-02, RULE-03]
key-files:
  created: []
  modified:
    - app/Microsoft365/Http/Requests/MeetingConversionRequest.php
    - app/Microsoft365/Http/Controllers/MeetingConversionController.php
    - tests/Feature/Microsoft365/OutlookMeetingConversionTest.php
decisions:
  - "Confirm mode resolves the assignment after the row lock and the existing-link check, so a converted occurrence answers 'existing' before any resolution and a series changed or archived since the read answers with the newest state"
  - "prefill_kept is only recorded for a prefilled project (source series/suggestion/last_used and a prefill_project_id); 'none' or no prefill fields record null; confirm mode records series/true"
  - "The user's identity (own addresses, internal domains) and the HMAC secret (app.key) are computed once per request, not per meeting"
  - "Dismissed occurrences confirm as no_assignment (the resolver never assigns a dismissed occurrence)"
completed: 2026-11-17
duration: ~7min
plan_head_before: 7bee5345dbb5a9914789c0e34dee357cfab84647
plan_head_after: 22912e11f524d5574af0a1576732ed1fa2dbeea3
actuals:
  tokens: 10300
  tasks: 3
  commits: 3
---

# Phase 5 Plan 05: Confirm mode, learning signals and prefill measurement Summary

The Phase 4 convert endpoint now has a confirm mode. With `{meeting_ids, use_series_assignment: true}` the server resolves each meeting's series assignment inside that meeting's transaction and creates the entry through core with the series' project, task, tags and billable, the meeting's own times and its subject. A meeting without a usable assignment fails on its own with `no_assignment`. Every new link also stores the meeting's signals as keyed hashes and records how the form was prefilled, so the D-16 hit rate is one SQL query.

## What was built

- **Request (`MeetingConversionRequest`)**
  - `use_series_assignment` (sometimes, boolean).
  - In confirm mode, `project_id`, `billable`, `task_id`, `tags`, `description`, `start`, `end`, `prefill_source` and `prefill_project_id` are prohibited (422).
  - In explicit mode, `project_id` and `billable` are still required.
  - `prefill_source` must be one of series, suggestion, last_used or none. `prefill_project_id` is a uuid.
  - New accessors: `usesSeriesAssignment()`, `prefillSource()`, `prefillProjectId()`.
- **Controller (`MeetingConversionController`)**
  - The constructor now injects `SeriesAssignmentResolver` and `MeetingSignalInput`.
  - In confirm mode, `forMeeting()` runs after the lock and the existing-link check. If it returns null, the meeting fails with `no_assignment`.
  - The link insert adds three fields:
    - `signals`: `MeetingSignals::hashed(MeetingSignals::features(fromMeeting($meeting), own, internal), app.key)`
    - `prefill_source`
    - `prefill_kept`
  - Nothing is logged: the grep gate for `Log::` and `logger(` finds 0 matches.
  - The response shape is unchanged.
- **Tests:** `OutlookMeetingConversionTest` has 15 new tests, taking it from 29 to 44.
  - Task 1: `test_confirm_uses_the_series_assignment`.
  - Task 2: signals stored as keyed hashes, the organizer skipped when the user organizes, meetings without attendee data, prefill_kept, the series prefill, and an invalid prefill_source returning 422.
  - Task 3: prohibited explicit fields, no assignment, a mixed batch, `existing`, the impersonation 404, the overlap rule, an archived project, and another organization.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | d2ad597b | feat(05-05): confirm pre-assigned meetings through the convert endpoint |
| 2 | acb0cdc8 | feat(05-05): store keyed-hash signals and prefill measurement on every link |
| 3 | 22912e11 | test(05-05): confirm-mode matrix for the convert endpoint |

## Gates

- Gate P passed after every task:
  - `pint --test app/Microsoft365 tests/Feature/Microsoft365` passed.
  - Full-app PHPStan reported `[OK] No errors`.
- Acceptance greps:
  - `use_series_assignment` appears in the request (4 times).
  - `'no_assignment'`, `forMeeting(`, `MeetingSignals::hashed` and `'prefill_kept'` each appear once in the controller.
  - `Log::|logger\(` appears 0 times.
  - The test file has 44 `test_` methods and 1 `test_confirm_is_404_while_impersonating`.
  - `git status --porcelain -- app/Microsoft365 tests/Feature/Microsoft365` is clean.
- PHPUnit feature tests run only in CI because there is no local Postgres. Not run locally.
- **Wave-2 anchor hand-over:** the orchestrator runs Gate W and Gate B on the merged and pushed wave-2 sha.
  - Gate W: the eight workflows must be `=success`.
  - Gate B: at least 99 Microsoft365 PASS lines across 33 classes.
  - If a test in OutlookMeetingConversionTest fails in CI, it gets fixed under this plan.

## Deviations from Plan

None in behavior. Two minor points:
- **Test fixture domain:** in `test_link_stores_keyed_signals`, the internal colleague is `colleague@example.test`, not `colleague@untangle.es`. The test config's allowed domain is `example.test`, so that is the address that counts as internal. The assertions are the same as the plan's: a has 1 entry, i has 1, d has 1, plus the leak checks.
- **Grep counts:** the controller docblock says "see MeetingSignals", and `prefill()` has a single return. Both changes keep the plan's exact grep counts at 1.

## Exact-shape check

I searched the tests for link-row assertions. The `linkRow()` before/after comparisons in `OutlookMeetingLinkLifecycleTest` compare a row with itself after edits and resyncs, and the link is never rewritten, so they are unaffected. No other test asserts the exact link-row shape. The convert response shape is unchanged.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Http/Requests/MeetingConversionRequest.php
- FOUND: app/Microsoft365/Http/Controllers/MeetingConversionController.php
- FOUND: tests/Feature/Microsoft365/OutlookMeetingConversionTest.php
- FOUND commits: d2ad597b, acb0cdc8, 22912e11 (ancestors of HEAD)
