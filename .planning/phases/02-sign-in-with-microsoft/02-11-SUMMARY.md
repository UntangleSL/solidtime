---
phase: 02-sign-in-with-microsoft
plan: 11
subsystem: ops
tags: [dokploy, release, microsoft-entra, mfa, runbook]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-01..02-10 sign-in, rejection gates, identity resolution, token storage, profile section, m365:check, Dokploy guide and compose"
provides:
  - "Production https://time.untangle.es running the Phase 2 fork image pinned by commit tag (sha-d24a04b) with Microsoft sign-in enabled"
  - "Bootstrapped Untangle organization; public registration off; register link hidden on the login page"
  - "Runbook entries dating the tenant MFA release gate and the first production use of the secret"
affects: [phase-03, phase-07]

actuals:
  tasks: 3
  commits: 4

key-files:
  created: []
  modified:
    - docs/deploy/dokploy-compose.fork.yml
    - docs/m365/RUNBOOK-entra-app.md
    - app/Providers/FortifyServiceProvider.php
    - resources/js/Pages/Auth/Login.vue
    - tests/Feature/AuthenticationTest.php
    - docs/m365/TOUCHED-CORE-FILES.md

key-decisions:
  - "Dokploy images are pinned by sha-<7> tag: Dokploy does not re-pull a reused tag (feature-m365-integration), so every release bumps the tag in app, scheduler and queue"
  - "The login page hides the upstream 'Register here!' link unless APP_ENABLE_REGISTRATION=on (canRegister prop from FortifyServiceProvider), so a registration-off instance does not advertise a dead link"
  - "Bootstrap e-mail verification SQL returned UPDATE 0 because the owner's address was already verified; accepted"

requirements-completed: [AUTH-01, OPS-01]
---

# 02-11 Release: Microsoft sign-in in production

## Release evidence

- Release commit: `d24a04b3` (Phase 2 code `dbb91cd2` plus the register-link fix).
- CI for `d24a04b3`: Fork - Build image, NPM Build, NPM Format Check, NPM Lint, NPM Test Unit, NPM Typecheck, PHP Linting, PHPUnit Tests, Playwright Tests, Static code analysis (PHPStan): all `success`.
- Microsoft365 PHPUnit PASS lines in the PHPUnit Tests log: 45 (15 classes x Postgres 15/16/17).
- Image `ghcr.io/untanglesl/solidtime:sha-d24a04b` confirmed in the Fork - Build image log.

## Production rollout (time.untangle.es, Dokploy compose `untangle-solidtime-tq34sf`)

1. Tenant MFA release gate (D-06): Security Defaults ON, confirmed by the owner 2026-11-04.
2. 2026-11-04: compose replaced with `docs/deploy/dokploy-compose.fork.yml` pinned to `sha-dbb91cd`; the owner set the `SOLIDTIME_MICROSOFT_*` values from Doppler `vps/prd` in the Dokploy Environment tab (never through the executor), registration temporarily on.
3. Bootstrap (D-22): owner registered with email/password, organization renamed to Untangle, its id set as `SOLIDTIME_MICROSOFT_ORGANIZATION_ID`, `APP_ENABLE_REGISTRATION=off`, redeployed.
4. First production Microsoft sign-in 2026-11-04 16:11 UTC by the owner: no AADSTS error (production secret works), `amr_mfa=yes`. A second tenant account (non-admin) signed in and was provisioned as an employee.
5. 2026-11-05: compose bumped to `sha-d24a04b` (register-link fix) and redeployed after owner approval (deployment finished 10:31 UTC); the login page now carries `canRegister:false`, app container healthy.

Public checks: health-check 200; login page `microsoft.enabled=true` exactly once; `/auth/microsoft/redirect` pinned to the GUID tenant authority with `redirect_uri=https://time.untangle.es/auth/microsoft/callback` and S256 PKCE; Cloudflare does not cache pages (`cf-cache-status: DYNAMIC`).

## Manual UAT (owner, approved 2026-11-05)

- Second tenant account provisioned as employee of Untangle.
- Outside/guest account rejected with a clear message.
- Desktop app authorized through the Microsoft web login (Assumption A3 holds).
- Profile "Microsoft 365" section: Disconnect and Connect work; time entries unchanged.
- Email/password login still works.

## Deviations

- Added fix `d24a04b3` during the release (register link visible with registration off). Small, covered by `AuthenticationTest`, ledgered in `docs/m365/TOUCHED-CORE-FILES.md`.
- The first deploy of the fix waited in the shared Dokploy queue behind other projects' deployments.

## Follow-ups (not in this phase)

- Outbound mail (VPS postfix) and Cloudflare Access in front of time.untangle.es: separate tasks.
- Phase 7: Entra spike redirect URI and secret `spike-2026-10` cleanup; scheduler/queue healthcheck cosmetic fix.
