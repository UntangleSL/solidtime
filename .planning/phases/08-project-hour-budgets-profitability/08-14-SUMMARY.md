---
phase: 08-project-hour-budgets-profitability
plan: 14
subsystem: profitability-server
tags: [profitability, clients-view, money, dated-cost, straight-line-revenue, report-range, account-manager]
requires:
  - "08-01/08-03: ProfitabilityAccess::forUser, AccessScope (isFull, accountClientIds, views, hasMoneyFor)"
  - "08-04/08-08: PeriodMaterializer::ensureThrough, PeriodCalendar::months, ContractPeriodMonth plan rows"
  - "08-10: ConsumptionQuery::periodTotals (dated-cost lateral join), ProjectBalanceService::defaultPeriod/periodBalance (status), routes/views.php"
  - "08-11: ReportRange::fromKey / months() / cappedTo / toArray()"
provides:
  - "ConsumptionQuery::byProjectMonth(orgId, list projectIds, from, to, now): project_id => Y-m-01 => {seconds, cost_cents, unpriced_seconds}; one statement, same LEFT JOIN LATERAL as periodTotals (extracted to private joinDatedRate)"
  - "ClientRollupService::contractsInScope(Organization, AccessScope) and forRange(Organization, AccessScope, ReportRange, now): {clients: [...], totals: {...}}"
  - "GET profitability/organizations/{organization}/views/clients?range= (profitability.views.clients): { data: [clients with projects[]], meta: { range, totals } }"
