---
phase: 01-tenant-setup-outlook-spike
verified: 2026-11-05T12:46:53Z
status: passed
score: 4/4 must-haves verified
covered_files:
  - ".planning/phases/01-tenant-setup-outlook-spike/01-01-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-01-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-02-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-02-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-03-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-03-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-04-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-04-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-05-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-05-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-06-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-06-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-07-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-07-SUMMARY.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-08-PLAN.md"
  - ".planning/phases/01-tenant-setup-outlook-spike/01-08-SUMMARY.md"
  - "docs/m365/DECISIONS-graph.md"
  - "docs/m365/GUIA-ADMIN-ENTRA.md"
  - "docs/m365/RUNBOOK-entra-app.md"
  - "tests/Fixtures/M365/manifest.json"
  - "tests/Tools/m365-spike/capture.mjs"
  - "tests/Tools/m365-spike/sanitize.mjs"
  - "tests/Tools/m365-spike/validate-docs.mjs"
  - "tests/Tools/m365-spike/validate-fixtures.mjs"
  - "tests/Unit/M365/CalendarViewFixturesTest.php"
covered_digest: "v3:sha256:753d0f0475859670bd9305c93f15242c24b25e65385769c2c07b39d3afb075e7"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/4
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  human_items_resolved:
    - item: "Run the PHPUnit fixture replay (CalendarViewFixturesTest)"
      result: passed
      confirmed_by: "verifier (CI log inspected directly)"
      confirmed_at: "2026-11-05"
      evidence: "GitHub Actions run 41873221686 'PHPUnit Tests' on d24a04b3 (2026-11-04, conclusion success): jobs phpunit (15), (16), (17) each print 'PASS Tests\\Unit\\M365\\CalendarViewFixturesTest' with all 3 methods checked (pages replay through http fake following next link; every manifest scenario file loads with sanitized ids; synthetic scenarios are flagged). The test contains no skip/incomplete markers. `git diff d24a04b3 -- tests/Unit/M365 tests/Fixtures/M365` is empty, so CI ran the code that is in the repo now. phpunit.xml Unit suite = tests/Unit."
    - item: "Spot-check Entra portal and the admin's Outlook reminder"
      result: passed
      confirmed_by: "production evidence (Phase 2) plus owner attestation recorded in the runbook, accepted under the owner's standing rule (relayed by the orchestrator)"
      confirmed_at: "2026-11-05"
      evidence: "Phase 2 VERIFICATION status passed; 02-11-SUMMARY step 4: first production Microsoft sign-in on https://time.untangle.es 2026-11-04 16:11 UTC with no AADSTS error, and a second (non-admin) tenant account signed in and was provisioned. That proves in production that the registration exists, admin consent is granted, the production secret works, the permanent redirect URI https://time.untangle.es/auth/microsoft/callback works, and the app is tenant-wide (no assignment required). RUNBOOK-entra-app.md lines 20, 56-63, 144-146 record this with dates. Still admin-attested (2026-10-19, runbook lines 22-24): production secret expiry 2028-10-19 and the Outlook reminder on 2028-09-04 (45 days ahead, meets the 30-day criterion)."
deferred:
  - truth: "Entra spike cleanup: remove redirect URI http://localhost/m365-spike/callback and secret spike-2026-10, mark guide lines RETIRADO, update runbook"
    addressed_in: "Phase 7"
    evidence: "ROADMAP Phase 7 success criterion 5: 'Entra spike cleanup (remove http://localhost/m365-spike/callback and secret spike-2026-10) once production sign-in works; then mark the guide lines RETIRADO and update the runbook (deferred from Phase 1 by the owner, 2026-10-19).'"
---

# Phase 1: Tenant Setup & Outlook Spike Verification Report

**Phase Goal:** As a fork maintainer, I want to have Untangle's Entra app registration consented and real Outlook calendar responses recorded, so that sign-in and meeting sync are built on verified tenant facts instead of assumptions.
**Verified:** 2026-11-05T12:46:53Z (initial pass 2026-10-19)
**Status:** passed
**Re-verification:** Yes. The previous status was `human_needed` (4/4) with two open human items and no gaps. Both items now have evidence and are closed (see "Resolved Human Items"). The fingerprint had gone stale because `docs/m365/RUNBOOK-entra-app.md` gained the Phase 2 production dates. I re-ran every Phase 1 gate against the current files and found no regressions.

