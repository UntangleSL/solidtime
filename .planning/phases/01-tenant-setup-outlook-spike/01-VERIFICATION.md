---
phase: 01-tenant-setup-outlook-spike
verified: 2026-10-19T20:00:00Z
status: human_needed
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
covered_digest: "v3:sha256:014d1db8f9f981e75406ba7091f5af9ed87285424d06c81aa0bdef3b3f195f40"
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "Entra spike cleanup: remove redirect URI http://localhost/m365-spike/callback and secret spike-2026-10, mark guide lines RETIRADO, update runbook"
    addressed_in: "Phase 7"
    evidence: "ROADMAP Phase 7 success criterion 5: 'Entra spike cleanup (remove http://localhost/m365-spike/callback and secret spike-2026-10) once production sign-in works; then mark the guide lines RETIRADO and update the runbook (deferred from Phase 1 by the owner, 2026-10-19).'"
human_verification:
  - test: "Run the PHPUnit fixture replay in CI or Sail: vendor/bin/phpunit --filter CalendarViewFixturesTest"
    expected: "3 tests pass (pages replay through Http::fake following @odata.nextLink; every manifest scenario file loads with sanitized ids; synthetic scenarios are flagged)"
    why_human: "No PHP on the verification host. The Node replay (validate-fixtures.mjs, 10 complete page sequences) is green, but the PHP test file itself has never been executed."
  - test: "Spot-check the Entra portal and the admin's Outlook calendar"
    expected: "App registration solidtime-m365 shows the permanent URIs plus the temporary spike URI, tenant-wide access (Assignment required = No), admin consent granted, production secret expiring 2028-10-19; an Outlook reminder exists on 2028-09-04 (at least 30 days before expiry)"
    why_human: "Tenant state and a personal calendar reminder cannot be observed from the repo. The runbook records them as done on 2026-10-19 (admin-attested)."
---

# Phase 1: Tenant Setup & Outlook Spike Verification Report

**Phase Goal:** As a fork maintainer, I want to have Untangle's Entra app registration consented and real Outlook calendar responses recorded, so that sign-in and meeting sync are built on verified tenant facts instead of assumptions.
**Verified:** 2026-10-19
**Status:** human_needed
**Re-verification:** No, initial verification

The goal is achieved in the repository. Every automated gate re-run in this session is green and no blocker was found. The status is `human_needed` only because two items cannot be observed from the repo: the PHPUnit replay was never executed (no PHP host) and the Entra/Outlook tenant state is admin-attested.

## MVP User Flow Coverage

The goal passes the User Story format guard (`As a ..., I want to ..., so that ... .`). The "so that" outcome is "sign-in and meeting sync are built on verified tenant facts instead of assumptions". It holds in the codebase as follows:

| Story step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Entra app registration consented | Non-secret registration values and verification evidence recorded | `docs/m365/RUNBOOK-entra-app.md` (49 `runbook --final` checks pass) | VERIFIED |
| Real Outlook responses recorded | Sanitized fixtures for all scenarios | `tests/Fixtures/M365/` (274 files, 1542 fixture checks pass) | VERIFIED |
| Downstream built on facts, not assumptions | Fixture-backed keys and eligibility rules for Phases 3-6 | `docs/m365/DECISIONS-graph.md` (205 trace checks pass); STACK.md and PITFALLS.md carry correction pointers | VERIFIED |

## Goal Achievement

