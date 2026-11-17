---
phase: 04-assign-meetings-to-projects
plan: 09
subsystem: release
status: complete
tags: [release, deploy, dokploy, ledger, runbook, ci]
requires:
  - "04-01..04-08 merged, plus the post-merge test-only fixes fbda4b78, d1cfd6a9, 936ba903, 255c03b5"
provides:
  - "Release commit R c693c941 green in all ten workflows (84 Microsoft365 PASS lines)"
  - "Compose pinned to ghcr.io/untanglesl/solidtime:sha-c693c94 (app, scheduler, queue) with the Phase 4 header line"
  - "Ledger reconciled with the real Phase 4 diff; runbook Historial row for the Phase 4 release"
  - "Phase 4 deployed to https://time.untangle.es (2026-11-17, ~15:58 UTC) with outlook_meeting_links migrated"
affects: [phase-04-verification, phase-07]
requirements-completed: [ASGN-01, ASGN-02, ASGN-03, ASGN-04, ASGN-05]
key-files:
  created: []
  modified:
    - docs/m365/TOUCHED-CORE-FILES.md
    - docs/deploy/dokploy-compose.fork.yml
    - docs/m365/RUNBOOK-entra-app.md
decisions:
  - "Release commit R is the ledger reconciliation commit c693c941; the image is pinned by its sha-<7> tag (Dokploy does not re-pull a reused tag)"
  - "The convert route's unauthenticated POST answering 302 to / (core Handler turns the 419 CSRF mismatch into back()) is accepted as a pass: the route exists and is protected, same as POST /m365/meetings/sync"
completed: 2026-11-17
estimate:
  tokens: 40000
actuals:
  tokens: 6000
  tasks: 3
  commits: 3
plan_head_before: 255c03b5b0188325d6b83f073e1fabaa779b9493
plan_head_after: 77678481ba07e19aa55724a3556aa7d7a3cb519b
---

# Phase 4 Plan 09: Release Summary

Phase 4 (assign meetings to projects) shipped to https://time.untangle.es. The image is sha-c693c94, built from the green release commit c693c941. The additive `outlook_meeting_links` migration ran on start. The owner's UAT on real Outlook meetings is queued.

## What was done

- **Ledger reconciliation (D-12).** `git diff --name-only 4678af6e HEAD`, with the fork paths, docs and planning excluded, lists six non-fork paths:
  - `Calendar.vue`
  - `CalendarDayColumn.vue`
  - `FullCalendarEventContent.vue`
  - `FullCalendarEventContent.test.ts`
  - `TimeEntryCalendar.vue`
  - `e2e/outlook-convert.spec.ts`

  The 04-07 rows already covered all six. No hot file appears in the diff, and no core path is left unexplained by a Phase 4 plan. A new "Reconciliation (04-09)" section records the check and the four post-merge test-only fixes. `lang/{en,es}/microsoft365.php` gained 44 keys each, which matches the ledger.
- **Release commit R `c693c941`.** All ten workflows succeeded:
  - Fork - Build image
  - NPM Build
  - NPM Format Check
  - NPM Lint
  - NPM Test Unit
  - NPM Typecheck
  - PHP Linting
  - PHPUnit Tests
  - Playwright Tests
  - Static code analysis (PHPStan)

  The PHPUnit log has **84** Microsoft365 PASS lines. Fork - Build image run 44109684501 produced `sha-c693c94`; the probable digest is `sha256:4d1da676…f29442eb`.
- **What shipped.** The commits from 9c86d06 to R, grouped by plan, are in `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/release-04-commits.txt`. The only commits without a `(04-NN)` tag touch `.planning/` docs or the 03.1-quick compose pin, so no code commit was flagged.
- **Pin.** The three image lines now point to `sha-c693c94`. The header line "Phase 4 (assign meetings to projects): no new variables; image sha-c693c94; AUTO_DB_MIGRATE adds outlook_meeting_links" sits above the 3.1 follow-up line. `sha-9c86d06` now appears only in that 3.1 line.
- **Deploy (orchestrator, Dokploy MCP).**
  - The owner approved with "Aprobado, despliega".
  - The orchestrator replaced the compose content with the file at 47551c74. The Environment tab was not touched.
  - The deploy finished at about 15:58 UTC on 2026-11-17.
  - App log: `2026_11_17_000001_create_outlook_meeting_links_table ... 107.09ms DONE`.
  - The app container is healthy on sha-c693c94. Queue and scheduler are running but report "unhealthy", a known Phase 7 carry-over (they never report healthy). Database and gotenberg did not change.
  - The health check returned 404 for about 30 s during the container swap.
