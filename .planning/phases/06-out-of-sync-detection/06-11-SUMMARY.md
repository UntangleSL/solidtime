---
phase: 06-out-of-sync-detection
plan: 11
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, calendar, vue, a11y, context-menu]
requires: [06-03, 06-04, 06-07]
provides:
  - OutlookSyncFlagMarker (event-extra slot marker, data-flag-kind, click -> openFlagPanel)
  - OutlookEntryMenuItems ("Review Outlook change" for the core entry menu slot)
  - OutlookEntryBadge auto-adjust note (data-auto-adjusted) and aria-describedby origin text
  - OutlookMeetingContextItems "Move my entry here" (outlook-menu-move-entry)
affects: [06-16 (mounts the marker and the entry menu items into core slots)]
requirements-completed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created:
    - resources/js/m365/calendar/OutlookSyncFlagMarker.vue
    - resources/js/m365/calendar/OutlookSyncFlagMarker.test.ts
    - resources/js/m365/calendar/OutlookEntryMenuItems.vue
    - resources/js/m365/calendar/OutlookEntryMenuItems.test.ts
  modified:
    - resources/js/m365/calendar/OutlookEntryBadge.vue
    - resources/js/m365/calendar/OutlookEntryBadge.test.ts
    - resources/js/m365/calendar/OutlookMeetingContextItems.vue
    - resources/js/m365/calendar/OutlookMeetingContextItems.test.ts
decisions:
  - The origin and flag descriptions end as sentences ("Created from an Outlook meeting." + "Out of sync with Outlook. <reason>."), so the joined aria-describedby reads as in UI-SPEC section 1
  - The move hint has its own test id (outlook-menu-move-entry-hint), like the Phase 5 project hint
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 7bcb5562e508817eff253e76f420a60b02c59ad6
plan_head_after: 8c42acb8
---

# Phase 6 Plan 11: Out-of-sync entry points on calendar blocks Summary

An amber out-of-sync marker on flagged entries opens the review popover. The origin icon gets a quiet 7-day "Updated from Outlook" note. Flagged entries get a "Review Outlook change" item in their menu (the keyboard path), and D-03 meetings get "Move my entry here" in their menu. All of it reads the 06-07 Outlook context and makes no network calls.

## What was built

- **OutlookSyncFlagMarker.vue** (new): a plain `span` (no role, no tabindex) with a 20px hit area and a 12px `TriangleAlert` (`size-3`, `text-amber-700 fill-amber-100 dark:text-amber-300 dark:fill-amber-950`). It renders only when `flagOf(id)` is set and `canAct` is true.
  - The `title` has two lines: the `flagReason` text (organization 12/24h format from the injected `organization`), then "Click to review".
  - `data-flag-kind` carries the flag kind.
  - `@pointerdown.stop` and `@click.stop`, so neither event reaches the core block. The click calls `openFlagPanel(id, { anchor: 'entry', origin: 'entry' })`.
  - A hidden description ("Out of sync with Outlook. <reason>.") is attached to the block's `aria-describedby` through `describeBlock`, and removed when the marker goes away or unmounts.
  - It never touches `aria-busy`.
- **OutlookEntryBadge.vue**: the `sr-only` span is replaced by a hidden description on the block's `aria-describedby`. For 7 days after an auto-adjust (`autoAdjustedOf(id)`), the title gains a second line "Updated from Outlook: old → new", the description gains the same sentence, and the badge carries `data-auto-adjusted`. No other visual change and no toast. `data-testid="outlook-entry-badge"` is kept.
- **OutlookEntryMenuItems.vue** (new): an `outlook-entry-menu` wrapper holding `outlook-entry-menu-review` (16px amber `TriangleAlert`, "Review Outlook change") and a `ContextMenuSeparator`. Choosing it waits until the menu has closed (a local copy of `afterMenuClosed`), then calls `openFlagPanel(id, { anchor: 'entry', origin: 'entry' })`. It renders nothing for unflagged entries, when `canAct` is false, or without a context.
- **OutlookMeetingContextItems.vue**: when the meeting has `moved_from` and the context can act, "Move my entry here" (`MoveRight`) appears after Create (or after Confirm + Edit), with a trailing hint showing the old date (`shortDate`, `ml-auto text-xs text-text-tertiary tabular-nums`).
  - Choosing it closes the menu, then calls `context.moveEntry(id)` once.
  - The item is disabled while `isMovePending` is true, and the handler checks it again after the menu closes.
  - On success, focus goes to the moved entry block (`[data-event-id]`) if it is rendered, otherwise to the next meeting of the day, otherwise to Sync (the Phase 4 removal rule). On failure focus does not move (the composable shows the toast).
  - The neighbour lookup was extracted from `hideAndRefocus` into `neighbourOf`; its behaviour is unchanged and the existing focus tests pass.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 57f0f2dc | feat(06-11): out-of-sync marker on flagged entry blocks |
| 2 | da8277a6 | feat(06-11): auto-adjust note on the origin icon and 'Review Outlook change' entry menu item |
| 3 | 8c42acb8 | feat(06-11): 'Move my entry here' in the meeting context menu (D-03) |

## Gates

- Vitest: the 4 plan files pass, 70 tests (marker 13, badge 7, entry menu 5, meeting menu 45: 37 existing + 8 new). The full `resources/js/m365` suite passes: 30 files, 741 tests.
- `npm run type-check` (vue-tsc) exit 0. `npx tsc --noEmit` exit 0.
- ESLint clean and Prettier clean on all 8 files.
- Acceptance greps: the marker test id (1), `pointerdown.stop` (1), `v-html` (0 in all 4 components), `data-auto-adjusted` (1), `outlook-entry-menu-review` (1), `outlook-menu-move-entry` (2). `git status --porcelain -- resources/js/m365` is empty.
- CI (NPM Test Unit / Typecheck / Lint / Format, Playwright): PENDING CI (orchestrator).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fixture] The 12-hour time format pads the hour**
- **Found during:** Task 1
- **Issue:** The core `formatTime` renders "01:00 PM", not "1:00 PM".
- **Fix:** The test expectation now follows the core format. Component unchanged.
- **Commit:** 57f0f2dc

**2. [Rule 3 - Test harness] Attributes on `ContextMenuContent` are dropped by its portal wrapper**
- **Found during:** Task 2
- **Fix:** The entry menu test finds the menu by `[role="menu"]` instead of a test id.
- **Commit:** da8277a6

**3. [Rule 2 - a11y] The described texts end with a period**
- The origin text gets a final period, so the joined `aria-describedby` reads "Created from an Outlook meeting. Out of sync with Outlook. Meeting cancelled in Outlook.", as in UI-SPEC section 1.

## Known Stubs

None. The components are complete; mounting into the core slots (`event-extra`, `context-menu-entry-extra`) is plan 06-16.

## Threat mitigations

- T-06-37: `pointerdown.stop` and `click.stop` on the marker. A test checks that the block's own pointerdown and click listeners are not reached, and that clicks elsewhere on the block still reach them.
- T-06-38: interpolation only. No `v-html` in any of the four components. Tests check that markup in the reason and title renders as text.
- T-06-SC: no packages installed.

## Self-Check: PASSED

- FOUND: all 8 files under resources/js/m365/calendar/
- FOUND: 57f0f2dc, da8277a6, 8c42acb8 (ancestors of HEAD)
