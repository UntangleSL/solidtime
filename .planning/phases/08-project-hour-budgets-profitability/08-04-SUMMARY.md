---
phase: 08-project-hour-budgets-profitability
plan: 04
subsystem: profitability-server
tags: [profitability, contracts, periods, materializer, plan-distributor]
requires: [08-01]
provides:
  - "ContractSchedule enum (one_off | monthly | quarterly | annual; months(), isRenewing()) cast on ProjectContract::schedule"
  - "Pure PeriodCalendar (first, next, months, stubDays, prorateSeconds, prorateCents, stateOn) and PeriodBounds"
  - "Pure PlanDistributor (evenSplit, rescale, delta) with the sum = budget invariant"
  - "PeriodMaterializer::ensureThrough(ProjectContract, CarbonImmutable $today): insert-only, contract row locked, idempotent, current period plus the next one"
  - "ContractPeriodMonth model"
  - "PUT profitability/organizations/{organization}/projects/{project}/contract (profitability.projects.contract), ContractTermsController::upsert + ContractTermsRequest"
  - "Summary period.months[] = {month, planned_seconds, consumed_seconds}; the summary materializes on read"
affects: [08-08, 08-09, 08-10, 08-14, 08-16]
requirements-completed: [BUDG-01, BUDG-02, BUDG-04]
tech-stack:
  added: []
  patterns:
    - "Pure date arithmetic on calendar dates held as midnight UTC (input reduced to its Y-m-d), so a local 'today' in Europe/Madrid and a UTC date cast compare correctly"
    - "Lazy materialization: one transaction, lockForUpdate on the contract, insertOrIgnore with Str::uuid() on the unique keys; months inserted only for a period this call created"
key-files:
  created:
    - app/Profitability/Enums/ContractSchedule.php
    - app/Profitability/Models/ContractPeriodMonth.php
    - app/Profitability/Periods/PeriodBounds.php
    - app/Profitability/Periods/PeriodCalendar.php
    - app/Profitability/Periods/PlanDistributor.php
    - app/Profitability/Periods/PeriodMaterializer.php
    - app/Profitability/Http/Controllers/ContractTermsController.php
    - app/Profitability/Http/Requests/ContractTermsRequest.php
    - app/Profitability/routes/contracts.php
    - tests/Feature/Profitability/ContractTermsTest.php
    - tests/Unit/Profitability/PeriodCalendarTest.php
    - tests/Unit/Profitability/PlanDistributorTest.php
  modified:
    - app/Profitability/Models/ProjectContract.php
    - app/Profitability/Http/Controllers/ProjectSummaryController.php
decisions:
  - "A period after a pause whose resume_on is not the 1st is a stub to the end of that month (prorated), so the grid stays on the 1st (D-15 + D-18)"
  - "Periods are not clipped to ends_on: the end date only stops new periods from starting (08-08 removes upcoming periods past a new end date)"
  - "PlanDistributor::delta = sum(planned) - budget (positive = over-planned)"
  - "Dates are bounded to 2000-01-01..2099-12-31 and the materializer creates at most 600 periods per call (T-08-13)"
  - "A concurrent second create (unique project_id) answers the same 422 on schedule as an existing contract"
  - "ContractTermsController also takes ConsumptionQuery (single source of the profitability timezone, as in 08-01), PeriodCalendar and PlanDistributor"
metrics:
  duration: "about 35 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 100000
  tasks: 2
actuals:
  tokens: 17700
  tasks: 2
  commits: 2
plan_head_before: 5fe90595dbfcf519549f1608b6c9e77540fdad6d
plan_head_after: d237c05b
---

# Phase 8 Plan 04: Contract terms and materialized periods Summary

One PUT saves a billable project's contract terms. A lazy, insert-only materializer turns them into contract periods: a prorated stub first period when the contract starts after the 1st (D-15), then periods renewing monthly, quarterly or yearly. Each period starts clean with an even monthly plan whose months add up to its hours (D-02, D-03, D-04). The project summary now lists the months of the period with planned and consumed hours (BUDG-04 read side).

## What was built

