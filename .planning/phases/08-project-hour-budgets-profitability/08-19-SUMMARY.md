---
phase: 08-project-hour-budgets-profitability
plan: 19
subsystem: profitability-verification
tags: [profitability, authorization-matrix, money-redaction, e2e, isolation, ledger, mergeability]
status: complete
requires:
  - "08-01..08-18: every profitability route, the shared prop, the project card, the Profitability page and its four views"
provides:
  - "tests/Feature/Profitability/AuthorizationMatrixTest.php: 19 routes x 7 scopes with exact statuses, route canary, money-key scans, enabled-false props"
  - "tests/Unit/Profitability/ProfitabilityIsolationTest.php: four static fork-isolation canaries"
  - "e2e/profitability-contract.spec.ts (3 tests) and e2e/profitability-access.spec.ts (2 tests)"
  - "docs/m365/TOUCHED-CORE-FILES.md: Phase 8 section; ledger-check OK"
affects: [08-20]
requirements-completed: [BUDG-06, BUDG-07, BUDG-01, BUDG-04, CHRG-03]
completed: 2026-11-27
tech-stack:
  added: []
  patterns:
    - "Matrix requests run in a DB savepoint (DB::beginTransaction / rollBack) so one scope's write never changes the next scope's expectation"
    - "Fork web writes from Playwright use the page session plus the XSRF-TOKEN cookie, not the API token"
key-files:
  created:
    - tests/Feature/Profitability/AuthorizationMatrixTest.php
    - tests/Unit/Profitability/ProfitabilityIsolationTest.php
    - e2e/profitability-contract.spec.ts
    - e2e/profitability-access.spec.ts
  modified:
    - docs/m365/TOUCHED-CORE-FILES.md
decisions:
  - "The foreign Owner points its current organization at the tested one (as PageAccessTest does): only that makes the organization-less page route a cross-organization probe. Routes with an organization in the URL answer from the route organization either way."
  - "The 08-09 edge case (a contract created while its project is archived back-fills from starts_on on un-archive) is noted as an open product question, not pinned by a test."
metrics:
  duration: "~1h"
  tasks: 3
  files: 5
estimate:
  tokens: 110000
actuals:
  tokens: 14600
  tasks: 3
  commits: 3
plan_head_before: 29f1663ef34228c849922addf9ff6879f3f9a76a
plan_head_after: 1fbeacc206d6c3fe10d0719ff358f87ab480b415
---

# Phase 8 Plan 19: Authorization matrix, browser proofs, isolation canaries and ledger Summary

This plan checks the whole phase before the release. A matrix sends all 19 profitability routes as 7 different callers and asserts the exact status for each, with a route canary and money-key scans. Two Playwright specs cover the contract workflow and access with money redaction. A static test proves the fork is isolated from core. The Phase 8 ledger section is written, and the ledger check passes.

## What was built

**Task 1: `AuthorizationMatrixTest` (tracer)**
- The fixture has one organization. Client A has billable project PA under a quarterly contract from 2026-07-01, so with today pinned at 2026-11-18 Oct-Dec is the current period. PA also has periods, months, time entries and cost rates. Client B has billable project PB under a monthly contract. The fixture also has a Holidays absence project, a cost rate and a working week for the settings routes, and the seven callers: owner, admin, account manager of A, project manager of PA, employee, core manager, and the Owner of another organization.
- `MATRIX` maps each route to its method, its route parameters (by fixture key; `{memberId}` is never `{member}`), its body and the expected status per scope. The expectations are the plan's interface section, unchanged. Every write sends a valid body: the started-contract edit with `apply_to`, a 60/40/20 plan that sums to 120 h, and so on. Validation therefore never answers before the scope check.
- `test_every_route_answers_as_the_matrix_says_for_every_scope` sends 133 requests. Each runs as the caller inside a rolled-back savepoint. Each assertion message names the route, the scope and the body. Beyond the status, it checks:
  - the summary of PA has `data.period.amount_cents` exactly for owner, admin and the account manager;
  - `meta.money_rows > 0` in the projects view exactly for those three scopes;
  - no answer to the account manager or the project manager contains an id of PB or client B.
