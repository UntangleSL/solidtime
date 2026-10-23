---
phase: 02-sign-in-with-microsoft
plan: 08
subsystem: auth
tags: [laravel, microsoft-entra, disconnect, connect, inertia, i18n, phpunit]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-02 redirect/callback controller and typed failures; 02-06 resolver with advisory lock; 02-07 session semantics and the Microsoft sign-in completed log line"
provides:
  - "DELETE /user/microsoft (microsoft.account.destroy): nulls tokens, expiry and scopes, sets disconnected_at, keeps the identity row and every time entry"
  - "Sign-in while disconnected authenticates without re-storing tokens (decided under the row lock)"
  - "GET /auth/microsoft/redirect?intent=connect and MicrosoftIdentityResolver::connect(): reconnect, link, identity_in_use / already_linked refusals"
  - "Token-free microsoft.account Inertia payload on profile.show only, with server-rendered labels"
  - "lang/es/microsoft365.php mirroring lang/en (locale stays en)"
affects: [02-09, 02-10, 02-11, phase-03]

actuals:
  tokens: 21000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Connect intent exists only as session state written by redirect(); callback() pulls it before the authenticated dashboard shortcut and never reads it from the query"
    - "Disconnect and sign-in serialise on the microsoft_accounts row lock, so tokens can never sit next to a set disconnected_at"
    - "Profile-only Inertia payload computed inside the lazy shared closure behind routeIs('profile.show')"

key-files:
  created:
    - app/Microsoft365/Http/Controllers/MicrosoftAccountController.php
    - lang/es/microsoft365.php
    - tests/Feature/Microsoft365/MicrosoftAccountTest.php
    - tests/Unit/Microsoft365/MicrosoftLangTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Auth/MicrosoftIdentityResolver.php
    - app/Microsoft365/Models/MicrosoftAccount.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - lang/en/microsoft365.php

key-decisions:
  - "Disconnect keeps the microsoft_accounts row (tenant, oid, user, email) so a passwordless user is never locked out (D-10, D-19)"
  - "A Connect callback whose session user is gone redirects to /login with the interrupted message (profile.show needs auth); every other connect outcome returns to /user/profile with a flashed microsoft365.notice"
  - "Connect callbacks run the same MicrosoftIdentityGuard as sign-in, and log 'Microsoft connect rejected/failed' with a fixed reason only"
  - "Disconnect takes lockForUpdate on the row inside a transaction, matching the resolver's lock, to close the sign-in race"

patterns-established:
  - "Test users for authenticated Microsoft flows come from User::factory()->withPersonalOrganization(); passwordless variant via ['password' => null]"

requirements-completed: [AUTH-07]

