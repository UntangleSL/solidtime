---
phase: "07"
slug: "hardening-release"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (Unit local, Feature in CI with Postgres), Vitest 4.1, Playwright 1.60, `tests/Tools/m365-spike/validate-docs.mjs` |
| **Config file** | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `"C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe" vendor/bin/phpunit tests/Unit/Microsoft365/<File>.php`; `npx vitest run <files>` |
| **Full suite command** | Push, then CI Gate W (ten workflows green, `gh ... -R UntangleSL/solidtime`) and Gate B (count of `PASS.*Microsoft365` lines in the PHPUnit Tests log) |
| **Estimated runtime** | ~30 s local; ~12 min CI |

---

## Sampling Rate

- **After every task commit:** Gate U on touched `tests/Unit/Microsoft365` files, vitest on touched frontend files, Pint `--test` and PHPStan on touched PHP.
- **After every plan wave:** push, Gate W plus Gate B (CI is fail-fast across the Postgres jobs).
- **Before `/gsd-verify-work`:** merge commit green on all ten workflows, DB backup taken, deploy done, healthchecks green, owner Entra checkpoint confirmed.
- **Max feedback latency:** CI ~12 min per wave.

---

## Per-Task Verification Map

Filled by the planner per task (see each PLAN.md `<verify>`). Requirement coverage:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| SEC-03 | User/org/member deletion leaves no fork rows; every fork table cascades | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` | ❌ W0 | ⬜ pending |
| SEC-04 | Every Microsoft route inert under impersonation; Connect, callback, Disconnect, profile `account` prop guarded; no Graph call | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` | ❌ W0 | ⬜ pending |
| SEC-04 | Only `CheckOutOfSyncCommand` dispatches `CheckOutOfSyncForUser` | unit (local) | `phpunit tests/Unit/Microsoft365/ForkIsolationTest.php` | ❌ W0 | ⬜ pending |
| OPS-02 | Unconfigured: routes 404, props off, schedule filter false, data kept, re-enable restores | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` | ❌ W0 | ⬜ pending |
| OPS-02 | `/calendar` shows no Outlook controls and sends no `/m365/` request when off | e2e (CI) | `npx playwright test e2e/outlook-off-switch.spec.ts` | ❌ W0 | ⬜ pending |
| OPS-03 | Ledger complete; merge conflicts only inside the ledger; merged tree green | script + CI | ledger completeness check in `docs/m365/UPSTREAM-MERGE.md`; Gate W on the merge commit | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` — SEC-03 deletion matrix + schema cascade guard
- [ ] `tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` — SEC-04 route matrix and canary
- [ ] `tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` — OPS-02 consolidated
- [ ] `tests/Unit/Microsoft365/ForkIsolationTest.php` — static canaries (job dispatch site, ledger paths exist)
- [ ] `e2e/outlook-off-switch.spec.ts` — OPS-02 browser proof
- [ ] `docs/m365/UPSTREAM-MERGE.md` — repeatable merge and rollback procedure

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scheduler and queue containers report healthy | carry-over | Container health exists only in Dokploy | After deploy, `docker-getContainersByAppNameMatch` shows `(healthy)` for scheduler and queue |
| Entra spike redirect URI and secret removed; sign-in and Sync still work | roadmap criterion 5 | Portal action by the owner | Owner follows the Spanish guide; orchestrator checks sign-in and Sync in production; `validate-docs.mjs guide|runbook|secrets` print OK |
| Merged release works in production | OPS-03 | Production smoke test | Owner-visible calendar, Microsoft sign-in, profile page and calendar drag after deploy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency acceptable (CI-bound)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