- `test_every_profitability_route_is_in_the_matrix`: the sorted route names of `App\Profitability\Http\Controllers\*` equal the MATRIX keys. There are 19 of them, and every row names all seven scopes in order.
- `test_project_manager_never_receives_a_money_key`: every 2xx JSON answer the project manager gets runs through the recursive `/(amount|cost|margin|revenue|cents)/i` key scan. So does the shared prop on the dashboard, on `projects.show` of PA and on the Profitability page. The scanned set is asserted (page, summary, projects view), so the test cannot pass with nothing scanned.
- `test_unassigned_callers_get_only_enabled_false`: for the employee and the core manager, the dashboard and project-page props are exactly `['enabled' => false]`. The Profitability page is a plain 404 that is not an Inertia page, so it renders no prop at all. The test asserts the 404 and that no organization URL appears in it.
- Route canary run against `artisan route:list --path=profitability`: `19 0`, meaning 19 routes and none missing from the test.

**Task 2: Playwright**
- `profitability-contract.spec.ts`:
  - **Monthly terms.** The Owner sets monthly terms from the card: Renews monthly, start on the 1st, 40 h, 3000. The test checks the PUT body (`starts_on` is the first of the month, 144000 s, 300000 cents). The card then shows `40 h` sold and `1 h` consumed.
  - **Uneven quarter.** The quarterly terms are set through the web route with the session and the XSRF token. In the plan grid, 60/40/10 shows "10 h left to distribute" and Save plan stays disabled. Changing the last month to 20 enables it. After saving, the month table shows 60 h, 40 h and 20 h.
  - **Projects tab.** The project appears in the Profitability Projects tab, reached from the sidebar item, with its status pill.
- `profitability-access.spec.ts`:
  - **Unassigned employee.** There is no Profitability item, and `/profitability` answers 404.
  - **Employee made project manager.** The Owner makes the employee project manager from Settings > Project managers. The employee then sees the item and only the Projects tab. The projects table shows the hours and no "Amount", "Cost", "Margin" or currency symbol, and the money KPI block is absent. On the project page, the card shows `40 h` sold, no "Amount sold" and no money tiles.
- Gate E: eslint clean, prettier clean, `--list` gives 5 tests in 2 files.

**Task 3: isolation canaries and ledger**
- `ProfitabilityIsolationTest` has four tests:
  - Outside `app/Profitability/`, no PHP file in `app/` references `App\Profitability`, in code or in a string. `config/app.php` names the provider exactly twice (the `use` line and the providers entry). The scan saw at least 40 module files.
  - `routes/web.php` and `routes/api.php` do not mention profitab, and `openapi.json` has no `/profitability`.
  - The `Role` cases are still exactly owner, admin, manager, employee and placeholder, and `PermissionStore` mentions neither profitab nor account_manager nor project_manager.
  - The module uses no auditing contract or trait and makes no bare `env(` call.
