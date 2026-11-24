---
phase: 06-out-of-sync-detection
plan: 12
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, popover, vue, a11y]
requires: [06-03, 06-07]
provides:
  - "OutlookSyncFlagPanel.vue: the resolve popover for one flagged entry (Keep as is, Adjust to Outlook, two-step Delete entry), driven by context.flagPanel"
affects: [06-16, 06-17]
requirements-completed: [OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created:
    - resources/js/m365/calendar/OutlookSyncFlagPanel.vue
    - resources/js/m365/calendar/OutlookSyncFlagPanel.test.ts
  modified: []
decisions:
  - "Anchor resolved by comparing dataset.eventId over `.fc [data-event-id]` (no id in a selector); passed to both PopoverAnchor :reference and PopoverContent :reference"
  - "Reka overrides aria-labelledby with its (absent) trigger id, so the title id is set on the dialog through a DOM hookup (OutlookGhostDetail's labelDialogBySubject pattern)"
  - "close-auto-focus is always prevented; focus after a close is placed by the panel: outcome table after actions, block / counter after Esc, untouched after an outside click or a silent close"
  - "A pointer-down inside a marker (outlook-sync-flag-marker) never closes the popover: the marker click asks for its own entry's popover"
  - "Adjust is hidden when the moved meeting is all-day or has no new times; a failed action with an empty message (nothing sent) shows no alert"
metrics:
  duration: "~35 min"
  tasks: 3
  files: 2
estimate:
  tokens: 85000
actuals:
  tokens: 13400
  tasks: 3
  commits: 3
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: 35c5656af32de998b3a60d32be5b84573165a7d5
---

# Phase 6 Plan 12: Resolve popover for flagged entries Summary

`OutlookSyncFlagPanel` is the one place where a user decides about a flagged entry. It is a non-modal popover (`w-96 p-4`) anchored to the entry block, or to the toolbar counter when the block is not rendered. It shows what changed in Outlook and offers Keep as is, Adjust to Outlook, and Delete entry, which asks for confirmation first. It never calls the network: the context actions from 06-07 do the work, and their answers drive closing, focus and the inline alert.

## What was built

- **Opening (Task 1).** Watches `context.flagPanel` by `seq`. It resolves the anchor (the entry block inside `.fc`, or `[data-testid="outlook-out-of-sync"]`) and renders nothing in these cases: no request, an unflagged id, `canAct` false, or a missing anchor (the request is then cleared). The popover is labelled by its title.
- **Moved flag.** Shows the title "Meeting moved in Outlook", the description (or "No description", truncated, with the full text in `title`), then the Before / Now / Your entry rows in full form (`tabular-nums`, Now in 600), then the moved note. The footer has Keep as is and Adjust to Outlook, with focus on Adjust. An all-day move has no Adjust button.
- **Cancelled / removed (Task 2).**
  - The popover shows the title, the Meeting row, a Your entry row (only when the entry's times differ), and the note "Nothing is deleted unless you choose to".
  - The footer has Keep as is and an outline Delete entry button with destructive text and a `Trash2` icon. Focus starts on Keep.
  - Delete entry swaps the footer in place for the question, Cancel (focused) and a destructive Delete button. Only that second click deletes.
- **Esc layering.** Esc in the confirmation returns to the normal footer with focus on Delete entry. The next Esc closes the popover and returns focus to the block, or to the counter when the popover is anchored there.
- **Outcomes.**
  - Adjust / Keep succeed: the popover closes. Focus goes to the counter if the popover was opened from the counter and the counter is still shown. Otherwise it goes to the entry block, else the counter, else Sync.
  - Delete or stale: the popover closes and focus goes to the counter, else Sync.
  - Failure: the popover stays open with its values and the confirm footer. A `role="alert"` line (`CircleX`, `text-destructive`) shows the mapped reason, and focus returns to the button that acted.
- **Busy (Task 3).**
  - The acting button spins; for Delete, a 16px `LoadingSpinner` replaces `Trash2`. The other button is disabled.
  - Outside pointer-down and Esc are blocked, and a second click sends nothing.
  - The entry block gets `aria-busy="true"`. Only this panel sets and removes it, including on unmount.
- **Counter anchor.** `data-anchor="counter"`, side bottom / align end, and the line "This entry is outside the days or hours shown."
- **Re-anchoring.** While the popover is visible, a MutationObserver on `document.body` watches the block. An idle popover moves to a new block with the same `data-event-id`, and closes silently when the block is gone. A busy popover waits and checks again after a failure.
  - The idle popover also closes when the flag leaves the context, and on a pointer-down on any entry block (the start of a drag or resize).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 8f41d8cc | feat(06-12): resolve popover for a moved flag with Adjust to Outlook |
| 2 | 391434e0 | feat(06-12): cancelled and removed flags with Keep as is and the two-step Delete |
| 3 | 35c5656a | feat(06-12): loading, failure and stale states, counter anchor and re-anchoring in the resolve popover |

## Gates (local)

- `npx vitest run resources/js/m365/calendar/OutlookSyncFlagPanel.test.ts`: 34 passed (851 lines).
- `npx vitest run resources/js/m365`: 29 files, 746 tests passed.
- `npm run type-check` (vue-tsc), `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` on both files: clean.
- Acceptance greps: `outlook-sync-flag-panel`, `outlook-sync-flag-delete-confirm`, `outlook-sync-flag-alert` and `outlook-sync-flag-not-in-view` are all present. `v-html` count is 0. 34 `it(` blocks (18 required). `git status --porcelain -- resources/js/m365` is empty.
- Mutation check: turning off the re-anchor observer fails the two re-anchor tests.
- CI (NPM Test Unit / Typecheck / Lint / Format), and the browser proof in 06-17: PENDING CI (orchestrator).

## Deviations from Plan

1. **[Rule 2 - Correctness] Clicking a marker while the popover is open does not close it.** A pointer-down inside `[data-testid="outlook-sync-flag-marker"]` is ignored by both the panel's entry pointer-down listener and reka's interact-outside. The marker's click (06-11) then asks for its own entry's popover. Without this, a pointer-down outside the popover would close it, and the click would open it again.
2. **[Rule 2 - Correctness] Adjust also hides when a moved flag has no new times** (`new_start` or `new_end` null), as well as for all-day meetings. The server could not apply it.
3. **[Rule 3 - Blocking] reka overrides `aria-labelledby`.** It always sets the content's `aria-labelledby` to its trigger id. The title id is therefore written on the dialog through a ref callback, as `OutlookGhostDetail` does. `OutlookConfirmAll`'s `:aria-labelledby` has the same problem: it is overridden too. That file is out of scope, so it was left as is.
4. **Description test id.** The entry line uses `outlook-sync-flag-description`, which the UI-SPEC does not list. The UI-SPEC names no id for that line.
5. **Environment:** the worktree was cut from an old commit and reset to the wave base `7bcb5562`. `node_modules` and `vendor` junctions to the main checkout were created (both are gitignored).

## Notes for downstream plans

- 06-16 mounts `<OutlookSyncFlagPanel />` once in `Calendar.vue`. It takes no props and needs the Outlook context plus `organization` (time format; 24 hours by default) from inject.
- The panel resolves the counter as `[data-testid="outlook-out-of-sync"]` (06-13) and the Sync button as `[data-testid="outlook-sync-button"]`.
- The marker (06-11) should keep `@pointerdown.stop` / `@click.stop`. The panel also exempts marker pointer-downs on its own side.

## Threat Flags

None. No network code and no new surface. T-06-39 is mitigated: a single click never deletes (tested), and Delete appears only for cancelled / removed flags. T-06-40 is mitigated: both buttons are disabled while an action runs, the popover cannot be dismissed, and a second click sends nothing (tested). T-06-41 is mitigated: interpolation only, `v-html` count 0, and a markup description renders as text (tested).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookSyncFlagPanel.vue
- FOUND: resources/js/m365/calendar/OutlookSyncFlagPanel.test.ts
- FOUND: 8f41d8cc, 391434e0, 35c5656a (ancestors of HEAD; `git rev-list --count 7bcb5562..HEAD` = 3 before this SUMMARY commit)
