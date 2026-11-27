---
phase: 07-hardening-release
verified: 2026-11-27T14:22:30Z
status: human_needed
score: 31/32 must-haves verified
covered_files: [".planning/phases/07-hardening-release/07-01-PLAN.md", ".planning/phases/07-hardening-release/07-01-SUMMARY.md", ".planning/phases/07-hardening-release/07-02-PLAN.md", ".planning/phases/07-hardening-release/07-02-SUMMARY.md", ".planning/phases/07-hardening-release/07-03-PLAN.md", ".planning/phases/07-hardening-release/07-03-SUMMARY.md", ".planning/phases/07-hardening-release/07-04-PLAN.md", ".planning/phases/07-hardening-release/07-04-SUMMARY.md", ".planning/phases/07-hardening-release/07-05-PLAN.md", ".planning/phases/07-hardening-release/07-05-SUMMARY.md", ".planning/phases/07-hardening-release/07-06-PLAN.md", ".planning/phases/07-hardening-release/07-06-SUMMARY.md", ".planning/phases/07-hardening-release/07-07-PLAN.md", ".planning/phases/07-hardening-release/07-07-SUMMARY.md", "app/Microsoft365/Graph/OutlookMeetingSyncService.php", "app/Microsoft365/Http/Controllers/MicrosoftAuthController.php", "app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php", "app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php", "app/Microsoft365/routes/microsoft365.php", "composer.json", "composer.lock", "docs/deploy/MICROSOFT-SIGNIN.md", "docs/deploy/dokploy-compose.fork.yml", "docs/m365/GUIA-ADMIN-ENTRA.md", "docs/m365/RUNBOOK-entra-app.md", "docs/m365/TOUCHED-CORE-FILES.md", "docs/m365/UPSTREAM-MERGE.md", "e2e/outlook-off-switch.spec.ts", "resources/js/Pages/Auth/Login.vue", "resources/js/Pages/Profile/Show.vue", "tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php", "tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php", "tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php", "tests/Tools/m365-merge/ledger-check.sh", "tests/Unit/Microsoft365/ForkIsolationTest.php"]
covered_digest: "v3:sha256:979a13d8c978b9ed6bb604f100b4dbb67a830260ae2f644767857d9e1a140d5e"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "After the Entra spike cleanup, sign in at https://time.untangle.es with Microsoft, open the calendar and press Sync"
    expected: "Sign-in completes, Outlook meetings appear as before, Sync answers without an error (07-07 truth 2, D-06)"
    why_human: "Needs a real Microsoft account and mailbox; the verifier only confirmed that production still starts the authorize request with the production redirect URI"
  - test: "As admin, impersonate a team member from /admin, open their calendar and profile, then use 'Exit impersonation' in the user menu"
    expected: "Their time entries show; no Outlook lane, no Sync or Connect, no Microsoft 365 card; exit returns to the admin (D-07)"
    why_human: "Real Filament impersonation flow in the browser; the server side is proven by MicrosoftImpersonationMatrixTest"
  - test: "Drag a time entry in the calendar to another hour"
    expected: "It lands exactly where it was dropped (upstream fix for the start-hour offset brought by the merge)"
    why_human: "Real pointer interaction in the owner's browser and time zone"
  - test: "Sign in to the browser extension or desktop app through 'Sign in with Microsoft'"
    expected: "The extension's authorization screen appears after Microsoft and the extension connects"
    why_human: "OAuth return path through upstream's reworked login redirect (RESEARCH Pitfall 8)"
  - test: "Open the profile of a person who signs in only with Microsoft"
    expected: "Password and two-factor sections are replaced by upstream's 'managed by your identity provider' card; the Microsoft 365 card is still there"
    why_human: "Upstream behaviour change for passwordless users; visual check"
  - test: "In the Dokploy scheduler container terminal run: php artisan schedule:list"
    expected: "m365:check-out-of-sync is listed daily at 05:30 Europe/Madrid"
    why_human: "No container shell or log access from the verifier"
  - test: "In the Dokploy app container terminal run: php artisan migrate:status | grep -E '2026_11_03_000001|2026_11_05_000001_delete_orphaned_oauth_refresh_tokens|2026_11_18_000001'"
    expected: "The three upstream migrations show Ran"
    why_human: "compose-readLogs unavailable; only the healthy app is evidence that AUTO_DB_MIGRATE succeeded"
---

# Phase 7: Hardening & Release Verification Report