- **Public checks after the deploy:**
  - Health check: 200.
  - Login page: the enabled `microsoft` prop appears exactly once.
  - Unauthenticated JSON GET of `/m365/meetings`: 401.
  - Unauthenticated POST to the convert route: 302 to `/`. This counts as a pass, as explained under Deviations.
  - The Calendar bundle contains `outlook-convert-form`, `outlook-selection-bar` and `outlook-entry-badge`.
- **Runbook.** Added the Historial row "2026-11-17 | Fase 4: asignar reuniones a proyectos publicada (imagen sha-c693c94; sin variables nuevas; migración outlook_meeting_links)". The runbook and secrets docs gates both return OK.

## Commits

| Commit | Subject |
| --- | --- |
| c693c941 | docs(04-09): reconcile the Phase 4 core-touch ledger with the real diff (release commit R) |
| 47551c74 | chore(04-09): pin the compose to sha-c693c94 (Phase 4 release) |
| 77678481 | docs(04-09): record the Phase 4 release in the runbook history |

All three are pushed to origin feature/m365-integration. The orchestrator allowed pushing for this plan only.

## Deviations from Plan

- **Convert-route check.** The plan expects 401 or 419. Production answered 302 to `/`, because core `app/Exceptions/Handler.php:70` turns the 419 CSRF mismatch into `back()`. The existing POST `/m365/meetings/sync` answers the same way. The route is therefore deployed and CSRF-protected (not 404, 200 or 422), and the check is recorded as a pass with this note.
- **Ledger formatting.** `docs/m365/TOUCHED-CORE-FILES.md` already failed `prettier --check` before this plan because of its table style. The new section follows the file's existing style, and I did not reformat the rest of the file.
- **No other deviations.** No core path was left unexplained.

## Owner UAT (pending, end-of-phase human checks)

1. **ASGN-01 / criterion 6:** use "Create time entry" from the hover card, the detail panel and the right-click menu on real meetings. Expected:
   - Subject and times are prefilled.
   - The second conversion proposes the project used first.
   - Enter creates the entry.
   - The meeting leaves the Outlook lane and the entry shows the calendar icon.
2. **ASGN-02:** convert a meeting into a billable project with a rate. It should match a manual entry of the same length in billable rate, project total and reports.
3. **ASGN-03:** quickly double-click "Create entry", and convert the same meeting from two tabs. Exactly one entry should exist, and the second tab should report the meeting as already converted.
4. **ASGN-04:** select three meetings with Ctrl/Cmd-click and Shift-click and assign them, then try a project you cannot add time to. Expected:
   - The bar shows the count.
   - Each meeting gets its own result.
   - Failed meetings stay selected, and Retry works.
5. **ASGN-05:** edit the times of a converted entry, then delete it, then disconnect and reconnect Microsoft and sync the week. Expected:
   - After the edit, the meeting stays converted.
   - After the delete, the meeting comes back to the lane.
   - After reconnecting, meetings that still have entries are not offered again.
6. **Layout at 1366x768, light and dark:** the form stays fully on screen on Friday afternoon and late in the day, the selection bar sits centred over the calendar, and selected meetings are clearly marked.

## Known carry-overs

- The queue and scheduler healthchecks report "unhealthy" (Phase 7).

## Self-Check: PASSED

- docs/m365/TOUCHED-CORE-FILES.md: 1 `outlook-convert.spec.ts` row and the reconciliation section.
- docs/deploy/dokploy-compose.fork.yml:
  - 3 lines with `sha-c693c94`
  - 1 line with `sha-9c86d06`
  - 1 "Phase 4 (assign meetings to projects)" line
- docs/m365/RUNBOOK-entra-app.md: 1 "Fase 4: asignar reuniones a proyectos publicada" row.
- Commits c693c941, 47551c74 and 77678481 are ancestors of HEAD and pushed.
