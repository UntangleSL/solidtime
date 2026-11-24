---
phase: 06-out-of-sync-detection
plan: 19
subsystem: release
status: complete
tags: [m365, release, runbook, production-checks, uat]
requires: [06-18]
provides:
  - "Public read-only checks of the deployed Phase 6 (image sha-8ec9a5a) on https://time.untangle.es: all five passed"
  - "docs/m365/RUNBOOK-entra-app.md: '## Historial' row for the Phase 6 release (2026-11-24, sha-8ec9a5a)"
  - ".planning/STATE.md: 'Phase 6 deployed (sha-8ec9a5a, 2026-11-24); Phase 6 owner UAT pending'"
  - "Owner UAT for OSYNC-01..03 queued as end-of-phase human checks (listed below)"
affects: []
requirements-completed: []
key-files:
  created: []
  modified:
    - docs/m365/RUNBOOK-entra-app.md
    - .planning/STATE.md
key-decisions:
  - "Deploy reported by the orchestrator under D-15: Dokploy compose updated to sha-8ec9a5a (commit d2213fcf) and deployed; app, scheduler and queue recreated; app healthy (scheduler/queue healthchecks unhealthy: known Phase 7 carry-over)"
  - "schedule:list and m365:check-out-of-sync --dry-run could NOT be run in the containers (Dokploy log tool HTTP 500, no exec tool): recorded as unverified in the runbook row and in STATE Pending Todos, not claimed"
  - "Migration 2026_11_23_000001 was already applied with sha-6d8a5cc (06-18 finding); the runbook row says so"
  - "OSYNC-01..03 stay pending until the owner UAT passes"
completed: 2026-11-24
duration: 10min
plan_head_before: 8a36083f3a94060b5f8ca2f562f7eccc6c0d4bdf
plan_head_after: 9bfa4ae9
estimate:
  tokens: 30000
  tasks: 2
actuals:
  tokens: 1800
  tasks: 2
  commits: 2
---

# Phase 6 Plan 19: Phase 6 production checks, runbook and STATE record Summary

Phase 6 (out-of-sync detection, image `sha-8ec9a5a`) is live on https://time.untangle.es. All five
public read-only checks passed; the release is in the runbook history and STATE.md; the owner's UAT
for OSYNC-01..03 is queued. The in-container checks (schedule entry, dry run) remain unverified.

## Public checks (Task 1, 2026-11-24)

| Check | Result |
| --- | --- |
| `/health-check/up` | 200 |
| Login page `microsoft: {enabled: true}` prop | count 1 |
| Unauthenticated JSON `GET /m365/meetings` | 401 |
| `POST /m365/out-of-sync/{uuid}/keep` | 302 to `/` (CSRF 419 turned into back(); 05-15 precedent) |
| `POST /m365/out-of-sync/{uuid}/adjust` | 302 to `/` |
| `POST /m365/organizations/{uuid}/meetings/{uuid}/move-entry` | 302 to `/` |
| Control: `POST /m365/out-of-sync/{uuid}/nonexistent-zz` | 404 (so the 302s prove the routes exist) |
| Calendar bundle markers (55 chunks walked from `resources/js/Pages/Calendar.vue`) | 3: `outlook-out-of-sync`, `outlook-sync-flag-marker`, `outlook-sync-flag-panel` |

Logs kept in the PHP toolchain `ci-logs/` (`manifest-06.json`, `calendar-chunks-06.txt`,
`calendar-bundle-06.js`).

## Not verified (pending owner or a later check)

- `php artisan schedule:list` in the scheduler container lists `m365:check-out-of-sync` (05:30 Europe/Madrid).
- `php artisan m365:check-out-of-sync --dry-run` prints counts.
- The first real 05:30 run (2026-11-25) has not been observed.

Reason: the Dokploy log tool returned HTTP 500 and there is no container exec tool. Also listed in
STATE.md "Pending Todos".

## Runbook row

