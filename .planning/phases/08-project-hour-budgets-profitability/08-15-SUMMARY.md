---
phase: 08-project-hour-budgets-profitability
plan: 15
subsystem: profitability-frontend
tags: [profitability, settings, hourly-cost, working-week, chargeability, managers, absence-projects, vitest]
requires:
  - "08-03: GET settings/managers, POST/DELETE settings/projects/{project}/managers[/{member}], POST/DELETE settings/clients/{client}/account-managers[/{member}]"
  - "08-05: GET settings/people, POST/DELETE people/{memberId}/cost-rates[/{rate}] and work-weeks[/{week}], GET/PUT settings/absence-projects"
  - "08-12: ProfitabilityPage view discovery (*View.vue), labels.ts (t, useProfitabilityProps, readQueryParam, replaceQueryParam)"
provides:
  - "settingsApi.ts: types and defensive parsers (parsePeople/parseManagers/parseAbsence), fetchers and writes for every settings endpoint, query hooks usePeopleSettingsQuery/useManagersSettingsQuery/useAbsenceSettingsQuery keyed ['profitability', orgId, 'settings', section], useInvalidateProfitability (invalidates ['profitability', orgId]), validationErrors/firstValidationMessage (422 helper), unitsToCents/hoursToSeconds, pickerDate/firstDayOfCurrentMonth, useSettingsFormat (money/date/hours with org formats)"
  - "SettingsView.vue (data-testid profitability-settings-view): People, Managers and Absence projects cards, space-y-6; rendered by the page only when the server lists `settings`"
  - "PeopleSettingsCard.vue: every member incl. placeholders (Former member badge), role, current cost '/ h', working week, target, since; Not set + amber TriangleAlert with tooltip; Edit {name} ghost Pencil; `?member=<id>` opens that person's dialog"
  - "PersonSettingsDialog.vue: DialogModal 2xl; Hourly cost and Working week/target FieldSets with add rows (DatePicker default first day of month; cost in currency units -> cents; 40 h / 75 % defaults -> seconds/percent), histories newest first, per-row Trash2 delete confirmed by AlertDialog + DangerButton (body / body_no_previous)"
  - "ManagersSettingsCard.vue: account managers per client and project managers per billable project (grouped by client) as chips with remove buttons and a Combobox member picker excluding placeholders and already-assigned members; filter TextInput above 10 rows"
  - "AbsenceProjectsCard.vue: multi-select Combobox of all projects, chips with unmark aria labels, whole-set PUT, empty-state warning"
affects: [08-18, 08-19, 08-20]
requirements-completed: [BUDG-05, BUDG-07, CHRG-01]
tech-stack:
  added: []
  patterns:
    - "Settings writes save immediately (UI-D4) and invalidate the whole ['profitability', orgId] tree; 422 -> message under the add row, any other failure -> common.save_error toast with the typed values kept"
    - "One assignment-table template for both manager sections (section descriptors), one picker open at a time"
key-files:
  created:
    - resources/js/profitability/settingsApi.ts
    - resources/js/profitability/settingsApi.test.ts
    - resources/js/profitability/SettingsView.vue
    - resources/js/profitability/PeopleSettingsCard.vue
    - resources/js/profitability/PeopleSettingsCard.test.ts
    - resources/js/profitability/PersonSettingsDialog.vue
    - resources/js/profitability/PersonSettingsDialog.test.ts
    - resources/js/profitability/ManagersSettingsCard.vue
    - resources/js/profitability/ManagersSettingsCard.test.ts
    - resources/js/profitability/AbsenceProjectsCard.vue
    - resources/js/profitability/AbsenceProjectsCard.test.ts
  modified: []
decisions:
  - "Deep link from the People view: `?view=settings&member=<memberId>` opens that person's dialog (key agreed with 08-18); closing the dialog removes `member` from the URL with replaceState"
  - "Role column shows the core role capitalised (capitalizeFirstLetter, same as the core Members table); the lang file has no role labels"
  - "Target column stays empty while a person has no working week (Not set is shown only in the cost and working-week cells, the two values the UI-SPEC flags)"
  - "Delete confirmation for a cost uses body_no_previous when no row with an earlier effective date exists; the working week has a single body"
  - "Manager and absence 422s (placeholder, non-billable project) get the Save error toast; the picker already excludes placeholders client-side (T-08-46)"
  - "Money falls back to the ISO-code format while the organization query has no currency_format yet, instead of rendering an empty amount"
  - "Absence changes show the new set at once while the PUT runs and fall back to the server set on failure"
metrics:
  duration: "about 40 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 115000
  tasks: 3
actuals:
  tokens: 30600
  tasks: 3
  commits: 3
plan_head_before: 62bad7794274d4f4c82b5fb6e5641584e4a0046f
plan_head_after: 36ab06aa
---

# Phase 8 Plan 15: Settings tab (people, managers, absence projects) Summary

Owner and Admin now get a Settings tab on the Profitability page. It has three cards. **People** lists every member with the hourly cost, working week and target in force today, and flags missing values as "Not set" with an amber icon. **Project and account managers** assigns managers per client and per billable project. **Absence projects** marks the projects whose time counts as absence. Each person opens a dialog with the dated cost history and the dated working week and target history: rows are added one by one and deleted only after a confirmation. The page discovers `SettingsView.vue` by its file name, so `ProfitabilityPage.vue` was not edited.

## What was built

