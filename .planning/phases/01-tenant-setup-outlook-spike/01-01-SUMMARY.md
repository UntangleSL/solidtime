---
phase: 01-tenant-setup-outlook-spike
plan: 01
subsystem: infra
tags: [entra-id, microsoft-365, admin-guide, runbook, node-test, doc-gates]

requires:
  - phase: none
    provides: first plan of the first phase
provides:
  - Spanish step-by-step Entra registration and test-mailbox guide for the Untangle M365 admin (docs/m365/GUIA-ADMIN-ENTRA.md)
  - Non-secret runbook skeleton with a row for every hand-back item (docs/m365/RUNBOOK-entra-app.md)
  - Zero-dependency offline doc gates (validate-docs.mjs guide | runbook [--final] | secrets | gitignore) with 31 node:test cases
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, phase-02]

actuals:
  tokens: 21400
  tasks: 3
  commits: 4
plan_head_before: 2630d624475d062bd42517d5085e9b75d47d46f1
plan_head_after: d73ae6eea4449079efc8a3ac459d9ba0812c69fd

tech-stack:
  added: []
  patterns:
    - "Table-driven CLI dispatcher (COMMANDS map with per-command flag specs): a new subcommand is one map entry"
    - "Check functions return failure reasons ([] = pass); an internal checker also counts checks for the OK line"
    - "Planted secrets/GUIDs/e-mails in tests are assembled at runtime so the secrets gate can scan the tests"

key-files:
  created:
    - docs/m365/GUIA-ADMIN-ENTRA.md
    - docs/m365/RUNBOOK-entra-app.md
    - tests/Tools/m365-spike/validate-docs.mjs
    - tests/Tools/m365-spike/test/validate-docs.test.mjs
  modified: []

key-decisions:
  - "checkGuide requires the scope string to end at a token boundary, so Calendars.ReadWrite never satisfies it"
  - "Graph scope tokens other than User.Read and Calendars.Read, Application permissions, SPA/mobile platforms and implicit-grant checkboxes are accepted in the guide only on a line that forbids them"
  - "validate-docs flags are declared per command (boolean or string) so 01-04 can add decisions --trace --manifest with one COMMANDS entry"
  - "SECRET_PATTERNS holds only the JWT, client-secret-value and token-assignment shapes; e-mail and GUID rules live in scanSecrets for phase-owned paths"

patterns-established:
  - "Every guide line naming the temporary spike URI or the spike secret carries TEMPORAL (RETIRADO after 01-08)"
  - "Parte 10 checklist items marked (runbook) map to a runbook values-table key or to the Verificación 'Secreto de producción' line"

requirements-completed: []

coverage:
  - id: D1
    description: "Spanish admin guide with Preparación, Partes 1-10, exact scope string, four Web redirect URIs, Ronda A and Ronda B tables"
    requirement: SETUP-01
    verification:
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-docs.mjs guide (guide: OK, 114 checks)"
        status: pass
    human_judgment: true
    rationale: "Spanish portal and Outlook labels come from machine-translated Microsoft pages; only a person looking at the live UI can confirm them (plan backstop truth and Task 3 human-check)"
  - id: D2
    description: "Runbook skeleton with the twelve-row values table, Verificación, Renovación (production and spike secrets), Limpieza and Historial"
    requirement: SETUP-01
    verification:
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-docs.mjs runbook (runbook: OK, 23 checks); runbook --final exits 1 listing PENDIENTE"
        status: pass
    human_judgment: false
  - id: D3
    description: "validate-docs.mjs doc gates (guide, runbook [--final], secrets, gitignore) that fail loudly when a mandatory element is removed"
    requirement: SETUP-01
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/validate-docs.test.mjs (31 pass, 0 fail)"
        status: pass
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-docs.mjs secrets (secrets: OK, 1509 checks)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 01: Admin guide, runbook skeleton and doc gates Summary

**Spanish Entra admin guide (Preparación to Parte 10, scenario tables for Ronda A and B), a PENDIENTE runbook skeleton, and a zero-dependency `validate-docs.mjs` that gates guide, runbook, secrets and gitignore.**

## Note for the product owner

