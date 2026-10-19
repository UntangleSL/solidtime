---
phase: 01-tenant-setup-outlook-spike
plan: 08
subsystem: docs
tags: [microsoft-graph, calendarview, decisions, entra, runbook, fixtures, sync-03]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-04 decisions gate, 01-07 Round A/B fixtures and manifest"
provides:
  - "docs/m365/DECISIONS-graph.md: fixture-backed occurrence key, series key and cancelled/declined/moved/private/all-day representation, machine-traced to the manifest"
  - "Production $select and Prefer/paging rules for Phase 3, corrections of the earlier research (STACK.md, PITFALLS.md point to them)"
  - "Eligibility rule aligned with the owner's revised SYNC-03 (all timed meetings are suggestions)"
  - "Runbook, validation map and ROADMAP updated; raw/ deleted after the raw-backed gate"
affects: [phase-2, phase-3, phase-5, phase-6, phase-7]

actuals:
  tokens: 60000
  tasks: 3
  commits: 5
plan_head_before: 08ac248b25906cf55aa43c5365de09e515082621
plan_head_after: ddc8ec48b70c60d6fe8851c93ee7feb4dd45d5b8

key-files:
  created:
    - docs/m365/DECISIONS-graph.md
  modified:
    - .planning/research/STACK.md
    - .planning/research/PITFALLS.md
    - docs/m365/RUNBOOK-entra-app.md
    - .planning/phases/01-tenant-setup-outlook-spike/01-VALIDATION.md
    - .planning/ROADMAP.md
    - .planning/WINDOWS.md
    - tests/Tools/m365-spike/test/validate-docs.test.mjs
    - tests/Tools/m365-spike/test/capture.e2e.test.mjs
    - tests/Tools/m365-spike/test/oauth.test.mjs
    - tests/Tools/m365-spike/validate-docs.mjs

key-decisions:
  - "Occurrence key: immutable Graph id (Prefer IdType=ImmutableId), varchar(255); fallback (series_master_id, original_start)"
  - "Series key: seriesMasterId; orphaned rules are kept visible, never deleted or re-applied"
  - "Cancelled: isCancelled=true (S3: unprocessed cancellation stays in the calendarView); declined: Graph removes the event (S4, lookup 404); moved: id kept, response resets to notResponded (S5), a move out of the window is absent but lookup 200 (S5b), so confirm any missing id with GET /me/events/{id}"
  - "SYNC-03 revised by the owner (commit 6ecb6da0): every timed meeting is a suggestion whatever the responseStatus; exclusions are declined, cancelled, all-day and non-normal sensitivity"
  - "Entra cleanup (spike redirect URI and secret) deferred by the owner until production; recorded as APLAZADO and added to ROADMAP Phase 7"

requirements-completed: [SETUP-03]

duration: 2 sessions (checkpoint resume)
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 08: Decision document and spike close-out Summary

**DECISIONS-graph.md fixes the occurrence key (immutable id), the series key (`seriesMasterId`) and how cancelled, declined, moved, private and all-day meetings look in Graph, every claim traced to the fixture manifest; the raw-backed fixture gate passed and `raw/` is deleted, but the Entra cleanup was deferred by the owner to Phase 7.**

## Decisions for Phase 2-6 planners (one line each)

