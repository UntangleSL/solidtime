---
phase: 05-smart-meeting-suggestions
plan: 14
subsystem: release
status: complete
tags: [m365, release, ledger, compose, ci]
requires: [05-01, 05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11, 05-12, 05-13]
provides:
  - "docs/m365/TOUCHED-CORE-FILES.md: '## Phase 5 (Smart meeting suggestions)' section reconciled with the real diff from d71c5311"
  - "Release commit R = 0f2d4247, green in all ten workflows (102 Microsoft365 PASS lines)"
  - "docs/deploy/dokploy-compose.fork.yml pinned to ghcr.io/untanglesl/solidtime:sha-0f2d424 with the Phase 5 header line"
  - "Release commit list c693c941..R grouped by plan prefix (outside git: ci-logs/release-05-commits.txt)"
affects: [05-15]
requirements-completed: [RULE-01, RULE-02, RULE-03, RULE-04, RULE-05]
key-files:
  created: []
  modified:
    - docs/m365/TOUCHED-CORE-FILES.md
    - docs/deploy/dokploy-compose.fork.yml
key-decisions:
  - "Pushing was allowed for this plan (explicit orchestrator exception, 04-09 precedent): R was pushed after a no-op pull --rebase, the pin commit was pushed fast-forward without rebasing R"
  - "The only core edit of Phase 5 is the one-line Calendar.vue #toolbar-extra condition (b0412651, 05-11 follow-up); it is recorded in the ledger with its merge note"
  - "The Spanish create_entry shortening (3077bdb3) is recorded as a lang note beside the 46 new keys and the show_dismissed_help rewording"
completed: 2026-11-17
duration: 75min
plan_head_before: 2bb51e9c2be0f3c2daa3e9d9b9d7e393725a74a3
plan_head_after: 95a134a4
estimate:
  tokens: 40000
  tasks: 2
actuals:
  tokens: 2600
  tasks: 2
  commits: 2
---

# Phase 5 Plan 14: Phase 5 release Summary

Core-touch ledger reconciled with the Phase 5 diff, release commit R = `0f2d4247` green in all ten
workflows with 102 Microsoft365 PASS lines, and the compose pinned to `sha-0f2d424`. The deploy is
the orchestrator's step (D-15); nothing was deployed and Dokploy was not touched.

## What was built

### Task 1: ledger, release sha R, what ships

- `docs/m365/TOUCHED-CORE-FILES.md` gains `## Phase 5 (Smart meeting suggestions)` in the Phase 4
  format: Core files edited (one row: `resources/js/Pages/Calendar.vue` line 174, the
  `#toolbar-extra` condition widened to `outlook.calendar.value || outlook.canAct.value`, commit
  `b0412651`), New files inside core directories (none), the lang note (46 keys each,
  `show_dismissed_help` reworded, Spanish `create_entry` shortened), Fork-owned paths, Hot files
  deliberately not touched, and `### Reconciliation (05-14)` with the five post-plan follow-ups
  (`7bee5345`, `b0412651`, `3077bdb3`, `e535b485`, `2bb51e9c`).
- Diff check: `git diff --name-only d71c5311 HEAD` with the fork paths excluded lists exactly
  `e2e/outlook-suggestions.spec.ts`, `resources/js/Pages/Calendar.vue`,
  `resources/js/branding/contrast.test.ts`. All three have a row. The hot files (TimeEntryController,
  TimeEntryStoreRequest, TimeEntry, Project, openapi.json and the rest of the list) are absent from the
  diff; `Calendar.vue` shows only the one-line condition change.
- R = `0f2d42470c3f841eefb63b113dd60d3dd5232120`, pushed to `origin/feature/m365-integration`
  (`2bb51e9c..0f2d4247`).
