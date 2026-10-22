---
phase: 02-sign-in-with-microsoft
plan: 01
subsystem: auth
tags: [laravel, microsoft-entra, oauth, inertia, postgres, phpunit]

requires:
  - phase: 01-graph-spike
    provides: Entra single-tenant app registration, tenant-wide access decision, scope list
provides:
  - Fork provider app/Microsoft365 registered by one line in config/app.php
  - GET /auth/microsoft/redirect and /auth/microsoft/callback (microsoft.redirect, microsoft.callback)
  - MicrosoftOAuthGateway seam (method-injected, no production binding yet) and MicrosoftIdentity DTO
  - MicrosoftIdentityResolver: (tid, oid) lookup and provisioning as verified passwordless employee
  - microsoft_accounts table (unique user_id, unique tenant_id + microsoft_oid, encrypted token columns)
  - Test support FakeMicrosoftOAuthGateway and trait InteractsWithMicrosoft365
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10, 02-11]

actuals:
  tokens: 8767
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Fork code isolated in app/Microsoft365 with its own provider, routes and migrations (D-15)"
    - "OAuth library hidden behind an interface that controllers receive by method injection"
    - "MicrosoftConfig reads the config repository on every call and is bound with bind(), never singleton"
    - "Controller logs only a fixed reason plus the exception class on failure"

key-files:
  created:
    - config/microsoft365.php
    - app/Microsoft365/Microsoft365ServiceProvider.php
    - app/Microsoft365/MicrosoftConfig.php
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Auth/MicrosoftOAuthGateway.php
    - app/Microsoft365/Auth/MicrosoftIdentity.php
    - app/Microsoft365/Auth/MicrosoftIdentityResolver.php
    - app/Microsoft365/Models/MicrosoftAccount.php
    - app/Microsoft365/database/migrations/2026_10_22_000001_create_microsoft_accounts_table.php
    - tests/Feature/Microsoft365/Support/FakeMicrosoftOAuthGateway.php
    - tests/Feature/Microsoft365/Support/InteractsWithMicrosoft365.php
    - tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php
  modified:
    - config/app.php

key-decisions:
  - "Provisioned users join through MemberService::addMember with the default non-superadmin path (replaces RESEARCH Assumption A6)"
  - "MicrosoftAccount is not Auditable so audit rows can never capture tokens"
  - "Callback never reads exception text; log context is exactly reason=unexpected and the exception class"
  - "Login uses remember=false: passwordless users cannot use remember-me"

patterns-established:
  - "Feature tests drive the real HTTP stack with a fake gateway bound in the container"
  - "Test identities use example.test emails, 00000000-0000-4000-8000-* GUIDs and short token markers"

requirements-completed: [AUTH-01]

coverage:
  - id: D1
    description: "Redirect stores a valid browser timezone in the session and hands off to the bound gateway"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php#test_redirect_stores_valid_browser_timezone_and_hands_off_to_gateway"
        status: pass
    human_judgment: false
  - id: D2
    description: "First Microsoft sign-in provisions a verified passwordless employee in the configured organization and lands on /dashboard (200)"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php#test_first_sign_in_provisions_verified_passwordless_employee_and_lands_on_dashboard"
        status: pass
    human_judgment: false
  - id: D3
    description: "Returning identity, encrypted tokens, safe failure path and identity isolation within one process"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php (6 tests added by Task 2)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-10-22
status: complete
plan_head_before: 333269550ca82de8a6d9629f5cdc7e392ffb42a5
plan_head_after: ca4f7869e9c0dfbd2fe4e72be2e6a96fa570fb92
---

# Phase 2 Plan 01: Backend tracer for Sign in with Microsoft Summary

**Redirect and callback routes, a method-injected gateway seam, a (tid, oid) resolver and an encrypted-token microsoft_accounts table, proven end to end by a fake-gateway feature test (9 tests) that is green on Postgres 15/16/17.**

## Performance

- **Duration:** about 30 min (start time was not captured; estimated from commit timestamps)
- **Completed:** 2026-10-22
- **Tasks:** 2 (1 tracer, 1 auto/tdd)
- **Files modified:** 14 (13 created, 1 core file edited: `config/app.php`)

## Accomplishments

