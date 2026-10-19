---
phase: "1"
slug: "tenant-setup-outlook-spike"
status: complete
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-19"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in test runner (`node --test`) for offline gates; PHPUnit 12 for fixture replay (only where PHP exists) |
| **Config file** | none for Node; `phpunit.xml` (Unit suite = `tests/Unit`) |
| **Quick run command** | `node --test "tests/Tools/m365-spike/test/*.test.mjs"` |
| **Full suite command** | `node --test "tests/Tools/m365-spike/test/*.test.mjs"` + `node tests/Tools/m365-spike/validate-docs.mjs guide`, `runbook --final`, `secrets`, `gitignore`, `decisions --trace` + `node tests/Tools/m365-spike/validate-fixtures.mjs` + `npx --no-install prettier --check "tests/Tools/m365-spike/**/*.mjs"` (+ `vendor/bin/phpunit --filter CalendarViewFixturesTest` where PHP exists) |
| **Estimated runtime** | ~20 seconds (Node gates) |

---

## Sampling Rate

- **After every task commit:** `node --test "tests/Tools/m365-spike/test/*.test.mjs"` + the validator subcommand for the touched artifact
- **After every plan wave:** full suite command
- **Before `/gsd-verify-work`:** full suite green + human-verify checkpoints signed off
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Type | Behavior | Automated Command | Status |
|---------|------|-------------|------|----------|-------------------|--------|
| 01-01-T1 | 01 | SETUP-01 | tracer, tdd | validate-docs CLI, table-driven dispatcher and the guide, runbook, secrets and gitignore checks | `node --test "tests/Tools/m365-spike/test/validate-docs.test.mjs"` + `node tests/Tools/m365-spike/validate-docs.mjs secrets` | ✅ |
| 01-01-T2 | 01 | SETUP-01 | auto | Guide core (Preparación, Partes 1-5, Parte 10) and runbook skeleton | `node tests/Tools/m365-spike/validate-docs.mjs guide` | ✅ |
| 01-01-T3 | 01 | SETUP-01 | auto | Guide Partes 6-9 (Conditional Access, test users, Ronda A and B) | `node tests/Tools/m365-spike/validate-docs.mjs guide` | ✅ |
| 01-02-T1 | 02 | SETUP-01, SETUP-02 | tracer | End-to-end capture slice against a fake Entra + Graph, no token on disk | `node --test "tests/Tools/m365-spike/test/capture.e2e.test.mjs"` | ✅ |
| 01-02-T2 | 02 | SETUP-01 | auto, tdd | Registration verification commands (auth, auth --expect-blocked, status) | `node --test "tests/Tools/m365-spike/test/oauth.test.mjs" "tests/Tools/m365-spike/test/capture.e2e.test.mjs"` | ✅ |
| 01-02-T3 | 02 | SETUP-02 | auto | Full capture protocol (Prefer, ImmutableId, $select experiments, series, Round B lookups) | `node --test "tests/Tools/m365-spike/test/capture.e2e.test.mjs" "tests/Tools/m365-spike/test/env.test.mjs"` | ✅ |
| 01-03-T1 | 03 | SETUP-02 | auto, tdd | Allow-list sanitizer with keyed pseudonyms and raw-value leak guard | `node --test "tests/Tools/m365-spike/test/sanitize.test.mjs"` | ✅ |
| 01-03-T2 | 03 | SETUP-02 | auto | sanitize CLI: scenario extraction, manifest, synthetic sensitivity copies | `node --test "tests/Tools/m365-spike/test/pipeline.e2e.test.mjs"` | ✅ |
| 01-03-T3 | 03 | SETUP-02, SETUP-03 | auto, tdd | Fixture gate validate-fixtures.mjs (schema, semantic, leaks, Node replay) | `node --test "tests/Tools/m365-spike/test/validate-fixtures.test.mjs"` + `node tests/Tools/m365-spike/validate-fixtures.mjs` | ✅ |
| 01-04-T1 | 04 | SETUP-03 | auto, tdd | decisions structure check (twelve headings, Decision and Evidence lines) | `node --test "tests/Tools/m365-spike/test/validate-docs.test.mjs"` | ✅ |
| 01-04-T2 | 04 | SETUP-03 | auto, tdd | decisions --trace (paths exist, scenarios cited, Claims equal the manifest) | `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace` | ✅ |
| 01-05-T1 | 05 | SETUP-01 | human-action | Admin registers the app; A and B run the verification sign-ins | manual + `capture.mjs auth` / `auth --as B` evidence in the runbook | ✅ |
| 01-05-T2 | 05 | SETUP-01 | auto | Registration values and dated verification evidence in the runbook | `node tests/Tools/m365-spike/validate-docs.mjs runbook --final` | ✅ |
| 01-06-T1 | 06 | SETUP-02 | human-action | Ronda A scenarios built and Round A captured | manual + `capture.mjs` report | ✅ |
| 01-06-T2 | 06 | SETUP-02 | auto | Round A sanitized into committed fixtures and gated | `node tests/Tools/m365-spike/validate-fixtures.mjs` | ✅ |
| 01-07-T1 | 07 | SETUP-02 | human-action | Ronda B mutations applied and Round B captured | manual + `capture.mjs` report | ✅ |
| 01-07-T2 | 07 | SETUP-02 | auto | Both rounds re-sanitized, full fixture gate, Round A byte-identical | `node tests/Tools/m365-spike/validate-fixtures.mjs` | ✅ |
| 01-07-T3 | 07 | SETUP-02 | auto, tdd | PHPUnit fixture replay test (Http::fake over the paged fixtures) | `vendor/bin/phpunit --filter CalendarViewFixturesTest` | ⚠️ not run: no PHP on the host; CI/Sail pending (Node replay is green) |
| 01-08-T1 | 08 | SETUP-03 | auto | Fixture-backed decision document and research corrections | `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace` | ✅ |
| 01-08-T2 | 08 | SETUP-01 | human-action | Admin removes the temporary spike redirect URI and secret | manual (Entra portal) | ⚠️ deferred to Phase 7 by the owner (2026-10-19) |
| 01-08-T3 | 08 | SETUP-01, SETUP-03 | auto | Close the spike: final raw-backed gate, delete raw/, finalize runbook and map, full phase gate | the full suite command above | ✅ |

