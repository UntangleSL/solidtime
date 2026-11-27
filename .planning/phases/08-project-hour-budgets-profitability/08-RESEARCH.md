# Phase 8: Project Hour Budgets & Profitability - Research

**Researched:** 2026-11-27
**Domain:** Laravel 13 / Inertia / Vue 3 / PostgreSQL fork module: per-project contract terms (hours + EUR, renewing periods), dated cost and working-week data, profitability and chargeability reporting, strict role-based visibility of money
**Confidence:** HIGH for codebase seams and fork conventions (all read this session); MEDIUM for domain formulas (revenue recognition, projection thresholds) which are design decisions flagged in the Assumptions Log

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** A contract is the project itself. There is no separate contract entity. A project's contract terms: service description, amount sold (EUR) per period, hours sold/estimated per period, renewal schedule (one-off with start and end date, or renewing monthly, quarterly or annually), start date and optional end date. — **Reversibility:** costly — new tables and a migration; adding a contract entity later means moving terms off the project.
- **D-02:** Within one contract period the hours are planned per month and may be uneven (the owner typically plans more hours in the first months). The plan defaults to an even split and the project manager can rebalance it; overrunning one month is fine as long as the period total holds. The key output is the projection: within the hours sold, how much has been consumed and how much must still be consumed (or is projected to be consumed) by the period close.
- **D-03:** Each renewal starts clean: no hour balance carries from one contract period to the next. The finished period stays closed with its own result.
- **D-04:** A renewing project renews automatically at the start of each period with the same hours and amount, until someone sets an end date or archives the project. The terms of a future period can be changed before it starts.
- **D-05:** On a billable client project every time entry is billable; non-billable time cannot be logged there. Work that also serves other projects or Untangle itself is split and logged to an internal Untangle project (non-billable). All time on the project counts against its contract. — **Reversibility:** costly — changes how existing entries on billable projects are treated; existing non-billable entries on billable projects need a decision during planning (report them, do not silently rewrite).
- **D-06:** Time logged to special projects "Vacaciones" and "Festivo" is absence: it lowers the person's available hours for chargeability and is not counted as internal non-billable time. Full holiday calendars per employee and marked days off come in the people-assignment phase.
- **D-07:** Profitability is shown in both hours and money. Hours are for people to regulate themselves; account managers and partners also see money, to see how the balance spreads across clients.
- **D-08:** Margin uses a cost per hour per person with an effective date: an Admin sets each person's hourly cost from a date; a later value applies from its date and past months keep the earlier one. — **Reversibility:** costly — dated cost table and migration.
- **D-09:** Currency is EUR (Claude's discretion unless the organization currency setting says otherwise; follow the existing organization currency).
- **D-10:** Project manager and account manager are assignments, not new solidtime roles: a project has one or more project managers, a client has one or more account managers. solidtime's core roles and PermissionStore stay unchanged (mergeability). — **Reversibility:** costly — assignment tables; switching to global roles later would touch core permissions.
- **D-11:** Visibility:
  - Employee: nothing new in this phase (they keep seeing their own hours). Their assignment and available hours per project arrive with the people-assignment phase.
  - Project manager: the hour balances of the whole project(s) they manage (no money required).
  - Account manager: per client, money sold, project profitability and the global balance of their clients.
  - Owner/Admin: everything, plus configuration.
  - Placeholder members (people without an account, from imports or ex-staff) cannot log in and have no view; their past hours still count.
- **D-12:** Editing: the account manager sets amount sold, contract hours and renewal; the project manager distributes those hours across the months of the period; Owner and Admin can edit everything. Hourly costs and working weeks are Admin/Owner only.
- **D-13:** Chargeability per person = billable hours / available hours. Available hours come from the person's working week (for example 40 h) with an effective date, minus absence hours (D-06). Each person has a chargeability target (for example 75 %), also dated.
- **D-14:** A new page "Rentabilidad" with three views: by project (hours, money, projection to close), by client (account manager portfolio) and by person (chargeability). Plus a summary on each project's page. Labels in Spanish and English like the rest of the fork.

### Claude's Discretion
- Exact page layout, charts and table columns (reuse existing reporting/chart components).
- Where the Vacaciones/Festivo marker lives (a flag on the project is the likely shape).
- How the monthly plan is edited (grid of months is the expected shape).
- Projection method to period close (linear run rate vs remaining plan; show both if cheap).
- How existing upstream `estimated_time` on projects relates to contract hours (reuse or ignore, but do not break the upstream field).

### Deferred Ideas (OUT OF SCOPE)
- People assignment to projects and occupancy per month or period (employee sees their assignment and available hours per project) — new phase after Phase 8.
- Holiday calendar per employee and marked days off — with the assignment phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BUDG-01 | Account manager (or Owner/Admin) sets contract terms: service, amount (EUR) and hours per period, one-off or renewing monthly/quarterly/annually, start date, optional end date | `project_contracts` table (1:1 with project, fork-owned); `ContractSchedule` enum; `ContractTermsController` gated by `ProfitabilityAccess`; Data Model section |
| BUDG-02 | Renewing project starts a new period automatically with same terms until end date/archive; each period clean; future-period terms editable | `contract_periods` rows; lazy `PeriodMaterializer` on read plus daily `profitability:renew-periods` safety net registered like `m365:check-out-of-sync`; pure `PeriodCalendar` |
| BUDG-03 | Time entries count against the period they fall into with no extra step; on a billable project every entry is billable | Consumption computed live from `time_entries` bucketed by local start date; fork-side `TimeEntry::saving` listener forcing `billable = true` and recomputing `billable_rate`; report-only command for legacy non-billable rows |
| BUDG-04 | Project manager distributes a period's hours across months (uneven allowed), sees planned vs consumed per month and projection to close | `contract_period_months` plan rows (invariant: sum = period budget); `PlanDistributor`; pure `Projection` (remaining-plan + linear run rate) |
| BUDG-05 | Admin sets each person's hourly cost with effective date; past months keep earlier cost | `member_cost_rates` (dated); SQL `LEFT JOIN LATERAL` picks the rate effective on each entry's local date |
| BUDG-06 | Account managers see per client: money sold, cost, margin, hours; Owner/Admin all; employees nothing new | `client_account_managers`; `AccessScope`; money fields omitted (not nulled) from JSON for non-money scopes; authorization matrix tests |
| BUDG-07 | PM and AM are assignments on projects/clients, no new core roles | `project_managers`, `client_account_managers` tables; PermissionStore untouched |
| CHRG-01 | Admin sets working week (hours) and chargeability target with effective date | `member_work_weeks` (dated; both values in one row) |
| CHRG-02 | Chargeability = billable hours / available hours; "Vacaciones"/"Festivo" time reduces available hours | `profitability_absence_projects` marker table; pure `AvailableHoursCalculator`; `ChargeabilityService` |
| CHRG-03 | "Rentabilidad" page with project/client/person views plus summary on each project page | `app/Profitability` module + `resources/js/profitability`; thin `resources/js/Pages/Profitability.vue`; nav + ProjectShow seams |
</phase_requirements>

## Summary

Phase 8 is a self-contained fork module, `app/Profitability/` (namespace `App\Profitability`) plus `resources/js/profitability/`, built exactly like the two existing fork modules (`app/Microsoft365`, `app/Appearance`): one provider line in `config/app.php`, routes/migrations/commands loaded from the provider, web-guard JSON endpoints that never appear in `openapi.json`, labels in `lang/en` + `lang/es`. Core contact is limited to three tiny seams (provider line, one nav item in `AppLayout.vue`, one summary component in `ProjectShow.vue`) plus new thin files in core directories. No core role, permission, table or controller is changed. [VERIFIED: config/app.php:251-252 lists `Microsoft365ServiceProvider::class,` and `AppearanceServiceProvider::class,`]

The data model keeps contract terms on the project logically (D-01) but physically in fork tables keyed 1:1 by `project_id`, so the core `projects` table is untouched: a `project_contracts` row (template terms + schedule), materialized `contract_periods` rows (per-period amount and seconds, editable until they start), `contract_period_months` plan rows, dated `member_cost_rates`, dated `member_work_weeks` (working week + chargeability target), assignment tables for project managers and client account managers, and an absence-project marker table. Money is integer cents and durations are integer seconds, matching upstream (`billable_rate` in cents, `estimated_time`/`spent_time` in seconds). Consumption is always computed live from `time_entries` (never from the async `projects.spent_time`), bucketed by the entry's start in a fixed organization timezone, the same convention Goals use. Dated cost is applied per entry with a PostgreSQL `LEFT JOIN LATERAL`, a technique the codebase already uses.

D-05 (billable forced on billable projects) is enforced with a single fork-side Eloquent `saving` listener on `TimeEntry`, registered from the provider. All core write paths (API store/update/updateMultiple, importers, the fork's in-process Outlook conversion) end in `$timeEntry->save()`, so one listener covers them all; the listener must also recompute `billable_rate` because core computes it before `save()` from the then-current `billable` value. Existing non-billable entries on billable projects are never rewritten: a report-only artisan command and a "data quality" counter surface them. The highest-risk area is authorization: money and cost must be absent from every Inertia prop and JSON payload for non-money scopes, proven by an authorization-matrix feature test and a recursive forbidden-key scan.

**Primary recommendation:** Build `App\Profitability` as a fork module with pure, DB-free calculators (`PeriodCalendar`, `PlanDistributor`, `Projection`, `AvailableHoursCalculator`) tested with plain PHPUnit, a single SQL consumption query (member x project x local month with lateral dated cost), lazy period materialization on read (cron only as a safety net), and an `AccessScope` resolver that is the single gate for every endpoint and for the shared Inertia prop.

## Project Constraints (from CLAUDE.md)

Extracted from `.claude/CLAUDE.md` (authority equal to locked decisions):
- PHP 8.3, Laravel 13, Vue 3 + Inertia, PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`.
- Every PHP file starts `<?php` + `declare(strict_types=1);`; typed params/returns; Pint preset `laravel` + `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`, `void_return`.
- PHPStan/Larastan level 7 over `app/` with `noEnvCallsOutsideOfConfig` — never call `env()` outside `config/`.
- Form Requests under `app/Http/Requests/V1/<Resource>/` for core; fork modules keep requests inside their module (see `app/Microsoft365/Http/Requests`). Permission checks via helper methods, not inline strings.
- API/JSON controllers return Resources, never raw models.
- Vue: `<script setup lang="ts">`, `defineProps<{...}>()`, Tailwind theme tokens (no raw colors), Prettier 4-space/single quotes/100 cols, ESLint `unused-imports`.
- Tests: snake_case `test_` methods, `Tests\TestCaseWithDatabase` for DB tests; Vitest co-located `*.test.ts`; Playwright specs kebab-case in `e2e/`.
- Entity IDs are strings in TS/JSON. No `console.log`. Use `Log` facade.
- Mergeability: fork code isolated; every core file touched is added to `docs/m365/TOUCHED-CORE-FILES.md`.
- GSD workflow enforcement: edits only through GSD commands.
- Project memory: never read `.env*`; no local DB (feature tests run in CI only).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Contract terms, periods, plan, cost/working-week persistence | Database / Storage (fork tables) | API / Backend | Must not alter core `projects`; cascading FKs to org/project/client/member |
| Period renewal (materialization) | API / Backend (service, lazy on read) | Scheduler (daily command safety net) | Correctness must not depend on cron (first real m365 cron run is still unobserved) |
| Billable enforcement (D-05) | API / Backend (Eloquent `saving` listener) | — | Server-side rule covers API, imports, Outlook conversion; UI is not trusted |
| Consumption / cost aggregation | Database (single SQL with lateral rate join) | API / Backend | Set-based aggregation; avoids N+1 over entries |
| Projection, available hours, plan distribution | API / Backend (pure PHP classes) | Browser (display only) | One source of truth, unit-testable without DB |
| Authorization and money redaction | API / Backend (`AccessScope`) | Frontend Server (shared Inertia prop = booleans/URLs only) | Redaction must happen before serialization; frontend visibility is cosmetic |
| "Rentabilidad" page + project summary | Browser / Client (Vue, TanStack Query, ECharts) | Frontend Server (thin Inertia page) | Matches how core pages fetch data; page prop carries only labels/URLs |
| Navigation entry | Browser / Client | Frontend Server (shared prop with `url`) | Needs per-user access flag without a Ziggy dependency |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Laravel Framework | ^13.0 [VERIFIED: .claude/CLAUDE.md Technology Stack] | Models, migrations, routes, scheduler, Eloquent events | Already the app framework |
| PostgreSQL | 15 [VERIFIED: .claude/CLAUDE.md] | `LATERAL` join, `AT TIME ZONE`, `date_trunc`, `DISTINCT ON` | Already used by `TimeEntryAggregationService` (LATERAL at line 59) |
| Inertia (laravel + vue3) | 3.3+ / ^2.3 [VERIFIED: .claude/CLAUDE.md] | Thin page + shared prop | Fork pattern (`ShareMicrosoftInertiaData`) |
| @tanstack/vue-query | ^5.100 [VERIFIED: .claude/CLAUDE.md] | Server state for JSON endpoints | Core pattern for data pages |
| echarts + vue-echarts | ^6.0 / ^8.0 [VERIFIED: .claude/CLAUDE.md] | Charts (planned vs consumed bars, projection) | Reuse `ReportingChart.vue` setup (use([...]) tree-shaken imports, `useCssVariable` tokens) |
| axios (global) | existing | Fork web-route calls with XSRF | `resources/js/m365/calendar/meetingsApi.ts` uses `import axios from 'axios'` for fork web routes, "never the generated OpenAPI client" |
| carbon (via Laravel) | existing | Period math in a fixed tz | `GoalProgressService::getPeriodBounds` pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `App\Service\TimezoneService::getLocalDateTimeSqlExpression` | in repo | Local-date SQL for month bucketing | Month bucket and dated-cost join (returns `sql` + `bindings`) |
| `@/packages/ui/src/utils/money` `formatCents` | in repo | Money formatting using org currency/format | All money display (used by `ProjectShow.vue`) |
| `Tests\TestCaseWithDatabase` | in repo | `createUserWithRole(Role::X)` fixtures | Authorization matrix tests |
| Vitest 4.1 + happy-dom | existing | Component and helper tests | `include: ['resources/js/**/*.{test,spec}.{ts,tsx}']` already covers `resources/js/profitability/` |
| Playwright 1.60 | existing | E2E | `e2e/profitability-*.spec.ts` using `admin`/`employee` fixtures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fork tables keyed by `project_id` | Columns on core `projects` | Columns would touch a core table/model/migration and every upstream `projects` change; rejected (mergeability, D-10 spirit) |
| `brick/money` | Integer cents + `formatCents` | `brick/money` is in the stack but not needed: no currency conversion, EUR/org currency only; plain ints avoid float drift |
| Cron-only renewal | Lazy materialization on read + cron safety net | Cron-only fails silently if the scheduler is not running (Phase 6 note: first real m365 05:30 run not observed) |
| Reusing `TimeEntryAggregationService` | Dedicated fork SQL | The core service has no dated-cost join and no absence logic; extending it would touch core. Reuse only `TimezoneService` |
| Persisting per-entry cost | Compute at read | Persisting duplicates data and goes stale when a cost row is added retroactively; compute live |

**Installation:** none. No new Composer or npm packages are required. [VERIFIED: stack above already contains every capability used]

**Version verification:** No package is added, so no registry lookup applies.

## Package Legitimacy Audit

No external packages are installed in this phase.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Time entry writes (API v1, importers, Outlook conversion, web UI)
        |  all end in TimeEntry::save()
        v
 [Fork saving listener] -- project.is_billable & type=work & project set? --> billable=true, recompute billable_rate
        |
        v
   time_entries (core table, untouched)
        |
        |   read-only aggregation (no writes to core)
        v
 ConsumptionQuery (SQL: member x project x local-month,
                   LEFT JOIN LATERAL member_cost_rates by local start date)
        |                         ^
        |                         | dated rows
        |                member_cost_rates / member_work_weeks  (Admin/Owner write)
        v
 Balance services  <--- contract_periods / contract_period_months (plan)  <--- PeriodMaterializer (lazy on read; daily cron safety net)
   |  ProjectBalanceService (period hours, plan vs consumed, Projection)
   |  ClientRollupService   (sum of projects of a client, per month)
   |  ChargeabilityService  (billable / (AvailableHoursCalculator - absence))
        |
        v
 AccessScope (single gate) --> Resources (money keys OMITTED unless scope has money)
        |
        v
 Web-guard JSON  /profitability/organizations/{org}/...   (not in openapi.json)
        |
        v
 Vue: Profitability page (3 views) + ProjectShow summary  (TanStack Query, ECharts)
        ^
 Inertia shared prop `profitability` = { access flags, urls, labels }  (booleans/URLs only; drives nav item)
```

### Recommended Project Structure
```
app/Profitability/
├── ProfitabilityServiceProvider.php   # mergeConfig not used; routes, migrations, commands, schedule, saving listener, shared-prop middleware
├── Access/                            # AccessScope (DTO), ProfitabilityAccess (resolver)
├── Console/                           # RenewPeriodsCommand, ReportNonBillableCommand
├── Enums/ContractSchedule.php         # one_off | monthly | quarterly | annual
├── Http/{Controllers,Requests,Resources,Middleware}/
├── Models/                            # ProjectContract, ContractPeriod, ContractPeriodMonth, MemberCostRate,
│                                      # MemberWorkWeek, ProjectManager, ClientAccountManager, AbsenceProject
├── Periods/                           # PeriodCalendar (pure), PeriodMaterializer, PlanDistributor (pure)
├── Reporting/                         # ConsumptionQuery, ProjectBalanceService, ClientRollupService,
│                                      # ChargeabilityService, AvailableHoursCalculator (pure), Projection (pure)
├── TimeEntries/EnforceBillableOnBillableProject.php
├── database/migrations/
└── routes/profitability.php
resources/js/profitability/
├── api.ts, types.ts, money.ts         # axios helpers (web routes), runtime parsers like meetingsApi.ts
├── ProfitabilityPage.vue              # tabs: projects | clients | people
├── ProjectsView.vue, ClientsView.vue, PeopleView.vue
├── ProjectSummaryCard.vue             # used from ProjectShow.vue
├── ContractEditor.vue, PlanGrid.vue, CostRatesEditor.vue, WorkWeekEditor.vue, AssignmentsEditor.vue
├── PlannedVsConsumedChart.vue         # ECharts, modelled on ReportingChart.vue
└── *.test.ts                          # co-located Vitest
resources/js/Pages/Profitability.vue   # 3-line wrapper (new file in core dir, ledgered)
config/profitability.php               # timezone, thresholds (new file in core dir, ledgered)
lang/en/profitability.php, lang/es/profitability.php
```

Fork module conventions verified:
- The provider is the only thing core knows: "one line in config/app.php". Routes/migrations are loaded from the module directory (`$this->loadRoutesFrom(__DIR__.'/routes/microsoft365.php'); $this->loadMigrationsFrom(__DIR__.'/database/migrations');`). [VERIFIED: app/Microsoft365/Microsoft365ServiceProvider.php:34-47]
- Shared Inertia data comes from a web-group middleware, never from `boot()`: "Inertia data is deliberately not shared from boot(): Octane flushes shared props on every request." [VERIFIED: app/Microsoft365/Microsoft365ServiceProvider.php:17-19 and `$router->pushMiddlewareToGroup('web', ShareMicrosoftInertiaData::class);` at line 32]
- A second module (`app/Appearance`) registers model/event hooks from its provider: `Event::listen(BeforeOrganizationDeletion::class, DeleteOrganizationIconFile::class);` [VERIFIED: app/Appearance/AppearanceServiceProvider.php:35]

### Pattern 1: Provider wiring (copy of the M365 shape)
**What:** One provider: bind services (plain `bind`, never shared state), push the share middleware, load routes/migrations, register commands + schedule + the `TimeEntry::saving` listener.
**Example:**
```php
// Source: app/Microsoft365/Microsoft365ServiceProvider.php (pattern), adapted
public function boot(Router $router): void
{
    $router->pushMiddlewareToGroup('web', ShareProfitabilityInertiaData::class);
    $this->loadRoutesFrom(__DIR__.'/routes/profitability.php');
    $this->loadMigrationsFrom(__DIR__.'/database/migrations');

    // D-05: one listener covers API, importers and the Outlook conversion (all call ->save())
    TimeEntry::saving([EnforceBillableOnBillableProject::class, 'handle']);

    if ($this->app->runningInConsole()) {
        $this->commands([RenewPeriodsCommand::class, ReportNonBillableCommand::class]);
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('profitability:renew-periods')->dailyAt('04:30')
                ->timezone($this->configString('profitability.timezone', 'Europe/Madrid'))
                ->withoutOverlapping();
        });
    }
}
```
The `callAfterResolving(Schedule::class, ...)` + `->withoutOverlapping()` shape is verbatim from the m365 provider. [VERIFIED: app/Microsoft365/Microsoft365ServiceProvider.php:49-56 `$schedule->command('m365:check-out-of-sync')->dailyAt(...)->timezone(...)->withoutOverlapping()`]

### Pattern 2: Billable enforcement via `saving` listener (D-05)
**What:** On `saving`, when the entry is `type = work`, has a `project_id`, and the project is `is_billable`, set `billable = true` and recompute `billable_rate`.
**Why a listener and not a controller edit:** every write path funnels through `$timeEntry->save()`. Core API store/update/updateMultiple each call `setComputedAttributeValue('billable_rate')` immediately before `save()`. [VERIFIED: app/Http/Controllers/Api/V1/TimeEntryController.php:658-659, 736-737, 868-869 — `$timeEntry->setComputedAttributeValue('billable_rate');` followed by `$timeEntry->save();`] Importers build `new TimeEntry` and set `billable` from the CSV (`$timeEntry->billable = $this->canUseBillableRates && $record['billable'] === 'true';`, app/Service/Import/Importers/GenericTimeEntriesImporter.php:137) then save. The fork's `CoreTimeEntryCreator` runs core `store()` in-process, so it is covered too.
**Pitfall that shapes the code:** `getBillableRateForTimeEntry` begins `if (! $timeEntry->billable) { return null; }` [VERIFIED: app/Service/BillableRateService.php:121-124]. Core computes `billable_rate` BEFORE `save()`, with the user's (possibly false) flag, so it stores `null`. The listener must call `$timeEntry->setComputedAttributeValue('billable_rate')` itself after forcing `billable = true`.
**Listener ordering is irrelevant if the listener guards on type:** core registers `static::saving(...)` in `booted()` [VERIFIED: app/Models/TimeEntry.php:131-134] which for `TimeEntryType::Break` sets `$timeEntry->billable = false; ... $timeEntry->project_id = null;`. A fork listener must skip non-`Work` entries and entries without a project, so it never fights that rule whichever order the two listeners fire.
**Example:**
```php
// Source: design derived from TimeEntry::booted + BillableRateService (read this session)
public function handle(TimeEntry $entry): void
{
    if ($entry->type !== TimeEntryType::Work || $entry->project_id === null || $entry->billable) {
        return; // already billable: nothing to do (rate was computed by core)
    }
    $isBillable = Project::query()->whereKey($entry->project_id)->value('is_billable');
    if ($isBillable === true) {
        $entry->billable = true;
        $entry->setComputedAttributeValue('billable_rate');
    }
}
```
`billable_rate` is excluded from audits (`$auditExclude = ['billable_rate']`, TimeEntry.php) so the listener adds no audit noise for that column. Bulk `TimeEntry::query()->update(...)` bypasses model events; the core rate-sync updates only touch rows already `billable = true` [VERIFIED: app/Service/BillableRateService.php:35-58 `->where('billable', '=', true)`], so they cannot create a violation.
**Existing non-billable entries on billable projects (D-05 decision):** never rewritten. Provide (a) `profitability:report-nonbillable` artisan command (read-only; lists project, member, hours), (b) a "data quality" count on the by-project view for Owner/Admin. Consumption counts them (all time on the project counts); chargeability numerator counts only `billable = true`, so the report explains the gap. An explicit, user-initiated fix path already exists in core (`updateMultiple` with `changes.billable`), which will pass through the listener.
**Related core fact:** the API docs say `billable` "is not taken from the project", clients must set it — so without the listener an API client can log non-billable time on a billable project. [VERIFIED: TimeEntryController.php:597 `` `billable` is not taken from the project. To match the web app, set it to the project's `is_billable` value ``] The listener silently coerces; the response resource then shows `billable: true`.

### Pattern 3: Fixed-timezone period bucketing (Goals convention)
**What:** Contract periods and months are calendar-aligned in one organization timezone (default `Europe/Madrid`, same default the m365 scheduler uses: `->timezone($this->configString('microsoft365.out_of_sync.daily_timezone', 'Europe/Madrid'))`). An entry belongs to the period/month containing its `start` in that tz.
**Precedent:** "Time entries are assigned to the period their start is in, like in the reporting. A running time entry counts with its elapsed time up to now." [VERIFIED: app/Service/GoalProgressService.php:73-75] and `getPeriodBounds` computes bounds in the goal timezone then returns UTC with start inclusive and end exclusive [VERIFIED: GoalProgressService.php:42-61]. `GoalPeriod` has exactly `case Day = 'day'; case Week = 'week'; case Month = 'month';` [VERIFIED: app/Enums/GoalPeriod.php:11-13] — no quarter/year, so it cannot be reused for contracts; copy the tz-then-UTC technique only.
**SQL local-date expression (reuse, do not hand-roll):** `app(TimezoneService::class)->getLocalDateTimeSqlExpression('start', new CarbonTimeZone($tz))` returns `['sql' => '("start" AT TIME ZONE \'UTC\' AT TIME ZONE CAST(? AS text))', 'bindings' => [$tz]]`. [VERIFIED: app/Service/TimezoneService.php:340-352] Month key: `date_trunc('month', <local>)::date`.

### Pattern 4: Single consumption query with dated cost
```sql
-- Source: design; LATERAL already used in app/Service/TimeEntryAggregationService.php:59
SELECT te.member_id, te.project_id,
       date_trunc('month', (te."start" AT TIME ZONE 'UTC' AT TIME ZONE ?))::date AS month,
       sum(extract(epoch from (coalesce(te."end", ?::timestamp) - te."start")))   AS seconds,
       sum(CASE WHEN te.billable THEN extract(epoch from (coalesce(te."end", ?::timestamp) - te."start")) ELSE 0 END) AS billable_seconds,
       sum(extract(epoch from (coalesce(te."end", ?::timestamp) - te."start")) * c.hourly_cost_cents / 3600.0) AS cost_cents,
       sum(CASE WHEN c.hourly_cost_cents IS NULL THEN extract(epoch from (coalesce(te."end", ?::timestamp) - te."start")) ELSE 0 END) AS unpriced_seconds
FROM time_entries te
LEFT JOIN LATERAL (
    SELECT r.hourly_cost_cents FROM member_cost_rates r
    WHERE r.member_id = te.member_id
      AND r.effective_from <= (te."start" AT TIME ZONE 'UTC' AT TIME ZONE ?)::date
    ORDER BY r.effective_from DESC LIMIT 1
) c ON true
WHERE te.organization_id = ? AND te.type = 'work' AND te."start" >= ? AND te."start" < ?
GROUP BY 1, 2, 3
```
Round once at the end (`round(sum(...))`), never per entry. Cost columns are only selected for scopes with money (do not even query cost for PM scope). Existing index `time_entries_organization_start_id_index ON time_entries (organization_id, start DESC, id)` serves the range scan. [VERIFIED: database/migrations/2026_08_24_000001_add_application_query_indexes.php:61]
Running entries count up to now (Goals convention); break entries are excluded by `type = 'work'` (also `TimeEntry::scopeWorkTime` semantics).

### Pattern 5: Authorization as one resolver (`AccessScope`)
**What:** `ProfitabilityAccess::forUser(Organization, User): AccessScope` is the only place that decides visibility; controllers, Resources and the Inertia share middleware call it.
- Membership/role: `app(PermissionStore::class)->getMember($organization, $user)` (public, request-cached) [VERIFIED: app/Service/PermissionStore.php `public function getMember(Organization $organization, User $user): ?Member`]. `PermissionStore` is bound `scoped` [VERIFIED: app/Providers/AppServiceProvider.php:105 `$this->app->scoped(PermissionStore::class, ...)`] so it is Octane-safe; never cache scope in a static.
- Roles: `case Owner = 'owner'; case Admin = 'admin'; case Manager = 'manager'; case Employee = 'employee'; case Placeholder = 'placeholder';` [VERIFIED: app/Enums/Role.php:13-17]. Full access = `Role::Owner` or `Role::Admin` (core Admin description: "can perform any action, except accessing the billing dashboard", PermissionStore.php admin entry).
- Scope fields: `isFull`, `managedProjectIds` (from `project_managers`), `accountClientIds` (from `client_account_managers`), `moneyProjectIds` (= all for full; projects of account clients for AM; none for PM-only). Role-agnostic: an `employee`-role user assigned as PM sees that project's hour balance through this module only; core visibility of the project itself is unchanged.
- Core `Manager` role gets NO automatic profitability access (assignment-only) — this follows D-10 literally; see Assumption A3.
- Placeholder members: they cannot log in (`'placeholder' => [... 'permissions' => [], 'description' => 'Placeholders are used for importing data. They cannot log in and have no permissions.']`, PermissionStore.php:268-271); validate that PM/AM assignments and cost/working-week rows can be created for them only where meaningful (AM/PM: reject placeholders; cost: allow — past hours of placeholders still need a cost).

### Anti-Patterns to Avoid
- **Serializing then nulling money:** keys must be absent for non-money scopes, not `null` (a `null` leaks the schema and invites frontend bugs). Build two resource shapes (hours; money) and merge by scope.
- **Reading `projects.spent_time`:** async job-maintained ("Queued jobs keeping project/task totals up to date") and includes no period/month split; compute live.
- **Cron-only renewal:** see Pitfall 5.
- **Putting contract columns on core `projects`:** touches core model, migration, ProjectResource, OpenAPI.
- **Sharing computed data in the Inertia prop:** the nav needs only `access` booleans, `url`, `labels`.
- **Static caches/singletons in services:** Octane keeps the process alive (`checkOctaneCompatibility` in phpstan).
- **Registering routes in `routes/web.php`:** ledgered "hot file deliberately not touched" [VERIFIED: docs/m365/TOUCHED-CORE-FILES.md "Hot files deliberately not touched (D-15)" lists `routes/web.php`].

## Data Model (proposal)

All tables: `uuid('id')->primary()`; `organization_id` FK to `organizations` `cascadeOnDelete()->cascadeOnUpdate()`; every other FK cascades. Reason: core's `DeletionService::deleteOrganization` deletes time entries, tasks, project members, projects, clients, then members with plain query deletes, so child fork rows must disappear through DB-level cascades. [VERIFIED: app/Service/DeletionService.php:59-92 comments `// Delete all time entries`, `// Delete all projects`, `// Delete all clients`, `// Delete all members`] The M365 migrations document the same rule ("The cascade lives in the database because core deletes entries in bulk without Eloquent events", app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php). Migrations live in `app/Profitability/database/migrations/` with `2026_11_..` timestamps.

| Table | Columns (beyond id/org/timestamps) | Constraints / notes |
|-------|------------------------------------|---------------------|
| `project_contracts` | `project_id` uuid FK projects; `service` string(255) null; `schedule` string (`one_off`/`monthly`/`quarterly`/`annual`); `starts_on` date; `ends_on` date null; `amount_cents` bigint (per period, template for renewals); `budget_seconds` bigint (hours per period, template); `created_by`/`updated_by` uuid null (no Auditable trait) | `unique(project_id)` (D-01 1:1); `one_off` requires `ends_on`; contract only on projects with `is_billable = true` (validate) |
| `contract_periods` | `contract_id` FK; `starts_on`/`ends_on` date; `amount_cents` bigint; `budget_seconds` bigint | `unique(contract_id, starts_on)`; materialized lazily; period rows are the per-period override surface (D-04); started/closed periods are never rewritten by template edits (D-03) |
| `contract_period_months` | `period_id` FK; `month` date (first of month); `planned_seconds` bigint | `unique(period_id, month)`; invariant `sum(planned_seconds) = period.budget_seconds` (D-02) enforced by `PlanDistributor` + request validation |
| `member_cost_rates` | `member_id` FK members; `effective_from` date; `hourly_cost_cents` int | `unique(member_id, effective_from)`; Admin/Owner only; money never exposed elsewhere |
| `member_work_weeks` | `member_id` FK members; `effective_from` date; `weekly_seconds` int; `chargeability_target_percent` smallint (0-100) | `unique(member_id, effective_from)`; one row carries both dated values (CHRG-01/D-13) |
| `project_managers` | `project_id` FK; `member_id` FK | `unique(project_id, member_id)` (D-10) |
| `client_account_managers` | `client_id` FK clients; `member_id` FK | `unique(client_id, member_id)` (D-10) |
| `profitability_absence_projects` | `project_id` FK | `unique(project_id)`; Admin marks "Vacaciones"/"Festivo" explicitly (no name matching — names are user data) |

Notes:
- Money = integer cents (upstream convention: `@property int|null $billable_rate Billable rate per hour in cents`, app/Models/TimeEntry.php docblock). Durations = integer seconds (upstream `estimated_time`, `spent_time` are `integer` casts in app/Models/Project.php:`'estimated_time' => 'integer'`). Currency is not stored; display uses the organization currency (D-09): `Organization` has `string $currency` and the shared auth prop carries `'currency' => $currentOrganization->currency` [VERIFIED: app/Http/Middleware/ShareInertiaData.php `'currency' => $currentOrganization->currency`; resources/js/utils/money.ts `getOrganizationCurrencyString()` falls back to `'EUR'`].
- `estimated_time` (upstream, seconds, premium-gated: `if ($this->canAccessPremiumFeatures($organization) && $request->has('estimated_time'))` ProjectController.php) is **ignored** by this module and never written: contract hours live in `contract_periods.budget_seconds`. Resolves the Claude's-discretion item without risking upstream behavior.
- Absence marker is a table, not a column on `projects`, for the same reason as contracts. It is independent of contracts (absence projects have no contract).
- Periods are calendar-month aligned in `profitability.timezone` (Assumption A2): monthly = 1 month, quarterly = 3, annual = 12, periods begin on the first day of `starts_on`'s month; one-off runs `starts_on..ends_on` with calendar-month buckets clipped to the range.

### Period materialization: lazy on read beats a cron
Periods are a pure function of (schedule, starts_on, ends_on, archived_at) plus per-period overrides, so correctness does not need a scheduler:
- `PeriodMaterializer::ensureThrough(ProjectContract, CarbonImmutable $date)` creates every missing period row up to the one containing `$date` (and the next one, so "future-period terms can be changed before it starts", D-04), copying template terms, and creates even-split month rows (largest-remainder so the sum equals the budget). Idempotent via `unique(contract_id, starts_on)` + `insertOrIgnore`/`upsert`, run inside a transaction so two concurrent readers cannot duplicate.
- Called by every read endpoint that touches a contract and by `profitability:renew-periods`.
- The daily command is a safety net registered exactly like `m365:check-out-of-sync` (above). Evidence that cron may not be reliable yet: STATE.md notes "Unverified in the containers ... first real 05:30 run not yet observed" for the m365 job. [CITED: .planning/STATE.md line ~160, Phase 6 note] The production image does include a scheduler: `echo "*/1 * * * * php ${ROOT}/artisan schedule:run --no-interaction" > /etc/supercronic/laravel` [VERIFIED: docker/prod/Dockerfile:122].
- Stop rule: no new period after `ends_on`, nor after the project is archived (`projects.archived_at` set — `archived_at` is a `datetime` cast on Project). On archive the materializer simply stops; no core hook needed. Gap on un-archive: Open Question 3.

## Projection to period close (Claude's discretion: show both, cheap)

Let B = period `budget_seconds`, C = consumed seconds in the period up to now, p_m = planned seconds for month m, today T in the org tz, W(a,b) = number of weekdays (Mon-Fri) in [a,b].
- **Must still consume:** `B - C` (negative = over budget). Key output per CONTEXT specifics ("cuánto tenemos que consumir"). Also required pace = `(B - C) / W(T+1, end)`.
- **Remaining-plan projection:** `C + max(p_cur - C_cur, 0) + Σ p_future`, i.e. "if the team follows the plan from now". Past months contribute their actual consumption (already inside C).
- **Linear run-rate projection:** `C / W(start, T) * W(start, end)` (weekday-based; null until at least 5 elapsed weekdays or C = 0 to avoid noise).
- **Status:** compare each projection with B: `on_track` ≤ 100 %, `at_risk` ≤ `profitability.at_risk_threshold` (default 110 %), `over` above. Threshold is configurable (Assumption A5).
- **Money at close (scopes with money only):** `projected_cost = cost_to_date + (projected_seconds - C) / 3600 * avg_cost_rate_to_date`; `projected_margin = amount_cents - projected_cost`. Show as estimate; if `unpriced_seconds > 0` show an "incomplete cost" warning instead of a margin number.
- Per-month revenue = `amount_cents / months_in_period` straight-line, remainder cents to the last month (Assumption A4); period-level margin (amount − cost) is the primary figure.
Keep all of this in a pure `Projection` class with no DB or clock access (clock injected as a `CarbonImmutable`).

## Chargeability (CHRG-02, D-13)

`available_seconds(person, range) = Σ over weekdays d in range ∩ [first work-week row, today] of weekly_seconds(d)/5 − absence_seconds`; `chargeability = billable_seconds / available_seconds` (null when no working week effective or available ≤ 0).
- `weekly_seconds(d)` = the `member_work_weeks` row with greatest `effective_from ≤ d`. A pure `AvailableHoursCalculator` iterates days (periods ≤ 12 months, people in the dozens: trivial).
- Weekday-based daily share (weekly/5) is preferred over `weekly/7 × days` so months with 20 vs 23 working days differ; public holidays are handled by Admin-marked "Festivo" absence time until Phase 9 delivers calendars (D-06).
- `absence_seconds` = work-type entry time on projects in `profitability_absence_projects` (any billable flag). `billable_seconds` = `type = work AND billable = true` entries on non-absence projects. Internal non-billable time is simply in neither numerator nor deduction, so it lowers chargeability (intended).
- For the current period cap the range at today (otherwise a half-finished month shows a falsely low ratio); show both "to date" and "full period".
- Target comparison: `chargeability_target_percent` from the row effective at range end.
- By-person view: Owner/Admin only (Assumption A6). Never exposed to PM/AM/employees.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Local-date SQL for tz bucketing | Own `AT TIME ZONE` fragments | `TimezoneService::getLocalDateTimeSqlExpression` | Already handles offset-timezone POSIX sign inversion (TimezoneService.php:345-358) |
| Rate for a time entry | New rate logic | `BillableRateService`/`setComputedAttributeValue('billable_rate')` | Sale-rate hierarchy (project member > project > member > org) is core's job; cost is a separate dated table |
| Permission cache / role lookup | Own member query | `PermissionStore::getMember` (scoped, cached) | Octane-safe request cache |
| Time entry creation in tests/fork flows | Direct inserts | `TimeEntry::factory()` in tests; core controller path in fork flows | Keeps listener and computed attributes honest |
| Chart plumbing | New ECharts setup | Copy `ReportingChart.vue` (`use([...])` tree-shaking, `useCssVariable('--theme-color-chart')`, `provide(THEME_KEY, 'dark')`) | Theme tokens and dark mode already solved |
| Money formatting | `toFixed` | `formatCents(cents, currency, org.currency_format, org.currency_symbol, org.number_format)` | Handles org number/currency formats (used in ProjectShow.vue) |
| Largest-remainder splitting of hours over months | Naive `floor(B / n)` | One tested `PlanDistributor::evenSplit()` | Sum must equal the budget exactly (invariant) |
| Fork isolation proof | Manual review | Extend ledger + `tests/Tools/m365-merge/ledger-check.sh` + a canary like `ForkIsolationTest` | Existing gate fails on undocumented core touches |

**Key insight:** the genuinely hard parts here are not libraries but invariants — period boundaries, "sum of months = budget", dated rates, and redaction. Each gets a pure class with exhaustive unit tests.

## Runtime State Inventory

Not a rename/refactor/migration phase (greenfield module). Omitted except for the D-05 data decision:
- Existing non-billable entries on billable projects: report-only (see Pattern 2). No data migration, no rewrite.

## Common Pitfalls

### Pitfall 1: `billable_rate` stays null after forcing `billable`
**What goes wrong:** forced-billable entries have `billable = true` but `billable_rate = null`, so core cost reports show 0 and invoices lose the rate.
**Why:** core computes the rate before `save()` from the pre-force flag (BillableRateService.php:123).
**How to avoid:** call `setComputedAttributeValue('billable_rate')` in the listener. **Warning signs:** feature test "entry logged non-billable via API on a billable project with project rate 5000 has `billable = true` and `billable_rate = 5000`" fails.

### Pitfall 2: Month/period bucketing in UTC or the viewer's timezone
**What goes wrong:** an entry at 23:30 Madrid on the last day lands in next month (UTC), or two viewers see different numbers.
**How to avoid:** always bucket by start in `profitability.timezone`; entries spanning midnight/month end belong to the start's month (Goals precedent, GoalProgressService.php:73). Test with entries at 22:30 UTC on a month end (Madrid already next month) and the DST change days (last Sundays of March/October).

### Pitfall 3: Missing cost rate silently valued at 0
**What goes wrong:** margin looks great for members without a cost row.
**How to avoid:** the lateral join yields NULL; track `unpriced_seconds` and show "incomplete cost: N h without a cost rate" instead of a margin. Placeholders (ex-staff) still need a rate to be priced.

### Pitfall 4: Leaking money through a side channel
**What goes wrong:** PM/employee receives `amount_cents`, cost or margin in a JSON key, Inertia prop, export or error message.
**How to avoid:** `AccessScope` decides before serialization; money keys absent; the shared prop only carries flags/URLs/labels; no money in Ziggy/props; recursive forbidden-key test (below). Also: do not add these routes to `/api/v1` (Passport tokens reach there) and never to `openapi.json`.

### Pitfall 5: Relying on cron for renewal
**What goes wrong:** the scheduler is down/unverified, a new period never appears, the page shows an expired period.
**How to avoid:** lazy materialization on read + cron as safety net; unique constraint makes concurrent materialization safe.

### Pitfall 6: IDOR across organizations
**What goes wrong:** `{project}`, `{client}`, `{member}` ids from another organization.
**How to avoid:** validate every id belongs to `{organization}` and the caller's scope covers it; answer 404 (not 403) for foreign/unknown ids, as the m365 routes do ("a foreign or unknown id is a plain 404 (never a 403 oracle)", app/Microsoft365/routes/microsoft365.php). Routes use `->whereUuid(...)`.

### Pitfall 7: Plan invariant drift when the budget changes
**What goes wrong:** AM changes `budget_seconds` after the PM distributed months; sum no longer equals budget.
**How to avoid:** on a budget change, rescale plan rows proportionally with largest remainder (or reset to even split) inside the same transaction; reject month edits whose sum ≠ budget with a 422 that includes the delta.

### Pitfall 8: Archive/un-archive and ended contracts
Archived project: no new periods. Un-archive gap: Open Question 3.

### Pitfall 9: Impersonation / shared-prop cost
The shared prop closure is evaluated per page render; Owner/Admin resolve from the cached member (no query), others cost two cheap `exists()` queries. Admin impersonation shows what the impersonated user would see (access is computed from the authenticated user); no write endpoint should treat an impersonating admin as admin.

### Pitfall 10: Locale
`config('app.locale')` is `'en'` and Spanish is "prepared for a later locale switch" [VERIFIED: config/app.php:133 `'locale' => 'en',`; lang/es/microsoft365.php header `// Spanish copy, prepared for a later locale switch. The app locale stays 'en' (D-18).`]. D-14 asks for Spanish and English: ship both files with identical keys and a `ProfitabilityLangTest` (copy of `MicrosoftLangTest`: same nested keys, no empty values, same placeholders); the visible UI will be English ("Profitability") until the locale switch exists. See Open Question 1.

## Code Examples

### Fork Inertia share (flags and URLs only)
```php
// Source: pattern of app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
Inertia::share('profitability', function () use ($request): array {
    $user = $request->user();
    $org = $user?->currentOrganization;
    if ($user === null || $org === null) {
        return ['enabled' => false];
    }
    $scope = $this->access->forUser($org, $user);

    return [
        'enabled' => $scope->hasAnyAccess(),
        'url' => url('profitability'),                 // nav href without Ziggy
        'views' => $scope->views(),                    // ['projects','clients','people'] subset
        'labels' => ['nav' => __('profitability.nav')],
    ];
});
```

### Authorization matrix test skeleton (PHPUnit, CI only)
```php
// Source: Tests\TestCaseWithDatabase::createUserWithRole (read this session)
public function test_money_keys_never_reach_non_money_scopes(): void
{
    $ctx = $this->createUserWithRole(Role::Employee);           // employee who is also project manager
    $project = $this->billableProjectWithContract($ctx->organization);
    ProjectManager::factory()->create(['project_id' => $project->id, 'member_id' => $ctx->member->id]);
    $this->actingAs($ctx->user);

    $json = $this->getJson($this->summaryUrl($ctx->organization, $project))->assertOk()->json();

    $this->assertNoKeyMatches($json, '/amount|cost|margin|revenue|sold/i');
    $this->assertArrayHasKey('hours', $json);                    // hours still present
}
```

### Pure projection (no DB, no clock)
```php
// Source: design; formulas in "Projection to period close"
public static function remainingPlan(int $consumed, int $plannedCurrentMonth, int $consumedCurrentMonth, int $plannedFuture): int
{
    return $consumed + max($plannedCurrentMonth - $consumedCurrentMonth, 0) + $plannedFuture;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Contract entity separate from project | Terms on the project (D-01), physically a 1:1 fork table | Owner decision 2026-11-27 | No contract CRUD; the project page is the entry point |
| Global PM/AM roles | Assignment tables (D-10) | Owner decision 2026-11-27 | PermissionStore unchanged; merge-safe |
| Cron-driven renewal | Lazy materialization + cron safety net | This research | Works even if the scheduler is down |

**Deprecated/outdated:** none relevant. Upstream Goals (`GoalPeriod` day/week/month) is a pattern source only; it cannot express quarterly/annual or contracts.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Contract may be set only on projects with `is_billable = true`; client-less projects land in a "No client" bucket in the by-client view | Data Model | Owner may want contracts on non-billable projects (would make D-05 enforcement not apply) |
| A2 | Periods are calendar-month aligned (period starts on the 1st of `starts_on`'s month; one-off clipped to its dates), timezone `Europe/Madrid` from `config/profitability.php` | Data Model, Pattern 3 | If contracts run on anniversary dates (e.g. 15th to 14th) the plan months and consumption would not match the owner's mental model |
| A3 | Core `Manager` role has no automatic profitability access; only Owner/Admin or assignments | Pattern 5 | Owner may expect core managers to see hour balances |
| A4 | Revenue per month is straight-line (`amount / months in period`); period-level margin is primary | Projection | Front-loaded plans make monthly margins look uneven; owner may prefer revenue pro rata to planned hours |
| A5 | Projection thresholds: on track ≤ 100 %, at risk ≤ 110 %, over > 110 % of hours sold; run-rate needs ≥ 5 elapsed weekdays | Projection | Cosmetic; configurable in `config/profitability.php` |
| A6 | Per-person chargeability view is Owner/Admin only; PM/AM/employees cannot see other people's chargeability | Chargeability | Owner may want AMs/PMs to see team chargeability |
| A7 | Only Owner/Admin assign project managers and account managers and mark absence projects (D-12 does not say who) | Data Model | If AMs should assign PMs, add an AM-scoped write rule |
| A8 | Placeholders cannot be PM/AM; they can have cost rates | Pattern 5 | Minor |
| A9 | Available hours use weekday share (weekly/5 per Mon-Fri) | Chargeability | If the team works non-standard weeks, available hours are off until Phase 9 calendars |
| A10 | Running entries count with elapsed time up to now | Pattern 4 | Consumption fluctuates while a timer runs (same as Goals) |
| A11 | UI renders English labels ("Profitability") because the app locale stays `en`; Spanish ("Rentabilidad") is prepared | Pitfall 10 | Owner explicitly named the page "Rentabilidad" and may expect Spanish visible now |

## Open Questions

1. **Visible label: "Rentabilidad" or "Profitability"?**
   - Known: locale is hard-coded `'en'`; fork pattern ships both languages (lang test) but shows English.
   - Unclear: whether the owner wants "Rentabilidad" visible now.
   - Recommendation: follow the pattern (en + es files, English shown); confirm with the owner as a functional question during planning, because switching the nav/page title only needs a label change.
2. **Period alignment (A2):** confirm contracts start on month boundaries. Recommendation: calendar-month alignment; allow any `starts_on` but periods begin at the 1st of its month.
3. **Un-archive after a pause:** lazy materialization could create periods for the archived window on un-archive, showing revenue with zero consumption. Recommendation: materialize only while the project is not archived and cap catch-up to periods starting after the un-archive date (store nothing extra; compare `projects.archived_at` null and skip periods older than `updated_at` of the archive flip is not available, so simplest rule: on un-archive the AM sets a new start/end). Planner to pick; low risk.
4. **Who edits a closed or in-progress period's terms?** Recommendation: AM/Admin may edit the current and future periods; closed periods read-only (D-03). A "this and following" vs "this only" choice on edit.
5. **Core Manager role access (A3)** and **per-person visibility (A6)** — functional confirmations.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PHP | pure-calculator tests, Pint, PHPStan | ✓ | 8.3.36 (`C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe`) | — |
| Node | Vitest, ESLint, vue-tsc | ✓ | v24.13.1 (npm 11.8.0) | — |
| PHPUnit/Pint/PHPStan binaries | tests, style, static analysis | ✓ | in `vendor/bin` | — |
| PostgreSQL | feature tests, SQL (lateral join) | ✗ locally | — | Feature tests run in CI only (per project memory); keep SQL in one class and cover logic with DB-free unit tests locally |
| Docker / Playwright browsers | e2e | not probed | — | e2e runs in CI |
| Scheduler (`schedule:run`) in production | renewal safety net | ✓ configured in image (Dockerfile:122) | — | Lazy materialization makes it non-critical |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local PostgreSQL → CI.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (+ paratest), Vitest 4.1 (happy-dom), Playwright 1.60 [VERIFIED: .claude/CLAUDE.md] |
| Config file | `phpunit.xml`, `vitest.config.ts` (`include: ['resources/js/**/*.{test,spec}.{ts,tsx}']`), `playwright.config.ts` (`testDir: './e2e'`) |
| Quick run command | `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe vendor/bin/phpunit tests/Unit/Profitability` and `npx vitest run resources/js/profitability` |
| Full suite command | `composer test` (CI: DB) ; `npm run test:unit` ; `npm run test:e2e` (CI) ; `composer analyse` ; `composer fix` |

DB-free unit tests extend `Tests\TestCase` (like `MicrosoftLangTest`, `ForkIsolationTest`) so they run locally; DB feature tests extend `Tests\TestCaseWithDatabase` and run in CI only.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUDG-01 | AM/Owner/Admin store contract terms; employee/PM/foreign AM get 403/404; one-off requires end date; non-billable project rejected | feature | `phpunit tests/Feature/Profitability/ContractTermsTest.php` | ❌ Wave 0 |
| BUDG-01 | Schedule enum + validation rules | unit | `phpunit tests/Unit/Profitability/ContractScheduleTest.php` | ❌ Wave 0 |
| BUDG-02 | `PeriodCalendar` monthly/quarterly/annual/one-off boundaries, end date, leap years, 31st-day starts | unit | `phpunit tests/Unit/Profitability/PeriodCalendarTest.php` | ❌ Wave 0 |
| BUDG-02 | Lazy materialization idempotent + concurrent-safe; stops at end date/archive; future-period edit; closed period untouched; command output | feature | `phpunit tests/Feature/Profitability/PeriodMaterializerTest.php` | ❌ Wave 0 |
| BUDG-03 | Entries land in the right period/month incl. month-end tz edge, DST days, running entry | feature | `phpunit tests/Feature/Profitability/ConsumptionTest.php` | ❌ Wave 0 |
| BUDG-03 | Non-billable entry on billable project forced billable via API store, update, updateMultiple, import, Outlook conversion; `billable_rate` recomputed; break entries untouched; non-billable project untouched | feature | `phpunit tests/Feature/Profitability/EnforceBillableTest.php` | ❌ Wave 0 |
| BUDG-03 | Legacy non-billable rows reported, not rewritten | feature | `phpunit tests/Feature/Profitability/ReportNonBillableCommandTest.php` | ❌ Wave 0 |
| BUDG-04 | `PlanDistributor` even split sums exactly; rebalance validation (sum = budget) | unit | `phpunit tests/Unit/Profitability/PlanDistributorTest.php` | ❌ Wave 0 |
| BUDG-04 | `Projection` remaining-plan + run-rate, over/at-risk, zero-consumption, before-start, after-close | unit | `phpunit tests/Unit/Profitability/ProjectionTest.php` | ❌ Wave 0 |
| BUDG-04 | PM edits plan of own project only; AM cannot edit plan unless also PM/Admin | feature | `phpunit tests/Feature/Profitability/PlanEditingTest.php` | ❌ Wave 0 |
| BUDG-05 | Dated cost: entries before/after effective date, retroactive new rate, no rate = unpriced; margin math | feature | `phpunit tests/Feature/Profitability/DatedCostTest.php` | ❌ Wave 0 |
| BUDG-06 | Money visible to AM for own clients only, Owner/Admin all, never PM/employee/manager-without-assignment/placeholder; recursive forbidden-key scan; cross-org 404 | feature | `phpunit tests/Feature/Profitability/AuthorizationMatrixTest.php` | ❌ Wave 0 |
| BUDG-06 | Inertia shared prop carries no money for any role | feature | `phpunit tests/Feature/Profitability/SharedPropTest.php` | ❌ Wave 0 |
| BUDG-07 | Assignment CRUD (Owner/Admin), uniqueness, placeholder rejected, cascade on member/project/client delete; core `PermissionStore::roleDefinitions()` unchanged | feature | `phpunit tests/Feature/Profitability/AssignmentsTest.php` | ❌ Wave 0 |
| CHRG-01 | Work-week/target dated rows Admin/Owner only | feature | `phpunit tests/Feature/Profitability/WorkWeekTest.php` | ❌ Wave 0 |
| CHRG-02 | `AvailableHoursCalculator` (weekdays, dated changes, mid-period change, cap at today); absence reduces available; internal non-billable not deducted | unit | `phpunit tests/Unit/Profitability/AvailableHoursCalculatorTest.php` | ❌ Wave 0 |
| CHRG-02 | Chargeability end-to-end with Vacaciones/Festivo marker | feature | `phpunit tests/Feature/Profitability/ChargeabilityTest.php` | ❌ Wave 0 |
| CHRG-03 | Page renders per role (Owner sees 3 views; AM sees clients/projects; PM sees projects without money; employee: no nav item, 404 on endpoints) | feature | `phpunit tests/Feature/Profitability/PageAccessTest.php` | ❌ Wave 0 |
| CHRG-03 | Vue: view components, money hidden when absent, plan grid sum indicator, projection bar | unit (Vitest) | `npx vitest run resources/js/profitability` | ❌ Wave 0 |
| CHRG-03 | Browser: admin sets terms, PM distributes months, AM sees margin, employee sees nothing | e2e | `npx playwright test e2e/profitability-*.spec.ts` | ❌ Wave 0 |
| Isolation | Ledger lists every touched core file; no `App\Profitability` reference outside the module except the provider line; lang en/es parity | unit | `phpunit tests/Unit/Profitability/ForkIsolationTest.php tests/Unit/Profitability/ProfitabilityLangTest.php` and `sh tests/Tools/m365-merge/ledger-check.sh` (local, needs `upstream` remote) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `phpunit tests/Unit/Profitability` and `npx vitest run resources/js/profitability`
- **Per wave merge:** full PHPUnit (CI) + `composer analyse` + `composer fix` (check) + `npm run lint` + `npm run type-check` + `npm run test:unit`
- **Phase gate:** full suite green + Playwright profitability specs green + ledger check OK before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/Unit/Profitability/*` (calculators, lang, isolation) — DB-free, locally runnable
- [ ] `tests/Feature/Profitability/*` + helper trait building contract/period/entry fixtures and a recursive `assertNoKeyMatches`
- [ ] Model factories for fork models (`database/factories` is core; place fork factories in `app/Profitability/database/factories` or use `::query()->create()` as the m365 tests do — the m365 tests create rows via `OutlookMeeting::query()->create([...])`, tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php)
- [ ] `resources/js/profitability/*.test.ts`
- [ ] `e2e/profitability-*.spec.ts` (+ fixtures via `admin` and `employee` from `playwright/fixtures.ts`)
- No framework installs needed.

## Security Domain

`security_enforcement` is enabled (absent/true), ASVS level 1 (`.planning/config.json`: `"security_enforcement": true, "security_asvs_level": 1, "security_block_on": "high"`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (reuses `auth:web`, `auth.session`, `verified`) | Same middleware stack as core authenticated group |
| V3 Session Management | yes (web guard + CSRF on writes) | `web` group (XSRF), axios global instance |
| V4 Access Control | **yes — primary risk** | `AccessScope` single gate; org-bound ids; 404 for foreign ids; money keys absent; feature matrix tests |
| V5 Input Validation | yes | Form Requests in `app/Profitability/Http/Requests`: dates (`date_format:Y-m-d`), `Rule::enum`, integer bounds (`amount_cents` ≥ 0, `hourly_cost_cents` ≥ 0, `weekly_seconds` ≤ 168 h, target 0-100), `Rule::exists` scoped to the org, `whereUuid` on routes |
| V6 Cryptography | no (no secrets; money is not encrypted at rest, consistent with core) | — |
| V7/V8 Data protection | yes (hourly cost is sensitive HR data) | Never in Inertia props, never in `/api/v1`/OpenAPI, no `Auditable` trait on cost tables, no logging of cost values |
| V13 API | yes | Web-guard JSON, throttle middleware (`throttle:60,1,profitability-read:`) like m365 routes |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR across organizations/projects/clients/members | Information disclosure / Tampering | Validate every route/body id belongs to `{organization}` and to the caller's scope; 404 not 403 |
| Money/cost leaked to PM/employee via JSON, Inertia prop, export, error text | Information disclosure | Omit keys by scope; shared prop flags only; recursive forbidden-key tests; no CSV export in this phase |
| Privilege escalation via assignment endpoints (PM assigns self) | Elevation of privilege | Assignment/absence/cost/work-week writes Owner/Admin only (A7) |
| Mass assignment of `organization_id`, `project_id` | Tampering | Explicit `$fillable`/validated arrays; org id from route, never body |
| Forced-billable bypass via bulk SQL | Tampering | Document limitation; `ReportNonBillableCommand` detects drift |
| CSRF on write routes | Tampering | `web` group + XSRF; no GET writes |
| Impersonating admin editing costs | Repudiation | Access computed from the authenticated (impersonated) user; Filament impersonation shows that user's view |
| Enumeration via timing/verbose errors | Information disclosure | Uniform 404; generic validation messages |

## Sources

### Primary (HIGH confidence) — files read this session
- `.planning/phases/08-project-hour-budgets-profitability/08-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 8 block), `.planning/STATE.md`, `.planning/config.json`, `.claude/CLAUDE.md`
- `app/Models/{Project,Member,TimeEntry,Goal,Organization,Client}.php`; `app/Enums/{Role,GoalPeriod}.php`
- `app/Service/{PermissionStore,GoalProgressService,BillableRateService,BillingContract,TimeEntryAggregationService,TimezoneService,DeletionService}.php`
- `app/Http/Controllers/Api/V1/{TimeEntryController,ProjectController,Controller}.php`; `app/Http/Middleware/ShareInertiaData.php`
- `app/Microsoft365/{Microsoft365ServiceProvider,TimeEntries/CoreTimeEntryCreator,TimeEntries/CoreTimeEntryUpdater,Http/Middleware/ShareMicrosoftInertiaData,Http/Middleware/EnsureNotImpersonating,routes/microsoft365.php,database/migrations/...create_outlook_meeting_links_table}.php`; `app/Appearance/AppearanceServiceProvider.php`
- `docs/m365/TOUCHED-CORE-FILES.md`, `tests/Tools/m365-merge/ledger-check.sh`, `tests/Unit/Microsoft365/{ForkIsolationTest,MicrosoftLangTest}.php`, `tests/TestCaseWithDatabase.php`, `tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php`
- `routes/web.php`, `resources/js/{app.ts,Layouts/AppLayout.vue,Pages/ProjectShow.vue,utils/money.ts,utils/permissions.ts,m365/calendar/meetingsApi.ts,Components/Common/Reporting/ReportingChart.vue}`, `vitest.config.ts`, `playwright.config.ts`, `playwright/fixtures.ts`, `config/app.php`, `docker/prod/Dockerfile`, `database/migrations/2026_08_24_000001_add_application_query_indexes.php`

### Secondary (MEDIUM confidence)
- none (no web research needed: all findings are in-repo facts or design decisions)

### Tertiary (LOW confidence)
- Domain formulas (revenue straight-line, thresholds, weekday available hours) are design recommendations, logged as assumptions A4/A5/A9.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every capability already in repo
- Architecture / core seams: HIGH — module shape, listener path, scheduler, ledger gate all verified in source
- Data model and projection math: MEDIUM — decisions consistent with CONTEXT but A2/A4 need owner confirmation
- Pitfalls: HIGH for code-derived ones (billable_rate ordering, cascade deletes, tz bucketing), MEDIUM for lifecycle edge cases

**Core seam checklist for the ledger (`docs/m365/TOUCHED-CORE-FILES.md`, new "Phase 8" section):**
- Edited core files: `config/app.php` (one `use` + one providers entry for `ProfitabilityServiceProvider`), `resources/js/Layouts/AppLayout.vue` (import + one `NavigationSidebarItem` gated by the shared `profitability` prop, placed after Goals in the first `<ul>`), `resources/js/Pages/ProjectShow.vue` (import + `<ProjectProfitabilitySummary />` in the grid)
- New files inside core directories: `resources/js/Pages/Profitability.vue`, `config/profitability.php`, `lang/en/profitability.php`, `lang/es/profitability.php`, `e2e/profitability-*.spec.ts`
- Fork-owned paths: `app/Profitability/`, `resources/js/profitability/`, `tests/Feature/Profitability/`, `tests/Unit/Profitability/`
- Not touched (deliberately): `routes/web.php`, `PermissionStore`, `Project`/`TimeEntry`/`Member` models, `openapi.json`, `app/Console/Kernel.php`, any core controller
- `ForkIsolationTest::test_every_path_in_the_touched_core_files_ledger_exists` requires every backticked repo path in the ledger to exist and at least 100 ledger paths [VERIFIED: tests/Unit/Microsoft365/ForkIsolationTest.php `assertGreaterThanOrEqual(100, count($paths), ...)`], so add ledger rows only for files that exist when the ledger is committed.

**Research date:** 2026-11-27
**Valid until:** 2026-12-27 (stable internal conventions; re-check if upstream is merged and touches `TimeEntryController` or `AppLayout.vue`)
