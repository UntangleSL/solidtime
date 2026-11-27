---
phase: 08-project-hour-budgets-profitability
plan: 12
subsystem: profitability-frontend
tags: [profitability, page, navigation, projects-view, view-discovery, money-by-row, vitest, inertia]
requires:
  - "08-02: shared prop `profitability` (enabled, url, views, labels.nav; organization_url and full label tree on route `profitability`)"
  - "08-06: labels.ts (t, useProfitabilityProps), format.ts, StatusPill.vue, BudgetMeter.vue"
  - "08-10: GET {organization_url}/views/projects?contract= (rows, meta.total_rows/money_rows/nonbillable_legacy_seconds)"
provides:
  - "GET /profitability (route name `profitability`, web + auth:web + auth.session + verified): ProfitabilityPageController::show renders Inertia `Profitability`, plain 404 without access in the user's current organization"
  - "resources/js/Pages/Profitability.vue -> resources/js/profitability/ProfitabilityPage.vue: header (PageTitle TrendingUp + TabBar) and toolbar slot, body MainContainer pt-6 pb-12 space-y-6"
  - "View discovery: import.meta.glob('./*View.vue', eager) in ProfitabilityPage; `<Name>View.vue` -> view `<name>`; tabs = server views ∩ discovered components in order projects, clients, people, settings; ?view= with replaceState, unknown/forbidden -> first tab. Views are prop-less components (they read the shared prop themselves)"
  - "labels.ts additions: useProfitabilityNav() {visible,title,href,current,icon}; readQueryParam/replaceQueryParam (UI-D13 URL state); VIEW_ORDER, viewKeyFromPath, discoverViews, visibleViews, resolveActiveView; RANGE_KEYS, RangeKey, DEFAULT_RANGE, isRangeKey, initialRange(); PROFITABILITY_TOOLBAR injection key + useViewToolbarTarget() (a view teleports its toolbar into the page header; standalone it renders inline)"
  - "RangeSelect.vue: v-model RangeKey (default this_month), mirrors ?range= with replaceState, props containsToday?/date? for the 12px common.figures_up_to_today caption"
  - "projectsApi.ts: CONTRACT_FILTERS/ContractFilter/isContractFilter, ProjectsViewRow/Meta/View types, parseProjectsViewRow/parseProjectsView (money keys only when present; projected_* null kept), fetchProjectsView(organizationUrl, contract), useProjectsViewQuery(contract) keyed ['profitability', orgId, 'projects', contract] with keepPreviousData"
  - "ProjectsView.vue (data-testid profitability-projects-view): contract filter, hours KPIs, money KPIs/caption, legacy notice, sortable table with money by row, actions menu, all states"
  - "AppLayout seam: one import, one `const profitabilityNav = useProfitabilityNav()`, one NavigationSidebarItem after Goals (8 added lines, 0 removed)"
