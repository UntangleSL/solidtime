---
phase: 04-assign-meetings-to-projects
plan: 03
subsystem: m365-calendar-frontend
status: complete
tags: [vue, outlook, conversion, mini-form, multi-select, vitest]
requires:
  - "04-01 server contract: POST calendar.urls.convert, results[] {meeting_id, status, time_entry_id, error}, 44 microsoft365.calendar.* label keys"
provides:
  - "OutlookConvertForm.vue (single mode) built from the core pickers"
  - "OutlookGhostDetail form mode (mode prop, create / converted / cancel-form events, outlook-detail-create)"
  - "Context members: convert, announce, openForm + formRequest, selection (OutlookSelection)"
  - "conversionApi.ts (postConversion, failedResults, conversionErrorMessage), lastProject.ts, useOutlookSelection.ts"
  - "types: OutlookConversionStatus, OutlookConversionResult, OutlookConversionFields, 44 label keys, urls.convert?"
affects: [04-04, 04-05, 04-06]
requirements-completed: [ASGN-01, ASGN-03]
key-files:
  created:
    - resources/js/m365/calendar/conversionApi.ts
    - resources/js/m365/calendar/conversionApi.test.ts
    - resources/js/m365/calendar/lastProject.ts
    - resources/js/m365/calendar/lastProject.test.ts
    - resources/js/m365/calendar/useOutlookSelection.ts
    - resources/js/m365/calendar/useOutlookSelection.test.ts
    - resources/js/m365/calendar/OutlookConvertForm.vue
    - resources/js/m365/calendar/OutlookConvertForm.test.ts
  modified:
    - resources/js/m365/types.ts
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - resources/js/m365/calendar/OutlookGhostDetail.vue
    - resources/js/m365/calendar/OutlookGhostDetail.test.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
decisions:
  - "The lane closes a form panel whose meeting left the list (watch on boxes): the context removes a converted meeting from the cache before the form can emit done, which unmounts the form first"
  - "The form uses no <form> element: core Button renders type-less buttons that would submit; Enter in the description and Ctrl/Cmd+Enter are handled explicitly, fields sit in a disabled fieldset while saving"
  - "Billable prefill = project.is_billable && !billableRatesLocked"
  - "Organization data (billable_rate, interval/number/time format) comes from the injected 'organization' (AppLayout) like OutlookMeetingSummary, not a second useOrganizationQuery"
completed: 2026-11-17
duration: ~1h
estimate:
  tokens: 115000
  tasks: 3
actuals:
  tokens: 26500
  tasks: 3
  commits: 3
plan_head_before: e1fc0fd76c28605b8b75561810d9b484767b470c
plan_head_after: 7a7f4e99030014d3b160b096c1dd1993e1bb7228
---

# Phase 4 Plan 03: Single meeting conversion in the browser Summary

Meeting panel "Create time entry" swaps the same popover to a prefilled mini form (core project/task, tag, billable and time pickers) that posts to the 04-01 convert endpoint through the shared Outlook context; the meeting leaves the lane on created/existing, and the context now exposes convert, announce, a form request channel and the multi-select state for 04-04..04-06.

## What was built

- **types.ts**: 44 `OutlookCalendarLabels` keys (mirroring `microsoft365.calendar.*`), optional `urls.convert`, `OutlookConversionStatus`, `OutlookConversionResult`, `OutlookConversionFields`.
- **conversionApi.ts**: `postConversion(url, body)` over the global axios (web route, session + XSRF); rows with an unknown status or no meeting id, or a body without `results`, become failed `invalid_response`; `failedResults(ids, message, key='request_failed')`; `conversionErrorMessage` returns a 422 `message`, else the fallback.
- **useOutlookMeetings.ts**: `announce` exposed; `convert(ids, fields)` never rejects (no URL/labels/ids or a thrown request -> failed results with `error_generic` / 422 message), ignores a call that includes an id already in flight (returns `[]`), on created/existing removes the ids from every cached `['m365','meetings', ...]` read (`setQueriesData`), from the selection, invalidates `['timeEntries']`, `['goals']`, `['m365','meetings']` and announces `created_announcement` for a single meeting. `openForm(id)` + `formRequest {id, seq}` (ignored while `!canAct`, clears the selection). `selection` (wrapped `useOutlookSelection`): inert and cleared while `!canAct`, drops ids that left the meetings list, clears on any calendar range change. The test hook is unchanged (3 occurrences).
- **useOutlookSelection.ts**: toggle (sets anchor), inclusive start range ordered by start then id (toggle without a usable anchor), remove, clear.
- **lastProject.ts**: `solidtime:m365-last-meeting-project:<orgId>`, read/remember swallow storage errors, `resolvePrefillProject(stored, projects, fallback)` (present and not archived).
- **OutlookConvertForm.vue** (single): title (labels the dialog), context line `From Outlook · Tue, Oct 27 · 10:00 – 11:00` (truncates), description (subject, empty for none, placeholder), `TimeTrackerProjectTaskDropdown` (`:can-create-project="false"`, `no-project-value` null), TagDropdown with Tags / 1 Tag / N Tags, billable Select ("Billable" disabled under the lock), two `TimePickerSimple` with duration, FieldErrors for project and end-before-start, `role="alert"` server error area, Cancel / "Create entry" (loading). Prefill: stored last project, else the latest work entry's project (`getLastWorkTimeEntry` over `useTimeEntriesInfiniteQuery`, loaded when the form mounts), else empty; a late prefill never overrides a user pick. Focus: Create entry when prefilled, else the picker. Submit sends UTC `YYYY-MM-DDTHH:mm:ssZ` with seconds 00; busy emits, disabled fieldset, re-entry ignored; success remembers the project, toasts `created_success`, emits `done`; failure keeps values and focuses Create entry.
- **OutlookGhostDetail.vue**: `mode` prop (default detail), primary `ClockPlus` "Create time entry" (`outlook-detail-create`) after Dismiss/Restore only when `canAct` (also dismissed meetings), form mode = `w-96` with the form instead of summary/footer, `data-mode`, interact-outside prevented while busy or inside nested picker layers, Escape ignored while busy, open-auto-focus left to the form. Still network-free.
- **OutlookGhostLayer.vue**: `formId`, `:mode`, `@create`, `@converted` (close + next / previous / Sync focus), `@cancel-form` (close + focus block), `formRequest` watcher (only boxes of this day, not while the context menu is open, closes the hover card), and a watcher that closes a form panel whose meeting left the lane and moves focus with the same rule.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | b80d2d48 | feat(04-03): create a time entry from the meeting panel (tracer) |
| 2 | 9b5ae75a | test(04-03): cover the single mini form and the last-project prefill |
| 3 | 7a7f4e99 | feat(04-03): shared selection, form channel and in-flight guard in the Outlook context |