- `docs/m365/TOUCHED-CORE-FILES.md`: Phase 8 is added to the heading, plus a `## Phase 8` section with:
  - six core files edited: `config/app.php`, `ProjectShow.vue`, `AppLayout.vue`, `e2e/time.spec.ts`, `e2e/calendar.spec.ts`, and `TimeEntryEndpointTest.php` (the orchestrator's D-05 seam `80b2670e`);
  - six new files in core directories;
  - four fork-owned directories;
  - the hot files that were not touched;
  - the reconciliation. `git diff --name-only 5971ab1a HEAD` outside the fork paths lists 12 paths, all ledgered.
- `ledger-check: OK (modified 43, added 725, conflicts 0)` against upstream `d0f5e745`. Before the section, the check reported 3 NOT IN LEDGER and dozens of NOT COVERED.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | `0bbbed8e` | test(08-19): profitability authorization matrix with route canary |
| 2 | `1bbcb4af` | test(08-19): browser proofs of the contract workflow and access |
| 3 | `1fbeacc2` | docs(08-19): Phase 8 ledger and isolation canaries |

## Gates

- Gate P: Pint passes on both new PHP files. Full-app PHPStan (worktree-first autoload) reports no errors.
- Gate U:
  - `ProfitabilityIsolationTest` + `ForkIsolationTest`: OK (6 tests, 199 assertions). The ledger-path canary accepts the new section.
  - The whole `tests/Unit/Profitability` directory: OK (118 tests).
- Gate E: eslint and prettier are clean, and `playwright --list` gives 5 tests.
- Ledger: `ledger-check: OK (modified 43, added 725, conflicts 0)`.
- Feature PHPUnit (`AuthorizationMatrixTest`) and Playwright (both specs): PENDING CI (orchestrator, Playwright Tests in the wave gate). With the two new classes the module has 27 Profitability test classes, which matches the expected 108 PASS lines.

## Deviations from Plan

- **Gate-command form.** The plan's verify used `php artisan route:list`. In a worktree that needs the worktree-first artisan loader (`wt-artisan-a028.php` in the scratchpad). The node canary check also runs from a scratchpad script, because the inline `-e` escaping broke under Git Bash. The checks themselves are the same.
- **Extra assertions in Task 1.** Inside the four planned tests I added money presence per scope on the summary and the projects view, and the client-B leak check for both managers. No test was added beyond the four.
- **The foreign Owner's current organization points at the tested organization** (see decisions). With its own current organization, the page route would show that Owner's own organization, a legitimate 200, so it would not prove anything about cross-organization access.

No expected status was changed: the matrix is the interface table exactly. No production code was changed.

## Known Stubs

None.

## Threat Flags

None. This plan adds tests and docs only (T-08-49 route canary, T-08-50 money scans plus Playwright text checks, T-08-51 Role/PermissionStore pins, T-08-52 ledger, T-08-SC no installs).

## Open items

- **PENDING CI (orchestrator):** feature PHPUnit `AuthorizationMatrixTest` and the Playwright specs `profitability-contract` and `profitability-access`. The matrix could not run locally because there is no Postgres. If a status mismatches in CI, it is a defect to report; do not weaken the expectation.
- **08-09 edge case, noted rather than tested:** a contract created while its project is archived gets no periods. When the project is un-archived, `PeriodCalendar::first()` back-fills periods from `starts_on` and ignores `resume_on`. 08-09 judged this arguably correct, because such a contract never renewed. It is a product decision for the owner. If the owner wants the periods to start at `resume_on` instead, that needs a change to `PeriodCalendar` plus a `RenewalLifecycleTest` case, both outside this plan's files.
- **Playwright date edges:** the e2e dates are computed in UTC and the server uses Europe/Madrid. Within an hour of midnight at a month or quarter boundary, the first-of-month or first-of-quarter date can differ by a day. This is the same edge 08-13 and 08-16 noted.

## Self-Check: PASSED

- FOUND: tests/Feature/Profitability/AuthorizationMatrixTest.php, tests/Unit/Profitability/ProfitabilityIsolationTest.php, e2e/profitability-contract.spec.ts, e2e/profitability-access.spec.ts, docs/m365/TOUCHED-CORE-FILES.md (`## Phase 8` once)
- FOUND commits: 0bbbed8e, 1bbcb4af, 1fbeacc2 (ancestors of HEAD)
- Acceptance greps:
  - `'foreign_owner'`: 9
  - `^## Phase 8`: 1
  - `function test_` in the isolation test: 4
  - `profitability-summary-card` in the contract spec: 2
  - `404` in the access spec: 3
  - ledger lines naming AppLayout, ProjectShow, time.spec and calendar.spec: 2 on origin and 10 now, so +8