**Phase Goal:** As a fork maintainer, I want to ship the integration with complete data cleanup, impersonation safety, a clean off switch and a rehearsed upstream merge, so that the whole Untangle team can rely on it and the fork keeps taking solidtime updates.
**Verified:** 2026-11-27T14:22:30Z
**Status:** human_needed
**Re-verification:** No (initial verification)

## User Flow Coverage (MVP mode)

| Step | Expected | Evidence | Status |
| ---- | -------- | -------- | ------ |
| Ship with complete data cleanup | No Microsoft data survives a deleted user; org deletion removes org links | FK cascades in all 5 fork tables; `MicrosoftDataCleanupTest` (7 cases) PASS in CI run 45992017863 | VERIFIED |
| Impersonation safety | Admin acting as a user gets nothing Outlook-related, no Graph call | `GraphAccessGuard` at token service, sync service, every controller, Inertia share; 14-route matrix + canary PASS | VERIFIED |
| Clean off switch | No Microsoft surface, every core feature works | `EnsureMicrosoftIsEnabled` on all routes, prop `{enabled:false}`, scheduler `when()` filter; `MicrosoftOffSwitchTest` + `outlook-off-switch.spec.ts` green | VERIFIED |
| Rehearsed upstream merge | Merge conflicts only in ledgered files; fork keeps taking updates | Two-parent merge adcd05cb with upstream d0f5e745; re-run `merge-tree` shows only the 4 ledgered files; `ledger-check.sh` OK against d0f5e745 and current upstream/main | VERIFIED |
| Team can rely on it (released) | Production runs the release | Image sha-0ebd0f6 deployed; health 200, login carries `microsoft.enabled:true`, `/m365/meetings` 401 unauthenticated, bundle has "Exit impersonation" and Outlook markers | VERIFIED (owner UAT pending) |

## Goal Achievement

### Observable Truths: Roadmap Success Criteria

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| SC1 | Deleting a user or an organization leaves none of their Microsoft identity, tokens, cached meetings, meeting links or rules behind | VERIFIED | All 5 fork tables have `user_id` FK `cascadeOnDelete` (fork migrations); `outlook_meeting_links.time_entry_id` cascades to time_entries; `MicrosoftDataCleanupTest` deletion matrix, schema guard (pg_constraint vs Schema::create) and disconnect-during-sync PASS in CI on HEAD. Org deletion removes the org's links and keeps user-owned rows, per D-09 |
| SC2 | An admin impersonating a user cannot see that user's meetings or trigger any Graph call with that user's token | VERIFIED | `GraphAccessGuard::blocked()` (fail-closed) checked in `MicrosoftTokenService::accessToken` (single Graph choke point), `OutlookMeetingSyncService::sync`, all 6 fork controllers, `EnsureNotImpersonating` on DELETE /user/microsoft, Inertia share skips account/calendar; matrix test over all 14 routes asserts 404/empty/not_connected, `Http::assertNothingSent()`, unchanged rows; route canary PASS |
| SC3 | With M365 env vars unset: no sign-in button, suggestions, Sync or rules management, and core works as upstream | VERIFIED | `EnsureMicrosoftIsEnabled` on every fork route group; shared prop exactly `{enabled:false}`; `MicrosoftSignInButton`/`MicrosoftConnectionForm`/`useOutlookMeetings` render only on `enabled`; schedule `->when(isConfigured)`; `MicrosoftOffSwitchTest` (4) PASS; Playwright off-switch spec ran green with no skip; core PHPUnit and Playwright suites run unconfigured and green |
| SC4 | Fork code in its own module with documented touched-core list; rehearsed merge conflicts only within it | VERIFIED | `app/Microsoft365/` module; `docs/m365/TOUCHED-CORE-FILES.md`; merge commit adcd05cb parents 6d1fa37a + d0f5e745; `git merge-tree` of those parents conflicts only in composer.json, composer.lock, Login.vue, Show.vue (all ledgered); `ledger-check.sh` prints `OK (modified 40, added 580, conflicts 0)` against d0f5e745 and upstream/main ec74a1d8; ledger with Login.vue row removed exits 1 naming it |
| SC5 | Entra spike cleanup (URI and secret spike-2026-10 removed); guide lines RETIRADO; runbook updated | VERIFIED | Owner confirmed 3 URIs + 1 secret on 2026-11-27; commit 18bb7fe1 marks 6 guide lines `RETIRADO 2026-11-27`, runbook rows/4 cleanup items/Historial updated; validators pass (established). Production still starts authorize with the production redirect URI (curl). Post-cleanup sign-in + Sync is a human item |

