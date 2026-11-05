---
phase: 03-outlook-meetings-in-the-calendar
plan: 01
subsystem: api
tags: [microsoft-graph, calendarView, laravel, postgres, outlook, eligibility, utc]

requires:
  - phase: 02-microsoft-sign-in
    provides: MicrosoftAccount with encrypted tokens, isConnected(), MicrosoftConfig
  - phase: 01-graph-spike
    provides: sanitized calendarView fixtures and DECISIONS-graph.md (production $select, Prefer header, eligibility signals)
provides:
  - outlook_meetings and outlook_sync_windows tables with OutlookMeeting and OutlookSyncWindow models
  - GraphCalendarClient (literal calendarView URL, combined Prefer header on every page, nextLink host check, page cap)
  - OutlookMeetingEligibility (fail-closed SYNC-03 filter)
  - MicrosoftTokenService::accessToken seam (refresh grant lands behind it in 03-03)
  - OutlookMeetingSyncService::sync() and parseGraphUtc()
  - SyncStatus, SyncOutcome, GraphException contract types
  - InteractsWithGraphFixtures test support
affects: [03-02, 03-03, 03-04, phase-04, phase-05, phase-06]

actuals:
  tokens: 9600
  tasks: 2
  commits: 2
  plan_head_before: 15d807277c94150ed0ddc9b6c43136d19d60b904
  plan_head_after: 5f75f4855fb01a78a0b2f6721c73c996ce63d0d7

tech-stack:
  added: []
  patterns:
    - "Graph reads through a plain stateless client; token obtained via a Closure(?string rejected) so the token service can refresh later"
    - "Eligibility filter runs before any row is built; upsert with explicit update column list"
    - "Manifest-driven fixture replay via Http::sequence in tests"

key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_05_000001_create_outlook_meetings_tables.php
    - app/Microsoft365/Models/OutlookMeeting.php
    - app/Microsoft365/Models/OutlookSyncWindow.php
    - app/Microsoft365/Graph/SyncStatus.php
    - app/Microsoft365/Graph/SyncOutcome.php
    - app/Microsoft365/Graph/GraphException.php
    - app/Microsoft365/Graph/GraphCalendarClient.php
    - app/Microsoft365/Graph/OutlookMeetingEligibility.php
    - app/Microsoft365/Graph/MicrosoftTokenService.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php
    - tests/Feature/Microsoft365/OutlookMeetingSyncTest.php
  modified:
    - config/microsoft365.php

key-decisions:
  - "Failure mid-traversal still stores the eligible rows fetched so far but records no sync window and returns the failure status"
  - "Non-UTC detection is separate from row parsing so the Log::warning count only covers eligible events with a foreign zone"
  - "Token closure failures (GraphException) are caught inside GraphCalendarClient and surface as failure status, so the service never sees an exception"

patterns-established:
  - "SyncOutcome::toArray() is the stable wire shape {status, retry_after, last_synced_at, truncated}"
  - "nextLink is followed only for https + host graph.microsoft.com without userinfo or port"

requirements-completed: [SYNC-01, SYNC-03, SYNC-04]

duration: 45min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 01: Graph-to-cache backend tracer Summary

**A connected user's Outlook meetings are fetched from Graph calendarView (literal URL, combined Prefer header on all 22 round A pages), filtered fail closed, and cached in UTC in outlook_meetings, proven green in CI on Postgres 15/16/17.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 of 2
- **Files:** 12 created, 1 modified

## Accomplishments

- Round A prod-select replay (22 pages) stores exactly the 12 eligible events; S6 (private) and S7 (all-day) never reach the database, S8 (personal block) does; S2 occurrences stored as 2026-10-20 08:00:00 and 2026-10-27 09:00:00 UTC.
- Every request (first URL and every nextLink) is a GET with Bearer and `Prefer: outlook.timezone="UTC", IdType="ImmutableId"`; first URL asserted literally against the production `$select`.
- Account gating: no account or disconnected -> `not_connected` without Graph; expired token -> `unavailable` without Graph (03-03 replaces that branch with a refresh).
- `outlook_sync_windows` row only for failure-free traversals; non-UTC events skipped with a count-only log line.
- Time-entry rows unchanged after a sync (test) and no sync class references time entries (grep).

## Task Commits

1. **Task 1: Graph-to-cache tracer (migration, models, client, eligibility, service, fixture test)** - `c1b36336` (feat)
2. **Task 2: token seam, sync windows, account state, non-UTC skipping, config** - `5f75f485` (feat)

Tracer gate: Task 1 verify (Pint + PHPStan) passed before expansion; full-app PHPStan and Pint were re-run after Task 2.

## CI Gates (pushed HEAD 5f75f485, run PHPUnit Tests id 42068705910)

- **Gate A:** `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success` (exact match)
- **Gate B:** `grep -c "PASS.*Microsoft365.OutlookMeetingSyncTest"` printed `3` (1 class x 3 Postgres jobs)
- Local: Pint `--test` passed; PHPStan over the full `app/` (CI scope) reported `No errors`.

Acceptance greps: outlook_sync_windows count 2; cascadeOnDelete 2; production $select present once; `IdType="ImmutableId"` 1; `graph.microsoft.com` 2; TimeEntry/time_entries in Graph dir 0; `env(` in app/Microsoft365 0; `parseGraphUtc` public static 1; `'max_pages'` 1; test methods 9 (>= 8).

## Files Created/Modified

See key-files above. Total changed size about 38 KB (about 9.6k tokens at chars/4).

## Decisions Made

See key-decisions. The assumption-delta decision of the plan (no-change) stands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PHPStan identical.alwaysFalse on createFromFormat**
- **Found during:** Task 1 verification
- **Issue:** `CarbonImmutable::createFromFormat` returns `?CarbonImmutable` in this Carbon version; the `=== false` guard was dead code
- **Fix:** return the call result directly (null on failure)
- **Files modified:** app/Microsoft365/Graph/OutlookMeetingSyncService.php
- **Commit:** c1b36336 (fixed before the commit)

### Notes

- The plan's local verify command `phpstan analyse ... app/Microsoft365` reports `Ignored error pattern ... Relation was not matched` (the repo-wide ignore in phpstan.neon is unmatched when only the fork directory is analysed). This is a scoping artifact, not a code error; the full-app run (what CI runs) is clean, so full-app was used as the local gate.
- `git pull --rebase` refused because the orchestrator-owned `.planning/STATE.md` is modified in the tree; the remote had no new commits, so the push was a plain fast-forward (`15d80727..5f75f485`).
- `parseGraphUtc` was made `public static` from Task 1 instead of Task 2 (same final state, avoids a pointless rename).

Otherwise the plan was executed as written.

## Issues Encountered

None. PHPUnit cannot run locally (no Postgres); first CI run was green.

## Threat Flags

None. No new endpoints or trust boundaries beyond the plan's threat model (T-03-02..05 mitigated: nextLink host check, fail-closed eligibility before insert, no time-entry code, page cap and timeouts).

## Known Stubs

None.

## Next Phase Readiness

03-02 can build the HTTP endpoint on `OutlookMeetingSyncService::sync()` and `SyncOutcome::toArray()`; 03-03 replaces the `Unavailable` branch of `MicrosoftTokenService::accessToken` with the refresh grant; 03-04 refines failure mapping (throttling, retry-after) in `GraphCalendarClient`, which currently maps any non-2xx to `unavailable`.

## Self-Check: PASSED

All 12 created files exist; commits c1b36336 and 5f75f485 are ancestors of HEAD and on origin/feature/m365-integration.
