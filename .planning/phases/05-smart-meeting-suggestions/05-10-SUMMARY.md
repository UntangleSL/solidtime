---
phase: 05-smart-meeting-suggestions
plan: 10
subsystem: frontend (m365 calendar lane and detail panel)
tags: [vue, outlook, preassignment, series, a11y, contrast]
requires: [05-04, 05-07, 05-08]
provides:
  - Pre-assigned block look in the lane (project line per tier, data-preassigned, aria suffix)
  - Pending confirm state on blocks (spinner instead of the dot, aria-busy, cursor-progress)
  - w-96 detail panel with full pre-assignment, why line, Edit / Confirm, inline confirm error
  - More actions menu (Dismiss/Restore, Always ignore, Stop ignoring, Forget this series)
  - Faded variant for occurrences of an ignored series (eyebrow and aria suffix)
  - Dot-ring contrast rows in the branding contrast gate
affects: [05-11, 05-12, 05-13]
requirements-completed: [RULE-01, RULE-02, RULE-04, RULE-05]
completed: 2026-11-17
status: complete
key-files:
  modified:
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
    - resources/js/m365/calendar/OutlookGhostDetail.vue
    - resources/js/m365/calendar/OutlookGhostDetail.test.ts
    - resources/js/m365/calendar/OutlookMeetingSummary.vue
    - resources/js/m365/calendar/OutlookMeetingSummary.test.ts
    - resources/js/branding/contrast.test.ts
decisions:
  - The panel's More actions DropdownMenu is non-modal; a modal menu's focus trap pulled focus back from the block the layer focuses after a series action
  - OutlookProjectDot keeps its text-tertiary ring; the measured minimum is 4.25:1 (threshold 3.0) in every preset and mode
actuals:
  tokens: 22000
  tasks: 3
  commits: 3
plan_head_before: 3424999b3264166b8874f5c341e7468b4f1d5b36
plan_head_after: 2e493ba41c1d49ae0d06e9a45799088fbdc9dfc5
---

# Phase 5 Plan 10: Lane and Detail Panel for Pre-assigned Meetings Summary

Pre-assigned meetings now show their project in the lane (8px dot and name, laid out per UI-SPEC tier), the w-96 panel explains the pre-assignment and confirms it in one click, the series controls sit in a More actions menu, and occurrences of an ignored series appear faded with their own wording.

## What was built

- **Lane (OutlookGhostLayer.vue)**
  - Pre-assigned blocks (`isPreassigned`) get `data-preassigned`, the aria suffix `, pre-assigned to <project>` (placed before the dismissed and selected suffixes) and the project line `outlook-preassigned-line`. Layout by tier: T1/T2 put the dot before the subject; T3 shows the subject and the project line, with no time line; T4 under 60px shows the subject on one line, then the time line, then the project line; from 60px the subject may take two lines. The organizer line never shows. The project colour reaches only the dot. Long names truncate and keep the full name in `title`.
  - Pending confirm: while `context.isConfirmPending(id)` is true (or a confirm from this panel is running), a 12px LoadingSpinner (`outlook-preassigned-spinner`) replaces the dot and the block gets `aria-busy="true"` and `cursor-progress`.
  - Panel Confirm (`onConfirm`): calls `context.confirmOne(id)`. On created/existing the panel closes and focus follows the conversion rule. On failure the panel stays open and shows the reason inline (the server message, else `confirm_failed`). A null result (nothing was sent) changes nothing. The reason clears when the panel changes.
  - `isFaded` drives the dismissed variant. An occurrence of an ignored series gets the `, series ignored` suffix instead of `, dismissed`, and faded blocks never show a project line.
  - Series handlers: `onIgnoreSeries` follows the Dismiss focus rule and skips the series' other occurrences that leave with it; with "Show dismissed meetings" on, focus stays on the same, now faded, block. `onUnignoreSeries` and `onForgetSeries` keep focus on the same block. `neighbourOf` takes an optional "leaves" predicate.
- **Panel (OutlookGhostDetail.vue)**
  - The panel is `w-96 p-4` in both modes.
  - New props `confirming` and `confirmError`. New emits `confirm`, `ignore-series`, `unignore-series`, `forget-series`.
  - With canAct only: OutlookPreassignment (full, `mt-4`, with the why line) after the summary and link.
  - Footer variants:
    - Pre-assigned: [More actions] … [Edit] [Confirm]
    - Recurring without assignment: [More actions] … [Dismiss/Restore] [Create time entry]
    - Single meeting: the Phase 4 footer
  - The More actions menu offers Dismiss/Restore and a separator (pre-assigned), Always ignore or Stop ignoring (for an ignored occurrence), and Forget (pre-assigned).
  - Focus lands on Confirm when a pre-assigned panel opens.
  - While `confirming`, Escape and outside clicks do not close the panel. An inline `role="alert"` line (`outlook-detail-alert`) uses CircleX and text-destructive.
