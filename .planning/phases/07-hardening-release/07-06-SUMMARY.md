---
phase: 07-hardening-release
plan: 06
subsystem: release
tags: [ops-03, ops-02, sec-03, sec-04, release, dokploy, backup, rollback, d-01, d-02, d-03]
requires: [07-05]
provides:
  - "docs/deploy/dokploy-compose.fork.yml: app, scheduler and queue pinned to ghcr.io/untanglesl/solidtime:sha-0ebd0f6 with the Phase 7 header line"
  - "Production time.untangle.es on sha-0ebd0f6 (upstream merge d0f5e745 + Phase 7 hardening), verified from outside"
  - "docs/m365/RUNBOOK-entra-app.md: Historial row 2026-11-27 Fase 7 with backup and rollback"
  - "docs/m365/UPSTREAM-MERGE.md: release image sha-0ebd0f6 in the merge history, release note (backup, health, rollback), corrected section 8 restore command"
affects: []
requirements-completed: [OPS-03, OPS-02, SEC-03, SEC-04]
key-files:
  created: []
  modified:
    - docs/deploy/dokploy-compose.fork.yml
    - docs/m365/RUNBOOK-entra-app.md
    - docs/m365/UPSTREAM-MERGE.md
decisions:
  - "The pre-deploy backup is a pg_dump -Fc file inside the database volume (Dokploy has no backup job for this compose); the rollback restores that file from the database service Terminal"
  - "The runbook row credits 'propietaria / orquestación' (not only 'orquestación') because the owner took the backup"
  - "The migrations are recorded as run by AUTO_DB_MIGRATE without log confirmation (compose-readLogs unavailable); the healthy app is the only evidence"
status: complete
completed: 2026-11-27
metrics:
  duration: "about 15 min (Task 3); Tasks 1-2 by the orchestrator"
  completed: 2026-11-27
estimate:
  tokens: 45000
  tasks: 3
actuals:
  tokens: 3000
  tasks: 3
  commits: 2
plan_head_before: 0ebd0f6fb57d8e28b3ef2dd81a7b49b10abcbf59
plan_head_after: 0f213af486863cd5293768d31596a2ecc347a9f6
---

# Phase 7 Plan 06: Release to time.untangle.es Summary

The upstream merge and Phase 7 hardening now run in production as image `sha-0ebd0f6`. The image was built from a commit where all ten workflows passed. A database backup was confirmed before the deploy. External checks pass. The rollback path (image `sha-d379903` plus restoring `pre-fase7-2026-11-27.dump`) is written down in the runbook and in the merge history.

`commits: 2` counts the commits from `0ebd0f6f` to `0f213af4`: the pin commit `eaa9274d` and the Task 3 docs commit. This SUMMARY's own commit comes after that and is not included.

## Task 1: release artifact and pin (orchestrator)

- Release commit R = `0ebd0f6fb57d8e28b3ef2dd81a7b49b10abcbf59`. Image tag `sha-0ebd0f6`.
- All ten workflows passed: Fork - Build image, NPM Build, NPM Format Check, NPM Lint, NPM Test Unit, NPM Typecheck, PHP Linting, PHPUnit Tests, Playwright Tests, Static code analysis (PHPStan).
- Gate B: 196 Microsoft365 PASS lines (minimum 196).
- Pin commit `eaa9274d` (`chore(07-06): pin release image sha-0ebd0f6`). The three image lines use `sha-0ebd0f6`, and the Phase 7 header line was added above the Phase 6 UAT fix line. `sha-d379903` now appears only in the two header lines.
- `release-07-gates.txt` is not in `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/`. The orchestrator ran Task 1 and reported the results above directly.

## Task 2: owner summary, backup, deploy, health (orchestrator and owner)

Resume signal: "deployed sha-0ebd0f6; backup pre-fase7-2026-11-27.dump (135735 bytes, 2026-11-27 11:27 server time, /var/lib/postgresql/data/ in the database volume database-storage-m365, taken by the owner via pg_dump -Fc in the Dokploy terminal because Dokploy has no backup job for this compose); scheduler healthy; queue healthy; migrations not visible (compose-readLogs unavailable); app healthy".

- D-02: the owner received the Spanish summary before the deploy.
- D-03: the backup was confirmed (non-zero size) before compose-deploy ran.
- Dokploy deployment title: "Phase 7 release: hardening + upstream merge (sha-0ebd0f6)". The Environment tab was not edited.
- Scheduler and queue are healthy with the image healthcheck script, so no fallback was needed and the compose did not change.

## Task 3: public checks and records (this executor)

Public checks from outside on 2026-11-27, all read-only:

