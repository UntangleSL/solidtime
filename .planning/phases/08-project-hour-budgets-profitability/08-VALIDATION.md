---
phase: "08"
slug: "project-hour-budgets-profitability"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-27"
updated: "2026-11-27"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (DB-free unit tests locally; Postgres feature tests in CI only), Vitest 4.1 + happy-dom, Playwright 1.60 (CI only) |
| **Config file** | `phpunit.xml` (suites `tests/Unit`, `tests/Feature`), `vitest.config.ts` (`resources/js/**/*.test.ts`), `playwright.config.ts` (`e2e/`) |
| **Quick run command** | `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe vendor/bin/phpunit --colors=never tests/Unit/Profitability` and `npx vitest run resources/js/profitability` |
| **Full suite command** | CI: the ten workflows on the pushed sha (PHPUnit Tests, PHP Linting, Static code analysis (PHPStan), NPM Test Unit, NPM Lint, NPM Typecheck, NPM Format Check, NPM Build, Playwright Tests, Fork - Build image); locally Pint + PHPStan + `npm run type-check` + `npx tsc --noEmit` |
| **Estimated runtime** | ~60 seconds locally (unit + Vitest); CI ~25 minutes |

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` gates (php -l, Pint, PHPStan, route:list, unit tests, Vitest, eslint, prettier, vue-tsc/tsc, playwright --list)
- **After every plan wave:** orchestrator Wave CI gate on the pushed sha: ten workflows `success`; PHPUnit log `PASS.*Tests.(Feature|Unit).Profitability.` = 4 x Profitability classes merged so far (108 after 08-19) and `PASS.*Tests.(Feature|Unit).Microsoft365.` >= 196
- **Before `/gsd-verify-work`:** all ten workflows green on the release sha, ledger-check OK, Profitability PASS lines 108
- **Max feedback latency:** ~60 seconds locally; feature and browser tests at the next wave push

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | BUDG-03, CHRG-03 | T-08-01, T-08-03, T-08-04, T-08-05 | Owner reads a project's current-period hours over HTTP, end to end (provider, tables, access, consumption, endpoint) | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-01.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-01-02 | 01 | 1 | BUDG-03, CHRG-03 | T-08-01, T-08-03, T-08-04, T-08-05 | Scope gate and 404 rules of the summary proven | feature | `"$PHP_BIN" -l tests/Feature/Profitability/ProjectSummaryTest.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/Profitability...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-01-03 | 01 | 1 | BUDG-03, CHRG-03 | T-08-01, T-08-03, T-08-04, T-08-05 | Consumption counts exactly the work time of the period | feature | `"$PHP_BIN" -l app/Profitability/Reporting/ConsumptionQuery.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/Profitability &...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-02-01 | 02 | 2 | CHRG-03 | T-08-02, T-08-57 | The project page receives the summary URL and the scope-gated copy, end to end through the shared prop | feature | `"$PHP_BIN" -l app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php && "$PHP_BIN" -l tests/Feature/Profitability/SharedPropTest.php &...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-02-02 | 02 | 2 | CHRG-03 | T-08-02, T-08-57 | Complete en/es label inventory with the parity and money-placement test | unit | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/ProfitabilityLangTest.php` | ❌ created by task | ⬜ pending |
| 08-03-01 | 03 | 2 | BUDG-07, BUDG-06 | T-08-06, T-08-07, T-08-08, T-08-09, T-08-10 | An assigned project manager and account manager read the summary end to end (tables, models, resolver, scoped summary test) | feature | `"$PHP_BIN" -l app/Profitability/database/migrations/2026_11_27_000002_create_profitability_assignment_tables.php && "$PHP_BIN" -l tests/Feature/Pro...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-03-02 | 03 | 2 | BUDG-07, BUDG-06 | T-08-06, T-08-07, T-08-08, T-08-09, T-08-10 | Every scope combination proven without a database | unit | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/AccessScopeTest.php` | ❌ created by task | ⬜ pending |
| 08-03-03 | 03 | 2 | BUDG-07, BUDG-06 | T-08-06, T-08-07, T-08-08, T-08-09, T-08-10 | Owner/Admin manage project managers and account managers | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-03.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-04-01 | 04 | 2 | BUDG-01, BUDG-02, BUDG-04 | T-08-11, T-08-13, T-08-14, T-08-15 | Owner saves monthly terms over HTTP; the current period and its even plan are materialized and appear in the summary, end to end | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-04.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-04-02 | 04 | 2 | BUDG-01, BUDG-02, BUDG-04 | T-08-11, T-08-13, T-08-14, T-08-15 | Period arithmetic and plan invariants proven without a database | unit | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/PeriodCalendarTest.php tests/Unit/Profitability/PlanDistributorTest.php` | ❌ created by task | ⬜ pending |
| 08-05-01 | 05 | 2 | BUDG-05, CHRG-01, CHRG-02 | T-08-16, T-08-17, T-08-18, T-08-19, T-08-20 | Admin adds an hourly cost from a date and the people list shows it as current, end to end | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-05.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-05-02 | 05 | 2 | BUDG-05, CHRG-01, CHRG-02 | T-08-16, T-08-17, T-08-18, T-08-19, T-08-20 | Dated working week and chargeability target | feature | `"$PHP_BIN" -l app/Profitability/Http/Controllers/PeopleSettingsController.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-05-03 | 05 | 2 | BUDG-05, CHRG-01, CHRG-02 | T-08-16, T-08-17, T-08-18, T-08-19, T-08-20 | Absence projects marked explicitly by Owner and Admin | feature | `"$PHP_BIN" -l app/Profitability/Http/Controllers/AbsenceProjectsController.php && "$PHP_BIN" -l tests/Feature/Profitability/AbsenceProjectsTest.php...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-06-01 | 06 | 3 | CHRG-03, BUDG-03 | T-08-58, T-08-60, T-08-38 | Contract card on the project page, end to end from the shared prop to the summary JSON | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability resources/js/Pages/ProjectShow.vue && npx prettier --check resou...` | ❌ created by task | ⬜ pending |
| 08-06-02 | 06 | 3 | CHRG-03, BUDG-03 | T-08-58, T-08-60, T-08-38 | Status pill and budget meter | vitest | `npx vitest run resources/js/profitability/StatusPill.test.ts resources/js/profitability/BudgetMeter.test.ts && npx eslint resources/js/profitabilit...` | ❌ created by task | ⬜ pending |
| 08-07-01 | 07 | 3 | BUDG-03 | T-08-21, T-08-22, T-08-23, T-08-24 | A non-billable entry posted to a billable project is saved billable with the project rate, end to end through the API | feature | `"$PHP_BIN" -l app/Profitability/TimeEntries/EnforceBillableOnBillableProject.php && "$PHP_BIN" -l tests/Feature/Profitability/EnforceBillableTest.p...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-07-02 | 07 | 3 | BUDG-03 | T-08-21, T-08-22, T-08-23, T-08-24 | Every write path and every guard proven; the two upstream browser tests assert the fork rule | e2e | `"$PHP_BIN" -l tests/Feature/Profitability/EnforceBillableTest.php && "$PHP_BIN" vendor/bin/pint --test tests/Feature/Profitability app/Profitabilit...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-07-03 | 07 | 3 | BUDG-03 | T-08-21, T-08-22, T-08-23, T-08-24 | Read-only report of legacy non-billable time on billable projects | feature | `"$PHP_BIN" artisan list profitability --format=json > "$M365_LOG_DIR/commands-08-07.json" && node -e "const j=JSON.parse(require('fs').readFileSync...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-08-01 | 08 | 3 | BUDG-01, BUDG-02, BUDG-04 | T-08-12, T-08-61 | The summary lists every period and selects one, end to end | feature | `"$PHP_BIN" -l app/Profitability/Http/Controllers/ProjectSummaryController.php && "$PHP_BIN" -l tests/Feature/Profitability/PeriodMaterializerTest.p...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-08-02 | 08 | 3 | BUDG-01, BUDG-02, BUDG-04 | T-08-12, T-08-61 | Editing started contracts without touching closed periods | feature | `"$PHP_BIN" -l app/Profitability/Http/Controllers/ContractTermsController.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/P...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-08-03 | 08 | 3 | BUDG-01, BUDG-02, BUDG-04 | T-08-12, T-08-61 | Materializer lifecycle proven: gaps, end date, archive, resume, concurrency | feature | `"$PHP_BIN" -l tests/Feature/Profitability/PeriodMaterializerTest.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/Profitabi...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-09-01 | 09 | 4 | BUDG-04, BUDG-02 | T-08-25, T-08-26, T-08-27, T-08-28 | The project manager saves an uneven monthly plan over HTTP and the summary shows it, end to end | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-09.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-09-02 | 09 | 4 | BUDG-04, BUDG-02 | T-08-25, T-08-26, T-08-27, T-08-28 | Daily renewal safety net scheduled from the fork provider | feature | `"$PHP_BIN" artisan schedule:list > "$M365_LOG_DIR/schedule-08-09.txt" && grep -c "profitability:renew-periods" "$M365_LOG_DIR/schedule-08-09.txt"` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-09-03 | 09 | 4 | BUDG-04, BUDG-02 | T-08-25, T-08-26, T-08-27, T-08-28 | Archiving pauses renewal and un-archiving resumes from the current month | feature | `"$PHP_BIN" -l app/Profitability/Periods/RecordRenewalPause.php && "$PHP_BIN" -l tests/Feature/Profitability/RenewalLifecycleTest.php && "$PHP_BIN" ...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-10-01 | 10 | 4 | BUDG-04, BUDG-05, BUDG-06, BUDG-03 | T-08-29, T-08-30, T-08-31, T-08-32 | Money in the project summary with dated costs, end to end, absent for project managers | feature | `"$PHP_BIN" -l app/Profitability/Reporting/ConsumptionQuery.php && "$PHP_BIN" -l app/Profitability/Reporting/ProjectBalanceService.php && "$PHP_BIN"...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-10-02 | 10 | 4 | BUDG-04, BUDG-05, BUDG-06, BUDG-03 | T-08-29, T-08-30, T-08-31, T-08-32 | Projection to period close and timezone-correct consumption | unit + feature | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/ProjectionTest.php` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-10-03 | 10 | 4 | BUDG-04, BUDG-05, BUDG-06, BUDG-03 | T-08-29, T-08-30, T-08-31, T-08-32 | Projects view endpoint with scope-filtered rows, contract filter and the legacy notice | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-10.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-11-01 | 11 | 3 | CHRG-02, CHRG-03 | T-08-33, T-08-35 | Owner reads the team's chargeability for a range, end to end | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-11.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-11-02 | 11 | 3 | CHRG-02, CHRG-03 | T-08-33, T-08-35 | Available hours and ranges proven without a database | unit | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/AvailableHoursCalculatorTest.php tests/Unit/Profitability/ReportRangeTest.php` | ❌ created by task | ⬜ pending |
| 08-12-01 | 12 | 5 | CHRG-03, BUDG-04, BUDG-06 | T-08-36, T-08-37, T-08-59, T-08-62 | A scoped user opens Profitability from the sidebar and sees the Projects tab with their projects, end to end | vitest | `"$PHP_BIN" artisan route:list --name=profitability --json > "$M365_LOG_DIR/routes-08-12.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-12-02 | 12 | 5 | CHRG-03, BUDG-04, BUDG-06 | T-08-36, T-08-37, T-08-59, T-08-62 | Complete Projects view: KPIs, money by row, filter, sort, states and the legacy notice | vitest | `npx vitest run resources/js/profitability/ProjectsView.test.ts resources/js/profitability/projectsApi.test.ts && npx eslint resources/js/profitabil...` | ❌ created by task | ⬜ pending |
| 08-13-01 | 13 | 5 | BUDG-04, CHRG-03, BUDG-06 | T-08-39, T-08-40 | The card shows the selected period's terms, hours KPIs, projection caption, meter and status, end to end from the summary JSON | vitest | `npx vitest run resources/js/profitability/summaryApi.test.ts resources/js/profitability/ProjectSummaryCard.test.ts && npx eslint resources/js/profi...` | ❌ created by task | ⬜ pending |
| 08-13-02 | 13 | 5 | BUDG-04, CHRG-03, BUDG-06 | T-08-39, T-08-40 | Planned-vs-consumed chart and the month table | vitest | `npx vitest run resources/js/profitability/plannedVsConsumedOption.test.ts resources/js/profitability/PeriodMonthTable.test.ts && npx eslint resourc...` | ❌ created by task | ⬜ pending |
| 08-13-03 | 13 | 5 | BUDG-04, CHRG-03, BUDG-06 | T-08-39, T-08-40 | Money strip, chart wiring and the closed, upcoming, one-month and incomplete-cost states | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability && npx prettier --check resources/js/profitability && npm run ty...` | ❌ created by task | ⬜ pending |
| 08-14-01 | 14 | 5 | BUDG-06 | T-08-34, T-08-63 | An account manager reads their client portfolio for a range, end to end | feature | `"$PHP_BIN" artisan route:list --path=profitability --json > "$M365_LOG_DIR/routes-08-14.json" && node -e "const r=JSON.parse(require('fs').readFile...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-14-02 | 14 | 5 | BUDG-06 | T-08-34, T-08-63 | Range arithmetic, money shares and scope edges of the Clients view proven | feature | `"$PHP_BIN" -l tests/Feature/Profitability/ClientsViewTest.php && "$PHP_BIN" vendor/bin/pint --test app/Profitability tests/Feature/Profitability &&...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-15-01 | 15 | 6 | BUDG-05, BUDG-07, CHRG-01 | T-08-44, T-08-45, T-08-46 | Admin opens Settings, sees the People card and adds an hourly cost from the person dialog, end to end | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability && npx prettier --check resources/js/profitability && npm run ty...` | ❌ created by task | ⬜ pending |
| 08-15-02 | 15 | 6 | BUDG-05, BUDG-07, CHRG-01 | T-08-44, T-08-45, T-08-46 | Working week and target history, and confirmed deletes in the person dialog | vitest | `npx vitest run resources/js/profitability/PersonSettingsDialog.test.ts resources/js/profitability/PeopleSettingsCard.test.ts && npx eslint resource...` | ❌ created by task | ⬜ pending |
| 08-15-03 | 15 | 6 | BUDG-05, BUDG-07, CHRG-01 | T-08-44, T-08-45, T-08-46 | Managers and absence projects cards | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability && npx prettier --check resources/js/profitability && npm run ty...` | ❌ created by task | ⬜ pending |
| 08-16-01 | 16 | 6 | BUDG-01, BUDG-04 | T-08-41, T-08-42, T-08-43 | An account manager sets contract terms from the empty Contract card and the card shows the new period, end to end | vitest | `npx vitest run resources/js/profitability/contractsApi.test.ts resources/js/profitability/ContractEditor.test.ts resources/js/profitability/Project...` | ❌ created by task | ⬜ pending |
| 08-16-02 | 16 | 6 | BUDG-01, BUDG-04 | T-08-41, T-08-42, T-08-43 | Monthly plan editor with the sum gate and the even split mirror | vitest | `npx vitest run resources/js/profitability/planGridMath.test.ts resources/js/profitability/PlanGrid.test.ts resources/js/profitability/ProjectSummar...` | ❌ created by task | ⬜ pending |
| 08-16-03 | 16 | 6 | BUDG-01, BUDG-04 | T-08-41, T-08-42, T-08-43 | Editing started contracts and the Projects view entry points | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability && npx prettier --check resources/js/profitability && npm run ty...` | ❌ created by task | ⬜ pending |
| 08-17-01 | 17 | 6 | CHRG-03, BUDG-06 | T-08-48, T-08-64 | An account manager opens the Clients tab, picks a range and expands a client into its projects, end to end | vitest | `npx vitest run resources/js/profitability/clientsApi.test.ts resources/js/profitability/ClientsView.test.ts resources/js/profitability/Profitabilit...` | ❌ created by task | ⬜ pending |
| 08-17-02 | 17 | 6 | CHRG-03, BUDG-06 | T-08-48, T-08-64 | Margin by client chart | vitest | `npx vitest run resources/js/profitability/clientMarginOption.test.ts resources/js/profitability/ClientsView.test.ts && npx eslint resources/js/prof...` | ❌ created by task | ⬜ pending |
| 08-18-01 | 18 | 6 | CHRG-02, CHRG-03 | T-08-47 | Owner opens the People tab and reads each person's chargeability against target, end to end | vitest | `npx vitest run resources/js/profitability/peopleApi.test.ts resources/js/profitability/PeopleView.test.ts && npx eslint resources/js/profitability ...` | ❌ created by task | ⬜ pending |
| 08-18-02 | 18 | 6 | CHRG-02, CHRG-03 | T-08-47 | Chargeability vs target chart | vitest | `npx vitest run resources/js/profitability && npx eslint resources/js/profitability && npx prettier --check resources/js/profitability && npm run ty...` | ❌ created by task | ⬜ pending |
| 08-19-01 | 19 | 7 | BUDG-06, BUDG-07, BUDG-01, BUDG-04, CHRG-03 | T-08-49, T-08-50, T-08-51, T-08-52 | Every profitability route against every scope in one matrix, with the route canary and money-key scans | feature | `"$PHP_BIN" -l tests/Feature/Profitability/AuthorizationMatrixTest.php && "$PHP_BIN" vendor/bin/pint --test tests/Feature/Profitability/Authorizatio...` + feature tests in CI | ❌ created by task | ⬜ pending |
| 08-19-02 | 19 | 7 | BUDG-06, BUDG-07, BUDG-01, BUDG-04, CHRG-03 | T-08-49, T-08-50, T-08-51, T-08-52 | Browser proofs of the contract workflow and of access with money redaction | e2e | `npx eslint e2e/profitability-contract.spec.ts e2e/profitability-access.spec.ts && npx prettier --check e2e/profitability-contract.spec.ts e2e/profi...` | ❌ created by task | ⬜ pending |
| 08-19-03 | 19 | 7 | BUDG-06, BUDG-07, BUDG-01, BUDG-04, CHRG-03 | T-08-49, T-08-50, T-08-51, T-08-52 | Static isolation canaries and the Phase 8 ledger with a clean ledger check | unit | `"$PHP_BIN" vendor/bin/phpunit --colors=never tests/Unit/Profitability/ProfitabilityIsolationTest.php tests/Unit/Microsoft365/ForkIsolationTest.php` | ❌ created by task | ⬜ pending |
| 08-20-01 | 20 | 8 | BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07, CHRG-01, CHRG-02, CHRG-03 | T-08-53, T-08-54, T-08-55, T-08-56 | Release artifact verified end to end (commit, ten workflows, PASS counts, image tag) and the compose pinned to it | ci/static | `gh run list -R UntangleSL/solidtime --commit "$R" --limit 40 --json workflowName,conclusion --jq '[.[] | select(.workflowName=="PHPUnit Tests" or ....` | ✅ existing tooling | ⬜ pending |
| 08-20-02 | 20 | 8 | BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07, CHRG-01, CHRG-02, CHRG-03 | T-08-53, T-08-54, T-08-55, T-08-56 | Orchestrator deploys through the Dokploy MCP and confirms container health | checkpoint (orchestrator) | `` | ✅ existing tooling | ⬜ pending |
| 08-20-03 | 20 | 8 | BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07, CHRG-01, CHRG-02, CHRG-03 | T-08-53, T-08-54, T-08-55, T-08-56 | Public checks of the deployed release and the owner's message in Spanish | ci/static | `test "$(curl -s -o /dev/null -w '%{http_code}' https://time.untangle.es/health-check/up)" = "200" && for P in "profitability" "profitability/organi...` | ✅ existing tooling | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements: PHPUnit, Vitest and Playwright are installed and configured, and no package is added. There is no separate Wave 0: every test file is created by the task that needs it, in the same commit as the behaviour it proves (TDD tasks write the spec first). Shared fixtures stay inside each test class (rows via `::query()->create([...])`, the recursive money-key scan copied from `ScopedSummaryAccessTest`), as the Microsoft365 tests do.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings on real data: costs, working weeks, managers, absence projects | BUDG-05, BUDG-07, CHRG-01 | Real organization data and copy judgement | 08-20 owner check 1 |
| Contract terms with a mid-month start, front-loaded plan, projection and chart | BUDG-01, BUDG-02, BUDG-04 | Owner's contract model on real projects | 08-20 owner check 2 |
| Client margins and personal chargeability match expectations | BUDG-06, CHRG-02, CHRG-03 | Business correctness on real data | 08-20 owner check 3 |
| Project manager sees hours only; employee sees nothing new | BUDG-06, BUDG-07 | Real accounts and roles (backstop of the automated matrix) | 08-20 owner check 4 |
| Billable enforcement in the owner's browser; card, meter and charts in light/dark and at phone width; long service text wraps; 12-month plan grid on a 768px-tall viewport | BUDG-03, CHRG-03 | Visual backstops of the UI-SPEC | 08-20 owner check 5 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (08-20 Task 2 is the orchestrator's deploy checkpoint, between two automated tasks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no Wave 0 needed: each task creates its own tests)
- [x] No watch-mode flags (`vitest run`, `phpunit`, `playwright --list`)
- [x] Feedback latency ~60s locally; feature and browser runs at each wave push
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (set by /gsd-validate-phase)
