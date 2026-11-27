---
phase: 08-project-hour-budgets-profitability
plan: 13
subsystem: profitability-frontend
tags: [profitability, contract-card, project-page, budget-meter, echarts, money, period-states]
requires:
  - "08-06: ProjectSummaryCard (hidden/404/loading/error/empty states), summaryApi, BudgetMeter, StatusPill, format.ts, labels.ts"
  - "08-08: summary periods[] (newest first) and ?period=<id>"
  - "08-10: period projection fields (still_to_consume_seconds, remaining_plan_seconds, run_rate_seconds, status) and the money block for money scopes"
provides:
  - "summaryApi: SummaryPeriodRef, periods[] on ProjectSummary, projection fields on SummaryPeriod, period money block (amount_cents, revenue_to_date_cents, cost_cents, margin_cents, projected_cost_cents|null, projected_margin_cents|null, unpriced_cost_seconds) read only when 'amount_cents' is present; useProjectSummaryQuery keeps the previous period while a new one loads"
  - "ProjectSummaryCard: period Select, terms line, hours KPIs per period state, money KPI strip, full BudgetMeter with caption and StatusPill, PlannedVsConsumedChart (2+ months), PeriodMonthTable (always)"
  - "plannedVsConsumedOption({ months, currentMonth, colors, labels, compactLabels, formatHours? }): EChartsOption, plus monthDifference(planned, consumed) shared by the chart tooltip, the month table and the closed-period Result"
  - "PlannedVsConsumedChart.vue (copied ECharts setup, role=img) and PeriodMonthTable.vue (props months, currentMonth, labels, numberFormat)"
