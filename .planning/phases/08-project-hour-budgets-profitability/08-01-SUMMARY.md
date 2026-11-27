---
phase: 08-project-hour-budgets-profitability
plan: 01
subsystem: profitability-server
tags: [profitability, tracer, contracts, access-scope, consumption, web-guard]
requires: []
provides:
  - "App\\Profitability module skeleton: ProfitabilityServiceProvider wired by one use line and one providers entry in config/app.php; every file of app/Profitability/routes loaded in sorted order"
  - "Tables project_contracts (unique project_id), contract_periods (unique contract_id+starts_on), contract_period_months (unique period_id+month), every FK cascadeOnDelete/cascadeOnUpdate"
  - "Models ProjectContract (periods() ordered by starts_on) and ContractPeriod"
  - "AccessScope (none/full, isFull, hasAnyAccess, canViewProject, canEditTerms, canEditPlan, hasMoneyFor, hasAnyMoney, canViewClient, managedProjectIds, accountClientIds, views) and ProfitabilityAccess::forUser (Owner/Admin full, everyone else none)"
  - "ConsumptionQuery::secondsByMonth / totalSeconds / timezone(): live work time by local month (profitability.timezone, default Europe/Madrid), running entries up to now, one read-only statement rounded once"
  - "GET profitability/organizations/{organization}/projects/{project}/summary (profitability.projects.summary), web guard, throttle 120/min"
  - "tests/Feature/Profitability/ProjectSummaryTest.php with the reusable assertNoKeyMatches helper (12 tests)"
affects: [08-02, 08-03, 08-04, 08-06, 08-09, 08-10]
requirements-completed: [BUDG-03, CHRG-03]
tech-stack:
  added: []
  patterns:
    - "Fork route files are globbed from app/Profitability/routes by the provider: later plans add a file, never edit the provider"
    - "Scope resolved before any read; every out-of-scope or unknown id is a ModelNotFoundException 404"
    - "Response built from explicit arrays, never toArray(); money keys absent (not null)"
key-files:
  created:
    - app/Profitability/ProfitabilityServiceProvider.php
    - app/Profitability/routes/profitability.php
    - app/Profitability/database/migrations/2026_11_27_000001_create_profitability_contract_tables.php
    - app/Profitability/Models/ProjectContract.php
    - app/Profitability/Models/ContractPeriod.php
    - app/Profitability/Access/AccessScope.php
    - app/Profitability/Access/ProfitabilityAccess.php
    - app/Profitability/Reporting/ConsumptionQuery.php
    - app/Profitability/Http/Controllers/ProjectSummaryController.php
    - tests/Feature/Profitability/ProjectSummaryTest.php
  modified:
    - config/app.php
decisions:
  - "contract_period_months also carries organization_id (FK, cascade) like the other two tables: the plan's 'three organization FKs' acceptance count; 6 cascading FKs in total"
  - "The profitability timezone is read through ConsumptionQuery::timezone() (config profitability.timezone, default Europe/Madrid) so the controller's 'today' and the SQL buckets can never disagree; config/profitability.php itself arrives in a later plan"
  - "Time bounds and 'now' are bound as explicit UTC 'Y-m-d H:i:s' strings (time_entries stores UTC timestamps without time zone)"
  - "ConsumptionQuery is also plain-bound in the provider (closure receives the container, Larastan octaneCompatibility)"
metrics:
  duration: "about 25 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 10000
  tasks: 3
  commits: 3
plan_head_before: 5bf7eb27bc87b9ee10ec110f0553fc17a3a5c6c1
plan_head_after: 129ab21c5514fb30e510572992d86f1955995d15
---

# Phase 8 Plan 01: Profitability server tracer Summary

An Owner or Admin reads, over a fork web-guard JSON route, the current contract period's hours sold (`budget_seconds`) and hours consumed (`consumed_seconds`, live from work time entries bucketed by local date in Europe/Madrid). Everyone else gets a plain 404. The only core change is one provider line in `config/app.php`.

## What was built