Requirement → test mapping:

| Requirement | Behavior | Test Type | Automated Command |
|-------------|----------|-----------|-------------------|
| SETUP-01 | Spanish admin guide has all mandatory parts, exact scopes, redirect URIs, hand-back checklist, no secrets | doc-structure | `node tests/Tools/m365-spike/validate-docs.mjs guide` |
| SETUP-01 | Runbook has non-secret registration values, ISO expiry date, reminder ≥30 days before | doc + date arithmetic | `node tests/Tools/m365-spike/validate-docs.mjs runbook` |
| SETUP-01 | No secrets committed repo-wide | scan | `node tests/Tools/m365-spike/validate-docs.mjs secrets` |
| SETUP-01 | Owner (A) and a non-admin, non-assigned colleague (B) authorize without consent prompt and get exactly the six scopes (tenant-wide access) | manual + harness evidence | `capture.mjs auth` / `auth --as B` |
| SETUP-02 | Manifest covers S1–S8, Round A/B, files referenced | schema | `node tests/Tools/m365-spike/validate-fixtures.mjs --schema` |
| SETUP-02 | Scenario predicates hold | semantic | `node tests/Tools/m365-spike/validate-fixtures.mjs --semantic` |
| SETUP-02 | Sanitization leak scan | leak scan | `node tests/Tools/m365-spike/validate-fixtures.mjs --leaks` |
| SETUP-02 | Fixtures replay via `Http::fake` | PHPUnit | `vendor/bin/phpunit --filter CalendarViewFixturesTest` |
| SETUP-03 | Decision doc headings + Evidence pointers + traceability | doc-structure | `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/Tools/m365-spike/.gitignore` (raw/, .env.local) — before any capture code
- [x] `tests/Tools/m365-spike/validate-docs.mjs`, `validate-fixtures.mjs`, sanitizer `*.test.mjs`
- [x] `tests/Unit/M365/CalendarViewFixturesTest.php` (written; execution pending in CI or Sail, see 01-07-T3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Entra app registration created and consented | SETUP-01 | Requires Untangle M365 admin in the Entra admin center | Admin follows the Spanish guide; returns hand-back checklist |
| Test mailbox populated with 8 scenarios (Round A) and mutated (Round B) | SETUP-02 | Requires Outlook actions by humans/second account | Guide Parts 8–9 |
| Conditional Access review | SETUP-01 | Tenant policy evidence | Sign-in log Conditional Access tab |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-10-19 (Node gates green; the PHPUnit replay and the Entra spike cleanup are recorded as pending in the Status column)
