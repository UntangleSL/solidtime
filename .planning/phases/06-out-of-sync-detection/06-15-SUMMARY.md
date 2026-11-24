---
phase: 06-out-of-sync-detection
plan: 15
subsystem: microsoft365-out-of-sync
tags: [m365, outlook, out-of-sync, queue, scheduler, compose]
status: complete
requires: [06-02, 06-08, 06-09]
provides:
  - "App\\Microsoft365\\Console\\CheckOutOfSyncCommand: m365:check-out-of-sync {--dry-run}; 'configured: no' + exit 0 when off; else 'users: N' and 'dispatched: M' (' (dry run)' suffix), counts only"
  - "App\\Microsoft365\\Jobs\\CheckOutOfSyncForUser (ShouldQueue, Foundation Queueable): __construct(public readonly string $userId), tries 3, timeout 120, handle(OutOfSyncScope, OutOfSyncLookups, OutOfSyncApplier)"
  - "Schedule from Microsoft365ServiceProvider::boot() (console only): callAfterResolving(Schedule::class) -> command('m365:check-out-of-sync')->dailyAt(daily_at)->timezone(daily_timezone)->withoutOverlapping()->when(MicrosoftConfig::isConfigured)"
  - "docs/deploy/dokploy-compose.fork.yml: the seven SOLIDTIME_MICROSOFT_* lines on scheduler and queue (21 lines total)"
  - "tests/Feature/Microsoft365/OutlookOutOfSyncJobTest.php (15 tests) and OutlookOutOfSyncScheduleTest.php (3 tests), CI"
affects: [06-18, 06-19]
requirements-completed: [OSYNC-01, OSYNC-02]
tech-stack:
  added: []
  patterns:
    - "Fork-owned scheduling: callAfterResolving(Schedule::class) in the fork provider, no core Kernel edit (D-13)"
    - "Per-user queued job with stagger; persisted Graph back-off releases the job instead of calling Graph"
key-files:
  created:
    - app/Microsoft365/Jobs/CheckOutOfSyncForUser.php
    - app/Microsoft365/Console/CheckOutOfSyncCommand.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncJobTest.php
    - tests/Feature/Microsoft365/OutlookOutOfSyncScheduleTest.php
  modified:
    - app/Microsoft365/Microsoft365ServiceProvider.php
    - docs/deploy/dokploy-compose.fork.yml
decisions:
  - "Job order: last_checked_at ASC NULLS FIRST, then meeting_starts_at, then id; limit and lookUp budget both microsoft365.out_of_sync.lookups_per_job (default 300); lookup deadline now + 100 s inside the 120 s timeout"
  - "The job logs one 'Outlook out-of-sync check' info line with fixed keys checked/adjusted/flagged/released/cleared/stopped; stopped is the lookups' reason, 'not_connected' or 'backoff' for the guards, null otherwise"
  - "While backed off the job calls release(remaining seconds) and returns; a throttled lookup inside a run is never retried by the job (the persisted back-off gates the next run)"
  - "The command dedupes users and skips accounts that are not connected, are backed off or have no active link in the window (one exists-query per account)"
  - "The schedule is registered only when running in console, next to the command registration"
  - "The schedule test rebuilds Schedule (forgetInstance) before reading events, because a nwidart module provider can resolve Schedule during boot, before a test sets config"
completed: 2026-11-24
duration: ~50 min
metrics:
  tasks: 3
  files: 6
estimate:
  tokens: 90000
actuals:
  tokens: 11700
  tasks: 3
  commits: 3
plan_head_before: 31416de8644ee8a94d254c6684d40004789ca184
plan_head_after: 68b1362d07856bc93d5075ea3e5e0e2a04f2b144
---

# Phase 6 Plan 15: Daily Out-of-Sync Job Summary

A daily 05:30 Europe/Madrid scheduled command, registered from the fork's provider, queues one staggered per-user job. Each job looks up the user's active linked meetings in the 60-day window (least recently checked first, at most 300) and applies the answers through the same rules and applier as the interactive sync. The queue and scheduler containers get the Microsoft variables so token refresh works there.

## What was built

