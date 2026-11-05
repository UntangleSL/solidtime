---
phase: 03-outlook-meetings-in-the-calendar
plan: 03
subsystem: api
tags: [laravel, microsoft-graph, oauth, token-refresh, row-lock, entra]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: MicrosoftTokenService seam, GraphCalendarClient, OutlookMeetingSyncService, sync endpoint, InteractsWithGraphFixtures
provides:
  - Silent refresh-token grant (tenant-pinned v2 endpoint, row lock, 120 s skew, post-lock check, one save)
  - Failure classification: terminal (reconnect), operator and transient (unavailable)
  - Graph 401/403 forced refresh and single retry, second rejection answers reconnect
  - MicrosoftAccount::needsReconnect() and calendarAccessState() (connected | reconnect | not_connected)
  - microsoft_accounts.reconnect_required_at and graph_backoff_until columns
affects: [03-04, 03-06, 03-07, 03-08, 03-11]

actuals:
  tokens: 12400
  tasks: 2
  commits: 3
  plan_head_before: 67f922952ce084a218324990dd9b4b23751357ec
  plan_head_after: 257e192583801ef586ad662b0781b2e7c7d1d634

tech-stack:
  added: []
  patterns:
    - "Token service returns a GraphException from inside the lock transaction and throws it afterwards, so markers written on the way are committed, not rolled back"
    - "Refresh failures are classified on the OAuth error string, never on AADSTS numbers; logs carry only a fixed reason and the AADSTS code"
    - "Tests fake the token endpoint and Graph in one Http::fake call (first matching stub wins), with a 500 default for stray Graph requests"

key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_05_000002_add_graph_state_to_microsoft_accounts_table.php
    - tests/Feature/Microsoft365/MicrosoftTokenRefreshTest.php
  modified:
    - app/Microsoft365/Models/MicrosoftAccount.php
    - app/Microsoft365/Graph/MicrosoftTokenService.php
    - app/Microsoft365/Graph/GraphCalendarClient.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - app/Microsoft365/Auth/MicrosoftIdentityResolver.php
    - app/Microsoft365/Http/Controllers/MicrosoftAccountController.php
    - tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php
    - tests/Feature/Microsoft365/OutlookMeetingSyncTest.php

key-decisions:
  - "An unconfigured integration (blank secret, non-GUID tenant) sends no token request and answers unavailable, so the authority is never a malformed or common/organizations URL (T-03-10)"
  - "markReconnectRequired() is a no-op once the marker is set or after a disconnect, so the sync service can call it for every Reconnect failure without double effects"
  - "SEC-02 stays pending in REQUIREMENTS.md: the backend signal is delivered, the Reconnect Microsoft prompt in the UI belongs to 03-07/03-08"

patterns-established:
  - "MicrosoftAccount::calendarAccessState() is the single source for how the calendar treats an account"
  - "GraphCalendarClient is the single mapping point of 'Graph rejects a fresh token' to Reconnect (Assumption A2)"

requirements-completed: []

duration: 75min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 03: Silent token refresh and reconnect classification Summary

**Expired Graph access tokens are refreshed silently with the tenant-pinned refresh grant under a row lock, and only user-fixable failures (invalid_grant, interaction_required, consent_required, a second Graph 401/403) become the persistent reconnect state; operator errors such as an expired client secret and outages answer unavailable and keep the tokens.**

## Accomplishments

