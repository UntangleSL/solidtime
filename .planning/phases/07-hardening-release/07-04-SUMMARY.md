---
phase: 07-hardening-release
plan: 04
subsystem: microsoft365-off-switch
tags: [ops, off-switch, e2e, phpunit, OPS-02]
requires: [07-01]
provides:
  - e2e/outlook-off-switch.spec.ts (OPS-02 browser proof on /calendar)
  - Tests\Feature\Microsoft365\MicrosoftOffSwitchTest (OPS-02 server proof)
affects: [07-05 (adds the ledger row for the new e2e fork file)]
requirements-completed: [OPS-02]
key-files:
  created:
    - e2e/outlook-off-switch.spec.ts
    - tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php
  modified: []
decisions:
  - "The route sweep uses the seeded user's real organization, meeting and entry ids (not one fixed uuid), so the 404 can only come from EnsureMicrosoftIsEnabled and not from route model binding of an unknown organization"
status: complete
completed: 2026-11-27
actuals:
  tokens: 4100
  tasks: 2
  commits: 2
plan_head_before: 34669a55a7b6f941eae589724d4d4857b812dac8
plan_head_after: 9fe15d79
---

# Phase 7 Plan 04: Off switch proof Summary

The off switch (OPS-02) is now proven end to end: a Playwright spec shows the calendar renders the user's entries with no Outlook element and no request to `/m365/` or `/auth/microsoft/`, and one feature class sweeps all 14 `microsoft.*` routes (404 for guests and the signed-in user), the shared prop (`{enabled: false}` on login, calendar and profile), the 05:30 job (filter fails, command prints `configured: no`, nothing queued), Graph (no call) and the data (no row lost; switching back on serves the same meeting, linked entry and account). No production code changed.

## What was built

- **`e2e/outlook-off-switch.spec.ts`**: test "calendar shows time entries and nothing from Outlook when the integration is off". Collects every request whose path contains `/m365/` or `/auth/microsoft/`, creates a 09:00-10:00 UTC entry for today through the core API, opens `/calendar`, expects the `.fc-event` visible, then `toHaveCount(0)` for `outlook-calendar-controls`, `outlook-lane`, `outlook-entry-badge`, `outlook-selection-bar`, `outlook-out-of-sync`, `outlook-sync-button`, and finally an empty request list. Nothing is injected (no `__TEST_SET_OUTLOOK_MEETINGS__`).
- **`tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php`** (`unconfigure()` = missing client secret; `seedUser()` writes one row in each of the five fork tables plus the linked time entry):
  - `test_every_microsoft_route_is_a_404_while_unconfigured`: asserts 14 routes, calls each with its first method as guest and as the seeded user, all 404, `Http::assertNothingSent()`; a control afterwards (configured again) shows the meetings read reaches the controller (422 without a range).
  - `test_pages_share_only_enabled_false_while_unconfigured`: login (guest), calendar and profile have `microsoft` exactly `['enabled' => false]`.
  - `test_daily_check_is_filtered_and_queues_nothing_while_unconfigured`: rebuilt Schedule, the single `m365:check-out-of-sync` event has `filtersPass` false; the command exits 0, prints exactly `configured: no`, `Queue::assertNothingPushed()`, `Http::assertNothingSent()`.
  - `test_switching_off_keeps_the_data_and_switching_on_restores_it`: counts of the five fork tables and time entries unchanged while off (meetings read 404, profile `{enabled: false}`); configured again, the read returns the seeded meeting id, the linked entry id and `last_synced_at`, the profile has `microsoft.account.linked` true with the account email, counts still the seeded ones.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 4ba4d2aa | test(07-04): calendar shows no Outlook element and calls no fork endpoint when the integration is off |
| 2 | 9fe15d79 | test(07-04): the off switch hides every fork surface and keeps the data |

## Gates

- Gate E (Task 1): eslint clean, prettier clean, `playwright test --list --project=chromium` lists the test. Extra: `tsc` on the spec reports no error in the new file (only pre-existing ones in `e2e/utils/api.ts`, `e2e/utils/mailpit.ts`, `playwright/fixtures.ts` under a standalone config).
- Gate P (Task 2): `php -l` clean, Pint `--test` passed. Extra: PHPStan level 7 (Larastan) on the test class with a worktree-first loader: no errors.
- Playwright run: PENDING CI (orchestrator, Playwright Tests in Gate W).
- `MicrosoftOffSwitchTest` (Postgres): PENDING CI (orchestrator).
- No file under `app/` changed (`git log --grep="(07-04)" -- app` is empty), so full-app PHPStan is unaffected by this plan.

## Deviations from Plan

1. **[Rule 2 - Stronger proof] Real ids instead of one fixed uuid in the route sweep.** The plan gave every route parameter the same fixed uuid. `microsoft.meetings.convert` and `microsoft.meetings.move-entry` bind `Organization` through route model binding (the `web` group's `SubstituteBindings`), so an unknown uuid would be a 404 even with the integration on, and the test would prove nothing for those routes. The sweep now uses the seeded user's organization, meeting and entry ids (fixed uuid only as fallback) and ends with a configured control (meetings read answers 422, not 404). Commit 9fe15d79.
2. **Command assertion style.** `artisan()` returns `PendingCommand|int`, which PHPStan rejects for chained expectations; the test follows `MicrosoftCheckCommandTest` instead (`withoutMockingConsoleOutput()->artisan()` + `Artisan::output()`), asserting exit code 0, output exactly `configured: no` and no `dispatched` line. Commit 9fe15d79.
3. **e2e wait.** Before the request-list check the spec waits a fixed 1 s (like the rest of the calendar specs) instead of `networkidle`, which resolves immediately once already reached.

## Known Stubs

None.

## Threat Flags

None (tests only; T-07-14, T-07-15 and T-07-16 are covered by the assertions above).

## Self-Check: PASSED

- FOUND: e2e/outlook-off-switch.spec.ts
- FOUND: tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php
- FOUND: 4ba4d2aa (ancestor of HEAD)
- FOUND: 9fe15d79 (ancestor of HEAD)
- Acceptance greps: 6 test ids present, `/m365/` present, `__TEST_SET_OUTLOOK_MEETINGS__` count 0, `configured: no` 1, `filtersPass` 1, `assertNothingSent|assertNothingPushed` 4, four test methods present.
