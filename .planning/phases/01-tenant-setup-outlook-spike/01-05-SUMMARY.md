---
phase: 01-tenant-setup-outlook-spike
plan: 05
subsystem: infra
tags: [entra-id, app-registration, admin-consent, tenant-wide-access, runbook, doppler]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-01 doc gates (validate-docs.mjs runbook/guide/secrets) and 01-02 capture harness (auth, auth --as B, status)"
provides:
  - "Real Entra app registration solidtime-m365 in Untangle's tenant, admin-consented, tenant-wide access (Assignment required = No)"
  - "docs/m365/RUNBOOK-entra-app.md with every non-secret value filled and a dated Verificacion section"
  - "Verified sign-in of user A (owner, Global Administrator) and non-admin, non-assigned user B with exactly the six scopes and no consent prompt"
affects: [01-06, 01-07, 01-08, phase-02]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 90ef897b29c0e7ed901364c7ba0a20a6d6a505ca
plan_head_after: a08babd465cf91bfcabda8ee739cf0d476c592dc

tech-stack:
  added: []
  patterns:
    - "Registration facts are recorded from capture.mjs status output only (booleans), never from raw/ files"
    - "Secrets only in Doppler vps (dev: spike secret; prd: production secret); runbook holds names and dates"

key-files:
  created: []
  modified:
    - docs/m365/RUNBOOK-entra-app.md
    - tests/Tools/m365-spike/validate-docs.mjs
    - tests/Tools/m365-spike/test/validate-docs.test.mjs

key-decisions:
  - "Access mode tenant: Business Standard has no Entra ID P1, so no group assignment; guests are rejected later in code (AUTH-02)"
  - "Production secret expires in 24 months (2028-10-19), deviating from the guide's 180-day recommendation: single admin, secret only in Doppler vps/prd; reminder 2028-09-04 in the owner's Outlook calendar"
  - "Security Defaults (MFA for the whole organisation) is the Conditional Access state; no policies exist and none were changed"

patterns-established:
  - "Consent lesson: the first sign-in showed a consent prompt because admin consent was not yet granted; ticking 'Consent on behalf of your organization' granted it tenant-wide and no later sign-in (A or B) was prompted"

requirements-completed: [SETUP-01]

status: complete
duration: 25min
completed: 2026-10-19
---

# Phase 1 Plan 05: Entra registration and verification Summary

**solidtime-m365 is registered, admin-consented for tenant-wide access, and verified: both the owner (Global Administrator) and Alejandro Cava (non-admin, not assigned) sign in with exactly the six scopes, a refresh token, a matching tenant, userType Member and no consent prompt; every non-secret value is in the runbook.**

## Performance

- **Duration:** about 25 min for the executor part after the admin checkpoint
- **Completed:** 2026-10-19
- **Tasks:** 2 (Task 1 admin checkpoint, completed by the humans and verified by the orchestrator; Task 2 runbook)
- **Files modified:** 3

## Accomplishments

- Task 1 (human-action): the admin registered the app, granted consent, created the production secret `produccion-2026-10` and the spike secret `spike-2026-10`, and A and B each ran the sign-in. `capture.mjs status` confirms for both `auth (A)` and `auth --as B`: scopeMatches true, refreshTokenIssued true, tidMatches true, userType Member, signedInMatchesLoginHint true, consentPromptShown false; no production-secret WARNING; raw/ and .env.local are git-ignored.
- Task 2: every row of `## Valores del registro` filled (tenant and client GUIDs, access mode tenant, production expiry 2028-10-19, reminder 2028-09-04, owner role, spike expiry 2027-04-19, Conditional Access findings, Dokploy domain time.untangle.es), `## Verificacion` dated 2026-10-19 with the A and B results, `## Historial` row added. No PENDIENTE remains.
- Gates: `runbook --final` OK (49 checks), `guide` OK (117), `secrets` OK (1535), full `node --test` glob 205 pass / 0 fail.

## Task Commits

1. **Task 2 (gate fix, deviation)** - `d2d0053f` (fix: runbook gate expiry ceiling in calendar months)
2. **Task 2 (runbook)** - `a08babd4` (docs: registration values and dated verification)

Task 1 was a human-action checkpoint and produced no commit. Plan metadata commit follows this summary.

## Files Created/Modified

- `docs/m365/RUNBOOK-entra-app.md` - final non-secret values, verification evidence, deviation and lesson notes, history row
- `tests/Tools/m365-spike/validate-docs.mjs` - production-secret expiry ceiling now 24 calendar months
- `tests/Tools/m365-spike/test/validate-docs.test.mjs` - test for exactly 24 months passing across a leap day and one day over failing

## Decisions Made

See key-decisions above. The 24-month production secret is the owner's decision; the runbook's `Renovacion del secreto` procedure still says 180 days for future rotations (the guide default), and the row note records the deviation and rationale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Runbook gate rejected a valid 24-month expiry**
- **Found during:** Task 2 (`runbook --final`)
- **Issue:** The gate capped expiry at 730 days from today. Entra's 24-month maximum from 2026-10-19 is 2028-10-19, which is 731 days because of the 2028 leap day, so a correct portal date failed.
- **Fix:** Compare against today plus 24 calendar months instead of a fixed day count; message now says "24 meses (730 días)". Added a test (2028-10-19 passes, 2028-10-20 fails); the existing 800-day test still passes.
- **Files modified:** tests/Tools/m365-spike/validate-docs.mjs, tests/Tools/m365-spike/test/validate-docs.test.mjs
- **Commit:** d2d0053f

### Other notes (not code deviations)

- The guide `GUIA-ADMIN-ENTRA.md` needed no edit: it already contained no `<DOMINIO-DOKPLOY>` placeholder and the admin reported no label corrections.
- Production secret lifetime (24 months vs the guide's 180 days) is a documented owner decision, recorded in the runbook.
- First production-secret attempt stored the Secret ID instead of the Value; caught by format check (36-char GUID), both secrets were recreated, the stored values now have the Value shape (40 chars). Valor check date 2026-10-19.

## Issues Encountered

None beyond the gate fix above.

## Auth Gates

Task 1 was the planned admin/human sign-in checkpoint; documented as normal flow.

## Known Stubs

None.

## Threat Flags

None. No secret, password, token or e-mail address was written to any committed file; `secrets: OK`.

## Phase 2 entry checks

- Guests must be rejected in code (AUTH-02): Entra no longer blocks them because Assignment required = No.
- The production secret `produccion-2026-10` has passed only the Valor check (shape, 40 characters, not a GUID). It has NOT been used to acquire a token.
- Phase 2 must prove it acquires a token at its first Microsoft sign-in on Dokploy (ROADMAP Phase 2 criterion 1) and record the date in the runbook `- Secreto de producción:` line. AADSTS7000215 at that point means a new production secret is needed (runbook, Renovación del secreto).

## Next for the product owner

The admin can now continue with guide Parte 8 (Ronda A) and must send "Ronda A lista" when every scenario exists and is answered. The Outlook client for the scenarios is web and the mailbox time zone is Europe/Madrid (to be confirmed at Round A).

## Self-Check: PASSED

- docs/m365/RUNBOOK-entra-app.md: FOUND, no PENDIENTE
- Commits d2d0053f and a08babd4: FOUND on feature/m365-integration

---
*Phase: 01-tenant-setup-outlook-spike*
*Completed: 2026-10-19*
