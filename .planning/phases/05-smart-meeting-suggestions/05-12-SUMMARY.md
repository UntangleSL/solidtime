---
phase: 05-smart-meeting-suggestions
plan: 12
subsystem: m365-calendar-client
status: complete
tags: [m365, outlook, context-menu, series, confirm, vue, a11y]
requires: [05-04, 05-07]
provides:
  - "Meeting context menu: Confirm (project dot + truncated hint) and Edit for pre-assigned meetings"
  - "Meeting context menu: Always ignore this series / Stop ignoring this series / Forget this series"
affects: [05-13]
requirements-completed: [RULE-02, RULE-04, RULE-05]
key-files:
  created: []
  modified:
    - resources/js/m365/calendar/OutlookMeetingContextItems.vue
    - resources/js/m365/calendar/OutlookMeetingContextItems.test.ts
key-decisions:
  - "Confirm and Edit render only for isPreassigned(meeting) with canAct (a faded pre-assigned occurrence falls back to Create time entry); Confirm is disabled while isConfirmPending(id)"
  - "Dismiss and Always ignore share hideAndRefocus(current, leaving, action): the neighbour search skips every block that leaves with the action (all occurrences of the series for ignore), then falls back to the Sync button; with dismissed meetings shown focus stays on the block"
  - "Restore, Stop ignoring and Forget share actAndKeepFocus (focus stays on the block)"
  - "The Confirm item uses gap-3 instead of space-x-3 so the hint's ml-auto is not overridden by the space-x child margin"
  - "Project hint test id is outlook-menu-project-hint (not outlook-menu-confirm-*) so the plan's exact grep count for outlook-menu-confirm stays 1"
completed: 2026-11-17
duration: 15min
plan_head_before: 3424999b3264166b8874f5c341e7468b4f1d5b36
plan_head_after: d47f2bda
estimate:
  tokens: 50000
  tasks: 2
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
---

# Phase 5 Plan 12: Meeting context menu Confirm, Edit and series controls Summary

The meeting context menu confirms or edits a pre-assigned meeting in one step and ignores, un-ignores or forgets a recurring series from the menu. Focus after each action follows a set rule, and none of the new items render without canAct.

## What was built

- **Confirm / Edit (RULE-02, D-03):** for a pre-assigned, non-faded meeting with canAct, the menu shows `Check` "Confirm" with a trailing hint (8px project dot + project name, `ml-auto`, `max-w-32 truncate text-xs text-text-tertiary`) and `Pencil` "Edit" where "Create time entry" used to be. Confirm waits for the menu to close (`afterMenuClosed`) and then calls `context.confirmOne(id)`, which handles the toast, announcement and the block's pending state. While a confirm is pending the item is disabled. Edit opens the form after the menu has closed, the same way Create does.
- **Series controls (RULE-04, RULE-05, D-10, D-11):** after Dismiss/Restore the menu shows `CalendarOff` "Always ignore this series" for a recurring meeting that is not ignored, or `Undo2` "Stop ignoring this series" for an occurrence of an ignored series. A pre-assigned meeting also gets `Unlink` "Forget this series" as the last item. An occurrence that is both dismissed and in an ignored series offers both Restore and Stop ignoring. Single meetings get none of these items.
- **Focus (UI-SPEC section 5):** after Always ignore, focus goes to the next block of the day that is not in the series, else the previous one, else the Sync button. If dismissed meetings are shown, focus stays on the same block. After Stop ignoring or Forget, focus stays on the block. This logic lives in two small shared helpers that Dismiss and Restore now use too.
- **Gating (D-14, T-05-39):** with canAct false (impersonation, display-only test hook), none of Confirm, Edit, ignore, unignore or forget render. Project and subject values are only rendered through text interpolation (T-05-40), and a test checks this for the hint.
- **Tests:** OutlookMeetingContextItems.test.ts went from 19 to 37 tests (item order for plain, pre-assigned, recurring and ignored meetings, icons, the hint's classes and XSS, Confirm/Edit after the menu closes, the pending-disabled state, canAct gating, series action calls, and the six focus cases).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | 3facbd62 | test(05-12): add failing tests for menu Confirm and Edit on pre-assigned meetings |
| 1 (GREEN) | 221bb8a8 | feat(05-12): Confirm and Edit in the meeting context menu for pre-assigned meetings |
| 2 (RED) | 2b2812f3 | test(05-12): add failing tests for the series items of the meeting context menu |
| 2 (GREEN) | d47f2bda | feat(05-12): series controls in the meeting context menu |

## Gates

- Task 1 (tracer) Gate F: vitest on the test file 24/24, `vue-tsc --noEmit` 0, `tsc --noEmit` 0, eslint 0, prettier clean. The tracer gate re-ran verify, it passed, and expansion continued.
- Task 2 Gate F: `vitest run resources/js/m365` 25 files / 514 tests passed, `vue-tsc --noEmit` 0, `tsc --noEmit` 0, `eslint resources/js/m365` 0, `prettier --check resources/js/m365` clean.
- Acceptance greps: outlook-menu-confirm 1, max-w-32 1, outlook-menu-ignore-series 1, outlook-menu-unignore-series 1, outlook-menu-forget-series 1. `git status --porcelain -- resources/js/m365` is empty.

## Deviations from Plan

### Auto-fixed / additions

1. **[Rule 2 - Correctness] Confirm disabled while pending.** The plan did not list this. `confirmOne` already ignores a second activation, but a silently ignored menu item is confusing, so the item is now `:disabled` when `isConfirmPending(id)` is true. Covered by a test.
2. **[Rule 1 - Bug] Neighbour focus after ignoring a series.** If the plain Dismiss rule were reused unchanged, focus could land on another occurrence of the same series in the same day lane, which leaves the lane at the same moment. The neighbour search now skips every block that leaves with the action. Covered by a test.
3. **Interpretation: "the unignore item rendered with the faded text style".** UI-SPEC section 4 says "Ignored (shown faded)", which describes the meeting's state, not how the menu item looks. The item uses the normal menu item style, like Restore, so it keeps full text contrast.
4. **Test-id naming.** The project hint uses `outlook-menu-project-hint`, so the plan's `grep -c "outlook-menu-confirm"` still prints 1.

## Known Stubs

None.

## Open items

- Browser proof (Shift+F10 keyboard path, real reka focus return) is in 05-13 / CI, as the plan specified.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookMeetingContextItems.vue
- FOUND: resources/js/m365/calendar/OutlookMeetingContextItems.test.ts
- FOUND commits: 3facbd62, 221bb8a8, 2b2812f3, d47f2bda (all ancestors of HEAD)
