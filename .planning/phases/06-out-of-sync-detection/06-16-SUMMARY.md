---
phase: 06-out-of-sync-detection
plan: 16
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, calendar, core-seam, ledger, vue]
requires: [06-07, 06-11, 06-12, 06-14]
provides:
  - "TimeEntryCalendar: optional context-menu-entry-extra slot ({ timeEntry }) first in the completed-entry menu"
  - "TimeEntryCalendar: goToDate(date) exposed through defineExpose (keeps the view mode, no reload)"
  - "Calendar.vue: OutlookSyncFlagMarker in #event-extra, OutlookEntryMenuItems in #context-menu-entry-extra, OutlookSyncFlagPanel next to OutlookSelectionBar, navigator registered on mount / cleared on unmount"
  - "docs/m365/TOUCHED-CORE-FILES.md: '## Phase 6 (Out-of-sync detection)' section"
affects: [06-17, 06-18]
requirements-completed: [OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created: []
  modified:
    - resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue
    - resources/js/Pages/Calendar.vue
    - docs/m365/TOUCHED-CORE-FILES.md
decisions:
  - "goToDate does not scroll: it only sets currentDate (local midnight via getLocalizedDayJsFromMinutes) and emits dates-change; the popover (06-12) owns focusing / the weekend-or-hours fallback"
  - "calendarRef typed as InstanceType<typeof TimeEntryCalendar>; a negative check (goToDate(42)) confirmed vue-tsc types the exposed method strictly"
  - "OutlookSyncFlagPanel mounted outside TimeEntryCalendar but inside AppLayout's slot, so both the Outlook context (Calendar.vue's useOutlookMeetings provide) and AppLayout's 'organization' injection reach it"
metrics:
  duration: "~15 min"
  tasks: 2
  files: 3
estimate:
  tokens: 50000
actuals:
  tokens: 2300
  tasks: 2
  commits: 2
plan_head_before: 31416de8644ee8a94d254c6684d40004789ca184
plan_head_after: 879f915764da05fd907939fcf7ab3377d39e068f
---

# Phase 6 Plan 16: Core seams and calendar wiring Summary

Two additive, ledgered core seams (an entry-menu slot and an exposed `goToDate`) make the out-of-sync marker, the "Review Outlook change" menu item, the review popover and the counter's cross-week jump live in the real calendar page.

## What was built

- **`TimeEntryCalendar.vue`** (core, additive, each marked "Fork seam (m365, Phase 6)"):
  - `currentDate` destructured from `useCalendarNavigation`; `goToDate(date: string)` sets it to that local day and calls `emitDatesChange()`, keeping week/day view; `defineExpose({ goToDate })`.
  - `<slot v-if="$slots['context-menu-entry-extra']" name="context-menu-entry-extra" v-bind="{ timeEntry: contextMenuTimeEntry }" />` as first child of the completed-entry menu branch. Without the slot the menu is unchanged.
- **`Calendar.vue`**: imports of `OutlookSyncFlagMarker`, `OutlookEntryMenuItems`, `OutlookSyncFlagPanel` (+ `onUnmounted`); `ref="calendarRef"`; `outlook.setCalendarNavigator((date) => calendarRef.value?.goToDate(date))` on mount, `null` on unmount; marker after `OutlookEntryBadge` in `#event-extra`; new `#context-menu-entry-extra` fill; `<OutlookSyncFlagPanel v-if="outlook.labels.value" />` after `OutlookSelectionBar`. All fills gated by `outlook.labels.value`; core props/handlers unchanged. The counter (`data-testid="outlook-out-of-sync"`) and Sync button (`outlook-sync-button`) stay where 06-14 / earlier phases put them (OutlookCalendarControls).
- **Ledger**: `## Phase 6 (Out-of-sync detection)` with Core files edited (2 rows, re-apply notes), New files inside core directories (none from 06-16; 06-17's e2e spec row left to 06-18), Hot files deliberately not touched; states no other core file changes (D-13). 06-18 adds the reconciliation line.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | de2f8fcc | feat(06-16): wire the out-of-sync review into the calendar page |
| 2 | 879f9157 | docs(06-16): ledger the Phase 6 core seams |

## Verification

- `npx vitest run resources/js/packages/ui/src/FullCalendar resources/js/m365`: 41 files, 923 tests passed
- `npx vue-tsc --noEmit`: 0 errors (`npm run type-check`); negative check with `goToDate(42)` fails with TS2345 as expected, then reverted
- `npx tsc --noEmit`: 0
- `npx eslint` / `npx prettier --check` on both Vue files: clean
- Acceptance: `context-menu-entry-extra` count 3, `defineExpose` count 1; Calendar.vue pattern count 8 (>= 7); `git diff --quiet e3c56fc1 -- CalendarDayColumn.vue FullCalendarEventContent.vue useCalendarNavigation.ts openapi.json` exits 0
- Ledger: `## Phase 6 (Out-of-sync detection)` count 1; `context-menu-entry-extra` count 2; `node tests/Tools/m365-spike/validate-docs.mjs secrets` -> `secrets: OK (2280 checks)`
- Browser proof (marker, menu item, cross-week jump): 06-17, PENDING CI (orchestrator)

## Deviations from Plan

None in scope. Environment: created `node_modules` and `vendor` junctions to the main checkout (gitignored) so the local gates could run. `docs/m365/TOUCHED-CORE-FILES.md` was already not Prettier-formatted at base; left as is (not a gate for docs).

## Self-Check: PASSED

- FOUND: resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue, resources/js/Pages/Calendar.vue, docs/m365/TOUCHED-CORE-FILES.md
- FOUND: de2f8fcc, 879f9157 (ancestors of HEAD)
