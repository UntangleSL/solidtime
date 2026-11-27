---
phase: 08-project-hour-budgets-profitability
plan: 02
subsystem: profitability-shared-prop-and-copy
tags: [profitability, inertia, shared-prop, lang, i18n, access-scope, octane]
requires: [08-01]
provides:
  - "ShareProfitabilityInertiaData (web group, pushed once from ProfitabilityServiceProvider::boot): shared prop `profitability` = ['enabled' => false] without user, current organization or access; otherwise { enabled, url (url('profitability')), views, labels: { nav } }"
  - "On route projects.show, only when the route project id is a uuid of the current organization and canViewProject: organization_url, project.summary_url (= the profitability.projects.summary route) and the full label tree"
  - "On route profitability (page added by 08-12): organization_url and the full label tree"
  - "Full label tree = every key of trans('profitability', [], 'en') resolved through __() (placeholders left unfilled); `money` group only when hasAnyMoney(), `admin` group only when isFull()"
  - "config/profitability.php: timezone Europe/Madrid, at_risk_threshold 1.10, run_rate_min_weekdays 5, renew_daily_at 04:30 (no env reads)"
  - "lang/en/profitability.php and lang/es/profitability.php: 262 keys each, the single label inventory of Phase 8 (groups nav, page, tabs, common, period_state, schedule, status, status_tooltip, kpi, summary, projects, ranges, clients, contract_editor, plan_editor, validation, toasts, money, admin)"
  - "tests/Unit/Profitability/ProfitabilityLangTest.php (6 tests) and tests/Feature/Profitability/SharedPropTest.php (6 tests)"
affects: [08-03, 08-04, 08-05, 08-06, 08-08, 08-09, 08-12, 08-13, 08-15, 08-16, 08-17, 08-18, 08-19]
requirements-completed: [CHRG-03]
tech-stack:
  added: []
  patterns:
    - "Fork Inertia data shared from a web-group middleware (never from provider boot, Octane), same as Microsoft365/Appearance"
    - "Label key set always comes from the English file; scope decides which groups are resolved"
    - "Placeholder convention: `:n` bare hours number (copy adds the h); `:h`, `:x`, `:sold`, `:consumed`, `:planned`, `:projected`, `:billable`, `:available` formatted hours; `:pct`/`:target` formatted percent"
key-files:
  created:
    - config/profitability.php
    - app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php
    - lang/en/profitability.php
    - lang/es/profitability.php
    - tests/Feature/Profitability/SharedPropTest.php
    - tests/Unit/Profitability/ProfitabilityLangTest.php
  modified:
    - app/Profitability/ProfitabilityServiceProvider.php
decisions:
  - "The middleware reads the current organization with Organization::query()->whereKey($user->current_team_id) (no relation cache on the user object) and checks the projects.show id with Str::isUuid before querying, so a malformed id never reaches PostgreSQL"
  - "summary.meter_valuetext uses formatted hours placeholders (':consumed of :sold consumed, projected :projected, :status') instead of the UI-SPEC's '{consumed} h of {sold} h', so every hours placeholder except :n is a formatted value; the rendered text is the same"
  - "Extra keys beyond the plan's anchor list where the UI-SPEC needs copy without naming a key: status.no_contract, summary.period_option/consumed, clients.project_count_one, contract_editor.project_placeholder, money.columns.amount_sold, money.margin_chart_aria, admin.people.chart_* and columns.*, admin.settings.* table columns, dialog labels, history_empty, managers_filter, admin.toasts.cost_deleted / work_week_deleted"
  - "Copy not given by the UI-SPEC was written in the same plain voice: validation.period_closed, schedule_locked, ends_before_current_period, plan_editor.save_disabled_reason, admin.settings.delete_cost.body_no_previous"
metrics:
  duration: "about 35 min"
  completed: 2026-11-27
status: complete
actuals:
  tokens: 14600
  tasks: 2
  commits: 2
plan_head_before: 5fe90595dbfcf519549f1608b6c9e77540fdad6d
plan_head_after: 1324e16b1690a99d54de5a1701d06f782e5fba9b
---

# Phase 8 Plan 02: Shared profitability prop and en/es copy Summary

The `profitability` Inertia prop is now shared on every page from a web-group middleware. It is scope-gated: no access gives exactly `enabled: false`. On a project the user may view, it adds the summary URL and the label tree. The complete English/Spanish copy of the phase (262 keys) exists under stable keys, with money copy separable by scope.

