---
phase: 05-smart-meeting-suggestions
plan: 07
subsystem: m365-calendar-client
status: complete
tags: [m365, outlook, series, confirm, vue, typescript, vue-query]
requires: [05-04]
provides:
  - "useOutlookMeetings: confirmPreassigned (chunks of MAX_CONFIRM_BATCH = 50, results in request order), confirmOne, isConfirmPending, preassignedInRange, ignoreSeries, unignoreSeries, forgetSeries"
  - "OutlookTestHookOptions.seriesUrl"
  - "OutlookPreassignment.vue (compact / full with the why line)"
  - "Hover card Edit + one-click Confirm for pre-assigned meetings"
affects: [05-09, 05-10, 05-11, 05-12, 05-13]
requirements-completed: [RULE-01, RULE-02, RULE-04, RULE-05]
key-files:
  created:
    - resources/js/m365/calendar/OutlookPreassignment.vue
    - resources/js/m365/calendar/OutlookPreassignment.test.ts
  modified:
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - resources/js/m365/calendar/OutlookMeetingHoverCard.vue
    - resources/js/m365/calendar/OutlookMeetingHoverCard.test.ts
key-decisions:
  - "convert and confirmPreassigned share an internal send(url, body, fallback); the in-flight guard is claim/release around it so a bulk confirm claims every id up front and releases each chunk as it settles"
  - "confirmPreassigned returns [] (nothing sent) while !canAct or when any id is already in flight; confirmOne returns null in those cases"
  - "Series actions snapshot every cached meetings read and revert only the series' occurrences on failure (other meetings keep their current state)"
  - "meetings hides series_ignored occurrences unless dismissed meetings are shown (keeps the same array when nothing is hidden); visibleCount uses isFaded"
completed: 2026-11-17
duration: 13min
actuals:
  tokens: 19100
  tasks: 3
  commits: 3
plan_head_before: 7bee5345dbb5a9914789c0e34dee357cfab84647
plan_head_after: c83e4bd19a6f790619cacbf717516cedb068a102
---

# Phase 5 Plan 07: Confirm and series actions in the Outlook composable, plus the hover-card pre-assignment Summary

Pre-assigned meetings can now be confirmed in one click from the hover card (`{meeting_ids, use_series_assignment: true}` sent to the Phase 4 convert endpoint). The composable also confirms meetings in bulk, in chunks of 50. It ignores, stops ignoring and forgets a series optimistically across every cached occurrence, and it sends nothing while `canAct` is false.

## What was built

- **Composable (`useOutlookMeetings.ts`)**
  - `convert` was refactored onto a shared `send()`, which handles the cache removal and the timeEntries/goals/meetings invalidations.
  - `confirmPreassigned(ids)` sends the ids in sequential chunks of `MAX_CONFIRM_BATCH = 50` (this mirrors `MeetingConversionRequest::MAX_MEETINGS`) and merges the results in request order. If a chunk is rejected, only that chunk's ids come back as failed results (error_generic, or the message of a 422).
  - `pendingConfirmIds` is reactive and is read through `isConfirmPending(id)`. A second confirm of a pending id sends nothing.
  - `confirmOne(id)`:
    - On success it shows the `created_success` toast and announces `created_announcement`.
    - On failure it shows a toast titled `confirm_failed` with the server message, falling back to `error_generic`.
    - Without `canAct` it returns null.
  - `ignoreSeries`, `unignoreSeries` and `forgetSeries` find the occurrence's `series_key` and cancel the meeting reads. They then update every cached read: an ignore drops the occurrences from regular reads and flags them in include-dismissed reads, and a forget clears `assignment`. In test-hook mode the injected list is updated instead. Then:
    - They call the 05-04 helpers with `urls.meetings`, or with the hook's `seriesUrl`.
    - Success feedback follows UI-SPEC §5: a toast and announcement for ignore and forget, an announcement only for stop ignoring.
    - On failure the series is restored and an error toast shows `series_action_failed` / `retry_body`.
    - Finally they invalidate the meetings reads, except in test-hook mode.
  - `meetings` and `visibleCount` treat `series_ignored` like `dismissed`.
  - `preassignedInRange` lists the meetings in the visible range that are pre-assigned, not faded and not pending, in start order.
  - New test-hook option `seriesUrl`.
