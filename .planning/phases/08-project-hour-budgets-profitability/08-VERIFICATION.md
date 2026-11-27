---
phase: 08-project-hour-budgets-profitability
verified: 2026-11-27T21:45:00Z
status: human_needed
score: 5/5 must-haves verified
covered_files: [".planning/phases/08-project-hour-budgets-profitability/08-01-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-01-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-02-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-02-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-03-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-03-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-04-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-04-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-05-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-05-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-06-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-06-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-07-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-07-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-08-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-08-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-09-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-09-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-10-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-10-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-11-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-11-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-12-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-12-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-13-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-13-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-14-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-14-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-15-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-15-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-16-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-16-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-17-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-17-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-18-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-18-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-19-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-19-SUMMARY.md",".planning/phases/08-project-hour-budgets-profitability/08-20-PLAN.md",".planning/phases/08-project-hour-budgets-profitability/08-20-SUMMARY.md","app/Profitability/Access/AccessScope.php","app/Profitability/Access/ProfitabilityAccess.php","app/Profitability/Console/RenewPeriodsCommand.php","app/Profitability/Console/ReportNonBillableCommand.php","app/Profitability/Enums/ContractSchedule.php","app/Profitability/Http/Controllers/AbsenceProjectsController.php","app/Profitability/Http/Controllers/AssignmentController.php","app/Profitability/Http/Controllers/ClientsViewController.php","app/Profitability/Http/Controllers/ContractTermsController.php","app/Profitability/Http/Controllers/PeopleSettingsController.php","app/Profitability/Http/Controllers/PeopleViewController.php","app/Profitability/Http/Controllers/PlanController.php","app/Profitability/Http/Controllers/ProfitabilityPageController.php","app/Profitability/Http/Controllers/ProjectSummaryController.php","app/Profitability/Http/Controllers/ProjectsViewController.php","app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php","app/Profitability/Http/Requests/AbsenceProjectsRequest.php","app/Profitability/Http/Requests/AssignmentRequest.php","app/Profitability/Http/Requests/ContractTermsRequest.php","app/Profitability/Http/Requests/CostRateRequest.php","app/Profitability/Http/Requests/PlanRequest.php","app/Profitability/Http/Requests/WorkWeekRequest.php","app/Profitability/Models/AbsenceProject.php","app/Profitability/Models/ClientAccountManager.php","app/Profitability/Models/ContractPeriod.php","app/Profitability/Models/ContractPeriodMonth.php","app/Profitability/Models/MemberCostRate.php","app/Profitability/Models/MemberWorkWeek.php","app/Profitability/Models/ProjectContract.php","app/Profitability/Models/ProjectManager.php","app/Profitability/Periods/PeriodBounds.php","app/Profitability/Periods/PeriodCalendar.php","app/Profitability/Periods/PeriodMaterializer.php","app/Profitability/Periods/PlanDistributor.php","app/Profitability/Periods/RecordRenewalPause.php","app/Profitability/ProfitabilityServiceProvider.php","app/Profitability/Reporting/AvailableHoursCalculator.php","app/Profitability/Reporting/ChargeabilityQuery.php","app/Profitability/Reporting/ChargeabilityService.php","app/Profitability/Reporting/ClientRollupService.php","app/Profitability/Reporting/ConsumptionQuery.php","app/Profitability/Reporting/ProjectBalanceService.php","app/Profitability/Reporting/Projection.php","app/Profitability/Reporting/ProjectionResult.php","app/Profitability/Reporting/ReportRange.php","app/Profitability/TimeEntries/EnforceBillableOnBillableProject.php","app/Profitability/TimeEntries/LegacyNonBillableQuery.php","app/Profitability/database/migrations/2026_11_27_000001_create_profitability_contract_tables.php","app/Profitability/database/migrations/2026_11_27_000002_create_profitability_assignment_tables.php","app/Profitability/database/migrations/2026_11_27_000003_create_profitability_people_tables.php","app/Profitability/routes/assignments.php","app/Profitability/routes/contracts.php","app/Profitability/routes/people.php","app/Profitability/routes/profitability.php","app/Profitability/routes/settings.php","app/Profitability/routes/views.php","config/app.php","config/profitability.php","docs/deploy/dokploy-compose.fork.yml","docs/m365/TOUCHED-CORE-FILES.md","e2e/calendar.spec.ts","e2e/profitability-access.spec.ts","e2e/profitability-contract.spec.ts","e2e/time.spec.ts","lang/en/profitability.php","lang/es/profitability.php","resources/js/Layouts/AppLayout.vue","resources/js/Pages/Profitability.vue","resources/js/Pages/ProjectShow.vue","resources/js/profitability/AbsenceProjectsCard.test.ts","resources/js/profitability/AbsenceProjectsCard.vue","resources/js/profitability/BudgetMeter.test.ts","resources/js/profitability/BudgetMeter.vue","resources/js/profitability/ChargeabilityChart.vue","resources/js/profitability/ClientMarginChart.vue","resources/js/profitability/ClientsView.test.ts","resources/js/profitability/ClientsView.vue","resources/js/profitability/ContractEditor.test.ts","resources/js/profitability/ContractEditor.vue","resources/js/profitability/ManagersSettingsCard.test.ts","resources/js/profitability/ManagersSettingsCard.vue","resources/js/profitability/PeopleSettingsCard.test.ts","resources/js/profitability/PeopleSettingsCard.vue","resources/js/profitability/PeopleView.test.ts","resources/js/profitability/PeopleView.vue","resources/js/profitability/PeriodMonthTable.test.ts","resources/js/profitability/PeriodMonthTable.vue","resources/js/profitability/PersonSettingsDialog.test.ts","resources/js/profitability/PersonSettingsDialog.vue","resources/js/profitability/PlanGrid.test.ts","resources/js/profitability/PlanGrid.vue","resources/js/profitability/PlannedVsConsumedChart.vue","resources/js/profitability/ProfitabilityPage.test.ts","resources/js/profitability/ProfitabilityPage.vue","resources/js/profitability/ProjectSummaryCard.test.ts","resources/js/profitability/ProjectSummaryCard.vue","resources/js/profitability/ProjectsView.test.ts","resources/js/profitability/ProjectsView.vue","resources/js/profitability/RangeSelect.vue","resources/js/profitability/SettingsView.vue","resources/js/profitability/StatusPill.test.ts","resources/js/profitability/StatusPill.vue","resources/js/profitability/chargeabilityOption.test.ts","resources/js/profitability/chargeabilityOption.ts","resources/js/profitability/clientMarginOption.test.ts","resources/js/profitability/clientMarginOption.ts","resources/js/profitability/clientsApi.test.ts","resources/js/profitability/clientsApi.ts","resources/js/profitability/contractsApi.test.ts","resources/js/profitability/contractsApi.ts","resources/js/profitability/format.test.ts","resources/js/profitability/format.ts","resources/js/profitability/labels.ts","resources/js/profitability/peopleApi.test.ts","resources/js/profitability/peopleApi.ts","resources/js/profitability/planGridMath.test.ts","resources/js/profitability/planGridMath.ts","resources/js/profitability/plannedVsConsumedOption.test.ts","resources/js/profitability/plannedVsConsumedOption.ts","resources/js/profitability/projectsApi.test.ts","resources/js/profitability/projectsApi.ts","resources/js/profitability/settingsApi.test.ts","resources/js/profitability/settingsApi.ts","resources/js/profitability/summaryApi.test.ts","resources/js/profitability/summaryApi.ts","tests/Feature/Profitability/AbsenceProjectsTest.php","tests/Feature/Profitability/AssignmentsTest.php","tests/Feature/Profitability/AuthorizationMatrixTest.php","tests/Feature/Profitability/ChargeabilityTest.php","tests/Feature/Profitability/ClientsViewTest.php","tests/Feature/Profitability/ConsumptionTest.php","tests/Feature/Profitability/ContractTermsTest.php","tests/Feature/Profitability/DatedCostTest.php","tests/Feature/Profitability/EnforceBillableTest.php","tests/Feature/Profitability/PageAccessTest.php","tests/Feature/Profitability/PeopleSettingsTest.php","tests/Feature/Profitability/PeriodMaterializerTest.php","tests/Feature/Profitability/PlanEditingTest.php","tests/Feature/Profitability/ProjectSummaryTest.php","tests/Feature/Profitability/ProjectsViewTest.php","tests/Feature/Profitability/RenewalLifecycleTest.php","tests/Feature/Profitability/ReportNonBillableCommandTest.php","tests/Feature/Profitability/ScopedSummaryAccessTest.php","tests/Feature/Profitability/SharedPropTest.php","tests/Unit/Endpoint/Api/V1/TimeEntryEndpointTest.php","tests/Unit/Profitability/AccessScopeTest.php","tests/Unit/Profitability/AvailableHoursCalculatorTest.php","tests/Unit/Profitability/PeriodCalendarTest.php","tests/Unit/Profitability/PlanDistributorTest.php","tests/Unit/Profitability/ProfitabilityIsolationTest.php","tests/Unit/Profitability/ProfitabilityLangTest.php","tests/Unit/Profitability/ProjectionTest.php","tests/Unit/Profitability/ReportRangeTest.php"]
covered_digest: "v3:sha256:28a1a4edcf5005a7addedc9c21255d2bc31b68e919b011c609afcad963818e3b"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Owner check 1 (Settings on real data): as Owner open Profitability > Settings; add an hourly cost and a working week (40 h, 75 %) for two people; mark the Vacaciones and Festivo projects as absence; assign an account manager to a client and a project manager to one of its projects"
    expected: "Each change saves with a confirmation; people without cost or working week show 'Not set' until filled"
    why_human: "Real organization data and copy judgement (BUDG-05, BUDG-07, CHRG-01). Absence is an explicit marker, not a name match (AbsenceProjectsTest::test_names_alone_mark_nothing), so chargeability stays wrong until the owner marks both projects"
  - test: "Owner check 2 (contract on a real project): on a real billable client project press 'Set contract terms' (monthly or quarterly, mid-month start, hours and amount), then 'Plan months' and front-load the hours"
    expected: "Card shows the prorated first stub period, hours sold / consumed / still to consume, projection to close and the monthly chart; the plan saves only when the months add up to the hours sold"
    why_human: "Owner's contract model on real projects (BUDG-01, BUDG-02, BUDG-04); automated proof exists only on fixtures"
  - test: "Owner check 3 (figures): open the Projects, Clients and People tabs; compare a client's margin and a person's chargeability with expectations"
    expected: "Figures match the owner's understanding; Vacaciones/Festivo lower available hours; internal time lowers chargeability"
    why_human: "Business correctness on real data (BUDG-06, CHRG-02, CHRG-03)"
  - test: "Owner check 4 (visibility with real accounts): ask a project manager and an employee to open solidtime"
    expected: "Project manager sees Profitability with hours only (no amounts, costs or margins); the employee sees no Profitability item and no card on project pages"
    why_human: "Real accounts and roles; backstop of the automated AuthorizationMatrixTest and profitability-access.spec.ts"
  - test: "Owner check 5 (enforcement and visuals): log time on a billable project and try to mark it non-billable; view the contract card, meter and charts in light and dark theme and at phone width; a long service text; the 12-month plan grid on a 768px-tall window"
    expected: "Entry stays billable; card, meter and charts readable in both themes; long service text wraps; plan grid usable"
    why_human: "Visual backstops of the UI-SPEC; enforcement in the owner's own browser (BUDG-03, CHRG-03)"
  - test: "Production migrations and legacy data: in the Dokploy app container check that the three 2026_11_27_00000{1,2,3}_create_profitability_* migrations ran (php artisan migrate:status) and run 'php artisan profitability:report-nonbillable' once"
    expected: "Three migrations listed as Ran; the report gives the count of legacy non-billable entries on billable projects so the owner can decide what to do with them (D-05: reported, never rewritten)"
    why_human: "No container log or exec access from the verifier; only indirect evidence (routes answer 401, containers healthy)"
  - test: "Production scheduler: after 04:30 Europe/Madrid, check the scheduler container log (or 'php artisan schedule:list' in the app container) for profitability:renew-periods"
    expected: "profitability:renew-periods is listed daily at 04:30 Europe/Madrid and runs without error"
    why_human: "Registration is proven by RenewalLifecycleTest in CI, not in the deployed container; renewal correctness does not depend on it (reads materialize lazily) but the safety net should be confirmed"
  - test: "Page name: confirm the owner accepts 'Profitability' in the English UI (D-17), or switch the app/user locale to Spanish and check the page reads 'Rentabilidad'"
    expected: "Owner accepts the locale-driven label; Spanish copy shows 'Rentabilidad' in the sidebar and page title"
    why_human: "ROADMAP SC5 names the page 'Rentabilidad'; D-17 resolved it as locale-driven and lang/es/profitability.php has it, but which locale the team runs is an owner decision"
