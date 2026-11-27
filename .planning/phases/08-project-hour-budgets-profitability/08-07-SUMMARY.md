---
phase: 08-project-hour-budgets-profitability
plan: 07
subsystem: profitability-billable-enforcement
tags: [profitability, billable, d-05, model-events, console, e2e]
requires: [08-01, 08-02]
provides:
  - "App\\Profitability\\TimeEntries\\EnforceBillableOnBillableProject::handle(TimeEntry): TimeEntry saving listener (D-05), registered once from ProfitabilityServiceProvider::boot via TimeEntry::saving and resolved per event"
  - "App\\Profitability\\TimeEntries\\LegacyNonBillableQuery: byProject(?organizationId, ?now): list<{organization_id, project_id, entries, seconds}> and secondsFor(organizationId, ?projectIds, ?now): int (read-only, one statement each, running entries up to now) for the 08-10 data-quality notice"
  - "php artisan profitability:report-nonbillable [--organization=]: organizations / projects / entries / hours, then `project <id> <entries> <hours>` lines; never writes"
  - "Provider runningInConsole() block with $this->commands([ReportNonBillableCommand::class]) (08-09 appends its renewal command)"
  - "e2e/time.spec.ts and e2e/calendar.spec.ts: one test each now asserts D-05 (fork seam comment, for the 08-19 ledger)"
affects: [08-09, 08-10, 08-19]
requirements-completed: [BUDG-03]
tech-stack:
  added: []
  patterns:
    - "One fork model-event listener instead of edits to core controllers/importers: every write path ends in TimeEntry::save()"
    - "Legacy data reported, never rewritten: the listener acts only on create or on project/billable/type changes"
key-files:
  created:
    - app/Profitability/TimeEntries/EnforceBillableOnBillableProject.php
    - app/Profitability/TimeEntries/LegacyNonBillableQuery.php
    - app/Profitability/Console/ReportNonBillableCommand.php
    - tests/Feature/Profitability/EnforceBillableTest.php
    - tests/Feature/Profitability/ReportNonBillableCommandTest.php
  modified:
    - app/Profitability/ProfitabilityServiceProvider.php
    - e2e/time.spec.ts
    - e2e/calendar.spec.ts
decisions:
  - "The listener checks the project's is_billable before asking BillingContract::canUseBillableRates (the plan listed them the other way round). This keeps the cheapest-first rule with the Billing extension, which may query. It also keeps core tests green that mock BillingContract with shouldNotReceive('canUseBillableRates') (TimeEntryEndpointTest::mockBillingWithoutBillableRateCheck)."
  - "The organization is read with Organization::query()->whereKey(organization_id) instead of the relation, so a stale cached relation never decides the premium lock"
  - "LegacyNonBillableQuery counts imported entries too: the listener leaves imports alone, so they are exactly the violations the report exists to show"
  - "The e2e re-open check asserts both: no 'Non-Billable' combobox (count 0) and a visible 'Billable' combobox. The text filter 'Billable' alone also matches 'Non-Billable'."
metrics:
  duration: "about 45 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
plan_head_before: 22903980c778fa047df4ad311550ca0c3effd31c
plan_head_after: e539f719d2e9ab8e0a2fa8cad7cfc249259006f2
---

# Phase 8 Plan 07: D-05 billable enforcement Summary

A fork `TimeEntry::saving` listener now saves every new or moved work entry on a billable project as billable, with the rate recomputed. This covers the API store, update and bulk update, and the in-process model saves such as the Outlook conversion. Legacy entries are never rewritten. A read-only `profitability:report-nonbillable` command reports them. The two upstream browser tests that asserted the opposite now assert the fork rule.

## What was built

- **`EnforceBillableOnBillableProject::handle()`** forces `billable = true` and calls `setComputedAttributeValue('billable_rate')` only when every condition below holds, checked cheapest first:
  1. the entry is a work entry;
  2. it has a `project_id`;
  3. it is not billable yet;
  4. it is not imported;
  5. the save creates the entry or makes `project_id`, `billable` or `type` dirty;
  6. the project's `is_billable` is true (one `value()` query);
  7. `BillingContract::canUseBillableRates($organization)`.

  The docblock gives the D-05 reason for each condition. Nothing is logged.