`| 2026-11-24 | Fase 6: detección de desincronización publicada (imagen sha-8ec9a5a; sin variables nuevas en el entorno de Dokploy; las variables SOLIDTIME_MICROSOFT_* pasan también a scheduler y queue; migración de columnas de estado en outlook_meeting_links con índice único de vínculos activos, ya aplicada con sha-6d8a5cc; comprobación diaria m365:check-out-of-sync a las 05:30 Europe/Madrid; schedule:list y la ejecución en seco aún sin comprobar dentro del contenedor) | orquestación |`

Gates: `runbook: OK (30 checks)`, `secrets: OK (2294 checks)`. `## Valores del registro` untouched.

## Commits

- `cc783a45` docs(06-19): record the Phase 6 release in the runbook history
- `9bfa4ae9` docs(state): Phase 6 deployed (sha-8ec9a5a), owner UAT pending

## Owner UAT pending (end-of-phase human checks)

1. **OSYNC-02 auto adjust:** convert a real meeting of next week, then move it in Outlook by one hour; open its week (or wait for the 05:30 check). Expected: the entry follows without a warning; the Outlook icon tooltip says "Updated from Outlook: old → new"; after a manual Sync the calendar announces "1 time entry updated from Outlook".
2. **OSYNC-02/03 flags:** edit the time of a converted future entry, then move its meeting in Outlook; cancel another converted future meeting; delete or decline a third. Expected: each entry shows the amber marker, toolbar says "3 out of sync"; the moved one's review shows Before / Now / Your entry with Keep as is / Adjust to Outlook; the cancelled and removed ones offer Keep as is / Delete entry with the confirmation; nothing deleted automatically.
3. **OSYNC-01 started meeting:** log a meeting that already happened, then drag it in Outlook to a later day this week. Expected: old entry unchanged and unflagged; the meeting reappears as a suggestion at its new slot with "Moved in Outlook · Already logged"; "Move my entry here" moves the entry, "Create time entry" makes a second one.
4. **Counter and jump:** with a flagged entry two weeks ahead, click "N out of sync"; open the entry's right-click menu. Expected: the calendar moves to that week without reload, the entry is focused and its review opens; the menu starts with "Review Outlook change".
5. **Subject-only change and 60-day window:** rename a converted meeting in Outlook; cancel a converted meeting older than 60 days. Expected: no marker, no counter change, no entry change (D-06, D-10).
6. **Layout:** 1366x768 and 1024px, English and Spanish, light and dark: entry block with origin icon + marker in a narrow week column, toolbar with status + counter + Confirm + Sync, review popover footer and its Spanish delete confirmation. Expected: no overflow or wrapping; the marker reads on any project colour.

## Deviations from Plan

**1. [Rule 3 - Blocking] Bundle check read the manifest from a file**
- **Found during:** Task 1
- **Issue:** passing the Vite manifest as a `node -e` argument failed with "Argument list too long" in Git Bash (same as 05-15).
- **Fix:** saved it to `ci-logs/manifest-06.json` and read it with `fs.readFileSync`; same chunk walk and grep.
- **Files modified:** none in the repo.

**2. [Precondition, orchestrator-directed] In-container checks not available**
- The precondition asks for `schedule:list` and a dry run; the orchestrator could not run them (Dokploy log tool HTTP 500, no exec tool) and directed recording them as pending. Recorded in the runbook row, STATE Pending Todos and above; not claimed.

**3. [Rule 1 - Bug] STATE `progress.total_plans` raised with `completed_plans`**
- `completed_plans` went 72 → 91 as planned; `total_plans` (72) did not yet count Phase 6's 19 plans, so it was raised to 91 too, keeping completed ≤ total.

**4. STATE "Pending Todos"** gained two Phase 6 lines (owner UAT; unverified in-container checks) so the open items survive outside this SUMMARY.

Note: `prettier --check` flags `docs/m365/RUNBOOK-entra-app.md`, but the file was already not Prettier-clean at HEAD before this plan (pre-existing, out of scope).

No Dokploy access, no production data touched, no package installs.

## Self-Check: PASSED

- FOUND: runbook row "Fase 6: detección de desincronización publicada" (count 1)
- FOUND: "Phase 6 deployed" in STATE.md (count 2)
- FOUND: commits cc783a45 and 9bfa4ae9 on feature/m365-integration
