---
phase: 04-assign-meetings-to-projects
plan: 07
subsystem: m365-calendar-frontend
status: complete
tags: [vue, outlook, fullcalendar, core-seam, vitest, ledger]
requires:
  - "04-05: OutlookSelectionBar import and element in Calendar.vue (ledgered here)"
  - "04-06: context member linkedTimeEntryIds: Readonly<Ref<string[]>>"
provides:
  - "Core slot title-prefix in FullCalendarEventContent (first item of the title row, after the break icon)"
  - "Core slot event-extra ({ timeEntry }) on CalendarDayColumn and TimeEntryCalendar"
  - "OutlookEntryBadge (data-testid outlook-entry-badge): 12px CalendarDays icon, title + sr-only 'Created from an Outlook meeting', only for linked entry ids"
  - "## Phase 4 (Assign meetings to projects) section in docs/m365/TOUCHED-CORE-FILES.md"
affects: [04-08, 04-09]
requirements-completed: [ASGN-03, ASGN-05]
key-files:
  created:
    - resources/js/m365/calendar/OutlookEntryBadge.vue
    - resources/js/m365/calendar/OutlookEntryBadge.test.ts
    - resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.test.ts
  modified:
    - resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.vue
    - resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue
    - resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue
    - resources/js/Pages/Calendar.vue
    - docs/m365/TOUCHED-CORE-FILES.md
decisions:
  - "Entry marker delivered through an additive slot chain (title-prefix / event-extra), not an isFromMeeting prop, mirroring day-overlay and keeping the marker fork-owned"
  - "Badge sr-only text is not in the entry's accessible name (core aria-label wins); accepted and recorded in the ledger to avoid a second core touch"
completed: 2026-11-17
plan_head_before: 936ba903568b81dc4748910141895c538dfe5ba2
plan_head_after: 75e65fc87c9ce25d8dc2b69837619a179ad0cac2
actuals:
  tokens: 4500
  tasks: 2
  commits: 2
---

# Phase 4 Plan 07: Outlook origin marker on converted entries Summary

Entries created from a meeting show a 12px CalendarDays icon (entry text colour, tooltip "Created from an Outlook meeting") as the first item of their title row, delivered by a small additive core slot chain plus one fork slot fill in Calendar.vue; the seam is guarded by a core-directory test and every Phase 4 core touch is ledgered.

## What was built

- **Core seam (additive, no props or logic):**
  - `FullCalendarEventContent.vue`: one `<slot name="title-prefix" />` after the break icon (1 added, 0 removed).
  - `CalendarDayColumn.vue`: the event content element opened up to fill `#title-prefix` with `<slot name="event-extra" :time-entry="dayEvent.event.timeEntry" />`, behind `v-if="$slots['event-extra']"`.
  - `TimeEntryCalendar.vue`: forwards `event-extra` to each `CalendarDayColumn`, beside the `day-overlay` forwarding.
- **Calendar.vue:** one `OutlookEntryBadge` import and one `#event-extra="{ timeEntry }"` fill gated by `outlook.labels.value`.
- **OutlookEntryBadge.vue (fork):** injects `OUTLOOK_MEETINGS_KEY`; renders only when the id is in `linkedTimeEntryIds` and the `from_meeting` label exists; `aria-hidden` icon with `w-3 h-3 shrink-0` and no colour of its own, `title` tooltip, `sr-only` span. Because it keys on the entry id, it survives edits and drags (D-05) and goes with a deleted entry.
- **Tests:** `OutlookEntryBadge.test.ts` (linked, unlinked, reactive id list, no context); `FullCalendarEventContent.test.ts` (title row unchanged without content, break icon order, prefix content first).
- **Ledger:** `## Phase 4 (Assign meetings to projects)` with core edits (incl. the 04-05 selection bar lines and the 04-07 badge lines in Calendar.vue), the new core-directory test, the 44-key lang note, fork-owned paths (incl. `e2e/outlook-convert.spec.ts` from 04-08), hot files not touched (verified against `git diff --name-only 10e21212~1..HEAD`), and the accessible-name assumption.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | 2e7272a9 | feat(04-07): show an Outlook icon on entries created from a meeting |
| 2 | 75e65fc8 | test(04-07): guard the title-prefix seam and ledger Phase 4 core touches |

## Gates

- `npx vitest run resources/js/packages/ui/src/FullCalendar resources/js/m365`: 28 files, 477 tests passed
- `npm run type-check` (vue-tsc) and `npx tsc --noEmit`: exit 0
- `npx eslint` and `npx prettier --check` over FullCalendar, m365 and Calendar.vue: clean
- `node tests/Tools/m365-spike/validate-docs.mjs secrets`: `secrets: OK (2129 checks)`
- Acceptance greps: title-prefix 1, event-extra 2 (CalendarDayColumn) / 3 (TimeEntryCalendar), OutlookEntryBadge in Calendar.vue 2, outlook-entry-badge 1; ledger heading 1, test file 2, OutlookSelectionBar 2.

## Deviations from Plan

- **Not pushed:** the plan says push in Task 2; the orchestrator brief says do not push. Commits are left local for the orchestrator.
- The ledger markdown is not Prettier-clean, but it was not before this plan either and markdown is outside the project's `format:check` globs; left as is.
- Ledger description of the edited fork files (`OutlookMeetingController`, `ShareMicrosoftInertiaData`, routes) written from the actual diff (read excludes converted meetings and returns `linked_time_entry_ids`; `urls.convert`; the convert route).

Otherwise plan executed as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookEntryBadge.vue, OutlookEntryBadge.test.ts, resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.test.ts
- FOUND: 2e7272a9, 75e65fc8 (ancestors of HEAD)
