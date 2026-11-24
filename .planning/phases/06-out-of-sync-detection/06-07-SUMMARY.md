---
phase: 06-out-of-sync-detection
plan: 07
subsystem: m365-calendar-frontend
tags: [outlook, out-of-sync, composable, vue-query, test-hook]
requires: [06-03, 06-04]
provides:
  - "OutlookMeetingsContext Phase 6 API: outOfSync, flagOf, firstOutOfSync, autoAdjustedOf, flagPanel, openFlagPanel, closeFlagPanel, keepFlag, adjustFlag, deleteFlaggedEntry, isFlagPending, moveEntry, isMovePending, jumpToFirst, jumpBusy, setCalendarNavigator"
  - "Test-hook options outOfSync, autoAdjusted, outOfSyncUrl, moveEntryUrl"
  - "Auto-adjust announcement after a watched sync"
affects: [06-11, 06-12, 06-13, 06-14, 06-15, 06-16, 06-17]
requirements-completed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created: []
  modified:
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
decisions:
  - "deleteFlaggedEntry never deletes an entry that is no longer flagged: it answers stale without a request (D-05 guard on the client, the core delete knows nothing about flags)"
  - "The toast ranges read the organization's time_format from the ['organization', id] query cache (the composable runs in Calendar.vue, above the AppLayout that provides 'organization'); 24 hours until it loads"
  - "D-19 is applied as connectionState 'not_connected'; in the reconnect state the flags stay (UI-SPEC: the counter renders in reconnect)"
  - "A repeated action while the same entry or meeting is pending returns { status: 'failed', message: '' } without a request; an empty message means nothing was sent (no inline alert)"
metrics:
  duration: "~25 min"
  tasks: 3
  files: 2
estimate:
  tokens: 95000
actuals:
  tokens: 17600
  tasks: 3
  commits: 3
plan_head_before: 6d8a5ccfbdf1339717e71ede7f3fc43c02fe503b
plan_head_after: a092afbec1b712e97592f19074cfd36ff918ab94
---

# Phase 6 Plan 07: Outlook context out-of-sync API Summary

`useOutlookMeetings` now holds the whole client side of Phase 6. It exposes the flags and silent auto-adjusts from the read, opens one review popover for the calendar, and runs Keep, Adjust and Delete plus the D-03 "Move my entry here". Every action waits for the server and gives the UI-SPEC feedback. The counter jump opens the first flagged entry, navigating to its day when the block is not on screen. A sync that adjusted entries says so once. Browser tests can drive all of it through the test hook.

## What was built

- **State (Task 1).** `outOfSync` comes from the read's `out_of_sync.items`, or from the injected list in hook mode. `flagOf` and `firstOutOfSync` (via `firstFlag`) read from it. All of them are empty while `canAct` is false (D-14) or the connection is `not_connected` (D-19); losing either also closes the popover.
- **Popover request.** `flagPanel`, `openFlagPanel` and `closeFlagPanel`. Each request gets a new `seq`. Calls for an unflagged id, or without `canAct`, are ignored.
- **Resolve actions (Tasks 1 and 2).** `keepFlag` and `adjustFlag` post to `${urls.out_of_sync}/{id}/keep|adjust`. `deleteFlaggedEntry` calls `api.deleteTimeEntry(undefined, { params: { organization, timeEntry } })`. `isFlagPending(id)` is true while an action runs.
  - On success: the flag leaves the cache or injected list, the popover for that entry closes, and `['timeEntries']`, `['goals']` and the meetings read are invalidated (the meetings read only outside hook mode).
  - Feedback per action: "Kept as is" (announcement only); "Time entry adjusted to Outlook" (toast with the new range in the full form, plus an announcement); "Time entry deleted successfully" (core toast) plus "Time entry deleted".
  - On failure: toast `osync_*_failed` with the mapped reason from `flagActionFailure`, which is also returned for the inline alert. A 404 or 409 counts as stale: `osync_stale` / `osync_stale_body` toast and a refresh.
- **D-03 move.** `moveEntry(meetingId)` posts to `${urls.organization_meetings}/{id}/move-entry`, and `isMovePending` tracks it per meeting.
  - On success the meeting leaves the lane, the moved entry id stays linked, the "Time entry moved here" toast shows "From <old range>", and "Time entry moved" is announced.
  - On failure: `move_entry_failed`. On a stale answer: the stale toast and a refresh.