coverage:
  - id: D1
    description: "Disconnect nulls tokens, expiry and scopes, sets disconnected_at, keeps the identity row, leaves time entries byte-identical, is a no-op without a row or when repeated, requires auth and only affects the current user"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftAccountTest.php::test_disconnect_* (4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A passwordless user can still sign in after disconnecting; the sign-in stores no tokens and keeps disconnected_at"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftAccountTest.php::test_sign_in_after_disconnect_works_without_storing_tokens"
        status: pass
    human_judgment: false
  - id: D3
    description: "Connect restores tokens for the same identity, links an unlinked user, refuses identity_in_use and already_linked, rejects a mismatching session user, and the authenticated connect callback reaches the gateway before the dashboard shortcut; a query-string intent is ignored; session keys are cleared on every exit"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftAccountTest.php::test_connect_* and test_authenticated_connect_callback_runs_before_dashboard_shortcut and test_callback_query_intent_is_ignored_without_session_intent"
        status: pass
    human_judgment: false
  - id: D4
    description: "Profile page carries microsoft.account (linked, connected, email, has_password, URLs, notice, labels) with no token or token key, only on profile.show, absent when unconfigured, notice shown once"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftAccountTest.php::test_profile_* and test_account_payload_is_only_on_the_profile_page and test_disconnect_notice_reaches_the_next_profile_response_once"
        status: pass
    human_judgment: false
  - id: D5
    description: "lang/es mirrors every lang/en key (and placeholder), no empty values, app locale stays en"
    requirement: AUTH-07
    verification:
      - kind: unit
        ref: "tests/Unit/Microsoft365/MicrosoftLangTest.php (4 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A sign-in racing a Disconnect never leaves tokens next to a set disconnected_at"
    requirement: AUTH-07
    verification:
      - kind: other
        ref: "Backstop by construction: both paths lockForUpdate the same row in a transaction and the resolver re-reads disconnected_at under that lock; no concurrent test"
        status: backstop
    human_judgment: false

duration: 45min
completed: 2026-10-23
status: complete
commits: 2
plan_head_before: 7e30c47bbea9c409f144b04dd47f71dba39e78f9
plan_head_after: 21cfe305910ca89aaaf62b43cb89ca12dab0a914
---

# Phase 2 Plan 08: Disconnect, Connect and the profile account payload Summary

**Users can Disconnect Microsoft (tokens nulled, identity link and time entries kept so nobody is locked out) and explicitly Connect again through a session-held intent that the callback evaluates before its dashboard shortcut, with a token-free `microsoft.account` profile payload and English plus prepared Spanish copy.**

## Accomplishments

- `MicrosoftAccountController::destroy` (`DELETE /user/microsoft`, same middleware stack as core's authenticated group, no id parameter): inside a transaction it locks the current user's row, nulls `access_token`, `refresh_token`, `access_token_expires_at`, `scopes`, sets `disconnected_at` once, and redirects to `profile.show` with a flashed notice. No time entry or user field is touched.
- `MicrosoftIdentityResolver`: `storeSignIn` writes tokens only when the locked row has no `disconnected_at` (email and `last_login_at` still update); new `connect(MicrosoftIdentity, User)` uses the same advisory lock, row lock and single unique-violation retry as `resolve()`, with `IdentityInUse` / `AlreadyLinked` refusals and a link-or-reconnect write.
- `MicrosoftAuthController`: `redirect()` handles `intent=connect` first (guest to `/login`, authenticated stores `microsoft.intent` and `microsoft.connect_user_id`), then the old dashboard shortcut, then the sign-in hand-off. `callback()` pulls both session keys on entry and, when the intent is connect, completes the connect before the authenticated-user shortcut; the query string is never read for the intent. The 02-07 `Microsoft sign-in completed` line is untouched.
- `ShareMicrosoftInertiaData`: `microsoft.account` (booleans, Microsoft email, URLs, one-time notice, eleven labels) computed only when `routeIs('profile.show')`; no token column is referenced in the file.
- `lang/en` gained the 13 profile/notice keys; `lang/es/microsoft365.php` mirrors all `ui` and `error` keys; `MicrosoftLangTest` checks key parity, non-empty values, placeholder parity and that the locale stays `en`.
- `MicrosoftAccountTest`: 22 tests (15 for Disconnect/Connect, 7 for the profile payload).

## Task Commits

1. **Task 1: Disconnect and Connect backend** - `16592a89` (feat)
2. **Task 2: profile payload and English/Spanish copy** - `21cfe305` (feat)

## Verification Evidence

- Local: Pint passed; full PHPStan `analyse` no errors (documented Rule 3: path-scoped analysis is not used); `MicrosoftLangTest` 4 tests, 144 assertions OK; en/es `ui` and `error` key arrays identical.
- Acceptance greps: `microsoft.account.destroy` 1, `TimeEntry|->delete()` in the account controller 0, `public function connect(` 1, `function isConnected` 1, `Microsoft sign-in completed` 1, no `guest`/`RedirectIfAuthenticated` in the routes file 0, `access_token|refresh_token` in the middleware 0, `Iniciar sesión con Microsoft` 1, `'locale' => 'en'` 1.
- CI for `21cfe305` (pushed after `git pull --rebase`, no conflict): Gate A printed `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`; Gate B (`MicrosoftAccountTest`, `MicrosoftLangTest`, `MicrosoftTokenStorageTest`, `ProfileInformationTest` across Postgres 15/16/17) = 12. Playwright was still queued when read and is not a gate.

## Deviations from Plan

None - plan executed exactly as written. First CI run was green, no fix commits.

## Decisions Made

- `ui.disconnected_notice` is flashed even when there was no row or it was already disconnected; the redirect is still a silent no-op with no error.
- A connect callback with no authenticated user goes to `/login` with the `interrupted` message instead of `profile.show`, because the profile route would bounce a guest to login and drop the flash notice.
- `connected_as` label is the empty string when no Microsoft email exists (the UI uses `not_connected` in that state).

## Known Stubs

None.

## Threat Flags

None. DELETE /user/microsoft and the connect branch are the surfaces named in T-02-26 to T-02-30; no new network endpoint, auth path or schema change beyond them.

## Issues Encountered

None.

## Next Phase Readiness

02-10 can render the profile section from the fixed `microsoft.account` contract (`linked`, `connected`, `email`, `has_password`, `connect_url`, `disconnect_url`, `notice`, `labels.*`) and submit `DELETE disconnect_url` with Inertia. Phase 3 can reuse `?intent=connect` as the "Reconnect Microsoft" entry point.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Http/Controllers/MicrosoftAccountController.php, lang/es/microsoft365.php, tests/Feature/Microsoft365/MicrosoftAccountTest.php, tests/Unit/Microsoft365/MicrosoftLangTest.php
- FOUND commits: 16592a89, 21cfe305 (ancestors of HEAD)
