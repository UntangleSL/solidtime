---
phase: 07-hardening-release
plan: 05
subsystem: release-docs
tags: [ops-03, ops-02, sec-03, sec-04, ledger, compose, healthcheck, d-02]
requires: [07-02, 07-03, 07-04]
provides:
  - "docs/m365/TOUCHED-CORE-FILES.md: Phase 7 rows for e2e/outlook-off-switch.spec.ts, fork changes, hot files, Reconciliation (07-05)"
  - "docs/deploy/MICROSOFT-SIGNIN.md: impersonation, off switch, deletion, container health as shipped; no Phase 7 pending block"
  - "docs/deploy/dokploy-compose.fork.yml: scheduler and queue healthcheck [CMD, healthcheck]"
  - "Owner summary (D-02) and release commit list in the CI log dir"
affects: [07-06]
requirements-completed: [OPS-03]
key-files:
  created: []
  modified:
    - docs/m365/TOUCHED-CORE-FILES.md
    - docs/deploy/MICROSOFT-SIGNIN.md
    - docs/deploy/dokploy-compose.fork.yml
decisions:
  - "The healthcheck fallback chain (CMD-SHELL supervisorctl ... | grep -q RUNNING, then disable: true) lives in the operator doc section, because docs/m365/UPSTREAM-MERGE.md has no such fallback and the compose header belongs to 07-06's release line"
  - "User deletion is described as admin panel or the person's own profile (only with a password); organization deletion as the app or the admin console command (OrganizationDeleteCommand); there is no console command that deletes a user"
status: complete
completed: 2026-11-27
metrics:
  duration: "about 35 min"
  completed: 2026-11-27
estimate:
  tokens: 55000
  tasks: 3
actuals:
  tokens: 6000
  tasks: 3
  commits: 3
plan_head_before: 43083f353ce5d909b0d924c05f9e56fb48995e7e
plan_head_after: fc3a66be
---

# Phase 7 Plan 05: Release docs, ledger reconciliation and container health Summary

The ledger now matches the Phase 7 tree (`ledger-check: OK (modified 40, added 580, conflicts 0)`). The operator doc describes the impersonation, off-switch, deletion and container-health behaviour that ships, with nothing left marked pending. The scheduler and queue services in the fork compose run the image's own mode-aware `healthcheck` script. The owner's Spanish summary and the commit list since `sha-d379903` are ready for 07-06.

## What was built

- **Ledger** (`docs/m365/TOUCHED-CORE-FILES.md`, Phase 7 section):
  - `### New files inside core directories` with `e2e/outlook-off-switch.spec.ts` (07-04).
  - `### Fork changes (no core file)`: the 07-02 middleware, route, controller and prop changes, the 07-03 `purgeIfDisconnected` in `OutlookMeetingSyncService`, and the four new test classes.
  - `### Hot files deliberately not touched`: `DeletionService`, `MemberService`, `Kernel`, `routes/web.php`, `openapi.json`, `docker/prod/Dockerfile`, `docker/prod/deployment/healthcheck`.
  - `### Reconciliation (07-05)`: the exact diff command and its single result, plus the ledger-check output before (`NOT COVERED: e2e/outlook-off-switch.spec.ts`) and after (OK).
- **Operator doc** (`docs/deploy/MICROSOFT-SIGNIN.md`, Spanish):
  - The impersonation bullet now says Connect, Reconnect and Disconnect answer 404 and the card is hidden.
  - New bullet: a disconnect during a sync leaves nothing behind.
  - The "Pendiente para la Fase 7 (SEC-04)" block is removed. Both of its items are resolved: 07-02 for the first, `7467352b` for the second.
  - New `## Borrar personas u organizaciones` and `## Contenedores scheduler y queue` (with the fallback chain).
  - `## Apagar la integración` is rewritten to the full off-switch behaviour (`schedule:list`, nothing deleted, everything back after refilling).
  - New passwordless bullet: the profile is managed by the identity provider after the November 2026 update.
  - `## Alcance` now links `docs/m365/UPSTREAM-MERGE.md`.
- **Compose** (`docs/deploy/dokploy-compose.fork.yml`): `scheduler` and `queue` gain `healthcheck: test [CMD, healthcheck]`, interval 30s, timeout 10s, retries 3, start_period 40s, with a one-line comment. The app, database and gotenberg services are unchanged, and so are the image pins (still 4 × `sha-d379903`; 07-06 moves them).
- **Release logs (outside git)**, in `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/`:
  - `ledger-check-07-05.txt`: the pre-fix finding.
  - `release-07-commits.txt`: 82 commits. 14 are fork Phase 7 (07-NN), including these three. 67 are upstream (`b46f0157..d0f5e745`, merged by `adcd05cb`). 1 is other: `7889b458 chore(deploy): pin image sha-d379903`, which touches only the compose, not fork or core code.
  - `d02-resumen-07.md`: the owner summary.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | abe1ea1c | docs(07-05): ledger reconciled with the Phase 7 tree |
