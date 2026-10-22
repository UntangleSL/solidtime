---
phase: 02-sign-in-with-microsoft
plan: 07
subsystem: auth
tags: [laravel, microsoft-entra, session, fortify-totp, token-security, phpunit]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-01 callback, encrypted microsoft_accounts and MicrosoftIdentity; 02-02 typed failures; 02-06 resolver and provisioner"
provides:
  - Callback success redirect through redirect()->intended(route('dashboard')) (desktop app and extension authorize URL is resumed)
  - Info log line 'Microsoft sign-in completed' with context exactly {amr_mfa: yes|no|absent}
  - MicrosoftSessionTest (10 tests) and MicrosoftTokenStorageTest (9 tests)
affects: [02-08, 02-09, 02-11]

actuals:
  tokens: 6500
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Leak tests search every sink (raw DB, model JSON, audits, users, session, LogFake, Inertia JSON, API JSON, print_r/var_dump) for the 02-01 marker tokens"
    - "Token keys are asserted in quoted form (\"access_token\") because access_token_expires_at legitimately contains the bare substring"

key-files:
  created:
    - tests/Feature/Microsoft365/MicrosoftSessionTest.php
    - tests/Feature/Microsoft365/MicrosoftTokenStorageTest.php
  modified:
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Models/MicrosoftAccount.php

key-decisions:
  - "A Microsoft sign-in whose token carries no mfa evidence is never refused; amr_mfa is evidence for the 02-11 release gate, not a decision input"
  - "Intended URL comes only from the server-written url.intended session key (no request parameter), so no open redirect"
  - "Remember-me is never set for Microsoft logins (login($user, false))"

patterns-established:
  - "Tests that sign in twice in one process call Auth::guard('web')->logout() before flushSession(), because the guard keeps its user across requests in the same test"

requirements-completed: [AUTH-06, SEC-01]

