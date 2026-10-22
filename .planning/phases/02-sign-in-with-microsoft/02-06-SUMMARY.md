---
phase: 02-sign-in-with-microsoft
plan: 06
subsystem: auth
tags: [laravel, microsoft-entra, identity-linking, provisioning, postgres-advisory-lock, phpunit]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-01 tracer resolver and microsoft_accounts, 02-02 typed failures and MicrosoftConfig, 02-05 domain guard"
provides:
  - MicrosoftIdentityResolver with (tid, oid) lookup, one-time email linking, advisory lock and single retry
  - MicrosoftUserProvisioner (verified passwordless employee of the configured organization)
  - MicrosoftLinkingTest (8), MicrosoftIdentityResolverTest (3), MicrosoftProvisioningTest (8)
affects: [02-07, 02-08, 02-09]

actuals:
  tokens: 9300
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Resolution is one DB::transaction attempt wrapped by a retry-once on UniqueConstraintViolationException; the catch sits outside the transaction so the savepoint is already rolled back"
    - "Advisory lock key microsoft:<tid>:<oid> (lower-cased) taken as the first statement of every attempt"
    - "Race tests re-insert the competing row from DB::beforeStartingTransaction, because the simulated competitor lives in the rolled-back savepoint"

key-files:
  created:
    - app/Microsoft365/Auth/MicrosoftUserProvisioner.php
    - tests/Feature/Microsoft365/MicrosoftLinkingTest.php
    - tests/Feature/Microsoft365/MicrosoftIdentityResolverTest.php
    - tests/Feature/Microsoft365/MicrosoftProvisioningTest.php
  modified:
    - app/Microsoft365/Auth/MicrosoftIdentityResolver.php

key-decisions:
  - "Provisioning joins through MemberService::addMember($user, $org, Role::Employee) on the default path (no asSuperAdmin), so MemberAdding/MemberAdded are dispatched like for invitations"
  - "Link candidates are lower-cased mail and UPN restricted to allowlisted domains, matched with lower(email) against non-placeholder users only"
  - "Check order for a candidate: more than one user (AmbiguousAccount), unverified (UnverifiedAccount), already has a microsoft_accounts row (AlreadyLinked)"
  - "A second unique violation surfaces MicrosoftSignInFailure::Generic with no previous exception, so database text never reaches logs"

patterns-established:
  - "MicrosoftIdentityResolver constructor is (MicrosoftConfig, MicrosoftUserProvisioner); MemberService now belongs to the provisioner"

requirements-completed: [AUTH-03, AUTH-04, AUTH-05]

