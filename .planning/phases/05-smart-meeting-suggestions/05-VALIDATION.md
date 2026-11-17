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

Task IDs are `5-<plan>-<task>` from the 05-NN-PLAN.md files (planned 2026-11-17). PHP feature rows run in CI only (orchestrator wave gate); every task also has a local gate (Gate P / Gate U / Gate F) in its plan.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01, 5-01-02 | 05-01 | 1 | RULE-01 | T-05-01, T-05-03 | Converting one occurrence pre-assigns the others (past + future) with project/task/tags/billable; latest conversion wins; entry edit moves the series; other org's links ignored; reassigned entry ignored; archived/invisible project → null; deleted tag dropped; done task dropped; a single meeting is never pre-assigned; opaque series_key, no Graph id in JSON | PHP feature | CI `--filter OutlookSeriesAssignmentTest` | ❌ W0 (created by 5-01-01) | ⬜ pending |
| 5-01-03 | 05-01 | 1 | RULE-01 | T-05-05 | Link stores `series_master_id` at conversion; migration backfill; survives disconnect + reconnect + sync (fixture replay); read query count constant | PHP feature | CI `--filter OutlookSeriesAssignmentTest` | ❌ W0 (5-01-01) | ⬜ pending |
| 5-04-02, 5-08-01, 5-08-02, 5-08-03 | 05-04, 05-08 | 1, 2 | RULE-01, RULE-03 | T-05-28 | Form prefill order (assignment > confident > last used); billable not overwritten; reason line; quick picks; series notes; batch prefill; prefill_source/prefill_project_id sent (D-16) | Vitest | `npx vitest run resources/js/m365/calendar/suggestions.test.ts resources/js/m365/calendar/OutlookConvertForm.test.ts resources/js/m365/calendar/OutlookSuggestionPicks.test.ts` | ❌ W0 (5-04-02, 5-08-02) / ✅ extend | ⬜ pending |
| 5-05-01, 5-05-03 | 05-05 | 2 | RULE-02 | T-05-15, T-05-16, T-05-17 | `use_series_assignment`: per-meeting server resolution; prohibited fields → 422; `no_assignment` failure; mixed batch (2 series + 1 single); idempotent `existing`; impersonation 404; entry created via core (overlap rule applies); archived after read → no_assignment | PHP feature | CI `--filter OutlookMeetingConversionTest` | ✅ extend | ⬜ pending |
| 5-05-02 | 05-05 | 2 | RULE-03 (D-16) | T-05-18 | Every new link stores keyed-hash signals (no `@`, domain or subject word in the stored JSON); prefill_source / prefill_kept recorded | PHP feature | CI `--filter OutlookMeetingConversionTest` | ✅ extend | ⬜ pending |
| 5-07-01, 5-10-01, 5-11-01, 5-11-02, 5-12-01 | 05-07, 05-10, 05-11, 05-12 | 2, 3 | RULE-02 | T-05-26, T-05-37, T-05-38 | One-click confirm from hover/panel/menu; bulk confirm only rendered pre-assigned meetings, in chunks of 50, with results and retry; nothing without canAct | Vitest | `npx vitest run resources/js/m365` | ❌ W0 (OutlookConfirmAll.test.ts by 5-11-01) / ✅ extend | ⬜ pending |
| 5-13-01, 5-13-02 | 05-13 | 4 | RULE-01, RULE-02, RULE-03 | T-05-41 | Browser: hover Confirm creates a real entry; bulk confirm skips unticked, hidden-weekend and suggestion-only meetings; prefilled form with reason and quick pick | Playwright (CI) | CI `e2e/outlook-suggestions.spec.ts`; local `npx playwright test e2e/outlook-suggestions.spec.ts --list --project=chromium` | ❌ W0 (created by 5-13-01) | ⬜ pending |
| 5-02-01, 5-02-02, 5-02-03 | 05-02 | 1 | RULE-03 | T-05-06, T-05-07, T-05-08 | Tokenizer ES/EN (accents, stop words, digits); signals hashing (own address excluded, internal vs external, resources skipped, broadcast guard); scorer matrix (organizer > domain > subject; IDF cap; decay; confidence rules; top 3; reason kind/count; forgotten series) | PHP unit (local, no DB) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/SubjectTokenizerTest.php tests/Unit/Microsoft365/MeetingSignalsTest.php tests/Unit/Microsoft365/ProjectSuggestionEngineTest.php` | ❌ W0 (created by 5-02-01, 5-02-02) | ⬜ pending |
| 5-09-01, 5-09-02 | 05-09 | 3 | RULE-03 | T-05-30, T-05-31, T-05-32, T-05-33, T-05-34 | Read returns suggestions only from the session user's links in the current org; other users never influence ranking; archived/unbookable projects excluded; impersonation empty; no attendee/address/score in JSON; constant query count; history bounded | PHP feature | CI `--filter OutlookMeetingSuggestionTest` | ❌ W0 (created by 5-09-01) | ⬜ pending |
| 5-03-01, 5-03-02, 5-03-03 | 05-03 | 1 | RULE-03 | T-05-09, T-05-10, T-05-11 | Sync stores attendees/organizer_address from `experiment-select` fixture pages; scrub nulls them; Disconnect deletes them; read never serves them; `SELECT` contains `attendees` (no body, no lastModifiedDateTime); DECISIONS-graph.md updated | PHP feature + unit + docs | CI `--filter OutlookMeetingSyncTest`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/GraphCalendarClientTest.php`; `node tests/Tools/m365-spike/validate-docs.mjs decisions` | ✅ extend | ⬜ pending |
| 5-06-01, 5-06-02, 5-06-03 | 05-06 | 2 | RULE-04 | T-05-20, T-05-21, T-05-22, T-05-24 | Ignore/unignore: 404 for foreign/unknown/gone/non-recurring; read hides; `include_dismissed` returns `series_ignored` (own dismissed flag kept); impersonation 404; route count 8; settings survive Disconnect, cascade with the user; converting an ignored occurrence keeps it ignored (D-18) | PHP feature | CI `--filter OutlookSeriesSettingsTest`, `--filter OutlookMeetingPrivacyTest` | ❌ W0 (created by 5-06-01) / ✅ extend | ⬜ pending |
| 5-07-03, 5-10-02, 5-10-03, 5-12-02, 5-13-03 | 05-07, 05-10, 05-12, 05-13 | 2, 3, 4 | RULE-04 | T-05-27, T-05-36, T-05-39 | Ignore/stop ignoring/forget optimistic over every occurrence with revert; menu/panel items only for recurring meetings with canAct; undo in show-dismissed; faded "Series ignored" variant | Vitest + Playwright (CI) | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts resources/js/m365/calendar/OutlookMeetingContextItems.test.ts resources/js/m365/calendar/OutlookGhostDetail.test.ts resources/js/m365/calendar/OutlookGhostLayer.test.ts` | ✅ extend | ⬜ pending |
| 5-06-02, 5-09-03, 5-04-01 | 05-06, 05-09, 05-04 | 2, 3, 1 | RULE-05 | T-05-13, T-05-23 | Forget → null until the next conversion; confirm after forget → no_assignment; forgotten links excluded from scoring of that series; reasons render en/es (130 labels); lang parity | PHP feature + Vitest + unit | CI `--filter OutlookSeriesSettingsTest`, `--filter OutlookMeetingSuggestionTest`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php`; `npx vitest run resources/js/m365/calendar/suggestionReason.test.ts` | ❌ W0 / ✅ extend | ⬜ pending |
| 5-06-03, 5-09-02 | 05-06, 05-09 | 2, 3 | D-12 (RULE-05) | T-05-23, T-05-04 | No new endpoint or read modifies or deletes time entries (snapshot before/after ignore, unignore, forget, read) | PHP feature | CI `--filter OutlookMeetingPrivacyTest`, `--filter OutlookMeetingSuggestionTest` (reuse `timeEntrySnapshot()`) | ✅ extend | ⬜ pending |
| 5-10-03 | 05-10 | 3 | RULE-01 (UI-SPEC backstop) | — | Project-dot ring ≥ 3:1 on meeting fill, hover fill and popover for every preset × mode | Vitest | `npx vitest run resources/js/branding/contrast.test.ts` | ✅ extend | ⬜ pending |
| 5-14-01, 5-14-02, 5-15-01, 5-15-02 | 05-14, 05-15 | 5, 6 | RULE-01..05 | T-05-42, T-05-43, T-05-44, T-05-45 | Release sha green in all ten workflows (≥ 102 Microsoft365 PASS lines); ledger reconciled; compose pinned; public checks after the orchestrator's deploy (D-15) | CI + public HTTP | ten-workflow gate on R; `curl` checks of 05-15 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**E2E note:** CI runs with the integration off. Meetings with `assignment`/`suggestions` are injected through the test hook; `page.route()` fulfils the convert and series URLs, and real entries are created through the core API like 04-08. Server behaviour stays covered by PHPUnit.

