---
phase: 04-assign-meetings-to-projects
plan: 05
subsystem: m365-calendar-frontend
status: complete
tags: [vue, outlook, conversion, multi-select, batch, selection-bar, vitest]
requires:
  - "04-03: OutlookConvertForm single mode, context convert/announce/selection/meetings/labels, fillLabel, batch label keys"
provides:
  - "OutlookSelectionBar.vue: floating toolbar (count, Assign N meetings popover, Clear selection), document-level Escape / pointerdown clearing, selection-count announcements"
  - "OutlookConvertForm batch mode (mode 'single' | 'batch'): one convert call, per-row state, result view with summary, Close and Retry N failed"
  - "OutlookAssignResults.vue: per-meeting rows (pending spinner, Created, Already had a time entry, failure reason)"
  - "Calendar.vue mount: <OutlookSelectionBar v-if=\"outlook.labels.value\" /> inside AppLayout"
  - "Test ids: outlook-selection-bar, outlook-selection-assign, outlook-selection-clear, outlook-selection-count, outlook-selection-placement, outlook-batch-popover, outlook-batch-form, outlook-batch-row (data-status), outlook-batch-row-reason, outlook-batch-submit, outlook-batch-retry, outlook-batch-close, outlook-batch-summary"
affects: [04-07, 04-08]
requirements-completed: [ASGN-04]
key-files:
  created:
    - resources/js/m365/calendar/OutlookSelectionBar.vue
    - resources/js/m365/calendar/OutlookSelectionBar.test.ts
    - resources/js/m365/calendar/OutlookAssignResults.vue
    - resources/js/m365/calendar/OutlookAssignResults.test.ts
  modified:
    - resources/js/m365/calendar/OutlookConvertForm.vue
    - resources/js/m365/calendar/OutlookConvertForm.test.ts
    - resources/js/Pages/Calendar.vue
decisions:
  - "The batch form keeps a snapshot of its meetings (start order) taken when it mounts, so rows of converted meetings stay listed with their result after the context removes them from the selection."
  - "The bar stays visible while a batch request runs (count > 0 || busy) and the popover cannot be dismissed while busy (interact-outside and Escape prevented), like the single form's panel."
  - "Selection-count announcements use a synchronous watcher and are skipped while a batch runs, so a batch announces only its outcome (one toast and one announcement), never the count changes it causes."
  - "Document Escape listener runs in the capture phase and stands down while the batch popover, a dialog or a menu is open, so Escape closes the popover first and only a second Escape clears."
  - "Retry and Ctrl/Cmd+Enter in result view resubmit only the failed ids with the current form values; a convert answer of [] (already in flight) restores the previous row states."
metrics:
  completed: 2026-11-17
estimate:
  tokens: 85000
actuals:
  tokens: 16700
  tasks: 3
  commits: 4
plan_head_before: fbda4b784bcddd866ba53f55fdb6d4dc20074557
plan_head_after: e26139f85a0c69868486134edf371ee010f03100
completed: 2026-11-17
---

# Phase 4 Plan 05: Assign several meetings at once Summary

A floating "Meeting selection" toolbar, centred on the calendar grid, opens a batch form in a popover. The form sends all selected meetings in one convert request, shows a result row per meeting, and lets the user retry only the failed ones (ASGN-04; D-07, D-08, D-16).

## What was built

- **OutlookSelectionBar.vue** (new). Teleported to the body as a `fixed z-40` wrapper, centred on `.fc` and placed 16px above the grid's visible bottom. It is measured on show, on window resize and through a ResizeObserver. If no grid is found it falls back to the viewport centre.
  - Toolbar: `role="toolbar"`, label "Meeting selection". It holds the count (hidden under 480px), the `PrimaryButton` "Assign N meetings" with `ListChecks` as the PopoverTrigger, and the ghost icon button "Clear selection".
  - Popover: `side="top"`, `align="center"`, `sideOffset` 8, `w-96 p-4`. It hosts `OutlookConvertForm mode="batch"` with the selected meetings in start order, and closes on `done` or `cancel`.
  - Document listeners, both in the capture phase:
    - Escape clears the selection unless the popover is open, a request is running, or a dialog or menu is open.
    - A pointerdown clears the selection unless it lands on `[data-ghost-id]`, the bar, a popper wrapper, a listbox, a dialog or a menu.
  - Count changes are announced through `context.announce`: "3 meetings selected", or "Selection cleared" when the selection empties.
  - Enter animation: `motion-safe:animate-in fade-in-0 slide-in-from-bottom-2`, on the inner toolbar so it does not fight the centring transform.