### Observable Truths: Plan must-haves (beyond the roadmap SCs)

| Plan | Truth (short) | Status | Evidence |
| ---- | ------------- | ------ | -------- |
| 07-01 | Real two-parent merge of d0f5e745; conflicts only in 4 ledgered files | VERIFIED | `git show adcd05cb` parents; merge-tree re-run |
| 07-01 | Fork seams survive the merge | VERIFIED | Login.vue: import l.9, `canRegister` default false + `v-if` l.56, button l.122 right after `alternatives` slot l.121; Show.vue: card l.86 right before LogoutOtherBrowserSessionsForm l.88; composer.lock passport v13.10.0, socialite v5.33.0, oauth1-client, socialiteproviders/manager + microsoft |
| 07-01 | ledger-check OK and negative case exits 1 | VERIFIED | Run by verifier (see Spot-checks) |
| 07-01 | UPSTREAM-MERGE.md is a repeatable procedure | VERIFIED | Sections 1-9: preview, merge, conflicts, lock, checks (`-R UntangleSL/solidtime`), image, release (D-02 summary, D-03 backup), rollback (sha-d379903 + backup), history |
| 07-02 | Disconnect / Connect start / callback 404 while impersonating, nothing changes | VERIFIED | 3 dedicated tests PASS in CI |
| 07-02 | Profile has no `microsoft.account`, calendar no `microsoft.calendar` while impersonating | VERIFIED | `ShareMicrosoftInertiaData` l.55/64; 2 tests PASS |
| 07-02 | Every fork route in matrix; canary fails on a missing route | VERIFIED | `MATRIX` 14 rows; canary asserts equality with routes served by `App\Microsoft365\Http\Controllers` |
| 07-02 | Fork jobs dispatched only from fork console; ledger paths exist | VERIFIED | `ForkIsolationTest` 2 tests PASS; only job `CheckOutOfSyncForUser` |
| 07-02 | Non-impersonated flows unchanged | VERIFIED | Full Microsoft365 suite green (196 PASS lines) |
| 07-03 | DeletionService::deleteUser leaves no row in 5 tables, other user survives | VERIFIED | Test PASS |
| 07-03 | Schema guard derived from migration directory | VERIFIED | `test_every_fork_table_cascades_from_users` PASS |
| 07-03 | Placeholder member / remove member / delete org semantics | VERIFIED | 3 tests PASS |
| 07-03 | Disconnect during sync leaves no cached meeting or window | VERIFIED | `OutlookMeetingSyncService` l.109-122 locks account row post-traverse and purges; data-provider test (pages 2 and 22) PASS |
| 07-03 | No fork code deletes or changes a time entry for cleanup | VERIFIED | No DeletionService/listener hooks in app/Microsoft365 (grep empty); cleanup via cascades only |
| 07-04 | Calendar unconfigured: entries render, no Outlook element, no fork request | VERIFIED | Spec checks 6 test ids that do exist in fork components (not vacuous) and records requests; Playwright green |
| 07-04 | Any key unset: microsoft.* 404 guest + user; prop `{enabled:false}`; job filtered; command prints `configured: no` | VERIFIED | `MicrosoftOffSwitchTest` PASS; per-key blanks covered by `MicrosoftConfig::missingKeys` + `MicrosoftConfigTest` |
| 07-04 | Switching off deletes nothing; on again restores | VERIFIED | Test PASS |
| 07-04 | Core suites green unconfigured | VERIFIED | CI on HEAD green |
| 07-05 | ledger-check OK on full tree; Phase 7 section + Reconciliation (07-05) | VERIFIED | Ledger l.360-437 |
| 07-05 | MICROSOFT-SIGNIN.md describes hardened behaviour; pending-for-Phase-7 block gone | VERIFIED | Sections "Borrar personas u organizaciones", "Contenedores scheduler y queue", "Apagar la integración"; no "pendiente ... Fase 7" match |
| 07-05 | Scheduler/queue healthcheck runs image `healthcheck` | VERIFIED | compose l.145-149, l.210-214; no docker/ change since merge |
| 07-05 | Spanish owner summary + commit list (D-02) | VERIFIED | Owner-attested in 07-06 resume signal; `release-07-commits.txt` present |
| 07-06 | Compose pins sha-0ebd0f6 built from a green commit | VERIFIED | 3 image lines; HEAD differs from 0ebd0f6f only in docs/planning |
| 07-06 | Backup before deploy, summary first, Environment tab untouched | VERIFIED (owner-attested) | Resume signal: `pre-fase7-2026-11-27.dump` 135735 bytes |
| 07-06 | Production runs the release | VERIFIED | Verifier curl: health 200, login `"microsoft":{"enabled":true`, `/m365/meetings` 401, bundle contains "Exit impersonation", `outlook-lane`, `outlook-sync-button`, `outlook-out-of-sync` |
| 07-06 | Scheduler/queue healthy; runbook + merge history record release and rollback | VERIFIED | 5 containers healthy (established); runbook Historial "Fase 7"; UPSTREAM-MERGE history row sha-0ebd0f6 |
| 07-07 | Microsoft sign-in and Sync work after the Entra change | UNCERTAIN | Authorize request still uses production redirect URI; full sign-in + Sync not re-run (human item 1) |

