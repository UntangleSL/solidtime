---
phase: 05-smart-meeting-suggestions
plan: 04
subsystem: m365-calendar-client
status: complete
tags: [m365, outlook, suggestions, i18n, vue, typescript]
requires: []
provides:
  - "46 Phase 5 microsoft365.calendar keys (en/es), 130 shared calendar labels"
  - "OutlookAssignment, OutlookSuggestion, OutlookSuggestionReason, OutlookReasonKind, OutlookPrefillSource, OutlookSeriesConfirmFields"
  - "suggestions.ts: resolveSinglePrefill, resolveBatchPrefill, quickPicks, seriesNote, batchSeriesNote, isRecurring, isPreassigned, isFaded"
  - "suggestionReason.ts: reasonLabel, reasonIcon, PrefillReason"
  - "conversionApi.ts: use_series_assignment confirm body, ignoreSeries, unignoreSeries, forgetSeries"
  - "OutlookProjectDot.vue"
affects: [05-07, 05-08, 05-09, 05-10, 05-11, 05-12, 05-13]
requirements-completed: [RULE-01, RULE-03, RULE-05]
key-files:
  created:
    - resources/js/m365/calendar/suggestionReason.ts
    - resources/js/m365/calendar/suggestionReason.test.ts
    - resources/js/m365/calendar/suggestions.ts
    - resources/js/m365/calendar/suggestions.test.ts
    - resources/js/m365/calendar/OutlookProjectDot.vue
    - resources/js/m365/calendar/OutlookProjectDot.test.ts
  modified:
    - lang/en/microsoft365.php
    - lang/es/microsoft365.php
    - tests/Feature/Microsoft365/OutlookCalendarPropTest.php
    - resources/js/m365/types.ts
    - resources/js/m365/calendar/conversionApi.ts
    - resources/js/m365/calendar/conversionApi.test.ts
decisions:
  - "A suggestion (or batch winner) is only prefilled when its project is in the loaded list and not archived, the same rule as resolvePrefillProject; the series assignment is applied as served"
  - "Batch quick picks are built from suggestion objects only: a project named only by a series assignment (no meeting suggests it) is not offered as a chip, because OutlookSuggestion needs a server reason"
  - "Batch prefill from a mixed majority reports prefill_source 'suggestion' with reason {kind: 'batch', count, total}"
completed: 2026-11-17
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 1468222e0d2dc3d85d93c43b0785c199037fc33c
plan_head_after: ba8e788a
---

# Phase 5 Plan 04: Client foundation for smart meeting suggestions Summary

All Phase 5 copy in English and Spanish (46 keys, 130 shared labels), optional Phase 5 meeting fields on the client types, pure tested prefill/quick-pick/series-note rules, exact UI-SPEC reason lines with their Lucide icons, confirm and series-action HTTP helpers, and the shared 8px project dot.

## What was built

- **Lang** (`lang/en|es/microsoft365.php`): the 46 keys of the plan's interface block under a "Phase 5" comment, identical key sets and placeholders; `show_dismissed_help` now mentions ignored series. No `reason_loading` key. `OutlookCalendarPropTest` asserts 130 labels at its three call sites.
- **Types** (`resources/js/m365/types.ts`): `OutlookAssignment`, `OutlookReasonKind`, `OutlookSuggestionReason`, `OutlookSuggestion`, `OutlookPrefillSource`, `OutlookSeriesConfirmFields`; `OutlookMeeting` gets optional `series_key`, `series_ignored`, `assignment`, `suggestions`; `OutlookConversionFields` gets optional `prefill_source`, `prefill_project_id`; `OutlookCalendarLabels` gets the 46 keys. Existing fixtures compile untouched.
- **suggestionReason.ts**: `reasonLabel` picks `_one`/`_many` by count and fills with `fillLabel` (values stay plain text, tested with `:count` and HTML-like values); `reasonIcon` maps series→Repeat, domain→AtSign, person→Users, organizer→User, subject→TextSearch, last_used→Clock, batch→Users.
- **suggestions.ts**: prefill order series > confident top suggestion > last used > none with `source` for D-16; batch rule (shared assignment of the earliest meeting, else at-least-half majority with ties by earliest meeting, else last used) and picks from the next most common top candidates; `quickPicks` (max 2, server order, excluding the current project); `seriesNote` ('new' / 'change'); `batchSeriesNote`; `isRecurring`, `isFaded`, `isPreassigned`.
- **conversionApi.ts**: `OutlookConversionBody` accepts `{ meeting_ids, use_series_assignment: true }`; `ignoreSeries` (POST), `unignoreSeries` (DELETE) on `{meetingsUrl}/{id}/series/ignore`, `forgetSeries` (DELETE) on `{meetingsUrl}/{id}/series/assignment`, id through `encodeURIComponent`.
- **OutlookProjectDot.vue**: `span` `size-2 shrink-0 rounded-full ring-1 ring-[var(--color-text-tertiary)]`, background from `color`, `aria-hidden`, `data-testid="outlook-project-dot"`.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 784bcb95 | feat(05-04): Phase 5 copy, meeting suggestion types and reason labels |
| 2 | 5ecc917d | feat(05-04): pure prefill rules for the meeting conversion forms |
| 3 | ba8e788a | feat(05-04): series action and confirm helpers, shared project dot |

## Gates

- Key parity script: `130 same`.
- Gate U: MicrosoftLangTest `OK (4 tests, 794 assertions)` run with a worktree-first bootstrap (see deviations).
- Gate P: Pint `--test` on the two lang files and OutlookCalendarPropTest passed; PHPStan full app `[OK] No errors`.
- Gate F: Vitest over `resources/js/m365` 23 files / 434 tests passed (plan files: 47 tests); `npm run type-check` (vue-tsc) and `npx tsc --noEmit` exit 0; ESLint and Prettier clean over `resources/js/m365`.
- Tracer gate (Task 1): verify re-run green before expanding.
- `grep v-html resources/js/m365` finds nothing (T-05-13).
- CI only: OutlookCalendarPropTest (needs Postgres) asserts 130 labels.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree PHP tests read the main checkout**
- **Found during:** Task 1
- **Issue:** With the `vendor` junction, `Tests\TestCase` and the Laravel base path resolve to the main checkout, so `phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php` checked the main checkout's lang files (564 assertions, unchanged by this plan).
- **Fix:** Ran Gate U and PHPStan with a scratchpad worktree-first loader (`--bootstrap` / `--autoload-file`), which checks this worktree's files (794 assertions). No repository change.

**2. [Rule 1 - Acceptance] Literal series URLs**
- **Found during:** Task 3
- **Issue:** A shared `series/${action}` URL builder would fail the plan's `series/ignore` / `series/assignment` grep criteria.
- **Fix:** Literal URL templates per action. Commit ba8e788a.

## Known Stubs

None.

## Open items for later plans

- Batch picks omit a project named only by a series assignment (no suggestion object to carry a reason). 05-08 can widen this if a chip for such a project turns out to be wanted.

## Self-Check: PASSED

- All six created files and six modified files exist and are committed; `git status --porcelain -- resources/js/m365 lang tests/Feature/Microsoft365` was empty after ba8e788a.
- Commits 784bcb95, 5ecc917d, ba8e788a are ancestors of HEAD.
