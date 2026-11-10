---
phase: 03-outlook-meetings-in-the-calendar
plan: 10
subsystem: calendar-ui
tags: [outlook, dismissed, restore, settings-slot, localstorage, optimistic-update, a11y, vue]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: DELETE /m365/meetings/{meeting}/dismiss and include_dismissed on the read, OutlookGhostDetail with restore emit, composable dismiss with rollback and announcement (03-09); OUTLOOK_MEETINGS_KEY context, labels incl. restore copy, toolbar-extra slot chain (03-06, 03-07)
provides:
  - settings-extra slot in CalendarSettingsPopover (Separator plus slot, only when filled), forwarded through CalendarToolbar and TimeEntryCalendar, filled by Calendar.vue for the connected and reconnect states
  - OutlookDismissedSetting.vue (heading, labelled Switch, helper text) bound to the composable's includeDismissed
  - includeDismissed (useLocalStorage solidtime:m365-show-dismissed, default off) in the query key and the GET params (include_dismissed=1 only when on); toggling never syncs
  - restore(id) in the composable and restoreMeeting in meetingsApi (DELETE), shared optimistic path with dismiss
  - dismissed ghost variant (m365-ghost--dismissed: dotted border, 25% fill, EyeOff icon, ", dismissed" aria-label suffix) and Restore wired from the panel
affects: [04-assign-to-project, 05-series-actions]

actuals:
  tokens: 7800
  tasks: 2
  commits: 2
  plan_head_before: ec8d9ae6b7eba5689195b9a9d16599cc413fd077
  plan_head_after: 34896c2317dd2770088bd70f7a361384ace3b1bd

tech-stack:
  added: []
  patterns:
    - "Conditional slot forwarding (<template v-if=\"$slots[...]\" #slot>) keeps the core component identical to upstream when the fork fills nothing"
    - "One optimistic path for dismiss and restore: snapshot of the single meeting, flag it (switch on) or remove it (switch off), roll that meeting back on failure"
    - "The view preference is part of the TanStack query key, so a toggle reads the other variant without touching the sync pipeline"

key-files:
  created:
    - resources/js/m365/calendar/OutlookDismissedSetting.vue
    - resources/js/m365/calendar/OutlookDismissedSetting.test.ts
  modified:
    - resources/js/packages/ui/src/FullCalendar/CalendarSettingsPopover.vue
    - resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue
    - resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue
    - resources/js/Pages/Calendar.vue
    - docs/m365/TOUCHED-CORE-FILES.md
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - resources/js/m365/calendar/meetingsApi.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts

key-decisions:
  - "includeDismissed is part of the meetings query key ([m365, meetings, weekStart, flag]); the sync mutation and the auto-sync freshness check still key on the week prefix, so toggling the switch never POSTs a sync"
  - "visibleCount (status line 'no meetings') now counts dismissed meetings while they are shown, matching the UI-SPEC rule that they only do not count while the switch is off (revisits the 03-09 note)"
  - "isBucketFresh reads every cached variant of the week (with and without dismissed) and takes the newest last_synced_at, so a toggle does not defeat the auto-sync skip"
  - "A failed dismiss or restore restores only the snapshot of that one meeting (replace in place, or re-add when it had been removed), then invalidates the read"
  - "Focus: restore, and dismiss while dismissed meetings are shown, focus the same ghost by data-ghost-id after a tick; a dismiss that removes the ghost keeps the 03-09 behaviour (next ghost, else Sync button)"

patterns-established:
  - "settings-extra slot is the extension point for further fork settings in the calendar popover"

requirements-completed: [CAL-04]

duration: ~35 min
completed: 2026-11-10
status: complete
---

# Phase 3 Plan 10: Show dismissed meetings and Restore Summary

**Dismissing an Outlook suggestion is now reversible from the calendar itself: a "Show dismissed meetings" switch in the settings popover (remembered per browser) brings dismissed ghosts back as a dotted EyeOff variant with a Restore action, through an additive `settings-extra` slot chain that leaves the upstream popover untouched.**

## Performance

- **Tasks:** 2 (Task 1 tracer, Task 2 auto), each committed on its own
- **Files:** 2 created, 10 modified (frontend and ledger only; no PHP)

## Accomplishments

- Slot chain: `CalendarSettingsPopover` renders `<Separator class="my-4" />` plus the `settings-extra` slot only when the slot is filled; `CalendarToolbar` and `TimeEntryCalendar` forward it conditionally; `Calendar.vue` fills it with `OutlookDismissedSetting` when the calendar prop exists and the state is not `not_connected`.
- `OutlookDismissedSetting`: "Outlook meetings" heading, `Field` row with `FieldLabel` (for/id via `useId`) and the shared `Switch`, helper text in `FieldDescription`; renders nothing without the injected context.
- Composable: `includeDismissed` via `useLocalStorage('solidtime:m365-show-dismissed', false)`, in the query key and sent as `include_dismissed=1` only when on. `dismiss` and `restore` share `changeDismissal` (optimistic flag/remove, DELETE or POST, snapshot rollback with the documented error toast, polite announcement, no success toast).
- Ghost layer: dismissed variant (class `m365-ghost--dismissed`, dotted border, 25% fill via scoped style, `EyeOff` instead of `CalendarDays`, `aria-label` suffix from `labels.dismissed_suffix`), panel `restore` wired to `context.restore`, focus kept on the same ghost after a restore or a dismiss with the switch on.
- Ledger rows added for `CalendarSettingsPopover.vue` and extended for `CalendarToolbar.vue`, `TimeEntryCalendar.vue` and `Calendar.vue`.

