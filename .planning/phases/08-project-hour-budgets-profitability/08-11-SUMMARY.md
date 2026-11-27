---
phase: 08-project-hour-budgets-profitability
plan: 11
subsystem: profitability-server
tags: [profitability, chargeability, people-view, report-range, available-hours, owner-admin-only]
requires:
  - "08-01: ProfitabilityAccess::forUser / AccessScope::isFull, ConsumptionQuery::timezone(), route group convention, provider globbing app/Profitability/routes/*.php"
  - "08-05: member_work_weeks (MemberWorkWeek), profitability_absence_projects (AbsenceProject)"
provides:
  - "App\\Profitability\\Reporting\\ReportRange (final, pure): fromKey(key, today) for this_month, last_month, this_quarter, last_quarter, year_to_date, last_12_months (unknown -> this_month); readonly key/from/to/cappedTo/containsToday; months(); toArray() {key, from, to, capped_to, contains_today}; KEYS and per-key constants"
  - "AvailableHoursCalculator::availableSeconds(workWeeks, from, to): ?int (final, static, pure)"
  - "ChargeabilityQuery::byMemberForRange(orgId, from, to, now, absenceProjectIds): member_id => {billable_seconds, absence_seconds, internal_seconds}"
  - "ChargeabilityService::forRange(Organization, ReportRange, now): {people: [...], team: {...}}"
  - "GET profitability/organizations/{organization}/views/people?range= (profitability.views.people), Owner/Admin only: { data: [people], meta: { range, team } }"
affects: [08-14, 08-15, 08-19]
requirements-completed: [CHRG-02, CHRG-03]
tech-stack:
  added: []
  patterns:
    - "Absence ids bound as one Postgres uuid[] array literal (= any(CAST(? AS uuid[])), coalesced to false so entries without a project are never absence); ids filtered through Str::isUuid first"
    - "Range figures use from..cappedTo for both the time sums and the available hours (UI-D3: capped value only)"
key-files:
  created:
    - app/Profitability/Reporting/ReportRange.php
    - app/Profitability/Reporting/AvailableHoursCalculator.php
    - app/Profitability/Reporting/ChargeabilityQuery.php
    - app/Profitability/Reporting/ChargeabilityService.php
    - app/Profitability/Http/Controllers/PeopleViewController.php
    - app/Profitability/routes/people.php
    - tests/Feature/Profitability/ChargeabilityTest.php
    - tests/Unit/Profitability/AvailableHoursCalculatorTest.php
    - tests/Unit/Profitability/ReportRangeTest.php
  modified: []
decisions:
  - "Team chargeability and the available-weighted target are computed only over people with a working week; team billable/absence/internal seconds include everybody listed (KPI strip). A person without a working week has no denominator and would otherwise inflate the team ratio"
  - "weekly_seconds per person is the row in force today (UI 'current value'); target_percent is the row in force at the capped range end (RESEARCH)"
  - "A placeholder is listed only when its billable + absence + internal seconds in the range are above 0"
  - "Absence projects are read from profitability_absence_projects of the organization, restricted to projects that belong to the organization"
  - "chargeability, gap_points and team figures are unrounded floats; the frontend formats them"
  - "ReportRange::toArray() added (not in the plan) so meta.range has one source; the Clients view (08-14) can reuse it"
metrics:
  duration: "about 30 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 80000
  tasks: 2
actuals:
  tokens: 11000
  tasks: 2
  commits: 3
plan_head_before: 22903980c778fa047df4ad311550ca0c3effd31c
plan_head_after: a9999985
---

# Phase 8 Plan 11: People view (chargeability against target) Summary

Owner and Admin read, over a fork web-guard JSON route, each person's chargeability (billable / available, available = dated working week spread over Monday to Friday minus time on marked absence projects) against their dated target for a calendar-aligned range in Europe/Madrid, with team totals. Everyone else gets a plain 404.

## What was built

