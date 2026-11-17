---
phase: 05-smart-meeting-suggestions
plan: 15
subsystem: release
status: complete
tags: [m365, release, runbook, production-checks, uat]
requires: [05-14]
provides:
  - "Public read-only checks of the deployed Phase 5 (image sha-0f2d424) on https://time.untangle.es: all passed"
  - "docs/m365/RUNBOOK-entra-app.md: '## Historial' row for the Phase 5 release (2026-11-17, sha-0f2d424, no new variables, three migrations)"
  - "Owner UAT for RULE-01..05 queued as end-of-phase human checks (listed below)"
affects: []
requirements-completed: []
key-files:
  created: []
  modified:
    - docs/m365/RUNBOOK-entra-app.md
key-decisions:
  - "Deploy reported by the orchestrator under D-15 (no owner approval needed): compose at 95a134a4, image sha-0f2d424, migrations 2026_11_18_000001..000003 DONE"
  - "Unauthenticated POST/DELETE to the series and convert routes answer 302 (core Handler turns the 419 CSRF mismatch into back()); accepted as deployed and protected per the 04-09 precedent"
  - "RULE-01..05 stay pending in REQUIREMENTS until the owner UAT passes (orchestrator owns STATE/ROADMAP/REQUIREMENTS)"
completed: 2026-11-17
duration: 15min
plan_head_before: d269f07c
plan_head_after: 4f724a08
estimate:
  tokens: 25000
  tasks: 2
actuals:
  tokens: 1500
  tasks: 2
  commits: 1
---

# Phase 5 Plan 15: Phase 5 production checks and runbook record Summary

Phase 5 (smart meeting suggestions, image `sha-0f2d424`) is live on https://time.untangle.es. All
public read-only checks passed, the release is recorded in the runbook history, and the owner's UAT
for RULE-01..05 is queued for the end-of-phase review.

## Task 1: Public checks (2026-11-17, after the orchestrator's deploy)

| Check | Result |
| --- | --- |
| `GET /health-check/up` | 200 |
| Login page `microsoft.enabled:true` prop | count 1 |
| `GET /m365/meetings?start=…&end=…` unauthenticated, JSON | 401 |
| `POST /m365/meetings/<uuid>/series/ignore` unauthenticated | 302 (CSRF back(); route exists, was 404 before the deploy) |
| `DELETE /m365/meetings/<uuid>/series/ignore` unauthenticated | 302 |
| `DELETE /m365/meetings/<uuid>/series/assignment` unauthenticated | 302 |
| `POST /m365/organizations/<uuid>/meetings/time-entries` unauthenticated | 302 |
| Calendar bundle (55 chunks from the Vite manifest, 1.4 MB) | `outlook-confirm-all` (5), `outlook-suggestion-reason` (1), `outlook-preassigned-line` (1); also `outlook-suggestion-picks`, `outlook-project-dot` |

No 200/204/404/422 on any protected route. Logs kept outside git in
`C:/Users/JuanHerrero/.local/solidtime-php-toolchain/ci-logs/` (`manifest-05.json`,
`calendar-chunks-05.txt`, `calendar-bundle-05.js`).

## Task 2: Runbook history

Row added to `## Historial` in `docs/m365/RUNBOOK-entra-app.md`:
`| 2026-11-17 | Fase 5: sugerencias inteligentes de reuniones publicada (imagen sha-0f2d424; sin variables nuevas; migraciones de columnas en outlook_meeting_links y outlook_meetings y tabla outlook_series_settings; $select de Graph con attendees) | orquestación |`

Gates: `runbook: OK (30 checks)`, `secrets: OK (2206 checks)`. `## Valores del registro` untouched.

## Commits

- `4f724a08` docs(05-15): record the Phase 5 release in the runbook history

## Owner UAT pending (end-of-phase human checks)

1. **RULE-01:** convert one occurrence of a real recurring series from the form; the other occurrences this week and next show the project line, hover card and panel say "Pre-assigned · Same series" with project/task/tags/billable, the why line names the date, nothing became a time entry by itself.
2. **RULE-02:** confirm one pre-assigned meeting from the hover card, one from the right-click menu, then "Confirm N pre-assigned" in the toolbar for the rest of the week unticking one; each confirmed meeting becomes an entry with the series' values and the Outlook icon, the unticked one stays, a hidden weekend meeting is not listed.
3. **RULE-03:** form on a non-recurring meeting with a known client (same people or domain) opens on the client's project with a reason like "Like 4 meetings with @client.com" plus up to two other suggestions; a meeting with nobody known keeps "Last used" or nothing; judge whether suggestions make sense (tune weights if not).
4. **RULE-04 / RULE-05:** "Always ignore this series", Show dismissed meetings, "Stop ignoring this series"; "Forget this series" on a pre-assigned one; convert an occurrence to another project. Ignore hides all occurrences and the faded view brings them back; forget removes the project lines and says entries are unchanged; the later conversion makes the series follow the new project; no existing time entry changes at any point.
5. **Series split:** edit a real series with "this and following" in Outlook, sync; new occurrences start without pre-assignment but the form suggests the old project; after one conversion they come pre-assigned.
6. **Layout:** 1366x768 and 1024px, English and Spanish, light and dark: toolbar with "Confirm N" and Sync, panel footer of a pre-assigned meeting, hover card buttons, teal project dot on the Untangle teal meeting tint; no overflow or wrapping, the dot stays visible on every fill.

## D-16 hit-rate query (for the PROD-05 decision)

Run read-only against production after some weeks of use:

```sql
SELECT prefill_source,
       count(*) AS prefilled,
       count(*) FILTER (WHERE prefill_kept) AS kept,
       round(100.0 * count(*) FILTER (WHERE prefill_kept) / nullif(count(*), 0), 1) AS hit_rate_pct
FROM outlook_meeting_links
WHERE prefill_source IN ('series', 'suggestion')
GROUP BY prefill_source;
```

## Deviations from Plan

**1. [Rule 3 - Blocking] Bundle check passed the manifest through a file**
- **Found during:** Task 1
- **Issue:** the plan's verify passed the 137 KB Vite manifest as a `node -e` argument; Git Bash on Windows failed with "Argument list too long".
- **Fix:** saved the manifest to `ci-logs/manifest-05.json` and read it with `fs.readFileSync`; same chunk walk and grep.
- **Files modified:** none in the repo.

Otherwise the plan executed as written. No Dokploy access, no production data touched.

## Self-Check: PASSED

- FOUND: docs/m365/RUNBOOK-entra-app.md row "Fase 5: sugerencias inteligentes de reuniones publicada" (count 1)
- FOUND: commit 4f724a08 on feature/m365-integration