- `MicrosoftTokenService::accessToken()` re-reads the row under `lockForUpdate()`, returns a token that is more than 120 s from expiry (also one a concurrent request just refreshed), otherwise POSTs the refresh grant (client_id, client_secret, grant_type, refresh_token, scope `Calendars.Read offline_access`) to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`. Success stores access token and expiry, replaces the refresh token only when one is returned, keeps the stored scopes, in one `save()`; both token columns are encrypted at rest (raw value differs from the token) and the passed model instance is updated too.
- Failure classification keyed on the OAuth `error`: terminal errors clear the three token fields and set `reconnect_required_at`; the six operator errors, `temporarily_unavailable`, `server_error`, other 4xx/5xx and connection failures keep the tokens and answer unavailable. Every failure logs exactly `{reason, provider_code}`.
- `GraphCalendarClient` forces one refresh on a 401/403 and retries the same page once; a second rejection ends the traversal with Reconnect, and `OutlookMeetingSyncService` persists it through `markReconnectRequired()`. Every Graph request stays a GET.
- `MicrosoftAccount::needsReconnect()` and `calendarAccessState()`: non-empty stored scopes without `Calendars.Read` (case-insensitive) mean reconnect without any HTTP request; empty or missing scopes never block. The sync gate uses it.
- Migration adds nullable `reconnect_required_at` and `graph_backoff_until`. Sign-in and Connect (`writeTokens`) clear `reconnect_required_at`; Disconnect clears both columns.
- `MicrosoftTokenRefreshTest`: 18 test methods (several data-provider driven) covering every must-have truth, including the log-hygiene sweep and the read-only assertion.

## Task Commits

1. **Task 1 (tracer): migration, account state, refresh grant, sync gate, five refresh tests** - `8b4d0808` (feat)
2. **Task 2: classification, 401/403 retry, marker resets, log hygiene, remaining tests** - `3473841e` (feat)
3. **CI fix: push prebuilt Graph answers as responses in the test sequence helper** - `257e1925` (test)

Tracer gate: Task 1 verify (Pint, PHPStan) passed before the expansion; the end-to-end behavior was proven by the Task 1 tests in CI (all five green on the first CI run).

## CI Gates (pushed HEAD 257e1925, PHPUnit Tests run id 42078997971)

- **Gate A:** `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success` (exact match).
- **Gate B:** grep count printed `12` (MicrosoftTokenRefreshTest, OutlookMeetingSyncTest, MicrosoftAccountTest, MicrosoftIdentityResolverTest, each on 3 Postgres jobs); zero FAILED/failure markers in the log.
- The first push (`3473841e`) failed PHPUnit: 4 tests errored on a test-helper bug (`ResponseSequence::push()` treats a `Http::response()` object as a body). Fixed in `257e1925`, nothing in app code changed. The first run's other tests, including all five tracer tests, were green.
- Local: Pint `--test` passed; PHPStan over the full `app/` (CI scope) `No errors` (the `app/Microsoft365`-only run shows the known unmatched-ignore scoping artifact, see 03-01). Feature tests need Postgres and ran in CI only.
- Acceptance greps: oauth2/v2.0/token 1, `Calendars.Read offline_access` 1, lockForUpdate 2, terminal error names 3, resolver `reconnect_required_at` 1, controller columns 2, test methods 18 (>= 15).

## Files Created/Modified

See key-files. Changed size about 50 KB of diff (about 12.4k tokens at chars/4).

## Decisions Made

See key-decisions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Unconfigured integration must send no token request**
- **Found during:** Task 2 (reviewing T-03-10 against the existing 03-01 test)
- **Issue:** With a blank secret or non-GUID tenant the refresh would POST to a malformed authority URL, and the 03-01 test `test_expired_token_without_refresh_answers_unavailable_without_graph` asserted `Http::assertNothingSent()` with no configuration.
- **Fix:** `refresh()` returns Unavailable (reason `client_error`) when `MicrosoftConfig::isConfigured()` is false; that 03-01 test now states its configuration explicitly and is renamed `test_expired_token_with_unconfigured_integration_answers_unavailable_without_http`; a new test covers it.
- **Files modified:** MicrosoftTokenService.php, OutlookMeetingSyncTest.php, MicrosoftTokenRefreshTest.php
- **Commit:** 3473841e

**2. [Rule 1 - Bug] Test helper pushed response objects as bodies**
- **Found during:** CI of 3473841e
- **Fix:** `graphSequence()` uses `pushResponse()`.
- **Commit:** 257e1925

## Issues Encountered

A multi-heredoc shell call was rejected (missing terminator) before writing anything; the PHP test fragment was written with the Write tool and spliced in with a small script.

## Known Stubs

None.

## Threat Flags

None. The surface is the plan's threat model: T-03-07 (row lock, post-lock check, stale-model test), T-03-08 (six operator errors keep tokens, data-provider test), T-03-09 (log sweep test), T-03-10 (authority only from the configured GUID tenant, unconfigured sends nothing).

## Next Phase Readiness

03-04 can write `graph_backoff_until` (column exists, cleared on Disconnect, token service treats 429 as transient for now). 03-06 to 03-08 can read `calendarAccessState()` and the sync status `reconnect` to show the "Reconnect Microsoft" prompt. SEC-02 closes once that UI exists.

## Self-Check: PASSED

- Files present: migration, MicrosoftTokenRefreshTest.php, MicrosoftTokenService.php, MicrosoftAccount.php
- Commits are ancestors of HEAD: 8b4d0808, 3473841e, 257e1925
