---
phase: 08-project-hour-budgets-profitability
plan: 17
subsystem: profitability-frontend
tags: [profitability, clients-view, margin-chart, echarts, ranges, account-manager, vitest]
requires:
  - "08-12: ProfitabilityPage view discovery (*View.vue), RangeSelect.vue, labels.ts (initialRange, RangeKey, useViewToolbarTarget), ProjectsView table and state patterns"
  - "08-14: GET {organization_url}/views/clients?range= ({ data: clients with projects[], meta: { range, totals } })"
  - "08-06: StatusPill, format.ts; 08-13: pure ECharts option builder pattern (plannedVsConsumedOption)"
provides:
  - "clientsApi.ts: ClientsView types, parseClientsViewClient/parseClientsView (No client bucket kept, null margin_percent kept), fetchClientsView(organizationUrl, range), useClientsViewQuery(range) keyed ['profitability', orgId, 'clients', range] with keepPreviousData; sortClientRows (No client pinned last), CLIENT_SORT_COLUMNS, DEFAULT_CLIENT_SORT (margin asc), formatMarginPercent, marginPercent"
  - "ClientsView.vue (data-testid profitability-clients-view): Range toolbar teleported into the page header, money KPIs (Amount sold, Cost, Margin, Margin %) and hours KPIs, Margin by client card, sortable client table with expandable project rows"
  - "clientMarginOption.ts: clientMarginOption(input), clientMarginBars, truncateClientName, clientMarginChartHeight, MAX_CLIENT_BARS"
  - "ClientMarginChart.vue (copied ECharts setup, role=img, MarkLine baseline)"
