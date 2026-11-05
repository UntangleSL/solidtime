---
phase: 03-outlook-meetings-in-the-calendar
plan: 05
subsystem: ui
tags: [vue, calendar, outlook, ghost-layer, vitest, dst, tailwind]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: meeting JSON contract (OutlookMeetingResource shape fixed in 03-02, cache tables from 03-01)
provides:
  - OutlookMeeting and OutlookCalendarLabels TS types
  - fillLabel helper (server copy with :placeholders)
  - ghostLayout (layoutGhostsForDay, ghostLaneWidth, GHOST_MIN_HEIGHT, GHOST_MAX_LANES)
  - OutlookGhostLayer.vue (ghost blocks inside the reserved Outlook lane)
  - core seams CalendarDayColumn overlay slot + overlayLaneWidth, TimeEntryCalendar day-overlay slot + dayOverlayLane, [data-calendar-overlay] selector in useSlotSelection
affects: [03-06, 03-07, 03-08, phase-04, phase-07-merge-rehearsal]

actuals:
  tokens: 14200
  tasks: 2
  commits: 2
  plan_head_before: 3d6a905225c8bc0a4fcd5807d682efedbfb5693b
  plan_head_after: 0e50469f976032f8d2b095d5978865fd65c6a304

tech-stack:
  added: []
  patterns:
    - "Fork UI plugs into core through named slots plus optional props only; default behaviour of every core file is unchanged"
    - "Ghosts live in a reserved right-hand lane of the day column (D-23), so entries and ghosts never overlap"
    - "Pixel-based greedy lane assignment per overlap cluster, capped at 3 lanes"

key-files:
  created:
    - resources/js/m365/calendar/labels.ts
    - resources/js/m365/calendar/ghostLayout.ts
    - resources/js/m365/calendar/ghostLayout.test.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
  modified:
    - resources/js/m365/types.ts
    - resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue
    - resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue
    - resources/js/packages/ui/src/FullCalendar/useSlotSelection.ts
    - docs/m365/TOUCHED-CORE-FILES.md

key-decisions:
  - "Overlay slot props are bound through a computed object (v-bind) so the slot outlet stays on one line and the acceptance grep slot name=\"overlay\" matches after Prettier"
  - "Lane overlap is decided on drawn pixel extent, not minutes, so a ghost stretched to the 16px minimum is never covered by its neighbour; back-to-back ghosts still share a lane"
  - "The leading CalendarDays icon is always shown (it is the non-colour marker of a suggestion); the height table only changes the text lines"

patterns-established:
  - "Inline style values containing nested CSS functions (calc(max())) are asserted on SSR markup because happy-dom drops them from element.style"

requirements-completed: []

duration: 55min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 05: Outlook ghost layer in the calendar Summary

**Fork-owned ghost layer rendered through a new overlay slot of the core day column, in its own right-hand Outlook lane, with DST-correct per-day clipping, 3-lane layout, and Vitest proof that ghosts never start a selection, never overlap entries and never change totals.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 of 2
- **Files:** 5 created, 5 modified (about 14k tokens of diff at chars/4)

## Accomplishments

- Ghost blocks render in a reserved lane (`max(16px, 30%)` week, `min(240px, 25%)` day, flush right at 2px); on days with a lane the core events container gets `right: calc(<lane> + 4px)`, days without ghosts render exactly as upstream.
- A ghost exactly overlapping a logged entry renders beside it with the entry's top and height, is clickable, and a pointerdown on it starts no selection while the entry still emits event-pointerdown and its end resizer emits resizer-pointerdown (D-01).
- Positions come from `getLocalizedDayJs` and wall-clock minutes: S2 occurrences (08:00Z on 2026-10-20, 09:00Z on 2026-10-27) both land at 10:00 Europe/Madrid, spring-forward 01:30Z lands at 03:30, Graph 7-digit fractions parse, overnight meetings clip per day with square corners on the clipped side.
- Lanes: sorted by start, end, id; greedy per cluster; capped at 3 (five overlapping -> 0,1,2,2,2); back-to-back share a lane; 16px minimum height; zero-length meetings drawn at minimum height when visible.
- Content by height per UI-SPEC (icon + subject; time inline in day view at 24-39px; time line at 40px+; organizer in day view at 40px+; trailing Video icon for online meetings); meeting text only via interpolation (HTML subject stays literal).
- `useCalendarEvents` dailyTotals and week sum are deep-equal with and without injected ghosts.
- Three core seams are additive and ledgered in `docs/m365/TOUCHED-CORE-FILES.md` (retitled for Phases 2 and 3; `resources/js/m365/calendar/` added to the fork-owned table).

## Task Commits

1. **Task 1: ghost lane tracer (types, labels, layout, component, core seams, ledger, pointer/inset tests)** - `6c06d62e` (feat)
2. **Task 2: geometry, lanes, content by height, D-01 and totals tests** - `0e50469f` (feat)

