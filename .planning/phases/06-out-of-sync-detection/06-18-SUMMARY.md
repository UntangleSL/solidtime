---
phase: 06-out-of-sync-detection
plan: 18
subsystem: release
tags: [release, ledger, compose, ci, dokploy-pin]
requires: [06-01, 06-02, 06-03, 06-04, 06-05, 06-06, 06-07, 06-08, 06-09, 06-10, 06-11, 06-12, 06-13, 06-14, 06-15, 06-16, 06-17]
provides:
  - "docs/m365/TOUCHED-CORE-FILES.md: Phase 6 section reconciled with the real diff (Reconciliation (06-18))"
  - "Release commit R = 8ec9a5abfa483b7bdebf14b07da2bfcc5972a0ce, green in all ten workflows, image ghcr.io/untanglesl/solidtime:sha-8ec9a5a"
  - "docs/deploy/dokploy-compose.fork.yml pinned to sha-8ec9a5a with the Phase 6 header line"
affects: [06-19]
requirements-completed: [OSYNC-01, OSYNC-02, OSYNC-03]
completed: 2026-11-24
status: complete
key-files:
  created: []
  modified:
    - docs/m365/TOUCHED-CORE-FILES.md
    - docs/deploy/dokploy-compose.fork.yml
decisions:
  - "Pushing allowed for this plan (04-09 / 05-14 precedent): R and the pin commit were pushed fast-forward to origin feature/m365-integration (no rebase needed, origin had not moved)"
  - "The compose pinned sha-6d8a5cc (mid-phase deploy of the UAT follow-up and the Phase 6 wave-1 schema), not sha-0f2d424 as the plan assumed; the pin replaced sha-6d8a5cc and the header says no new migration runs, because 2026_11_23_000001 was already applied with sha-6d8a5cc"
  - "The Phase 6 header line is the newest header entry (top of the list, above the UAT follow-up line, which itself sits above the Phase 5 line)"
metrics:
  duration: "~20 min (plus ~60 min CI wait)"
  tasks: 2
  files: 2
estimate:
  tokens: 40000
actuals:
  tokens: 2100
  tasks: 2
  commits: 2
plan_head_before: eb071ffe4d089d9ff81ea54d08b27945e6d6e9f7
plan_head_after: d2213fcf27e320e4cd58eed3eebbfdcc37f2c47e
---

# Phase 6 Plan 18: Release preparation Summary

Phase 6 release prepared: core-touch ledger reconciled against the real phase diff, release commit R `8ec9a5ab` proved green in all ten workflows (135 Microsoft365 PASS lines), and the compose pinned to `ghcr.io/untanglesl/solidtime:sha-8ec9a5a` with a Phase 6 header line. Not deployed: the orchestrator deploys (D-15).

## What was built

### Task 1 (tracer): ledger, R green, what ships

- `## Phase 6 (Out-of-sync detection)` in `docs/m365/TOUCHED-CORE-FILES.md` now has a "New files inside core directories" table (`e2e/outlook-out-of-sync.spec.ts`, 06-17), the lang note (47 calendar keys each in en/es, none changed), a "Fork-owned paths" table and `### Reconciliation (06-18)`.
- Diff check (base `e3c56fc1`, the commit that added the Phase 6 plans) lists seven non-fork paths: `TimeEntryCalendar.vue`, `Calendar.vue` (06-16), `e2e/outlook-out-of-sync.spec.ts` (06-17), `config/microsoft365.php` (06-02 + `75896711`), `resources/js/branding/contrast.test.ts` (06-04), `.claude/CLAUDE.md` (06-05) and `e2e/outlook-convert.spec.ts` (see Deviations).
- Hot files: the plan's list (TimeEntryController, TimeEntryUpdateRequest, TimeEntryStoreRequest, TimeEntry model, Console Kernel, routes/api.php, openapi.json, CalendarDayColumn.vue, FullCalendarEventContent.vue) prints nothing in the diff.
- R = `8ec9a5abfa483b7bdebf14b07da2bfcc5972a0ce`, pushed and verified:

| Workflow | Run id | Conclusion |
| --- | --- | --- |
| Fork - Build image | 45397359681 | success (log tags `solidtime:sha-8ec9a5a`) |
| NPM Build | 45397359994 | success |
| NPM Format Check | 45397359666 | success |
| NPM Lint | 45397359605 | success |
| NPM Test Unit | 45397359657 | success |
| NPM Typecheck | 45397359647 | success |
| PHP Linting | 45397359574 | success |
| PHPUnit Tests | 45397359693 | success, 135 Microsoft365 PASS lines (45 classes x 3 Postgres jobs) |
| Playwright Tests | 45397359704 | success (includes `e2e/outlook-out-of-sync.spec.ts` of 06-17) |
| Static code analysis (PHPStan) | 45397359661 | success |

  The wave gates handed over by 06-01, 06-05/06-06, 06-08/06-10, 06-15 and 06-17 (PHPUnit with Postgres, Playwright, full PHPStan, image build) are all covered by this one run on R, which contains every Phase 6 commit.