- CI on R: Fork - Build image=success; NPM Build=success; NPM Format Check=success; NPM Lint=success;
  NPM Test Unit=success; NPM Typecheck=success; PHP Linting=success; PHPUnit Tests=success;
  Playwright Tests=success; Static code analysis (PHPStan)=success. Microsoft365 PASS lines in the
  PHPUnit log: 102 (34 classes x 3 Postgres jobs). The full run on R covers the handed-over wave gates
  of 05-01, 05-05, 05-09 and 05-13 (PHPUnit, PHPStan, Vitest, typecheck, lint, format, build,
  Playwright including `e2e/outlook-suggestions.spec.ts`).
- What ships: `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/release-05-commits.txt`
  lists the 82 commits of `c693c941..0f2d4247` grouped by prefix: (04-09) x3 (docs and the previous
  pin), (05-01)..(05-14), and 21 "other" (10 wave merges that only bring (05-NN) commits, plus
  `.planning/`/`docs/` commits). **Flag: no non-(05-NN) commit changes code.**

### Task 2: compose pin

- `docs/deploy/dokploy-compose.fork.yml`: the three image lines (app, scheduler, queue) now read
  `ghcr.io/untanglesl/solidtime:sha-0f2d424` (the Fork - Build image log for R mentions `sha-0f2d424`);
  new header line above Phase 4: "Phase 5 (smart meeting suggestions): no new variables; image
  sha-0f2d424; AUTO_DB_MIGRATE adds outlook_meeting_links series/signals/prefill columns,
  outlook_meetings attendee columns and outlook_series_settings (migrations 2026_11_18_000001,
  2026_11_18_000002, 2026_11_18_000003)". `sha-c693c94` remains only in the Phase 4 header line.
- Pin commit `95a134a4` pushed fast-forward (`0f2d4247..95a134a4`), R not rebased.

## Hand-off to the orchestrator (D-15)

Deploy `docs/deploy/dokploy-compose.fork.yml` at `95a134a4` (image `sha-0f2d424`), no Environment
changes. Expect migrations `2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links`,
`2026_11_18_000002_add_attendees_to_outlook_meetings` and
`2026_11_18_000003_create_outlook_series_settings_table` as DONE in the app log; rollback target is the
previous compose (`sha-c693c94`). Then 05-15.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | `0f2d4247` | docs(05-14): reconcile the core-touch ledger with the Phase 5 diff (release sha R) |
| 2 | `95a134a4` | chore(05-14): pin the compose to sha-0f2d424 (Phase 5 release) |

Post-plan fixes recorded in the ledger (landed before this plan, by the orchestrator): `7bee5345`
(fix(05-01) distinct Microsoft object id in `OutlookSeriesAssignmentTest`), `b0412651` (fix(05-11)
Calendar.vue `#toolbar-extra` condition), `3077bdb3` (fix(05-10) Spanish `create_entry` 'Crear
registro'), `e535b485` (fix(05-11) Confirm-all popover anchored via `:reference`, reka nested-trigger
bug), `2bb51e9c` (fix(05-10) More actions menu test hook on the inner wrapper).

## Gates

- Docs secrets gate: `secrets: OK (2205 checks)` before both commits.
- Ten-workflow gate and PASS count on R: as above.
- `git status --porcelain -- docs` empty after the pin commit.
- Prettier is not part of the repo's format gate for Markdown (`format:check` covers JS/TS/Vue only);
  the ledger already reported style warnings at the base, so no Markdown reformat was done.

## Deviations from Plan

None - plan executed exactly as written. The one core path (`Calendar.vue`) is explained by the 05-11
follow-up the plan anticipated; no path is unexplained. Push protocol case: pushing allowed.

## Self-Check: PASSED

- `docs/m365/TOUCHED-CORE-FILES.md` contains `## Phase 5 (Smart meeting suggestions)` (1) and
  `outlook-suggestions.spec.ts`.
- `docs/deploy/dokploy-compose.fork.yml`: 3 lines `ghcr.io/untanglesl/solidtime:sha-0f2d424`, 1
  `Phase 5 (smart meeting suggestions)`, 1 `sha-c693c94`.
- Commits `0f2d4247` and `95a134a4` are ancestors of HEAD and on origin.
