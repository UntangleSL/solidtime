---
phase: 06-out-of-sync-detection
plan: 03
subsystem: microsoft365-out-of-sync-client
status: complete
tags: [m365, outlook, out-of-sync, lang, types, parsing, vitest]
requires: []
provides:
  - "47 microsoft365.calendar.* keys (35 osync_*, moved_*, move_entry_*, auto_adjusted_*) in en and es; calendar prop carries 177 labels"
  - "Types OutlookFlagKind, OutlookOutOfSyncItem, OutlookAutoAdjusted, OutlookMovedFrom, OutlookFlagPanelRequest; OutlookMeeting.moved_from; OutlookMeetingsResponse.out_of_sync / auto_adjusted; OutlookSyncResponse.auto_adjusted; urls.out_of_sync / urls.organization_meetings"
  - "fetchMeetings parses out_of_sync.items, auto_adjusted and moved_from defensively; postSync returns auto_adjusted (0 when absent)"
  - "resources/js/m365/calendar/syncFlagReason.ts: formatRange, rangePair, flagTitle, flagReason, flagDescribed, autoAdjustedNote, shortDate, countLabel, countAria, autoAdjustedAnnouncement, firstFlag"
affects: [06-06, 06-07, 06-10, wave-3 components (marker, popover, counter, moved block)]
requirements-completed: []
requirements-contributed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
key-files:
  created:
    - resources/js/m365/calendar/syncFlagReason.ts
    - resources/js/m365/calendar/syncFlagReason.test.ts
  modified:
    - lang/en/microsoft365.php
    - lang/es/microsoft365.php
    - tests/Feature/Microsoft365/OutlookCalendarPropTest.php
    - resources/js/m365/types.ts
    - resources/js/m365/calendar/meetingsApi.ts
    - resources/js/m365/calendar/meetingsApi.test.ts
decisions:
  - "moved_from is normalized only when the server sent the key; meetings without it keep their exact shape (cache and fixtures unchanged)"
  - "Out-of-sync items with an unknown kind or a missing required field are dropped, never shown with the wrong text"
  - "A moved flag without new times falls back to the title text; flagDescribed strips a trailing period from the reason so the copy's own period is never doubled"
  - "Same-week test for range pairs uses the local start dates and the user's week start (same rule as weekBucket)"
  - "All-day ranges show day(s) only (exclusive end); a running entry (end null) shows its start only"
metrics:
  duration: "~25 min"
  tasks: 2
  files: 8
estimate:
  tokens: 65000
actuals:
  tokens: 12600
  tasks: 2
  commits: 2
plan_head_before: fef7d29fe1aebc808c44d15a3f532a6f6889e3a4
plan_head_after: 93d0181c
---

# Phase 6 Plan 03: Out-of-sync client foundation (copy, types, parsing, text helpers) Summary

All Phase 6 copy now exists in English and Spanish (47 keys, 177 calendar labels). The client types cover flags, auto-adjusts and D-03 moves. The read and sync answers are parsed defensively. One pure module, `syncFlagReason.ts`, builds every text the Phase 6 components show: reasons, ranges, counter labels, the auto-adjust note and announcement, short dates, and which flag the counter opens first.

## What was built

- **Lang (D-13):** the 47 keys of the 06-UI-SPEC Copywriting Contract, copied exactly into the `calendar` block of `lang/en|es/microsoft365.php` under a `// Phase 6` comment. The earlier `'dismiss'` / `'restore'` values (Dismiss/Descartar, Restore/Restaurar) are unchanged. `MicrosoftLangTest` (en/es parity and placeholders) passes locally. `OutlookCalendarPropTest` now expects 177 labels in all 3 places (130 + 47, counted with PHP: 177 en, 177 es).
- **Types (`types.ts`):** the contract types from the plan's interfaces block, each commented with who fills it, what the D-01 snapshot means and the D-10 window. All 47 label keys are in `OutlookCalendarLabels`. The new response, sync and url fields are optional, so older fixtures and cached reads still compile.
- **Parsing (`meetingsApi.ts`):**
  - `out_of_sync.items` only accepts the kinds `moved`, `cancelled` and `removed`. `time_entry_id`, `meeting_start`, `meeting_end` and `entry_start` must be strings. `new_*` and `entry_end` must be a string or null, `all_day` must be `=== true`, and `description` falls back to `''`.
  - `auto_adjusted` keeps only entries whose six fields are all strings.
  - `moved_from` is kept when well formed and becomes null otherwise.
  - `postSync` returns `auto_adjusted` as a non-negative whole number (0 when absent or invalid).
  - Every existing field behaves as before.
