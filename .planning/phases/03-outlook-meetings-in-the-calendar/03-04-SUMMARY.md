---
phase: 03-outlook-meetings-in-the-calendar
plan: 04
subsystem: api
tags: [laravel, microsoft-graph, throttling, retry-after, cache-lock, reconcile]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: GraphCalendarClient, OutlookMeetingSyncService, MicrosoftTokenService, graph_backoff_until column, sync endpoint, Graph fixtures
provides:
  - RetryAfter helper (integer seconds clamped 1..300, default 30)
  - Persisted Graph back-off (429, 503/504 with Retry-After, token endpoint 429) honoured without HTTP
  - 60 s reuse window, 10 s forced minimum interval, per-user lock (coalesced), 15 s deadline
  - sync.retry_after on GET /m365/meetings, force flag on the sync request
  - Typed degradation: unavailable (5xx, timeouts, unknown 404) and no_mailbox (allow-listed 404 codes)
  - Reconcile of moved, cancelled and removed meetings on complete traversals only, scrub of ineligible rows
affects: [03-06, 03-07, 03-08, 03-11]

actuals:
  tokens: 17400
  tasks: 3
  commits: 2
  plan_head_before: ad9e3f8f7cf2505e6eff6e47711a93c4ecab6dfe
  plan_head_after: 6e52bd290b794eee356e38a16964f9af8b5dc448

tech-stack:
  added: []
  patterns:
    - "Sync guards run twice (before and after the per-user lock) so a sync that finished while the request waited is reused, not repeated"
    - "gone_at is set only after a complete traversal without failure; a positive ineligible sighting scrubs subject, organizer_name and web_link at any time"
    - "Tests script all Graph answers in one Http::fake (a later Http::fake does not override an earlier one)"

key-files:
  created:
    - app/Microsoft365/Graph/RetryAfter.php
    - tests/Feature/Microsoft365/OutlookSyncResilienceTest.php
  modified:
    - app/Microsoft365/Graph/GraphCalendarClient.php
    - app/Microsoft365/Graph/MicrosoftTokenService.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - app/Microsoft365/Models/MicrosoftAccount.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Requests/MeetingRangeRequest.php
    - app/Microsoft365/routes/microsoft365.php
    - config/microsoft365.php
    - tests/Unit/Microsoft365/GraphCalendarClientTest.php
    - tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php

key-decisions:
  - "Reads and syncs get separate throttle counters (prefixes m365-read: and m365-sync:), because unnamed throttle middleware shares one counter per user across all routes"
  - "A throttled outcome carries no last_synced_at; the client reads it from GET, which also reports sync.retry_after"
  - "NoMailbox returns before storing or reconciling anything; no_mailbox logs at info level only"
  - "A truncated (page cap or deadline) traversal without failure still records the sync window and answers ok with truncated true, as in 03-01"

patterns-established:
  - "MicrosoftAccount::backoffRemainingSeconds() is the single reader of graph_backoff_until (service guard and read endpoint)"
  - "GraphCalendarClient::calendarView() result now carries http_status for the caller's log line only"

requirements-completed: []

duration: 95min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 04: Sync resilience Summary

**Graph throttling becomes a persisted Retry-After back-off that every later sync honours without a Graph call, repeated presses collapse into one traversal through a 60 s reuse window, a 10 s forced minimum and a per-user lock, outages and a missing mailbox degrade to typed statuses with the cache still served, and moved, cancelled or removed meetings are reconciled only after a complete traversal.**

## Accomplishments

- `RetryAfter::seconds()`: digits only become seconds clamped to 1..300 (very long digit strings cap at 300); null, empty, HTTP-date, negative, decimal and garbage give 30.
- `GraphCalendarClient`: 429 and 503/504 carrying Retry-After end the traversal as Throttled with the parsed wait and no in-request retry; 5xx without it, connection failures (timeout, refused) and unknown 404s are Unavailable; a 404 with `MailboxNotEnabledForRESTAPI` or `MailboxNotSupportedForRESTAPI` is NoMailbox (allow-list only); the 15 s deadline is checked before each page and ends the traversal as partial. Events collected so far are always kept. The result carries `http_status` for logging.
- `MicrosoftTokenService`: a token endpoint 429 throws Throttled with its Retry-After, tokens kept, nothing logged there.
- `OutlookMeetingSyncService`: guards in order (account state, persisted back-off, reuse window or forced minimum interval, non-blocking `m365:meetings-sync:{user_id}` lock answering Coalesced), repeated after the lock is taken; the lock is released in `finally`. Throttled persists `graph_backoff_until` and logs `Outlook sync degraded` with status and HTTP status only. Reconcile: ineligible sightings (cancelled, private, all-day, declined) set `gone_at` and null subject, organizer_name and web_link, also after a partial or failed traversal; unseen rows overlapping the window get `gone_at` only after a complete traversal with no failure; seen rows clear it; nothing is ever deleted; `dismissed_at` is never touched.
- `GET /m365/meetings` returns `sync.retry_after` (seconds left of the back-off or null); `POST /m365/meetings/sync` accepts a boolean `force`.
- Round A then round B over the fixture window leaves 9 visible meetings; S3, S4 and S5b are gone, S5 and the S2 exception keep their round A ids with the new times.