Tracer gate: Task 1 verify (vitest + vue-tsc) re-run green before expansion (also verified the selector test fails when the `[data-calendar-overlay]` selector is removed).

## CI Gates (pushed HEAD 0e50469f)

- **Gate A:** `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success` (exact match)
- **Gate C:** `NPM Build=success;NPM Format Check=success;NPM Lint=success;NPM Typecheck=success;Playwright Tests=success` (exact match; existing calendar Playwright suite green with the new seams)
- Combined nine-workflow plan gate printed exactly the nine `=success` entries.
- **Gate F (local):** vitest `resources/js/m365` 43/43 (full suite 249/249), `vue-tsc` clean, eslint clean, prettier clean.

Acceptance greps: data-calendar-overlay in useSlotSelection 1; `slot name="overlay"` 1; overlayLaneWidth in CalendarDayColumn 3; day-overlay in TimeEntryCalendar 3; dayOverlayLane 2; ledger mentions all three core files; `min(240px, 25%)` 1; `max(16px, 30%)` 1; v-html in resources/js/m365 0; GHOST_MIN_HEIGHT = 16 and GHOST_MAX_LANES = 3 once each; Europe/Madrid and 2026-10-27T09:00:00Z present in ghostLayout.test.ts; both named tests present once; `it(` count in ghostLayout.test.ts 13 (>= 7).

## Decisions Made

See key-decisions. CAL-01 and CAL-02 are NOT marked complete here: this plan delivers the layer and seams but the data wiring into the Calendar page (shared prop, query, sync) is 03-06, so the requirements are only fully delivered once ghosts actually appear. SYNC-04 was already Complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] happy-dom drops `calc(max(...))` inline styles**
- **Found during:** Task 1 (first test run)
- **Issue:** `element.style.right = 'calc(max(16px, 30%) + 4px)'` is discarded by happy-dom, so the planned DOM assertion on the events container `right` and layer `width` could not pass although the browser value is correct.
- **Fix:** assert those two inline styles on `renderToString` (vue/server-renderer) markup, where the values are emitted verbatim; pointer and geometry assertions stay on mounted DOM.
- **Files modified:** resources/js/m365/calendar/OutlookGhostLayer.test.ts
- **Commit:** 6c06d62e

**2. [Rule 1 - Bug] Zero-length meeting outside the visible window was drawn**
- **Found during:** Task 2 test run
- **Issue:** the visibility check used the clamped start, so a 04:00 point meeting was clamped into an 08:00 window and rendered.
- **Fix:** check the unclamped start minute against the visible window.
- **Files modified:** resources/js/m365/calendar/ghostLayout.ts
- **Commit:** 0e50469f (fixed before the commit)

### Notes

- `CalendarDayColumn` slot props moved into a computed `overlaySlotProps` bound with `v-bind`, because Prettier splits a multi-attribute `<slot>` over lines and the plan's acceptance grep `slot name="overlay"` needs it on one line. Behaviour identical; consumers read camelCase props (dayStr, isDayView, hasActivityStatus, totalGridHeight, overlayLaneWidth).
- Prettier reformatted only my own edits in the two core `.vue` files (verified by diff stat).
- The dismissed-meeting visual variant (dotted border, EyeOff, 25% fill, `dismissed_suffix` in the aria-label) is not part of this plan's behaviours and is left to 03-06; the layer renders whatever meetings it is given.
- Right-click on a ghost opens the same calendar context menu as an empty grid area (the core handler only special-cases `[data-event-id]`); left as is, outside the plan.
- Orchestrator-owned dirty files were left alone; `git pull --rebase` was up to date and the push was a plain fast-forward (`3d6a9052..0e50469f`).

## Issues Encountered

None.

## Threat Flags

None. T-03-15 mitigated (text interpolation only, zero `v-html` in resources/js/m365, HTML-subject test); T-03-16 mitigated (selector early return, no event-block hooks on ghosts, lane keeps ghosts and entries disjoint, pointer and geometry tests).

## Known Stubs

None. The layer is not yet mounted by the Calendar page (03-06 wires data); that is the planned next step, not a stub.

## Next Phase Readiness

03-06 can pass `#day-overlay="{ dayStr, isDayView, overlayLaneWidth, minutesToPixels, settings }"` to `TimeEntryCalendar` with `OutlookGhostLayer` and supply `:day-overlay-lane="(dayStr, isDayView) => hasGhosts(dayStr) ? ghostLaneWidth(isDayView) : null"`; popover (03-07/08) can attach to the `.m365-ghost` / `data-calendar-overlay` elements.

## Self-Check: PASSED

All five created files exist; commits 6c06d62e and 0e50469f are ancestors of HEAD and on origin/feature/m365-integration; CI gates A and C matched exactly.