coverage:
  - id: D1
    description: "Returning identities resolve by (tid, oid) only and keep working after the solidtime email or the Entra mail changed"
    requirement: AUTH-05
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftLinkingTest.php::test_returning_identity_resolves_by_tid_oid_after_email_changes"
        status: pass
    human_judgment: false
  - id: D2
    description: "First sign-in links a verified non-placeholder user by mail or UPN (case-insensitive, allowlisted domains) without touching password, memberships or roles; unverified, ambiguous and already-linked matches are refused; placeholders and non-allowlisted addresses are never candidates"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftLinkingTest.php (8 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A person without an account is provisioned as verified, passwordless employee of the configured organization with no personal organization, with registration off or invite-only, F1 users from the UPN, placeholder merge, member events, and provisioning_unavailable when the organization is unset or unknown"
    requirement: AUTH-03
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftProvisioningTest.php (8 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A unique-constraint race on first sign-in is retried once and ends with one user and one microsoft_accounts row; a second conflict gives the generic failure; every resolution takes pg_advisory_xact_lock"
    requirement: AUTH-05
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftIdentityResolverTest.php (3 tests)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-10-23
status: complete
commits: 2
plan_head_before: d8de77c370ba6737b3c1b96da2a573b81aeaca3c
plan_head_after: 8e4f5f56dc701a49454008b71ee4cd031a5fa3da
---

# Phase 2 Plan 06: Identity linking and provisioning Summary

**Microsoft sign-in now links an existing verified solidtime user once by email, resolves every later sign-in by (tid, oid), provisions newcomers as passwordless employees of the configured organization, and survives concurrent first sign-ins through an advisory lock plus a single retry.**

## Accomplishments

- `MicrosoftIdentityResolver::resolve()` keeps its signature. Each attempt takes `pg_advisory_xact_lock(hashtext('microsoft:<tid>:<oid>'))`, looks the account up with `lockForUpdate()`, and only when there is no row looks for a link candidate (D-03) before provisioning (D-04).
- The candidate query is `lower(email)` in the lower-cased mail/UPN set (allowlisted domains only) restricted to `is_placeholder = false`. Linking creates the `microsoft_accounts` row only; password, memberships, roles and verification state are untouched.
- `MicrosoftUserProvisioner::provision()` creates the user (lower-case email, name from display name or local part, password null, verified now, timezone browser, else configured, else UTC), then `MemberService::addMember(..., Role::Employee)`. Organization comes from `MicrosoftConfig` only; unset, blank, non-UUID or unknown gives `ProvisioningUnavailable`.
- No personal organization, no `UserService`, no Fortify action: registration mode never matters (AUTH-06 half).

## Task Commits

1. **Task 1: Safe one-time linking and exactly-once resolution** - `dfb8a898` (feat)
2. **Task 2: MicrosoftUserProvisioner** - `8e4f5f56` (feat)

## Verification Evidence

- Local: Pint `--test` passed on `app/Microsoft365/Auth` and `tests/Feature/Microsoft365`; full PHPStan `[OK] No errors`. Acceptance greps: `pg_advisory_xact_lock` 1, `UniqueConstraintViolationException` 3, `lockForUpdate` 1, `is_placeholder` 2, 8 test methods in `MicrosoftLinkingTest`, `Role::Employee` 1, `asSuperAdmin` 0 in both files, no `UserService|CreateNewUser|createOrganization` under `app/Microsoft365`.
- Gate A for `8e4f5f56`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`.
- Gate B (`MicrosoftLinkingTest`, `MicrosoftIdentityResolverTest`, `MicrosoftProvisioningTest`, `MicrosoftSignInFlowTest`): 12 (one PASS per class per Postgres 15/16/17 job). Log saved under the toolchain `ci-logs` directory. Playwright was still running when this was written and is not a gate for this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PHPStan gate run on the full configured tree instead of `app/Microsoft365` only**
- **Found during:** both tasks
- **Issue:** same as 02-01/02-02: a path subset makes `phpstan.neon` fail with "Ignored error pattern ... was not matched".
- **Fix:** `phpstan analyse --configuration=phpstan.neon` with no path (what CI runs): `[OK] No errors`. `phpstan.neon` untouched.
- **Commit:** n/a

**2. [Plan wording] Race test re-inserts the competing row from `DB::beforeStartingTransaction`**
- **Issue:** `RefreshDatabase` wraps tests in a transaction, so each attempt is a savepoint. A competing row inserted from the `MicrosoftAccount::creating` listener is rolled back together with the failed attempt, so the retry would not find it (the plan text did not account for that).
- **Fix:** the first `creating` call inserts the competitor (producing a real unique violation) and registers a one-shot `beforeStartingTransaction` callback that puts the row back at the outer level just before the retry opens its transaction. This models "the winner committed in between". The competitor is an existing verified user matching the email, so the assertions (one user for that email, one row for (tid, oid)) hold literally.
- **Files modified:** `tests/Feature/Microsoft365/MicrosoftIdentityResolverTest.php`
- **Commit:** `dfb8a898`

**3. [Plan wording] No RED commit for the TDD tasks**
- PHPUnit needs Postgres, available only in CI, so tests and implementation were committed together per task, as in 02-01/02-02. Both tasks were green on the first CI run.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-17 to T-02-21, T-02-SC). No packages installed.

## Self-Check: PASSED

- FOUND: `app/Microsoft365/Auth/MicrosoftUserProvisioner.php`, `app/Microsoft365/Auth/MicrosoftIdentityResolver.php`, the three test classes
- FOUND: commits `dfb8a898` and `8e4f5f56` are ancestors of HEAD
