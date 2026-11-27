---
phase: 08-project-hour-budgets-profitability
plan: 06
subsystem: profitability-frontend
tags: [profitability, tracer, vue, project-summary-card, formatters, status-pill, budget-meter, vitest]
requires: [08-01, 08-02]
provides:
  - "resources/js/profitability/format.ts: formatHours(seconds, numberFormat?), formatHoursNumber (bare number for the `:n` placeholder), formatPercent(ratio), formatPp(points), formatMonth(isoDate), formatPeriod(startsOn, endsOn), fill(template, params)"
  - "resources/js/profitability/labels.ts: LabelTree, ProfitabilityView, ProfitabilitySharedProps, useProfitabilityProps() (computed, `{enabled:false}` when the prop is absent), t(labels, dottedPath, params?) (returns the path when the key is missing)"
  - "resources/js/profitability/summaryApi.ts: types ProjectSummary/SummaryContract/SummaryPeriod/SummaryMonth, parseProjectSummary, isNotFound, fetchProjectSummary(url, periodId?) (`?period=<id>`), useProjectSummaryQuery(url, projectId, periodId?) with key ['profitability', orgId, 'summary', projectId, periodId|null], no retry on 404, one retry otherwise"
  - "resources/js/profitability/ProjectSummaryCard.vue (props {projectId}; root MainContainer pt-6, data-testid profitability-summary-card): hidden + no request without project.summary_url, hidden on 404, loading (min-h-[160px] spinner), error (common.load_error + ghost Try again -> refetch), empty state (editor/PM body by can_edit_terms), Hours sold / Consumed StatCard strip"
  - "resources/js/profitability/StatusPill.vue (props status, labels): icon + label + UI-D2 tone, tooltip from status_tooltip for on_track/at_risk/over; also handles no_contract (CircleDashed) and unknown statuses (neutral Info)"
  - "resources/js/profitability/BudgetMeter.vue (props soldSeconds, consumedSeconds, projectedSeconds?, status, variant full|compact, closed?, labels, numberFormat?): role=meter with UI-D6 anatomy"
  - "resources/js/Pages/ProjectShow.vue seam: one import + one <ProjectSummaryCard :project-id=\"projectId\" /> between the header MainContainer and the Tasks/Members grid"
affects: [08-12, 08-13, 08-15, 08-16, 08-17, 08-19]
requirements-completed: [CHRG-03, BUDG-03]
tech-stack:
  added: []
  patterns:
    - "Fork web routes through the global axios (session + XSRF); runtime parsers drop invalid values; money keys copied only when present and numeric"
    - "Every visible string via t(labels, path, params) from the shared prop; theme tokens only; numbers tabular-nums"
    - "Stable data-testids for later plans/e2e: profitability-summary-card|loading|error|empty|sold|consumed, profitability-status(+ -tooltip), profitability-meter-track|consumed|over|projected|tick|tick-label"
key-files:
  created:
    - resources/js/profitability/format.ts
    - resources/js/profitability/format.test.ts
    - resources/js/profitability/labels.ts
    - resources/js/profitability/summaryApi.ts
    - resources/js/profitability/summaryApi.test.ts
    - resources/js/profitability/ProjectSummaryCard.vue
    - resources/js/profitability/ProjectSummaryCard.test.ts
    - resources/js/profitability/StatusPill.vue
    - resources/js/profitability/StatusPill.test.ts
    - resources/js/profitability/BudgetMeter.vue
    - resources/js/profitability/BudgetMeter.test.ts
  modified:
    - resources/js/Pages/ProjectShow.vue
decisions:
  - "The organization number format reaches the card through the cached core useOrganizationQuery(getCurrentOrganizationId()) (same key as ProjectShow, no extra request); BudgetMeter takes it as an optional numberFormat prop"
  - "formatHours rounds to one decimal and then lets formatNumber group thousands; without a known number format it falls back to the plain number (formatNumber's default)"
  - "formatPeriod also covers shapes the UI-SPEC does not list: whole months across years 'Dec 2026 – Feb 2027', part months in one year '15 Oct – 30 Nov 2026', a single day '15 Nov 2026'"
  - "A malformed summary payload (no project_id) makes fetchProjectSummary throw, so the card shows its error state (T-08-60)"
  - "BudgetMeter: aria-valuemax/now are decimal hours; for a closed period or a missing projection the projected value equals consumed (valuetext still filled); the budget tick sits at calc(sold% - 1px), the tick label is aria-hidden (valuetext carries the meaning)"
  - "StatusPill with a tooltip gets tabindex=0 so the explanation is reachable by keyboard; pills without an explanation stay non-focusable"
metrics:
  duration: "about 15 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 95000
  tasks: 2
actuals:
  tokens: 13800
  tasks: 2
  commits: 2
plan_head_before: 22903980c778fa047df4ad311550ca0c3effd31c
plan_head_after: 6ed5c10cc975eec9840e5b345594e66827154ca3
---

# Phase 8 Plan 06: Contract card on the project page, formatters, status pill and budget meter Summary

The project page now has a "Contract" card. It appears only when the shared prop carries `project.summary_url`, and it shows the current period's hours sold and consumed from the 08-01 summary endpoint. The card is wired into `ProjectShow.vue` with exactly one import and one element. The plan also adds the shared frontend building blocks for the rest of Phase 8: the UI-D1 formatters, a label helper, the UI-D2 status pill and the UI-D6 budget meter.

