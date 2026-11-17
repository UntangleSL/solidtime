---
phase: 05-smart-meeting-suggestions
plan: 11
subsystem: m365-calendar-client
status: complete
tags: [m365, outlook, bulk-confirm, toolbar, vue, typescript]
requires: [05-04, 05-07]
provides:
  - "OutlookConfirmAll.vue: toolbar button 'Confirm N pre-assigned' + bulk-confirm popover (outlook-confirm-all, outlook-confirm-all-popover, outlook-confirm-row, outlook-confirm-submit, outlook-confirm-retry, outlook-confirm-close)"
  - "OutlookAssignResults optional props: checked + toggle event, checkDisabled, project (dot + name + Upcoming), rowTestid, listClass"
  - "OutlookCalendarControls renders the button right before Sync while connected, and alone when there is no calendar prop but canAct is true (test-hook mode with actions)"
affects: [05-13, 05-14]
requirements-completed: [RULE-02]
key-files:
  created:
    - resources/js/m365/calendar/OutlookConfirmAll.vue
    - resources/js/m365/calendar/OutlookConfirmAll.test.ts
  modified:
    - resources/js/m365/calendar/OutlookAssignResults.vue
    - resources/js/m365/calendar/OutlookAssignResults.test.ts
    - resources/js/m365/calendar/OutlookCalendarControls.vue
    - resources/js/m365/calendar/OutlookCalendarControls.test.ts
key-decisions:
  - "Rendered-only count: candidates = context.preassignedInRange filtered to ids with a [data-ghost-id] block inside the .fc root. A MutationObserver watches that root (the body until it exists), and a post-flush watcher rescans after preassignedInRange changes, so hidden weekends and the other days of a day view never count (the 05-07 note)"
  - "While the popover is open the button stays mounted (it anchors the popover) and its label shows the snapshot count; the live count is used again once it closes"
  - "'Idle' (auto-close when the count drops to 0) means no request running AND no result view. A result view stays open so the failure reasons are not lost"
  - "Include checkboxes are disabled while submitting (spec) and also in the result view, because Retry re-sends only the failed rows and ticking another row there would do nothing"
  - "Full success closes the popover with one toast (created_success for 1, batch_success_many otherwise) and one announcement. Partial failure shows the summary (batch_summary with total = rows sent, or batch_none), focuses it and announces it"
completed: 2026-11-17
duration: 20min
actuals:
  tokens: 16500
  tasks: 2
  commits: 2
plan_head_before: 3424999b3264166b8874f5c341e7468b4f1d5b36
plan_head_after: f36806c89bd5bcf1b07c58f1f42d96cc9b6ba6e8
---

# Phase 5 Plan 11: Confirm all pre-assigned meetings in view Summary

The toolbar now has a "Confirm N pre-assigned" button, placed right before Sync. It counts only pre-assigned meetings whose blocks are rendered. Its popover lists them with include checkboxes, sends only the ticked ones through `context.confirmPreassigned`, and shows the Phase 4 per-row results with retry.

## What was built

- **OutlookConfirmAll.vue** (new). An outline `Button size="sm"` with `CheckCheck`. Below md it shows only the icon (`w-8 p-0`). From md it shows "Confirm N" (`tabular-nums`) and from lg "Confirm N pre-assigned". The aria-label is `confirm_all_title_one/many`, and a 300ms tooltip shows `confirm_all_tooltip`. The button is hidden when the count is 0, without `canAct`, or when a calendar prop exists but the connection is not `connected`.
  - **Popover:** bottom/end, sideOffset 8, `w-96 p-4 space-y-4`. It holds a snapshot of the candidates taken at open, a title, the selectable OutlookAssignResults list (`outlook-confirm-row`, `max-h-60`), the note, the inline `FieldError` for "Select at least one meeting.", and Cancel plus "Confirm N meetings" (`outlook-confirm-submit`, count of checked rows).
  - **Submit:** checked ids go to `confirmPreassigned` in start order, and the composable chunks them by 50. Rows show pending, then their result. A failure opens the result view with the summary, "Retry N failed" (`outlook-confirm-retry`, which sends only the failed ids) and Close (`outlook-confirm-close`).
  - **Dismissal:** while busy, Escape, outside clicks and the trigger toggle are all ignored. When the popover closes and nothing is left, focus goes to the Sync button.