- **ReportRange** (final, pure): the six UI-SPEC ranges, calendar months and quarters, `to` = month end, `cappedTo` = min(to, today), `containsToday`, `months()`, `toArray()`. Unknown or empty keys fall back to `this_month`; month arithmetic uses the NoOverflow variants (31 March -> February works).
- **AvailableHoursCalculator** (final, static, pure): per weekday the row with the greatest `effective_from` on or before that day contributes `weekly_seconds / 5`; summed exactly and rounded once; null when no row is in force on or before `$to`. Days are walked as plain calendar dates so DST never shifts a day. Docblock: holidays come in as Festivo absence time until calendars arrive (D-06).
- **ChargeabilityQuery**: one read-only statement over `time_entries` grouped by `member_id`: `type = work`, start inside the UTC bounds of the local dates (ConsumptionQuery convention), running entries up to now, three `sum(...) filter (where ...)` columns: billable (billable, not absence), absence (any flag), internal (non-billable, not absence, with or without project). No cost, no `spent_time`.
- **ChargeabilityService**: every member (placeholders only with time), per person `member_id, name, is_placeholder, weekly_seconds, available_seconds, absence_seconds, billable_seconds, internal_seconds, chargeability, target_percent, gap_points, status (on_track / below_target / null)`, sorted by name; `team` = `billable_seconds, available_seconds, absence_seconds, internal_seconds, chargeability, target_percent`.
- **PeopleViewController::index**: `isFull()` gate first (404 `ModelNotFoundException` otherwise, also for a non-member organization); today in the profitability timezone; `{ data, meta: { range, team } }`.
- **Route** `app/Profitability/routes/people.php`: `GET /profitability/organizations/{organization}/views/people`, `['web', 'auth:web', 'auth.session', 'verified']`, `whereUuid`, `throttle:120,1,profitability-read:`, name `profitability.views.people`.
- **Tests**: `ChargeabilityTest` (7, feature), `AvailableHoursCalculatorTest` (11 cases), `ReportRangeTest` (15 cases).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | abc6378e | feat(08-11): people view with chargeability against target |
| 2 | a9999985 | test(08-11): available hours and report ranges |

## Gates

- Route check (worktree-first artisan loader): prints exactly `GET|HEAD profitability/organizations/{organization}/views/people`.
- `php -l` on every new file: clean. Pint `--test` on `app/Profitability tests/Feature/Profitability tests/Unit/Profitability`: passed. PHPStan full app (level 7, worktree-first autoload): `[OK] No errors` after each task.
- Gate U: `phpunit tests/Unit/Profitability/AvailableHoursCalculatorTest.php tests/Unit/Profitability/ReportRangeTest.php` -> `OK (26 tests, 31 assertions)`; whole `tests/Unit/Profitability` -> `OK (97 tests)`.
- Generated SQL checked offline (tinker `toSql`): bindings in order `[now, uuid[], now, uuid[], ..., org, work, from, to]`.
- Acceptance greps: `isFull()` in PeopleViewController = 2 (code + docblock); `function test_` in ChargeabilityTest = 7; `final class AvailableHoursCalculator` = 1; `DataProvider` in ReportRangeTest = 2.
- `tests/Feature/Profitability/ChargeabilityTest.php`: **PENDING CI (orchestrator)** (needs Postgres).

## TDD note

Task 2 tests were written after Task 1 created both helpers (the plan orders it so); all 26 cases passed on the first run, so no fix to the helpers was needed.

## Deviations from Plan

None in behaviour. Small additions inside the plan's files: `ReportRange::toArray()` and key constants; `internal_seconds` also in the team totals; extra unit cases (rows in any order, DST, month overflow, year boundaries) and feature assertions (breaks never count, a non-member Owner gets 404, unknown range falls back).

## Known Stubs

None.

## Open items

- Feature PHPUnit `ChargeabilityTest` (7 tests) and the wave CI gate: PENDING CI (orchestrator).
- Account and project managers are not tested here by design (gate is `isFull()` alone); 08-19's authorization matrix sweeps them.
- The worktree ledger file for `plan_head_before` could not be written (sandbox refused the compound git command); the base is the brief's BASE commit.

## Self-Check: PASSED

- FOUND: all 9 created files
- FOUND: abc6378e, a9999985 (ancestors of HEAD)