The goal is achieved. All four ROADMAP success criteria hold. The PHPUnit replay has now run green in CI on three Postgres versions. The tenant facts the phase recorded have been confirmed in production by real Microsoft sign-ins. The one open item is the owner-deferred spike cleanup, which is scheduled in Phase 7.

## MVP User Flow Coverage

The goal passes the User Story format guard (`As a ..., I want to ..., so that ... .`). The "so that" outcome is "sign-in and meeting sync are built on verified tenant facts instead of assumptions". It holds as follows:

| Story step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Entra app registration consented | Non-secret registration values and verification evidence recorded | `docs/m365/RUNBOOK-entra-app.md` (`runbook --final`: OK, 49 checks). Production sign-ins on 2026-11-04 confirm the registration, consent, secret and redirect URI | VERIFIED |
| Real Outlook responses recorded | Sanitized fixtures for all scenarios | `tests/Fixtures/M365/` (`validate-fixtures`: OK, 1542 checks). The PHPUnit replay passes in CI run 41873221686 | VERIFIED |
| Downstream built on facts, not assumptions | Fixture-backed keys and eligibility rules for Phases 3-6 | `docs/m365/DECISIONS-graph.md` (`decisions --trace`: OK, 205 checks). Phase 2 was built on the runbook values and works in production | VERIFIED |

## Goal Achievement

### Observable Truths (ROADMAP success criteria, the contract)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A runbook documents tenant ID, client ID, redirect URIs, scopes, tenant-wide access setting, admin consent and the client-secret expiry, with a renewal reminder at least 30 days before expiry | VERIFIED | `RUNBOOK-entra-app.md` records the tenant and client IDs, the 3 permanent URIs plus the temporary spike URI, the scopes, `Modo de acceso: tenant (Asignación requerida = No)`, expiry 2028-10-19 and reminder 2028-09-04 (45 days before). Consent is recorded in `## Verificación`. `runbook --final`: OK (49 checks, re-run 2026-11-05). The production secret's first token acquisition is dated 2026-11-04 (line 59). The expiry date and the reminder's existence are admin-attested (2026-10-19), accepted under the owner's rule. |
| 2 | Two Untangle accounts (admin and a non-admin, unassigned member) authorize the app without a per-user consent prompt and receive exactly the configured delegated scopes (tenant-wide access) | VERIFIED | Spike evidence (runbook lines 56-57, 2026-10-19): A and B both `scopeMatches true`, B `consentPromptShown false`, `userType Member`. Production corroboration (02-11-SUMMARY step 4; runbook lines 61-62, 145): on 2026-11-04 the owner's account and a second, non-admin tenant account signed in to https://time.untangle.es with no AADSTS error. The production authorize URL carries exactly `openid profile email offline_access User.Read Calendars.Read` (02-VERIFICATION user flow). |
| 3 | Sanitized `calendarView` fixtures recorded from a real Untangle mailbox exist for all eight scenarios | VERIFIED | `manifest.json` covers S1-S8 with variants, Round A and Round B, and lookups. `validate-fixtures.mjs`: OK (1542 checks, re-run 2026-11-05). The PHP replay `CalendarViewFixturesTest` passes all 3 methods in CI run 41873221686 on Postgres 15, 16 and 17. The test and fixtures are unchanged since d24a04b3. |
| 4 | A fixture-backed decision document fixes the occurrence key, the series key and exactly how cancelled, declined and moved meetings show up, including with immutable ids and across `@odata.nextLink` | VERIFIED | `DECISIONS-graph.md`: occurrence key = immutable `id` (fallback `(seriesMasterId, originalStart)`), series key = `seriesMasterId`, plus the cancelled/declined/moved rules and the finding that `Prefer` is not carried by `nextLink`. `decisions --trace`: OK (205 checks, re-run 2026-11-05). File unchanged since the initial verification. |

**Score:** 4/4 truths verified (0 behavior-unverified).

### Resolved Human Items

#### 1. PHPUnit fixture replay: PASSED

