---
phase: 02-sign-in-with-microsoft
plan: 09
subsystem: ops
tags: [laravel, microsoft-entra, dokploy, artisan, env-config, docs]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-01 MicrosoftConfig and config/microsoft365.php; 02-02/02-04 service provider and gateway binding; 02-07 Microsoft sign-in completed log line with amr_mfa"
provides:
  - "MicrosoftConfig::isConfigured() requires GUID client and tenant ids (common/organizations can never be the authority); missingKeys() lists variable NAMES only; organizationId() is null unless a valid uuid"
  - "php artisan m365:check: configured yes/no, missing names, effective redirect URI (+ https warning outside local), allowed domains, organization name or NOT FOUND, registration, force https, session lifetime, linked/connected counts; no secret or token ever printed"
  - "docs/deploy/dokploy-compose.fork.yml passes SESSION_LIFETIME (default 720) and the seven SOLIDTIME_MICROSOFT_* variables to the app service; .env.example lists the same names"
  - "docs/deploy/MICROSOFT-SIGNIN.md: Spanish deployment, bootstrap (D-22), verification, first sign-in, Entra MFA (D-06), passwordless, unlink, off-switch and Cloudflare Access bypass guide"
  - "docs/m365/TOUCHED-CORE-FILES.md: touched-core-files ledger and the hot files left alone (D-15)"
affects: [02-10, 02-11, phase-07]

actuals:
  tokens: 10000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Misconfiguration is reported by variable NAME only (missingKeys), never by value, so diagnostics are safe to paste"
    - "Connected-account counting goes through MicrosoftAccount::scopeConnected so no code outside the model references token columns"

key-files:
  created:
    - app/Microsoft365/Console/MicrosoftCheckCommand.php
    - tests/Unit/Microsoft365/MicrosoftConfigTest.php
    - tests/Feature/Microsoft365/MicrosoftCheckCommandTest.php
    - docs/deploy/MICROSOFT-SIGNIN.md
    - docs/m365/TOUCHED-CORE-FILES.md
  modified:
    - app/Microsoft365/MicrosoftConfig.php
    - app/Microsoft365/Microsoft365ServiceProvider.php
    - app/Microsoft365/Models/MicrosoftAccount.php
    - .env.example
    - docs/deploy/dokploy-compose.fork.yml

key-decisions:
  - "m365:check reads app.env from config (not Application::environment()) so the https warning is testable and follows the documented APP_ENV value"
  - "Only the app service gets the Microsoft variables and SESSION_LIFETIME; scheduler and queue stay unchanged until Phase 3 needs Graph there"
  - "The runbook for Entra (docs/m365/RUNBOOK-entra-app.md) was not edited; 02-11 records the production sign-in and MFA release gate there"

patterns-established:
  - "Docs under docs/deploy use placeholders (<ORGANIZATION-UUID>, <USER-UUID>, <correo-de-la-propietaria>) and variable names only"

requirements-completed: [OPS-01]