**Score:** 31/32 truths verified (0 present, behavior-unverified; 1 uncertain, routed to human verification)

### Required Artifacts

| Artifact | Status | Details |
| -------- | ------ | ------- |
| `docs/m365/UPSTREAM-MERGE.md` | VERIFIED | 207 lines, references ledger-check.sh |
| `tests/Tools/m365-merge/ledger-check.sh` | VERIFIED | Runs; OK/FAILED paths both exercised |
| `docs/m365/TOUCHED-CORE-FILES.md` | VERIFIED | "Upstream merge (07-01)", "Reconciliation (07-05)" |
| `app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php` | VERIFIED | Wired as last middleware of DELETE /user/microsoft |
| `tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` | VERIFIED | 7 tests PASS |
| `tests/Unit/Microsoft365/ForkIsolationTest.php` | VERIFIED | 2 tests PASS |
| `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` | VERIFIED | 7 cases PASS |
| `app/Microsoft365/Graph/OutlookMeetingSyncService.php` | VERIFIED | Post-traverse `lockForUpdate` purge |
| `e2e/outlook-off-switch.spec.ts` | VERIFIED | Green in Playwright run 45992017740 |
| `tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` | VERIFIED | 4 tests PASS |
| `docs/deploy/dokploy-compose.fork.yml` | VERIFIED | sha-0ebd0f6, Phase 7 header, healthchecks |
| `docs/deploy/MICROSOFT-SIGNIN.md` | VERIFIED | "## Borrar personas u organizaciones" |
| `docs/m365/RUNBOOK-entra-app.md` | VERIFIED | "Fase 7:", "Limpieza en Entra", RETIRADO rows |
| `docs/m365/GUIA-ADMIN-ENTRA.md` | VERIFIED | 6 lines RETIRADO 2026-11-27 |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| ledger-check.sh | TOUCHED-CORE-FILES.md | backticked tokens | WIRED |
| Login.vue | MicrosoftSignInButton.vue | import + element after alternatives slot | WIRED |
| microsoft365.php routes | EnsureNotImpersonating | last middleware of DELETE group | WIRED |
| MicrosoftAuthController | GraphAccessGuard | `access->blocked()` in redirect (connect) and callback | WIRED |
| ShareMicrosoftInertiaData | GraphAccessGuard | `routeIs('profile.show') && ! $this->access->blocked()` | WIRED |
| MicrosoftDataCleanupTest | fork migrations | `Schema::create` scan vs pg_constraint | WIRED |
| OutlookMeetingSyncService | MicrosoftAccountController | both lock the account row | WIRED |
| MicrosoftOffSwitchTest | EnsureMicrosoftIsEnabled | sweep of all `microsoft.*` routes | WIRED |
| outlook-off-switch.spec.ts | useOutlookMeetings.ts | no calendar prop -> no query -> no `/m365/` request | WIRED |
| dokploy-compose.fork.yml | image healthcheck script | `[CMD, healthcheck]` | WIRED |
| RUNBOOK-entra-app.md | UPSTREAM-MERGE.md | Historial row points to rollback | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Original merge conflict set | `git merge-tree --write-tree --name-only 6d1fa37a d0f5e745` | composer.json, composer.lock, Login.vue, Show.vue | PASS |
| Ledger complete vs merged upstream | `UPSTREAM_REF=d0f5e745 sh tests/Tools/m365-merge/ledger-check.sh` | `ledger-check: OK (modified 40, added 580, conflicts 0)` | PASS |
| Ledger vs current upstream/main (ec74a1d8, 1 commit newer) | `sh tests/Tools/m365-merge/ledger-check.sh` | OK, conflicts 0 | PASS |
| Ledger negative case | ledger copy without Login.vue row | `NOT IN LEDGER: resources/js/Pages/Auth/Login.vue`, exit 1 | PASS |
| Phase 7 PHPUnit tests on HEAD | `gh run view 45992017863 --log` | All tests of the 4 Phase 7 classes PASS | PASS |
| Off-switch e2e on HEAD | `gh run view 45992017740 --log` | 8 shards passed, 0 failed (spec has no skip) | PASS |
| Production public checks | curl health, /login, /m365/meetings, /auth/microsoft/redirect, built JS | 200, enabled:true, 401, 302 with production redirect_uri, markers present | PASS |

