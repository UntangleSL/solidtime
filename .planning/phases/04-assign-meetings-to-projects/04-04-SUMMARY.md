---
phase: 04-assign-meetings-to-projects
plan: 04
subsystem: m365-calendar-frontend
status: complete
tags: [vue, outlook, context-menu, hover-card, multi-select, accessibility, vitest]
requires:
  - "04-03 context: openForm(id) + formRequest watcher in the lane, selection (OutlookSelection), canAct, labels create_entry / select / deselect / selected_suffix / hover_hint_select(_mac)"
provides:
  - "Context menu items outlook-menu-create (Create time entry, after the menu closed) and outlook-menu-select (Select / Deselect meeting)"
  - "Hover card action outlook-hover-create and the platform-aware select hint"
  - "Lane multi-select: click.capture with Ctrl/Cmd/Shift, Ctrl/Cmd+Enter and Shift+Enter, data-selected, ring, tiered check badge, aria-pressed, ', selected' suffix, hover suppression"
affects: [04-05, 04-08]
requirements-completed: [ASGN-01, ASGN-04]
key-files:
  created: []
  modified:
    - resources/js/m365/calendar/OutlookMeetingContextItems.vue
    - resources/js/m365/calendar/OutlookMeetingContextItems.test.ts
    - resources/js/m365/calendar/OutlookMeetingHoverCard.vue
    - resources/js/m365/calendar/OutlookMeetingHoverCard.test.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
decisions:
  - "Ctrl+Shift-click and Ctrl+Shift+Enter add the range (Shift wins); Ctrl/Cmd alone toggles"
  - "Shift range candidates = context meetings whose [data-ghost-id] is rendered inside the calendar root (.fc), so hidden days never join a range"
  - "Modifier state for hover suppression comes from block pointerenter/pointermove plus document keydown/keyup (capture) and resets on window blur"
  - "A selected dismissed block keeps its dotted fill (selected fill applies only to non-dismissed) but gets the ring and badge"
  - "Hover card 'Create time entry' sits after the caller's actions slot (primary rightmost)"
completed: 2026-11-17
duration: ~1h
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 12200
  tasks: 3
  commits: 3
plan_head_before: fbda4b784bcddd866ba53f55fdb6d4dc20074557
plan_head_after: 751d10bf98d51c29d6b86df11fb9439eea42f5d7
---

# Phase 4 Plan 04: Ways into a conversion and multi-select Summary