- I inspected run 41873221686 ("PHPUnit Tests", head `d24a04b3d6abbd1e1495c987f46804901a83a46e`, 2026-11-04, conclusion `success`) directly with `gh run view 41873221686 --log | grep CalendarViewFixtures`. It printed `PASS Tests\Unit\M365\CalendarViewFixturesTest` on jobs `phpunit (15)`, `phpunit (16)` and `phpunit (17)`.
- On job (15), all three methods are listed with a check mark:
  - `calendarview pages replay through http fake following next link`
  - `every manifest scenario file loads with sanitized ids`
  - `synthetic scenarios are flagged`
- The test file contains no `markTestSkipped` or `markTestIncomplete` calls.
- `phpunit.xml` includes `tests/Unit` in the Unit suite.
- `git diff d24a04b3 -- tests/Unit/M365 tests/Fixtures/M365` is empty, so CI tested what is in the repo now.

#### 2. Entra tenant state and Outlook reminder: PASSED (production-confirmed, with two admin-attested facts)

- **Production-confirmed** (Phase 2 `02-VERIFICATION.md` status `passed`; `02-11-SUMMARY.md` step 4; runbook lines 59, 61-62 and 145):
  - On 2026-11-04 the owner's account and a second, non-admin tenant account completed Microsoft sign-ins on https://time.untangle.es with no AADSTS error.
  - That proves the following in production:
    - the registration exists;
    - admin consent is granted;
    - the production secret works (a wrong value would fail with AADSTS7000215);
    - the permanent redirect URI `https://time.untangle.es/auth/microsoft/callback` is registered (a missing URI would fail with AADSTS50011);
    - the app is tenant-wide (assignment would fail with AADSTS50105 for the unassigned non-admin).
- **Admin-attested** (runbook lines 22-24, 2026-10-19):
  - the production secret expires on 2028-10-19;
  - the Outlook renewal reminder exists on 2028-09-04.
- The repo cannot observe either attested fact. They are accepted under the owner's standing rule that owner attestations recorded in the runbook count as evidence (relayed by the orchestrator).
- The temporary spike URI and the `spike-2026-10` secret are still registered on purpose. Their removal is deferred to Phase 7 (see Deferred Items) and is not a Phase 1 gap.

### Deferred Items

| # | Item | Addressed In | Evidence |
| --- | --- | --- | --- |
| 1 | Entra spike cleanup (URI `http://localhost/m365-spike/callback`, secret `spike-2026-10`, guide lines RETIRADO) | Phase 7 | ROADMAP Phase 7 success criterion 5 (owner-approved deviation 2). Runbook `## Limpieza tras el spike` keeps these unchecked and marked APLAZADO |

### Owner-Approved Deviations (not gaps)

1. Tenant-wide access ("Assignment required" = No) instead of assignment. Success criterion 2 and SETUP-01 were rewritten to match. Guests are rejected in code in Phase 2 (AUTH-02).
2. Entra spike cleanup deferred to Phase 7 (see Deferred Items).
3. Production secret lifetime is 24 months (expiry 2028-10-19) instead of the guide's 180 days. The reminder 45 days ahead satisfies the 30-day criterion.
4. S8 was created on a different day, and the optional scenarios (E1-E6, S7b) were not created. `DECISIONS-graph.md` records each gap as untested, not as working.

(The former deviation "PHPUnit test not executed" is closed: see Resolved Human Item 1.)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `docs/m365/GUIA-ADMIN-ENTRA.md` | Spanish admin guide | VERIFIED | `guide`: OK (117 checks) |
| `docs/m365/RUNBOOK-entra-app.md` | Registration values, verification, renewal, cleanup | VERIFIED | `runbook --final`: OK (49 checks) after the Phase 2 date additions. `secrets` scan: OK (1891 checks) |
| `docs/m365/DECISIONS-graph.md` | Fixture-backed decisions | VERIFIED | `decisions --trace`: OK (205 checks) |
| `tests/Fixtures/M365/**` | Sanitized fixtures + manifest + README | VERIFIED | `validate-fixtures`: OK (1542 checks) |
| `tests/Tools/m365-spike/` | Capture harness, sanitizer, gates, Node tests | VERIFIED | 209/209 Node tests pass. `gitignore`: OK (6 checks). `raw/` is absent |
| `tests/Unit/M365/CalendarViewFixturesTest.php` | PHPUnit replay | VERIFIED | 3/3 pass in CI run 41873221686 (Postgres 15/16/17) |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| DECISIONS-graph.md `Claim:` lines | `manifest.json` | `validate-docs.mjs decisions --trace` | WIRED | 205 checks |
| manifest page lists | fixture page files | `validate-fixtures.mjs` Node replay | WIRED | Round A 22 requests, Round B 21 requests / 12 events |
| PHPUnit test | manifest | `base_path('tests/Fixtures/M365/')` + manifest lists | WIRED (executed) | Green in CI on 3 database versions |
| STACK.md / PITFALLS.md | DECISIONS-graph.md | Correction notes | WIRED | Pointers present (initial pass, unchanged) |
| Runbook registration values | Production sign-in (Phase 2) | `config/microsoft365.php` env values from Doppler `vps/prd` | WIRED | Production sign-ins on 2026-11-04 had no AADSTS error |