The guide is ready to send to the admin at `docs/m365/GUIA-ADMIN-ENTRA.md`. One decision is still open: **the Dokploy public domain must be decided** so it can replace the marked token `<DOMINIO-DOKPLOY>` in the guide and runbook (the admin can add that single redirect URI later; the rest does not wait for it). Also still unknown: whether the tenant has Entra ID P1/P2 (the guide has the individual-assignment fallback) and the staff group name (the guide asks the admin to report it).

Partes 6 to 9 should be read once next to the live Spanish Entra admin center and Outlook on the web (Task 3 human-check). Any label that differs is applied by 01-05.

## Performance

- **Duration:** about 25 min (start time was not recorded; estimated from commit timestamps)
- **Completed:** 2026-10-19
- **Tasks:** 3 (Task 1 as RED and GREEN commits)
- **Files created:** 4

## Accomplishments

- `docs/m365/GUIA-ADMIN-ENTRA.md`: Preparación, Partes 1-10, each Parte with Qué hacer, Por qué and Cómo comprobarlo and the English portal label in parentheses; exact scope string, four Web redirect URIs, single tenant, implicit grant off, public client flows = No, Global Administrator bypass and P1/P2 warnings, mandatory admin consent, production secret with same-day Valor check, separate TEMPORAL spike secret, Conditional Access review, test users, scenarios S1 to S8 (+ S7b, E1-E6) around the 2026-10-25 DST change with a converted 22-week March 2027 table, and a hand-back checklist routed through the password manager.
- `docs/m365/RUNBOOK-entra-app.md`: values table with the twelve keys (11 PENDIENTE), Verificación (including the `Secreto de producción` line that hands the token proof to Phase 2's first Dokploy sign-in and names AADSTS7000215), zero-downtime renewal plus the AADSTS7000222 spike-secret path, cleanup checklist and Historial.
- `tests/Tools/m365-spike/validate-docs.mjs`: `guide` (114 checks on the real guide), `runbook [--final]` (23 checks; final mode adds IDs, ISO dates, reminder >= 30 days, expiry <= 730 days, redirect host, Verificación evidence), `secrets` (1509 files scanned via `git ls-files --cached --others --exclude-standard`) and `gitignore`.
- 31 `node:test` cases, every behavior bullet covered, planted secrets assembled at runtime.

## Task Commits

1. **Task 1: doc-gate tracer path** - `278d8a76` (test, RED: 27 tests, 22 failing on assertions against a vacuous stub) and `639c72fe` (feat, GREEN: 27 passing)
2. **Task 2: guide core and runbook skeleton** - `4acea393` (docs)
3. **Task 3: guide Partes 6-9 and extended checkGuide** - `d73ae6ee` (docs)

**Plan metadata:** recorded in the final docs commit.

Tracer gate for Task 1 (interactive, `end-of-phase`, automated-only verify): re-ran the three verify commands after the commit. Tests 27/27, `secrets: OK`, `guide` exit 1 with `FAIL guide:` naming the missing file. Passed, so expansion continued.

## Files Created/Modified

- `docs/m365/GUIA-ADMIN-ENTRA.md` - Spanish admin guide, about 450 lines
- `docs/m365/RUNBOOK-entra-app.md` - non-secret registration values and procedures
- `tests/Tools/m365-spike/validate-docs.mjs` - CLI and module (exports `checkGuide`, `checkRunbook`, `scanSecrets`, `checkGitignore`, `SCOPES`, `REDIRECT_URIS`, `SECRET_PATTERNS`, `isAllowedGuid`, `main`)
- `tests/Tools/m365-spike/test/validate-docs.test.mjs` - node:test suite

## Decisions Made

See `key-decisions` in the frontmatter. `isAllowedGuid(path, guid, line?)` takes an optional third argument so the runbook rule (GUIDs only on the tenant and client ID rows) can be decided per line; the two-argument form 01-03 will use covers `tests/Fixtures/M365/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scope-string check accepted `Calendars.ReadWrite`**
- **Found during:** Task 1 (GREEN)
- **Issue:** `text.includes(SCOPES)` is still true for `...Calendars.ReadWrite`, because the correct string is a prefix of it, so the planned "ReadWrite in place of Read fails" behavior did not hold.
- **Fix:** the scope string must be followed by a non-token character (`(?![A-Za-z0-9.])`).
- **Files modified:** `tests/Tools/m365-spike/validate-docs.mjs`
- **Committed in:** `639c72fe`

**2. [Rule 2 - Missing critical functionality] Gate coverage for the plan's "never instructs" prohibitions**
- **Found during:** Task 1
- **Issue:** the plan's prohibitions (no Application permissions, no SPA/mobile platform, no extra Graph scope, implicit grant off) were only covered by the exact scope string.
- **Fix:** `checkGuide` also fails when a Graph scope token other than `User.Read`/`Calendars.Read`, "Application permissions", the SPA or mobile platform names, or the implicit-grant checkboxes appear on a line that does not forbid or uncheck them.
- **Files modified:** `tests/Tools/m365-spike/validate-docs.mjs`, `tests/Tools/m365-spike/test/validate-docs.test.mjs`
- **Committed in:** `639c72fe`

**3. [Rule 1 - Bug] English labels and the public-client line split across wrapped lines**
- **Found during:** Task 2
- **Issue:** the gate matches `(Label)` and the `Allow public client flows ... = No` line within a single line; the first draft wrapped several of them, so those checks passed vacuously or failed.
- **Fix:** kept those guide lines unbroken.
- **Files modified:** `docs/m365/GUIA-ADMIN-ENTRA.md`
- **Committed in:** `4acea393`

### Other deviations

- **Commit trailer.** The orchestrator prompt asked for `Co-Authored-By: Claude Opus 5.5`, while the session-level attribution instruction names `Claude Sonnet 5.5`, which is the model that actually ran. All four commits use Sonnet 5.5 (the RED commit was amended once, before anything else was committed on top of it).
- **`requirements mark-complete SETUP-01` not run.** The plan lists SETUP-01, but this plan only delivers the guide, runbook and gates; the registration does not exist yet. SETUP-01 should be marked complete after 01-05 verifies the registration. `requirements-completed` is empty on purpose.
- **Prettier not run.** There is no `node_modules` on this host (no `npx --no-install prettier`). The `.mjs` files were formatted by hand to `.prettierrc.json`; `npm run format:check` should be run where dependencies are installed. A handful of lines exceed 100 columns only because of unbreakable string or regex literals.

## Issues Encountered

None blocking. Shell heredocs collapse `\\` to `\`, which corrupted one scripted edit; fixed with the Edit tool before any commit.

## Known Stubs

| File | Reason | Resolved by |
|------|--------|-------------|
| `docs/m365/RUNBOOK-entra-app.md` | 11 of 12 values rows (and the Verificación items) are `PENDIENTE` by design until the admin hands the data back | 01-05 (`runbook --final` rejects any remaining PENDIENTE) |
| `docs/m365/GUIA-ADMIN-ENTRA.md`, runbook `Redirect URIs` | `<DOMINIO-DOKPLOY>` token until the Dokploy public domain is decided | 01-05 Task 1 (decision) and Task 2 (replacement) |

Both are recorded in `.planning/WINDOWS.md` (open until 01-05).

## Threat Flags

None. Documentation and an offline Node validator only; no network endpoint, auth path or schema was added. T-01-01 to T-01-05, T-01-29 and T-01-30 are mitigated as planned (secret routing through the password manager, scope string gate, public-client = No gate, 180-day secret with 45-day reminder, same-day Valor check, TEMPORAL/RETIRADO gate).

## Next Phase Readiness

- The guide can be sent to the admin today. Plan 01-02 (harness and `.gitignore`) can run on the same tree; `validate-docs.mjs secrets` already passes with or without its files, and `gitignore` becomes meaningful once 01-02 creates `tests/Tools/m365-spike/.gitignore`.
- Blocked on people, not code: Dokploy domain (product owner), registration and Ronda A/B (admin).

## Self-Check: PASSED

All four created files and the SUMMARY exist; commits `278d8a76`, `639c72fe`, `4acea393` and `d73ae6ee` are ancestors of HEAD.