- **Hook options.** `outOfSync`, `autoAdjusted`, `outOfSyncUrl`, `moveEntryUrl`. Keep, adjust and move send nothing without their url.
- **Auto-adjusts.** `autoAdjustedOf(id)` reads the read's `auto_adjusted`, or the injected list in hook mode.
- **Jump (Task 3).** `jumpToFirst` fixes its target when clicked.
  - Block rendered: it is centred (smooth only without `prefers-reduced-motion`), focused with `preventScroll`, and the popover opens with `{ anchor: 'entry', origin: 'counter' }`.
  - Block not rendered: the registered navigator gets the entry's local `YYYY-MM-DD`, then the block is polled for every 100 ms. If it has not appeared 3 s after the time-entries queries settle, the popover opens with `anchor: 'counter'`. The whole wait is capped at 15 s.
  - `jumpBusy` ignores further clicks while a jump runs. `setCalendarNavigator(fn | null)` registers or clears the navigator.
- **Sync answer.** When `auto_adjusted > 0`, time entries and goals are invalidated and `autoAdjustedAnnouncement` is announced once.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 30af9275 | feat(06-07): out-of-sync flags, review-panel request and Keep as is in the Outlook context |
| 2 | d573fab4 | feat(06-07): adjust, delete and D-03 move with the UI-SPEC feedback; Phase 6 test-hook options |
| 3 | a092afbe | feat(06-07): jump to the first flagged entry and announce silent auto-adjusts |

## Gates (local)

- `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts`: 121 passed (94 before this plan, 27 new; no existing test changed).
- `npx vitest run resources/js/m365 resources/js/Pages`: 28 files, 712 tests passed. This checks that the new static imports of `@/packages/api/src` and `@/utils/useUser` do not break the component tests that import the composable.
- `npm run type-check` (vue-tsc), `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` on both files: clean.
- CI (NPM Test Unit / Typecheck / Lint / Format inside Gate W): PENDING CI (orchestrator).

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 2 - Safety] Delete only a flagged entry.** If the flag is no longer listed, `deleteFlaggedEntry` answers stale (toast plus refresh) and sends nothing. The core endpoint would otherwise delete an entry whose flag was already resolved elsewhere (D-05, T-06-23).
2. **[Rule 2 - Consistency] On success or stale the composable also closes `flagPanel` for that entry** (UI-SPEC section 2: "Popover closes"). A successful action also drops the flag from the cache at once, so the marker and counter update before the refetch. The state still changes only after the answer.
3. **[Rule 3 - Blocking] Where the time format comes from.** The composable is created in `Calendar.vue`, above the `AppLayout` that provides `'organization'`, so `inject` would not reach it. It reads `time_format` from the `['organization', currentOrganizationId]` query cache instead, and defaults to 24 hours.
4. **The auto-adjust refresh also invalidates `['goals']`**, matching the other entry writes, since an entry's times changed.
5. **The jump wait is capped at 15 s** (`JUMP_MAX_WAIT_MS`). This keeps `jumpBusy` from sticking when a time-entries load never settles.
6. **Test fixture.** `calendarProps()` in the test file gained `out_of_sync` and `organization_meetings` urls and the Phase 6 labels. Existing exact-count assertions are unaffected: no new request or notification is made in existing flows.

## Notes for downstream plans

- 06-16 (`Calendar.vue`) must call `outlook.setCalendarNavigator((date) => calendarRef.value?.goToDate(date))` and clear it on unmount. Without it, a jump to an entry that is not rendered falls back to the counter anchor after 3 s.
- The components in 06-11..06-17 only render and emit: they read `flagPanel`, `isFlagPending`, `isMovePending` and `jumpBusy`, and use the returned `OutlookFlagActionResult` for the inline alert and focus. A `failed` result with an empty `message` means nothing was sent.
- In hook mode, Delete goes through the core API (`/api/v1/organizations/{org}/time-entries/{id}`). Playwright specs must `page.route` it or let the real core answer.

## Threat Flags

None. No new endpoints. Every request goes to routes from 06-04 and 06-10 or to the core time-entry delete, and only on an explicit call. T-06-23 and T-06-25 are mitigated as planned: nothing deletes on a read or sync, and without `canAct` there are no flags and no requests.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/useOutlookMeetings.ts
- FOUND: resources/js/m365/calendar/useOutlookMeetings.test.ts
- FOUND: 30af9275, d573fab4, a092afbe (ancestors of HEAD)
- `git status --porcelain -- resources/js/m365`: empty
