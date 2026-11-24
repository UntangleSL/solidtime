---
phase: 06-out-of-sync-detection
plan: 14
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, toolbar, counter, vue]
requires: [06-03, 06-07]
provides:
  - "OutlookSyncFlagCounter: toolbar button 'N out of sync' (data-testid outlook-out-of-sync, data-count) that calls context.jumpToFirst"
  - "Counter mounted in OutlookCalendarControls: connected, reconnect and browser-test mode with actions"
affects: [06-16, 06-17]
requirements-completed: [OSYNC-02]
completed: 2026-11-24
status: complete
key-files:
  created:
    - resources/js/m365/calendar/OutlookSyncFlagCounter.vue
    - resources/js/m365/calendar/OutlookSyncFlagCounter.test.ts
  modified:
    - resources/js/m365/calendar/OutlookCalendarControls.vue
    - resources/js/m365/calendar/OutlookCalendarControls.test.ts
decisions:
  - "Responsive label: the server copy is split around the number (before / count / after inside one tabular-nums span), so the button text is exactly '2 out of sync' from md and '2' below md, with no duplicated text; when a translation does not contain the number, the count (md:hidden) and the whole label (hidden md:inline) are shown separately"
  - "aria-busy follows context.jumpBusy OR a local flag held from click until jumpToFirst settles, so a second click is ignored even before the composable marks itself busy"
  - "Reconnect branch mounts the counter with v-if=isReconnect: the not-connected branch never shows it, even with a stray list (D-19), on top of the composable serving none"
  - "The counter reads context.outOfSync / jumpBusy with optional chaining, so older hand-made contexts in other tests (without Phase 6 members) render nothing instead of crashing"
metrics:
  duration: "~20 min"
  tasks: 2
  files: 4
estimate:
  tokens: 60000
actuals:
  tokens: 7300
  tasks: 2
  commits: 4
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: 5d4475e452a9367bab247ec653d0a205b983df1f
---

# Phase 6 Plan 14: Toolbar counter "N out of sync" Summary

Toolbar counter that shows the server's whole-window number of flagged entries (amber TriangleAlert, outline sm button) and jumps to the first flagged entry on click, mounted after the sync status and before Confirm N / Sync wherever flags can be resolved.

## What was built

- `OutlookSyncFlagCounter.vue` (no props, injects the Outlook context):
  - Visible only with labels, `canAct` and at least one item in `context.outOfSync` (the read's whole flagged window, not the visible days). Hidden at 0, not disabled.
  - Outline `Button size="sm"` (`h-8 px-2 md:px-3`), `TriangleAlert` `text-amber-700 dark:text-amber-400` (aria-hidden), the count in `tabular-nums` (`outlook-out-of-sync-count`), the words of `countLabel` only from md on.
  - `aria-label` from `countAria` ("2 time entries out of sync with Outlook. Show the first one." / "1 time entry out of sync with Outlook. Show it."), `data-count`, tooltip `osync_count_tooltip` in a 300 ms TooltipProvider (`outlook-out-of-sync-tooltip`).
  - Click calls `context.jumpToFirst()` once; `aria-busy="true"` and further clicks ignored while the jump runs.
- `OutlookCalendarControls.vue`:
  - Connected: `[status] [N out of sync] [Confirm N] [Sync]`.
  - Reconnect: `[status] [N out of sync] [Reconnect]`.
  - Browser-test mode with actions (no calendar prop): `[N out of sync] [Confirm all]`, no Sync / Connect / Reconnect.
  - Not connected: no counter.
- Tests: 11 component tests (`OutlookSyncFlagCounter.test.ts`) and 10 placement tests in `OutlookCalendarControls.test.ts`, 2 of them through the real composable (connected read with `out_of_sync.items` covering weeks outside the visible one, and the `__TEST_SET_OUTLOOK_MEETINGS__` hook with `outOfSync`). The shared `fakeContext` gained `outOfSync`, `jumpBusy` and `jumpToFirst` with empty defaults, so every existing exact-order assertion still holds (the counter renders nothing at 0).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | fa88da93 | test(06-14): failing tests for the 'N out of sync' toolbar counter |
| 1 (GREEN) | b7e43fb1 | feat(06-14): toolbar counter 'N out of sync' that jumps to the first flagged entry |
| 2 (RED) | 6695eccd | test(06-14): failing tests for the out-of-sync counter in the calendar toolbar |
| 2 (GREEN) | 5d4475e4 | feat(06-14): place the out-of-sync counter in the calendar toolbar |

## Gates

- Vitest: `OutlookSyncFlagCounter.test.ts` + `OutlookCalendarControls.test.ts` 73/73 pass; whole `resources/js/m365` suite 29 files / 733 tests pass.
- `vue-tsc --noEmit` exit 0; `tsc --noEmit` exit 0; ESLint clean and Prettier clean on the four files.
- Tracer gate (Task 1): verify re-run end to end before Task 2, passed.
- PHP: not touched (no Pint / PHPStan needed).
- Feature PHPUnit and Playwright: PENDING CI (orchestrator). The cross-week jump in the browser is proven by 06-17 after 06-16 wires the calendar navigator.

## Deviations from Plan

None - plan executed exactly as written. (The worktree was cut from an old upstream commit and was reset to the wave base 7bcb5562 per the brief; `node_modules` and `vendor` junctions to the main checkout were created and are untracked/ignored.)

## TDD Gate Compliance

RED commits (fa88da93, 6695eccd) precede their GREEN commits (b7e43fb1, 5d4475e4); RED failed for the expected reasons (missing component; counter absent from the toolbar), not on syntax.

## Threat model

- T-06-44 (counter while impersonating): mitigated, the counter requires `canAct` and is hidden at 0; tested.
- T-06-SC: no package installs.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookSyncFlagCounter.vue
- FOUND: resources/js/m365/calendar/OutlookSyncFlagCounter.test.ts
- FOUND: fa88da93, b7e43fb1, 6695eccd, 5d4475e4 (ancestors of HEAD)
- `grep -c outlook-out-of-sync OutlookSyncFlagCounter.vue` >= 1, `grep -c jumpToFirst` >= 1, `grep -c OutlookSyncFlagCounter OutlookCalendarControls.vue` = 4
