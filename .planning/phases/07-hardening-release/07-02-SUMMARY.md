---
phase: 07-hardening-release
plan: 02
subsystem: impersonation-safety
tags: [security, impersonation, sec-04, ops-03, canary]
requires: [07-01]
provides:
  - "App\\Microsoft365\\Http\\Middleware\\EnsureNotImpersonating (404 while GraphAccessGuard::blocked()), last middleware of DELETE /user/microsoft"
  - "MicrosoftAuthController::__construct(GraphAccessGuard $access): 404 on the connect branch of redirect() and at the top of callback() while impersonating"
  - "ShareMicrosoftInertiaData: no microsoft.account on the profile while impersonating"
  - "MicrosoftImpersonationMatrixTest: MATRIX of all 14 fork routes, route canary, Disconnect/Connect/callback/profile/calendar cases"
  - "ForkIsolationTest: fork jobs dispatched only from app/Microsoft365/Console; every ledger path exists"
affects: [07-05, 07-06, 07-07]
requirements-completed: [SEC-04, OPS-03]
tech-stack:
  added: []
  patterns:
    - "Every impersonation refusal is a plain 404 that calls GraphAccessGuard::blocked(); no second impersonation check exists"
    - "Route canary: the set of App\\Microsoft365 controller routes must equal the impersonation MATRIX keys"
key-files:
  created:
    - app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php
    - tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php
    - tests/Unit/Microsoft365/ForkIsolationTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
decisions:
  - "The callback guard runs after the three read-and-forget pulls and also forgets the timezone key, so an impersonated callback leaves no Connect state behind"
  - "The ledger canary uses file_exists, not assertFileExists, because the ledger also names directories"
  - "The matrix seeds a series setting, a moved-flagged link and a released link, and asserts each of the six snapshot tables holds a row, so an unchanged snapshot is not vacuous"
metrics:
  duration: "about 45 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 8200
  tasks: 3
  commits: 3
plan_head_before: 34669a55a7b6f941eae589724d4d4857b812dac8
plan_head_after: 0e900aa394a2febeb2ec1d46bac0f31e4e04bdbc
---

# Phase 7 Plan 02: Impersonation Safety Summary

While an admin impersonates a user, Disconnect, Connect start and the Microsoft callback now answer 404 before anything runs, the profile carries no Microsoft account data, and one matrix test sweeps all 14 fork routes with a canary that fails when a new route skips the matrix. Two static canaries keep Graph jobs dispatchable only from fork console commands and keep every ledger path real.

## What was built

- **EnsureNotImpersonating** (new fork middleware, shape of EnsureMicrosoftIsEnabled): `abort(404)` when `GraphAccessGuard::blocked()`. It is the last middleware of the `DELETE /user/microsoft` group, after `verified`, so a guest still gets core's login redirect. The `/auth/microsoft` group (guest sign-in shares the redirect route) and the `/m365` group (controllers answer for themselves) are unchanged.
- **MicrosoftAuthController** now takes `GraphAccessGuard` in its constructor. The gateway stays method-injected, so the 404 answers before the container resolves it.
  - `redirect()`: after the guest-to-login branch and before any session write, the connect branch is a 404 while blocked. This closes RESEARCH Pitfall 1: the admin's own Microsoft identity could have been linked to the user.
  - `callback()`: after the three read-and-forget pulls, a 404 while blocked. The timezone key is also forgotten, and no gateway, guard, resolver or login runs.
  - Guest sign-in and the non-impersonated Connect are unchanged.
- **ShareMicrosoftInertiaData**: the profile block is now `routeIs('profile.show') && ! $this->access->blocked()`. `MicrosoftConnectionForm.vue` renders nothing without `account`.
- **MicrosoftImpersonationMatrixTest** (7 tests):
  - `test_disconnect_is_a_404_and_changes_nothing_while_impersonating`
  - `test_connect_redirect_is_a_404_while_impersonating`
  - `test_connect_callback_is_a_404_and_links_nothing_while_impersonating`
  - `test_profile_carries_no_microsoft_account_while_impersonating`
  - `test_every_microsoft_route_is_inert_while_impersonating`: the 14-row MATRIX. Each row expects a 404, the empty read or a not_connected sync. The test then checks byte-identical snapshots of the five fork tables plus time_entries, `Http::assertNothingSent()`, zero gateway calls, and that the session user is unchanged.
  - `test_every_fork_route_is_in_the_impersonation_matrix`
  - `test_calendar_carries_no_outlook_block_while_impersonating`
- **ForkIsolationTest** (unit, `#[CoversNothing]`):
  - `test_fork_jobs_are_dispatched_only_from_fork_console_commands`: looks for static dispatch, `new Job(` and `dispatch(new Job` forms. It must find the known `CheckOutOfSyncCommand` site, so it cannot pass vacuously.
  - `test_every_path_in_the_touched_core_files_ledger_exists`: 152 path tokens today, all present and all git-tracked, so it holds in CI.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ea14940c | feat(07-02): Disconnect answers 404 while an admin impersonates |
| 2 | 2e3257e3 | fix(07-02): Connect, callback and the profile card are inert while impersonating |
| 3 | 0e900aa3 | test(07-02): impersonation matrix, route canary and fork isolation canaries |

## Gates

- Task 1 route checks (worktree artisan wrapper):
  - `route:list --name=microsoft.account.destroy` prints exactly `EnsureEmailIsVerified EnsureNotImpersonating `.
  - `microsoft.redirect` has 0 `EnsureNotImpersonating` and 1 `EnsureMicrosoftIsEnabled`.
- Route canary dry run: `route:list --json` lists exactly the 14 MATRIX names for `App\Microsoft365\Http\Controllers` actions.
- Gate P: Pint `--test` passed on all six files. Full-app PHPStan (worktree-first autoload file) reported `[OK] No errors` after each task.
- Gate U: `ForkIsolationTest` gave OK (2 tests, 157 assertions). The full `tests/Unit/Microsoft365` run passed except the 12 known local-only OpenSSL failures in `SocialiteMicrosoftGatewayTest`.
- Exact-shape grep: no assertion in tests/Feature|Unit/Microsoft365 depends on the profile `microsoft.account` prop under impersonation. No response shape changed. The `microsoft.meetings.*` route count (11) is unchanged.
- `MicrosoftImpersonationMatrixTest` (feature, Postgres) is PENDING CI (orchestrator). The wave gate expects at least 196 Microsoft365 PASS lines.

## Deviations from Plan

None. The plan was executed as written. Tooling notes, not deviations:
- The worktree had no `vendor`/`node_modules`. I created junctions to the main checkout; they are gitignored and not committed.
- `artisan route:list` ran through a scratchpad wrapper that loads the worktree-first `App\` autoloader. Plain `php artisan` in a junctioned worktree would read the main checkout's classes.
- The plan's ledger file `gsd-plan-head-before-07-02` could not be written under the worktree's git dir: the sandbox refused compound git commands. The base is recorded above as `plan_head_before` (BASE 34669a55, which this worktree was reset to at start).

## Known Stubs

None.

## Threat Flags

None. The plan's register already covers T-07-06 to T-07-10, and no new surface was added.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php
- FOUND: tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php
- FOUND: tests/Unit/Microsoft365/ForkIsolationTest.php
- FOUND commits: ea14940c, 2e3257e3, 0e900aa3 (ancestors of HEAD)