- **Provider:** `TimeEntry::saving(static fn => app(EnforceBillableOnBillableProject::class)->handle($entry))`, registered once. A `runningInConsole()` block registers the command. No core PHP file changed.
- **`LegacyNonBillableQuery`:** a join of `time_entries` and `projects` that selects work entries with `billable = false` on projects with `is_billable = true`. Seconds are `coalesce(round(sum(extract(epoch from coalesce("end", now) - "start"))), 0)`, with now bound as a UTC string. It only selects.
- **`ReportNonBillableCommand`:** prints counts, hours (one decimal) and project ids only, and returns `SUCCESS`. The docblock names core bulk edit as the explicit fix path.
- **Tests:**
  - `EnforceBillableTest` (11 tests). Paths: API store tracer; update moving the entry to a billable project; update with `billable: false` overridden; bulk update (move plus `billable: false`); direct model save. Guards: breaks; no project or a non-billable project (model and API); imports; an organization without billable rates. Legacy entries: a description-only edit keeps the entry non-billable, `billable_rate` stays null and `updated_at` moves; saving it with the same `billable: false` and project keeps it non-billable.
  - `ReportNonBillableCommandTest` (4 tests) uses two organizations, legacy, imported and running entries, and billable, non-billable-project and break controls. It checks the exact output lines, a byte-identical snapshot of `id, billable, billable_rate, updated_at` before and after the command, the `--organization` filter and `secondsFor`.
- **e2e:** one test in each file was renamed to "... with a manually chosen Non Billable on a billable project is saved as billable (fork D-05)". Both saves now expect `data.billable` true, and the re-opened modal shows Billable. Each test carries the `// Fork seam (profitability, Phase 8, D-05)` comment. The change is 10+/6- lines per file.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 1488d7fc | feat(08-07): time on billable projects is always billable |
| 2 | 67c63597 | test(08-07): billable enforcement on every path; upstream override tests assert D-05 |
| 3 | e539f719 | feat(08-07): read-only report of legacy non-billable time on billable projects |

## Gates

- **Gate P:** `php -l` passed on every new file. Pint `--test` passed on `app/Profitability` and `tests/Feature/Profitability`; Pint only re-ordered the provider imports. Full-app PHPStan with the worktree-first autoload returned `[OK] No errors`. One earlier run crashed a parallel worker, the transient error 08-02 also saw; the re-runs were clean.
- **Gate E:** `npx prettier --check` passed on both specs. `npx playwright test e2e/time.spec.ts e2e/calendar.spec.ts --list --project=chromium` lists 140 tests, and the "(fork D-05)" name appears 2 times. `npx eslint`: `e2e/time.spec.ts` is clean. `e2e/calendar.spec.ts` reports 4 errors that were already there, at lines 1683, 1688, 2223 and 2256 (`no-explicit-any`, `no-empty`), far from this plan's hunk (lines 166-245). They are out of scope and were not touched.
- **Command listing:** `artisan list profitability --format=json` gives `profitability:report-nonbillable`.
- **SQL:** inspected offline with `toSql`. The select binding (now) comes first, then `work, false, true, org`.
- **DB-free unit tests:** `tests/Unit/Profitability` gave OK (71 tests).
- **Acceptance:**
  - No diff against base on `app/Models/TimeEntry.php`, `TimeEntryController.php` or `app/Service/Import`.
  - `TimeEntry::saving(` appears once in the provider.
  - The listener has the guard count 3.
  - 11 `function test_` in `EnforceBillableTest`.
  - The write-call grep gives 0 for both report files.
  - The fork seam comment appears once per spec.
- **EnforceBillableTest, ReportNonBillableCommandTest:** PENDING CI (orchestrator).
- **The two updated Playwright tests:** PENDING CI (orchestrator, Playwright Tests in the wave gate).

## Core-suite audit (Task 2 step 3)

I looked for core tests that use billable projects with `grep -rln -e "->billable(" -e "is_billable' => true" tests/Unit tests/Feature`, leaving out `tests/Feature/Profitability`. Most stay green:

