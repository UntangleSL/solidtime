---
phase: 08-project-hour-budgets-profitability
plan: 08
subsystem: profitability-server
tags: [profitability, contracts, periods, materializer, apply-to, period-selection]
requires: [08-01, 08-02, 08-04]
provides:
  - "Summary `periods[]` = [{id, starts_on, ends_on, state}] newest first (state current | upcoming | closed); `?period=<uuid>` selects a period of the project's contract (any other id, a malformed id or a project without contract: 404); the default is the current period, else the latest started one, else the first upcoming one; `period.state` is the selected period's real state"
  - "ContractPeriod::months() (HasMany ContractPeriodMonth ordered by month) and ContractPeriod::stateOn(CarbonImmutable $today) delegating to PeriodCalendar::stateOn"
  - "ContractTermsController::upsert edits existing contracts: before start, a full replace (schedule, dates, terms, periods re-created, first-period overrides applied); after start, schedule/starts_on locked (422 schedule_locked on the changed field), ends_on not before the latest started period (422 ends_before_current_period), upcoming periods past a new end date removed, apply_to required (422 on apply_to): current_and_following updates the current period (plan rescaled when its hours change) and the upcoming ones, next_period only the upcoming ones; closed periods never written"
  - "tests/Feature/Profitability/PeriodMaterializerTest.php (17 tests): period list and selection, started-contract edits, materializer lifecycle"
affects: [08-09, 08-10, 08-14, 08-16]
requirements-completed: [BUDG-01, BUDG-02, BUDG-04]
tech-stack:
  added: []
  patterns:
    - "Edits of an existing contract run in one transaction with the contract row locked (lockForUpdate), then call the insert-only materializer so periods made possible by a later end date take the new terms"
    - "Selection by id is resolved inside the route project's contract periods; nothing is looked up by id globally (IDOR-safe)"
key-files:
  created:
    - tests/Feature/Profitability/PeriodMaterializerTest.php
  modified:
    - app/Profitability/Http/Controllers/ProjectSummaryController.php
    - app/Profitability/Http/Controllers/ContractTermsController.php
    - app/Profitability/Models/ContractPeriod.php
    - tests/Feature/Profitability/ContractTermsTest.php
decisions:
  - "'Started' means the contract's starts_on is on or before today (profitability timezone); the first period always starts on starts_on"
  - "The end-date floor is the start of the latest started period (the current one when it exists), so an end date can never cut into a closed or running period, even during a pause with no current period"
  - "After start, a one-off's end date is locked like the schedule (422 schedule_locked on ends_on): it is the end of its only period, and periods are not cut at the end date"
  - "A current or upcoming stub period (starts after the 1st on a renewing schedule) gets the new terms prorated like a new stub (D-15)"
  - "Months are only rewritten when a period's hours change: an edit of service or amount alone keeps a manual plan; the current period is rescaled (PlanDistributor::rescale), an upcoming one gets a fresh evenSplit"
  - "The template (service, ends_on, hours, amount) is saved for both apply_to values, since it drives every period created later"
metrics:
  duration: "about 40 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 65000
  tasks: 3
actuals:
  tokens: 12800
  tasks: 3
  commits: 3
plan_head_before: 22903980c778fa047df4ad311550ca0c3effd31c
plan_head_after: cdd77fba51d46d57b21c7d1ac9a4e18c43320a13
---

# Phase 8 Plan 08: Contract period lifecycle Summary

The project summary now lists every period of a contract, newest first, with its state, and can show any one of them through `?period=`. Account managers can change the terms of a contract that has already started, for this period and the following ones or only from the next period, and no edit ever writes a closed period (D-03, D-04, UI-D9). The materializer's renewal behaviour across gaps, end dates, archives and pauses is covered by feature tests.

## What was built

- **ContractPeriod**: `months()` (HasMany `ContractPeriodMonth` ordered by `month`) and `stateOn(CarbonImmutable $today)`, which delegates to `PeriodCalendar::stateOn`. `ProjectContract::periods()` was already ordered by `starts_on` (08-01), so that file needed no change.
- **ProjectSummaryController::show**:
  - Adds `periods: [{id, starts_on, ends_on, state}]`, newest first. A billable project without a contract returns `[]`.
  - `?period=<uuid>` is matched only among the periods of this project's contract. An id from another contract or another organization, an unknown or malformed id, or any `?period=` on a project without a contract returns a plain 404 (T-08-61).
  - With no `?period=`, the summary shows the current period, else the latest one that has started, else the first upcoming one.
  - `period.state` now comes from `stateOn` (before this plan it was always `'current'`).
- **ContractTermsController::upsert** (existing contract, one transaction with the contract row locked):
  - **Not started:**
    - Deletes the not-started periods; their months cascade.
    - Replaces the service, schedule, dates and terms.
    - Calls `ensureThrough` again and applies the first-period overrides.
  - **Started:**
    - Collects every validation error before writing anything:
      - A changed `schedule` or `starts_on` gets `schedule_locked`.
      - On a one-off, a changed `ends_on` also gets `schedule_locked`.
      - An `ends_on` before the start of the latest started period gets `ends_before_current_period`.
      - A missing `apply_to` gets `validation.required`.
    - Saves the template, deletes the upcoming periods that now start after `ends_on`, and calls `ensureThrough`.
    - Gives every upcoming period the new terms, then the current period too when `apply_to` is `current_and_following`.
    - Prorates the terms for stub periods.
    - Rewrites a period's months only when its hours change: the current period's plan is rescaled, an upcoming period gets an even split.
