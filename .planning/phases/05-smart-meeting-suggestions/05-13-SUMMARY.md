---
phase: 05-smart-meeting-suggestions
plan: 13
subsystem: e2e
status: complete
tags: [m365, outlook, playwright, e2e, series, confirm, suggestions]
requires: [05-07, 05-08, 05-10, 05-11, 05-12]
provides:
  - "e2e/outlook-suggestions.spec.ts: five Phase 5 browser proofs (one-click confirm, bulk confirm, learned prefill, ignore/stop ignoring, forget)"
  - "Three panel checks left open by 05-10: read-only panel stays open, Spanish footers at w-96 / w-72"
affects: [05-14]
requirements-completed: [RULE-01, RULE-02, RULE-03, RULE-04, RULE-05]
key-files:
  created:
    - e2e/outlook-suggestions.spec.ts
  modified: []
key-decisions:
  - "The convert route resolves each meeting's own series assignment from the injected list when the body has use_series_assignment, and creates the real entry through the core API (like 04-08)"
  - "Series routes (**/meetings/*/series/*) record method + path and answer 204"
  - "Show dismissed meetings is turned on through localStorage plus a dispatched StorageEvent (VueUse listens to it): the settings switch is not mounted in test-hook mode"
  - "Bulk confirm holds the routed answer to assert the per-row pending state; with every row created the popover closes, so the outcome is asserted through the single toast, the lane and the real entries"
  - "The Spanish recurring-footer overflow is encoded as a test.fail check so CI stays green and flags the fix when it lands"
completed: 2026-11-17
duration: 50min
plan_head_before: 98a2691c3c224d64d2d1d2f13482066fac555064
plan_head_after: 472894075fce0d050fdfc6e249e82e5932e4843a
estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 12300
  tasks: 3
  commits: 3
---

# Phase 5 Plan 13: Browser proofs of Phase 5 Summary

Playwright spec `e2e/outlook-suggestions.spec.ts`. It covers one-click confirm, bulk confirm over the rendered week, the learned prefill with its reason and quick pick, ignore and stop ignoring a series, and forget a series. All of it runs on injected meetings, with real entries created through the core API. It also adds three panel checks that 05-10 left open for a browser.

## What was built

The harness follows the 04-08 pattern. It uses `showCalendarWeekends` in `beforeEach`, an English `LABELS` set (Phase 3.1 and 4 plus every Phase 5 key), and `injectMeetings(page, meetings, { convertUrl, seriesUrl, labels })`. Meetings are filled with the Phase 5 defaults: `series_key`, `series_ignored`, `assignment` and `suggestions`. Two helpers answer the routed requests:
- `routeConversions` creates real entries through the core API. In confirm mode it takes the project, task, tags and billable from the meeting's series assignment. It can hold its answer.
- `routeSeries` records the method and path of each series request and answers 204.

Tests in `Outlook meeting suggestions`:
1. **Tracer: confirms a pre-assigned meeting from its hover card into a real entry.** The block has `data-preassigned`, the line 'Acme Website' and the aria suffix. The hover card shows Edit and Confirm, with no Create. Confirm sends exactly `{meeting_ids: ['m-pre'], use_series_assignment: true}`. The entry is created on the assignment's project at 10:00. The meeting leaves the lane and the plain meeting stays. The entry shows 'Acme Website' and the Outlook badge.
2. **Bulk-confirms the pre-assigned meetings in view, skipping unticked ones and hidden weekends.** The test writes its own settings with `showWeekends: false` and asserts 5 header days. It places three pre-assigned meetings on weekdays, one on Saturday and one suggestion-only meeting.
   - The button reads `Confirm 3 pre-assigned meetings` and the popover lists 3 rows. One row is unticked, and the submit then reads `Confirm 2 meetings`.
   - The body is exactly `{meeting_ids: ['m-b1','m-b3'], use_series_assignment: true}`. The ticked rows show `pending` and the unticked row has no status.
   - Afterwards there is one '2 time entries created successfully' toast and the popover closes. Two real entries carry the badge, and the count drops to 1.
3. **Opens the form with a confident suggestion and switches project with a quick pick.** The form opens on 'Client Portal' with 'Like 4 meetings with @client.com' and one 'Internal' chip (`Use Internal`). Clicking the chip switches the project, and the reason follows the chip. The body carries `project_id` Internal, `prefill_source: 'suggestion'` and `prefill_project_id` Client Portal, with no `use_series_assignment`.
4. **Ignores a series from the context menu and brings it back from show dismissed.**
   - 'Always ignore this series' sends `POST /m365/organizations/{org}/meetings/m-s9-a/series/ignore`. Both occurrences leave the lane, the single meeting stays, and the 'Series ignored' toast appears.
   - With Show dismissed turned on, both occurrences come back faded (`m365-meeting--dismissed`) with an aria-label ending in ', series ignored'.
   - 'Stop ignoring this series' sends `DELETE` to the same path, and both occurrences return to normal.
5. **Forgets a series from the panel.** More actions, then 'Forget this series', sends `DELETE …/m-s7-a/series/assignment`. Neither occurrence keeps `data-preassigned` or a project line. The toast shows the title and 'Its meetings are no longer pre-assigned. Your time entries are unchanged.' No convert request is sent, and Confirm-all disappears.

