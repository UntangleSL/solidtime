---
phase: 03-outlook-meetings-in-the-calendar
plan: 07
subsystem: ui
tags: [vue, calendar, outlook, toolbar, vitest, sync]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: sync endpoint contract and back-off (03-04), useOutlookMeetings, shared microsoft.calendar prop with 34 labels and Calendar.vue wiring (03-06)
provides:
  - OutlookCalendarControls (Sync Outlook button and persistent live status region) in the calendar toolbar
  - describeSyncStatus pure helper (syncing, synced, empty range, unavailable, no mailbox, none)
  - toolbar extra slot (CalendarToolbar) and toolbar-extra forwarding (TimeEntryCalendar), ledgered
  - composable additions: OUTLOOK_MEETINGS_KEY provide/inject, syncedAt, visibleCount, canSync, cooldownUntil, sticky connection state
affects: [03-08, 03-09, phase-07-merge-rehearsal]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2
  plan_head_before: 88f26736c7dab61b5b6d4c14ffad281543c119b3
  plan_head_after: d1339d9f86f9508a144fbb93409a1a066992af66

tech-stack:
  added: []
  patterns:
    - "Fork UI injected into core components through one named slot, forwarded only when the page provides content"
    - "Composable provides its own context object under an InjectionKey so slot components inject instead of taking props"

key-files:
  created:
    - resources/js/m365/calendar/OutlookCalendarControls.vue
    - resources/js/m365/calendar/OutlookCalendarControls.test.ts
    - resources/js/m365/calendar/syncStatus.ts
  modified:
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue
    - resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue
    - resources/js/Pages/Calendar.vue
    - docs/m365/TOUCHED-CORE-FILES.md

key-decisions:
  - "Only forced (manual) syncs honour the client cooldown; automatic range-change syncs keep their debounce, single flight and 60 s fresh-skip and are guarded server-side"
  - "A reconnect or not_connected sync answer is stored in a sticky ref, so the connection state cannot flip back during the page life"
  - "visibleCount counts non-dismissed meetings overlapping the visible range (week or day), not the whole read week, so the empty-range status is right in day view"
  - "The Sync tooltip shows the status text plus its extra sentence, because below lg that is the only place a sighted user finds the status"

patterns-established:
  - "Component tests for slot content: a harness that calls the composable and renders the component as a child, with the transport mocked and fake timers"

requirements-completed: [SYNC-02, SYNC-05]

duration: ~70min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 07: Toolbar Sync control Summary

**The calendar toolbar now has a "Sync Outlook" button (forced sync, spinner, 10 s cooldown plus retry_after back-off) and a quiet live status line (syncing, last synced, empty range, unavailable, no mailbox), injected through one ledgered toolbar slot; a lost Microsoft connection removes the button without a reload.**

## Accomplishments

- Core seams: `CalendarToolbar.vue` has `<slot name="extra" />` first in the right-hand cluster; `TimeEntryCalendar.vue` forwards `toolbar-extra` into it only when the slot is provided, so toolbars without fork content render as upstream. `Calendar.vue` fills it with `OutlookCalendarControls` only when the calendar prop exists.
- `OutlookCalendarControls.vue`: `data-testid` `outlook-calendar-controls`; persistent `role="status" aria-live="polite"` region; Sync `Button` (outline, sm) with `aria-label` from labels, `aria-busy`, disabled while syncing or cooling down, motion-safe spinning accent `RefreshCw`; amber `TriangleAlert` (stays visible when the text collapses) only for unavailable; status text `sr-only lg:not-sr-only lg:max-w-64 lg:truncate`; label hidden below md with icon-only width; Tooltip carries status text and the extra sentence. Reconnect / not_connected render no Sync control (03-08 fills those).
- `describeSyncStatus` (pure): same-day time only, otherwise short date and time; failed read, throttled and unavailable answers (including the synthetic one for a rejected request) are unavailable and never reconnect; empty range reads "No Outlook meetings in this range · Last synced :time" with the hint tooltip.
- Composable: `OUTLOOK_MEETINGS_KEY` plus `provide`, `syncedAt` (latest of read and sync answer, per week, ignoring placeholder data), `visibleCount`, `canSync` driven by one timeout, cooldown of 10 s after every settled sync (including rejected requests) extended by throttled/unavailable `retry_after`, a 429 `Retry-After` header and a read response `sync.retry_after`; a forced sync during cooldown, back-off or another sync is ignored.
- Tests: 22 in `OutlookCalendarControls.test.ts` (component, `describeSyncStatus`, and component with the real composable incl. the two named 500 / route-level 429 tests, 401/419, reconnect/not_connected override), 6 new in `useOutlookMeetings.test.ts`. Mutation checks: cooldown set to 0 failed 4 tests; removing the forced-sync guard failed 1.

## Task Commits

1. **Task 1 (tracer) and the component half of Task 2:** `19ce6cf7` (feat) - seams, controls, status helper, composable additions, ledger, controls tests
2. **Task 2 composable tests:** `d1339d9f` (test) - provide, cooldown, back-off, sticky state, synced-at tracking

Note: the two tasks were not split along the plan's boundary because the controls need the status helper and cooldown from the first commit; the tracer gate (vitest, vue-tsc) was green before expansion.

## CI Gates (pushed HEAD d1339d9f, PHPUnit Tests run unchanged from 03-06 PHP)

- **Combined nine-workflow gate (Gates A and C):** `NPM Build=success;NPM Format Check=success;NPM Lint=success;NPM Test Unit=success;NPM Typecheck=success;PHP Linting=success;PHPUnit Tests=success;Playwright Tests=success;Static code analysis (PHPStan)=success` (exact match). The first Playwright attempt had shard 5 of 8 stall about an hour at the runner setup step (nothing of the suite ran) and was cancelled; "Re-run failed jobs" on run 42088735853 passed all 8 shards.
- **Local (Gate F):** vitest `resources/js/m365` 89/89, `vue-tsc` clean, eslint clean on `resources/js/m365`, `Pages/Calendar.vue`, `FullCalendar`, prettier clean. No PHP changed.
- Acceptance greps: `slot name="extra"` 1; `toolbar-extra` 2; `OutlookCalendarControls` in Calendar.vue 2; `outlook-calendar-controls` 1; `OUTLOOK_MEETINGS_KEY` in composable 2; `CalendarToolbar.vue` in ledger 2; `export function describeSyncStatus` 1; `motion-safe:animate-spin` 1; `aria-live="polite"` 1; `text-amber-600` 1; both named status tests 1 each; `it(` in controls test 22; both named failure tests 1 each.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed as written. One flake noted: a transient runner stall in Playwright shard 5 (infrastructure, retried green).

### Notes

- A forced sync during cooldown is ignored (as planned); automatic syncs are not blocked by the client cooldown so the existing single-flight and week-navigation tests keep their meaning.
- The empty-range status requires a known last synced time; a range with no cache and no sync yet shows nothing until the automatic sync answers (then "No Outlook meetings in this range · Last synced ..."). 03-09 should revisit `visibleCount` once the "show dismissed" toggle exists (it currently excludes dismissed meetings).

## Known Stubs

None. Connect / Reconnect controls for the other states are 03-08 by plan.

## Threat Flags

None. T-03-20 mitigated (only fixed server labels in the status, no provider text or meeting data), T-03-21 mitigated (client cooldown, retry_after, fake-timer tests; server limits from 03-04).

## Self-Check: PASSED

Created files exist; commits 19ce6cf7 and d1339d9f are ancestors of HEAD and pushed; nine workflows matched exactly.