### Observable Truths (ROADMAP success criteria, the contract)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A runbook documents tenant ID, client ID, redirect URIs, scopes, tenant-wide access setting, admin consent and the client-secret expiry, with a renewal reminder at least 30 days before expiry | VERIFIED | `RUNBOOK-entra-app.md` rows: tenant `fad1cfee-...`, client `3ec957c9-...`, 3 permanent URIs + temporary spike URI, scopes `openid profile email offline_access User.Read Calendars.Read`, `Modo de acceso: tenant (Asignación requerida = No)`, expiry 2028-10-19, reminder 2028-09-04 (45 days before). Consent recorded in `## Verificación`. `validate-docs.mjs runbook --final`: OK (49 checks). The existence of the Outlook reminder itself is admin-attested (human item 2). |
| 2 | Two Untangle accounts (admin and a non-admin, unassigned member) authorize the app without a per-user consent prompt and receive exactly the configured delegated scopes (tenant-wide access) | VERIFIED (attested evidence) | Runbook `## Verificación`, dated 2026-10-19: A and B both `scopeMatches true`, `refreshTokenIssued true`, `tidMatches true`, `userType Member`, B `consentPromptShown false`. The first A run showed consent because admin consent was not yet granted; it was granted and the second run was clean. The harness that produced this (`capture.mjs auth`, `auth --as B`) exists and is covered by `oauth.test.mjs` and `capture.e2e.test.mjs` against a fake Microsoft. The fixtures themselves (B organizes, A reads) corroborate that both accounts signed in. Live portal state is not re-observable here (human item 2). |
| 3 | Sanitized `calendarView` fixtures recorded from a real Untangle mailbox exist for all eight scenarios | VERIFIED | `manifest.json` has S1, S1b, S2 (4 occurrences + an `exception` in Round B), S3 cancelled, S4 declined, S5/S5b moved, S6/S6b private, S7 all-day, S8 personal block (organizer-only, `attendeesOtherThanOrganizer=0`), all with Round A and Round B and Round B lookups. `validate-fixtures.mjs`: OK (1542 checks: schema, semantic, leaks, Node replay of 22/21-request page sequences). |
| 4 | A fixture-backed decision document fixes the occurrence key, the series key and exactly how cancelled, declined and moved meetings show up, including with immutable ids and across `@odata.nextLink` | VERIFIED | `DECISIONS-graph.md` has all required sections. Occurrence key = immutable `id` (fallback `(seriesMasterId, originalStart)`), series key = `seriesMasterId`. Cancelled (S3: `isCancelled=true`, lookup 200), declined (S4: gone, lookup 404), moved (S5 same id and `notResponded`; S5b absent but lookup 200). ImmutableId/nextLink: `Prefer` is not carried by `nextLink` (0 equal ids, 3 different). `decisions --trace`: OK (205 checks). I spot-checked two unguarded facts against the fixtures: the S2 exception keeps `originalStart` 2026-11-03T09:00:00Z while its `start` is 10:00Z (`roundB.prod-select.page-14.json`), and S4/S3 lookups are 404 / `isCancelled=true`. Both match. |

**Score:** 4/4 truths verified (0 behavior-unverified).

### Deferred Items

| # | Item | Addressed In | Evidence |
| --- | --- | --- | --- |
| 1 | Entra spike cleanup (URI `http://localhost/m365-spike/callback`, secret `spike-2026-10`, guide lines RETIRADO) | Phase 7 | ROADMAP Phase 7 success criterion 5 (owner-approved deviation 2) |

### Owner-Approved Deviations (not gaps)

1. Tenant-wide access ("Assignment required" = No) instead of assignment; success criterion 2 and SETUP-01 were rewritten accordingly. Guests are rejected in code in Phase 2 (AUTH-02).
2. Entra spike cleanup deferred to Phase 7 (see Deferred Items). The runbook, guide (still TEMPORAL), and ROADMAP are consistent about it. Doppler `SOLIDTIME_M365_SPIKE_*` keys were already deleted and local `raw/` is gone (confirmed absent).
3. PHPUnit `CalendarViewFixturesTest` not executed (no PHP). Tracked as human item 1.
4. Production secret lifetime is 24 months (expiry 2028-10-19) instead of the guide's 180 days. Runbook notes the decision; reminder 45 days ahead satisfies the 30-day criterion.
5. S8 created on a different day; optional scenarios (E1-E6, S7b) not created. `DECISIONS-graph.md` states each gap honestly ("untested, not works").

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `docs/m365/GUIA-ADMIN-ENTRA.md` | Spanish admin guide | VERIFIED | 470 lines, Preparación + Partes 1-10; `guide`: OK (117 checks) |
| `docs/m365/RUNBOOK-entra-app.md` | Registration values, verification, renewal, cleanup | VERIFIED | `runbook --final`: OK (49 checks); no secret values, no e-mail addresses |
| `docs/m365/DECISIONS-graph.md` | Fixture-backed decisions | VERIFIED | `decisions --trace`: OK (205 checks); claims equal the manifest |
| `tests/Fixtures/M365/**` | Sanitized fixtures + manifest + README | VERIFIED | 274 files; manifest lists scenarios, experiments, lookups |
| `tests/Tools/m365-spike/` | Capture harness, sanitizer, gates, Node tests | VERIFIED | 209/209 Node tests pass; `.gitignore` covers `raw/` and `.env.local` (`gitignore`: OK, 6 checks); `raw/` absent |
| `tests/Unit/M365/CalendarViewFixturesTest.php` | PHPUnit replay | PRESENT, NOT EXECUTED | 3 test methods, manifest-driven; never run (human item 1) |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| DECISIONS-graph.md `Claim:` lines | `manifest.json` | `validate-docs.mjs decisions --trace` | WIRED | 205 checks; cited paths exist, every captured scenario is cited |
| manifest page lists | fixture page files | `validate-fixtures.mjs` Node replay | WIRED | Round A 22 requests / 14 events, Round B 21 requests / 12 events, 5 passes each |
| PHPUnit test | manifest | `base_path('tests/Fixtures/M365/')` + manifest lists | WIRED (not run) | Reads files in manifest order, not directory order |
| STACK.md / PITFALLS.md | DECISIONS-graph.md | Correction notes | WIRED | Pointers present at STACK.md:164 and PITFALLS.md:182 |

### Data-Flow Trace (Level 4)