coverage:
  - id: D1
    description: "Blank, whitespace, null, non-GUID and common/organizations values make the integration unconfigured and missingKeys() names exactly the faulty variables; valid values configure it; tenant id is lower-cased; invalid organization id only disables provisioning"
    requirement: OPS-01
    verification:
      - kind: unit
        ref: "tests/Unit/Microsoft365/MicrosoftConfigTest.php (25 tests; run locally and in CI Postgres 15/16/17)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Allowed domains are trimmed, lower-cased, de-duplicated and order-insensitive (string and array input); the shipped default is untanglegrowth.com,untangle.es; redirect URI is APP_URL without trailing slash + callback path, override wins, blank override ignored"
    requirement: OPS-01
    verification:
      - kind: unit
        ref: "tests/Unit/Microsoft365/MicrosoftConfigTest.php::test_allowed_domains_*, test_shipped_default_*, test_redirect_uri_*"
        status: pass
    human_judgment: false
  - id: D3
    description: "m365:check prints the effective settings with exit 0 when configured and exit 1 with variable names when not, warns on non-https outside local, reports a missing organization as NOT FOUND without failing, and never prints the client secret or token markers"
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "tests/Feature/Microsoft365/MicrosoftCheckCommandTest.php (7 tests; CI Gate B)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Compose passes SESSION_LIFETIME and every SOLIDTIME_MICROSOFT_* variable to the app service; .env.example lists the seven names; no values or secrets committed"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "js-yaml check of docs/deploy/dokploy-compose.fork.yml printed 'compose OK'; grep -c SOLIDTIME_MICROSOFT_ = 7 in both files; validate-docs secrets OK (1883 checks)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Spanish deployment guide covers every required topic (env table, Doppler to Dokploy copy, redirect URI, D-22 bootstrap with SQL fallback, m365:check, AADSTS7000215, Entra MFA with Security Defaults and amr_mfa, passwordless limits, unlink, off-switch, Cloudflare Access bypass)"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "grep acceptance checks: 12 '## ' headings, 189 lines, topic-marker greps >= 5, Security Defaults 4, amr_mfa 1, no GUID in either doc; content accuracy against the real deployment is judged by the owner in 02-11"
        status: pass
    human_judgment: true
  - id: D6
    description: "TOUCHED-CORE-FILES.md lists composer.json, composer.lock, config/app.php, Login.vue, Profile/Show.vue and .env.example, the fork-owned paths and the untouched hot files"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "Ledger entries cross-checked against git diff of the branch against origin/main (composer.json, composer.lock, config/app.php, Login.vue present; Show.vue is the 02-10 entry by plan)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-10-23
status: complete
commits: 2
plan_head_before: 22ee2cc0667c254de250b47fa6c013e36cf006a1
plan_head_after: a050c0cca462636f1dea487d3dc2ac57b3c615bf
---

# Phase 2 Plan 09: Env config hardening, m365:check and Dokploy deployment guide Summary

**Microsoft sign-in is configured only through SOLIDTIME_MICROSOFT_* variables that fail safe (blank or non-GUID means off), `php artisan m365:check` reports the deployed state by names and counts only, and the compose, `.env.example`, a Spanish deployment/bootstrap/MFA guide and the touched-core-files ledger are ready for the 02-11 deploy.**

## Accomplishments

- `MicrosoftConfig`: `isConfigured()` now delegates to the new `missingKeys()`, which flags a blank or non-GUID client id, a blank secret and a blank or non-GUID tenant id by their environment variable name. `organizationId()` returns a value only when it is a valid UUID, so a typo disables provisioning instead of reaching a query. Existing method signatures are unchanged.
- `MicrosoftCheckCommand` (`m365:check`), registered in `Microsoft365ServiceProvider::boot()` when running in console, prints the configuration state, effective redirect URI with an https warning outside `local`, allowed domains, organization (name, `not set` or `NOT FOUND`), registration mode, force https, session lifetime and linked/connected counts. Exit 1 only when not configured. It never calls `clientSecret()` and never names a token column.
- Compose: the app service now receives `SESSION_LIFETIME` (default 720) and the seven `SOLIDTIME_MICROSOFT_*` variables with the documented defaults; header comment points to the guide. `.env.example` has the matching block. Scheduler and queue are unchanged.
- `docs/deploy/MICROSOFT-SIGNIN.md` (Spanish, placeholders only) and `docs/m365/TOUCHED-CORE-FILES.md` (English).
- Tests: `MicrosoftConfigTest` (25 test cases including a data provider of 13 blank/invalid inputs) and `MicrosoftCheckCommandTest` (7 tests).

## Task Commits

1. **Task 1: Fail-safe env config and the m365:check diagnostic** - `f041138e` (feat)
2. **Task 2: Dokploy compose, .env.example, deployment guide and touched-core-files ledger** - `a050c0cc` (docs)

## Verification Evidence

