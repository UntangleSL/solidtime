---
phase: 08-project-hour-budgets-profitability
plan: 16
subsystem: profitability-frontend
tags: [profitability, contract-editor, monthly-plan, apply-to, stub-period, projects-view, vitest]
requires:
  - "08-04/08-08: PUT {organization_url}/projects/{project}/contract (apply_to required after start; schedule, start and a one-off's end locked after start)"
  - "08-09: PUT {organization_url}/projects/{project}/periods/{period}/plan (422 on months: plan_sum, period_closed, validation.in)"
  - "08-12: ProjectsView, projectsApi (?contract=without), labels.ts helpers, toolbar Teleport"
  - "08-13: ProjectSummaryCard with the period Select, summaryApi (periods[], ?period=)"
provides:
  - "contractsApi.ts: saveContractTerms, savePlan, useSaveContractTerms, useSavePlan (invalidate ['profitability', orgId]), validationErrors (first message per field of a 422, null otherwise), seconds/cents converters, client mirror of the PeriodCalendar stub proration (isStubStart, stubDays, stubEnd, prorateSeconds, prorateCents), loadExistingTerms (summary + newest full period as template), templatePeriod, nextPeriodStart, projectNameFromCache"
  - "planGridMath.ts: evenSplit (mirror of PlanDistributor::evenSplit) and sumState (equal / under / over with seconds)"
  - "ContractEditor.vue (data-testid profitability-contract-editor): props projectId?, projectName?, mode 'set' | 'edit'; v-model:show; emits saved. Set mode with a project, set mode with the project picker (projectId null), edit mode with apply_to"
  - "PlanGrid.vue (data-testid profitability-plan-grid): props projectId, periodId, projectName?; v-model:show; loads the period through useProjectSummaryQuery(?period=)"
  - "ProjectSummaryCard: Set contract terms (empty state), Plan months and Edit contract terms in the CardTitle actions"
  - "ProjectsView: toolbar and empty-state Set contract terms; row menu Set/Edit contract terms and Plan months"
affects: [08-19, 08-20]
requirements-completed: [BUDG-01, BUDG-04]
tech-stack:
  added: []
  patterns:
    - "Dialogs read the shared prop themselves (labels, organization_url) and are mounted lazily (v-if) by their callers, so pages that never open them make no extra request"
    - "Edit-mode prefill from the summary endpoint: the newest non-stub period carries the contract template"
    - "Project name for the dialog title read from the core ['projects', orgId] query cache, never through the generated API client"
key-files:
  created:
    - resources/js/profitability/contractsApi.ts
    - resources/js/profitability/contractsApi.test.ts
    - resources/js/profitability/ContractEditor.vue
    - resources/js/profitability/ContractEditor.test.ts
    - resources/js/profitability/planGridMath.ts
    - resources/js/profitability/planGridMath.test.ts
    - resources/js/profitability/PlanGrid.vue
    - resources/js/profitability/PlanGrid.test.ts
  modified:
    - resources/js/profitability/ProjectSummaryCard.vue
    - resources/js/profitability/ProjectsView.vue
decisions:
  - "The summary payload has no per-period template (contract budget_seconds/amount_cents). Edit mode takes hours and amount from the newest full (non-stub) period, fetched with ?period= when it is not the default one; the materializer always keeps one period after today and every edit rewrites the upcoming periods, so that period carries the current template"
  - "'Started' is contract.starts_on <= today (browser date). After start: schedule Select disabled, start date shown read-only, a one-off's end date read-only, the stub fieldset hidden (the server applies first-period values only on create or full replace), apply_to always sent"
  - "Apply changes to: the 'this period' radio appears only when a current period exists (paused contracts offer only 'from the next period', which is the default then). Next period start = earliest upcoming period, else the day after the current period"
  - "Rescale notice shows when the current period is included and the entered hours differ from the template hours"
  - "Stub values re-prorate on any change of start, schedule, hours or amount until the user edits one of them (UI-D8); both are sent as first_period_* whenever the stub fieldset is shown"
  - "The project picker lists rows of ?contract=without with can_edit_terms and no schedule, sorted by client then name, searchable by name or client; Save is disabled until a project is chosen"
  - "Row menu label is 'Set contract terms' for a row without terms and 'Edit contract terms' otherwise; both and 'Plan months' are hidden for a closed period"
  - "Default start date for new terms: the 1st of the current month"
  - "Plan grid: values are filled once per opening, so a background refetch never overwrites typing; months after today's month show '—' in Consumed like the card's month table"
