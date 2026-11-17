---
phase: 04-assign-meetings-to-projects
plan: 02
subsystem: microsoft365-meeting-conversion
tags: [m365, outlook, time-entries, conversion, idempotency, laravel]
requires:
  - 04-01 outlook_meeting_links table, OutlookMeetingLink, CoreTimeEntryCreator, MeetingConversionController, hide rule in OutlookMeetingController::index
provides:
  - "Idempotent conversion: status 'existing' with the linked entry id for repeats; UniqueConstraintViolationException recovery (existing or per-meeting 'conflict', never a 500); stale-link cleanup"
  - "GET /m365/meetings JSON = { data, sync, linked_time_entry_ids: string[] } (contract for 04-06)"
  - OutlookMeetingLinkLifecycleTest (delete paths, edits, reassignment, re-sync, disconnect/reconnect, linked ids)
affects: [04-06, 04-08]
requirements-completed: [ASGN-03, ASGN-04, ASGN-05]
key-files:
  created:
    - tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php
  modified:
    - app/Microsoft365/Http/Controllers/MeetingConversionController.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - tests/Feature/Microsoft365/OutlookMeetingConversionTest.php
    - tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php
decisions:
  - "Unique-violation fallback without a winner owned by the user answers failed {key: 'conflict', message: microsoft365.calendar.error_generic}"
  - "linked_time_entry_ids is ordered by the entry's start, then id; a running entry (no end) counts when its start lies in [start, end)"
status: complete
completed: 2026-11-17
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
plan_head_before: fbda4b784bcddd866ba53f55fdb6d4dc20074557
plan_head_after: c8e48b4b
---

# Phase 4 Plan 02: Safe, repeatable and reversible conversions Summary

Repeated, concurrent and stale conversions now resolve to exactly one entry per occurrence with a clear per-meeting answer, every core delete path brings the meeting back, links survive re-sync and Disconnect, and the meetings read names the user's entries that came from meetings.

## What was built

- **MeetingConversionController::store**
  - After the meeting row lock it looks up the link for (session user, graph_id). If the linked entry still belongs to the user, it answers `{status: 'existing', time_entry_id, error: null}` and does not call core (D-06, D-16).
  - If the linked entry now belongs to another user, the stale link is deleted and the conversion goes ahead (RESEARCH Pitfall 4).
  - A `UniqueConstraintViolationException` catch sits first, outside the per-meeting transaction, which has already rolled back. It re-reads the link: if the winner is owned by the user it answers `existing`, otherwise `failed` with key `conflict` and the `error_generic` message. It never answers 500.
- **OutlookMeetingController::index**
  - Adds `linked_time_entry_ids` beside `data` and `sync`: one query over links joined to time_entries, with a user_id filter on both. The entry has to overlap the half-open range [start, end) by its own start and end; the meeting's times are not used.
  - The list is `[]` in the early-return branch (impersonation, no account, not connected).
- **Tests**
  - New `OutlookMeetingLinkLifecycleTest` with 10 tests, 500 lines. Single, bulk, member-removal and organization deletes all run through the real core endpoints and services. It also covers PUT edits, `assignOrganizationEntitiesToDifferentMember`, re-sync of round A, Disconnect plus reconnect plus sync, linked ids by the entry's own time, empty linked ids, and that other users' entries are never named.
  - `OutlookMeetingConversionTest` gains 7 tests: repeat, DB unique index, 500-free race recovery, stale link, mixed batch, a failure that does not roll back the others, and each meeting keeping its own subject and time.
  - `OutlookMeetingPrivacyTest` gains 2 tests: impersonation cannot convert, and converting leaves other entries identical. The `OutlookMeetingLink` needle was added to the Filament/audit check.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | de404661 | feat(04-02): idempotent meeting conversion with race and stale-link handling |
| 2 | 42810bbe | feat(04-02): linked entry ids in the meetings read and link lifecycle tests |
| 3 | c8e48b4b | test(04-02): per-meeting batch results, impersonation and data-safety guards |

## Verification

- Gate P after every task: Pint `--test` on app/Microsoft365 and tests/Feature/Microsoft365 passed. Full-app PHPStan reported `[OK] No errors`.
- `php -l` on the three touched test files passed.
- An ad-hoc PHPStan level-5 run over the new tests found only the `create(array_merge(...))` pattern already present in the existing `meeting()` helper. Tests are outside the gate's `paths`.
- Acceptance greps:
  - controller: UniqueConstraintViolationException 2, `'existing'` 2, linked_time_entry_ids 3.
  - lifecycle test: 10 tests, deleteOrganization 1, delete calls 4.
  - conversion test: the three Task 1 test names, and test_batch_reports_each_meeting 1.
  - privacy test: outlook_meeting_links 1, test_impersonation_cannot_convert 1.
  - core files are unchanged against BASE.
- PHPUnit needs Postgres and runs only in CI. **The push and the wave-2 CI gate are handed over to the orchestrator**, because the executor rules forbid pushing. Expected on the merged wave-2 sha:
  - Gate W: the eight workflows report `=success`.
  - Gate B: at least 84. There are 28 Microsoft365 test classes x 3 Postgres jobs; this plan adds OutlookMeetingLinkLifecycleTest.

## Deviations from Plan

1. **[Rule 2 - Test coverage] Extra lifecycle test** `test_linked_ids_never_name_other_users_entries` covers T-04-11: the owner's converted entry in the same week is never in the employee's list.
2. **[Rule 2 - Test realism] The unique-violation double calls the real core create before it throws.** This proves that the meeting's transaction removes the entry core wrote, not only that nothing was written. The double cannot reproduce a committed concurrent winner, because everything shares one test connection. So the `existing` branch of the recovery is covered by code review only, and the test asserts the `conflict` branch.
3. `test_converting_does_not_change_other_entries` sits in OutlookMeetingPrivacyTest, next to its `timeEntrySnapshot()` helper. The plan listed it without naming a class, and both files are in this plan.
4. No production fix was needed in Task 3.

## Known Stubs

None.

## Threat Flags

None. T-04-09..12 are mitigated and tested as planned. linked_time_entry_ids only exposes the session user's own entry ids.

## Self-Check: PASSED

- The created file tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php exists.
- Commits de404661, 42810bbe and c8e48b4b are ancestors of HEAD.