## What was built

- **`App\Profitability\Http\Middleware\ShareProfitabilityInertiaData`**: the closure is lazy and Octane-safe, and the provider's `boot(Router $router)` pushes it once to the `web` group.
  - No user, no current organization or no scope: `['enabled' => false]`.
  - Any page with a scope: `enabled`, `url`, `views` and `labels.nav`.
  - `projects.show`: for a uuid project of the current organization that `canViewProject` allows, it also adds `organization_url`, `project.summary_url` and the full label tree.
  - `profitability`: it adds `organization_url` and the full label tree.
  - The `money` group is dropped unless `hasAnyMoney()`, and the `admin` group unless `isFull()`.
- **`config/profitability.php`**: plain values, no `env()`.
- **`lang/en|es/profitability.php`**: every UI-SPEC string, including the Copywriting Contract, accessible names, column headers, KPI captions, chart legends and tooltips, dialog fields, helpers, confirmations, toasts and validation messages. UI-SPEC `{name}` placeholders became `:name`. Every key whose name mentions amount, cost, margin, revenue or cents sits under `money.` or `admin.`.
- **Tests**:
  - `ProfitabilityLangTest` covers parity, no empty value, the anchors (Profitability/Rentabilidad, `app.locale` = en), matching placeholders, money-key placement, and inventory completeness (at least 180 keys plus every anchor path).
  - `SharedPropTest` covers: the employee gets only `enabled` false; the owner's dashboard prop has the exact shape; the owner on a project page gets the summary URL (equal to the named route) and the full tree with money; a project of another organization gets no block; no money key appears in the employee prop; a malformed project id gets no block.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 5f0757ae | feat(08-02): scope-gated profitability prop with the summary URL |
| 2 | 1324e16b | feat(08-02): complete profitability copy in English and Spanish |

## Gates

- Gate P: `php -l` passed on all files. Pint `--test` passed on config, lang, `app/Profitability`, `tests/Feature/Profitability` and `tests/Unit/Profitability`. Full-app PHPStan reported `[OK] No errors` with the worktree-first autoload file. The first run crashed a parallel worker (a transient PHPStan error); the re-run and the final run were clean.
- Gate U: `ProfitabilityLangTest` gave `OK (6 tests, 1333 assertions)`. In this worktree it needs the worktree-first PHPUnit bootstrap: without it, `Tests\TestCase` resolves `lang_path()` to the main checkout, which does not have the file yet. That is a worktree-only artefact; CI uses a plain checkout.
- A scratch reflection check of the middleware's label tree also passed (not committed). It confirmed that a PM scope gets no `money`/`admin` groups, an AM scope gets `money` but not `admin`, and the full scope gets both, with the English file's key order.
- Plan greps: the middleware is pushed exactly once, `Inertia::share('profitability'` appears once, and the provider has no `Inertia::share`. `config/profitability.php` has 0 `env(`. There are 6 test functions in each test class.
- `SharedPropTest` (feature, Postgres): **PENDING CI (orchestrator)**.

## Deviations from Plan

- **[Rule 2 - Missing critical] A uuid check before the project lookup.** The `projects.show` route is a closure with a plain string id. A non-uuid id would make PostgreSQL throw on the uuid column, and every project page with such a URL would fail with a 500. The middleware now returns no project block for a non-uuid id, and a sixth feature test covers it. (Task 1, commit 5f0757ae.)
- I added a sixth test, `test_a_malformed_project_id_on_the_project_page_adds_no_project_block`, on top of the five the plan named. The acceptance criterion is "at least 5".
- The placeholder wording of `summary.meter_valuetext` changed (see decisions). The rendered text is unchanged.

Otherwise the plan was executed as written.

## Known Stubs

None. The `profitability` route does not exist yet (08-12 adds it), so that branch of the middleware is inert until then. This is by design.

## Threat Flags

None. The prop carries flags, URLs and copy only (T-08-02). The project block is gated on organization and `canViewProject` (T-08-57). No packages were installed (T-08-SC).

## Self-Check: PASSED

- FOUND: config/profitability.php, app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php, lang/en/profitability.php, lang/es/profitability.php, tests/Feature/Profitability/SharedPropTest.php, tests/Unit/Profitability/ProfitabilityLangTest.php
- FOUND: 5f0757ae, 1324e16b (ancestors of HEAD)