---

## Wave 0 Requirements

Each Wave 0 file is created by the task that first needs it (no separate stub wave):

- [ ] `tests/Unit/Microsoft365/SubjectTokenizerTest.php`, `MeetingSignalsTest.php`, `ProjectSuggestionEngineTest.php` — RULE-03 (pure, local) — 05-02 Tasks 1-2
- [ ] `tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php` — RULE-01, incl. backfill and disconnect/re-sync (moved here from OutlookMeetingLinkLifecycleTest so 05-01 stays within 12 files) — 05-01 Task 1
- [ ] `tests/Feature/Microsoft365/OutlookMeetingSuggestionTest.php` — RULE-03 — 05-09 Task 1
- [ ] `tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php` — RULE-04/05 — 05-06 Task 1
- [ ] Links with signals in feature tests: conversions go through the real convert endpoint (05-05 captures signals), meeting rows get attendees through the copied inline `meeting()` helper overrides (no shared Support change)
- [ ] `resources/js/m365/calendar/suggestions.test.ts`, `suggestionReason.test.ts` — RULE-01/03/05 — 05-04 Tasks 1-2
- [ ] `resources/js/m365/calendar/OutlookPreassignment.test.ts` (05-07), `OutlookProjectDot.test.ts` (05-04), `OutlookSuggestionPicks.test.ts` (05-08), `OutlookConfirmAll.test.ts` (05-11)
- [ ] `e2e/outlook-suggestions.spec.ts` — RULE-01..05 (injected meetings with `assignment`/`suggestions`, test-hook `seriesUrl`, `page.route` for convert and series URLs, real entries via core API like 04-08) — 05-13 Task 1
- [ ] Update hard-coded counts: labels 84 → 130 (3 places, 05-04), routes 5 → 8 (05-06), resource keys 9 → 13 (OutlookMeetingEndpointTest, 05-01), calendarView `$select` URL (OutlookMeetingSyncTest, 05-03), GhostDetail `w-80` expectation (05-10)
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