## Task Commits

1. **Task 1: settings slot chain, switch, include_dismissed read, restore API and composable** - `098d3d36` (feat)
2. **Task 2: dismissed variant, Restore wiring, focus handling** - `34896c23` (feat)

## Verification (local gates, actual results)

| Gate | Result |
| --- | --- |
| `npx vitest run` (whole suite) | 24 files, 355 tests passed |
| `npm run type-check` (vue-tsc) | exit 0 |
| `npx tsc --noEmit` (parallel-run addition) | exit 0 |
| `npx eslint resources/js/m365 resources/js/Pages/Calendar.vue resources/js/packages/ui/src/FullCalendar` | exit 0 |
| `npx prettier --check` same paths | all files formatted |
| Acceptance greps | settings-extra 2/2/2 in popover/toolbar/calendar component; OutlookDismissedSetting 2 in Calendar.vue; storage key 1; ledger row present; `m365-ghost--dismissed` 3; `EyeOff` 2; `restoreMeeting` 2; failed-restore test name 1 |
| CI (nine workflows) | deferred to orchestrator combined gate (wave 9) |

New tests: `OutlookDismissedSetting.test.ts` (7, including the upstream-identical popover control and the toolbar forwarding), 7 composable cases (default off, include_dismissed param and no sync, visibleCount, dismiss flagging, restore optimistic plus announcement and no toast, failed restore rollback `a failed restore puts the ghost back in the dismissed state`, failed dismiss rollback), 4 layer cases (variant, Restore with focus, dismiss-with-switch-on focus, switch-off focus unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Auto-sync freshness check would have missed the new cache key shape**
- **Found during:** Task 1
- **Issue:** Adding the flag to the query key made `isBucketFresh` (which read the exact `[m365, meetings, weekStart]` key) always miss, so toggling the switch could cause an unneeded sync decision.
- **Fix:** read all cached variants of the week by key prefix and use the newest `last_synced_at`.
- **Files modified:** `resources/js/m365/calendar/useOutlookMeetings.ts`
- **Commit:** `098d3d36`

**2. [Rule 2 - Missing functionality] visibleCount with dismissed meetings shown**
- **Found during:** Task 1 (follow-up note from 03-09)
- **Issue:** With the switch on and only dismissed meetings in the range the status line would have claimed "no meetings".
- **Fix:** `visibleCount` excludes dismissed meetings only while the switch is off.
- **Commit:** `098d3d36`

**3. Task split detail:** the plan lists `useOutlookMeetings.test.ts` under Task 2, but the restore/rollback composable cases were written with the composable in Task 1 (same slice, same commit). Task 2 holds the layer work and its tests.

Otherwise the plan was executed as written. No PHP, STATE, ROADMAP or REQUIREMENTS files were touched (parallel-run rule).

## Auth gates

None.

## Known Stubs

None. No placeholder data or unwired components were introduced.

## Threat Flags

None. No new endpoint or trust boundary beyond the plan's register (DELETE dismiss was added in 03-09; the localStorage preference only affects the user's own view). T-03-25 mitigated: reversible by design, rollback on failed restore.

## Notes for the orchestrator

- **Requirements:** CAL-04 (dismiss and restore, D-08) is fully delivered on the frontend side by this plan together with 03-09's endpoints; `requirements-completed: [CAL-04]`.
- **Known carry-over (not fixed here, out of this plan's file list):** when the last ghost of a day is dismissed and the Sync button is disabled (cooldown) focus cannot land on it (03-09 note). Unchanged by this plan.
- **Minor behaviour to be aware of:** toggling the switch shows the previous variant's data as placeholder while the other variant loads, so the "last synced" status text can blank for the duration of that request (`isPlaceholderData`). Cosmetic, left as is.
- Push and CI: nothing pushed; the two commits are local on `feature/m365-integration`.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookDismissedSetting.vue
- FOUND: resources/js/m365/calendar/OutlookDismissedSetting.test.ts
- FOUND commit 098d3d36 and 34896c23 (ancestors of HEAD)

## CI result (orchestrator combined gate, wave 9)

Nine workflows green at 7cab2150 (after test-only fix 7cab2150 for OutlookMeetingPrivacyTest guard switch); all 24 Microsoft365 feature classes PASS x3 Postgres.