- **`ContractSchedule`** enum (`one_off`, `monthly`, `quarterly`, `annual`; `months()` null/1/3/12, `isRenewing()`), cast on `ProjectContract::schedule`.
- **`PeriodCalendar`** (final, no clock, no database; its docblock lists the rules in order): `first()` (one-off start..end; renewing from the 1st gives a full period; from another day gives a stub to the end of the month), `next()` (day after the previous end, or `resume_on` when later; null after `ends_on` or for one-off; a start that is not the 1st gives a stub), `months()`, `stubDays()`, `prorateSeconds()` (nearest 1800 s, integer arithmetic), `prorateCents()` (nearest cent), `stateOn()` (inclusive end). Every input is reduced to its calendar date (midnight UTC), so Madrid-local "today" values and UTC date casts never disagree.
- **`PlanDistributor`** (final, pure): `evenSplit()` (whole half-hour steps, extra steps to the earlier months, sub-step remainder on the last month), `rescale()` (largest remainder in steps, ties to the earlier month, all-zero falls back to the even split), `delta()`.
- **`PeriodMaterializer::ensureThrough()`**: one transaction, `lockForUpdate` on the contract; nothing while the project is archived; first period when none exists, then `next()` while the last period starts on or before today, so the result is every period up to the current one plus exactly one upcoming. Stubs get prorated template values. Inserts use `insertOrIgnore` with `Str::uuid()`. Plan months are inserted only for a period this call created, so an existing row is never updated or deleted. The loop stops after 600 new periods at most.
- **`ContractPeriodMonth`** model (`period()` BelongsTo).
- **`ContractTermsRequest`**: the planned rules, plus a date range of 2000-01-01 to 2099-12-31 on both dates. `messages()` maps `ends_on.required_if` to `profitability.validation.one_off_needs_end` and `ends_on.after` to `end_before_start`. It has typed accessors (`schedule()` returns the enum; dates are `CarbonImmutable`).
- **`ContractTermsController::upsert()`**: scope first. Unknown, foreign or out-of-scope projects (`canEditTerms`) get a 404. A non-billable project gets a 422 on `project`, and an existing contract (or a concurrent create) gets a 422 on `schedule` with `schedule_locked`. The controller creates the contract from route ids, materializes it, applies any first-period values to the stub, re-splits the stub's months, and answers 204. Everything runs in one transaction.
- **Route** `PUT /profitability/organizations/{organization}/projects/{project}/contract` with the web/auth middleware, `whereUuid`, `check-organization-blocked`, `throttle:60,1,profitability-write:` and the name `profitability.projects.contract`.
- **Summary**: `ensureThrough($contract, local today)` runs before the period is read. `contract.schedule` is emitted as `->value`. `period.months[]` covers every month the period touches, with `planned_seconds` from the plan rows (0 when a month has no row) and `consumed_seconds` from `ConsumptionQuery::secondsByMonth` (0 when no time was logged).
- **Tests**: `ContractTermsTest` (9 feature tests: stub tracer with summary months, first-period override, one-off without end, end not after start, non-billable, employee/core manager 404, admin, existing terms 422, quarterly with three plan rows); `PeriodCalendarTest` and `PlanDistributorTest` (53 unit tests with DataProvider tables and property loops over 0..200 h x 1..12 months).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | c6645a91 | feat(08-04): contract terms with materialized periods and an even monthly plan |
| 2 | d237c05b | test(08-04): period calendar and plan distributor invariants |

## Gates

- Route check (worktree-first artisan loader): `PUT profitability/organizations/{organization}/projects/{project}/contract true`.
- `php -l` on every new/changed PHP file: clean. Pint `--test` on `app/Profitability tests/Feature/Profitability tests/Unit/Profitability`: passed.
- PHPStan (full app, worktree-first autoload): `[OK] No errors`.
- Gate U: `phpunit tests/Unit/Profitability`: `OK (53 tests, 46549 assertions)`.
- Acceptance greps: `insertOrIgnore` = 2, `lockForUpdate` = 1 in PeriodMaterializer; `estimated_time|spent_time` = 0 in the materializer and in ContractTermsController; `function test_` = 9 in ContractTermsTest; `DataProvider` = 5 in PeriodCalendarTest; `array_sum` = 3 in PlanDistributorTest.
- `tests/Feature/Profitability/ContractTermsTest.php` and the existing `ProjectSummaryTest.php` (the summary now materializes on read): **PENDING CI (orchestrator)**, because they need Postgres.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Static helper named `date()` clashed with `Request::date()`**
- **Found during:** Task 1 (Gate P)
- **Issue:** PHP fatal error "Cannot make non static method Illuminate\Http\Request::date() static" in ContractTermsRequest.
- **Fix:** renamed the helper to `localDate()`.
- **Files modified:** app/Profitability/Http/Requests/ContractTermsRequest.php
- **Commit:** c6645a91

**2. [Rule 2 - Missing critical] Bounds against unbounded row creation (T-08-13)**
- Added a date range of 2000-01-01 to 2099-12-31 on `starts_on`/`ends_on` and a cap of 600 new periods per `ensureThrough` call.
- **Commit:** c6645a91

**3. [Rule 2 - Missing critical] Concurrent create**
- A `UniqueConstraintViolationException` on `project_contracts.project_id` (two concurrent PUTs) answers the same 422 `schedule_locked` instead of a 500.
- **Commit:** c6645a91

**4. [Interpretation] Resume mid-month**
- The plan says `next()` starts at `resume_on`. When `resume_on` is not the 1st, the period is a stub to the end of that month (prorated, as in D-15), so later periods stay on the 1st. This case is covered in PeriodCalendarTest.

**5. [TDD note] Task 2 RED**
- The Task 1 classes already met every Task 2 case (they were smoke-checked against the plan's examples before the Task 1 commit), so the new unit tests passed on their first run. No production change was needed in Task 2.

Added one feature test beyond the plan's list, `test_existing_terms_are_not_replaced`, which covers the planned 422 for an existing contract.

## Known Stubs

None. An existing contract answers 422 on `schedule` by design until 08-08 adds editing.

## Open items

- Feature PHPUnit `ContractTermsTest` (9) and `ProjectSummaryTest` (12, now materializing on read): PENDING CI (orchestrator).
- The English copy assertions in `ContractTermsTest` ("A one-off contract needs an end date.", "The end date must be after the start date.") depend on `lang/en/profitability.php` from 08-02, which runs in the same wave. They pass only once both plans are merged.
- The project-manager 404 case (truth 1) needs the 08-03 assignments. With the current `ProfitabilityAccess`, a non-Owner/Admin user has no scope; the employee and core manager 404 cases are covered.

## Self-Check: PASSED

- FOUND: all 12 created files and the 2 modified files
- FOUND: c6645a91, d237c05b (ancestors of HEAD)
