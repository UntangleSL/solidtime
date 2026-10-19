---
phase: "1"
slug: "tenant-setup-outlook-spike"
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Quick run command** | `node --test tests/Tools/m365-spike/` |
| **Full suite command** | `node tests/Tools/m365-spike/validate-docs.mjs all && node tests/Tools/m365-spike/validate-fixtures.mjs && npm run format:check` (+ `vendor/bin/phpunit --filter CalendarViewFixturesTest` where PHP exists) |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** `node --test tests/Tools/m365-spike/` + the validator subcommand for the touched artifact
- **After every plan wave:** full suite command
- **Before `/gsd-verify-work`:** full suite green + human-verify checkpoints signed off
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

To be filled by the planner/executor per task. Requirement → test mapping:

| Requirement | Behavior | Test Type | Automated Command |
|-------------|----------|-----------|-------------------|
| SETUP-01 | Spanish admin guide has all mandatory parts, exact scopes, redirect URIs, hand-back checklist, no secrets | doc-structure | `node tests/Tools/m365-spike/validate-docs.mjs guide` |
| SETUP-01 | Runbook has non-secret registration values, ISO expiry date, reminder ≥30 days before | doc + date arithmetic | `node tests/Tools/m365-spike/validate-docs.mjs runbook` |
| SETUP-01 | No secrets committed repo-wide | scan | `node tests/Tools/m365-spike/validate-docs.mjs secrets` |
| SETUP-01 | Assigned user authorizes without consent prompt; outsider blocked (AADSTS50105) | manual + harness evidence | `capture.mjs auth` / `auth --expect-blocked` |
| SETUP-02 | Manifest covers S1–S8, Round A/B, files referenced | schema | `node tests/Tools/m365-spike/validate-fixtures.mjs --schema` |
| SETUP-02 | Scenario predicates hold | semantic | `node tests/Tools/m365-spike/validate-fixtures.mjs --semantic` |
| SETUP-02 | Sanitization leak scan | leak scan | `node tests/Tools/m365-spike/validate-fixtures.mjs --leaks` |
| SETUP-02 | Fixtures replay via `Http::fake` | PHPUnit | `vendor/bin/phpunit --filter CalendarViewFixturesTest` |
| SETUP-03 | Decision doc headings + Evidence pointers + traceability | doc-structure | `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/Tools/m365-spike/.gitignore` (raw/, .env.local) — before any capture code
- [ ] `tests/Tools/m365-spike/validate-docs.mjs`, `validate-fixtures.mjs`, sanitizer `*.test.mjs`
- [ ] `tests/Unit/M365/CalendarViewFixturesTest.php`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Entra app registration created and consented | SETUP-01 | Requires Untangle M365 admin in the Entra admin center | Admin follows the Spanish guide; returns hand-back checklist |
| Test mailbox populated with 8 scenarios (Round A) and mutated (Round B) | SETUP-02 | Requires Outlook actions by humans/second account | Guide Parts 8–9 |
| Conditional Access review | SETUP-01 | Tenant policy evidence | Sign-in log Conditional Access tab |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
