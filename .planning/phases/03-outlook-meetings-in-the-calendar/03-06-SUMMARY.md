---
phase: 03-outlook-meetings-in-the-calendar
plan: 06
subsystem: ui
tags: [vue, inertia, tanstack-query, calendar, outlook, playwright, vitest]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: GET /m365/meetings and POST /m365/meetings/sync (03-02, 03-04), calendarAccessState (03-03), ghost layer and core seams (03-05)
provides:
  - microsoft.calendar shared prop (state, URLs, 34 server-rendered labels, en + es) on the calendar route only
  - OutlookMeetingsResponse, OutlookSyncResponse, OutlookSyncStatus, OutlookConnectionState, OutlookCalendarProps types
  - meetingsApi (fetchMeetings, postSync) on the global axios
  - useOutlookMeetings (weekBucket, read query, debounced single-flight sync, dayOverlayLane, test hook)
  - Calendar.vue wiring that makes ghosts appear in their lane
  - Playwright proof that ghosts never disturb entries, totals or the create flow
affects: [03-07, 03-08, 03-09, phase-04, phase-07-merge-rehearsal]

actuals:
  tokens: 15800
  tasks: 3
  commits: 3
  plan_head_before: 23fa7a82dba919694891376d65ac97421c55fc1a
  plan_head_after: 9bb6471cc8410661ec4cd1ee6a128e9f192dba92

tech-stack:
  added: []
  patterns:
    - "Calendar copy is resolved on the server per request inside the Inertia share closure; the key set comes from the English file"
    - "Sync is a useMutation driven by a hand-written debounce + single-flight (latest bucket wins), never a useQuery"
    - "Fork test hook on window (set on mount, deleted on unmount), same contract as __TEST_SET_ACTIVITY_PERIODS__"

key-files:
  created:
    - resources/js/m365/calendar/meetingsApi.ts
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - tests/Feature/Microsoft365/OutlookCalendarPropTest.php
    - e2e/outlook-ghosts.spec.ts
  modified:
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - lang/en/microsoft365.php
    - lang/es/microsoft365.php
    - resources/js/m365/types.ts
    - resources/js/Pages/Calendar.vue
    - docs/m365/TOUCHED-CORE-FILES.md

key-decisions:
  - "A sync answer of reconnect or not_connected switches the composable's connectionState and stops further syncs; transport, 5xx, 401, 419 and 429 failures only map to unavailable and never to reconnect"
  - "The meetings read is not delayed behind the time-entry query: it is a separate non-blocking query and loading stays bound to the time entries only"
  - "A queued sync that settles behind a still-running debounce timer is left to the timer instead of firing early"

patterns-established:
  - "Fake-timer harness for composables: real QueryClient + VueQueryPlugin, mocked axios and usePage, advanceTimersByTimeAsync to flush vue-query's setTimeout(0) notifications"

requirements-completed: [CAL-01, CAL-02]

duration: ~75min
completed: 2026-11-05
status: complete
---

# Phase 3 Plan 06: Wire the ghost layer to the backend Summary

**Opening /calendar now reads the cached Outlook meetings for the visible week after the time entries, runs a debounced single-flight sync for the latest week only, and draws the meetings as ghosts in their own lane; a Playwright spec proves ghosts never change entries, totals or the create flow and that an exactly overlapping ghost stays reachable beside its entry.**

## Performance

- **Duration:** ~75 min (execution) plus CI wait
- **Tasks:** 3 of 3
- **Files:** 5 created, 6 modified (about 15.8k tokens of diff at chars/4)

## Accomplishments

- `microsoft.calendar` = `{ state, urls: { meetings, sync }, labels }` is shared only when the integration is configured, the route is `calendar` and a web user is signed in. The 34 `microsoft365.calendar.*` labels exist in English with an identical-placeholder Spanish mirror. No token, token marker or meeting data is in the payload (checked in the X-Inertia JSON).
- `useOutlookMeetings` quantizes the visible range to the user's week (DST-safe local midnights), reads `['m365','meetings', bucketStart]` (retry off, no focus refetch, 30 s stale, previous data kept) and syncs through a mutation: 400 ms trailing debounce, single flight with latest bucket wins, 60 s fresh-skip for automatic syncs, force sends 0 ms, timer cleared on unmount.
- Failure mapping (SYNC-05 client side): network error, 5xx, 401, 419 and 429 give `lastSync.status = 'unavailable'` (Retry-After header kept when numeric), the cached meetings stay, `readFailed` flags a failed read, nothing is retried and connectionState is never moved to reconnect by a session error.
- `Calendar.vue` fills the `day-overlay` slot with `OutlookGhostLayer` and passes `dayOverlayLane`; `:loading` stays `timeEntriesLoading`. Days with at least one meeting (including overnight and zero-length ones) get the lane.
- `window.__TEST_SET_OUTLOOK_MEETINGS__(meetings, labels?)` renders ghosts without Graph and is removed on unmount.
- Playwright (`e2e/outlook-ghosts.spec.ts`, 5 tests): ghosts render and `.fc-event` count and every day header stay unchanged; a click and a drag on a ghost open no dialog; an exactly overlapping ghost sits right of the entry block, accepts a trial click and the entry still opens its edit dialog; five overlapping ghosts are all reachable with Tab; with the integration off nothing Outlook-related renders and no `/m365/` request is made.