- **settingsApi.ts**:
  - Typed parsers for the people, managers and absence payloads. Malformed rows are dropped, and histories are re-sorted newest first.
  - Fetchers and writes for all eleven endpoints of 08-03 and 08-05.
  - Query hooks under `['profitability', orgId, 'settings', section]`. After every write, `useInvalidateProfitability()` refetches the whole `['profitability', orgId]` tree.
  - A 422 helper.
  - Unit conversions: currency units to cents, hours to seconds.
  - DatePicker helpers: the picked local date, and the first day of the current month.
  - `useSettingsFormat()` for money, dates and hours in the organization's formats.
- **SettingsView.vue**: root `data-testid="profitability-settings-view"`. It mounts People, then Managers, then Absence, stacked with `space-y-6`.
- **PeopleSettingsCard.vue**:
  - Table columns: Person (with the Former member badge for placeholders), Role, Hourly cost, Working week, Target, Since, and a 32 px ghost Pencil button labelled "Edit {name}".
  - "Not set" plus an amber `TriangleAlert` whose tooltip and aria label read "Margins and chargeability are incomplete without this."
  - Loading and error states, with a retry on error.
  - `?member=<id>` opens that person's dialog.
- **PersonSettingsDialog.vue**:
  - Two FieldSets, each with a legend, helper, add row, `FieldError` and a history table.
  - Each add saves at once and shows its own toast (`cost_added`, `work_week_added`). A 422 shows under its own add row. Any other failure shows the Save error toast and keeps the values typed.
  - Every history row has a Trash2 button labelled "Delete hourly cost from {date}" or "Delete working week from {date}". It opens an `AlertDialog` with the UI-SPEC title, body, Keep and `DangerButton` Delete. The DELETE request is sent only after Delete is confirmed.
  - Footer: "Close person settings".
- **ManagersSettingsCard.vue**:
  - Account managers sub-table (Client | chips + picker) and, after a `FieldSeparator`, the Project managers sub-table (Project | Client | chips + picker), each with its helper.
  - The picker is a reka Combobox with a search field. It lists members who are not placeholders and not already assigned to the row.
  - Add and remove save at once with the `manager_added` / `manager_removed` toast. Removal is not confirmed.
  - A "Filter clients and projects" input appears above 10 rows.
- **AbsenceProjectsCard.vue**:
  - Multi-select Combobox "Mark absence project" listing all projects (client name as secondary text).
  - Chips with "Unmark {project} as absence".
  - Every change sends the whole set with a PUT and shows the `absence_updated` toast.
  - Helper text, plus the amber empty-state warning while nothing is marked.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | b968599d | feat(08-15): settings tab with people and hourly costs |
| 2 | b16319be | feat(08-15): working week, target and confirmed deletes |
| 3 | 36ab06aa | feat(08-15): manager assignments and absence projects in settings |

## Gates

- **Gate F (after each task, final run after Task 3):**
  - `npx vitest run resources/js/profitability`: 15 files, 171 tests passed, 0 Vue warnings.
  - Specs added by this plan:
    - settingsApi: 15 tests
    - PeopleSettingsCard: 7
    - PersonSettingsDialog: 14
    - ManagersSettingsCard: 7
    - AbsenceProjectsCard: 6
  - `npx eslint resources/js/profitability`: clean.
  - `npx prettier --check resources/js/profitability`: clean.
  - `npm run type-check` (vue-tsc): exit 0.
  - `npx tsc --noEmit`: exit 0.
- **Tracer gate (Task 1):** verify re-run green before expanding.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `ls *View.vue` | ProjectsView.vue and SettingsView.vue only |
  | `data-testid="profitability-settings-view"` in SettingsView | 1 |
  | `AlertDialog` in PersonSettingsDialog | 20 (at least 1 required) |
  | `DangerButton` in PersonSettingsDialog | 3 (at least 1 required) |
  | `<ManagersSettingsCard\|<AbsenceProjectsCard` in SettingsView | 2 |

  Vitest's verbose output lists ManagersSettingsCard.test.ts and AbsenceProjectsCard.test.ts as passed.
- No PHP was touched, so Pint, PHPStan and PHPUnit were not run. Playwright for the wave: **PENDING CI (orchestrator)**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Empty money cell before the organization's currency format loads**
- **Found during:** Task 2 (dialog spec)
- **Issue:** `formatCents` returns `undefined` when `currency_format` is missing, so the cost cell rendered " / h" with no amount.
- **Fix:** `useSettingsFormat().money` falls back to `iso-code-before-with-space`.
- **Files modified:** resources/js/profitability/settingsApi.ts
- **Commit:** b16319be

**2. [Coordination] Deep-link key `?member=` instead of `?person=`**
- Task 1 first read `?person=`. Peer 08-18 links "Set in Settings" to `?view=settings&member=<memberId>`, so the card now reads `?member=` (done in b16319be, covered by a spec). **Done as requested by the coordinator.**

### Additions

- Load-error and loading states on all three cards (the same pattern as ProjectsView).
- The managers picker also hides members already assigned to the row.
- A spec checks that the effective date defaults to the first day of the current month.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the client of the 08-03 and 08-05 endpoints:
- T-08-44: the tab exists only when the server lists `settings`, and the endpoints return 404 to everyone else.
- T-08-45: every delete is confirmed first.
- T-08-46: placeholders are excluded from the picker.
- T-08-SC: no package was installed.
- Hourly costs are rendered only inside the Settings components.

## Open items

- 08-18: "Set in Settings" should use `?view=settings&member=<memberId>`. The page keeps the rest of the query string, and the card clears `member` when the dialog closes.
- Playwright / feature tests for the wave: PENDING CI (orchestrator).

## Self-Check: PASSED

- FOUND: all 11 created files
- FOUND: b968599d, b16319be, 36ab06aa (ancestors of HEAD)