- Local: Pint passed on `app/Microsoft365` and both test directories; full PHPStan `analyse` reported no errors (documented Rule 3: path-scoped analysis is not used); `tests/Unit/Microsoft365` ran 66 tests, 311 assertions OK with the toolchain OpenSSL config.
- Acceptance greps: `m365:check` in the command 1, `MicrosoftCheckCommand` in the provider 2, `clientSecret()|access_token|refresh_token` in the command 0, `public function missingKeys` 1, `SOLIDTIME_MICROSOFT_` in `.env.example` 7 and in the compose 7, `## ` headings in the guide 12, topic markers 9, `Security Defaults` 4, `amr_mfa` 1, GUIDs in the two docs 0, `Profile/Show.vue` in the ledger 1.
- Docs gates: `secrets: OK (1883 checks)`, `runbook: OK (30 checks)`; compose YAML check printed `compose OK`.
- CI for `a050c0cc` (pushed after `git pull --rebase`, already up to date): Gate A printed `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`; Gate B (`MicrosoftConfigTest`, `MicrosoftCheckCommandTest`, `MicrosoftLoginPageTest` across Postgres 15/16/17) = 9. NPM Format Check, Lint, Typecheck, Build and the fork image build also succeeded; Playwright was still running when read and is not a gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `MicrosoftAccount::scopeConnected`**
- **Found during:** Task 1
- **Issue:** `m365:check` must count connected accounts, but the plan's acceptance check forbids the strings `access_token` / `refresh_token` in the command file, and loading rows to call `isConnected()` would decrypt tokens into memory just to count them.
- **Fix:** Added a query scope next to `isConnected()` on the model (`whereNotNull('refresh_token')->whereNull('disconnected_at')`), so the token column name stays inside the model and no token is loaded.
- **Files modified:** `app/Microsoft365/Models/MicrosoftAccount.php`
- **Commit:** `f041138e`

**2. [Rule 1 - Bug] Environment check reads `config('app.env')`**
- **Found during:** Task 1
- **Issue:** `Application::environment()` is not affected by `Config::set('app.env')`, so the planned test (app.env `production`) could not trigger the https warning.
- **Fix:** The command compares `config('app.env')` with `local`.
- **Files modified:** `app/Microsoft365/Console/MicrosoftCheckCommand.php`
- **Commit:** `f041138e`

**3. [Process] Two commits instead of one**
- The plan text says to commit Task 1 and Task 2 together; the per-task commit protocol was followed (two commits) and both were pushed together, so Gate A and Gate B were read once for the final HEAD.

## Decisions Made

- The https warning line reads `WARNING: redirect uri is not https; Entra accepts http only for localhost`.
- The guide tells the operator to take `TRUSTED_PROXIES` from `docker network inspect dokploy-network` instead of naming a CIDR, because the subnet is host-specific and is not in the repository.
- Admin unlink documents that the next Microsoft sign-in re-links by verified email address (or is rejected when nothing matches), which resolves RESEARCH Open Question 5.

## Known Stubs

None.

## Threat Flags

None. `m365:check` is a console command with no network surface; the compose and docs carry names and `${VAR}` references only (T-02-31, T-02-32 covered by the secrets gate and the output-marker test).

## Issues Encountered

None. First CI run was green, no fix commits.

## Next Phase Readiness

02-11 can deploy by following `docs/deploy/MICROSOFT-SIGNIN.md`: paste the updated compose into Dokploy, copy the three Doppler values into Environment, run the D-22 bootstrap, verify with `php artisan m365:check`, and record the first production sign-in and the Entra MFA check date in `docs/m365/RUNBOOK-entra-app.md` (not edited here). Dokploy itself was not touched by this plan.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Console/MicrosoftCheckCommand.php, tests/Unit/Microsoft365/MicrosoftConfigTest.php, tests/Feature/Microsoft365/MicrosoftCheckCommandTest.php, docs/deploy/MICROSOFT-SIGNIN.md, docs/m365/TOUCHED-CORE-FILES.md
- FOUND commits: f041138e, a050c0cc (ancestors of HEAD)
