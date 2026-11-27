---
phase: 08-project-hour-budgets-profitability
plan: 10
subsystem: profitability-server
tags: [profitability, money, dated-cost, projection, projects-view, access-scope, d-05-notice]
requires:
  - "08-01: ConsumptionQuery (timezone(), secondsByMonth, totalSeconds), ProjectSummaryController, summary route"
  - "08-03: AccessScope with assignments (hasMoneyFor, canEditTerms, canEditPlan, managedProjectIds, accountClientIds, isFull)"
  - "08-04/08-08: PeriodMaterializer::ensureThrough, PeriodCalendar, ContractPeriod::stateOn, summary periods[] and ?period="
  - "08-05: member_cost_rates (MemberCostRate)"
  - "08-07: LegacyNonBillableQuery::secondsFor"
provides:
  - "ConsumptionQuery::periodTotals(org, project, from, to, now, withCost): {seconds, billable_seconds, cost_cents, priced_seconds, unpriced_seconds}; one statement, LEFT JOIN LATERAL on member_cost_rates only when withCost (cost columns null otherwise)"
  - "Projection::forPeriod(budget, months, start, end, today, threshold, minWeekdays, ?cost, ?priced): ProjectionResult (pure; STATUS_ON_TRACK|AT_RISK|OVER|NOT_STARTED|CLOSED)"
  - "ProjectBalanceService: periodBalance(), projectRow(), defaultPeriod() (shared by the summary and the Projects view)"
  - "Summary period block: + still_to_consume_seconds, remaining_plan_seconds, run_rate_seconds, status; money scopes only: amount_cents, revenue_to_date_cents, cost_cents, margin_cents, projected_cost_cents, projected_margin_cents, unpriced_cost_seconds"
  - "GET profitability/organizations/{organization}/views/projects?contract=active|without|ended|all (profitability.views.projects): { data: [rows], meta: { total_rows, money_rows, nonbillable_legacy_seconds (Owner/Admin only) } }"