- **Occurrence key:** immutable `id` with `Prefer: IdType="ImmutableId"` (68-84 chars, store as `varchar(255)`, `rawurlencode` in paths); survived the S2 edit and the S5 move. Fallback `(series_master_id, original_start)`.
- **Series key:** `seriesMasterId` (same on every occurrence and the exception, equals the master's `id`); E2 ("this and following") was not captured, so Phase 5 must re-check it.
- **Cancelled:** `isCancelled=true` stays in the window while unprocessed (S3, lookup 200); never read the `Canceled:` subject prefix.
- **Declined:** the event disappears and the lookup is 404 (S4); a declined meeting is indistinguishable from a deleted one.
- **Moved:** same id, `responseStatus` resets to `notResponded` (S5); a move out of the window is absent but lookup 200 (S5b), so Phase 6 confirms every missing id with `GET /me/events/{id}` before flagging.
- **Private / all-day:** import only `sensitivity=normal` (fail closed for `personal`); exclude on `isAllDay=true`, never on midnight times.
- **Eligibility (SYNC-03 revised 2026-10-19):** all timed meetings regardless of response status; the response is no longer a filter.
- **Paging/headers:** `Authorization` and the combined `Prefer` on every request including every `@odata.nextLink` (a page without `Prefer` returns default-format ids); `$top=100`.
- **Production `$select`:** `id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting` (no `lastModifiedDateTime`, no `attendees`).
- **Phase 2 entry checks:** the production secret has only passed the admin's Valor check; Phase 2 must prove it acquires a token at its first Microsoft sign-in on Dokploy (ROADMAP Phase 2 criterion 1) and date the runbook `- Secreto de producción:` line, treating AADSTS7000215 as "create a new production secret".

## Task results

| Task | Result | Commit |
|------|--------|--------|
| 1. Decision document and research corrections | Done earlier; `decisions --trace` OK | 3b5c0f1c |
| 1b. Eligibility decision aligned with revised SYNC-03 (Eligibility signals, Declined, Moved, Cancelled wording; S5 claims added) | `decisions: OK (205 checks)` | 23663805 |
| 2. Admin removes spike URI and secret | Checkpoint resolved with an owner-modified outcome: DEFERRED (see below) | n/a |
| 3. Close the spike | raw-backed gate OK, raw/ deleted, runbook, validation map, full gate | cd242ead, ddc8ec48 |

## Checkpoint outcome (owner answers, 2026-10-19)

1. **Entra cleanup deferred until production is live.** The redirect URI `http://localhost/m365-spike/callback` and the secret `spike-2026-10` stay registered in Entra (the secret expires 2027-04-19 on its own). Runbook `## Limpieza tras el spike` marks both as "APLAZADO hasta producción (decisión de la propietaria 2026-10-19), pendiente en Fase 7"; the guide lines stay TEMPORAL and are not marked RETIRADO; the runbook Redirect URIs and `Caducidad del secreto spike` rows say APLAZADO. Tracked as ROADMAP Phase 7 success criterion 5. No validator needed adapting: the `guide` gate already accepts TEMPORAL and `runbook --final` does not forbid the spike URI. A regression test now proves `runbook --final` accepts that state.
2. **Doppler:** the orchestrator deleted the seven `SOLIDTIME_M365_SPIKE_*` keys from `vps/dev` on 2026-10-19 (`dev` keeps only `SOLIDTIME_MICROSOFT_CLIENT_ID` and `SOLIDTIME_MICROSOFT_TENANT_ID`; `prd` unchanged). Consequence: the spike secret value no longer exists anywhere usable; any future capture needs a new spike secret (guide Parte 4 b), the temporary URI (still registered), and a new salt.
3. **PHPUnit `CalendarViewFixturesTest`: no disponible** (no PHP or Docker on the host). Pending in CI (`phpunit.yml`) or Sail. Evidence instead: the Node replay of every complete page sequence from the manifest page lists.
4. **raw/ deleted** with the owner's approval, after the full raw-backed gate passed twice. `.env.local` never existed (Doppler was used). Fixtures can no longer be re-sanitized; a new capture would use a new salt and every Round A/B id would change.

## Verification evidence

| Gate | Result |
|------|--------|
| `validate-fixtures.mjs --raw tests/Tools/m365-spike/raw` (before deleting raw/) | `validate-fixtures: OK (1542 checks)`; replay per pass: round A 22 requests and 14 events, round B 21 requests and 12 events (5 passes each) |
| `node --test "tests/Tools/m365-spike/test/*.test.mjs"` | 209 tests, 209 pass |
| `validate-docs.mjs guide` / `runbook --final` / `secrets` / `gitignore` / `decisions --trace` | OK (117 / 49 / 1813 / 6 / 205 checks) |
| `validate-fixtures.mjs` (no raw) | `validate-fixtures: OK (1542 checks)` |
| `npx --no-install prettier --check "tests/Tools/m365-spike/**/*.mjs"` | all matched files use Prettier code style (after `npm ci --ignore-scripts`, 576 packages, no scripts run) |
| `vendor/bin/phpunit --filter CalendarViewFixturesTest` | not run: no PHP (pending CI/Sail) |
| `test -d tests/Tools/m365-spike/raw` | exit 1 (deleted) |
| `roadmap analyze` after the Phase 7 edit | parses, 7 phases |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] decisions CLI test depended on the repository tree lacking the document**
- **Found during:** Task 3 full run of the Node suite
- **Issue:** `cli: decisions without --file fails on a tree without the document` (written in 01-04) ran against the real tree, which has had `DECISIONS-graph.md` since Task 1, so it exited 0 instead of 1.
- **Fix:** the test now points `--file` at a missing `DECISIONS-graph.md` in a temp directory; it asserts the same failure and file name without depending on repo state.
- **Files modified:** tests/Tools/m365-spike/test/validate-docs.test.mjs
- **Commit:** cd242ead