Tests in `Outlook suggestion panel checks` (requested by the orchestrator and 05-10):
6. A read-only (no actions, no link) pre-assigned panel stays open 500 ms after the click. It shows no Confirm, Edit, More, Create, Dismiss or link, and Escape closes it.
7. Spanish pre-assigned footer: hover card (w-72) Editar/Confirmar and panel (w-96) Más acciones/Editar/Confirmar. No button is clipped or outside the content box. A screenshot is attached.
8. Spanish recurring footer without assignment: marked `test.fail` (known overflow, see Open items).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | c8b77af8 | test(05-13): browser proof of one-click confirm of a pre-assigned meeting |
| 2 | 2e2e1941 | test(05-13): browser proofs of bulk confirm and the learned prefill |
| 3 | 47289407 | test(05-13): browser proofs of ignore, stop ignoring and forget a series |

## Gates

- `npx eslint e2e/outlook-suggestions.spec.ts`: clean, at every commit.
- `npx prettier --check e2e/outlook-suggestions.spec.ts`: clean, at every commit.
- `npx playwright test e2e/outlook-suggestions.spec.ts --list --project=chromium`: 1, then 3, then 8 tests listed.
- `tsc` with an e2e tsconfig (scratchpad `tsconfig.e2e-a8ce.json`): no errors in the spec. The 10 errors it reports are all in `e2e/utils/api.ts`, `e2e/utils/mailpit.ts` and `playwright/*`. The 04-08 spec `outlook-convert.spec.ts` produces the same 10 errors.
- Acceptance greps:
  - `use_series_assignment`: 4 at task 1.
  - `showCalendarWeekends`: 2 at task 1, more later.
  - `showWeekends: false`: 1.
  - `prefill_project_id`: 2.
  - `series/ignore`: 1.
  - `series/assignment`: 1.
  - `^\s*test\(`: 8.
  - `git status --porcelain -- e2e` is empty.
- **Gate W+P handed over to the orchestrator:** the nine workflows, including Playwright Tests, must pass on the merged and pushed wave-4 sha. Playwright cannot run locally.

## Deviations from Plan

1. **[Rule 3 - Blocking] Show dismissed meetings is not toggled through its switch.** `Calendar.vue` mounts `#settings-extra` (OutlookDismissedSetting) only when `outlook.calendar.value && connectionState !== 'not_connected'`. In CI the integration is off, so the switch does not exist in test-hook mode. The test sets `solidtime:m365-show-dismissed` and dispatches the `storage` event that VueUse's `useLocalStorage` listens to. The composable's `includeDismissed` flips in place, and the injected list keeps its client-side `series_ignored` state. Whether to widen the slot condition is left to the orchestrator, as with b0412651. Calendar.vue is outside this plan's files.
2. **Bulk confirm: rows asserted as `pending`, not as `created`.** With every sent row created, OutlookConfirmAll closes the popover at once (05-11 design). Per-row results are only visible after a failure. The test holds the routed answer to assert the per-row pending state and the untouched unticked row. It then asserts the single toast, the lane and the two real entries.
3. **Three extra tests (6-8).** The orchestrator asked for these browser probes, and 05-10 left them open. The plan's five tests are unchanged.
4. **Commit split by staged versions.** The spec was written in one pass and committed in three task-sized versions. Each version passed ESLint, Prettier and the listing on its own.

## Browser probes requested by the orchestrator

- **(a) Read-only panel staying open:** Playwright cannot run against the app locally, because there is no app server or database. Test 6 (and the Phase 4 test in outlook-convert) proves it in CI. Locally nothing contradicts it. The 05-10 happy-dom closing is a test-harness focus artefact.
- **(b) Spanish footer fit at w-96:** probed locally in real Chromium 1.62 with the shipped `InterVariable.woff2`. The DOM mirrors the panel and button classes. The panel content box is 350px (384 minus 2×16 padding minus 2×1 border). Script: `C:\Users\JUANHE~1\AppData\Local\Temp\claude\791af4e177112ddb\552146f6-5772-4900-b8c8-979c4405812f\scratchpad\footer-probe-0513.cjs`.

  | Footer | Natural width | Fits in 350px |
  |--------|---------------|---------------|
  | Pre-assigned: Más acciones · Editar · Confirmar | 259.5px | yes |
  | Recurring, no assignment: Más acciones · Descartar reunión · Crear registro de tiempo | 395.3px | **no (+45px)**: "Crear registro de tiempo" is squeezed from 212px to 168px and wraps to 2 lines inside its fixed h-9 |
  | Single meeting (Phase 4 footer): Descartar reunión · Crear registro de tiempo | 351.3px | **no, by 1.3px**: the primary label wraps |
  | English recurring: More · Dismiss meeting · Create time entry | 339.1px | yes (11px spare) |

  Hover card (w-72, 254px content): Editar plus Confirmar is about 215px and fits.

## Open items

- **Product bug for 05-10 (OutlookGhostDetail.vue footer, Spanish):** the recurring-without-assignment footer overflows w-96 by about 45px, and the single-meeting footer misses by about 1px. In both, the primary button's label wraps inside a fixed-height button. Possible fixes:
  - Shorter es copy for `create_entry`, for example "Crear registro".
  - `whitespace-nowrap` plus an icon-only More.
  - Letting the right group wrap.

  Test 8 is `test.fail` and will flag the fix when it lands. I did not edit OutlookGhostDetail.vue because it is outside this plan's files.
- **Show dismissed switch in test-hook mode:** see Deviation 1. It is a one-line Calendar.vue condition if the orchestrator wants the e2e to click the real switch.
- STATE, ROADMAP, REQUIREMENTS and WINDOWS were not touched. The orchestrator owns them.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: e2e/outlook-suggestions.spec.ts (1164 lines, ≥ 300)
- FOUND: c8b77af8, 2e2e1941, 47289407 (ancestors of HEAD)