metrics:
  duration: "about 50 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 120000
  tasks: 3
actuals:
  tokens: 32700
  tasks: 3
  commits: 4
plan_head_before: 62bad7794274d4f4c82b5fb6e5641584e4a0046f
plan_head_after: c5b22b61712a348cfebdf86c703d0f2d9305f6c0
---

# Phase 8 Plan 16: Contract terms and monthly plan editors Summary

Account managers, Owners and Admins can now set and edit a project's contract terms in the browser, from the Contract card or from the Projects view. The editor prorates a stub first period and keeps the user's edits, and for a started contract it asks whether the change starts with this period or the next. Project managers, Owners and Admins can plan a current or upcoming period month by month, and "Save plan" stays disabled until the months add up to the hours sold.

## What was built

- **contractsApi.ts**
  - `PUT .../projects/{project}/contract` and `PUT .../projects/{project}/periods/{period}/plan` through the global axios (session and XSRF).
  - Two mutations that invalidate `['profitability', orgId]` on success, so the card and the views refetch.
  - `validationErrors()` turns a Laravel 422 into one message per field. It returns null for any other failure, and the caller then shows the save-error toast.
  - Hours are sent as seconds and amounts as cents.
  - A client mirror of `PeriodCalendar` stub proration (round half away from zero, hours to the half hour), so the prefilled first-period values equal what the server would store.
- **ContractEditor.vue** (`DialogModal`, `FieldGroup`):
  - Fields: Service, Schedule, Start date, End date (clearable, with the renewal helper), and Hours and Amount per period. The labels follow the schedule. The amount field shows the organization currency code next to it.
  - First-period stub: legend "First period: 15 – 30 Nov 2026", helper "Prorated to 16 of 30 days", and two editable prefilled fields.
  - Edit mode: shows a spinner while loading, and a load error with Try again. When the contract has started it locks the fields listed under Decisions and shows the two native radios with the rescale notice.
  - Picker mode: a `Combobox` of billable projects without terms, with the "Only billable projects" helper.
  - Footer: "Discard changes" and "Save contract terms". Save is disabled while saving, while loading, or while no project is chosen.
  - A 422 shows a `FieldError` under each field. Messages for fields the form does not show appear above the fields. A transport error shows the save-error toast, and the dialog stays open with its values.
- **planGridMath.ts**:
  - `evenSplit` front-loads extra half hours and puts any sub-step remainder on the last month: (144000, 3) gives [48600, 48600, 46800] and (78000, 2) gives [39600, 38400].
  - `sumState` returns equal, under or over, with the seconds missing or in excess.
- **PlanGrid.vue**:
  - A 4-column grid (Month | Planned 120px NumberField, step 0.5 | Consumed | Difference) inside a `max-h-[min(60vh,32rem)]` scroll box.
  - The heading row sticks to the top. The sum row (`sticky bottom-0`, `aria-live="polite"`) sticks to the bottom and shows the CircleCheck, TriangleAlert or OctagonAlert sum copy.
  - When the months do not add up, "Save plan" is disabled, has a `title`, and the footer shows the reason.
  - Ghost "Split evenly" fills the months without saving.
  - Enter moves to the next month, and focus selects the cell.
  - A 422 shows the server message in the footer and keeps the values. A transport error shows the toast.
- **ProjectSummaryCard.vue**:
  - "Set contract terms" in the editor empty state (with `can_edit_terms`).
  - "Plan months" (`CalendarRange`, with `can_edit_plan`) and "Edit contract terms" (`Pencil`, with `can_edit_terms`) next to the period Select. Both are hidden while the selected period is closed.
- **ProjectsView.vue**:
  - Toolbar `PrimaryButton` `Plus` "Set contract terms" for scopes that can set terms. It is also shown in the editor empty state.
  - The row menu adds Set or Edit contract terms and Plan months, according to the row flags and never for a closed period.
  - Each dialog is keyed per target, so it opens fresh every time.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 4b092662 | feat(08-16): contract terms editor from the project card |
| 2 (RED) | 5a164e49 | test(08-16): even split mirror and plan sum state (RED) |
| 2 | 8b080a57 | feat(08-16): monthly plan editor |
| 3 | c5b22b61 | feat(08-16): edit started contracts and open editors from the projects view |

## Gates