**2. [Rule 3 - Blocking] Prettier check failed on four pre-existing files**
- **Found during:** Task 3 gate (Prettier had been unrun in 01-02 to 01-04 because node_modules was missing)
- **Issue:** capture.e2e.test.mjs, oauth.test.mjs, validate-docs.test.mjs, validate-docs.mjs were not Prettier-clean.
- **Fix:** `npm ci --ignore-scripts` (locked devDependencies, as the plan allows), then `prettier --write` on those four files; the Node suite stays green. The three Prettier unrun-verify ledger entries (#3, #4, #5) were marked fixed.
- **Commit:** cd242ead

### Plan adaptations from the owner's checkpoint answers (not defects)

- Task 2 outcome is "deferred", so the acceptance items "Redirect URIs row lists exactly the three permanent URIs", "`Caducidad del secreto spike` contains eliminado" and "guide lines read RETIRADO" are intentionally NOT met; they are replaced by the APLAZADO records above. The `Caducidad del secreto spike` row still starts with an ISO date, as the final gate requires.
- Decisions document: Eligibility signals, Declined, Moved and Cancelled Decision lines rewritten for the revised SYNC-03 (answer 5); added `Claim: S5.round_b.present` and `Claim: S5.observed`, and `S5.roundB.json` as evidence in Eligibility signals.
- `commits: 5` is the measured count from the ledger base and includes the owner's planning commit 6ecb6da0 (revised SYNC-03), which is not this plan's work; the plan's own commits are 3b5c0f1c, 23663805, cd242ead, ddc8ec48 (plus the closing docs commit).

## Known Stubs

None. (Ledger entries #1 and #2, the runbook PENDIENTE and the `<DOMINIO-DOKPLOY>` token, were resolved in 01-05; they remain `open` in `.planning/WINDOWS.md` and should be marked fixed by the orchestrator or the verifier.)

## Deferred Issues / pending items

- Entra: delete `http://localhost/m365-spike/callback` and secret `spike-2026-10`, then mark the guide RETIRADO and update the runbook (ROADMAP Phase 7 criterion 5).
- PHPUnit `CalendarViewFixturesTest` has never executed (WINDOWS.md `unrun-verify`); run it in CI or Sail.
- Other research files may still describe the old SYNC-03 rule ("organized/accepted/tentative"); not touched here (scope). Phase 3 research should use REQUIREMENTS.md SYNC-03 and DECISIONS-graph.md.
- Optional scenarios E1-E6 and S7b were not captured; DECISIONS-graph.md states each gap.

## Threat Flags

None. Threat register: T-01-27 (raw/ and salt) mitigated, raw/ deleted after the leak-checked gate; T-01-33 mitigated by the raw-backed replay gate before deletion; T-01-28 mitigated by `decisions --trace`; T-01-26 (leftover spike URI/secret) is knowingly ACCEPTED until Phase 7 by the owner (Doppler copy deleted, URI and secret still in Entra, secret expires 2027-04-19).

## Self-Check: PASSED

- Files: docs/m365/DECISIONS-graph.md, docs/m365/RUNBOOK-entra-app.md, .planning/phases/01-tenant-setup-outlook-spike/01-VALIDATION.md found; tests/Tools/m365-spike/raw absent (intended).
- Commits 3b5c0f1c, 23663805, cd242ead, ddc8ec48 verified as ancestors of HEAD.