"Create time entry" now starts from the meeting context menu (after the menu has closed) and from the hover card (both through `context.openForm`, which the 04-03 lane turns into the panel's form mode). Meetings can be selected with Ctrl/Cmd-click, Shift-click, Ctrl/Cmd+Enter, Shift+Enter or the menu's "Select meeting" item, and selected blocks show an accent ring, a check badge, `aria-pressed` and a ", selected" label suffix.

## What was built

- **OutlookMeetingContextItems.vue**: order label, "Create time entry" (`ClockPlus`, `outlook-menu-create`), "Select meeting" / "Deselect meeting" (`ListChecks` / `X`, `outlook-menu-select`), "Open in Outlook" (safe https link only), separator, Dismiss / Restore. The two new items render only when `canAct` and the meeting still exists (a stale element renders only the label). Create waits for `afterMenuClosed(menu)` and then calls `context.openForm(id)`. Select calls `context.selection.toggle(id)` for the right-clicked meeting only. The header comment now covers conversion.
- **OutlookMeetingHoverCard.vue**: injects the Outlook context (nullable). When `canAct`: the hint is `hover_hint_select` (`hover_hint_select_mac` on macOS, same detection as `CalendarZoomControls`) and a `PrimaryButton` "Create time entry" (`outlook-hover-create`, `type="button"`) calls `context.openForm(meeting.id)`. The card never hosts inputs. Without `canAct` (or without a context) the hint stays "Click for details" and no button renders. The `actions` slot still renders, and the row shows when either the button or slot content exists.
- **OutlookGhostLayer.vue**:
  - `@click.capture` on `.m365-lane`: when `canAct` and Ctrl, Cmd or Shift is held on a block, it calls `preventDefault` + `stopPropagation` (the block's PopoverTrigger never sees the click), closes the panel and the hover card, then calls `selection.toggle(id)` or `selection.selectRange(id, rendered)`.
  - The Enter handler routes Ctrl/Cmd+Enter to toggle and Shift+Enter to range; plain Enter still calls `el.click()`. Space is unchanged.
  - `setOpen(id, true)` clears the selection (a plain click clears the selection, then opens the panel).
  - Selected look: `data-selected`, `m365-meeting--selected ring-2 ring-accent-700 dark:ring-accent-200 ring-offset-0`, scoped hover fill at rest (skipped for dismissed blocks), and an aria-hidden badge `absolute top-1 right-1 rounded-full` with fill `--m365-meeting-bar` and `Check` in `--color-on-accent`. The badge is `size-4` with a `size-3` icon from tier 3 and `size-3` with a `size-2` icon on tiers 1-2. `aria-pressed` is set only while a selection exists, and `labels.selected_suffix` is appended to the aria-label.
  - Hover suppression: an open request is refused while a selection exists and a modifier is held.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 7f2d9baa | feat(04-04): create a time entry from the meeting context menu (tracer) |
| 2 | bc8e63fd | feat(04-04): hover card Create time entry action and the select hint |
| 3 | 751d10bf | feat(04-04): select several meetings in the lane and from the menu |

## Gates (local, Gate F)

- `npx vitest run resources/js/m365`: 16 files, 338 tests passed (was 317 before this plan)
- `npm run type-check` (vue-tsc --noEmit): clean
- `npx tsc --noEmit`: clean
- `npx eslint resources/js/m365`: 0 problems
- `npx prettier --check resources/js/m365`: clean
- Tracer gate (Task 1): verify re-run end-to-end before expanding, passed.
- Acceptance greps: outlook-menu-create 1, "Reserved for Phase 4" 0, openForm( 1 (menu) / 1 (hover card), outlook-hover-create 1, hover_hint_select_mac 1, data-selected 1, click.capture 1, aria-pressed 2 (binding + comment; at least 1 required), outlook-menu-select 1, `git status --porcelain -- resources/js/m365` empty.
- No push (rules: the orchestrator merges; the wave-2 CI gate belongs to 04-02).

## Deviations from Plan

1. **[Rule 3 - Test infrastructure] Vue listener timestamp check under fake timers.** Vue's DOM event invoker ignores an event whose first-handler timestamp is not later than the moment the listener was attached. The new lane `click.capture` listener stamps every click first. With frozen `Date` (vi.useFakeTimers), a click right after mounting never reached the block's PopoverTrigger, and 8 existing fake-timer tests failed. Real browsers are not affected because time moves on. Fix in `OutlookGhostLayer.test.ts`: a `passMountTime()` helper (`vi.setSystemTime(Date.now() + 1)`) called after mounting in `mountGated` / `mountForms` and before each click / Enter in the new multi-select tests. The existing assertions did not change.
2. **[Observation, not fixed: outside this plan's files] A read-only panel with no focusable content closes at once in happy-dom.** With `canAct` false and no web link, the detail panel opens and closes again in the same tick in happy-dom. This also happens on the base commit; the existing test "offers no Dismiss button when the context cannot act" passes without ever asserting that the panel opened. The new canAct-false test gives the meeting a web link so the panel has a focusable element. Worth a check in the 04-08 browser proof (test-hook mode: click a meeting with no Outlook link).
3. **Ctrl+Shift precedence**: the plan does not define it. Shift wins (range add), which is additive like the platform convention.
4. **node_modules / vendor junctions** were created in the worktree to run the gates (gitignored, not committed).

## Known Stubs

None.

## Threat model

- T-04-18: the meeting is resolved from the element id against the current list; a stale element renders only the label. Tested (no create/select items).
- T-04-19: the menu items, hover button and modifier selection need `canAct`; the selection wrapper in the context is also inert. Tested for the menu, the hover card and the lane.
- T-04-SC: no package installs.

## Open items for later plans

- 04-05: Escape / outside-click clearing, the floating bar and count announcements (one document-level listener in OutlookSelectionBar). The lane does not clear on outside clicks.
- 04-08: browser proof of Ctrl/Cmd/Shift-click, the badge sizes, hover suppression and observation 2.

## Self-Check: PASSED

- All 6 modified files exist in the worktree.
- Commits 7f2d9baa, bc8e63fd, 751d10bf are ancestors of HEAD.
- `git status --porcelain -- resources/js/m365` is empty.