- **CheckOutOfSyncCommand** (`m365:check-out-of-sync {--dry-run}`): does nothing and exits 0 when the integration is off. Otherwise it selects connected accounts, keeps those in the `connected` state with no back-off whose user has at least one active link in the window, and dispatches `CheckOutOfSyncForUser` with a delay of `i * dispatch_stagger_seconds` (10 s). Output is counts only.
- **CheckOutOfSyncForUser**: reloads the user and the account and does nothing without a valid connection. While a back-off is active it releases itself for the remaining seconds. Otherwise it looks up the ordered, capped active-link ids with `OutOfSyncLookups::lookUp` (now + 100 s deadline), applies the observations with `OutOfSyncApplier::apply`, and logs one counts-only line. Auth is left to `CoreTimeEntryUpdater`, which sets the link's user for each core update and forgets it afterwards.
- **Schedule**: `callAfterResolving(Schedule::class, …)` in `Microsoft365ServiceProvider::boot()`. It reads `daily_at` and `daily_timezone` from config, uses `withoutOverlapping()`, and runs only while the integration is configured. Core `app/Console/Kernel.php` and `bootstrap/app.php` are untouched.
- **Compose**: the scheduler and queue services carry the same seven `SOLIDTIME_MICROSOFT_*` `${VAR:-…}` lines as the app service, inserted after `TRUSTED_PROXIES`. Image tags (`sha-6d8a5cc` x4) and the header are unchanged.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 9cb6988b | feat(06-15): queue a daily per-user out-of-sync check of linked meetings |
| 2 | 28b4d6d0 | feat(06-15): schedule the daily out-of-sync check from the fork provider |
| 3 | 68b1362d | feat(06-15): give the queue and scheduler services the Microsoft variables |

## Gates

- Pint `--test` on app/Microsoft365 and both new test files: passed.
- Full-app PHPStan (worktree-first autoload loader): no errors.
- Docs secrets gate `node tests/Tools/m365-spike/validate-docs.mjs secrets`: `secrets: OK (2284 checks)`.
- Compose counts measured before editing: SOLIDTIME_MICROSOFT_ 7, CLIENT_ID 1, CLIENT_SECRET interpolation 1, sha-6d8a5cc 4. After: 21 / 3 / 3 / 4.
- `git diff --quiet 31416de8 -- app/Console/Kernel.php bootstrap/app.php`: clean.
- Feature PHPUnit (OutlookOutOfSyncJobTest, OutlookOutOfSyncScheduleTest): PENDING CI (orchestrator). They need Postgres.

## Deviations from Plan

1. **[Rule 3 - Plan drift] Compose baseline**: the plan's acceptance criterion expects `sha-0f2d424` x4. The file now pins `sha-6d8a5cc` x4 and has one more header line. Per the orchestrator note, I measured the baselines myself and added only the Microsoft lines, so `sha-6d8a5cc` still counts 4.
2. **[Rule 2 - Robustness] Schedule test rebuilds Schedule**: `nwidart/laravel-modules` providers resolve `Schedule` in a `booted` callback. In CI with extensions installed, the singleton can therefore exist before the test body runs. The test helper calls `forgetInstance(Schedule::class)` and resolves it again, which fires the after-resolving callback on a fresh Schedule.
3. **Extra tests** (beyond the listed behaviors): the command does nothing while the integration is not configured, the command staggers its dispatches at 0 s and 10 s, and the schedule follows the configured time and time zone.
4. Task 2 needed no further change to the job class: Task 1 already implemented the guards (back-off release, not-connected skip, stop reasons). Task 2 added the tests and the schedule.

## Known Stubs

None.

## Threat Flags

None: the new surface (queue job, console command, compose environment) is the one in the plan's threat model (T-06-32..36).

## Open items

- CI must run OutlookOutOfSyncJobTest and OutlookOutOfSyncScheduleTest (Gate W / Gate B).
- Post-deploy checks (06-18 / 06-19): in the scheduler container, `php artisan schedule:list` shows m365:check-out-of-sync and `php artisan m365:check-out-of-sync --dry-run` prints counts.
- The comment on `lookups_per_job` in config/microsoft365.php says "across all users", but D-11 and this plan apply it per job (per user). The config file is outside this plan's files, so I left it unchanged.

## Self-Check: PASSED

- FOUND: app/Microsoft365/Jobs/CheckOutOfSyncForUser.php, app/Microsoft365/Console/CheckOutOfSyncCommand.php, tests/Feature/Microsoft365/OutlookOutOfSyncJobTest.php, tests/Feature/Microsoft365/OutlookOutOfSyncScheduleTest.php
- FOUND commits: 9cb6988b, 28b4d6d0, 68b1362d (3 commits since 31416de8)