### Data-Flow Trace (Level 4)

Not applicable: the phase has no rendering artifacts. Fixture data flows end to end: real capture, then sanitize, manifest, replay gate (Node and PHP) and decision claims.

### Behavioral Spot-Checks (re-run 2026-11-05)

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Node suite | `node --test "tests/Tools/m365-spike/test/*.test.mjs"` | 209 tests, 209 pass, 0 fail | PASS |
| Guide gate | `validate-docs.mjs guide` | OK (117 checks) | PASS |
| Runbook gate | `validate-docs.mjs runbook --final` | OK (49 checks) | PASS |
| Secret scan | `validate-docs.mjs secrets` | OK (1891 checks) | PASS |
| Gitignore gate | `validate-docs.mjs gitignore` | OK (6 checks) | PASS |
| Decision gate | `validate-docs.mjs decisions --trace` | OK (205 checks) | PASS |
| Fixture gate | `validate-fixtures.mjs` | OK (1542 checks) | PASS |
| PHPUnit replay | `gh run view 41873221686 --log \| grep CalendarViewFixtures` | PASS on phpunit (15), (16), (17); 3/3 methods | PASS |

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh` probes.

### Tenant PII Scan of `tests/Fixtures/M365/**` (blocker check)

NO HITS. The fixtures are unchanged since d24a04b3, and the initial scan (2026-10-19) still applies. The `validate-fixtures` leak checks pass again on 2026-11-05.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SETUP-01 | 01-01, 01-02, 01-05, 01-08 | Entra app registered, documented in runbook with secret expiry | SATISFIED | Truths 1 and 2. Production sign-ins confirm the registration. Spike URI and secret removal deferred to Phase 7 |
| SETUP-02 | 01-02, 01-03, 01-06, 01-07 | Real calendarView fixtures for the eight scenarios | SATISFIED | Truth 3. Node and PHP replays both green |
| SETUP-03 | 01-04, 01-08 | Written decision on occurrence key, series key, cancelled/moved | SATISFIED | Truth 4 |

No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `docs/m365/*.md`, `tests/Tools/m365-spike/*.mjs`, `tests/Unit/M365/*.php` | - | TODO/FIXME/TBD/XXX/HACK | none found | No debt markers (re-scanned 2026-11-05) |

### Observations (informational, not gaps)

- The "declined" fixture is an absence: the event is gone in Round B and its lookup returns 404. The "cancelled" fixture is an unprocessed cancellation. In S6b, sensitivity propagation is unproven. All three are documented in `DECISIONS-graph.md`.
- `raw/` and the spike secret are gone, so the fixtures cannot be re-sanitized. A new capture would change every pseudonym. This is documented.
- The only covered file that changed after the initial digest is `RUNBOOK-entra-app.md` (Phase 2 production dates). All gates and tests pass on the current files.

### Human Verification Required

None. Both previous items are resolved (see "Resolved Human Items").

### Gaps Summary

No gaps. All four ROADMAP success criteria are satisfied, the PHPUnit replay is green in CI, and production sign-ins confirm the tenant state. Two facts remain admin-attested and are accepted under the owner's rule: the secret expiry date and the Outlook reminder. The only outstanding work is the Entra spike cleanup, which the owner deferred to Phase 7 on purpose.

---

_Verified: 2026-11-05T12:46:53Z_
_Verifier: Claude (gsd-verifier)_