Not applicable: no rendering artifacts. Fixture data flows end to end: real capture, sanitize, manifest, replay gate, decision claims.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Node suite | `node --test "tests/Tools/m365-spike/test/*.test.mjs"` | 209 tests, 209 pass, 0 fail | PASS |
| Guide gate | `validate-docs.mjs guide` | OK (117 checks) | PASS |
| Runbook gate | `validate-docs.mjs runbook --final` | OK (49 checks) | PASS |
| Secret scan | `validate-docs.mjs secrets` | OK (1814 checks) | PASS |
| Gitignore gate | `validate-docs.mjs gitignore` | OK (6 checks) | PASS |
| Decision gate | `validate-docs.mjs decisions --trace` | OK (205 checks) | PASS |
| Fixture gate | `validate-fixtures.mjs` | OK (1542 checks) | PASS |

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh` probes.

### Tenant PII Scan of `tests/Fixtures/M365/**` (blocker check)

Result: NO HITS. Zero blockers.

- Grep for `untanglegrowth`, `untangle.es`, `alejandro`, `cava`, `herrero`, `juan`, the real tenant and client GUIDs, `solidtime.test`: no match outside the README's prose "Untangle's own tenant" (a company name, no identifier).
- E-mail addresses: only `person-a@example.test` and `person-b@example.test`.
- Display names: only `Test User A`, `Test User B`, `Location 1`. Given/surname: `Test` / `User A`.
- Hosts in URLs: `graph.microsoft.com` (public API host, appears in `@odata.nextLink`), `outlook.example.test`, `teams.example.test`. No real Teams join URL (all `https://teams.example.test/l/meetup-join/<n>`).
- GUIDs: only the pseudonymized `00000000-0000-4000-8000-...` form; ids carry the `FAKE` prefix.
- Subjects: only `[M365-TEST ...]` tags.
- `raw/` (real data and pseudonym salt) is deleted and git-ignored.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SETUP-01 | 01-01, 01-02, 01-05, 01-08 | Entra app registered, documented in runbook with secret expiry | SATISFIED (tenant state admin-attested) | Truths 1 and 2; temporary spike URI and secret deferred to Phase 7 |
| SETUP-02 | 01-02, 01-03, 01-06, 01-07 | Real calendarView fixtures for the eight scenarios | SATISFIED | Truth 3; PHPUnit replay pending (human item 1) |
| SETUP-03 | 01-04, 01-08 | Written decision on occurrence key, series key, cancelled/moved | SATISFIED | Truth 4 |

No orphaned requirements: REQUIREMENTS.md maps only SETUP-01..03 to Phase 1, and all are claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `docs/m365/*.md`, `tests/Tools/m365-spike/**`, `tests/Unit/M365/*.php` | - | TODO/FIXME/TBD/XXX | none found | No debt markers |

### Observations (informational, not gaps)

- The "declined" fixture is an absence: S4 Round A has the event as `accepted` and Round B has it gone (lookup 404). No event with `responseStatus=declined` was captured. The decision document says so explicitly, and that is how Graph behaves in this tenant, so it satisfies "exactly how declined shows up".
- The "cancelled" fixture is an unprocessed cancellation (`isCancelled=true`, still in the window). The deleted-after-processing case is not captured. Also documented.
- S6b (attendee copy of a private meeting) was not marked Private, so the attendee-side sensitivity propagation is unproven. Also documented, labelled owner-reported.
- Because `raw/` and the spike secret are gone, fixtures cannot be re-sanitized and a new capture would change every pseudonym. This is documented in the runbook and README.
- The runbook contains the name of one real colleague (user B) and the real domains and tenant/client IDs. This is allowed in docs by decision D-03 and is outside the fixtures.
- Phase 2 entry check: the production secret only passed the admin's Valor check; its first real token acquisition is deferred to Phase 2 (Dokploy first sign-in), as the runbook and 01-08 summary state.

### Human Verification Required

#### 1. PHPUnit fixture replay

**Test:** In CI (`phpunit.yml`) or Sail, run `vendor/bin/phpunit --filter CalendarViewFixturesTest`.
**Expected:** 3 tests pass.
**Why human:** No PHP on the host. The Node replay covers the same page sequences, but the PHP file is unexecuted.

#### 2. Tenant state and reminder spot-check

**Test:** In the Entra admin center confirm the app registration, tenant-wide access, admin consent and secret expiries; confirm the Outlook renewal reminder dated 2028-09-04 exists.
**Expected:** Matches the runbook.
**Why human:** Not observable from the repo; admin-attested on 2026-10-19.

### Gaps Summary

No gaps. All four ROADMAP success criteria are satisfied by artifacts that exist, are substantive, and pass their gates. The only open items are the unexecuted PHPUnit test and the admin-attested tenant state (human_needed), plus the owner-deferred Entra cleanup, which is explicitly scheduled in Phase 7.

---

_Verified: 2026-10-19_
_Verifier: Claude (gsd-verifier)_
