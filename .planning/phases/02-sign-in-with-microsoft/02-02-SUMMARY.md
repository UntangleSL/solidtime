---
phase: 02-sign-in-with-microsoft
plan: 02
subsystem: auth
tags: [laravel, microsoft-entra, inertia, octane, phpunit]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-01 tracer: routes, gateway seam, resolver, microsoft_accounts"
provides:
  - MicrosoftSignInFailure enum (11 fixed reasons, messageKey()) and MicrosoftSignInException
  - MicrosoftIdentityGuard::check (tenant + audience gate, pure)
  - Callback failure handling: cancelled, provider error, typed, unexpected -> /login with fixed English message
  - EnsureMicrosoftIsEnabled (404 on both routes when env incomplete)
  - ShareMicrosoftInertiaData (Octane-safe `microsoft` prop) pushed onto the web group
  - lang/en/microsoft365.php (ui + 11 error messages)
affects: [02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10, 02-11]

actuals:
  tokens: 12000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Expected failures are a typed exception carrying an enum; the controller logs reason + AADSTS code only"
    - "Inertia data shared from a web-group middleware, never from provider boot()"
    - "Enabled gate is route middleware so method-injected gateway is never resolved for a 404"

key-files:
  created:
    - app/Microsoft365/Auth/MicrosoftSignInFailure.php
    - app/Microsoft365/Auth/MicrosoftSignInException.php
    - app/Microsoft365/Auth/MicrosoftIdentityGuard.php
    - app/Microsoft365/Http/Middleware/EnsureMicrosoftIsEnabled.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - lang/en/microsoft365.php
    - tests/Feature/Microsoft365/MicrosoftLoginPageTest.php
  modified:
    - app/Microsoft365/Auth/MicrosoftIdentityResolver.php
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Microsoft365ServiceProvider.php
    - app/Microsoft365/routes/microsoft365.php
    - tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php

key-decisions:
  - "Error query only distinguishes access_denied; error_description is reduced to the first AADSTS\\d+ match and never reflected"
  - "Guard is a pure final class taking MicrosoftConfig; 02-05 extends check() with oid, guest and domain rules"
  - "Prop is shared via Inertia::share closure inside the middleware so it is re-evaluated per request"

patterns-established:
  - "Failure log: Log::warning('Microsoft sign-in rejected', {reason, provider_code}); unexpected Throwable keeps Log::error {reason: unexpected, exception}"

requirements-completed: []

coverage:
  - id: D1
    description: "Cancelled, provider-error, foreign tenant/audience, missing organization and typed gateway failures land on /login with a fixed English message, create nothing, and log only reason + AADSTS code"
    requirement: AUTH-02
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php (6 tests added + 1 extended)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Incomplete env turns integration off (404 routes, enabled false, gateway untouched); configured login page exposes only enabled/login_url/labels and survives an Inertia flush"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftLoginPageTest.php (5 tests)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-10-22
status: complete
plan_head_before: bd133827259b8b8bd5b2a877786f3d8335a907e9
plan_head_after: 5be04d6305a7797d329c2b0f38d25591c6b70685
---

# Phase 2 Plan 02: Fail-closed sign-in, off switch and login prop Summary

**Every unsuccessful Microsoft sign-in now returns to /login with a fixed English message and a log line holding only a reason and an AADSTS code; the integration is 404/disabled when its env is incomplete; the login page gets an Octane-safe `microsoft` prop.**

## Accomplishments

- `MicrosoftSignInFailure` (11 values + `messageKey()`) and `MicrosoftSignInException` are the shared contract for 02-03..02-10; the exception message is the reason value only.
- `MicrosoftIdentityGuard::check()` rejects a foreign `tid` (case-insensitive) or `aud` (exact) before any DB work; the resolver now throws the typed `ProvisioningUnavailable` for a missing, non-UUID or unknown organization.
- Callback signature is `(Request, Gateway, Guard, Resolver)`. An `error` query short-circuits without calling the gateway. The authenticated-user shortcut stays a controller branch for 02-08.
- `EnsureMicrosoftIsEnabled` sits right after `web` in the route group; `ShareMicrosoftInertiaData` is pushed onto the `web` group in `boot()` and shares `{enabled}` or `{enabled, login_url, labels}`.
- `lang/en/microsoft365.php` holds the button labels and all 11 error messages (Appendix B copy plus the two plan-specified strings).

## Task Commits

1. **Task 1: Typed failures, tenant/audience guard, login-page messages** - `c86c69be` (feat)
2. **Task 2: Off switch and Octane-safe login prop** - `5be04d63` (feat)

## Verification Evidence

- Local: Pint `--test` passed, full PHPStan `[OK] No errors`, lang check (11 errors, button label) exit 0, `validate-docs.mjs secrets` -> `secrets: OK (1852 checks)`, `route:list` shows both routes. Acceptance greps all as specified (guard has no `DB::`/`Log::`, no `getMessage()` under `app/Microsoft365`, no `Inertia::share` in the provider, `pushMiddlewareToGroup` = 1).
- Gate A for `5be04d63`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`.
- Gate B (`MicrosoftSignInFlowTest`, `MicrosoftLoginPageTest`): 6 (one PASS per class per Postgres 15/16/17 job).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PHPStan gate run on the full configured `app/` tree instead of `app/Microsoft365` only**
- **Found during:** Tasks 1 and 2 verification
- **Issue:** Same as 02-01: analysing a path subset makes `phpstan.neon` fail with "Ignored error pattern ... was not matched".
- **Fix:** ran `phpstan analyse --configuration=phpstan.neon` with no path (what CI runs): `[OK] No errors`. `phpstan.neon` untouched.
- **Files modified:** none
- **Commit:** n/a

**2. [Plan wording] Task 1 and Task 2 verified locally with Pint and PHPStan, behavior tests in CI only**
- As the plan states, PHPUnit needs Postgres. Task 1's behaviors were first exercised in CI at the Task 2 push (a single push covers both commits). Both green on the first run, so no source fixes were needed.

## Authentication Gates

None.

## Requirements

AUTH-01 and AUTH-02 are intentionally not marked complete: the visible button arrives in 02-03 (AUTH-01), and AUTH-02 still needs the guest and email-domain rules from 02-05; this plan delivers only the tenant/audience part and the messages.

## Known Gaps (not stubs)

- `MicrosoftOAuthGateway` still has no production binding until 02-04. With env configured, the routes now pass the enabled gate and then fail with a container binding error (HTTP 500). Do not set the Microsoft env vars in Dokploy before 02-04.
- No login page seam yet: the `microsoft` prop is exposed but `Login.vue` does not render the button until 02-03.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-01, T-02-06, T-02-39, T-02-40, T-02-SC). No packages installed.

## Self-Check: PASSED

- FOUND: all 12 files from `files_modified`
- FOUND: commits `c86c69be` and `5be04d63` are ancestors of HEAD
