---
phase: 08-project-hour-budgets-profitability
plan: 18
subsystem: profitability-frontend
tags: [profitability, people-view, chargeability, echarts, vitest, owner-admin-only]
requires:
  - "08-11: GET {organization_url}/views/people?range= ({ data: people, meta: { range, team } }), Owner/Admin only"
  - "08-12: ProfitabilityPage view discovery (*View.vue), RangeSelect.vue, labels.ts initialRange/RangeKey/useViewToolbarTarget"
  - "08-06: format.ts (formatPercent, formatPp, formatHours)"
  - "08-13: pure option builder + copied ECharts setup pattern (plannedVsConsumedOption.ts, PlannedVsConsumedChart.vue)"
provides:
  - "peopleApi.ts: PeopleViewRow/PeopleViewRange/PeopleViewTeam/PeopleView types, parsePeopleViewRow, parsePeopleView, fetchPeopleView(organizationUrl, range), usePeopleViewQuery(range) keyed ['profitability', orgId, 'people', range] with keepPreviousData"
  - "PeopleView.vue (data-testid profitability-people-view): People tab discovered by the page; range toolbar teleported into the header; team KPIs; Chargeability vs target chart card; per-person table; empty, loading, refetch and error states"
  - "chargeabilityOption.ts: plottedPeople, chargeabilityChartHeight (32px per row + 48px), escapeHtml, chargeabilityOption (pure)"
  - "ChargeabilityChart.vue: role=img chart with admin.people.chart_aria"
affects: [08-15, 08-19, 08-20]
requirements-completed: [CHRG-02, CHRG-03]
tech-stack:
  added: []
  patterns:
    - "Settings deep link `?view=settings&member=<id>` through an Inertia Link (same page remounts and reads ?view=)"
    - "ECharts HTML tooltips escape user data (person names) before returning the string"
key-files:
  created:
    - resources/js/profitability/peopleApi.ts
    - resources/js/profitability/peopleApi.test.ts
    - resources/js/profitability/PeopleView.vue
    - resources/js/profitability/PeopleView.test.ts
    - resources/js/profitability/chargeabilityOption.ts
    - resources/js/profitability/chargeabilityOption.test.ts
    - resources/js/profitability/ChargeabilityChart.vue
  modified: []
decisions:
  - "A person 'without a working week' is available_seconds === null (no row in force within the range, 08-11). Working week shows weekly_seconds (today's row) and stays empty when null"
  - "Empty state ('No working weeks set' + Go to Settings) when no listed person has a working week, including no rows at all"
  - "The chart plots people with available hours and a ratio (available 0 gives a null ratio and is not plotted); the chart card is hidden when nobody is plottable"
  - "The table keeps the server order (by name); the UI-SPEC sets no sort for People"
  - "Chargeability meter drawn inline (4px track, 2px x 12px target tick, scale max(100 %, value, target)) instead of BudgetMeter, whose over-the-tick red and hours aria text mean 'over budget'; above target is good here"
  - "Status pill drawn inline with the StatusPill look (CircleCheck green / OctagonAlert red) because StatusPill attaches the project tooltip 'Projected to close within the hours sold.' to on_track"
  - "'Set in Settings' and 'Go to Settings' are Inertia Links to `?view=settings` (plus `member=<id>` for a person); the range param is kept"
  - "Scatter target data are [target, categoryIndex] pairs so each tick lands on its person's row on the category y axis"
metrics:
  duration: "about 25 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 85000
  tasks: 2
actuals:
  tokens: 15100
  tasks: 2
  commits: 2
plan_head_before: 62bad7794274d4f4c82b5fb6e5641584e4a0046f
plan_head_after: 566aaf769b3ef88175ae39fec14277f71bd9575d
---

# Phase 8 Plan 18: People tab (chargeability against target) Summary

Owner and Admin now get a People tab on the Profitability page. It shows team chargeability with the weighted target under it, billable, available and absence hours, a "Chargeability vs target" chart and a per-person table, for any of the six ranges. Account and project managers never see it: the page lists the tab only when the server's `views` carries `people` (Owner/Admin only, 08-02/08-11), and the endpoint answers 404 to everyone else.

## What was built

- **peopleApi.ts:** a defensive parser that keeps unknown figures as `null` (never 0), drops an unknown status and reads `meta.range` and `meta.team`. `fetchPeopleView` uses the global axios with `?range=`. `usePeopleViewQuery(range)` is keyed `['profitability', orgId, 'people', range]`, keeps the previous rows on screen while the next range loads, and retries once after 300 ms.
- **PeopleView.vue:**
  - Toolbar: `RangeSelect` (starting from `initialRange()`), teleported into the page header with `useViewToolbarTarget()`. It carries the 16px refetch spinner and the ":range. Figures up to today, :date." caption, which uses `meta.range.capped_to` when the range contains today.
  - KPIs: Team chargeability with "Target n %" under it, then Billable hours, Available hours and Absence hours.
  - Chart card: `CardTitle` "Chargeability vs target" with the `Users` icon.
  - Table columns:
    - Person, with the Former member badge on placeholders.
    - Working week, Available, Absence, Billable and Internal.
    - Chargeability: percent plus a 4px meter with the target tick and `role="meter"`.
    - Target.
    - Gap in pp, in the loss colour below target.
    - Status: On track or Below target, as icon and text.
  - A person without a working week shows "No working week" in Available and Chargeability, with the "Set in Settings" link.
  - Empty state: "No working weeks set" with "Go to Settings".
  - Load error card with "Try again".