- **Summary (OutlookMeetingSummary.vue):** the eyebrow reads "Outlook meeting · Series ignored" with EyeOff for ignored series, and this wins over the dismissed eyebrow. The eyebrow now carries a `<prefix>-eyebrow` test id.
- **Contrast (contrast.test.ts):** `projectDotRingCases` adds 36 rows (6 presets x 2 modes x 3 surfaces). They check `--color-text-tertiary` against `--m365-meeting-bg`, `--m365-meeting-bg-hover` and the popover surface (`--color-bg-elevated` in dark, `--color-bg-primary` in light). The lowest measured ratio is 4.25, so all rows pass.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 0fd62343 | feat(05-10): pre-assigned project line in the lane and panel Confirm |
| 2 | e3a5350c | feat(05-10): More actions menu, w-96 panel, focus on Confirm and pending block |
| 3 | 2e493ba4 | feat(05-10): ignored-series variant, series actions from the panel, dot-ring contrast |

## Gates

- `npx vitest run resources/js/m365 resources/js/branding/contrast.test.ts`: 26 files, 1080 tests passed.
- `npm run type-check` (vue-tsc), `npx tsc --noEmit`, `npx eslint resources/js/m365 resources/js/branding/contrast.test.ts`, `npx prettier --check` (same paths): all exit 0.
- Acceptance greps:
  - `data-preassigned` 1, `outlook-detail-confirm` 1, `confirmOne` 1
  - `w-80` 0, `outlook-more-forget-series` 1, `outlook-more-unignore-series` 1, `isConfirmPending` 1
  - `eyebrow_series_ignored` 1, `series_ignored_suffix` 1, `color-text-tertiary` in contrast.test.ts 3
  - `git status --porcelain -- resources/js/m365 resources/js/branding` is empty
- Tracer gate (Task 1): the verify command was re-run end to end and passed before Task 2 started.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The modal More actions menu pulled focus back after a series action**
- **Found during:** Task 3
- **Issue:** After Stop ignoring or Forget, the layer focuses the same block, but the default modal DropdownMenu's focus trap pulled focus back into the closing menu, so focus ended up on `body`.
- **Fix:** The menu is now `:modal="false"`. The panel's interact-outside guard already treats `[role="menu"]` as nested in detail mode, so the panel stays open. On close, the menu skips returning focus to its trigger when an item was chosen.
- **Files modified:** resources/js/m365/calendar/OutlookGhostDetail.vue
- **Commit:** 2e493ba4

**2. [Rule 2 - Correctness] Confirm blocks dismissal of the panel while it runs**
- **Found during:** Task 1
- **Issue:** The UI-SPEC says the panel stays open until the request settles, the same pessimistic behaviour as the Phase 4 form.
- **Fix:** `confirming` is treated like the form's `busy` in `onInteractOutside` and `onEscapeKeyDown`.
- **Commit:** 0fd62343

### Notes

- The confirm alert's test id is `outlook-detail-alert`, not `outlook-detail-confirm-error`, so that `grep -c outlook-detail-confirm` stays at exactly 1 (acceptance criterion).
- OutlookProjectDot.vue was not changed: every ring row passes with the `text-tertiary` ring, so the plan's fallback to `text-secondary` was not needed.
- The Restore item in More actions (`outlook-more-restore`) can never appear in practice, because a dismissed meeting is never pre-assigned. It is kept to match the plan's wording.

## Open items (pre-existing, out of scope)

- **Layer test flakiness:** the real-timer layer tests (`OutlookGhostLayer detail panel` and `dismissed variant`) fail about 1 run in 5 under load. This also happens on the base commit 3424999b. Cause: Vue drops a click stamped in the same millisecond its listener was attached. The new Phase 5 tests use the fake-timer and `passMountTime` pattern and are stable.
- **Panel with no focusable content:** under the layer harness in happy-dom, a panel with nothing focusable (canAct false and no web link) closes again on the next focus pass. This happens for any meeting and also on the base commit. The existing canAct=false tests never asserted that the panel stayed open. The new test reads the panel on the render that opens it. This needs a browser check (05-13) in impersonation and test-hook mode.
- **Backstop truths:** the Spanish footer fit at w-96 / w-72 is left to the browser proof (05-13). The dot-ring contrast is now guarded by the contrast gate.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookGhostLayer.vue, OutlookGhostDetail.vue, OutlookMeetingSummary.vue, their tests, resources/js/branding/contrast.test.ts
- FOUND commits: 0fd62343, e3a5350c, 2e493ba4 (ancestors of HEAD)