- **`OutlookPreassignment.vue`**
  - The compact variant has three lines: the eyebrow with a `Repeat` icon; a project line with the dot, the semibold project name and " · Client" (truncated, full text in `title`); and a detail line with task · tag count · Billable/Non-Billable.
  - The full variant adds the why line ("You logged this series to Acme Website on Tue, Nov 10.", `tabular-nums`).
  - Test ids are `outlook-preassignment` / `outlook-detail-preassignment` / `outlook-detail-why`. Values are rendered with text interpolation only; there is no v-html.
- **Hover card**
  - With `canAct` and `isPreassigned`, the card shows the compact block (`mt-4`) between the summary and the hint, plus an actions row (`mt-4`) with SecondaryButton `Pencil` Edit (`openForm`) and PrimaryButton `Check` Confirm (`confirmOne`). While the confirm is pending, Confirm shows `:loading` and is disabled.
  - Other meetings keep the Phase 4 "Create time entry". Without `canAct`, neither the block nor the buttons render.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 557d2e01 | feat(05-07): one-click Confirm of pre-assigned meetings from the hover card |
| 2 | 43293ffe | feat(05-07): pre-assignment block in the hover card |
| 3 | c83e4bd1 | feat(05-07): optimistic series actions and pre-assigned range in the composable |

## Verification

- Gate F, Task 1 (4 files): vitest passed (96), `npm run type-check` passed, `npx tsc --noEmit` passed, eslint reported nothing, prettier clean.
- Gate F, Task 2 (4 files): vitest passed (32), type-check and tsc passed, eslint and prettier clean.
- Task 3 full gate: `npx vitest run resources/js/m365` gave 24 files / 469 tests passing. type-check, tsc, `eslint resources/js/m365` and `prettier --check resources/js/m365` were all clean.
- Tracer feedback gate: Task 1's automated verify passed end-to-end before Task 2 started.
- Mutation check: removing the revert, or the series_ignored filter, makes 5 series tests fail.
- Acceptance greps (useOutlookMeetings.ts):
  - `use_series_assignment: true`: 2
  - `seriesUrl`: 4
  - ignore/unignore/forget: 12
  - `preassignedInRange`: 3
- Acceptance greps (other files):
  - `outlook-hover-confirm` in the hover card: 1
  - `confirmOne` in the hover card: 2 or more
  - In OutlookPreassignment.vue: `why_series` 1, `OutlookProjectDot` 2, `v-html=` 0
- `git status --porcelain -- resources/js/m365` was empty after the last commit.

## Deviations from Plan

1. **[Rule 3 - Blocking] Worktree junctions.** The worktree had no `node_modules` or `vendor`, so `vue-tsc` failed on `vendor/tightenco/ziggy`. I created junctions to the main checkout's `node_modules` and `vendor`. Both are gitignored and nothing was committed.
2. **[Rule 1 - Lint] One test host component.** Adding a second `defineComponent` host to OutlookMeetingHoverCard.test.ts triggered `vue/one-component-per-file` warnings. I moved both hosts into a single top-level helper, `mountStandaloneCard(item, context, slots)`. The behaviour of the existing tests is unchanged.
3. **Interpretation.** The plan says "`meetings` drops dismissed meetings when !includeDismissed", but the composable has never filtered dismissed meetings client-side (the server leaves them out). I only added the `series_ignored` filter, as Task 3 asks, and left dismissed handling as it was so existing behaviour does not change.
4. **Interpretation.** `confirmPreassigned` returns `[]` with no request while `canAct` is false (the plan only specified this for `confirmOne`). This is the D-14 gating.

## Known Stubs

None.

## Notes for downstream plans

- The block's pending spinner and `aria-busy`, the panel and menu Confirm, the series menu items and the toolbar "Confirm N" button belong to 05-09 through 05-13. They should use `isConfirmPending`, `confirmOne`, `confirmPreassigned`, `preassignedInRange` and the series actions from the injected context.
- `preassignedInRange` uses the calendar's [start, end) range. Excluding hidden weekends is left to the toolbar surface (UI-SPEC §8).

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookPreassignment.vue, OutlookPreassignment.test.ts
- FOUND commits: 557d2e01, 43293ffe, c83e4bd1 (ancestors of HEAD)
