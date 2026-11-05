---
phase: 03-outlook-meetings-in-the-calendar
plan: 02
subsystem: api
tags: [laravel, microsoft-graph, outlook, endpoints, validation, form-request, resource]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: OutlookMeetingSyncService, OutlookMeeting and OutlookSyncWindow models, GraphCalendarClient, OutlookMeetingEligibility, InteractsWithGraphFixtures
provides:
  - GET /m365/meetings (microsoft.meetings.index), cache-only read for the session user
  - POST /m365/meetings/sync (microsoft.meetings.sync), always HTTP 200 with {status, retry_after, last_synced_at, truncated}
  - MeetingRangeRequest (strict UTC Z range, end after start, 35 day cap, rangeStart()/rangeEnd())
  - OutlookMeetingResource (explicit 9 key allow-list)
  - Contract tests for endpoints, eligibility verdicts per Phase 1 scenario and the Graph client paging rules
affects: [03-03, 03-04, 03-06, 03-09, 03-10, 03-11, 03-12]

actuals:
  tokens: 8800
  tasks: 3
  commits: 3
  plan_head_before: 616f5f9b9b831bdc997abdb3f79e3601820e4460
  plan_head_after: 277a7bc7cce05bac63e4647fa4f8fc377476bda0

tech-stack:
  added: []
  patterns:
    - "Calendar endpoints live in the web group under /m365, never under api/, so openapi.json stays untouched"
    - "Range is half-open [start, end) via starts_at < end AND ends_at > start; order start, end, graph_id"
    - "Every sync outcome, failures included, is HTTP 200 with a status so the calendar keeps rendering from the cache"

key-files:
  created:
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Requests/MeetingRangeRequest.php
    - app/Microsoft365/Http/Resources/OutlookMeetingResource.php
    - tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php
    - tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php
    - tests/Unit/Microsoft365/GraphCalendarClientTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php

key-decisions:
  - "index keeps whereNull('dismissed_at') as the plan states; the include_dismissed switch is added by 03-09 together with restore"
  - "No code change was needed in the 03-01 client, eligibility class or parser: every new contract test passed against them as written"
  - "CAL-03 stays pending in REQUIREMENTS.md: this plan delivers the owner-scoped wire contract, 03-11 and 03-12 close it end to end"

patterns-established:
  - "MeetingRangeRequest is the single place that parses the visible range (UTC Z form only, no offset form, no user id field)"
  - "last_synced_at in the read response comes from the sync window recorded for exactly (start, end); null when that range was never fully synced"

requirements-completed: [SYNC-01, SYNC-03]

duration: 50min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 02: Meetings HTTP endpoints and contract tests Summary

**A cache-only GET /m365/meetings and a sync POST /m365/meetings/sync, both scoped to the session user, with the half-open range, stable order, strict UTC validation and the eligibility and Graph-client rules pinned against every Phase 1 scenario; all four required CI workflows green on Postgres 15/16/17.**

## Performance

- **Duration:** ~50 min (includes about 7 min of CI wait)
- **Tasks:** 3 of 3
- **Files:** 6 created, 1 modified

## Accomplishments

