---
phase: "5"
slug: "smart-meeting-suggestions"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-17"
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `05-RESEARCH.md` §Validation Architecture. PHPUnit feature tests and Playwright run only in GitHub CI on this host; Vitest, vue-tsc, tsc, ESLint, Prettier, Pint and PHPStan run locally. The pure-PHP unit tests (tokenizer, signals, scorer) need no database and can run locally with `$PHP_BIN`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PHPUnit 12 (feature tests: CI only; DB-free unit tests in `tests/Unit/Microsoft365`: local) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60 (CI) |
| **Config file** | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run resources/js/m365` · `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365` · `"$PHP_BIN" vendor/bin/pint --test <files>` · `"$PHP_BIN" vendor/bin/phpstan analyse` (full app) |
| **Full suite command** | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check` · CI: PHPUnit (Microsoft365 PASS lines), PHPStan, Pint, Playwright, fork image all green on HEAD |
| **Estimated runtime** | JS ~40 s locally · PHP unit ~10 s locally · PHP CI ~10 min · Playwright up to ~60 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched m365 files>` + `npx prettier --check <files>`; PHP tasks: Pint on the touched files + full-app PHPStan + the local DB-free unit tests
- **After every plan wave:** push, then the CI gate on the merged wave sha: PHPUnit Microsoft365 PASS count ≥ previous + new classes × 3 Postgres jobs, PHPStan, Pint; Playwright on the UI wave
- **Before `/gsd-verify-work`:** all CI workflows green on the release sha
- **Max feedback latency:** JS and PHP unit 60 s; PHP feature and Playwright one CI cycle (~10 min / ~60 min)

---

## Per-Task Verification Map

Task IDs are placeholders until plans are written; each row is keyed by requirement and gets its `5-NN-NN` id, plan and wave when planning assigns them.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-XX-XX | TBD | TBD | RULE-01 | T-05-XX | Converting one occurrence pre-assigns the others (past + future) with project/task/tags/billable; latest conversion wins; entry edit moves the series; other org's links ignored; reassigned entry ignored; archived/invisible project → null; deleted tag dropped; done task dropped; a single meeting is never pre-assigned | PHP feature | CI `--filter OutlookSeriesAssignmentTest` | ❌ W0 | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-01 | T-05-XX | Link stores `series_master_id` at conversion; migration backfill; survives disconnect + reconnect + sync (fixture replay) | PHP feature | CI `--filter OutlookMeetingLinkLifecycleTest` | ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-01 | — | Form prefill order (assignment > confident > last used); billable not overwritten; reason line | Vitest | `npx vitest run resources/js/m365/calendar/suggestions.test.ts resources/js/m365/calendar/OutlookConvertForm.test.ts` | ❌ W0 / ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-02 | T-05-XX | `use_series_assignment`: per-meeting server resolution; prohibited fields → 422; `no_assignment` failure; mixed batch (2 series + 1 single); idempotent `existing`; impersonation 404; entry created via core (overlap rule applies) | PHP feature | CI `--filter OutlookMeetingConversionTest` | ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-02 | T-05-XX | One-click confirm from hover/panel/menu; bulk confirm only rendered pre-assigned meetings, in chunks of 50, with results and retry | Vitest + Playwright (CI) | `npx vitest run resources/js/m365`; CI `e2e/outlook-suggestions.spec.ts` | ❌ W0 | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-03 | T-05-XX | Tokenizer ES/EN (accents, stop words, digits); signals hashing (own address excluded, internal vs external, resources skipped, broadcast guard); scorer matrix (organizer > domain > subject; IDF cap; decay; confidence rules; top 3; reason kind/count) | PHP unit (local, no DB) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/SubjectTokenizerTest.php tests/Unit/Microsoft365/MeetingSignalsTest.php tests/Unit/Microsoft365/ProjectSuggestionEngineTest.php` | ❌ W0 | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-03 | T-05-XX | Read returns suggestions only from the session user's links in the current org; other users never influence ranking; archived projects excluded; impersonation empty; no attendee/address/score in JSON; no `@` in stored link signals | PHP feature | CI `--filter OutlookMeetingSuggestionTest`, `--filter OutlookMeetingPrivacyTest` | ❌ W0 / ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-03 | T-05-XX | Sync stores attendees/organizer_address from `experiment-select` fixture pages; scrub nulls them; Disconnect deletes them; `SELECT` contains `attendees` | PHP feature + unit | CI `--filter OutlookMeetingSyncTest`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/GraphCalendarClientTest.php` | ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-04 | T-05-XX | Ignore/unignore: 404 for foreign/unknown/gone/non-recurring; read hides; `include_dismissed` returns `dismissed+series_ignored`; impersonation 404; route count 8 | PHP feature | CI `--filter OutlookSeriesSettingsTest`, `--filter OutlookMeetingPrivacyTest` | ❌ W0 / ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-04 | — | Menu/panel ignore items only for recurring meetings with canAct; undo in show-dismissed | Vitest + Playwright (CI) | `npx vitest run resources/js/m365/calendar/OutlookMeetingContextItems.test.ts resources/js/m365/calendar/OutlookGhostDetail.test.ts` | ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | RULE-05 | T-05-XX | Forget → null until the next conversion; forgotten links excluded from scoring of that series; reasons render en/es; lang parity | PHP feature + Vitest + unit | CI `--filter OutlookSeriesSettingsTest`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php` | ❌ W0 / ✅ extend | ⬜ pending |
| 5-XX-XX | TBD | TBD | D-12 (RULE-05) | T-05-XX | No new endpoint modifies or deletes time entries (snapshot before/after ignore, forget, read) | PHP feature | CI `--filter OutlookMeetingPrivacyTest` (reuse `timeEntrySnapshot()`) | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**E2E note:** CI runs with the integration off. Meetings with `assignment`/`suggestions` are injected through the test hook; `page.route()` fulfils the convert and series URLs, and real entries are created through the core API like 04-08. Server behaviour stays covered by PHPUnit.

