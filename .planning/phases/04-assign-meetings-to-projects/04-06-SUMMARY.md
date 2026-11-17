---
phase: 04-assign-meetings-to-projects
plan: 06
subsystem: m365-calendar-frontend
status: complete
tags: [vue, outlook, tanstack-query, test-hook, vitest]
requires:
  - "04-02 server contract (same wave): GET /m365/meetings returns top-level linked_time_entry_ids: string[]"
  - "04-03 context: convert, selection, openForm, canAct, MEETINGS_QUERY_KEY, __TEST_SET_OUTLOOK_MEETINGS__"
provides:
  - "Debounced (500 ms) meetings refresh after successful refetches of loaded ['timeEntries', ...] queries (ASGN-05, D-05)"
  - "fetchMeetings parses linked_time_entry_ids (string[] or [])"
  - "Context member linkedTimeEntryIds: Readonly<Ref<string[]>> (D-04 data for the Outlook icon, 04-07)"
  - "Test hook __TEST_SET_OUTLOOK_MEETINGS__(meetings, labels?, options?: { actions?, convertUrl?, linkedTimeEntryIds? }) (for 04-08)"
  - "Exported type OutlookTestHookOptions"
affects: [04-07, 04-08]
requirements-completed: [ASGN-05]
key-files:
  created:
    - resources/js/m365/calendar/meetingsApi.test.ts
  modified:
    - resources/js/m365/types.ts
    - resources/js/m365/calendar/meetingsApi.ts
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
decisions:
  - "Refresh trigger: QueryCache 'updated' event, action success and not manual (setQueryData writes ignored), key[0] === 'timeEntries', state.dataUpdateCount >= 2 (first load of a week ignored)"
  - "In test-hook mode canAct = options.actions === true, independent of the microsoft calendar prop: the CI Playwright environment has the integration off, so the prop is absent there"
  - "A server conversion also appends the new time_entry_ids to linked_time_entry_ids of every cached read (optimistic, the meetings refetch confirms), so the Outlook icon appears without waiting"
  - "Test-hook conversions update the injected list and linked ids only; they invalidate timeEntries and goals but not the real meetings read"
  - "OutlookMeetingsResponse.linked_time_entry_ids is optional in the type (fetchMeetings always sets it)"
metrics:
  completed: 2026-11-17
completed: 2026-11-17
commits: 2
plan_head_before: fbda4b784bcddd866ba53f55fdb6d4dc20074557
plan_head_after: 0c783b87
actuals:
  tasks: 2
  commits: 2
  tokens: 9000
---

# Phase 04 Plan 06: Meetings refresh, linked entry ids and acting test hook Summary

The meetings lane now refreshes itself (debounced 500 ms) whenever the calendar's time entries refetch after a change, so deleting an entry created from a meeting brings the meeting back without a reload; the context exposes the server's `linked_time_entry_ids` as `linkedTimeEntryIds`; and the test hook can drive real conversions for Playwright.

## What was built

- **Debounced refresh (Task 1, tracer).** `useOutlookMeetings` subscribes to `queryClient.getQueryCache()`. A successful, non-manual fetch of a `['timeEntries', ...]` query whose `dataUpdateCount` is 2 or more schedules one `invalidateQueries(['m365','meetings'])` 500 ms later; bursts restart the timer. First loads (week navigation), failures, unrelated keys, `setQueryData` writes, test-hook mode and a missing calendar prop trigger nothing. Unmount unsubscribes and clears the timer.
- **Linked entry ids (Task 2).** `fetchMeetings` returns `linked_time_entry_ids` (anything other than an array of strings becomes `[]`). Context `linkedTimeEntryIds` = read ids (placeholder data kept, like the meetings), or in test-hook mode the injected list plus ids converted since. Server conversions add the new entry ids to every cached read immediately.
- **Test hook third argument.** `{ actions, convertUrl, linkedTimeEntryIds }`. With `actions: true`, `canAct` is true, selection and `openForm` work, `convert` posts to `convertUrl`, created/existing results remove the meeting from the injected list, add their entry ids to `linkedTimeEntryIds`, leave the selection and invalidate `timeEntries` and `goals`. Without the argument nothing changes (existing `e2e/outlook-ghosts.spec.ts` calls keep working). Without a `convertUrl` it sends nothing and returns failed results.

## Commits

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | 8bac6bc1 | feat(04-06): refresh the meetings read after time-entry refetches |
| 2 | 0c783b87 | feat(04-06): linked entry ids from the meetings read and an acting test hook |

## Gates

- `npx vitest run resources/js/m365`: 17 files, 342 tests passed (new: 6 refresh tests, 9 linked/test-hook tests, 10 meetingsApi tests).
- `npm run type-check` (vue-tsc) and `npx tsc --noEmit`: clean.
- `npx eslint resources/js/m365`, `npx prettier --check resources/js/m365`: clean.
- Tracer feedback gate (auto): Task 1 verify re-run end-to-end before Task 2, passed.
- No PHP touched; no push (orchestrator owns the wave-2 CI gate).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `OutlookMeetingsResponse.linked_time_entry_ids` declared optional**
- **Found during:** Task 2
- **Issue:** A required field breaks the type-check of `OutlookCalendarControls.test.ts` (fixture without the field), a file outside this plan.
- **Fix:** Optional in the type with a comment; `fetchMeetings` always sets it and every reader uses `?? []`.
- **Files modified:** resources/js/m365/types.ts
- **Commit:** 0c783b87

**2. [Rule 2 - Correctness] Test-hook `canAct` does not require the calendar prop**
- **Found during:** Task 2
- **Issue:** The plan's `canAct` rule would stay false in CI, where the integration is off and the `microsoft.calendar` prop is absent (see the header of `e2e/outlook-ghosts.spec.ts`), so 04-08 could not exercise conversions.
- **Fix:** `canAct = testMeetings !== null ? actions : calendar !== null`; covered by a test without the calendar prop. 04-08 must route `convertUrl` (for example with `page.route`) because the real endpoint answers 404 while the integration is off.
- **Commit:** 0c783b87

**3. [Rule 2 - Enhancement within scope] Optimistic linked ids after a server conversion**
- The converted entry ids are added to the cached reads together with the meeting removal, so the icon (04-07) does not wait for the refetch. Covered by a test.

**4. [Environment] vendor junction created in the worktree**
- `vue-tsc` failed on `../../vendor/tightenco/ziggy` because the worktree had no `vendor`; created a gitignored junction to the main checkout's `vendor` (no tracked change).

The plan's push step was not run, as the orchestrator brief instructed (commit only).

## Known Stubs

None.

## Threat Flags

None. T-04-23 (500 ms debounce, refetch-only, skipped in test mode), T-04-24 (hook acts only with `actions: true`, posts only to the URL test code passes; the endpoint stays authenticated) and T-04-25 (defensive `string[]` parsing) are mitigated as planned.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/meetingsApi.test.ts
- FOUND: 8bac6bc1, 0c783b87 (ancestors of HEAD)
- Acceptance greps: getQueryCache 1, dataUpdateCount 2, linked_time_entry_ids in meetingsApi.ts 1, linkedTimeEntryIds 6, convertUrl 3; `git status --porcelain -- resources/js/m365` empty