- `GET /m365/meetings` reads `outlook_meetings` only (no HTTP request, asserted with `Http::assertNothingSent()`), returns `{data, sync: {last_synced_at}}` with the nine allow-listed keys and `Y-m-d\TH:i:s\Z` timestamps.
- `POST /m365/meetings/sync` delegates to `OutlookMeetingSyncService::sync()` and returns `SyncOutcome::toArray()` with HTTP 200 for every outcome (ok, not_connected and the failure statuses).
- Both routes sit in a third group with the same stack as the Phase 2 authenticated group (`web`, `EnsureMicrosoftIsEnabled`, `auth:web`, `auth.session`, `verified`) under the `m365` prefix, throttled 60/min (read) and 12/min (sync); a test asserts the URI starts with `m365/` and the gathered middleware.
- `MeetingRangeRequest` rejects missing values, date-only, offset form, end <= start and spans over 35 days with 422; the bad-range test asserts no Graph request is sent after the sync POST. Exactly 35 days is accepted.
- Owner scoping proved for employee, manager and owner of one organization plus an unrelated user; a `user_id` query parameter changes nothing. Guests get 401 on JSON, and a blank client id turns both routes into 404.
- `OutlookMeetingEligibilityTest` fixes a verdict for S1, S1b, S2, S3 round B, S5 round B, S6, S6b, S7, S8, SYN-confidential and SYN-personal (events loaded through manifest.json), plus synthetic variants (removed flags fail closed, declined, other response statuses, non-string id).
- `GraphCalendarClientTest` pins the empty page with a nextLink, five unsafe nextLink shapes (foreign host, http, userinfo trick, look-alike host, explicit port: one request, Unavailable, bearer only to graph.microsoft.com), the page cap as partial, the token closure value as Bearer on every page, the Prefer header on every page, a failing token closure and `parseGraphUtc`.

## Task Commits

1. **Task 1: endpoints tracer (controller, request, resource, routes, two feature tests)** - `c252c2b7` (feat)
2. **Task 2: eligibility and Graph-client contract tests** - `d5150800` (test)
3. **Task 3: read endpoint contract tests and CI gate** - `277a7bc7` (test)

Tracer gate: Task 1 verify (Pint, PHPStan) passed before the contract tests were added.

## CI Gates (pushed HEAD 277a7bc7, PHPUnit Tests run id 42075436319)

- **Gate A:** `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success` (exact match)
- **Gate B:** grep count printed `12` (OutlookMeetingSyncTest 3, OutlookMeetingEndpointTest 3, OutlookMeetingEligibilityTest 3, GraphCalendarClientTest 3; 4 classes x 3 Postgres jobs); no test FAIL lines in the log
- Local: Pint `--test` passed; PHPStan over the full `app/` (CI scope) `No errors`; the two unit test classes (31 tests) also ran green locally. PHPStan on the `app/Microsoft365` subpath alone reports an unmatched ignore pattern from `phpstan.neon` (a baseline pattern for other code), so the full-app run is the meaningful gate, as in 03-01.
- Feature tests need Postgres and were verified in CI only.
- Acceptance checks: route name greps 1/1, `throttle:12,1` 1, TimeEntry reference in controller 0, endpoint test methods 13 (>= 12), eligibility test methods 6 (>= 4), `git diff --quiet 93a823bc HEAD -- openapi.json` exit 0, `git status --porcelain -- app tests config` empty after the push.

## Files Created/Modified

See key-files. Changed size about 34 KB (about 8.8k tokens at chars/4).

## Decisions Made

See key-decisions.

## Deviations from Plan

None - plan executed exactly as written. (One in-flight slip, not a plan deviation: two files edited through a Python one-liner on Windows came out with CRLF line endings; `pint` normalised them before the commit, and the committed diffs are LF.)

## Issues Encountered

- A multi-heredoc shell call was rejected by the shell for quoting reasons before it wrote anything; the test files were written with the Write tool instead.

## Known Stubs

None.

## Threat Flags

None. The two routes are exactly the surface of the plan's threat model (T-03-01, T-03-06, T-03-35, T-03-36), each with a test: role matrix and ignored `user_id`, web group middleware assertion, 422 and throttles, foreign-host and http nextLink refusal.

## Next Phase Readiness

The calendar UI plans (03-06 onward) can call `microsoft.meetings.index` and `microsoft.meetings.sync` with a UTC Z range. 03-03 replaces the token seam with a real refresh grant; 03-09 adds dismiss, restore and `include_dismissed` on top of the same request and resource classes.

## Self-Check: PASSED

- Files present: OutlookMeetingController.php, MeetingRangeRequest.php, OutlookMeetingResource.php, microsoft365.php, OutlookMeetingEndpointTest.php, OutlookMeetingEligibilityTest.php, GraphCalendarClientTest.php
- Commits are ancestors of HEAD: c252c2b7, d5150800, 277a7bc7
