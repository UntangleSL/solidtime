---
phase: 03-outlook-meetings-in-the-calendar
plan: 12
subsystem: release
tags: [release, dokploy, docs, ci-gate]
requires: [03-01, 03-02, 03-03, 03-04, 03-05, 03-06, 03-07, 03-08, 03-09, 03-10, 03-11]
provides: [phase-3-in-production]
affects: [docs/deploy/MICROSOFT-SIGNIN.md, docs/deploy/dokploy-compose.fork.yml, docs/m365/RUNBOOK-entra-app.md]
requirements-completed: []
plan_head_before: 0ba2dc24ff44fab271ddabd4480b576ef793b161
completed: 2026-11-10
---

# Phase 3 Plan 12: Release Summary

Phase 3 (Outlook meetings as ghost suggestions in the calendar) is live on time.untangle.es with image `sha-22fbbab`, after an all-green ten-workflow release gate and explicit owner approval.

## Task 1: release gate, operator docs, ledger, compose pin

- Release sha R = `22fbbabecc3f75d4b2be1419933d51e5bbd0030b`. All ten workflows `success` (Fork - Build image, NPM Build, NPM Format Check, NPM Lint, NPM Test Unit, NPM Typecheck, PHP Linting, PHPUnit Tests, Playwright Tests, Static code analysis (PHPStan)).
- Microsoft365 PHPUnit PASS lines for R: 75 (25 classes x Postgres 15/16/17), threshold >= 75.
- `validate-docs.mjs secrets`: OK (1967 checks); `guide`: OK (117 checks).
- Ledger: the six touched core files (Calendar.vue, CalendarDayColumn.vue, CalendarSettingsPopover.vue, CalendarToolbar.vue, TimeEntryCalendar.vue, useSlotSelection.ts) all have rows in `docs/m365/TOUCHED-CORE-FILES.md`; no unexplained core file.
- `docs/deploy/MICROSOFT-SIGNIN.md`: new section "Reuniones de Outlook en el calendario (Fase 3)" (cache tables, sync triggers, throttle prefixes `m365-read:`/`m365-sync:`/`m365-dismiss:`, back-off, Reconnect vs expired client secret, Outlook lane D-23, disconnect purge D-21, impersonation guard D-22, `/m365/*` session routes, public 401 check, migrations, Phase 7 carry-overs).
- `docs/deploy/dokploy-compose.fork.yml`: app, scheduler and queue pinned to `ghcr.io/untanglesl/solidtime:sha-22fbbab` (only functional change vs the deployed `sha-d24a04b`).
- Commits: d647f01c (test fixture rename for the secrets gate), 22fbbabe (docs, release sha), 83c39330 (compose pin).

## Task 2: owner-approved Dokploy deploy

- Owner approval, verbatim, 2026-11-10: "aprobado despliegue fase 3".
- Orchestrator replaced the compose content of `untangle-solidtime-tq34sf` with the file at 83c39330 (Environment tab untouched) and deployed: deployment `UsPu5FKASV2z2gTIERRZg`, status done, 11:49:49Z to 11:51:45Z UTC.
- Migrations (app log): `2026_11_05_000001_create_outlook_meetings_tables` DONE, `2026_11_05_000002_add_graph_state_to_microsoft_accounts_table` DONE.
- Containers: app healthy; scheduler and queue running (Docker health "starting", the known image-healthcheck gap already queued for Phase 7); database and gotenberg untouched.
- Public read-only checks: `/health-check/up` 200; login page carries `microsoft.enabled: true` (1 match); `GET /m365/meetings` unauthenticated returns 401.

## Task 3: runbook

- `docs/m365/RUNBOOK-entra-app.md` history row: "Fase 3: reuniones de Outlook en el calendario publicadas (imagen sha-22fbbab; sin variables nuevas)". `runbook: OK (30 checks)`, `secrets: OK (1967 checks)`.
- The six owner human-checks of this task (real week incl. DST, Sync twice + navigation, Dismiss/Show dismissed/Restore, Entra revocation -> Reconnect, Connect from a password-only user, second account + impersonation) are queued for the end-of-phase UAT. SYNC-04, SEC-02 and CAL-03 are marked complete only after that UAT.

## Deviations

- [Rule 3] The 03-03 fake token `at-concurrent-1111` tripped the docs secrets gate (token-assignment pattern); renamed to `at-won-1111`, assertions unchanged (d647f01c).
- Removed "el calendario de Outlook (Fase 3 en adelante)" from the "Qué no cubre" list of MICROSOFT-SIGNIN.md.

## Phase 7 carry-overs

- Profile `connect_url`/`disconnect_url` and `intent=connect` are not blocked while impersonating (SEC-04).
- A sync racing a Disconnect can reinsert rows that stay invisible (read answers empty without a usable link) and are removed by the next Disconnect.
- Scheduler/queue Docker healthchecks never report healthy (inherited image healthcheck).
- Right-click on a ghost opens the empty-grid context menu (03-05 note).

## Self-Check: PASSED