- **chargeabilityOption.ts** (pure):
  - Horizontal accent bars, 16px wide in 32px rows, with the first person on top.
  - Value labels "68 %".
  - Target scatter tick: `symbol: 'rect'`, `symbolSize: [2, 16]`, tertiary text colour, drawn above the bar.
  - x axis from 0 to max(100, highest value or target), labelled only at 0 %, 50 % and 100 %.
  - Two-entry legend at the top right (accent square and a thin tick path).
  - Axis tooltip built from the `admin.people.chart_tooltip` copy, HTML-escaped.
  - Names on the y axis cut at 24 characters.
- **ChargeabilityChart.vue:** copies the reporting chart setup without importing it (`BarChart` + `ScatterChart`, colours from `useCssVariable`). Height is 32px per plotted row plus 48px. It is `role="img"` with the `admin.people.chart_aria` label, filled with the selected range.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 7dfe5281 | feat(08-18): people tab with chargeability against target |
| 2 | 566aaf76 | feat(08-18): chargeability vs target chart |

## Gates

- **Gate F (after each task):**
  - Vitest `resources/js/profitability`: 13 files, 151 tests passed. New in this plan: peopleApi 9, PeopleView 9, chargeabilityOption 11. ProfitabilityPage.test, which now also discovers PeopleView.vue, still passes.
  - ESLint `resources/js/profitability`: clean.
  - Prettier `--check resources/js/profitability`: clean.
  - `npm run type-check` (vue-tsc): exit 0.
  - `npx tsc --noEmit`: exit 0.
- **Tracer gate (Task 1):** `<verify>` was re-run end to end before Task 2 and passed.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `data-testid="profitability-people-view"` in PeopleView.vue | 1 |
  | `symbolSize: [2, 16]` in chargeabilityOption.ts | 1 |
  | `Components/Common/Reporting` in ChargeabilityChart.vue | 0 |
  | `<ChargeabilityChart` in PeopleView.vue | 1 |
  | `git log --grep="(08-18)" -- ProfitabilityPage.vue` | empty (page not edited) |

- **Playwright and feature PHPUnit:** none in this plan. The wave run is PENDING CI (orchestrator).

## TDD Gate Compliance

Task 2: `chargeabilityOption.test.ts` was written first and failed because the module did not exist yet. `chargeabilityOption.ts` then made all cases pass. Both files went into the single task commit, as the plan's one-commit-per-task rule asks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] HTML-escaped chart tooltip**
- **Found during:** Task 2
- **Issue:** the ECharts tooltip writes its formatter string as HTML, and the person name is user data.
- **Fix:** `escapeHtml` in chargeabilityOption.ts is applied to the tooltip string, and a spec covers it.
- **Commit:** 566aaf76

**2. [Rule 1 - Correctness] Meter and status pill drawn inline instead of BudgetMeter and StatusPill**
- **Issue:** BudgetMeter marks anything past the tick in red and speaks hours ("x h of y h"). StatusPill gives `on_track` the project tooltip "Projected to close within the hours sold." Both would mislead on chargeability, where being above target is good.
- **Fix:** a 4px meter and a pill inside PeopleView.vue that use the same tokens (accent fill on `bg-quaternary`, `bg-text-primary` tick, green-800/red-700 text with CircleCheck/OctagonAlert). The shared components are untouched; they are outside this plan's files.
- **Commit:** 7dfe5281

### Interpretations

- The "Set in Settings" link points to `?view=settings&member=<id>`. The page reads `?view=` only on mount, so the link is an Inertia Link: the visit remounts the page on the Settings tab. Opening that person's dialog from `member` is up to SettingsView (08-15, a parallel peer); until it reads the param, the link opens the Settings tab.
- `PeopleView.test.ts` stubs ChargeabilityChart. The canvas chart is covered by the option-builder spec, and the light/dark and accent-preset rendering is the 08-20 backstop.

## Known Stubs

None.

## Threat Flags

None beyond the register:
- T-08-47: the tab exists only through the server's `views` and the endpoint 404s for other scopes, so no per-person figure is fetched or rendered for account or project managers.
- T-08-SC: no package installs.

## Open items

- 08-15 (SettingsView, parallel peer): optionally read `?member=<id>` and open that person's dialog. The UI-SPEC "opens Settings with that person's dialog" is half-done until then.
- Visual check of the chart in light and dark under Untangle and one other preset: 08-20 backstop.
- Wave CI (Playwright, feature PHPUnit): PENDING CI (orchestrator).

## Self-Check: PASSED

- FOUND: all 7 created files
- FOUND: 7dfe5281, 566aaf76 (ancestors of HEAD)