| 2 | 4e0c9717 | docs(07-05): operator doc for impersonation, off switch, deletion and container health |
| 3 | fc3a66be | chore(07-05): scheduler and queue run the image healthcheck |

## Gates

- `sh tests/Tools/m365-merge/ledger-check.sh`: `ledger-check: OK (modified 40, added 580, conflicts 0)`. Before Task 1 it failed with `NOT COVERED: e2e/outlook-off-switch.spec.ts`.
- `ForkIsolationTest` (DB-free, worktree-first bootstrap): `OK (2 tests, 165 assertions)`. Every ledger path exists.
- `node tests/Tools/m365-spike/validate-docs.mjs secrets`: `secrets: OK (2337 checks)` after each task.
- Compose YAML check: `compose-ok`. Scheduler and queue have `["CMD","healthcheck"]`, and the app healthcheck is unchanged.
- Task 2 greps:
  - "Pendiente para la Fase 7": 0
  - "se hace en la Fase 7": 0
  - each new section: 1
  - `UPSTREAM-MERGE.md`: 1
  - `404`: 4
  - `schedule:list`: 1
- Task 3 checks:
  - commit list is non-empty
  - owner summary is 18 lines (at most 20)
  - migration and rollback grep: 4
  - no `(07-05)` commit touches `docker/` (the diff of this plan is exactly the three docs files)
- PENDING CI (orchestrator): Gate W and Gate B on the pushed head. This plan changes no code.
- PENDING post-deploy (07-06): the scheduler and queue `healthy` status in Dokploy (RESEARCH A1, not runnable locally).

## Deviations from Plan

- **[Rule 3 - Blocking] Healthcheck fallback location.** The plan's doc text points to "the fallback in docs/m365/UPSTREAM-MERGE.md or the Phase 7 notes in the compose header". Neither exists: UPSTREAM-MERGE.md has no healthcheck fallback, and the compose header is 07-06's release line. The fallback chain from RESEARCH Pattern 5 is therefore written directly in `## Contenedores scheduler y queue`. No file outside files_modified was touched.
- **[Rule 1 - Accuracy] Who can delete a person.** The plan said a person is deleted from the "admin panel or console". No console command deletes a user. The doc says admin panel, or the person from their own profile when they have a password, and it names the admin console command only for organizations.

## Resumen para la propietaria (D-02)

**Qué trae solidtime**
- Arrastrar una entrada en el calendario ya no la deja en una hora equivocada (seguramente el fallo que viste al arrastrar).
- Los días se agrupan bien en los cambios de hora de verano e invierno.
- Las horas de proyectos y tareas se recalculan cuando una administradora corrige entradas, y el cliente de una entrada siempre es el de su proyecto.
- Crear o cambiar informes pide el permiso de ver todo. En el menú de usuario aparece «salir de la suplantación».
- Quien entra solo con Microsoft ve en su perfil que la contraseña y el doble factor se gestionan en Microsoft.
- Los correos se comparan sin distinguir mayúsculas.

**Migraciones** (se aplican solas al desplegar)
- `2026_11_03_000001_sync_client_id_of_time_entries_with_project`: quita el cliente de las entradas que no tienen proyecto.
- `2026_11_05_000001_delete_orphaned_oauth_refresh_tokens`: borra datos de acceso antiguos que ya no están ligados a nada.
- `2026_11_18_000001_lowercase_organization_invitation_emails`: pasa a minúsculas los correos de las invitaciones y quita las repetidas.

**Variables nuevas:** ninguna obligatoria. No hay que añadir nada a las variables de Dokploy.

**Lo nuestro en esta versión:** suplantando a alguien no se puede conectar ni desconectar su Microsoft; desconectar mientras se sincroniza no deja nada guardado; los contenedores scheduler y queue salen sanos en Dokploy.

**Antes de desplegar:** copia de seguridad de la base de datos. Si algo va mal, se vuelve a la imagen anterior `sha-d379903` con esa copia.

Every item was checked against the git history:
- the drag fix is `0ca240ac` (`useEventDrag.ts`)
- the daylight-saving grouping is `dc119996`
- the spent-time recalculation is `7a570dc5`
- the client follows the project in `0e1ed2e1`
- the report permission is `e3b031b4`
- exit impersonation is `7912b0a2`
- the passwordless profile is `f845c900`
- the email case change is `34ab2aed`
- the migrations come from `0e1ed2e1`, `6debd4cb` and `34ab2aed`
- the optional `HEARTBEAT_SCHEDULER_URL` / `HEARTBEAT_QUEUE_URL` (`9b742372`) are not required

## Self-Check: PASSED

- FOUND: docs/m365/TOUCHED-CORE-FILES.md, docs/deploy/MICROSOFT-SIGNIN.md, docs/deploy/dokploy-compose.fork.yml
- FOUND commits: abe1ea1c, 4e0c9717, fc3a66be (ancestors of HEAD)
- FOUND logs: ledger-check-07-05.txt, release-07-commits.txt, d02-resumen-07.md
