---
phase: 06-out-of-sync-detection
plan: 13
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, d-03, ghost-layer, panel, hover-card, a11y]
requires: [06-03, 06-07]
provides:
  - "OutlookMovedMeeting.vue: variant block (outlook-moved-block, outlook-detail-move-entry) and variant note (outlook-hover-moved-note)"
  - "OutlookGhostDetail: moving prop, move-entry emit, moved block above the separator"
  - "OutlookGhostLayer: move-entry handler (context.moveEntry, focus rules), data-moved-from, ', already logged on <date>' label suffix, pending block for isMovePending"
  - "OutlookMeetingHoverCard: moved note line before the hint"
affects: [06-11, 06-17]
requirements-completed: [OSYNC-01]
completed: 2026-11-24
status: complete
key-files:
  created:
    - resources/js/m365/calendar/OutlookMovedMeeting.vue
    - resources/js/m365/calendar/OutlookMovedMeeting.test.ts
  modified:
    - resources/js/m365/calendar/OutlookGhostDetail.vue
    - resources/js/m365/calendar/OutlookGhostDetail.test.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
    - resources/js/m365/calendar/OutlookMeetingHoverCard.vue
    - resources/js/m365/calendar/OutlookMeetingHoverCard.test.ts
decisions:
  - "A D-03 moved meeting (not pre-assigned) opens its panel with focus on Create time entry. The move button now comes first in the body, so the reka default would land on it; a new entry has to stay the default (D-03). Pre-assigned meetings keep focus on Confirm."
  - "While a move runs, Edit is disabled too (not only Create / Confirm / More actions), so the form cannot open in the middle of a move. While a confirm runs, the move button is disabled."
  - "Stale move result in the panel: the panel closes; focus stays on the meeting if it is still in the lane, otherwise the Phase 4 removal rule applies. The context has already shown the stale toast and refreshed."
  - "Pending block of a meeting that is not pre-assigned (it has no project dot to replace): a 12px spinner (outlook-move-spinner) goes before the subject on one-line tiers and replaces the calendar icon of the time line on taller tiers. Pre-assigned meetings reuse the Phase 5 spinner."
  - "The move button is the core outline Button size sm (it has no loading prop). Its loading state is a LoadingSpinner in place of MoveRight, plus disabled and aria-busy."
  - "data-moved-from and the label suffix render whatever canAct is (the plan says the label still says already logged). The panel block and the hover note need canAct (D-14)."
metrics:
  duration: "~20 min"
  tasks: 2
  files: 8
estimate:
  tokens: 90000
actuals:
  tokens: 16900
  tasks: 2
  commits: 2
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: 8bc5fd2c1933246dee02933136af932c39a61c7e
---

# Phase 6 Plan 13: "Move my entry here" for a started meeting that Outlook moved (D-03) Summary

Outlook can move a meeting after it has already started. That meeting now shows at its new slot as a normal suggestion, with a ", already logged on Tue, Nov 24" label suffix and `data-moved-from`. Its panel adds a "Moved in Outlook · Already logged" block that ends with an outline "Move my entry here" button. That button calls `context.moveEntry` and moves focus to the moved entry. The hover card gets one note line, and a move started from any surface puts the block in the pending state.

## What was built

- **OutlookMovedMeeting.vue** (new). The `block` variant has a `CalendarClock` eyebrow, then a body with the logged range in full form ("You logged it on Tue, Nov 24 · 10:00 – 11:00. …", `tabular-nums`, its id referenced by the button's `aria-describedby`), then the neutral outline sm "Move my entry here" (`MoveRight`, never accent). Its `pending` and `disabled` props drive the button. The `note` variant is the 12px hover line. Neither variant renders anything without `moved_from`, and both use text interpolation only.
- **OutlookGhostDetail.vue**. Shows the block after the pre-assignment or the link and before the separator, only with canAct and not in form mode. Emits `move-entry`. New `moving` prop: Create / Edit / Confirm and More actions are disabled, and Escape or an outside click cannot dismiss the panel. The footer is unchanged: Dismiss / Restore stay in More actions, with no footer Dismiss button.
- **OutlookGhostLayer.vue**. `onMoveEntry` calls `context.moveEntry(id)`:
  - ok: the panel closes and focus goes to `[data-event-id=<moved_from.time_entry_id>]`, or follows the Phase 4 removal rule.
  - failed: the panel stays open, the message (or `move_entry_failed`) goes to `outlook-detail-alert`, and focus returns to the button.
  - stale: the panel closes and focus stays on the meeting or follows the removal rule.

  The layer also passes `moving` from `isMovePending`. The block's pending state now covers `isMovePending`, and the block gets the `moved_suffix` label (after the pre-assigned suffix, before the dismissed / series-ignored / selected suffixes) and `data-moved-from`.
- **OutlookMeetingHoverCard.vue**. Adds the note after the summary and pre-assignment and before the hint, with canAct only. Its actions are unchanged.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | bed81805 | feat(06-13): move my entry here from the meeting panel (D-03) |
| 2 | 8bc5fd2c | feat(06-13): moved-meeting hover note, block label suffix and pending move state |

## Gates (local)

- Vitest: the 4 plan files pass (227 tests). The wider `resources/js/m365` + `resources/js/Pages` run passes (29 files, 763 tests). Existing exact-count assertions are unchanged, because the new parts render nothing without `moved_from`.
- `npm run type-check` (vue-tsc), `npx tsc --noEmit`, ESLint and Prettier `--check` on the 8 files: all clean.
- Tracer gate (Task 1): its `<verify>` was re-run end-to-end before Task 2 started, and it passed.
- Playwright / browser proof: PENDING CI (orchestrator), and 06-17.

## Deviations from Plan

1. **[Rule 2 - Correctness] Focus on open for a moved meeting.** Found during Task 1. The move button sits in the body, before the footer, so reka's default open focus landed on it, which goes against "Create time entry stays the default". Fix: `onOpenAutoFocus` focuses Create time entry for a moved meeting that is not pre-assigned. Files: OutlookGhostDetail.vue. Commit bed81805.
2. **Task split.** The `note` variant of OutlookMovedMeeting.vue was committed with Task 1, because it is the same small component. Its hover-card wiring and tests are in Task 2. Every Task 2 change to the ghost layer (suffix, attribute, pending spinner) is in the Task 2 commit only.
3. **Extra `disabled` prop on OutlookMovedMeeting.** It disables the move button while a panel confirm runs, so the two actions cannot run at the same time.

## Known Stubs

None.

## Threat Flags

None. No new endpoint and no v-html. Meeting values and dates are rendered through interpolation only (T-06-43). No package installs (T-06-SC).

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookMovedMeeting.vue, OutlookMovedMeeting.test.ts
- FOUND commits: bed81805, 8bc5fd2c (ancestors of HEAD)
- `git status --porcelain -- resources/js/m365` is empty