---

## Wave 0 Requirements

Each Wave 0 file is created by the task that first needs it (no separate stub wave):

- [ ] `tests/Unit/Microsoft365/SubjectTokenizerTest.php`, `MeetingSignalsTest.php`, `ProjectSuggestionEngineTest.php` — RULE-03 (pure, local)
- [ ] `tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php` — RULE-01
- [ ] `tests/Feature/Microsoft365/OutlookMeetingSuggestionTest.php` — RULE-03
- [ ] `tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php` — RULE-04/05
- [ ] Shared helper for links with signals (extend the inline `meeting()` helper pattern or move it to `Support/`)
- [ ] `resources/js/m365/calendar/suggestions.test.ts` — RULE-01
- [ ] `e2e/outlook-suggestions.spec.ts` — RULE-02/04 (injected meetings with `assignment`/`suggestions`, `page.route` for convert and series URLs, real entries via core API like 04-08)
- [ ] Update hard-coded counts: labels 84 → new total (3 places), routes 5 → 8
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-assignment and one-click confirm on real recurring Outlook series in production | RULE-01, RULE-02 | Real Graph series data and the owner's projects | Owner UAT after deploy: convert one occurrence, check the others pre-assign, confirm one |
| Suggestion quality (organizer, domain, subject words) on real meeting history | RULE-03 | Scoring weights and thresholds are tunable design judgement (LOW confidence) | Owner reviews suggestions on real meetings; tune weights if needed |
| Ignore/undo series and "forget" on real recurring meetings; existing entries untouched | RULE-04, RULE-05 | Real data and visual confirmation | Owner UAT after deploy |
| Series behaviour after "this and following" edits | RULE-01 | Graph split behaviour is only community-observed (MEDIUM), not fixture-backed | Edit a real series with "this and following"; check pre-assignment on the new master |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (JS / PHP unit) / one CI cycle (PHP feature, Playwright)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