## Gates (local, Gate F)

- `npx vitest run resources/js/m365`: 16 files, 317 tests passed
- `npx vue-tsc --noEmit` (npm run type-check): clean
- `npx tsc --noEmit`: clean
- `npx eslint resources/js/m365`: 0 errors, 0 warnings
- `npx prettier --check resources/js/m365`: clean
- Tracer gate (Task 1): verify re-run end-to-end before expanding, passed.
- No push (orchestrator merges; the wave-1 CI gate belongs to 04-01).

## Deviations from Plan

1. **[Rule 3 - Ordering] Form completed in Task 1's commit.** Writing a throwaway minimal form and then rewriting it would have produced the same final file; the full single-mode form and `lastProject.ts` (which it imports) landed with the tracer commit b80d2d48, and Task 2's commit carries the form and lastProject tests. Behaviour and files match the plan.
2. **[Rule 1 - Bug] Converted meeting unmounts its own form before `done`.** The context removes the meeting from the cache synchronously before `convert` resolves, so Vue unmounts the panel (and the form) before the form's continuation emits `done` (Vue drops emits of unmounted instances). The layer therefore also watches its boxes and closes a form panel whose meeting left the lane, moving focus by the Dismiss rule; `@converted` stays as the path when the meeting is still rendered. Tested both ways.
3. **[Rule 1 - Bug] No `<form>` element.** Core `Button` renders `<button>` without a type (submit by default), so the project/tag triggers would submit a form. The form root is a `div` with explicit Enter (description) and Ctrl/Cmd+Enter handling; a `<fieldset disabled>` disables every control while saving.
4. **Organization data from the injected `organization`** (AppLayout's `useOrganizationQuery` result, also used by OutlookMeetingSummary) instead of a second `useOrganizationQuery` call; same data, testable without the API client.
5. **Acceptance greps that cannot print the planned numbers:** the 44-key grep on `types.ts` prints 45 because `MicrosoftAccountLabels.cancel: string;` already existed (baseline was 1, not 0); `grep -c useBillableRatesLock OutlookConvertForm.vue` prints 2 (import + call), the plan expected 1. All 44 keys are present once in `OutlookCalendarLabels`.
6. Added test ids beyond the plan list: `outlook-convert-context`, `outlook-convert-project`, `outlook-convert-tags`, `outlook-convert-billable`, `outlook-convert-duration` and `data-mode` on the panel (used by tests; 04-06 e2e may reuse them).

## Known Stubs

None. `noCreate` (project/client create callbacks passed to the core picker) is intentional: `:can-create-project="false"` means they are never called (UI-SPEC default: no project creation inside the popover).

## Open items for later plans

- 04-04 (hover card / context menu) should call `context.openForm(id)`; the lane honours it.
- 04-05 batch mode extends `OutlookConvertForm` (`mode: 'batch'`); `convert` already returns per-meeting results and removes done ids from the selection.
- Playwright check of nested pickers inside the popover (UI-SPEC section 3) is not part of this plan.

## Self-Check: PASSED

- All 8 created files and 7 modified files exist in the worktree.
- Commits b80d2d48, 9b5ae75a, 7a7f4e99 are ancestors of HEAD.
- `git status --porcelain -- resources/js/m365` is empty.