- **Gate F (after each task):**
  - `npx vitest run resources/js/profitability`: 14 files, 171 tests passed, no Vue warnings. New this plan: contractsApi 9, ContractEditor 23, planGridMath 7, PlanGrid 10.
  - `npx eslint resources/js/profitability`: clean.
  - `npx prettier --check resources/js/profitability`: clean.
  - `npm run type-check` (vue-tsc): clean.
  - `npx tsc --noEmit`: clean.
- **Tracer gate (Task 1):** the full verify ran green before expanding (auto mode).
- **TDD (Task 2):** RED failed as expected, because the module did not exist. GREEN: 7 tests passed, including both server split cases.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `data-testid="profitability-contract-editor"` | 1 |
  | `BillableRateInput` in ContractEditor | 0 |
  | `invalidateQueries` in contractsApi | 2 |
  | `data-testid="profitability-plan-grid"` | 1 |
  | `aria-live="polite"` in PlanGrid | 1 |
  | `apply_to` in ContractEditor | 9 |
  | `<ContractEditor` / `<PlanGrid` in ProjectsView | 1 / 1 |
  | `delete` (case-insensitive) in ContractEditor / PlanGrid | 0 / 0 |

- **Playwright and Feature PHPUnit:** none written or changed in this plan. The CI suite on merge is PENDING CI (orchestrator).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The summary carries no contract template for edit-mode prefill**
- **Found during:** Task 3
- **Issue:** `contract` in the summary has no `budget_seconds` or `amount_cents`, and the selected period can be a prorated stub.
- **Fix:** `loadExistingTerms` reads the template from the newest full period, fetching it with `?period=` when needed. No server change was made.
- **Commit:** c5b22b61

**2. [Rule 1 - Bug] `max-width="3xl"` would render narrower than `2xl`**
- **Issue:** core `Modal.vue` maps only sm to 2xl, so `3xl` falls back to DialogContent's `max-w-lg`.
- **Fix:** PlanGrid uses `max-width="2xl"`, the widest width the core modal supports. Core files are untouched.
- **Commit:** 8b080a57

**3. [Rule 3 - Blocking] No project name on the project page**
- **Issue:** the card only receives the project id. Importing the core projects query would pull the generated API client into the fork.
- **Fix:** the name comes from the `['projects', orgId]` query cache that ProjectShow already fills. Without a cached name, the subtitle drops the project part.
- **Commit:** 4b092662

### Interpretations

- The card's "Edit contract terms" button landed with Task 3 (commit c5b22b61), not Task 2, because it needs the editor's `mode` prop. "Plan months" landed with Task 2 as planned.
- `DatePicker` has no disabled state, so a locked date is shown as a read-only box with the formatted date.
- The ProjectsView entry points are covered by specs in `ContractEditor.test.ts` (which mounts ProjectsView). This keeps `ProjectsView.test.ts`, which is outside this plan's files, untouched.
- The card buttons are covered in `ContractEditor.test.ts` and `PlanGrid.test.ts` rather than in `ProjectSummaryCard.test.ts`, for the same reason. The verify command still runs `ProjectSummaryCard.test.ts`, and it passes unchanged.

## Known Stubs

None.

## Threat Flags

None beyond the register:
- T-08-41: the buttons are rendered only from `can_edit_terms` / `can_edit_plan` and only for non-closed periods (Vitest), and the server still answers 404.
- T-08-42: the client sum gate is a convenience only; a server 422 is shown in the footer.
- T-08-43: the global axios sends the XSRF token.
- T-08-SC: no packages installed.

## Open items

- Backstop for 08-20: a 12-month plan grid on a 768px-tall viewport should scroll inside the dialog with the sum row visible. The grid box is capped at `min(60vh, 32rem)` with sticky heading and sum rows.
- "Started" uses the browser date. Within a day of the start, it can differ from the server's Europe/Madrid date. If that happens, the server's 422 on `apply_to` or `schedule` shows under the matching field.
- Product follow-up: extending a running one-off's end date stays locked (08-08 open question), so the editor shows that date read-only.
- Feature PHPUnit and Playwright for the wave: PENDING CI (orchestrator).

## Self-Check: PASSED

- FOUND: contractsApi.ts, contractsApi.test.ts, ContractEditor.vue, ContractEditor.test.ts, planGridMath.ts, planGridMath.test.ts, PlanGrid.vue, PlanGrid.test.ts, ProjectSummaryCard.vue, ProjectsView.vue
- FOUND: 4b092662, 5a164e49, 8b080a57, c5b22b61 (ancestors of HEAD)
