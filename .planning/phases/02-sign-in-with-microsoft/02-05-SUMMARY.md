---
phase: 02-sign-in-with-microsoft
plan: 05
subsystem: auth
tags: [laravel, microsoft-entra, guard, phpunit]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-02 MicrosoftIdentityGuard (tenant + audience), MicrosoftSignInFailure, callback wiring"
provides:
  - MicrosoftIdentityGuard::check with oid GUID-shape and Graph-id equality, guest signals (userType, #EXT#, acct) and exact domain allowlist
  - MicrosoftIdentityGuardTest (25 unit cases) and MicrosoftSignInRejectionTest (4 Feature cases)
affects: [02-06, 02-07, 02-09]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Guard stays pure: one private method per rule, cheapest first, each throws a typed MicrosoftSignInException"
    - "Domain matched by exact equality after the last @; allowlist only from MicrosoftConfig"

key-files:
  created:
    - tests/Unit/Microsoft365/MicrosoftIdentityGuardTest.php
    - tests/Feature/Microsoft365/MicrosoftSignInRejectionTest.php
  modified:
    - app/Microsoft365/Auth/MicrosoftIdentityGuard.php

key-decisions:
  - "accountType is the string '1' (the gateway casts the acct claim to string), so the guest rule compares the trimmed string"
  - "Rule order: tenant/audience (WrongTenant), oid (Generic), guest (Guest), domain (Domain)"

patterns-established:
  - "Rejection Feature test asserts redirect to login, flash message, guest state, no user/account rows and a log line holding only reason + provider_code"

requirements-completed: [AUTH-02]

coverage:
  - id: D1
    description: "Other tenants, malformed or mismatched oid, guests (userType, #EXT#, acct=1) and non-allowlisted domains are refused before any DB work; F1 users pass on UPN; empty allowlist admits nobody"
    requirement: AUTH-02
    verification:
      - kind: unit
        ref: "tests/Unit/Microsoft365/MicrosoftIdentityGuardTest.php (25 tests)"
        status: pass
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftSignInRejectionTest.php (4 tests)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-10-23
status: complete
plan_head_before: e91c691bbf22bd75061ae064951091792f859213
plan_head_after: 9d482dbb7498870bd0de664bb687b6544885d835
---

# Phase 2 Plan 05: Guest, tenant and domain gate Summary

**MicrosoftIdentityGuard now refuses foreign tenants, malformed identities, guests (userType, #EXT#, acct=1) and non-allowlisted domains before any database work, with exact-equality domain matching, UPN fallback for users without a mailbox and an empty allowlist that admits nobody.**

## Accomplishments

- `check()` runs four pure rules in cheapest-first order: tid/aud (WrongTenant), oid shape and equality with the Graph id (Generic), guest signals (Guest, fail closed on a null userType), domain allowlist (Domain).
- Domain rule uses `primaryEmail()` (mail, else UPN, lower-cased), splits on the last `@` and requires exact membership in `MicrosoftConfig::allowedDomains()`. No domain name appears in the guard.
- 25 unit tests cover each rule, case variants, suffix attacks (`evil-untangle.es`, `untangle.es.evil.test`, `sub.untangle.es`), whitespace/empty allowlist entries, an empty allowlist, missing and doubled `@`.
- Feature tests prove the visible rejection (wrong tenant, guest, domain): redirect to login, lang message in the flash, guest, no user or `microsoft_accounts` row, log line with reason only (no oid, email, UPN or token markers); plus an F1 user provisioned with the lower-cased UPN.

## Task Commits

1. **Task 1: Reject foreign tenants, malformed identities and guests** - `f00fb24a` (feat)
2. **Task 2: Domain allowlist with mail/UPN source, exact matching, fail closed** - `9d482dbb` (feat)

## Verification Evidence

- Local: Pint `--test` passed; full PHPStan `[OK] No errors`; `MicrosoftIdentityGuardTest` run locally with the portable PHP: OK (25 tests, 28 assertions). Greps: guard has 0 `DB::|Log::|->save(`, 0 domain literals, 1 `allowedDomains()`; unit test has 3 `evil` cases.
- Gate A for `9d482dbb`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`.
- Gate B (`MicrosoftIdentityGuardTest`, `MicrosoftSignInRejectionTest`, `MicrosoftSignInFlowTest`): 9 (one PASS per class per Postgres 15/16/17 job).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PHPStan run on the full configured tree instead of `app/Microsoft365` only**
- **Found during:** Tasks 1 and 2 verification
- **Issue:** Same as 02-01/02-02: a path subset makes `phpstan.neon` fail with "Ignored error pattern ... was not matched".
- **Fix:** `phpstan analyse --configuration=phpstan.neon` with no path (what CI runs): `[OK] No errors`. `phpstan.neon` untouched.
- **Files modified:** none
- **Commit:** n/a

**2. [Rule 3 - Blocking] CRLF line endings introduced by a scripted edit**
- **Found during:** Task 2 local Pint run
- **Issue:** The Python edit wrote the three files with CRLF and Pint's `line_ending` fixer failed.
- **Fix:** converted the files back to LF before committing; Pint passes. Nothing CRLF was committed.
- **Files modified:** the three plan files
- **Commit:** `9d482dbb` (committed clean)

**3. [Plan wording] Unit tests also run locally**
- The unit class needs no database, so it was run locally in addition to CI. The Feature tests ran only in CI (Postgres).

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-13 to T-02-16, T-02-SC). No packages installed.

## Self-Check: PASSED

- FOUND: guard, unit test and Feature test files
- FOUND: commits `f00fb24a` and `9d482dbb` are ancestors of HEAD