### Probe Execution

Not applicable: Phase 7 declares no `scripts/*/tests/probe-*.sh` probes. `ledger-check.sh` was run as a spot-check above.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| SEC-03 | 07-03, 07-05 | SATISFIED | SC1 |
| SEC-04 | 07-02, 07-05 | SATISFIED | SC2 |
| OPS-02 | 07-04, 07-05 | SATISFIED | SC3 |
| OPS-03 | 07-01, 07-02, 07-05 | SATISFIED | SC4 |

No orphaned requirements. REQUIREMENTS.md still shows these four as `[ ]` / Pending; the orchestrator should tick them when closing the phase.

### Prohibitions

| Plan | Prohibition | Tier | Result |
| ---- | ----------- | ---- | ------ |
| 07-01 | No squash/rebase/amend of the merge; no extra upstream edits | judgment | Upheld: two-parent merge commit; only the 4 conflicted files resolved |
| 07-02 | Every guard calls `GraphAccessGuard::blocked()` | judgment | Upheld: no other `ImpersonateManager`/`isImpersonating` use in app/Microsoft365 |
| 07-02 | No impersonation middleware on `/auth/microsoft` group | grep | Upheld |
| 07-03 | No DeletionService hooks or deletion listeners | grep | Upheld (grep empty) |
| 07-04 | No `__TEST_SET_OUTLOOK_MEETINGS__` in off-switch spec | grep | Upheld (0 matches) |
| 07-05 | No core Docker file edits | grep | Upheld (`git diff adcd05cb HEAD -- docker/` empty) |
| 07-05 | No GUIDs/emails/secrets added to docs | grep | Upheld for Phase 7 changes; the tenant/client IDs in the runbook (01-05) and the instance client id in MICROSOFT-SIGNIN.md (Phase 2) predate this phase and are public identifiers |
| 07-06 | No deploy before backup; no Environment tab edit | judgment | Owner-attested in the resume signal |
| 07-07 | No production secret/URI change | judgment | Owner-attested; curl confirms production redirect URI still used |

### Anti-Patterns Found

None. No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER in the phase's files.

### Human Verification Required

1. **Microsoft sign-in and Sync after the Entra cleanup.** Sign in at https://time.untangle.es with Microsoft, open the calendar, press Sync. Expected: meetings appear, Sync answers without an error.
2. **Real impersonation flow.** As admin, impersonate a team member from /admin, open their calendar and profile, then use "Exit impersonation". Expected: their entries show, no Outlook lane, no Sync/Connect, no Microsoft 365 card; exit returns to the admin.
3. **Calendar drag (upstream fix).** Drag a time entry to another hour. Expected: it lands where it was dropped.
4. **Extension or desktop sign-in with Microsoft.** Expected: the extension's authorization screen appears after Microsoft and it connects.
5. **Passwordless profile.** Open the profile of a Microsoft-only user. Expected: upstream's "managed by your identity provider" card replaces password/2FA; the Microsoft 365 card is still there.
6. **Daily job registered.** In the scheduler container: `php artisan schedule:list`. Expected: `m365:check-out-of-sync` daily at 05:30 Europe/Madrid.
7. **Upstream migrations applied.** In the app container: `php artisan migrate:status` shows the three upstream migrations as Ran.

### Gaps Summary

No gaps. All five roadmap criteria and all four requirements are backed by code, wiring and passing CI tests on HEAD. A real merge was rehearsed, and the ledger check still passes against the current upstream. One plan truth is left for the owner to check: a live Microsoft sign-in and Sync after the Entra cleanup. Six more items come from the release plan's end-of-phase owner checks and from the container checks the verifier could not run.

---

_Verified: 2026-11-27T14:22:30Z_
_Verifier: Claude (gsd-verifier)_