- Tracer slice walks redirect -> callback -> provisioned employee -> `/dashboard` 200 through every backend fork layer. Gate A and Gate B passed for the Task 1 commit before Task 2 started (tracer feedback gate).
- Provisioning follows D-04: verified, passwordless, role `employee` in the configured organization, `current_team_id` set, no personal organization (the core user-creation service is not referenced anywhere in `app/Microsoft365`).
- Returning `(tid, oid)` logs the same user in again with no new `users` or `microsoft_accounts` rows; two identities handled in one process yield two distinct users.
- Tokens exist only in the `text` columns of `microsoft_accounts`, as ciphertext, hidden from serialization.
- Any `Throwable` in the callback returns a guest to `/login` with no side effects; the log line carries only `reason` and the exception class (asserted with a marker message).
- Only `config/app.php` changed among core files (two lines: the import and the provider entry).

## Task Commits

1. **Task 1: Tracer slice (redirect, callback, provisioning)** - `033c2ec3` (feat)
2. **Task 2: Returning users, encrypted tokens, safe failure, no identity bleed** - `ca4f7869` (test)

## Verification Evidence

- Gate A for `033c2ec3` and for `ca4f7869`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`.
- Gate B for both commits: 3 (one `PASS Tests\Feature\Microsoft365\MicrosoftSignInFlowTest` per Postgres 15/16/17 job).
- Local: Pint `--test` passed, full PHPStan run `[OK] No errors`, `validate-docs.mjs secrets` -> `secrets: OK (1844 checks)`, `route:list` shows both routes.
- Acceptance greps: `Microsoft365ServiceProvider::class` in `config/app.php` = 1; no `Inertia::share`, `env(`, `UserService`, `asSuperAdmin` or `getMessage()` under `app/Microsoft365`; `composer.json` and `composer.lock` unchanged vs `d866733b`; `public function test_` count = 9 (needs at least 8).
- Playwright was still running when this was written; it is not one of the four plan gates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PHPStan gate run on the full `app/` tree instead of `app/Microsoft365` only**
- **Found during:** Task 1 verification
- **Issue:** `phpstan analyse ... app/Microsoft365` exits non-zero with "Ignored error pattern ... was not matched in reported errors" because the repo's `phpstan.neon` ignore pattern only matches in other parts of `app/`. This is a property of analysing a subset, not of the new code.
- **Fix:** ran `phpstan analyse --configuration=phpstan.neon` over the configured `app/` paths (what CI runs): `[OK] No errors`. `phpstan.neon` was not modified. Later plans that copy the `app/Microsoft365`-only command will hit the same message and should run the full analysis.
- **Files modified:** none
- **Commit:** n/a

**2. [Plan wording] Task 1 redirect test split into two test methods**
- The plan's single `test_redirect_stores_valid_browser_timezone_and_hands_off_to_gateway` behavior (valid and invalid timezone) is covered by two methods: that one (valid) and `test_redirect_ignores_an_invalid_browser_timezone`. Same assertions, clearer failures. No source change.

No behavior failed in Task 2, so no source fixes were needed in the controller, resolver or model.

## Authentication Gates

None.

## Known Gaps (not stubs)

- `MicrosoftOAuthGateway` has no production binding by design (02-04 adds the Socialite gateway). Until then a real request to `/auth/microsoft/redirect` or `/callback` fails with a container binding error (HTTP 500) in a deployed image. Nothing links to these routes yet, and 02-02 adds the 404 gate for unconfigured installs. Do not enable the Microsoft env vars in Dokploy before 02-04.
- `__('microsoft365.error.generic')` has no lang file yet (02-02), so the login page flash shows the raw key until then.
- Provisioning refusal is a plain `RuntimeException('provisioning_unavailable')`; 02-02 replaces it with the typed D-05 refusal and message.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-02 .. T-02-05, T-02-SC): the new `/auth/microsoft/*` routes are throttled (`throttle:30,1`), redirect only to named routes, and no packages were installed.

## Issues Encountered

- `composer install` printed 7-Zip symlink privilege errors for `gotenberg/gotenberg-php` and fell back to ZipArchive automatically; the install completed and `composer.json`/`composer.lock` were untouched.

## Next Phase Readiness

02-02 can build on the stable contracts: `MicrosoftConfig`, `MicrosoftOAuthGateway`, `MicrosoftIdentity`, `MicrosoftIdentityResolver::resolve`, and the test support classes. The `microsoft_accounts` schema is final for Phase 2.

## Self-Check: PASSED

- FOUND: all 14 files from `files_modified` (13 created under `app/Microsoft365`, `config/microsoft365.php`, `tests/Feature/Microsoft365`, plus the `config/app.php` edit)
- FOUND: commits `033c2ec3` and `ca4f7869` are ancestors of HEAD