coverage:
  - id: D1
    description: "A TOTP user signing in with Microsoft is logged in without Fortify's challenge, while password login for that user still redirects to the two-factor challenge"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_totp_user_signing_in_with_microsoft_skips_fortify_challenge"
        status: pass
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_password_login_for_totp_user_still_requires_the_code"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every successful sign-in logs one info line with exactly {amr_mfa} (yes, no, absent), no PII, and never refuses a sign-in lacking mfa evidence; rejections write no completed line"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_successful_sign_in_logs_mfa_evidence_without_pii"
        status: pass
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_rejected_sign_in_writes_no_completed_line"
        status: pass
    human_judgment: false
  - id: D3
    description: "Passwordless users load /dashboard and /user/profile; password login for them fails with a normal 302 and an email error; no remember cookie is queued for passwordless or password users; microsoft.* session keys are cleared on success and rejection"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php (5 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The callback resumes the guest-stored intended URL (an /oauth/authorize URL and a real guest redirect from /time) and otherwise lands on /dashboard"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_callback_resumes_intended_oauth_authorize_url"
        status: pass
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSessionTest.php::test_callback_resumes_the_url_a_guest_was_sent_away_from"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tokens exist only as ciphertext in the two text columns of microsoft_accounts and appear nowhere else: model JSON, audits, users, session, logs, Inertia responses, GET /api/v1/users/me, debug output; a rejected callback stores no token"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftTokenStorageTest.php (9 tests)"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-10-23
status: complete
commits: 5
plan_head_before: cf87e490922b876733162e442fb3d30833b87cb9
plan_head_after: d45ae4d88a6ccc47247763ddd845f1e3670edf47
---

# Phase 2 Plan 07: Session semantics and token-leak matrix Summary

**Microsoft sign-ins now resume the guest-stored intended URL, never queue a remember-me cookie, bypass Fortify's TOTP challenge by design while logging a non-PII `amr_mfa` evidence line, and a nine-test matrix proves the access and refresh tokens live only as ciphertext in `microsoft_accounts`.**

## Accomplishments

- `MicrosoftAuthController::callback()` success path: `login($user, false)`, then `Log::info('Microsoft sign-in completed', ['amr_mfa' => $identity->mfaEvidence()])`, then `redirect()->intended(route('dashboard'))`. `microsoft.*` session keys were already forgotten in the `finally` block, so every exit path is covered.
- No sign-in is refused for missing `mfa` evidence (T-02-22, T-02-44): the line carries only the evidence value.
- `MicrosoftSessionTest`: TOTP bypass and unchanged password+TOTP path, evidence log for yes/no/absent with a PII/marker search, rejection writes no completed line, passwordless `/dashboard` and `/user/profile`, clean password-login failure, no recaller cookie, intended URL resume (two tests), dashboard fallback, session-key cleanup.
- `MicrosoftTokenStorageTest`: raw columns are ciphertext that decrypts to the markers and are `text` type; model array/JSON hide tokens; the model is not Auditable and no audit row has a marker or a Microsoft auditable type; `users` has no token columns; session and logs stay clean on success and on a wrong-tenant rejection; `/login` and `/dashboard` Inertia JSON and `GET /api/v1/users/me` carry no token; `print_r`/`var_dump` of the identity are redacted; a rejected callback stores nothing.

## Task Commits

1. **Task 1: controller change and MicrosoftSessionTest** - `bd53fc31` (feat)
2. **Task 2: SEC-01 matrix** - `c2f3f1e5` (test), then three CI-driven test fixes `992224bd`, `5a2a61a2`, `d45ae4d8` (test)

## Verification Evidence

- Local: Pint `--test` passed; full PHPStan `[OK] No errors`. Acceptance greps: `intended(` 1+, `login($user, false)` 1, remember variants 0, `Microsoft sign-in completed` 1, `mfaEvidence()` 1+, 10 test methods in `MicrosoftSessionTest` (needs 9), `Cache::|cache()` under `app/Microsoft365` none, `Auditable` in `MicrosoftAccount.php` 0, `SensitiveParameter` 3 in `MicrosoftIdentity.php`, `api.v1.users.me` 1.
- Gate A for `d45ae4d8`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`.
- Gate B (`MicrosoftSessionTest`, `MicrosoftTokenStorageTest`, `AuthenticationTest`, `TwoFactorAuthenticationSettingsTest`): 12 (3 x 4 on Postgres 15/16/17). Log saved under the toolchain `ci-logs` directory.
- Playwright was not awaited and is not a gate for this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PHPStan gate run on the full configured tree**
- Same as 02-01/02-06: a path subset makes `phpstan.neon` fail with an unmatched ignore pattern. Ran `phpstan analyse --configuration=phpstan.neon` (what CI runs): `[OK] No errors`.

**2. [Rule 1 - Bug] Intended-URL test no longer drives a live `/oauth/authorize` hit**
- **Found during:** Task 1 CI (Gate A, first push)
- **Issue:** a guest `GET /oauth/authorize` with a freshly created Passport confidential client answered 401 in the test harness instead of redirecting to `/login`, so the plan's "real guest hit is enough" setup could not produce `url.intended`. The 401 cause was not diagnosed (most likely an `invalid_client` answer from the Passport request validation in the test environment).
- **Fix:** `test_callback_resumes_intended_oauth_authorize_url` seeds `url.intended` with an `/oauth/authorize?...` URL via `withSession`, and a new `test_callback_resumes_the_url_a_guest_was_sent_away_from` does a real guest hit on `/time` and asserts the callback resumes it. This proves the controller behaviour and the guest-redirect mechanism, but not the Passport authorize endpoint itself.
- **Files modified:** `tests/Feature/Microsoft365/MicrosoftSessionTest.php`
- **Commit:** `992224bd`

**3. [Rule 1 - Bug] Token-key assertions matched `access_token_expires_at`**
- **Issue:** `assertStringNotContainsString('access_token', $json)` failed on the legitimate `access_token_expires_at` key.
- **Fix:** assert the quoted keys `"access_token"` and `"refresh_token"` (model JSON, Inertia JSON, API JSON).
- **Commit:** `5a2a61a2`

**4. [Rule 1 - Bug] Leak test reused an authenticated guard**
- **Issue:** the rejection leg of `test_session_and_logs_never_contain_tokens` redirected to `/dashboard` because the guard kept the first sign-in's user after `flushSession()`.
- **Fix:** `Auth::guard('web')->logout()` before `flushSession()`.
- **Commit:** `d45ae4d8`

**5. [Plan wording] `MicrosoftAccount` docblock reworded**
- The class comment "Deliberately not Auditable" matched the acceptance grep `Auditable` (must print 0). Reworded to "Deliberately excluded from auditing". No behavior change.
- **Commit:** `c2f3f1e5`

**6. [Plan wording] No positive-control assertion on the audits table**
- The plan's audits check is kept (no marker, no Microsoft auditable type), but I did not assert that the provisioned user produces at least one audit row, because I could not confirm locally that the audit driver writes a row for that flow. The check is therefore a negative-only guard.

**7. [Plan wording] No RED commit for the TDD tasks**
- PHPUnit needs Postgres (CI only), so tests and implementation were committed together, as in earlier plans of this phase.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-22 to T-02-25, T-02-44, T-02-SC). No packages installed.

## Self-Check: PASSED

- FOUND: `tests/Feature/Microsoft365/MicrosoftSessionTest.php`, `tests/Feature/Microsoft365/MicrosoftTokenStorageTest.php`, `app/Microsoft365/Http/Controllers/MicrosoftAuthController.php`
- FOUND: commits `bd53fc31`, `c2f3f1e5`, `992224bd`, `5a2a61a2`, `d45ae4d8` are ancestors of HEAD
