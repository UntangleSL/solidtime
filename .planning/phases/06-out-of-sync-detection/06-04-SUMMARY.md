---
phase: 06-out-of-sync-detection
plan: 04
subsystem: m365-calendar-client
tags: [outlook, out-of-sync, axios, accessibility, aria-describedby, contrast, vitest]
status: complete
requires: []
provides:
  - "keepFlag / adjustFlag / moveEntry (conversionApi.ts)"
  - "flagActionFailure + OutlookFlagActionResult (conversionApi.ts)"
  - "describeBlock (describeBlock.ts)"
  - "Phase 6 amber contrast rows (contrast.test.ts)"
affects: [06-07, 06-10, wave-3 out-of-sync components]
requirements-completed: [OSYNC-01, OSYNC-03]
completed: 2026-11-24
tech-stack:
  added: []
  patterns:
    - "Fork web-route calls on the global axios instance, ids encodeURIComponent-ed into one segment"
    - "Runtime aria-describedby hookup on core blocks instead of editing core components"
key-files:
  created:
    - resources/js/m365/calendar/describeBlock.ts
    - resources/js/m365/calendar/describeBlock.test.ts
  modified:
    - resources/js/m365/calendar/conversionApi.ts
    - resources/js/m365/calendar/conversionApi.test.ts
    - resources/js/branding/contrast.test.ts
decisions:
  - "flagActionFailure reuses conversionErrorMessage for the 422 branch, so a blank 422 message falls back to the retry copy"
  - "describeBlock returns a no-op remover when the id is already in the list, so it never removes an id it did not add"
  - "describeBlock captures the block at add time, so the remover still works after the marker is detached on unmount"
metrics:
  duration: "~5 min"
  tasks: 2
  files: 5
estimate:
  tokens: 45000
  tasks: 2
actuals:
  tokens: 3800
  tasks: 2
  commits: 2
plan_head_before: fef7d29fe1aebc808c44d15a3f532a6f6889e3a4
plan_head_after: ca5703e9984c38886229c6cf616c1886d1c22791
---

# Phase 6 Plan 04: Out-of-sync client calls, failure mapping, aria-describedby hookup and amber contrast rows Summary

The client can now send keep, adjust and move-entry as fork POSTs. `flagActionFailure` maps their failures as the UI-SPEC says: 404 / 409 mean stale, then the 422 server message, then the forbidden copy for a 403, then the retry copy. `describeBlock` lets fork markers be announced on core entry blocks without changing core files. The amber marker and counter colours are pinned by WCAG rows in the contrast test.

## What was built

- **`conversionApi.ts`**
  - New type: `OutlookFlagActionResult` (`ok` / `failed` with a message / `stale`).
  - `keepFlag(outOfSyncUrl, entryId)` POSTs to `…/{id}/keep`.
  - `adjustFlag(outOfSyncUrl, entryId)` POSTs to `…/{id}/adjust`.
  - `moveEntry(organizationMeetingsUrl, meetingId)` POSTs to `…/{id}/move-entry`.
  - All three encode the id and reject when the request fails.
  - `flagActionFailure(error, { forbidden, retry })` maps a failure to a result. It never returns `ok` for a failure (T-06-54).
- **`describeBlock.ts`**: `describeBlock(from, id)` adds the id to the `aria-describedby` of the closest `[data-event-id]` element and returns a remover.
  - Other ids are kept, the id is never added twice, and whitespace in the list is normalised.
  - The attribute is removed once the list is empty.
  - Outside a block, or with an empty id, it does nothing.
  - The remover still works after the marker has been detached.
- **`contrast.test.ts`**: new `Phase 6 out-of-sync warning colours` block with four rows, all needing at least 3.0. Measured values:

  | Pair | Measured |
  |------|----------|
  | Light marker: amber-700 on amber-100 | 4.51 |
  | Dark marker: amber-300 on amber-950 | 10.39 |
  | Light counter icon: amber-700 on #F9FCFD | 4.87 |
  | Dark counter icon: amber-400 on #1C1C1C | 10.21 |

  A guard test also checks that #F9FCFD and #1C1C1C are still the shipped light and dark `--color-bg-primary`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 04c0bd40 | feat(06-04): keep / adjust / move-entry calls and flagActionFailure mapping |
| 2 | ca5703e9 | feat(06-04): describeBlock aria-describedby helper and amber contrast rows |

## Gates

- Vitest:
  - `conversionApi.test.ts`: 38 passed (18 new; RED confirmed before the implementation).
  - `describeBlock.test.ts`: 9 passed (RED confirmed, because the module was missing).
  - `contrast.test.ts`: all passed, including the 5 new tests.
- `npm run type-check` (vue-tsc): exit 0.
- `npx tsc --noEmit`: exit 0.
- ESLint on the 5 files: clean.
- Prettier `--check` on the 5 files: clean (after `--write` on the two source files).
- Tracer gate (Task 1): the automated verify was re-run end to end and passed before Task 2 started.
- CI (NPM workflows, Gate W): PENDING CI (Actions disabled).

## Deviations from Plan

The code follows the plan. The tests add three cases the plan did not list: an id the helper did not add is kept, the remover still works after the marker is detached, and an empty id does nothing.

## Known Stubs

None.

## TDD Gate Compliance

Each task wrote its failing tests first (RED confirmed by running them), then the implementation. Each task's tests and code went into one commit, as the executor rules ask for one commit per task.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/describeBlock.ts
- FOUND: resources/js/m365/calendar/describeBlock.test.ts
- FOUND: commit 04c0bd40 (ancestor of HEAD)
- FOUND: commit ca5703e9 (ancestor of HEAD)
- Acceptance checks:
  - `export function (keepFlag|adjustFlag|moveEntry|flagActionFailure)` count = 4.
  - `OutlookFlagActionResult` count = 2.
  - `aria-describedby` in describeBlock.ts count = 3.
  - `#B45309` in contrast.test.ts count = 1.
  - `git status --porcelain -- resources/js/m365 resources/js/branding` is empty.