- `ProjectEndpointTest` (lines 242-273, 740-749, 1630-1790): project endpoints only. The one entry it creates (about line 1758) is `billable: true`. **Green.**
- `PublicReportEndpointTest` (lines 268, 348): `->billable()` is on the time entry, and the projects are not billable. **Green.**
- `GoalProgressServiceTest:415`: a billable entry with no project. **Green.**
- `OutlookMeetingConversionTest::test_billable_rate_and_lock_match_a_manual_entry`: sends `billable: true`. **Green.**
- `TimeEntryEndpointTest`:
  - Line 767: the project is not billable. **Green.**
  - Line 2704 (store) and line 3397 (update): both send `billable: true`. **Green.**
  - Lines 5778 and 6118: billable entries on a non-billable task project, converted to breaks. **Green.**
  - Line 6188 (break conversion): `type` becomes break, which the listener skips. **Green.**
  - Lines 6294-6374: entries without a project. **Green.**
  - Line 6403 (`test_time_entry_update_with_project_change_does_not_make_time_entry_billable_if_organization_can_not_use_billable_rates`): runs without billable rates, so core's lock wins and the listener returns. **Green.**
  - The `mockBillingWithoutBillableRateCheck` tests (`shouldNotReceive('canUseBillableRates')`): entries without a project, or description-only edits. The listener returns before the billing contract is asked. **Green.**
- The other Profitability feature tests (08-01..08-05) create billable projects but never assert an entry's billable flag. Consumption counts work time whatever the flag. **Green.**

**Expected to FAIL because of D-05 (not edited; it is outside this plan's files, for the orchestrator):**

- `Tests\Unit\Endpoint\Api\V1\TimeEntryEndpointTest::test_update_multiple_refreshes_billable_rate_on_updates_time_entries` (about line 4979).
  - Setup: it creates `$timeEntry2` with `->notBillable()` on a billable `$oldProject`, then bulk-moves it to another billable project.
  - What it asserts: `billable` false and `billable_rate` null for `$timeEntry2`.
  - What happens under D-05: the factory save already makes it billable, and the move keeps it billable with the new project's rate.
  - What the test needs: it states upstream behaviour that D-05 deliberately changes. It needs a fork-seam update: expect `billable` true and `billable_rate` = `$project->billable_rate` for both entries, or put `$timeEntry2` on a non-billable project. The 08-RESEARCH interface note listed line ~4986 as staying green; that was wrong.

## Deviations from Plan

- **[Rule 1 - Bug] Check order: the project before the billing contract.** The plan's order asked `canUseBillableRates` before the project lookup. Core tests mock `BillingContract` with `shouldNotReceive('canUseBillableRates')`. Asking the contract for every non-billable entry with a project would break any such test that saves one on a non-billable project. It would also call the Billing extension for entries that never change. Now the contract is asked last. The behaviour is the same. (Commit 1488d7fc.)
- **An extra test, `test_saving_a_legacy_entry_with_its_unchanged_billable_flag_keeps_it_non_billable`.** The edit modal sends `billable: false` and `project_id` back unchanged. This pins that such a save never flips a legacy entry. There are 11 tests in total; the plan asked for at least 10.
- **An extra test, `test_seconds_for_sums_an_organization_and_its_projects`,** in `ReportNonBillableCommandTest`. It covers `secondsFor()`, which 08-10 will call.
- **Optional `?CarbonImmutable $now` arguments** on `byProject` and `secondsFor` (default now). This matches the `ConsumptionQuery` style and keeps running entries testable.
- **Gate E eslint:** the 4 errors in `calendar.spec.ts` (lines 1683+) were already there and are not part of this plan's hunk. I did not fix them (scope boundary).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-21: the listener on the model.
- T-08-22: create or dirty-only, plus the description-only test and the snapshot test.
- T-08-24: the premium lock is asked and tested.
- T-08-SC: no package installs.

The command is read-only and prints ids and counts only.

## Open items

- Feature PHPUnit (`EnforceBillableTest`, `ReportNonBillableCommandTest`) and Playwright (the two renamed tests): PENDING CI (orchestrator).
- `TimeEntryEndpointTest::test_update_multiple_refreshes_billable_rate_on_updates_time_entries` is expected to fail in the wave CI run because of D-05 (see the audit). A core-test update needs an orchestrator decision; it is not in this plan's files.
- 08-19 should ledger the two e2e fork seams (`e2e/time.spec.ts:1817`, `e2e/calendar.spec.ts:166`).

## Self-Check: PASSED

- FOUND: app/Profitability/TimeEntries/EnforceBillableOnBillableProject.php, app/Profitability/TimeEntries/LegacyNonBillableQuery.php, app/Profitability/Console/ReportNonBillableCommand.php, tests/Feature/Profitability/EnforceBillableTest.php, tests/Feature/Profitability/ReportNonBillableCommandTest.php
- FOUND: 1488d7fc, 67c63597, e539f719 (ancestors of HEAD)