affects: [08-17, 08-19]
requirements-completed: [BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Range money: straight-line share per period month (floor(amount / months), remainder on the period's last month), summed over the period months inside the range"
    - "Range hours sold: plan rows (contract_period_months) of the overlapping periods for the range months"
key-files:
  created:
    - app/Profitability/Reporting/ClientRollupService.php
    - app/Profitability/Http/Controllers/ClientsViewController.php
    - tests/Feature/Profitability/ClientsViewTest.php
  modified:
    - app/Profitability/Reporting/ConsumptionQuery.php
    - app/Profitability/routes/views.php
decisions:
  - "Contracts in scope are materialized through max(today, range end), so every month of a range still running (This quarter) has its period and plan; the extra periods are upcoming ones, which terms changes already rewrite"
  - "A project is listed when one of its periods overlaps the range or it has time in the range (time logged before the contract start still counts against the client, with amount 0); a client is listed when it has a listed project"
  - "Project status is the status of the period the Projects view shows (ProjectBalanceService::defaultPeriod + periodBalance), so both views agree; client status is the worst by severity over > at_risk > on_track > not_started > closed"
  - "margin_percent is margin / amount x 100, an unrounded float, null when the amount is 0; meta.totals also carries unpriced_cost_seconds for the Incomplete marker"
  - "Clients are sorted by name (natural, case-insensitive, id as tie-break) with the No client bucket (client_id null, name null) last; projects by name; the UI applies its margin sort client-side"
  - "Cost is rounded once per project and month in SQL (never per entry); project and client figures sum those values"
metrics:
  duration: "about 35 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 60000
  tasks: 2
actuals:
  tokens: 13500
  tasks: 2
  commits: 2
plan_head_before: 2f87eda4ac676091da6355e30d561c7416e35000
plan_head_after: 30c3575d6bede1d593e6ab011b0f23bd6ec805c9
---

# Phase 8 Plan 14: Clients view (account manager portfolio) Summary

Owner, Admin and account managers can now read the Clients view over a fork web-guard JSON route. For any standard range it lists each client's contract projects in scope. Each project carries the hours sold (the planned hours of the range months), the hours consumed up to today, the straight-line amount share, the cost at each person's dated hourly cost, the margin, the margin % and the unpriced hours. Clients carry the sums and the worst status. Owner and Admin also get a "No client" bucket, always listed last. Project managers, employees and core managers get a plain 404.

## What was built

- **`ConsumptionQuery::byProjectMonth()`** returns, in one grouped statement over the listed projects' work entries in the local date range, the seconds, cost cents and unpriced seconds per project and local month.
  - The cost join was extracted from `periodTotals` into a private `joinDatedRate()` that both methods use.
  - `baseQuery()` now accepts one project id or a list.
  - Checked offline with a `beforeExecuting` hook: the SQL and bindings of `periodTotals` are unchanged (five `now`, timezone, org, project, `work`, bounds). `byProjectMonth` binds timezone, three `now`, timezone, org, the project ids, `work` and the bounds, matching its placeholders.
- **`ClientRollupService`**:
  - `contractsInScope()` returns every contract for full scope, only the contracts of the caller's account clients for an account manager, and nothing otherwise. Each contract is re-checked with `hasMoneyFor`.
  - `forRange()` loads all periods in one query and the range's plan rows in one query, and gets consumption from one `byProjectMonth` call over `from..cappedTo`. It then builds the project rows (`project_id`, `name`, `color`, `client_id`, `archived`, `hours_sold_seconds`, `consumed_seconds`, `amount_cents`, `cost_cents`, `margin_cents`, `margin_percent`, `unpriced_cost_seconds`, `status`), the client rows (`client_id`, `name`, `project_count`, the sums, `margin_percent`, worst `status`, `projects[]`) and the totals.
- **`ClientsViewController::index`**:
  - It returns a 404 (`ModelNotFoundException` on Organization) unless `views()` contains `clients`.
  - The range comes from `?range=` through `ReportRange::fromKey`. Contracts are materialized through max(today, range end).
  - Response: `{ data, meta: { range: ReportRange::toArray(), totals } }`.
- **Route** `GET /profitability/organizations/{organization}/views/clients` in `routes/views.php`. It uses the same `web`, `auth:web`, `auth.session` and `verified` group as before, plus `whereUuid`, `throttle:120,1,profitability-read:` and the name `profitability.views.clients`. No `{member}` parameter.
- **`ClientsViewTest`** has 9 tests:
  - Account manager portfolio, with a recursive check that no per-person or per-entry key appears.
  - Owner ordering and the No client bucket last.
  - Straight-line share, including the remainder.
  - Front-loaded planned hours.
  - The today cap, including an uncapped closed range.
  - Unpriced hours: before the rate's effective date, and for a person without any rate.
  - 404 for a project manager, an employee and a core manager.
  - Unknown or missing range falls back to this month.
  - Null margin % without an amount.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 6e03bffc | feat(08-14): clients view with money per account manager portfolio |
| 2 | 30c3575d | test(08-14): clients view ranges, shares and scope |

## Gates

- **Gate P:**
  - `php -l` was clean on all five files.
  - Pint `--test` on `app/Profitability` and `tests/Feature/Profitability` passed.
  - Full-app PHPStan (level 7, worktree-first `--autoload-file`) gave `[OK] No errors` after each task. The first run of Task 1 flagged `list<string>` vs `array<int, string>`, fixed with `array_values`.
- **Route check** (worktree-first artisan loader, `--json` plus the node filter) prints exactly `clients,people,projects`.
- **DB-free unit suite** `tests/Unit/Profitability`: `OK (114 tests, 48062 assertions)`. Nothing regressed.
- **Tracer gate:** after Task 1 the automated verify was re-run end to end (route list, lint, Pint, PHPStan) before Task 2 started.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `function byProjectMonth` | 1 |
  | `left join lateral` (case-insensitive) in ConsumptionQuery | 2 |
  | `views()` in ClientsViewController | 2 |
  | `function test_` in ClientsViewTest | 9 |

- **Feature PHPUnit `tests/Feature/Profitability/ClientsViewTest.php` (9 tests): PENDING CI (orchestrator).** It needs Postgres.

## Deviations from Plan

### Interpretations (no Rule 4 needed)

**1. Materialization through the range end.** The plan says "materialize the contracts in scope". Materializing through today only would leave, for example, December out of This quarter for monthly contracts when today is in October. That would understate amount and hours sold. The controller therefore calls `ensureThrough(contract, max(today, range end))`. The extra periods are upcoming ones, and terms changes already rewrite every upcoming period (ContractTermsController).

**2. Projects listed by period overlap or time in range.** A contract project with time in the range but no period there (time before the contract start) is listed with amount 0 and its cost. It is never dropped silently.

**3. Additions inside the plan's files.**
- `ClientRollupService::contractsInScope()` is public so the controller can materialize the same set.
- `meta.totals.unpriced_cost_seconds`.
- Project rows carry `color`, `client_id` and `archived` for the UI.

### Auto-fixed Issues

**1. [Rule 1 - Type] PHPStan list type for the project ids** (Task 1, before the commit): `array_values(...unique()->all())`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-34: rows are limited to `accountClientIds` for non-full scopes, the No client bucket is only reachable through full scope, and the tests cover both.
- T-08-63: 404 unless `views()` contains `clients`, tested for a project manager, an employee and a core manager.
- T-08-SC: no package installs.

## Open items

- Feature PHPUnit `ClientsViewTest` (9) and the wave CI gate: PENDING CI (orchestrator).
- Frontend (08-17):
  - Label the row with `client_id: null` and `name: null` as "No client".
  - Show "Incomplete" when `unpriced_cost_seconds > 0`.
  - `margin_percent` is a 0..100 float or null; format it client-side.
  - Default sort is margin ascending, applied client-side.
- The worktree plan ledger is `.git/worktrees/agent-a960942aba007547d/gsd-plan-head-before-08-14` (= BASE).

## Self-Check: PASSED

- FOUND: app/Profitability/Reporting/ClientRollupService.php, app/Profitability/Http/Controllers/ClientsViewController.php, tests/Feature/Profitability/ClientsViewTest.php, app/Profitability/Reporting/ConsumptionQuery.php, app/Profitability/routes/views.php
- FOUND: 6e03bffc, 30c3575d (ancestors of HEAD)