- What ships: `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/release-06-commits.txt` lists the 68 non-merge commits from `0f2d4247` (Phase 5 image) to R grouped by plan prefix, with commits already deployed in `sha-6d8a5cc` marked. Non-(06-NN) commits that change code:

| Commit | Subject | Already in production (sha-6d8a5cc) | Scope |
| --- | --- | --- | --- |
| `acbdc19f` | feat(m365): create project/client from the meeting form; Dismiss in the More menu | yes | fork files + e2e + lang |
| `ad2bed4e` | feat(m365): meeting form lists tags alphabetically | yes | fork files |
| `6d8a5ccf` | test(e2e): wait for the intercepted conversion before ending the create-project test | yes | e2e only |
| `57a79109` | test(06): last_checked_at stamp is bookkeeping in the link lifecycle comparison | no | fork test |
| `7bcb5562` | test(06): time_entries.description is not nullable; use an empty description | no | fork test |
| `31416de8` | fix(06): wait for the per-user out-of-sync lock on the monotonic clock | no | fork `OutOfSyncApplier.php` |
| `75896711` | docs(06): lookups_per_job is a per-user job budget | no | comment in `config/microsoft365.php` |

  None changes behaviour outside the fork; the two `feat(m365)` follow-ups are already running in production since the `sha-6d8a5cc` deploy.

### Task 2: compose pin

- `docs/deploy/dokploy-compose.fork.yml`: app, scheduler and queue on `ghcr.io/untanglesl/solidtime:sha-8ec9a5a` (3 lines); new header line "Phase 6 (out-of-sync detection): no new variables in the Dokploy Environment; SOLIDTIME_MICROSOFT_* also passed to scheduler and queue (daily m365:check-out-of-sync at 05:30 Europe/Madrid, D-20); image sha-8ec9a5a; no new migration: ... (migration 2026_11_23_000001) with sha-6d8a5cc".
- Checks: `sha-8ec9a5a` image lines 3; "Phase 6 (out-of-sync detection)" 1; `SOLIDTIME_MICROSOFT_CLIENT_ID` 3; `sha-0f2d424` 1 (Phase 5 header); `sha-6d8a5cc` 2 (UAT header line + mention in the Phase 6 line); docs secrets gate `secrets: OK (2293 checks)`; `git status --porcelain -- docs` empty.

## Commits

- `8ec9a5ab` docs(06-18): reconcile the Phase 6 core-touch ledger with the real diff (release commit R, pushed)
- `d2213fcf` chore(06-18): pin the compose to sha-8ec9a5a for the Phase 6 release (pushed)

## Deviations from Plan

1. **[Rule 3 - Blocking] Compose pinned sha-6d8a5cc, not sha-0f2d424.** The orchestrator deployed `sha-6d8a5cc` mid-phase (`883e9016`, UAT follow-up + Phase 6 wave-1 schema). The pin replaced `sha-6d8a5cc`. As a result the plan check "`sha-0f2d424` prints 1" still holds (Phase 5 header line), and the header line says the migration is already applied instead of "AUTO_DB_MIGRATE adds...". When the image starts, `migrate` finds nothing to run.
2. **[D-13 report] `e2e/outlook-convert.spec.ts` in the phase diff, explained by no Phase 6 plan.** It comes from `6d8a5ccf` ("test(e2e)"), an orchestrator CI-stability follow-up to the Phase 5 browser proofs: one added `await expect(ghost(page, 'm-newproj')).toHaveCount(0)`. It is a fork test file with no application behaviour, already in `sha-6d8a5cc`. Recorded in the ledger's Reconciliation line instead of being hidden.
3. Release list base: the plan asks for `0f2d4247..R`; it was produced that way, with the commits already in `sha-6d8a5cc` marked, so the orchestrator can see that only Phase 6 waves 2 to 5 and the `(06)` follow-ups are new to production.

## Hand-off to the orchestrator (D-15)

Deploy from `d2213fcf` (`docs/deploy/dokploy-compose.fork.yml`): replace the Dokploy compose content, do not edit the Environment tab, redeploy, then confirm that the three containers run `sha-8ec9a5a`, that `schedule:list` in the scheduler lists `m365:check-out-of-sync` at 05:30 Europe/Madrid, and that `m365:check-out-of-sync --dry-run` prints `users:` / `dispatched:` and no `configured: no`. Then 06-19.

## Known Stubs

None (docs-only plan).

## Self-Check: PASSED

- FOUND: docs/m365/TOUCHED-CORE-FILES.md ("Reconciliation (06-18)" x1, "outlook-out-of-sync.spec.ts" x2)
- FOUND: docs/deploy/dokploy-compose.fork.yml (sha-8ec9a5a x3)
- FOUND: C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/release-06-commits.txt
- FOUND commits on HEAD and origin: 8ec9a5ab, d2213fcf