| Check | Result |
| --- | --- |
| `GET /health-check/up` | 200 |
| Login page `microsoft":{"enabled":true` prop count | 1 |
| `GET /m365/meetings?start=...&end=...` (JSON, unauthenticated) | 401 |
| `DELETE /user/microsoft` (unauthenticated) | 302 (core's CSRF-mismatch answer; accepted) |
| `POST /m365/meetings/sync` (unauthenticated) | 302 (same; accepted) |
| Vite manifest, JS chunks | 155 chunks, 2,761,878 bytes in `bundle-07.js` |
| `Exit impersonation` in the bundle | 1 match (upstream frontend deployed) |
| Phase 6 markers (`outlook-sync-flag-marker`, `outlook-sync-flag-panel`, `outlook-out-of-sync`) | 3 of 3 |

Logs are in `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/`: `manifest-07.json`, `chunks-07.txt` and `bundle-07.js`.

Records:
- Runbook `## Historial`: row `2026-11-27 | Fase 7: endurecimiento y actualización de solidtime publicados (...)`. It records sha-0ebd0f6, merge d0f5e745, the backup name, size, time and volume, and the rollback (imagen sha-d379903 y restaurar esa copia, ver docs/m365/UPSTREAM-MERGE.md). `## Valores del registro` was not changed.
- `UPSTREAM-MERGE.md` merge history: the 2026-11-26 row's release image is `sha-0ebd0f6` (deployed 2026-11-27). A release note under the table records the backup file, healthy scheduler and queue (no fallback), the migration log that could not be read, and the rollback.

Gates: `validate-docs.mjs runbook` OK (30 checks), `validate-docs.mjs secrets` OK (2338 checks), `grep -c 'Fase 7: endurecimiento'` = 1, and `sha-` count in UPSTREAM-MERGE.md went from 2 to 5.

## Commits

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | `eaa9274d` | chore(07-06): pin release image sha-0ebd0f6 (orchestrator) |
| 2 | none | Dokploy deploy, outside git |
| 3 | `0f213af4` | docs(07-06): Phase 7 release recorded with backup and rollback |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Section 8 restore command used variables the database container does not have**
- **Found during:** Task 3
- **Issue:** `UPSTREAM-MERGE.md` section 8 told operators to run `pg_restore -U "$DB_USERNAME" -d "$DB_DATABASE" /tmp/<backup-file>.dump` inside the database container. The compose only gives the `database` service `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `PGPASSWORD`, so that command would fail during a rollback.
- **Fix:** The command now uses `"$POSTGRES_USER"` / `"$POSTGRES_DB"` and runs in the `database` service Terminal. It also notes that a dump in `/var/lib/postgresql/data/` is already in the volume and needs no copy.
- **Files modified:** docs/m365/UPSTREAM-MERGE.md
- **Commit:** 0f213af4

**2. [Rule 3 - Blocking] The bundle check passed the manifest as a command-line argument**
- **Found during:** Task 3, third automated check
- **Issue:** The production manifest is 135,607 bytes, so `node -e ... "$M"` failed with "Argument list too long" on Windows.
- **Fix:** The manifest is saved to `manifest-07.json` and `node` reads it from that file. The logic and pass criteria did not change.

**3. Other notes**
- The runbook row credits "propietaria / orquestación" instead of the plan's "orquestación" because the owner took the backup.
- The worktree branch started behind BASE `eaa9274d`. The tree was clean and HEAD was an ancestor of BASE, so `git merge --ff-only` was used instead of `git reset --hard`. The result is the same.
- Prettier flags both Markdown files, but it did so before this change too, and `npm run format:check` does not cover `*.md`. Not changed.

## Known Stubs

None.

## Open Items (owner checks at the end of the phase)

- Sign in with Microsoft, open the calendar and press Sync. Outlook meetings should appear and Sync should finish without errors.
- Drag a time entry to another hour. It should land exactly where it was dropped (upstream drag-offset fix).
- As admin, impersonate a member from `/admin`. The calendar and profile should show no Outlook lane, Sync, Connect or Microsoft 365 card. "Exit impersonation" should return to the admin (D-07).
- Sign in to the browser extension or desktop app through "Sign in with Microsoft". The extension's authorization screen should follow and the extension should connect.
- Open the profile of a Microsoft-only user. The "managed by your identity provider" card should replace the password and 2FA sections, and the Microsoft 365 card should still be there.
- Not confirmed: the three upstream migrations in the app log (log not readable from Dokploy), and `php artisan schedule:list` / `m365:check-out-of-sync --dry-run` inside the container (the pending Phase 6 todo is still open).

## Self-Check: PASSED

- FOUND: docs/deploy/dokploy-compose.fork.yml (3 lines with `sha-0ebd0f6`, 1 Phase 7 header line)
- FOUND: docs/m365/RUNBOOK-entra-app.md (`Fase 7: endurecimiento` = 1, names sha-d379903)
- FOUND: docs/m365/UPSTREAM-MERGE.md (`sha-0ebd0f6` in the merge history)
- FOUND: eaa9274d, 0f213af4 (ancestors of HEAD)