- **`syncFlagReason.ts`:**
  - `formatRange` produces "Tue 10:00 – 11:00" or "Tue, Nov 24 · 10:00 – 11:00", in the user's time zone and the organization's time format.
  - `rangePair` uses the short form only when both starts fall in the same week, using the user's week start.
  - Also: `flagTitle`, `flagReason`, `flagDescribed`, `autoAdjustedNote`, `shortDate`, `countLabel`, `countAria`, `autoAdjustedAnnouncement`, `firstFlag` (earliest entry start, compared as instants, ties broken by id).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ef704eb2 | feat(06-03): out-of-sync copy, types, defensive parsing and flag reason text |
| 2 | 93d0181c | feat(06-03): counter labels, auto-adjust note and announcement, short dates, first flag |

## Gates

- Vitest: `meetingsApi.test.ts` and `syncFlagReason.test.ts`, 54 tests pass. The full `resources/js/m365` suite also passes (27 files, 639 tests), so the new `auto_adjusted` / `out_of_sync` fields break no other test.
- `npm run type-check` (vue-tsc) passes; `npx tsc --noEmit` passes.
- ESLint and Prettier `--check` are clean on the 5 TS files.
- Pint `--test` passes on the two lang files and `OutlookCalendarPropTest.php`.
- PHPUnit `tests/Unit/Microsoft365/MicrosoftLangTest.php` locally: OK (4 tests, 794 assertions).
- PHPStan: not applicable. No `app/` PHP was touched; lang and test files are outside the `phpstan.neon` paths.
- `OutlookCalendarPropTest` (label count 177): **PENDING CI (Actions disabled)**. It needs Postgres.
- TDD: RED was seen before GREEN in both tasks (Task 1: module missing; Task 2: 9 failing tests).

## Deviations from Plan

### Auto-fixed / additive (Rules 1-2, in scope)

1. **[Rule 2] Defensive text fallbacks.**
   - `flagReason` returns the moved title when a moved flag has no `new_start` / `new_end`, so no broken "→" text is shown.
   - `formatRange` accepts `end: null` (a running entry shows only its start) and an `allDay` option (day names only, exclusive end).
   - A range across local midnight names both days.
   - None of this was specified in the UI-SPEC; all of it is covered by tests.
2. **[Rule 2] `postSync` `auto_adjusted`:** negative or non-finite values also become 0, and fractions are floored. This goes slightly beyond "absent or not a number".
3. **12-hour format note:** `formatTime` already zero-pads (`hh:mm A`), so 13:00 shows as "01:00 PM". The spec's "10:00 AM – 11:00 AM" example holds. The helper reuses the core formatter instead of creating a second format.
4. **Execution environment:**
   - The worktree had been cut from an old upstream commit, so it was reset to BASE fef7d29f before work began (as the brief instructs).
   - Added `node_modules` / `vendor` junctions to the main checkout.
   - The sandbox refused the compound git command that writes the plan ledger file, so `plan_head_before` is the given BASE commit. `commits: 2` was counted with `git log` (BASE..93d0181c).

## Known Stubs

None. The helpers are pure and complete. 06-06 / 06-10 (server) and the wave-3 components consume them.

## Threat Flags

None. No new network surface: the read and sync endpoints already exist, and this plan only parses new fields. T-06-09 is mitigated by the whitelisted, defensive parse with tests. For T-06-10, the text is built only from times and lang strings, with no markup.

## Open items

- `OutlookCalendarPropTest` (177 labels) has to run in CI once GitHub Actions is enabled again.

## Self-Check: PASSED

- FOUND: resources/js/m365/calendar/syncFlagReason.ts, resources/js/m365/calendar/syncFlagReason.test.ts
- FOUND commits: ef704eb2, 93d0181c (ancestors of HEAD)
- Acceptance greps: `'osync_` en=35, es=35; the 12 other keys = 12; `labels', 177` = 3; `out_of_sync` in meetingsApi.ts = 1; the six Task 2 exports = 6; `git status --porcelain -- resources/js/m365 lang tests/Feature/Microsoft365` was empty after the Task 2 commit
