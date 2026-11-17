---
phase: 05-smart-meeting-suggestions
plan: 08
subsystem: m365-calendar-client
status: complete
tags: [m365, outlook, suggestions, mini-form, vue, typescript]
requires:
  - "05-04: suggestions.ts (resolveSinglePrefill, resolveBatchPrefill, quickPicks, seriesNote, batchSeriesNote), suggestionReason.ts, OutlookProjectDot.vue, Phase 5 labels and types"
provides:
  - "OutlookSuggestionPicks.vue: quick-pick chips (role group 'Other suggestions', outline Button sm, dot + 'Project · Client' max-w-40, aria-label 'Use Project (Client)', title = reason)"
  - "OutlookConvertForm: Phase 5 prefill order (series > confident suggestion > last used), reason line (outlook-suggestion-reason), chips, series notes (outlook-series-note), batch prefill, prefill_source / prefill_project_id on single and batch submit (incl. retry)"
affects: [05-09, 05-10, 05-13]
requirements-completed: [RULE-01, RULE-03, RULE-05]
key-files:
  created:
    - resources/js/m365/calendar/OutlookSuggestionPicks.vue
    - resources/js/m365/calendar/OutlookSuggestionPicks.test.ts
  modified:
    - resources/js/m365/calendar/OutlookConvertForm.vue
    - resources/js/m365/calendar/OutlookConvertForm.test.ts
    - resources/js/m365/calendar/OutlookSelectionBar.test.ts
decisions:
  - "Late prefill rule: an untouched prefill is replaced only by a strictly better source (series > suggestion > last_used); equal-rank changes are ignored, so the Phase 4 'first last-used project wins' behaviour is unchanged"
  - "Series billable (RESEARCH Pitfall 4): the billable watcher applies the applied prefill's billable whenever its project is the selected one (also after a projects refetch); any other project follows its default; the billable-rates lock still forces off"
  - "prefill_project_id stays the project the form prefilled even after the user picks another one (so the server records kept=false); 'none' sends null"
  - "Batch chips include projects named only by a series assignment (reason 'series', title 'Same series'): the form ranks every meeting's top candidate (assignment counts as top, UI-SPEC section 7) instead of using resolveBatchPrefill's picks, which only carry suggestion objects (05-04 decision) and are fixed to the initial project"
  - "Chips and the reason line only use projects that are loaded and not archived"
  - "The batch series note is shown only while a project is selected, like the single note"
completed: 2026-11-17
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 11600
  tasks: 3
  commits: 3
plan_head_before: 7bee5345dbb5a9914789c0e34dee357cfab84647
plan_head_after: 23499337
---

# Phase 5 Plan 08: Mini form prefill, reasons, quick picks and series notes Summary

The mini form now opens with the series pre-assignment (project, task, tags and billable) or a confident learned project, says why under the picker, offers the next two projects as one-click chips, warns how the series will follow the choice, and sends `prefill_source` / `prefill_project_id` with every single and batch conversion.

## What was built

- **Prefill (single):** `resolveSinglePrefill(meeting, projects, lastUsed)` drives the form; the Phase 4 last-used chain is its third input. A series prefill also fills task and tags and keeps its own billable while its project is selected (the project default never overwrites it). `appliedPrefill` is remembered and reported on submit.
- **Reason line** (`outlook-suggestion-reason`, `mt-1 flex min-w-0 items-center gap-1`, 12px tertiary, icon from `reasonIcon`, truncated text with `title`): describes the project currently in the picker, which is either the prefilled one or a candidate the user picked. A project picked by hand that is not a candidate hides it. With no history there is no line and no chips.
- **OutlookSuggestionPicks.vue:** up to two chips, emits `pick`; the form sets the project, clears the task, keeps the tags, lets billable follow the project and moves focus to Create. The chip for the new current project goes away and the next candidate takes its place.
- **Series note** (`outlook-series-note`): `series_note_new` for a recurring meeting without assignment, `series_note_change` when Edit moves a pre-assigned meeting to another project, `batch_series_note` when any selected meeting is recurring.
- **Batch:** `resolveBatchPrefill` (shared assignment gives 'Same series' with all values, else the candidate of at least half gives 'Suggested for 2 of 3 meetings', else 'Last used'), chips from the ranked top candidates, prefill fields on submit and retry.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | d05a7569 | feat(05-08): prefill the mini form from the series assignment and report the prefill |
| 2 | dc6c113e | feat(05-08): learned prefill reasons and quick-pick chips in the mini form |
| 3 | 23499337 | feat(05-08): series notes and batch prefill in the mini form |

## Gates

- Task 1/2 Gate F (plan files) and Task 3 Gate (whole `resources/js/m365`): `npx vitest run resources/js/m365` 24 files / 459 tests passed; `npm run type-check` 0; `npx tsc --noEmit` 0; `npx eslint resources/js/m365` 0; `npx prettier --check resources/js/m365` clean.
- Tracer feedback gate (Task 1): verify re-run end-to-end and passed before Task 2.
- Acceptance greps: `resolveSinglePrefill`, `prefill_project_id`, `quickPicks`, `outlook-series-note`, `resolveBatchPrefill` present in the form; `outlook-suggestion-pick` and `max-w-40` in the chips component; `v-html=` count 0 in both components.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exact batch body assertion in OutlookSelectionBar.test.ts**
- **Found during:** Task 3 (full `resources/js/m365` suite)
- **Issue:** `OutlookSelectionBar.test.ts` asserts the exact batch convert body, which now also carries `prefill_source` / `prefill_project_id`. The file is not in this plan's files_modified; no other Phase 5 plan lists it, so the edit cannot collide.
- **Fix:** added the two fields to that single `toHaveBeenCalledWith` body.
- **Commit:** 23499337

**2. [Plan detail] Batch chips are not taken from `resolveBatchPrefill(...).picks`**
- **Issue:** those picks only contain suggestion objects (05-04 decision) and are computed against the initial prefill, so a project named only by a series assignment would never be offered, and after a chip click the next candidate could not take its place.
- **Fix:** the form ranks every selected meeting's top candidate (assignment counts as top, reason 'series') the same way resolveBatchPrefill does (most common, then earliest) and shows the two that are not the current project. The prefill itself still comes from `resolveBatchPrefill`.

**3. [Test harness] Projects refetch not testable**
- The mocked `useProjectsQuery` reads a plain (non-reactive) object, so a test for "series billable survives a projects refetch" could not trigger one; the rule is in the watcher (watches `projects`) but has no dedicated unit test.

## Known Stubs

None.

## Open items

- UI-SPEC "Checking your history…" spinner is not needed: suggestions arrive with the meeting payload (plan truth "the form never waits for suggestions").
- Playwright coverage of the new form states belongs to later plans (05-13 / 05-14 own the e2e specs); not part of this plan.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/OutlookSuggestionPicks.vue
- FOUND: resources/js/m365/calendar/OutlookSuggestionPicks.test.ts
- FOUND: d05a7569, dc6c113e, 23499337 (ancestors of HEAD)