- **OutlookAssignResults.vue**. New optional selectable mode:
  - An include checkbox in the status slot of each row without a result. It is labelled `Include <subject>`, emits `toggle(id)`, and is disabled while any row is pending or when `checkDisabled` is set.
  - A project line (dot + name, plus " · Upcoming" for meetings that start in the future) until the row has a result.
  - `rowTestid` and `listClass` props. Without the new props the Phase 4 output is unchanged (existing tests untouched).
- **OutlookCalendarControls.vue**. The root renders when `calendar || canAct`. The confirm button sits between the status region and Sync in the connected branch, and is rendered alone when there is no calendar prop (test-hook mode). Without `canAct` nothing new renders.

## Commits

| Commit | Subject |
|--------|---------|
| f541ae97 | feat(05-11): selectable rows with project line in OutlookAssignResults |
| f36806c8 | feat(05-11): confirm all pre-assigned meetings in view from the toolbar |

Both tasks' code went into these two commits. Task 1 (the tracer slice) and Task 2 (the details) both live in OutlookConfirmAll.vue, so they could not be split into per-task commits that each compile.

## Gates

- `npx vitest run resources/js/m365`: 26 files, 523 tests passed. This includes OutlookConfirmAll.test.ts (18 tests), OutlookCalendarControls.test.ts (52) and OutlookAssignResults.test.ts (12).
- `npm run type-check` (vue-tsc), `npx tsc --noEmit`, `npx eslint resources/js/m365` and `npx prettier --check resources/js/m365`: all exit 0.
- Acceptance greps: OutlookConfirmAll in Controls = 3, confirmPreassigned = 1, data-ghost-id = 3, confirm_none_selected = 1, outlook-confirm-retry = 1, `it(` = 18.

## Deviations from Plan

1. **[Rule 2 - Correctness] Checkboxes also disabled in the result view.** Retry only re-sends failed rows, so a checkbox that could still be ticked there would suggest an action that does not happen. I added the `checkDisabled` prop to OutlookAssignResults for this.
2. **[Rule 1 - Bug avoidance] The trigger stays mounted while the popover is open.** `preassignedInRange` drops pending meetings, so during a submit the live count reaches 0. Hiding the button then would unmount the popover in the middle of the request. The button stays while open and shows the snapshot count.
3. **Commit granularity:** 2 commits for 2 tasks, but split by component rather than by task (see Commits).

## Open items

- **The browser-test mode button cannot appear on the real page without a core change.** `resources/js/Pages/Calendar.vue` renders the `#toolbar-extra` slot (which mounts OutlookCalendarControls) only with `v-if="outlook.calendar.value"`. With the integration off (CI) the controls are never mounted, so the 05-13 e2e test that expects `outlook-confirm-all` on injected meetings will not find it. The fix is one line: `v-if="outlook.calendar.value || outlook.canAct.value"`. Calendar.vue is outside this plan's files and is on the 05-14 "hot files deliberately not touched" list, so I did not edit it. The orchestrator needs to choose between allowing that one-line core edit (plus a ledger row) and changing the 05-13 test. The component side works in that mode: it is covered by unit tests, including the real composable through the test hook.
- The responsive and overflow truth (1366x768 and 1024px, EN/ES) is a backstop for visual review. Locally only the class steps are asserted.

## Threat model

- T-05-37 is mitigated: candidates are limited to rendered blocks inside `.fc` and to checked rows. Tests cover the hidden-weekend case, the day-view case and unticked rows.
- T-05-38 is mitigated: the full checked list goes to the composable, which chunks it by 50 (tested with 120 ids), and the list scrolls inside `max-h-60`.
- T-05-SC: no package installs.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookConfirmAll.vue, OutlookConfirmAll.test.ts
- FOUND: f541ae97, f36806c8 on the branch