## Task Commits

1. **Task 1 (tracer): shared prop, copy, types, API helpers, composable, Calendar.vue wiring, ledger, OutlookCalendarPropTest** - `dc77368c` (feat)
2. **Task 2: debounced single-flight sync tests, failure mapping, test hook** - `306f9c03` (test)
3. **Task 3: Playwright proof and ledger row for the spec** - `9bb6471c` (test)

Tracer gate: Task 1 verify (vitest, vue-tsc, Pint, full-app PHPStan, MicrosoftLangTest) re-run green before expansion; tracer verified end to end, expanding.

## CI Gates (pushed HEAD 9bb6471c, PHPUnit Tests run 42085218734)

- **Combined nine-workflow gate:** `NPM Build=success;NPM Format Check=success;NPM Lint=success;NPM Test Unit=success;NPM Typecheck=success;PHP Linting=success;PHPUnit Tests=success;Playwright Tests=success;Static code analysis (PHPStan)=success` (exact match, covers Gates A and C).
- **Gate B:** grep count for OutlookCalendarPropTest, MicrosoftLangTest, MicrosoftAccountTest, MicrosoftLoginPageTest printed `12`.
- **Local (Gate F):** vitest `resources/js/m365` 61/61 (full suite 267/267), `vue-tsc` clean, eslint clean (including the e2e spec), prettier clean; Pint `--test` passed; PHPStan over full `app/` `[OK] No errors`; MicrosoftLangTest 4/4 locally; `playwright test --list` lists 5 tests.
- Acceptance greps: `routeIs('calendar')` 1; token names in the middleware 0; `useOutlookMeetings` in Calendar.vue 2; `day-overlay-lane` 1; `:loading="timeEntriesLoading"` 1; `'last_synced' => 'Last synced :time'` 1; `(Sin asunto)` 1; ledger mentions Calendar.vue and the spec; `__TEST_SET_OUTLOOK_MEETINGS__` in the composable 3; `refetchOnWindowFocus: false` 1; `retry: false` 2; `it(` in the test file 18; both named tests present once.

Mutation checks on the Vitest suite: debounce set to 0, single flight removed and focus refetch enabled each made the matching tests fail (the focus test initially did not, because 5 s is inside the 30 s staleTime; fixed by advancing past it).

## Decisions Made

See key-decisions. CAL-01 and CAL-02 are marked complete: ghosts now render in week and day views as distinct blocks that are not in totals, cannot be dragged or resized and do not interfere with entries, proven in a real browser. SYNC-02 stays pending: the Sync button and its cooldown UI are 03-07 (the composable already exposes `requestSync(force)`, `isSyncing`, `lastSync`). SYNC-01 was already complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Focus-refetch test could not fail**
- **Found during:** Task 2 mutation check
- **Issue:** the test advanced only 5 s, inside the 30 s staleTime, so `refetchOnWindowFocus: true` would not have refetched anyway.
- **Fix:** advance 31 s before dispatching focus and visibilitychange events.
- **Files modified:** resources/js/m365/calendar/useOutlookMeetings.test.ts
- **Commit:** 306f9c03

**2. [Rule 1 - Bug] Acceptance grep for the test hook**
- **Issue:** a name constant left the literal `__TEST_SET_OUTLOOK_MEETINGS__` once in the composable (criteria needs at least 2: set and delete).
- **Fix:** typed `TestWindow` interface with direct property assignment and `delete`.
- **Commit:** 306f9c03

### Notes

- The meetings read is not artificially ordered after the time-entry request; both start on the first dates-change, the time-entry query first. The requirement that matters (no blocking, `loading` untouched) holds.
- `useOutlookMeetings` takes `calendarEnd` only as the signal that the calendar reported a range; the bucket comes from the start.
- The Playwright suite cannot run locally (needs the app and Postgres); it ran green in CI (8 shards).
- Working tree is CRLF under `core.autocrlf` while `.gitattributes` forces LF in the index; git warns but commits LF.

## Issues Encountered

None blocking. Heredoc Python with triple quotes was rejected by the shell once; the lang edits were redone with the Edit tool.

## Known Stubs

None. The Sync button, status messages and popover are later plans (03-07 to 03-09), not stubs here.

## Threat Flags

None beyond the plan register: T-03-17 mitigated (state, URLs and labels only, computed per request in the share closure, test for token markers and column names, Octane flush test), T-03-18 mitigated (debounce, single flight, 60 s skip, no focus refetch, no retries, fake-timer tests).

## Next Phase Readiness

03-07 can add the Sync button on `outlook.requestSync(true)`, read `isSyncing`, `lastSync` (status, retry_after, last_synced_at), `readFailed`, `connectionState` and the labels from the composable; the shared prop already carries every copy key, so later plans add no copy.

## Self-Check: PASSED

All created files exist on disk; commits dc77368c, 306f9c03 and 9bb6471c are ancestors of HEAD and pushed; the nine workflows and Gate B matched exactly.