affects: [08-16, 08-19, 08-20]
requirements-completed: [BUDG-04, CHRG-03, BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Pure ECharts option builder tested without a canvas; the component only reads theme CSS variables and copy"
    - "Money rendered by presence of amount_cents only; the card never decides who sees money"
key-files:
  created:
    - resources/js/profitability/plannedVsConsumedOption.ts
    - resources/js/profitability/plannedVsConsumedOption.test.ts
    - resources/js/profitability/PlannedVsConsumedChart.vue
    - resources/js/profitability/PeriodMonthTable.vue
    - resources/js/profitability/PeriodMonthTable.test.ts
  modified:
    - resources/js/profitability/summaryApi.ts
    - resources/js/profitability/summaryApi.test.ts
    - resources/js/profitability/ProjectSummaryCard.vue
    - resources/js/profitability/ProjectSummaryCard.test.ts
decisions:
  - "Today's month (browser date, YYYY-MM-01) marks the current month row and the bold chart label; months after it show '—' in Consumed. Closed periods end before today and upcoming ones start after, so no row is marked for them"
  - "A difference that rounds to 0.0 h is 'On plan' (table, tooltip and closed-period Result), never '0 h left'"
  - "Closed period money shows Final margin only (margin_cents, the whole amount minus cost once closed); upcoming shows Amount sold and '--' for cost and both margins"
  - "Incomplete replaces the margin tiles only (Margin to date, Projected margin, Final margin); Cost to date stays a number because it is the priced part"
  - "Losses are written with a real minus in front of the formatted amount (−€1,250.00) plus the loss colour, instead of formatCents' '€-1,250.00'"
  - "The status pill is forced to closed / not_started from the period state, otherwise the server status"
  - "Chart labels switch to MMM YY when the measured container is under 640px (useElementSize); width 0 before the first measure keeps MMM YYYY"
metrics:
  duration: "about 15 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 110000
  tasks: 3
actuals:
  tokens: 17500
  tasks: 3
  commits: 4
plan_head_before: 2f87eda4ac676091da6355e30d561c7416e35000
plan_head_after: e68e936a8d49db10c9620fd2d1585962515f2721
---

# Phase 8 Plan 13: Full Contract card Summary

The Contract card on each project page now answers D-02 for any period. It shows the hours sold, consumed, still to consume (or "Over by") and projected at close, with the run-rate caption, a full budget meter and status. A planned-vs-consumed chart and an accessible month table follow. Scopes with money also see amount, cost and margin, and closed, upcoming, over-budget, archived and incomplete-cost periods each get their own rendering.

## What was built

- **summaryApi.ts**
  - Parses `periods[]` into `SummaryPeriodRef`.
  - Parses the projection fields, with derived fallbacks for an older payload: still to consume = sold − consumed, remaining plan = consumed, run rate null, status from the state.
  - Reads the period money block only when `'amount_cents' in` the period. The projected pair keeps an explicit `null`.
  - `useProjectSummaryQuery` adds `placeholderData: keepPreviousData`, so switching periods does not flash the spinner.
- **ProjectSummaryCard.vue**
  - **Period select** in the `CardTitle` actions. Options are newest first, labelled "Nov 2026 · Current". The default is the server's `period.id`, and choosing a period refetches with `?period=`.
  - **Terms line** (13px, `break-words`): service · schedule · Since · Until, plus "Renewal paused (project archived)" for an archived project.
  - **Hours KPIs:**
    - Current period: Hours sold, Consumed, Still to consume (or "Over by" in the over colour), and Projected at close with the run-rate caption or the "not enough data" copy.
    - Closed period: Hours sold, Consumed, and Result ("n h unused", "n h over" or "On plan").
    - Upcoming period: sold hours, with `--` in the other tiles.
  - **Money KPIs** appear only with `amount_cents`:
    - Current period: Amount sold, Cost to date, Margin to date and Projected margin.
    - Closed period: Final margin only.
    - Upcoming period: Amount sold, with `--` in the other tiles.
    - Formatting: `formatCents` with the organization's currency, format, symbol and number format. Losses get a real minus and the loss colour, and a null projected margin shows `--`.
    - When `unpriced_cost_seconds > 0`, the margin tiles show "Incomplete" with the amber `TriangleAlert`, the `money.incomplete_tooltip` tooltip and the `money.incomplete_aria` label.
  - **Meter:** a full `BudgetMeter` with sold, consumed and the remaining-plan projection; `closed` is set for closed periods. The caption row reads "{consumed} of {sold} consumed ({pct})", with the `StatusPill` beside it.
  - **Chart and table:** `PlannedVsConsumedChart` when the period has 2 or more months; `PeriodMonthTable` whenever it has months.
- **plannedVsConsumedOption.ts** (pure):
  - Two bar series on the same slot: consumed in `rgba(<chart colour>, 0.85)` (`barMaxWidth: 32`, 4px top radius, z 2), and planned as a transparent outline with a 2px dashed border in the tertiary text colour (`barGap: '-100%'`, z 3).
  - Hours y axis ("40 h", `splitNumber: 3`). Month labels `MMM YYYY`, or `MMM YY` when compact; the current month uses the bold `rich` style.
  - Grid `{32, 8, 32, 48}`, axis tooltip with a shadow pointer and the `summary.chart_tooltip` copy, legend top-right, Inter 12px. No money.
  - `monthDifference()` is shared with the table and the card.
- **PlannedVsConsumedChart.vue**: the ECharts setup is copied from the core reporting chart, not imported. It reads the theme colours through `useCssVariable`, renders 240px with `autoresize`, and its container has `role="img"` with the `summary.chart_aria` label.
- **PeriodMonthTable.vue**: Month | Planned | Consumed | Difference.
  - "n h left" in the secondary colour, "On plan", or "n h over" in the over colour.
  - Today's month gets a 2px left border and "(this month)"; future months show "—".
  - The Total row is in weight 600, with right-aligned `tabular-nums` numbers.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | a81a594f | feat(08-13): contract card shows the period balance and projection |
| 2 (RED) | 68742af8 | test(08-13): planned versus consumed option and month table (RED) |
| 2 | 0f495a2b | feat(08-13): planned versus consumed chart and month table |
| 3 | e68e936a | feat(08-13): money strip and period states on the contract card |

## Gates

- **Gate F (after each task):**
  - `npx vitest run resources/js/profitability`: 7 files, 86 tests passed.
  - `npx eslint resources/js/profitability`: clean.
  - `npx prettier --check resources/js/profitability`: clean.
  - `npm run type-check` (vue-tsc): clean.
  - `npx tsc --noEmit`: clean.
- **Tracer gate (Task 1):** the full verify ran green again before expanding.
- **TDD (Task 2):** RED failed as expected (the modules did not exist yet). GREEN: 15 tests passed.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `<BudgetMeter` | 1 |
  | `<StatusPill` | 1 |
  | `'amount_cents' in` in summaryApi | 2 |
  | `Components/Common/Reporting` in the chart | 0 |
  | `barGap: '-100%'` | 1 |
  | `role="img"` | 1 |
  | `this_month_suffix` in the table | 1 |
  | `<PlannedVsConsumedChart` | 1 |
  | `<PeriodMonthTable` | 1 |
  | `formatCents` | 2 |

- **Playwright and Feature PHPUnit:** none written or changed in this plan. The CI suite on merge is PENDING CI (orchestrator).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Period money read as one block**
- **Found during:** Task 1.
- **Issue:** copying each money key on its own would let a stray key, without `amount_cents`, put a money tile on screen.
- **Fix:** `copyPeriodMoney` reads no money key unless `amount_cents` is present and numeric. This matches 08-10, which merges the block as a whole (T-08-39).
- **Commit:** a81a594f

**2. [Rule 1 - Bug] `formatCents` returns undefined without a currency format, and writes losses as "€-1,250.00"**
- **Fix:** the card defaults the currency format while the organization loads, formats the magnitude, and puts a real minus in front of it.
- **Commit:** e68e936a

### Interpretations

- `useProjectSummaryQuery` already accepted the period id (08-06). This plan wires it, and adds `keepPreviousData` so a period switch keeps the stale figures on screen (UI-SPEC "Refetch: stale data stays").
- The chart gets an extra optional `formatHours` input so its axis uses the organization number format.
- The table and chart take today's month as `currentMonth`, and work out "future" from it, rather than taking a separate flag.
- The "Plan months" and "Edit contract terms" buttons are not added here. They belong to 08-16, which must hide them for closed periods.

## Known Stubs

None.

## Threat Flags

None. T-08-39: money tiles exist only with `amount_cents`, and Vitest asserts that a project manager payload renders no money tile, no "€", no "Incomplete" and no "Amount sold". T-08-40: the parser drops invalid values, and a malformed payload still lands in the error state.

## Open items

- Backstops for 08-20: the long service text at 375px, and the chart and meter in light and dark under the Untangle preset and one other.
- The current month uses the browser's date. Near midnight at a month boundary, that can differ by a day from the server's profitability timezone (Europe/Madrid). The impact is cosmetic: only which row gets "(this month)".

## Self-Check: PASSED

- FOUND: resources/js/profitability/plannedVsConsumedOption.ts, PlannedVsConsumedChart.vue, PeriodMonthTable.vue, PeriodMonthTable.test.ts, plannedVsConsumedOption.test.ts, summaryApi.ts, ProjectSummaryCard.vue
- FOUND: a81a594f, 68742af8, 0f495a2b, e68e936a (ancestors of HEAD)