## Task Commits

The three tasks touch the same few files (client, service, controller), so they were committed together as one code commit and one test commit instead of three.

1. **Tasks 1-3 code (tracer back-off, reuse/lock/throttle, reconcile/scrub/error mapping):** `ef929bed` (feat)
2. **Tasks 1-3 tests (24 resilience test methods, 17 new unit cases, endpoint test update):** `6e52bd29` (test)

Tracer gate: Pint and full-app PHPStan passed locally before the push; the back-off tests (throttle persisted, no request during back-off, read endpoint retry_after) were green in the first CI run.

## CI Gates (pushed HEAD 6e52bd29, PHPUnit Tests run id 42082081595)

- **Gate A:** `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success` (exact match).
- **Gate B:** grep count printed `12` (OutlookSyncResilienceTest, GraphCalendarClientTest, OutlookMeetingSyncTest, MicrosoftTokenRefreshTest on 3 Postgres jobs); no FAIL markers in the log.
- Local: Pint `--test` passed; PHPStan over the full `app/` `No errors` (the `app/Microsoft365`-only run shows the known unmatched-ignore artifact, see 03-01); GraphCalendarClientTest, OutlookMeetingEligibilityTest and MicrosoftConfigTest ran green locally (85 tests). SocialiteMicrosoftGatewayTest fails locally only because the portable PHP cannot generate OpenSSL keys (unrelated, green in CI). Feature tests need Postgres and ran in CI only.
- Acceptance greps: `seconds` 1, `RetryAfter::seconds` 1, `graph_backoff_until` 2, controller `retry_after` 1, lock key 1, four config keys 4, `'force'` 2, both mailbox codes 1 each, `deadline_seconds` in client 1, delete/destroy in service 0, test methods 24 (>= 17).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reads and syncs shared one throttle counter**
- **Found during:** Task 2 (reading `ThrottleRequests::resolveRequestSignature`)
- **Issue:** Unnamed `throttle:N,M` middleware keys on the user alone, so every calendar read counted against the 12/min sync limit and normal navigation would exhaust it.
- **Fix:** Prefixes `m365-read:` and `m365-sync:` on the two routes; the throttle test makes 5 reads before the 12 syncs.
- **Files modified:** app/Microsoft365/routes/microsoft365.php
- **Commit:** ef929bed

**2. [Rule 1 - Bug] Existing endpoint test asserted the exact sync block**
- **Fix:** `OutlookMeetingEndpointTest` expects `retry_after: null` next to `last_synced_at`.
- **Commit:** 6e52bd29

**3. [Rule 2 - Missing critical functionality] Guards re-checked after taking the lock**
- **Issue:** A sync finishing between a request's reuse check and its lock acquisition would cause a second traversal.
- **Fix:** The same guard (state, back-off, reuse) runs again once the lock is held.

**4. [Process] Fewer commits than tasks.** The plan's tasks are interleaved in the same files, so there are two commits (code, tests) rather than three.

## Issues Encountered

- `Http::fake` called a second time does not override an earlier stub for the same URL (first match wins), so the resilience tests script every Graph answer, including a repeated round, in one fake.
- Two multi-line heredoc shell calls with triple quotes were rejected before writing anything; the fragments were written with the Write tool and spliced in with small scripts.
- Commit trailer: the harness attribution reminder (Claude Sonnet 5.5) was followed; earlier plans used the Opus 5.5 trailer named in the plan.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-03-11 (route throttle, lock, reuse window, back-off, deadline, page cap), T-03-12 (gone only after complete traversals, data-provider test), T-03-13 (positive-sighting scrub, test), T-03-14 (RetryAfter clamp and matrix).

## Requirements

SYNC-02 and SYNC-05 stay pending in REQUIREMENTS.md: the server side is delivered here, but the Sync button and the non-blocking status message need the calendar UI (03-06 to 03-08). SYNC-03 was already complete.

## Next Phase Readiness

The UI plans can send `force: true` from the Sync button, show the wait from `sync.retry_after` (also after a reload) and the statuses `throttled`, `unavailable`, `no_mailbox`, `reused` and `coalesced` from the sync answer, re-reading the cache after each.

## Self-Check: PASSED

- Files present: RetryAfter.php, OutlookSyncResilienceTest.php, GraphCalendarClient.php, OutlookMeetingSyncService.php
- Commits are ancestors of HEAD: ef929bed, 6e52bd29
