---
phase: 04-assign-meetings-to-projects
plan: 08
subsystem: m365-calendar-e2e
status: complete
tags: [playwright, e2e, outlook, conversion, multi-select, batch]
requires:
  - "04-06: test hook third argument { actions, convertUrl, linkedTimeEntryIds }"
  - "04-03/04-04/04-05: form, entry points, selection bar, batch results and their test ids"
  - "04-07 (parallel, wave 3): outlook-entry-badge inside the entry block"
provides:
  - "e2e/outlook-convert.spec.ts: 10 Chromium/Firefox tests covering single conversion, menu and hover entry points, multi-select, batch failure and retry, clearing rules, read-only mode and three 1366x768 layout backstops"
affects: [04-09]
requirements-completed: [ASGN-01, ASGN-02, ASGN-03, ASGN-04, ASGN-05]
key-files:
  created:
    - e2e/outlook-convert.spec.ts
  modified: []
decisions:
  - "The convert request is answered by page.route: per meeting it creates the real entry through POST /api/v1/organizations/{org}/time-entries (single: the body's description, start and end; batch: the meeting's subject and times) or answers the scripted 'forbidden' failure once"
  - "The core create dialog check is a MutationObserver looking for a button with the exact text 'Create Time Entry' (the fork form uses 'Create time entry' / 'Create entry')"
  - "The read-only probe (04-04 observation) is a hard assertion: the panel stays visible 500 ms after clicking a meeting without a web link"
completed: 2026-11-17
estimate:
  tokens: 70000
  tasks: 2
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 936ba903568b81dc4748910141895c538dfe5ba2
plan_head_after: 9fea7e62
---

# Phase 4 Plan 08: Browser proof of meeting conversion Summary

`e2e/outlook-convert.spec.ts` tests the whole Phase 4 UI in a real browser while the Microsoft integration is off. Meetings are injected with `{ actions: true, convertUrl }`, and `page.route` answers the convert request by creating real entries through the core API.

## What was built

Ten tests:

1. **converts a meeting from its panel into a real entry with the Outlook icon** (tracer).
   - Setup: one project and one tag created via the API; "Weekly sync" injected at 10:00-11:00 UTC.
   - Flow: click the block, then `outlook-detail-create`. The description is prefilled; start 10:00 and end 11:00. Then: project picker (listbox), tag dropdown (closed by clicking the form title), billable select, start set to 10:15. After each nested interaction the test checks that the form is still open and the earlier values are kept. Then "Create entry".
   - Request body: `meeting_ids ['m-single']`, project, tag `[id]`, billable `true`, start `...T10:15:00Z`, end `...T11:00:00Z`.
   - Result: the block and the panel are gone, the entry "Weekly sync" shows `outlook-entry-badge`, and the core "Create Time Entry" dialog never mounted.
2. **Create time entry from the context menu opens the form.** Right-click, then `outlook-menu-create`. The menu is gone and the form is inside `outlook-ghost-detail`.
3. **Create time entry from the hover card opens the form.** The card shows the select hint, then `outlook-hover-create`. The card is gone and the form is visible.
4. **assigns two selected meetings, reports a failure and retries it.**
   - Ctrl-click two of three meetings: both have `data-selected`, no panel opens, and the bar reads "2 meetings selected".
   - Open the assign popover: the rows have no `data-status` yet. Pick the project; the selection survives the picker.
   - Submit with the second meeting scripted to fail: rows show `created` and `failed` with "You can't add time to this project." and the summary reads "1 of 2 time entries created". The first block is gone and the second is still selected.
   - "Retry 1 failed": the popover and the bar disappear.
   - Both request bodies are checked, and both entries show the icon.
5. **shift-click selects a range and Escape clears it.** Ctrl-click the first meeting, Shift-click the third: 3 selected. Escape: none selected and the bar is hidden.
6. **a plain click clears the selection and opens the panel.**
7. **without actions the panel stays read-only.**
   - No third argument. The panel is still visible 500 ms after the click (probe of the 04-04 happy-dom observation) and has no create or dismiss buttons.
   - After Escape, a Ctrl-click selects nothing and opens the panel.
8. **1366x768: form popover on the last visible day at 22:00-23:00 stays inside the viewport.**
9. **1366x768: selection bar is 48px tall and covers at most 64px of the visible grid** (polled, because the bar slides in).
10. **1366x768: converting the last meeting of a day removes its lane.** Screenshots before and after are attached through `testInfo.attach`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 2d77464d | test(04-08): browser proof of converting a meeting from its panel (tracer) |
| 2 | 9fea7e62 | test(04-08): entry points, multi-select with failure and retry, read-only mode, layout backstops |

## Gates (local)

- `npx eslint e2e/outlook-convert.spec.ts`: clean. `npx prettier --check`: clean.
- `npx tsc -p <scratchpad>/tsconfig.e2e-a3a8.json` (e2e check config): 0 errors in the spec. The only errors are pre-existing strict-index errors in `e2e/utils/api.ts`, `e2e/utils/mailpit.ts` and `playwright/fixtures.ts`, which are outside this plan.
- `npx playwright test e2e/outlook-convert.spec.ts --list --project=chromium`: 10 tests listed.
- Tracer gate: Task 1 verify (eslint, prettier, listing) re-run before Task 2, passed.
- Acceptance greps:
  - `actions: true` 2
  - `page.route` 2
  - `outlook-entry-badge` 2
  - `showCalendarWeekends` 2
  - `test(` 10
  - `modifiers: ['Control']` 6
  - `outlook-batch-retry` 1
  - `width: 1366` 1
- Playwright cannot run locally. The wave-3 CI gate (NPM workflows and Playwright Tests for the merged sha with the (04-07) and (04-08) commits) is handed to the orchestrator.

## Deviations from Plan

1. **No push, no CI gate run here.** The orchestrator brief says not to push, so Task 2 steps 2 (push) and 3 (wave-3 gate) are left to the orchestrator.
2. **The Task 1 commit holds only the tracer test and its helpers.** The full spec was written first and split back for the commit. Four selector constants are not used by Task 1, so they were left out of that commit so eslint stays clean.
3. **`routeConversions(page, ctx, meetings)` scripts failures through a returned `failOnce` set** instead of the plan's `outcome?` argument. This lets the retry in the same test succeed.
4. **[Environment]** A gitignored `node_modules` junction to the main checkout was created to run the gates. The worktree started on an old upstream commit; it was clean, so it was reset to BASE 936ba903 as instructed.

## Open items

- **Read-only panel without a web link (04-04 observation).** I could not observe the browser locally. The existing `e2e/outlook-ghosts.spec.ts` tests ("clicking a ghost opens the Outlook detail panel", "hovering shows the details; clicking swaps the card for the panel") already open link-less panels in injected read-only mode, and they expect the panel to stay visible. That suggests the immediate close happens only in happy-dom. Test 7 now checks this explicitly: the panel must still be visible 500 ms after the click. If CI fails there, it is a real bug in `OutlookGhostDetail`/`OutlookGhostLayer` (outside this plan).
- The icon assertions (`outlook-entry-badge` in tests 1 and 4) depend on 04-07 being merged before CI runs.

## Known Stubs

None.

## Threat Flags

None. Test code only. The spec routes the convert URL inside the browser context and calls only the authenticated core API.

## Self-Check: PASSED

- FOUND: e2e/outlook-convert.spec.ts
- FOUND: 2d77464d, 9fea7e62 (ancestors of HEAD)