affects: [08-19, 08-20]
requirements-completed: [CHRG-03, BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Pure sort helper with a pinned bucket row, shared by parent and child rows of an expandable CSS-grid table"
    - "Theme colour without a CSS variable read from a hidden probe element (text-red-700 dark:text-red-400), re-read when the theme variables change"
    - "ECharts tooltip strings escaped in the pure builder (client names are user data)"
key-files:
  created:
    - resources/js/profitability/clientsApi.ts
    - resources/js/profitability/clientsApi.test.ts
    - resources/js/profitability/ClientsView.vue
    - resources/js/profitability/ClientsView.test.ts
    - resources/js/profitability/clientMarginOption.ts
    - resources/js/profitability/clientMarginOption.test.ts
    - resources/js/profitability/ClientMarginChart.vue
  modified: []
decisions:
  - "Above 12 clients the chart keeps the 11 clients with the largest margin in absolute value (then sorted by margin descending) and sums the rest into Other clients, drawn last: a plain top 11 by margin would fold the biggest losses into Other"
  - "Table sort is persisted with useTableSortState('profitability-clients-table', margin asc); the No client row stays last in both directions; expanded project rows follow the same column and direction"
  - "When a row has unpriced cost the Margin cell shows Incomplete (amber TriangleAlert, tooltip, aria) and the Margin % cell shows '--'; with unpriced totals both the Margin and Margin % KPI tiles show Incomplete"
  - "Losses: real minus in front of the formatted amount plus the loss colour (08-13 rule); Margin % is an integer with a real minus, '--' when null"
  - "The range caption date is meta.range.capped_to (today when the range contains today); RangeSelect shows it only when contains_today"
  - "The chart counts the No client bucket as a client (labelled No client) for the two-or-more rule"
metrics:
  duration: "about 15 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 85000
  tasks: 2
actuals:
  tokens: 21500
  tasks: 2
  commits: 3
plan_head_before: 62bad7794274d4f4c82b5fb6e5641584e4a0046f
plan_head_after: 0cc34e12595f7b0be740a818358a86801223de62
---

# Phase 8 Plan 17: Clients tab Summary

Owner/Admin and account managers now get a Clients tab on the Profitability page. They pick a range (This month by default, kept in `?range=`) and see Amount sold, Cost, Margin and Margin %, then Hours sold and Hours consumed. A "Margin by client" chart follows, then a client table that lists losses first and expands each client into its projects. The page was not edited: it finds `ClientsView.vue` by its file name.

## What was built

- **clientsApi.ts**
  - Defensive parser for the 08-14 payload. The No client bucket (`client_id` and `name` null) is kept. A client with an id but no name is dropped. A null `margin_percent` stays null. Missing totals are summed from the rows.
  - `fetchClientsView` uses the global axios against `{organization_url}/views/clients?range=`.
  - `useClientsViewQuery(range)` keeps the previous range's figures while the next one loads, and retries once after 300 ms.
  - Pure `sortClientRows`: empty values sort last in both directions, ties go by name, and No client is pinned last.
  - `formatMarginPercent` and `marginPercent` helpers.
- **ClientsView.vue**
  - Toolbar: `RangeSelect` (v-model from `initialRange()`, caption from `meta.range`) plus a 16px refetch spinner, teleported into the header through `useViewToolbarTarget()`.
  - KPI rows from `meta.totals`. Losses use the loss colour and a real minus. Unpriced hours turn the margin tiles into Incomplete.
  - Margin by client card (`CardTitle` with `Coins`), shown only for 2 or more clients.
  - Table columns: Client (name, project count), Hours sold, Hours consumed, Amount sold, Cost, Margin, Margin %, Status (`StatusPill`).
    - A `ChevronRight`/`ChevronDown` toggle carries `aria-expanded` and the Show/Hide projects labels.
    - Project rows are indented 24px, with a colour dot and an Inertia link to the project.
    - The default sort is margin ascending; No client is always the last row.
  - States: spinner on first load, stale data while refetching, a load error card with Try again, and the "No client figures for this range" empty state.
- **clientMarginOption.ts** (pure)
  - Horizontal bars on an inverted category axis, sorted by margin descending, 16px thick.
  - Gains use `rgba(<chart colour>, 0.85)` with the right end rounded 4px. Losses use the loss colour with the left end rounded.
  - Value labels at the bar end are in the secondary text colour.
  - The zero baseline is a 1px `markLine` in `--color-border-secondary`. The x axis is hidden and its extent is padded so the labels fit.
  - Names are truncated at 24 characters, with " *" added when cost is incomplete.
  - Item tooltip with the `money.margin_chart_tooltip` copy plus the incomplete line, HTML-escaped. No legend.
  - Above 12 clients: 11 bars plus Other clients.
- **ClientMarginChart.vue**: the ECharts setup is copied from the core reporting chart, not imported, and also registers `MarkLineComponent`.
  - Theme colours come through `useCssVariable`. The loss colour is read from a hidden probe span.
  - Height is 32px per row plus 48px.
  - `role="img"` with the `money.margin_chart_aria` label for the selected range.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 33ab59b9 | feat(08-17): clients tab with ranges and expandable projects |
| 2 (RED) | f50ecbde | test(08-17): margin by client option builder (RED) |
| 2 | 0cc34e12 | feat(08-17): margin by client chart |

## Gates

- **Gate F:**
  - `npx vitest run resources/js/profitability`: 13 files, 161 tests passed. No Vue warnings in the new specs.
  - New tests: clientsApi 16, ClientsView 11, clientMarginOption 12.
  - `npx eslint resources/js/profitability`: clean.
  - `npx prettier --check resources/js/profitability`: clean.
  - `npm run type-check` (vue-tsc): clean.
  - `npx tsc --noEmit`: clean.
- **Tracer gate (Task 1):** the full Task 1 verify (clientsApi, ClientsView and ProfitabilityPage specs, eslint, prettier, vue-tsc, tsc) passed before Task 2 started.
- **TDD (Task 2):** the RED spec failed because the module did not exist yet (committed f50ecbde). GREEN: 12 tests passed.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `aria-expanded` in ClientsView.vue | 1 |
  | `(08-17)` commits touching ProfitabilityPage.vue | none |
  | `Components/Common/Reporting` in ClientMarginChart.vue | 0 |
  | `<ClientMarginChart` in ClientsView.vue | 1 |

- **Playwright / Feature PHPUnit:** none written or changed in this plan. The wave CI run is PENDING CI (orchestrator).

## Deviations from Plan

### Interpretations

1. **Other clients grouping.** "Top 11" keeps the 11 largest margins in absolute value, not the 11 highest margins, so large losses never disappear into Other clients. The kept bars are then sorted by margin descending, and Other clients is drawn last.
2. **Margin % with incomplete cost.** The row's Margin % cell shows `--`, and the Margin % KPI tile shows Incomplete like the Margin tile. A percentage over partial cost would overstate the margin.
3. **Sortable headers.** The UI-SPEC only gives the default sort (margin ascending). The table also has sortable headers like the Projects view, persisted under `profitability-clients-table`, and No client stays last whatever the sort.
4. **Chart placement.** The chart card sits between the KPI rows and the table, so losses read right after the Margin tile (UI-SPEC focal point).
5. **Page discovery test.** ClientsView.test asserts `viewKeyFromPath('./ClientsView.vue') === 'clients'` and that the real `./*View.vue` glob discovers `clients`.

### Auto-fixed Issues

**1. [Rule 2 - Security] Escaped chart tooltip.** ECharts renders tooltip strings as HTML, and client names are user data. The builder escapes every tooltip line (spec: `<b>` comes out as `&lt;b&gt;`). Commit 0cc34e12.

## Known Stubs

None.

## Threat Flags

None beyond the register:
- T-08-48: the range comes only from the six `RangeSelect` keys (`isRangeKey`), and the server falls back for anything else.
- T-08-64: the tab exists only when the server's `views` lists `clients`, and the page intersects that list with the discovered files.
- T-08-SC: no package installs.

The tooltip escaping above closes a client-side HTML injection path that the register did not list.

## Open items

- Backstop for 08-20: the client margin chart in light and dark, under the Untangle accent and one other preset. The loss colour comes from the probe span, so check that it switches with the theme.
- The worktree plan ledger is `.git/worktrees/agent-aeaf587d0843bd0c8/gsd-plan-head-before-08-17` (= BASE).

## Self-Check: PASSED

- FOUND: all 7 created files
- FOUND: 33ab59b9, f50ecbde, 0cc34e12 (ancestors of HEAD)
