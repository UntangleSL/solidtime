---
phase: 08-project-hour-budgets-profitability
plan: 09
subsystem: profitability-server
tags: [profitability, monthly-plan, renewal, scheduler, archive, d-02, d-04, d-18]
requires: [08-03, 08-04, 08-07, 08-08]
provides:
  - "PUT profitability/organizations/{organization}/projects/{project}/periods/{period}/plan (profitability.periods.plan): body {months: [{month: Y-m-d, planned_seconds}]}, 204; 404 outside canEditPlan or for a period outside the project's contract; 422 on `months` for a closed period (period_closed), months that are not exactly the period's months (validation.in), or a sum other than the period's hours (plan_sum with :x/:sold formatted hours, :n bare hours)"
  - "App\\Profitability\\Http\\Controllers\\PlanController::update and App\\Profitability\\Http\\Requests\\PlanRequest (plannedByMonth(): array<string, int>)"
  - "php artisan profitability:renew-periods [--dry-run]: ensureThrough for every contract of a non-archived project (chunkById 200); prints `contracts: N` then `created: N` (or `dry-run: nothing written`)"
  - "Daily schedule from ProfitabilityServiceProvider: profitability.renew_daily_at (04:30) in profitability.timezone (Europe/Madrid), withoutOverlapping; core Console Kernel untouched"
  - "App\\Profitability\\Periods\\RecordRenewalPause::handle(Project), registered as Project::updated: archive -> paused_on = today and not-started periods deleted; un-archive -> resume_on = 1st of the current month, paused_on cleared"
affects: [08-10, 08-16, 08-19]
requirements-completed: [BUDG-04, BUDG-02]
tech-stack:
  added: []
  patterns:
    - "Scope gate before body validation: the FormRequest is resolved from the container after the 404 checks (same as 08-03)"
    - "Plan write in one transaction holding the contract row locked (same lock as the terms editor and the materializer), validation re-read inside it"
    - "Archive transitions read from getPrevious() in the updated event: only null -> set and set -> null act"
key-files:
  created:
    - app/Profitability/Http/Controllers/PlanController.php
    - app/Profitability/Http/Requests/PlanRequest.php
    - app/Profitability/Console/RenewPeriodsCommand.php
    - app/Profitability/Periods/RecordRenewalPause.php
    - tests/Feature/Profitability/PlanEditingTest.php
    - tests/Feature/Profitability/RenewalLifecycleTest.php
  modified:
    - app/Profitability/routes/contracts.php
    - app/Profitability/ProfitabilityServiceProvider.php
decisions:
  - "The plan endpoint takes a plain Request and resolves PlanRequest after the scope, project, contract and period checks, so an account manager or employee gets 404 even with an empty body (08-03 precedent, D-16)"
  - "A month set that is not exactly the period's months answers core validation.in on `months` (no dedicated copy exists in the 08-02 lang files, which this plan does not own)"
  - "Hours in plan_sum use up to two decimals with trailing zeros dropped ('110 h', '12.5 h'), so a delta of a few minutes never reads '0 h'"
  - "Re-archiving an already archived project (core writes a new archived_at timestamp) changes nothing: paused_on keeps the first archive date"
  - "The renewal command counts all contract_periods rows before and after the run for `created:`; 'today' comes from ConsumptionQuery::timezone(), the single source of the profitability timezone"
metrics:
  duration: "about 40 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 80b2670eb39ae40d3b16e9f53314443a48cc6bd7
plan_head_after: 60ca94682bce22dc7d4184a19ed5fdaea569e847
---

# Phase 8 Plan 09: Monthly plan editing and the renewal lifecycle Summary

A project manager, Owner or Admin can now save an uneven monthly plan for the current or upcoming period of a contract. The months must be exactly the period's months and add up exactly to its hours. A closed period's plan is refused, and everyone else gets a 404. A daily `profitability:renew-periods` command, scheduled from the fork provider at 04:30 Madrid time, materializes due periods as a safety net. Archiving a project pauses renewal, and un-archiving resumes it from the current month without back-filling.

## What was built

- **PlanRequest**: `months` must be an array of 1 to 12 entries, each with exactly the keys `month` and `planned_seconds`. `month` uses the `Y-m-d` format and must be distinct; `planned_seconds` is an integer from 0 to 3600000000. `plannedByMonth()` returns `array<string, int>`.
- **PlanController::update**: the checks run in this order, before the body is read.
  1. Scope.
  2. The project inside the route organization.
  3. `canEditPlan`.
  4. The project's contract.
  5. The period among that contract's periods. Each failure is a plain 404.

  The request body is validated only after these checks pass. Then, in one transaction with the contract row locked:
  - a closed period gets 422 `period_closed`;
  - a month set different from the period's gets 422 `validation.in`;
  - `PlanDistributor::delta() !== 0` gets 422 `plan_sum`.

  Otherwise the controller updates only the months whose value changed and returns 204.
- **Route**: `PUT /profitability/organizations/{organization}/projects/{project}/periods/{period}/plan` in `routes/contracts.php`. It has `whereUuid` on the three ids, `check-organization-blocked`, `throttle:60,1,profitability-write:` and the name `profitability.periods.plan`. It does not use a `{member}` parameter.
- **RenewPeriodsCommand**: covered under Provides above. Its output contains counts only.
- **Provider**:
  - The command is added to the console list.
  - `callAfterResolving(Schedule::class)` registers `dailyAt(renew_daily_at)->timezone(profitability.timezone)->withoutOverlapping()` through a private `configString()` helper, as in the m365 provider.
  - `Project::updated` resolves `RecordRenewalPause` once per event.