- **PeriodMaterializerTest** (17 tests):
  - Summary: `test_summary_lists_periods_newest_first_and_selects_one`, `test_default_period_is_current_then_latest_started_then_first_upcoming`, `test_foreign_period_id_is_404`.
  - Edits: `test_editing_before_start_replaces_the_schedule`, `test_apply_to_current_rescales_the_current_plan_and_keeps_closed_periods` (a 3:2:1 quarter plan rescaled from 120 h to 60 h gives 30/20/10 h; the closed quarter is unchanged), `test_apply_to_next_period_leaves_the_current_period`, `test_apply_to_is_required_once_started`, `test_schedule_change_after_start_is_rejected`, `test_end_date_trims_upcoming_periods`, `test_end_date_before_the_current_period_is_rejected`.
  - Materializer: `test_materialization_is_idempotent`, `test_existing_rows_are_never_duplicated_when_inserted_concurrently`, `test_creates_the_current_and_the_next_period_after_a_long_gap` (June to December), `test_no_period_starts_after_the_end_date`, `test_nothing_is_created_while_the_project_is_archived`, `test_resume_on_skips_the_paused_months` (a resume on the 1st, and a mid-month resume that gives a prorated stub of 17 of 31 days), `test_quarterly_and_annual_grids` (including a quarterly stub and the 2028 leap day).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | c7b66c04 | feat(08-08): summary lists and selects contract periods |
| 2 | f3678973 | feat(08-08): edit started contracts without touching closed periods |
| 3 | cdd77fba | test(08-08): materializer lifecycle |

## Gates

- `php -l` on every changed PHP file: clean.
- Pint `--test app/Profitability tests/Feature/Profitability`: passed.
- PHPStan (full app, worktree-first autoload `--autoload-file`): `[OK] No errors`. One earlier run failed with a transient parallel-worker error; the rerun was clean.
- Gate U `phpunit tests/Unit/Profitability` (worktree-first bootstrap): `OK (71 tests, 47992 assertions)`.
- Acceptance greps:
  - `function stateOn` in ContractPeriod: 1.
  - `'periods'` in ProjectSummaryController: 1.
  - `'current_and_following'|'next_period'` in ContractTermsController: 2.
  - `rescale(` in ContractTermsController: 1.
  - `function test_` in PeriodMaterializerTest: 17.
  - `->(update|delete)(` in PeriodMaterializer: 0 (it is still insert-only).
  - `spent_time` in the changed app files: 0.
- `tests/Feature/Profitability/PeriodMaterializerTest.php` and the adjusted `ContractTermsTest.php`: **PENDING CI (orchestrator)**, because they need Postgres.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ContractTermsTest asserted the old 422 on `schedule` for any edit**
- **Found during:** Task 2
- **Issue:** `test_existing_terms_are_not_replaced` (08-04) expected a 422 on `schedule` for any edit of an existing contract. After this plan, that edit (contract started, no `apply_to`) answers 422 on `apply_to`.
- **Fix:** the assertion now expects `apply_to`. The test still proves the stub period is not changed. The file is outside this plan's files_modified, but no wave-3 peer touches it.
- **Files modified:** tests/Feature/Profitability/ContractTermsTest.php
- **Commit:** f3678973

**2. [Interpretation] One-off end date locked after start**
- The plan does not cover a one-off's end date. A one-off's only period runs to that date, and periods are not cut at the end date (08-04), so after the start a change answers 422 `schedule_locked` on `ends_on`.

**3. [Interpretation] Upcoming plans are kept when the hours do not change**
- The plan says every upcoming period gets a fresh `evenSplit`. To avoid wiping a project manager's plan (08-09), the months are rewritten only when the period's hours change. When the hours do change, the even split is applied as planned.

**4. [Interpretation] End-date floor during a pause**
- Without a current period (for example a paused contract), the end date is checked against the start of the latest started period, not rejected outright and not left unchecked.

**5. Not changed:** `ProjectContract.php` already had `periods()` ordered by `starts_on`. `PeriodMaterializer.php` needed no correction: every lifecycle case matches its 08-04 behaviour.

## Known Stubs

None.

## Threat Flags

None. T-08-12 is mitigated: closed periods are never selected for update and the tests assert the closed rows are unchanged. T-08-61 is mitigated: the period id is resolved only inside the route project's contract, and the 404 cases are tested.

## Open items

- Feature PHPUnit `PeriodMaterializerTest` (17 tests) and `ContractTermsTest` (9 tests, one assertion changed): PENDING CI (orchestrator).
- Frontend consumers: 08-06 reads `period.state` (now real) and can ignore `periods[]`; the period select and the "Apply changes to" radio belong to later UI plans (08-16).
- Product question to confirm: should extending a running one-off's end date be allowed (it would move its only period's end and re-plan the months)? It is locked for now.

## Self-Check: PASSED

- FOUND: tests/Feature/Profitability/PeriodMaterializerTest.php, app/Profitability/Http/Controllers/ProjectSummaryController.php, app/Profitability/Http/Controllers/ContractTermsController.php, app/Profitability/Models/ContractPeriod.php
- FOUND: c7b66c04, f3678973, cdd77fba (ancestors of HEAD)
