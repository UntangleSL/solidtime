---
phase: "2"
slug: "sign-in-with-microsoft"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-22"
---

# Phase 2 — Validation Strategy

> Derived from `02-RESEARCH.md` § Validation Architecture (requirement → test map lives there).

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (CI only, needs Postgres), Vitest 4, Playwright 1.60 (CI) |
| **Config file** | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run resources/js/m365` (local) + local Pint/PHPStan via portable PHP toolchain |
| **Full suite command** | push branch → GitHub Actions: phpunit.yml, phpstan.yml, pint.yml, npm-*.yml, playwright.yml all green |
| **Estimated runtime** | local ~60 s; CI ~10 min |

## Sampling Rate

- **After every task commit:** local Pint `--test`, `php -l`, PHPStan on touched files, Vitest for touched Vue, `node tests/Tools/m365-spike/validate-docs.mjs secrets`
- **After every plan wave:** push and require all CI workflows green (`gh run list --branch feature/m365-integration`)
- **Before `/gsd-verify-work`:** CI green + manual UAT on https://time.untangle.es
- **Max feedback latency:** local 60 s; CI per wave

## Per-Task Verification Map

To be filled during execution (see 02-RESEARCH.md requirement→test map: MicrosoftLoginPageTest, MicrosoftRedirectTest, MicrosoftSignInRejectionTest, MicrosoftProvisioningTest, MicrosoftLinkingTest, MicrosoftIdentityResolverTest, MicrosoftSessionTest, MicrosoftAccountTest, MicrosoftTokenStorageTest, MicrosoftConfigTest, SocialiteMicrosoftGatewayTest, Vitest MicrosoftConnectionForm).

## Wave 0 Requirements

- [ ] Portable PHP 8.3 + Composer toolchain outside the repo (scratchpad), `composer require laravel/socialite socialiteproviders/microsoft`
- [ ] `tests/Feature/Microsoft365/`, `tests/Unit/Microsoft365/`, fake gateway + identity builder (example.test emails, 00000000-0000-4000-8000-* GUIDs)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bootstrap owner + first production Microsoft sign-in | AUTH-01, AUTH-03, OPS-01 | Real tenant, prod secret, Dokploy | 02-RESEARCH.md Manual UAT 1 |
| Second account provisioned as employee | AUTH-03 | Real tenant | UAT 2 |
| Guest / non-allowlisted rejected | AUTH-02 | Real tenant | UAT 3 |
| Password login, reset, TOTP unchanged | AUTH-01, AUTH-06 | Prod config | UAT 4 |
| Desktop app + browser extension authorize via Microsoft web login | AUTH-06 | External apps | UAT 5 |
| Profile connect/disconnect | AUTH-07 | UI | UAT 6 |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