affects: [08-12, 08-13, 08-14, 08-16, 08-19]
requirements-completed: [BUDG-03, BUDG-04, BUDG-05, BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Money hidden by absence: the money part is merged into the array only when hasMoneyFor(); the cost join is not even built otherwise"
    - "Status from the remaining-plan projection; the weekday run rate is information only (front-loaded plans, D-02)"
key-files:
  created:
    - app/Profitability/Reporting/ProjectBalanceService.php
    - app/Profitability/Reporting/Projection.php
    - app/Profitability/Reporting/ProjectionResult.php
    - app/Profitability/Http/Controllers/ProjectsViewController.php
    - app/Profitability/routes/views.php
    - tests/Unit/Profitability/ProjectionTest.php
    - tests/Feature/Profitability/DatedCostTest.php
    - tests/Feature/Profitability/ConsumptionTest.php
    - tests/Feature/Profitability/ProjectsViewTest.php
  modified:
    - app/Profitability/Reporting/ConsumptionQuery.php
    - app/Profitability/Http/Controllers/ProjectSummaryController.php
    - tests/Feature/Profitability/ProjectSummaryTest.php
decisions:
  - "Revenue to date (D-19): each month but the last earns floor(amount / months), the last the remainder (RESEARCH A4); months started up to and including today's month; whole amount once closed, 0 before start"
  - "Remaining plan uses max(planned - consumed, 0) for the current and every later month (not only the current one), so time logged ahead in a future month is never counted twice"
  - "The at-risk limit is round(budget x threshold) in whole seconds, so exactly 110 % is at_risk without float noise; a 0 h budget with any projected time is over"
  - "projected_cost_cents / projected_margin_cents are null (unknown) while no consumed second has a cost; they are present for money scopes, absent otherwise"
  - "A Projects row shows the same period as the summary default (current, else latest started, else first upcoming), with period.state, so Ended rows show their last closed period; KPI totals over 'current periods only' filter on period.state client-side"
  - "Money keys on a Projects row only when the caller has money for the project AND a period exists; meta.money_rows counts rows carrying amount_cents"
  - "Filters: active = not archived with a current period; without = billable, not archived, no contract, canEditTerms; ended = contract and (archived, or end date passed with no current/upcoming period); all = every project in scope (billable or under contract)"
  - "nonbillable_legacy_seconds is organization-wide (secondsFor(org, null, now)): the notice is a data-quality signal for Owner/Admin, not per filter"
metrics:
  duration: "about 50 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 130000
  tasks: 3
actuals:
  tokens: 24000
  tasks: 3
  commits: 5
plan_head_before: 80b2670eb39ae40d3b16e9f53314443a48cc6bd7
plan_head_after: 750487d217758af157652dd38693cc06765bf6a6
---

# Phase 8 Plan 10: Money, projection and the Projects view Summary

The period balance now carries money computed live from each person's dated hourly cost (one LEFT JOIN LATERAL, rounded once, unpriced hours tracked, never valued at 0), straight-line revenue, margin to date and projected, all merged only for Owner, Admin and account managers of the client. Every scope gets the projection to the period close: hours still to consume, the remaining-plan projection that decides the status, and a weekday run rate as information. A new Projects view endpoint lists the projects in the caller's scope with those figures, the contract filter and, for Owner/Admin, the legacy non-billable notice.

## What was built

- **`ConsumptionQuery::periodTotals()`** builds one statement over the project's work entries in the local date range. It returns seconds and billable seconds. With `$withCost` it also returns `cost_cents`, `priced_seconds` and `unpriced_seconds`:
  - The cost comes from a `leftJoinLateral` subquery on `member_cost_rates`: same member and organization, `effective_from <=` the entry's local start date (`TimezoneService` expression, Europe/Madrid), newest first, `limit 1`.
  - The cost is `sum(duration x hourly_cost_cents / 3600.0)`, rounded once.
  - Without `$withCost` neither the join nor the cost columns are built.
  - The SQL and bindings were checked offline with a `beforeExecuting` hook. Bindings come in this order: five select `now` values, the timezone, then org, project, `work` and the two UTC bounds.
- **`Projection`** (final, pure; its docblock lists the D-02 formulas) and **`ProjectionResult`** (final readonly). They cover still to consume, the remaining plan, the run rate (null under 5 elapsed weekdays or with nothing consumed), the status (`on_track`, `at_risk`, `over`, `not_started` or `closed`) and the projected cost (`cost + (remaining - consumed) x cost / priced`, null when nothing is priced).
- **`ProjectBalanceService`**:
  - `periodBalance()` returns the hours part, the projection fields and the months for every scope. For a money scope it adds `amount_cents`, `revenue_to_date_cents`, `cost_cents`, `margin_cents`, `projected_cost_cents`, `projected_margin_cents` and `unpriced_cost_seconds`. The thresholds come from `config('profitability.*')`.
  - `projectRow()` builds one Projects-view row without the months.
  - `defaultPeriod()` was moved here from the summary controller.
- **`ProjectSummaryController::show`** gets its period block from the service and otherwise answers the same response.
- **`ProjectsViewController::index`**:
  - It returns a 404 unless `hasAnyAccess()`.
  - The projects in scope are those that are billable or under contract. Full scope sees all of them. Other scopes see the managed projects plus the projects of their account clients (the union), re-checked with `canViewProject`.
  - Contracts are materialized, all periods are loaded in one query, the `?contract=` filter is applied (an unknown value means `active`), and rows are sorted by name.
  - Meta: `total_rows`, `money_rows`, and `nonbillable_legacy_seconds` for full scope only.
- **Route** `app/Profitability/routes/views.php` serves `GET /profitability/organizations/{organization}/views/projects`. It uses the web, `auth:web`, `auth.session` and `verified` middleware, `whereUuid`, `throttle:120,1,profitability-read:` and the name `profitability.views.projects`. No `{member}` parameter.
- **Tests:**
  - `ProjectionTest` (13 methods, 17 cases).
  - `DatedCostTest` (7). Beyond the plan's six, it adds a test that the rate is picked by the entry's local date.
  - `ConsumptionTest` (5). It covers the Madrid month boundary, spring DST, the autumn DST day, running entries, breaks and other projects, and placeholders.
  - `ProjectsViewTest` (6).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | b18b0d3d | feat(08-10): dated cost and margin in the project summary for money scopes |
| 2 (RED) | c322b176 | test(08-10): projection to period close (RED) |
| 2 | abf88af9 | feat(08-10): projection to period close with status |
| 1 follow-up | 5be11540 | test(08-10): summary tests follow the money part for Owner |
| 3 | 750487d2 | feat(08-10): projects view with scope-filtered rows and money |

## Gates

- **Gate P:** `php -l` passed on every new or changed file. Pint `--test` passed on `app/Profitability`, `tests/Feature/Profitability` and `tests/Unit/Profitability`. Full-app PHPStan (worktree-first `--autoload-file`) gave `[OK] No errors` after each task. The first run hit the known transient parallel-worker crash; the rerun was clean. The new test files were also checked at level 7 with a scratch config: only the usual `missingType.generics` on `TestResponse` helpers, the same pattern as earlier plans.
- **Gate U:** `phpunit tests/Unit/Profitability/ProjectionTest.php` gave `OK`. The whole `tests/Unit/Profitability` suite gave `OK (114 tests, 48062 assertions)`.
  - RED: 13 errors, class not found.
  - GREEN: one test expectation was corrected. With nothing consumed by 18 November, October's unconsumed plan is past, so the remaining plan is 60 h, not 120 h.
- **Route check** (worktree artisan loader, `--json` plus the node filter) prints exactly `GET|HEAD profitability/organizations/{organization}/views/projects`.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `left join lateral` in ConsumptionQuery (case-insensitive) | 1 |
  | `hasMoneyFor(` in ProjectBalanceService | 2 |
  | money key `=> null` literal | 0 |
  | `unpriced_cost_seconds` in ProjectBalanceService | at least 1 |
  | `final class Projection` | 1 |
  | `DB::\|now()` in Projection | 0 |
  | `function test_` in DatedCostTest / ConsumptionTest / ProjectsViewTest | 7 / 5 / 6 |
  | `nonbillable_legacy_seconds` in ProjectsViewController | 1 |

- **Feature PHPUnit, PENDING CI (orchestrator):** `DatedCostTest`, `ConsumptionTest`, `ProjectsViewTest` and the adjusted `ProjectSummaryTest`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ProjectSummaryTest asserted that Owner gets no money key**
- **Found during:** Task 1 (shape-change sweep of affected tests)
- **Issue:** 08-01 wrote `test_response_has_no_money_key` for an Owner before money existed. Under D-11 the Owner now gets the money part, so CI (which is fail-fast) would have failed.
- **Fix:** The test is renamed `test_money_appears_only_inside_the_owner_period_block`. It asserts `amount_cents` in the period, and no money key in the contract terms, the `periods[]` list or the months. Project managers keep their full recursive no-money scans (ScopedSummaryAccessTest, DatedCostTest, ProjectsViewTest).
- **Files modified:** `tests/Feature/Profitability/ProjectSummaryTest.php`. It is outside files_modified, but the peer 08-09 does not touch it.
- **Commit:** 5be11540

**2. [Interpretation] Rows and periods in the Projects view**
- The plan says "current period summary or null". The row instead shows the summary's default period (current, else latest started, else first upcoming) with its `state`. This lets the Ended and All filters show a closed or upcoming period, as the UI-SPEC Period column badges expect. Rows without contract terms have `period: null`, zero hours and a null status.
- Active excludes archived projects, and Ended includes archived projects under contract, so the two filters never overlap. Without excludes archived projects.

**3. [Interpretation] Money on rows without a period**
- Rows without a period never carry money keys, even for money scopes, because there is no amount or cost to show. `money_rows` counts the rows that do carry money.

**4. TDD commit split**
- Task 2 is committed as RED (`test`) and then GREEN (`feat`) instead of one commit.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-29: the cost join and the money keys are both gated by `hasMoneyFor`, and recursive scans (meta included) cover the summary and the view.
- T-08-30: only project-level aggregates are returned.
- T-08-31: `unpriced_cost_seconds` is returned.
- T-08-32: read throttle, one balance per row.

## Open items

- Feature PHPUnit (`DatedCostTest` 7, `ConsumptionTest` 5, `ProjectsViewTest` 6, `ProjectSummaryTest` 12 with one test rewritten) and the wave CI gate: PENDING CI (orchestrator).
- Frontend (08-12/08-13/08-16): the Projects KPI strip should sum only rows whose `period.state` is `current`. The margin tiles should show "Incomplete" when `unpriced_cost_seconds > 0`. When `projected_cost_cents` is null, show `--`.

## Self-Check: PASSED

- FOUND: all 9 created files and 3 modified files
- FOUND: b18b0d3d, c322b176, abf88af9, 5be11540, 750487d2 (ancestors of HEAD)