---

# Phase 8: Project Hour Budgets & Profitability Verification Report

**Phase Goal:** As Untangle management, I want each client project to carry its contract terms (hours and money sold, renewing on a schedule), the team's billable time to consume them, and a view of profitability and team chargeability, so that we see per month, per project, per client and per person whether we are on track to the contract close.
**Verified:** 2026-11-27T21:45:00Z
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An account manager sets a project's contract terms (service, amount and hours per period, one-off or renewing monthly, quarterly or annually); a renewing project starts each new period automatically and clean, until an end date or archive | ✓ VERIFIED | `ContractTermsController::upsert` gated by `AccessScope::canEditTerms` (account manager of the client, Owner, Admin); `ContractTermsRequest` has service, schedule enum `one_off/monthly/quarterly/annual`, starts_on, ends_on (required for one-off), budget_seconds, amount_cents. `PeriodMaterializer::ensureThrough` (lazy, insert-only, every read + daily `profitability:renew-periods` scheduled from the provider) creates each period with the template terms and a fresh even plan; `PeriodCalendar::next` stops at `ends_on`; `RecordRenewalPause` (Project::updated listener) pauses on archive and resumes without back-fill. CI-green tests: ContractTermsTest (9), PeriodMaterializerTest incl. `test_no_period_starts_after_the_end_date`, `test_nothing_is_created_while_the_project_is_archived`, `test_resume_on_skips_the_paused_months`; RenewalLifecycleTest incl. `test_command_creates_the_period_that_became_due`, `test_archiving_pauses_and_removes_not_started_periods`; e2e profitability-contract.spec.ts "Monthly terms" |
| 2 | A project manager distributes a period's hours across its months (uneven allowed) and sees planned vs consumed per month and the projection to the period close | ✓ VERIFIED | `PlanController::update` gated by `canEditPlan` (project manager, Owner, Admin), accepts uneven months that sum exactly to the period hours, rejects closed periods. `ProjectBalanceService` returns per-month `planned_seconds`/`consumed_seconds` plus `still_to_consume_seconds`, `remaining_plan_seconds`, `run_rate_seconds`, `status` from `Projection::forPeriod`; rendered by `ProjectSummaryCard` (PeriodMonthTable, PlannedVsConsumedChart, BudgetMeter, PlanGrid). CI-green: PlanEditingTest `test_project_manager_saves_a_front_loaded_plan_and_the_summary_shows_it`, `test_sum_mismatch_is_422_with_the_delta_copy`, `test_closed_period_is_422`; ProjectionTest (local, OK); e2e "Uneven quarter" (60/40/20 saved and shown) |
| 3 | Time entries on a project count against the period they fall into with no extra step, and entries on a billable project are always billable | ✓ VERIFIED | `ConsumptionQuery` computes live from `time_entries` by local start date (Europe/Madrid), work entries only, running entries to now, no extra step for users. `EnforceBillableOnBillableProject` runs on every `TimeEntry::saving` (API store/update/bulk, model save, Outlook conversion) and forces billable + recomputes rate. Deliberate exceptions by D-05 decision: imported entries and unchanged legacy entries are reported (`profitability:report-nonbillable`, projects-view meta), never rewritten. CI-green: EnforceBillableTest (11) incl. `test_api_update_setting_billable_false_on_a_billable_project_is_overridden`; ConsumptionTest incl. `test_month_boundary_is_decided_in_europe_madrid`; core e2e time.spec.ts / calendar.spec.ts updated to assert D-05 |
| 4 | Account managers see money sold, cost (dated hourly cost per person), margin and hours for their clients; Owner/Admin see everything; employees see nothing new; no new core roles | ✓ VERIFIED | `ProfitabilityAccess`/`AccessScope` decision table: full for Owner/Admin, account manager of client C sees C's projects with money, project manager sees hours only, everyone else `none` (404 + prop `enabled:false`). Cost via `ConsumptionQuery::joinDatedRate` (LEFT JOIN LATERAL on `member_cost_rates`, rate in force on the entry's local date; unpriced never free). `ClientRollupService`/ClientsView give amount, cost, margin, hours per client. Roles untouched: `ProfitabilityIsolationTest` asserts Role cases owner/admin/manager/employee/placeholder and PermissionStore unchanged (local run OK). CI-green: AuthorizationMatrixTest (19 routes x 7 scopes, route canary, recursive money-key scan for project manager), DatedCostTest, ClientsViewTest, ScopedSummaryAccessTest; e2e profitability-access.spec.ts |
| 5 | Each person's chargeability (billable / available hours from a dated working week, minus Vacaciones and Festivo time) is shown against their target on the "Rentabilidad" page, which also has project and client views and a summary on each project page | ✓ VERIFIED | `ChargeabilityService::forRange`: available = dated working week (Mon-Fri) minus time on marked absence projects, chargeability = billable / available, target = dated row at range end; `PeopleViewController` (Owner/Admin only) feeds `PeopleView` + `ChargeabilityChart`. Page: `resources/js/Pages/Profitability.vue` -> `ProfitabilityPage` with tabs discovered from `*View.vue` (Projects, Clients, People, Settings) filtered by server `views`; sidebar item in `AppLayout.vue`; `ProjectSummaryCard` mounted in `ProjectShow.vue:156`. Label: `lang/es/profitability.php` 'nav' => 'Rentabilidad', English 'Profitability' (D-17). CI-green: ChargeabilityTest (7), PeopleSettingsTest, AbsenceProjectsTest; deployed bundle has all 8 screen markers |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