- **RecordRenewalPause**:
  - It acts only when `wasChanged('archived_at')` is true and the change is a null to set or set to null transition, read from `getPrevious()`.
  - It does nothing for a project without a contract.
  - It writes fork rows only, inside a transaction with the contract row locked.
  - Periods that have started are never deleted or changed.
- **Tests**:
  - `PlanEditingTest` (9): a project manager saves a 60/40/20 plan and the summary shows it; Owner and Admin; a sum mismatch gives the 110/120/10 copy; missing, foreign, extra, duplicate and empty months; a closed period; an upcoming period; an account manager gets 404 (also with an empty body) while the summary is still 200; an employee gets 404; another project's, another organization's or an unknown period gets 404.
  - `RenewalLifecycleTest` (8): the schedule (`30 4 * * *`, Europe/Madrid, without overlapping); the due January period is created (`created: 1`); idempotence (`created: 0`); dry-run; archived projects are skipped; archiving through the core API project update (December removed, November plan kept, `paused_on` 2026-11-18, a summary read creates nothing, re-archiving changes nothing); un-archiving on 2027-02-10 (`resume_on` 2027-02-01, periods Oct, Nov, Feb, Mar, never Dec or Jan); a project without a contract is ignored.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | b7387fea | feat(08-09): project managers rebalance the monthly plan |
| 2 | 90ef7f3e | feat(08-09): daily renewal safety net from the fork provider |
| 3 | 60ca9468 | feat(08-09): archive pauses renewal, un-archive resumes from the current month |

## Gates

- Route check (worktree-first artisan loader): `PUT profitability/organizations/{organization}/projects/{project}/periods/{period}/plan true`.
- `schedule:list` lists `profitability:renew-periods` once (count 1). The list shows `30 3 * * *` because it prints in the app timezone (UTC); the event's own expression is `30 4 * * *` in Europe/Madrid.
- `php -l` passed on every new or changed PHP file. Pint `--test app/Profitability tests/Feature/Profitability` passed. Full-app PHPStan (level 7, worktree-first autoload) returned `[OK] No errors` after each task.
- A scratch PHPStan run on the two new test files found only the patterns the existing tests already have: `missingType.generics` on `TestResponse` helpers and `PendingCommand|int` on `artisan()` chains. Tests are outside the CI PHPStan paths.
- DB-free unit tests: `tests/Unit/Profitability` OK (97 tests).
- `app/Console/Kernel.php`: no diff against the base or `origin/feature/m365-integration`.
- Acceptance greps:
  - `canEditPlan(` in PlanController: 1
  - `function test_` in PlanEditingTest: 9
  - `withoutOverlapping` in the provider: 1
  - `function test_` in RenewalLifecycleTest: 8
  - `wasChanged('archived_at')` in RecordRenewalPause: 1
  - `Project::updated(` in the provider: 1
- `PlanEditingTest` and `RenewalLifecycleTest`: **PENDING CI (orchestrator)**, because they need Postgres.

## Deviations from Plan

**1. [Rule 2 - Security] Scope gate before body validation.** The plan's signature injected `PlanRequest`. That would validate the body first, so an outsider could get a 422 instead of a 404 (T-08-25, D-16). The action now takes `Request` and resolves `PlanRequest` after the gates, as 08-03 does. A test covers an empty body from an account manager. (b7387fea)

**2. [Rule 2 - Correctness] The plan write locks the contract row.** The plan write and its validation run under the same lock as the terms editor and the materializer. A concurrent change to the period's hours therefore cannot leave a plan that no longer adds up. (b7387fea)

**3. [Interpretation] Re-archiving is a no-op.** Core rewrites `archived_at` on every save with `is_archived: true`. The listener acts only on real transitions, so the pause date stays the first archive date. (60ca9468)

There was no other change of scope. Each test class has exactly the tests the plan named; extra assertions were added inside them.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-25: the `canEditPlan` 404 gate, tested for an account manager and an employee.
- T-08-26: the period is resolved only inside the route project's contract, tested with a sibling project, another organization and an unknown id.
- T-08-27: closed periods get a 422, and the archive listener never touches periods that have started.
- T-08-28: chunked iteration, `withoutOverlapping`, and an insert-only materializer.
- T-08-SC: no packages installed.

## Open items

- Feature PHPUnit `PlanEditingTest` (9) and `RenewalLifecycleTest` (8): PENDING CI (orchestrator).
- The `Project::updated` listener now runs on every Eloquent project update, including core's `ProjectEndpointTest` archive tests. Without a contract it costs one extra query and changes nothing. The existing `PeriodMaterializerTest::test_nothing_is_created_while_the_project_is_archived` archives through a model save: the listener sets `paused_on` and removes nothing, because no period starts after 2026-11-18, so its assertions still hold.
- Edge case outside this plan's files: a contract created while its project is archived has no periods. If it is un-archived later, `PeriodCalendar::first()` starts from `starts_on` and ignores `resume_on`, so its first months are back-filled. Such a contract was never renewing, so this is arguably correct, but 08-19 may want to confirm it.
- Archive changes made through a mass query update (no Eloquent event) would not pause renewal. Core has none today; every archive path is `ProjectController::update` followed by `save()`.

## Self-Check: PASSED

- FOUND: app/Profitability/Http/Controllers/PlanController.php, app/Profitability/Http/Requests/PlanRequest.php, app/Profitability/Console/RenewPeriodsCommand.php, app/Profitability/Periods/RecordRenewalPause.php, tests/Feature/Profitability/PlanEditingTest.php, tests/Feature/Profitability/RenewalLifecycleTest.php, app/Profitability/routes/contracts.php, app/Profitability/ProfitabilityServiceProvider.php
- FOUND: b7387fea, 90ef7f3e, 60ca9468 (ancestors of HEAD)