- **Provider** `App\Profitability\ProfitabilityServiceProvider`: plain binds for `ProfitabilityAccess` and `ConsumptionQuery`; `boot()` loads every `app/Profitability/routes/*.php` in sorted order and the module migrations. No Inertia share from `boot()`.
- **Migration** `2026_11_27_000001`: `project_contracts` (D-01 1:1 by unique `project_id`; schedule string(16); template `amount_cents`/`budget_seconds`; D-18 `paused_on`/`resume_on`), `contract_periods` (inclusive local dates, unique `contract_id, starts_on`), `contract_period_months` (unique `period_id, month`). All three carry `organization_id`; every FK cascades (comment: core bulk-deletes without Eloquent events). `down()` drops in reverse order.
- **Access**: `AccessScope` (final readonly, full interface for later plans) and `ProfitabilityAccess::forUser()` (member through `PermissionStore::getMember`; `Role::Owner`/`Role::Admin` give full, everything else none until 08-03 adds assignments). No static cache.
- **Consumption**: `ConsumptionQuery` builds one statement over `time_entries`: organization and project match, `type = 'work'`, start inside the UTC bounds of the local date range (start of `fromDate` inclusive, start of the day after `toDate` exclusive), `coalesce("end", now) - "start"`, `round(sum(...))` once; months through `TimezoneService::getLocalDateTimeSqlExpression('start', ...)`. Never writes; never reads `spent_time`.
- **Endpoint** `ProjectSummaryController::show`: scope first, then project lookup inside the route organization (`firstOrFail`), `canViewProject`, contract load, 404 for a non-billable project without contract; current period = the one with `starts_on <= today <= ends_on` (today in the profitability timezone). Response `{ data: { project_id, can_edit_terms, can_edit_plan, contract, period } }` from explicit arrays, no money key.
- **Route** `GET /profitability/organizations/{organization}/projects/{project}/summary`, `['web', 'auth:web', 'auth.session', 'verified']`, `whereUuid`, `throttle:120,1,profitability-read:`.
- **Tests** `ProjectSummaryTest` (12): Owner tracer with timezone-boundary entries (Oct 31 23:30 UTC counts, Oct 31 22:30 UTC does not); Admin; Employee and core Manager 404; placeholder 404; foreign project, unknown id and non-member organization 404; non-billable without contract 404; billable without contract answers `contract: null`; no money key (recursive `assertNoKeyMatches`); breaks (even bulk-forced onto the project) and other projects never count; running entry counts up to now (7200 s); entry starting on the last local day counts in full while the next local day does not; entries of other organizations never count.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 6b6fdb76 | feat(08-01): project contract hours summary, end to end for Owner |
| 2 | 0cd415fa | test(08-01): summary scope gate answers 404 outside Owner and Admin |
| 3 | 129ab21c | test(08-01): consumption counts the period's work time only |

## Gates

- Route check: `artisan route:list --path=profitability` (worktree-first loader) prints exactly `GET|HEAD profitability/organizations/{organization}/projects/{project}/summary 4`.
- `php -l` on every new file: clean. Pint `--test` on `config/app.php app/Profitability tests/Feature/Profitability`: passed. PHPStan (full app, level 7, worktree-first autoload): `[OK] No errors`.
- Generated SQL checked offline (tinker `toSql`): bindings `[Europe/Madrid, now, org, project, work, 2026-10-31 23:00:00, 2026-11-30 23:00:00]` for the November period.
- Acceptance greps: `ProfitabilityServiceProvider` in config/app.php = 2; `cascadeOnDelete` = 6; the two unique constraints = 2; no diff against `origin/feature/m365-integration` on routes/web.php, routes/api.php, openapi.json, PermissionStore.php, Role.php; `Role::Owner|Role::Admin` in ProfitabilityAccess = 1; `getLocalDateTimeSqlExpression` = 1, `spent_time` = 0 in ConsumptionQuery; 12 `function test_`; 1 `function assertNoKeyMatches`.
- `tests/Feature/Profitability/ProjectSummaryTest.php`: **PENDING CI (orchestrator)** (needs Postgres).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Larastan octaneCompatibility on the provider binds**
- **Found during:** Task 1 (Gate P)
- **Issue:** `$this->app->make(...)` inside the bind closures was flagged by `larastan.octaneCompatibility`.
- **Fix:** the closures take the container as a parameter (`fn (Application $app) => ...`).
- **Files modified:** app/Profitability/ProfitabilityServiceProvider.php
- **Commit:** 6b6fdb76

**2. [Rule 1 - Bug, test] Non-owner users must be saved before acting as them**
- **Found during:** Task 2
- **Issue:** `createUserWithRole` associates the current organization of a non-owner without saving the user (the M365 tests call `$data->user->save()` for the same reason).
- **Fix:** test helper `actAs(User)` saves then calls `actingAs`.
- **Files modified:** tests/Feature/Profitability/ProjectSummaryTest.php
- **Commit:** 0cd415fa

Otherwise the plan was executed as written. Task 3 needed no change to `ConsumptionQuery` (the cases could not be run locally; they are PENDING CI).

## Known Stubs

None. `ConsumptionQuery::secondsByMonth()` is not called yet by this plan's endpoint (it is the documented interface for the monthly plan/chart plans); `ProfitabilityAccess` returns `none()` for every non-Owner/Admin by design until 08-03.

## Open items

- Feature PHPUnit (`ProjectSummaryTest`, 12 tests) and the wave CI gate: PENDING CI (orchestrator).
- `config/profitability.php` does not exist yet; the timezone falls back to `Europe/Madrid` until the plan that adds it.

## Self-Check: PASSED

- FOUND: all 10 created files and config/app.php change
- FOUND: 6b6fdb76, 0cd415fa, 129ab21c (ancestors of HEAD)