Behavior-dependent truths (renewal, archive pause/resume, billable enforcement, plan-sum invariant, dated cost) each have named feature tests that ran green in CI on d81587b3 (108 Profitability PASS lines = 27 classes x 4 jobs, one PASS line per class, so every class passed). They are not left PRESENT_BEHAVIOR_UNVERIFIED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/Profitability/` (47 PHP files: provider, access, periods, reporting, controllers, requests, models, 3 migrations, 6 route files, 2 commands) | Fork module | ✓ VERIFIED | Registered once in `config/app.php:254`; routes and migrations loaded from the module |
| `resources/js/profitability/` (32 components/modules + 25 test files) | UI | ✓ VERIFIED | Wired through `Pages/Profitability.vue`, `ProjectShow.vue`, `AppLayout.vue` |
| `lang/en/profitability.php`, `lang/es/profitability.php` | Copy | ✓ VERIFIED | ProfitabilityLangTest OK locally |
| `config/profitability.php` | Settings | ✓ VERIFIED | Timezone, at-risk threshold, run-rate minimum, renew time; no env reads |
| `tests/Feature/Profitability` (19 classes), `tests/Unit/Profitability` (8 classes), 2 e2e specs | Proof | ✓ VERIFIED | Unit 118/118 OK locally; feature + e2e green in CI |
| `verify.artifacts` across 20 plans | | 63/64 | Only miss: 08-15 `settingsApi.ts` "Missing pattern: settings/people" is a false negative; the URL is built by `settingsUrl(organizationUrl, 'people')` -> `${organizationUrl}/settings/people` (settingsApi.ts:268-273) |

### Key Link Verification

`verify.key-links` across all 20 plans: 46/46 verified. Manually traced:

| From | To | Via | Status |
|------|----|-----|--------|
| `config/app.php` | `ProfitabilityServiceProvider` | providers entry | WIRED |
| Provider | `EnforceBillableOnBillableProject` | `TimeEntry::saving` | WIRED |
| Provider | `RecordRenewalPause` | `Project::updated` | WIRED |
| Provider | `profitability:renew-periods` | `callAfterResolving(Schedule)` daily 04:30 Europe/Madrid | WIRED |
| `ShareProfitabilityInertiaData` | all Inertia pages | `pushMiddlewareToGroup('web')`, `organization_url` + labels + views | WIRED |
| `ProjectSummaryCard` / views | summary, plan, contract, views/*, settings/* routes | axios via `organization_url` (summaryApi, contractsApi, projectsApi, clientsApi, peopleApi, settingsApi) | WIRED |
| Summary/views controllers | `ConsumptionQuery` / `ProjectBalanceService` / `ChargeabilityService` | real SQL on time_entries + fork tables | FLOWING |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| ProjectSummaryCard | period, months, projection, money | `ProjectBalanceService` <- `ConsumptionQuery` (time_entries) + contract_periods/months + member_cost_rates | Yes | ✓ FLOWING |
| ProjectsView | rows, meta | `ProjectsViewController` -> `projectRow` | Yes | ✓ FLOWING |
| ClientsView | per-client amount/cost/margin/hours | `ClientRollupService` <- `ConsumptionQuery::byProjectMonth` | Yes | ✓ FLOWING |
| PeopleView | chargeability vs target | `ChargeabilityService` <- `ChargeabilityQuery` + member_work_weeks + absence projects | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite (calendar, projection, access table, available hours, isolation, lang) | `php vendor/bin/phpunit tests/Unit/Profitability` | OK (118 tests, 48079 assertions) | ✓ PASS |
| Frontend unit suite | `npx vitest run resources/js/profitability` | 25 files, 288 tests passed | ✓ PASS |
| Fork isolation ledger | `bash tests/Tools/m365-merge/ledger-check.sh` | `ledger-check: OK (modified 43, added 725, conflicts 0)` | ✓ PASS |
| Feature tests + Playwright | CI on d81587b3 (established by orchestrator) | 108 Profitability PASS lines; e2e contract/access specs green | ✓ PASS |
| Deployed app | public checks (established by orchestrator) | routes 401 unauthenticated, 8 bundle markers present | ✓ PASS |

### Probe Execution

Not applicable: no probe scripts declared by the phase.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| BUDG-01 | 08-04, 08-08, 08-16 | ✓ SATISFIED | ContractTermsController + ContractEditor; ContractTermsTest |
| BUDG-02 | 08-04, 08-08, 08-09 | ✓ SATISFIED | PeriodMaterializer, RenewPeriodsCommand, RecordRenewalPause; future terms editable (`apply_to=next_period`, upcoming period kept materialized) |
| BUDG-03 | 08-01, 08-07 | ✓ SATISFIED | ConsumptionQuery, EnforceBillableOnBillableProject |
| BUDG-04 | 08-04, 08-09, 08-13, 08-16 | ✓ SATISFIED | PlanController, Projection, PlanGrid, PeriodMonthTable |
| BUDG-05 | 08-05, 08-10, 08-15 | ✓ SATISFIED | member_cost_rates + dated LATERAL join; DatedCostTest `test_a_retroactive_rate_changes_only_entries_from_its_date` |
| BUDG-06 | 08-10, 08-14, 08-17 | ✓ SATISFIED | ClientsView/ClientRollupService, AccessScope money gates, AuthorizationMatrixTest |
| BUDG-07 | 08-03, 08-15 | ✓ SATISFIED | project_managers / client_account_managers tables; core roles unchanged |
| CHRG-01 | 08-05, 08-15 | ✓ SATISFIED | member_work_weeks with weekly_seconds + target, dated; PeopleSettingsTest |
| CHRG-02 | 08-11, 08-18 | ✓ SATISFIED | ChargeabilityService; ChargeabilityTest |
| CHRG-03 | 08-02, 08-06, 08-12, 08-13, 08-17, 08-18 | ✓ SATISFIED | Page with Projects/Clients/People views + project card |

No orphaned requirements. REQUIREMENTS.md traceability still shows "Pending" and ROADMAP plan checkboxes are unticked: bookkeeping for the orchestrator, not a gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 153 files changed since 5971ab1a (outside .planning) | - | TBD / FIXME / XXX / TODO / HACK / placeholder | none found | - |

### Notes (informational, not gaps)

- D-05 exceptions are deliberate: imported entries, legacy entries saved without changing project/billable/type, and organizations without billable rates (core `BillingContract::canUseBillableRates` returns true in this fork, so the last never applies here).
- Open product questions recorded by 08-19/08-20 (not required by any SC): the end date of a one-off contract is locked once it has started; a contract created while its project is archived back-fills its periods on un-archive.
- Absence is an explicit per-project marker set in Settings, not a name match on "Vacaciones"/"Festivo"; until the owner marks them chargeability treats that time as internal.

### Human Verification Required

1. **Settings on real data**: Owner adds hourly cost and working week (40 h, 75 %) for two people, marks Vacaciones and Festivo as absence, assigns an account manager and a project manager. Expected: each save confirms; unset people show "Not set".
2. **Contract on a real billable project**: Set contract terms with a mid-month start, then Plan months front-loaded. Expected: prorated stub period, hours sold/consumed/to consume, projection, monthly chart; plan saves only when months add up.
3. **Figures**: Projects, Clients, People tabs; a client margin and a person's chargeability match expectations; absence lowers available hours.
4. **Visibility with real accounts**: project manager sees hours only; employee sees nothing new.
5. **Enforcement and visuals**: a non-billable attempt on a billable project stays billable; card/meter/charts readable in light/dark and at phone width; long service text wraps; 12-month plan grid usable at 768px height.
6. **Production migrations and legacy report**: `migrate:status` shows the three profitability migrations ran; run `profitability:report-nonbillable` once and decide on legacy entries.
7. **Production scheduler**: `profitability:renew-periods` listed and running daily at 04:30 Europe/Madrid.
8. **Page name**: accept "Profitability" in English UI or confirm "Rentabilidad" in Spanish locale.

### Gaps Summary

No gaps. Every ROADMAP success criterion and all ten requirements have implementation in the fork module, wiring into core through the six ledgered seams, and behavioral tests that ran green in CI, with unit and frontend suites re-run green locally. What remains is owner acceptance on real data and production-side confirmations the verifier cannot reach (migrations, scheduler, legacy non-billable count), so the status is human_needed.

---

_Verified: 2026-11-27T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
