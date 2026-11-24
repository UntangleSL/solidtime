---
phase: 06-out-of-sync-detection
plan: 17
subsystem: m365-calendar-e2e
tags: [outlook, out-of-sync, playwright, e2e, d-03]
requires: [06-11, 06-12, 06-13, 06-14, 06-16]
provides:
  - "e2e/outlook-out-of-sync.spec.ts: seven browser proofs of the Phase 6 flows on injected flags and meetings with real entries"
affects: [06-18]
requirements-completed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created:
    - e2e/outlook-out-of-sync.spec.ts
  modified: []
decisions:
  - "LABELS carries the whole English microsoft365.calendar.* block (generated from lang/en/microsoft365.php). In CI the calendar prop is absent, so the injected labels are the only copy the components get, and a partial set would show 'undefined' in the panel (cancel, retry_body, move_entry_from ...)"
  - "Fork routes are answered by page.route handlers that do the real core calls: adjust and move PUT the entry to the new slot, convert POSTs a new entry, keep only records. Delete is never routed and goes through the real core DELETE"
  - "The week jump's focus on the entry is recorded with a focusin listener, because the review popover moves focus to its default button right after the jump focuses the block"
  - "D-03 entry counts filter on the test's own description, so they do not depend on entries the fixture might create"
metrics:
  duration: "~35 min"
  tasks: 3
  files: 1
estimate:
  tokens: 75000
actuals:
  tokens: 11600
  tasks: 3
  commits: 3
plan_head_before: 758967110a53ceac85b1ec058806841649ef05b7
plan_head_after: 2744091cc5ff3260cefad32343cbe7cc51e43992
---

# Phase 6 Plan 17: Browser proofs of the out-of-sync review Summary

`e2e/outlook-out-of-sync.spec.ts` covers every Phase 6 user path in a real browser on the CI calendar, where the integration is off. Flags and moved meetings are injected through `window.__TEST_SET_OUTLOOK_MEETINGS__` onto real time entries. The fork endpoints are answered by `page.route` handlers that make the real core `/api/v1` calls. Delete goes through the real core API.

## What was built

The spec follows the structure of 04-08 and 05-13:
- header comment and `test.beforeEach(showCalendarWeekends)`
- `LABELS` and the helpers `injectFlags`, `routeFlagActions`, `routeMoves`, `routeConversions`, `flagFor`, `movedMeeting`, `utcDay` and `shortDay`

Every test waits for a visible UI result of each intercepted request (popover closed, marker or meeting gone, counter changed) before it ends.

| # | Test | Proves |
|---|------|--------|
| 1 | reviews a moved flag from its marker and adjusts the entry to Outlook (tracer) | Clicking the marker opens the popover (moved, entry anchor) and not the core edit modal. Before, Now and Your entry show the right times. Adjust makes a routed POST `/m365/out-of-sync/{id}/adjust`, which does the real PUT to 13:00-14:00. The popover and marker go away, the toast shows, the API reads 13:00 and the block sits on the 13:00 row. Clicking the entry body still opens the edit modal |
| 2 | keeps a moved flag as it is | Keep makes a routed POST `/keep`. The marker and counter go away, the entry times stay the same (API and block position), and there is no failure or adjust toast |
| 3 | deletes a cancelled flagged entry only after confirming | The counter shows `data-count` 2 with its count and aria-label. Delete entry, then Cancel: the question closes and the entry stays (API and block). Delete entry, then Delete: the real core DELETE returns 204, the entry leaves the API listing, the counter drops to 1 and the toast shows. Keep on the removed flag hides the counter |
| 4 | jumps to the first flagged entry in another week without reloading | Next week's header shows up, the popover opens with `data-anchor="entry"` and without the "not in view" note, and the block took focus (focusin record). A window marker survives, so the page did not reload |
| 5 | opens the review from the entry context menu | "Review Outlook change" is the first menu item, above core Edit. It opens the entry-anchored popover and not the edit modal |
| 6 | moves my logged entry to a meeting that moved after it started | The ghost has `data-moved-from` and an aria-label ending ", already logged on <yesterday>". The panel shows the moved block. "Move my entry here" makes a routed POST `/meetings/{id}/move-entry`, which does the real PUT. The meeting leaves the lane, the toast shows, the entry sits at today 15:00-16:00, and there is still only one entry |
| 7 | creates a second entry for a meeting that moved after it started | "Create time entry" opens a form prefilled with 15:00-16:00 and a project. The routed convert creates a second real entry at today 15:00. The logged entry stays at yesterday 10:00 and no move request is sent |

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ee4b2184 | test(06-17): browser proof that a moved flag is reviewed from its marker and adjusted to Outlook |
| 2 | c859ee81 | test(06-17): browser proofs of Keep, the confirmed Delete with the counter, the week jump and the entry menu |
| 3 | 2744091c | test(06-17): browser proofs of D-03 Move my entry here and a second entry |

## Gates

- Local:
  - `npx eslint e2e/outlook-out-of-sync.spec.ts`: clean
  - `npx prettier --check`: clean
  - `npx playwright test e2e/outlook-out-of-sync.spec.ts --list --project=chromium`: 7 tests listed after Task 3 (1 after Task 1, 5 after Task 2)
- tsc: the repo `tsconfig.json` does not include `e2e/`. I ran a temporary scratchpad tsconfig that extends it with this spec and `outlook-convert.spec.ts`. It reports 0 errors in either spec. The `e2e/utils` and `playwright/` files report errors there that already existed, because `@types/node` is not resolved in that setup. Playwright compiles specs with its own loader.
- Acceptance greps:
  - `outOfSyncUrl`: 8
  - `showCalendarWeekends`: 2
  - `outlook-sync-flag-delete-cancel`: 1
  - `outlook-out-of-sync`: 2
  - `move-entry`: 3
  - `data-moved-from`: 2
  - `^\s*test\(`: 7
  - spec length: 1067 lines (minimum 300)
  - `git status --porcelain -- e2e`: empty
- **Gate W+P** (nine workflows including Playwright Tests, on the merged wave-5 sha): handed over to the orchestrator. PENDING CI (orchestrator).

## Deviations from Plan

1. **The "Kept as is" announcement is not asserted** (test 2). The live region (`outlook-announcement`) is only rendered in the connected and reconnect branches of `OutlookCalendarControls`. On the CI calendar `calendar` is null, so only the counter and Confirm-all branch renders. Keep has no toast either (UI-SPEC: announcement only). The test instead checks:
   - the routed keep request
   - the marker and counter going away
   - unchanged times through the API and the block position
   - no failure toast and no adjust toast

   This is a limit of the test environment, not a product bug.
2. **[Rule 3] Environment.** I created `vendor` and `node_modules` junctions to the main checkout (gitignored, not committed) so `tsc` and the npm tools resolve from the worktree.
3. Small additions within scope:
   - The tracer sets the organization to 24-hour time, so the time assertions do not depend on the CI default.
   - The delete test also checks the counter's visible count and aria-label.

No product bugs found. Whether the flows pass in a real browser is still unproven until CI runs them.

## Known Stubs

None.

## Threat Flags

None. This is a test-only file. The hook already existed (T-06-47 accepted), and no package was installed (T-06-SC).

## Self-Check: PASSED

- FOUND: e2e/outlook-out-of-sync.spec.ts
- FOUND: ee4b2184, c859ee81, 2744091c (ancestors of HEAD)