affects: [08-15, 08-16, 08-17, 08-18, 08-19, 08-20]
requirements-completed: [CHRG-03, BUDG-04, BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Fork page discovered by file name: later views add a `*View.vue` file, the page is never edited"
    - "View toolbar via provide/inject + <Teleport :disabled> into the page header"
    - "Money rendered only from present keys: columns/tiles when some row has `'amount_cents' in row`, empty cells with aria-label Not available on rows without them"
key-files:
  created:
    - app/Profitability/Http/Controllers/ProfitabilityPageController.php
    - tests/Feature/Profitability/PageAccessTest.php
    - resources/js/Pages/Profitability.vue
    - resources/js/profitability/ProfitabilityPage.vue
    - resources/js/profitability/ProfitabilityPage.test.ts
    - resources/js/profitability/RangeSelect.vue
    - resources/js/profitability/projectsApi.ts
    - resources/js/profitability/projectsApi.test.ts
    - resources/js/profitability/ProjectsView.vue
    - resources/js/profitability/ProjectsView.test.ts
  modified:
    - app/Profitability/routes/profitability.php
    - resources/js/Layouts/AppLayout.vue
    - resources/js/profitability/labels.ts
decisions:
  - "The page controller resolves the organization from the user's current_team_id (no route parameter, so no `{member}`/`{organization}` binding); no membership, Employee, core Manager without assignment or Placeholder -> NotFoundHttpException"
  - "Pure helpers (view discovery, URL state, ranges) live in labels.ts, not in `<script>` blocks of the SFCs: plain `tsc --noEmit` only sees the `*.vue` shim's default export, so named exports from a .vue file fail Gate F"
  - "KPI strips sum only rows whose period.state is `current` (08-10 note). Projected margin tile shows `--` unless every current money row has a known projected_margin_cents; both margin tiles show Incomplete (amber TriangleAlert, aria incomplete_aria) when any current money row has unpriced_cost_seconds > 0"
  - "Margin cell per row: Incomplete with tooltip money.incomplete_tooltip when unpriced_cost_seconds > 0, else margin_cents with loss colour when negative"
  - "Rows without contract terms (period null) show empty hours cells and the `no_contract` StatusPill; a closed period passes `closed` to the compact BudgetMeter"
  - "Empty states: 0 rows under Without contract terms or Ended -> 'No projects match this filter.' + Show all (-> All); 0 rows under Active or All -> editor copy when the scope can set terms, PM copy otherwise. 'Can set terms' = some row has can_edit_terms or the label tree carries the `money` group (sent exactly to Owner/Admin and account managers)"
  - "The Without contract terms option is listed only for scopes that can set terms (same signal), or while it is the selected filter"
  - "Row click uses router.visit('/projects/{id}'); the project name is an Inertia Link (keyboard path) with click.stop; the actions cell stops propagation. 'Open project' is the only menu item until 08-16"
  - "Sort state persisted with useTableSortState('profitability-projects-table', {status, desc}); a stored unknown column falls back to status; severity over 4 > at_risk 3 > on_track 2 > not_started 1, closed/no contract last; tie-break by name"
  - "The load error card replaces the view body; the query retries once (300 ms) like the summary card"
metrics:
  duration: "about 45 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 105000
  tasks: 2
actuals:
  tokens: 24800
  tasks: 2
  commits: 2
plan_head_before: 2f87eda4ac676091da6355e30d561c7416e35000
plan_head_after: 8470e334c3803c6cf83e9a5fccf0e2fe7d9d2aec
---

# Phase 8 Plan 12: Profitability page, navigation and the Projects view Summary

Scoped users now get a "Profitability" item after Goals in the sidebar and a `/profitability` page. Everyone else gets no item and a 404. The page builds its tabs from the server's `views` list and the `*View.vue` files it finds in `resources/js/profitability/`, so 08-15, 08-17 and 08-18 add Settings, Clients and People without editing the page. The Projects tab shows hours KPIs, money KPIs where the payload carries money, and a sortable table with the period, a compact meter, the projection, the status and per-row money. It also covers every state: loading, refetch, error, empty, partial and over budget.

## What was built

- **Server:** `ProfitabilityPageController::show` checks the scope of the user's current organization (`hasAnyAccess()`, otherwise 404) and renders `Profitability`. The route `GET /profitability` is in `app/Profitability/routes/profitability.php`; `routes/web.php` is untouched. The 08-02 middleware already adds `organization_url` and the full label tree on this route name.
- **Nav seam:** `useProfitabilityNav()` reads the shared prop: visible = `enabled` and a URL, title from `labels.nav`, href = `profitability.url`, current = the location matches that path, icon `TrendingUp`. `AppLayout.vue` gets one import, one call and one `NavigationSidebarItem` (+8/-0).
- **Page shell:** `ProfitabilityPage.vue` has a header with PageTitle and TabBar on the left and a toolbar slot on the right, then the active view. `?view=` selects a tab, an unknown or forbidden value falls back to the first one, and switching tabs calls `history.replaceState`. The page provides the toolbar element; a view puts its toolbar there with `<Teleport>`, or renders it inline when it is mounted alone.
- **RangeSelect.vue:** the six `ranges.*` options as a v-model, mirrored to `?range=`, with the "Figures up to today" caption. 08-17 and 08-18 start from `initialRange()`.
- **projectsApi.ts:** a defensive parser and a query with `keepPreviousData`, so the old rows stay on screen while a new filter loads.
- **ProjectsView.vue:**
  - Toolbar: the Contract filter (`?contract=`) and a 16 px refetch spinner.
  - KPIs: Hours sold, Hours consumed, Still to consume and Projects at risk (amber icon when above 0).
  - Money strip: Amount sold, Cost to date, Margin to date and Projected margin, plus the "Money totals cover :n of :total" caption.
  - D-05 notice for Owner/Admin.
  - Table: sticky Project column (colour dot, link, client), Period (label, state badge, schedule), Sold, Consumed with a compact meter, Still to consume or "n h over" in red, Projected at close, Status, Amount, Cost, Margin, and an actions menu.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | ad673ded | feat(08-12): Profitability page and navigation with the Projects tab |
| 2 | 8470e334 | feat(08-12): complete projects view with money by row and states |

## Gates

- **Gate P:**
  - `php -l` passed on the controller and the test.
  - Pint `--test` on `app/Profitability` and `tests/Feature/Profitability`: passed.
  - Full-app PHPStan with the worktree-first `--autoload-file`: `[OK] No errors`.
- **Route check** (worktree artisan loader): `GET|HEAD profitability 3`.
- **Core seam:** `git diff --numstat origin/feature/m365-integration` gives `8 0 resources/js/Layouts/AppLayout.vue`, with no `routes/web.php` line.
- **Gate F (after Task 2):**
  - Vitest `resources/js/profitability`: 8 files, 87 tests passed, no Vue warnings. New this plan: ProfitabilityPage 11, projectsApi 11, ProjectsView 14.
  - ESLint: 0 errors. The two warnings are pre-existing `vue/require-default-prop` warnings on AppLayout's own `defineProps`.
  - Prettier `--check`: clean.
  - `npm run type-check` (vue-tsc): exit 0. `npx tsc --noEmit`: exit 0.
- **Acceptance greps:**

  | Check | Result |
  |-------|--------|
  | `useProfitabilityNav` in AppLayout.vue | 2 |
  | `import.meta.glob` in ProfitabilityPage.vue | 1 |
  | `history.replaceState` in ProfitabilityPage.vue | 1 |
  | `function test_` in PageAccessTest | 7 |
  | `useTableSortState('profitability-projects-table'` | 1 |
  | `'amount_cents' in` (ProjectsView 2, projectsApi 2) | 4 |
  | hard-coded copy | 0 |

- **PageAccessTest (feature, Postgres):** PENDING CI (orchestrator). It covers owner and admin, the account manager, the project manager, the employee, a core manager without an assignment, a user whose current organization is one they do not belong to, and a guest redirected to login.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pure helpers moved from SFC `<script>` blocks to labels.ts**
- **Found during:** Task 1, Gate F
- **Issue:** `npx tsc --noEmit` resolves `*.vue` through the shim. It cannot see named exports, so the specs that imported `viewKeyFromPath` and the other helpers from `ProfitabilityPage.vue` failed. vue-tsc passed.
- **Fix:** the view discovery, URL state and range helpers now live in `labels.ts`, a file this plan owns, instead of a new file outside `files_modified`. `ProfitabilityPage.vue` and `RangeSelect.vue` are `<script setup>` only. 08-17 and 08-18 should import `initialRange`/`RangeKey` from `./labels`.
- **Commit:** ad673ded

**2. [Interpretation] Header toolbar through Teleport**
- The UI-SPEC puts each view's toolbar on the right of the page header, but the page discovers its views and does not know their toolbars. The page therefore provides its toolbar element (`PROFITABILITY_TOOLBAR`), and a view teleports into it with `useViewToolbarTarget()`. Teleport is disabled, so the toolbar stays inline, when the view is mounted alone. 08-16, 08-17 and 08-18 can follow the same pattern.

**3. [Interpretation] Empty-state rule**
- An empty Active or All list shows the role copy; an empty Without or Ended list shows the filter copy with "Show all". "Can set terms" uses the presence of the `money` label group when there are no rows (see decisions).

**4. [Extra] Additional specs**
- PageAccessTest has a 7th case: a guest is redirected to login.
- ProfitabilityPage.test.ts also covers the URL-state helpers.

## Known Stubs

None that block the plan goal. The row menu has only "Open project"; 08-16 adds "Edit contract terms", "Plan months" and the toolbar "Set contract terms" button, as the plan states.

## Threat Flags

None beyond the register:
- T-08-36: controller 404 and nav gated on `enabled`.
- T-08-37: no money header, tile or text for a PM payload (Vitest).
- T-08-59: the seam is one import, one call and one element.
- T-08-62: tabs are the intersection of server views and discovered files (Vitest).
- T-08-SC: no installs.

## Open items

- PageAccessTest and the wave's Playwright run: PENDING CI (orchestrator).
- 08-19 ledger rows: `resources/js/Layouts/AppLayout.vue` (re-apply: import `useProfitabilityNav`, `const profitabilityNav = useProfitabilityNav();`, one `NavigationSidebarItem v-if="profitabilityNav.visible"` after Goals) and the new core-directory file `resources/js/Pages/Profitability.vue`.

## Self-Check: PASSED

- FOUND: all 10 created files and 3 modified files
- FOUND: ad673ded, 8470e334 (ancestors of HEAD)