## What was built

- **format.ts:** decimal hours (`12.5 h`, `120 h`, `1,240 h`), integer percent (`68 %`), signed percentage points with a real minus (`−7 pp`), `Nov 2026` months, UI-D1 period labels, and `fill()` for `:key` placeholders. An unknown placeholder stays as written, and `:soldier` is never read as `:sold`.
- **labels.ts:** a typed shared prop and `useProfitabilityProps()`. `t()` resolves a dotted path, so a missing key shows its path instead of a blank.
- **summaryApi.ts:** the summary client on the global axios, plus a defensive parser. Money keys are copied only when they are present and numeric, and are never defaulted. The TanStack query is disabled when there is no URL and never retries a 404.
- **ProjectSummaryCard.vue:** states for hidden (no URL), hidden (404), loading (reserves 160 px), error with "Try again", the empty state (editor or PM copy), and the Hours sold / Consumed StatCard strip. Every string goes through `t()`.
- **StatusPill.vue:** seven statuses plus `no_contract`, each with a Lucide 14 px icon and a 12 px/600 label. Colour is applied to text and icon only. `on_track`, `at_risk` and `over` show their `status_tooltip` after 300 ms.
- **BudgetMeter.vue:**
  - The track scales to max(sold, consumed, projected).
  - Consumed is the accent fill.
  - The projected stripe is the 45° accent at 40 % opacity. It is omitted when the period is closed or the projection equals consumed.
  - The budget tick is 2 × 16 px (12 px compact) and carries the "Sold :h" label only when the track is scaled past the hours sold.
  - The over portion is `bg-red-700 dark:bg-red-400`.
  - Widths use the `motion-safe` transition.
  - The meter carries `role="meter"` ARIA with `summary.meter_valuetext`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 5411de37 | feat(08-06): contract card on the project page |
| 2 | 6ed5c10c | feat(08-06): status pill and budget meter |

## Gates

- Vitest `resources/js/profitability`: 5 files, 51 tests passed (format 10, summaryApi 12, ProjectSummaryCard 8, StatusPill 13, BudgetMeter 8).
- ESLint on `resources/js/profitability` and `resources/js/Pages/ProjectShow.vue`: clean. Prettier `--check`: clean.
- `npm run type-check` (vue-tsc): exit 0. `npx tsc --noEmit`: exit 0.
- Tracer feedback gate (auto): Task 1 verify re-run end to end before expanding: green.
- Seam check: `grep -c ProjectSummaryCard resources/js/Pages/ProjectShow.vue` = 2; `git diff --numstat origin/feature/m365-integration -- resources/js/Pages/ProjectShow.vue` = `2 0` (no line removed).
- Acceptance greps:
  - `data-testid="profitability-summary-card"` = 1.
  - `from 'axios'` = 1 and `openapi` = 0 in summaryApi.ts.
  - Hard-coded `'Hours sold'|'Consumed'|'Contract'` = 0 in the card.
  - `role="meter"` = 1.
  - Raw hex = 0 in StatusPill.vue and BudgetMeter.vue.
- No PHP touched (Pint/PHPStan not applicable). Playwright and feature PHPUnit: **PENDING CI (orchestrator)**.

## Deviations from Plan

- **[Rule 2 - Missing critical] Malformed payload goes to the error state.** `fetchProjectSummary` throws when the parser returns null, so the card shows `common.load_error` instead of a half-rendered card (T-08-60). This is covered by a card test and a summaryApi test.
- **[Extra, additive] Extra props and statuses.** `BudgetMeter` has an optional `numberFormat` prop so meters can group thousands like the rest of the app, and `formatHoursNumber` is exported for the `:n` placeholder copy. `StatusPill` also maps `no_contract` (CircleDashed, neutral) and falls back to neutral `Info` for an unknown status.
- **TDD order in Task 1:** the format and summaryApi specs were written and run red first. The `ProjectSummaryCard` spec was written right after the component, in the same task, before any commit. Task 2 specs were run red (missing modules) before the components existed.

Otherwise the plan was executed as written.

## Known Stubs

None that block the plan goal. The card intentionally shows only the Hours sold / Consumed strip and no "Set contract terms" button. 08-13 adds the period select, terms line, full KPI strip, meter, chart and month table, and 08-16 adds the editor button. A contract without a current period (for example one that starts in the future) shows `--` in both tiles until 08-13 adds period selection.

## Threat Flags

None. No new endpoint or trust boundary. The card sends no request without the server-provided URL (T-08-58: Vitest asserts zero axios calls), renders nothing on a 404, and parses defensively (T-08-60). The core seam is one import and one element (T-08-38, ledgered by 08-19). No packages were installed (T-08-SC).

## Open items

- `docs/m365/TOUCHED-CORE-FILES.md` row for `ProjectShow.vue`: owned by 08-19.
- The Playwright/CI run of the merged wave: PENDING CI (orchestrator).

## Self-Check: PASSED

- FOUND: all 11 created files and resources/js/Pages/ProjectShow.vue change
- FOUND: 5411de37, 6ed5c10c (ancestors of HEAD)