- **OutlookConvertForm.vue** now has two modes, `'single' | 'batch'`. Single mode behaves exactly as before.
  - Batch layout: title "Assign N meetings", the result rows, the same project/task, tags and billable controls with the same prefill rules, the batch note, then Cancel and "Create N time entries". It has no description or time fields.
  - Submit: one `context.convert(ids, { project_id, task_id, tags, billable })`.
  - Per-id state: `pending` → result. A meeting missing from the answer counts as failed with the generic reason.
  - All rows done (created or existing): emits `done`, shows one toast (the core "Time entry created successfully" for one meeting, ":count time entries created successfully" for more), sends the same text to the announcer once, and remembers the last project.
  - At least one failure: switches to the result view. The header shows ":done of :total time entries created" or "No time entries created", has `tabindex=-1`, gets focus and is announced once. The footer shows "Close" and "Retry N failed".
- **OutlookAssignResults.vue** (new) renders the row list (`role="list"`, `max-h-40 overflow-y-auto`, rows `min-h-8`). Each row has:
  - a status slot: 12px spinner, green `CircleCheck`, tertiary `Info` or destructive `CircleX`
  - the subject, or "(No subject)"
  - a second line: Created, Already had a time entry, or the server reason (generic fallback)
  - the date range on the right, e.g. "Tue 10:00 – 11:00", with the end day repeated across midnight

  All text goes through interpolation (T-04-20).
- **Calendar.vue** (core): one import and one element, `<OutlookSelectionBar v-if="outlook.labels.value" />`, after `TimeEntryCalendar` inside `AppLayout`. Numstat 2/0. 04-07 adds the ledger entry.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | e243dddd | feat(04-05): floating selection bar with the batch assign form |
| 2 | a61b84b4 | feat(04-05): per-meeting batch results with summary and retry of failed meetings |
| 3 | 1355d6ad | feat(04-05): selection lifecycle around the bar: Escape, outside clicks, announcements |
| 3 (fix) | e26139f8 | fix(04-05): give the bar's placement wrapper its own test id |

## Gates (local)

- `npx vitest run` (full suite): 51 files, 1247 tests passed. `resources/js/m365`: 18 files, 351 passed. New or extended: OutlookSelectionBar 17, OutlookAssignResults 7, OutlookConvertForm +10 batch tests.
- `npm run type-check` (vue-tsc) and `npx tsc --noEmit`: clean.
- `npx eslint resources/js/m365 resources/js/Pages/Calendar.vue`: clean. `npx prettier --check` on the same paths: clean.
- Acceptance greps:
  - `OutlookSelectionBar` in Calendar.vue: 2
  - `outlook-batch-form` in the form: 1
  - `outlook-selection-bar` in the bar: 1
  - `outlook-batch-retry`: 1
  - `row_existing` in AssignResults: 1
  - `batch_summary`: 1
  - `it(` in the AssignResults test: 7
  - `pointerdown`: 2
  - `selection_cleared`: 1
  - `role="toolbar"`: 1
  - `git status --porcelain` on the plan paths: empty
- PHP: no PHP touched. Playwright: none in this plan (04-08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Count announcements would have overridden the batch outcome**
- **Found during:** Task 3
- **Issue:** `convert` removes done ids from the selection. A plain count watcher would then announce "Selection cleared" or "1 meeting selected" on top of the batch summary or success text, which breaks "never per row" and "announce the same text".
- **Fix:** a synchronous count watcher that is skipped while the batch request runs.
- **Files:** OutlookSelectionBar.vue. **Commit:** 1355d6ad

**2. [Rule 2 - Missing critical] The popover could be dismissed mid-request**
- **Issue:** an outside click or Escape during the request would have closed the popover and cleared the selection while the request was still running.
- **Fix:** the bar keeps itself visible while busy, prevents `interact-outside` and Escape on the popover while busy, and its document listeners stand down while busy. This mirrors the 04-03 detail panel.
- **Commit:** e243dddd / 1355d6ad

**3. [Rule 1 - Bug] Rows of converted meetings would have vanished from the result view**
- **Issue:** the selection shrinks after a convert, so a form bound to it would lose the converted rows.
- **Fix:** the batch form keeps a start-ordered snapshot of its meetings taken at mount.
- **Commit:** e243dddd

**4. [Rule 3 - Blocking] Placement test id collided with the acceptance grep**
- **Issue:** the wrapper id `outlook-selection-bar-position` made `grep -c outlook-selection-bar` return 2.
- **Fix:** renamed it to `outlook-selection-placement`.
- **Commit:** e26139f8

**Environment:** the worktree started on an old upstream commit. It was clean, so it was reset to BASE fbda4b78 as instructed. `node_modules` and `vendor` junctions to the main checkout were created; both are git-ignored and untracked.

**Not done (by instruction):** no push. The plan says to push in Task 3, but the orchestrator brief says not to; the commits are left on the worktree branch.

## Known Stubs

None.

## Threat Flags

None. No new network surface: the batch uses the existing `context.convert` endpoint, and T-04-20/21/22 are mitigated as planned.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookSelectionBar.vue, OutlookSelectionBar.test.ts, OutlookAssignResults.vue, OutlookAssignResults.test.ts
- FOUND commits: e243dddd, a61b84b4, 1355d6ad, e26139f8 (ancestors of HEAD)
