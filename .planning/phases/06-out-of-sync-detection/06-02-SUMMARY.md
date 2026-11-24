---
phase: 06-out-of-sync-detection
plan: 02
subsystem: microsoft365-graph
tags: [graph, outlook, lookup, out-of-sync, config]
status: complete
requires:
  - GraphCalendarClient (Phase 3) token-closure, Prefer and throttling conventions
  - OutlookMeetingSyncService::parseGraphUtc() (public static)
  - tests/Fixtures/M365/lookups/{S3,S4,S5,S5b}.roundB.json (Phase 1)
provides:
  - App\Microsoft365\Graph\EventLookupStatus (Present, Cancelled, Removed, Unknown, Throttled, Reconnect)
  - App\Microsoft365\Graph\EventLookup (final readonly; status, start, end, allDay, retryAfter, httpStatus; named constructors)
  - GraphCalendarClient::event(Closure $token, string $graphId): EventLookup
  - config('microsoft365.out_of_sync') block (lookups_per_sync 5, lookups_per_job 300, dispatch_stagger_seconds 10, daily_at '05:30', daily_timezone 'Europe/Madrid', lock_seconds 30, auto_adjusted_days 7)
affects: [06-08, 06-09, 06-06, 06-15]
requirements-completed: [OSYNC-01, OSYNC-02]
key-files:
  created:
    - app/Microsoft365/Graph/EventLookupStatus.php
    - app/Microsoft365/Graph/EventLookup.php
    - tests/Unit/Microsoft365/GraphEventLookupTest.php
  modified:
    - app/Microsoft365/Graph/GraphCalendarClient.php
    - config/microsoft365.php
decisions:
  - "Lookup of one occurrence: only 404 + error.code ErrorItemNotFound is Removed; every other non-2xx (other 404s incl. no-mailbox codes, 5xx without Retry-After, 400), timeouts, malformed bodies and missing/non-UTC/inverted times are Unknown (D-07)"
  - "Cancelled is returned on isCancelled === true even when times are missing; the times are carried only when parseable (informative)"
  - "A token-closure GraphException maps Throttled -> Throttled (retryAfter or default 30, http 429), Reconnect -> Reconnect, anything else -> Unknown"
completed: 2026-11-24
metrics:
  duration: ~25 min
  tasks: 2
  files: 5
estimate:
  tokens: 55000
  tasks: 2
actuals:
  tokens: 7000
  tasks: 2
  commits: 2
plan_head_before: fef7d29fe1aebc808c44d15a3f532a6f6889e3a4
plan_head_after: 3d25b896ff3b15e21fab3657f723b76e7c2efe38
---

# Phase 6 Plan 02: Graph single-occurrence lookup Summary

`GraphCalendarClient::event()` looks up one linked Outlook occurrence by its immutable id (GET /me/events/{id}, rawurlencoded id, UTC + ImmutableId Prefer) and classifies the answer as present / cancelled / removed / unknown / throttled / reconnect. Only a 404 ErrorItemNotFound counts as removed. The plan also adds the phase's `out_of_sync` config block, with no new environment variables.

## What was built

- **EventLookupStatus** (string enum): its docblock says what each status means for the out-of-sync rules. Unknown, Throttled and Reconnect never flag an entry.
- **EventLookup** (final readonly): `status`, `?CarbonImmutable start/end` (UTC), `allDay`, `?retryAfter`, `?httpStatus`. Named constructors: `present`, `cancelled`, `removed`, `unknown`, `throttled`, `reconnect`.
- **GraphCalendarClient::event()** uses one literal URL `https://graph.microsoft.com/v1.0/me/events/{rawurlencode(id)}?$select=id,start,end,isCancelled,isAllDay,type,seriesMasterId` and the same private `get()` (Prefer, Accept, bearer, configured timeouts). It follows the same token contract as `calendarView`: `$token(null)` first, and after a 401/403 a single `$token($rejected)` forced refresh and one retry. A second rejection answers Reconnect. A 429, or a 503/504 that carries Retry-After, answers Throttled with `RetryAfter::seconds()` and is not retried. A `ConnectionException` answers Unknown. A 2xx goes through `parseGraphUtc()`. The class docblock now says the client is read-only, uses the Calendars.Read scope and logs nothing.
- **config/microsoft365.php**: the `out_of_sync` block, each value with a one-line comment. `env(` count is still 7.
- **GraphEventLookupTest**: 22 test methods, 30 cases with data providers. `fixtureResponse()` replays the Phase 1 captures: S5 and S5b are Present at their new UTC times, S3 is Cancelled and S4 is Removed (the error body is rebuilt from `errorCode`). The test also checks the request shape (Prefer, bearer, `$select`, an id containing `/`, `=` and `+` arriving encoded), all-day, non-UTC, a missing time, a non-JSON body, refresh-once, 401/403 twice, 429 (including the clamp), 503 with and without Retry-After, 504, 500, 400, the no-mailbox and other 404s, a connection failure, token-closure Throttled / Reconnect / Unavailable, and the config constants.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 8d534f00 | feat(06-02): look up one linked Outlook occurrence by immutable id |
| 2 | 3d25b896 | feat(06-02): lookup failure mapping and out_of_sync config block |

## Gates

- Gate U: the local PHPUnit run (`GraphEventLookupTest`, `GraphCalendarClientTest`, `MicrosoftConfigTest`) ended with OK (96 tests, 307 assertions). It used a worktree-first bootstrap so `App\` resolves to the worktree.
- Pint `--test` on `app/Microsoft365/Graph`, `config/microsoft365.php` and the new test passed.
- Gate P: full-app PHPStan (`phpstan.neon`, worktree-first `--autoload-file`) reported No errors.
- Acceptance greps: `public function event` 1, `ErrorItemNotFound` at least 1, `rawurlencode($graphId)` 1, `'out_of_sync' =>` 1, `env(` 7, `public function test_` 22 (at least 12 required). `git status --porcelain` on the plan paths is empty after the commit.
- CI-only checks (Gate W / Gate B on the wave-1 CI run): PENDING CI (Actions disabled).

## Deviations from Plan

None that change the plan. Small interpretation choices:
- `EventLookup::cancelled()` also stores start/end/allDay when they can be parsed, because the S3 answer carries them. Times are not required for Cancelled.
- A token-closure failure other than Throttled or Reconnect (for example an Unavailable token endpoint) maps to Unknown, in line with D-07.
- Local PHPUnit ran with `--bootstrap` pointing at a scratchpad file. That file loads `vendor/autoload.php` and then a worktree-first `App\`/`Tests\` loader, because the vendor junction would otherwise resolve `App\` to the main checkout. This is tooling only; no repository change.

## Threat model

- T-06-06: only 404 + ErrorItemNotFound is Removed, and every other failure is Unknown. The data-provider test and the fixture replay cover this.
- T-06-07: the URL is a fixed graph.microsoft.com URL with a rawurlencoded id and goes through the shared Prefer/bearer helper. The client logs nothing.
- T-06-08: nothing is retried on 429 or 503/504 with Retry-After; the value is clamped by RetryAfter; the budgets are in config.
- T-06-SC: no packages were installed.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Graph/EventLookupStatus.php, app/Microsoft365/Graph/EventLookup.php, tests/Unit/Microsoft365/GraphEventLookupTest.php
- FOUND: commits 8d534f00, 3d25b896 (both ancestors of HEAD)
