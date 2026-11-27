# Phase 7: Hardening & Release - Research

**Researched:** 2026-11-26
**Domain:** Laravel 13 fork hardening (data deletion, impersonation guard, feature off switch), upstream merge, Docker/Dokploy healthchecks, Entra spike cleanup
**Confidence:** HIGH for the repo audits and the merge rehearsal (both executed this session), MEDIUM for the healthcheck fix (reasoned from the image files, not run in a container)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Upstream solidtime merge (OPS-03)**
- **D-01:** The upstream merge is applied for real, not only rehearsed: merge current `solidtime-io/solidtime` main (HEAD `d0f5e745` on 2026-11-26) into `feature/m365-integration`, resolve conflicts only within `docs/m365/TOUCHED-CORE-FILES.md`, get all ten CI workflows green, then deploy to time.untangle.es (owner, 2026-11-26). — **Reversibility:** costly — upstream migrations run on the production database via AUTO_DB_MIGRATE; undoing means restoring the pre-merge image and a database backup.
- **D-02:** Before deploying the merge, the orchestrator shows the owner, in short Spanish, what the upstream changes bring (user-visible features and fixes, new migrations, new env vars). The deploy goes ahead after that unless the owner objects or a new env var needs the owner in the Dokploy UI.
- **D-03:** Take a Dokploy database backup (manual Postgres backup of the compose database) right before deploying the merged image, and record how to roll back (previous image tag sha-d379903 plus the backup) in the runbook.
- **D-04:** If upstream changed a ledgered core file, re-apply the fork's seam per the ledger's merge note; any conflict outside the ledger is a finding to fix (move the fork change behind a seam or add it to the ledger with a merge note). The ledger is updated to the merged state.

**Entra spike cleanup (roadmap criterion 5)**
- **D-05:** The owner does the Entra portal steps himself, from an exact step-by-step guide in Spanish written by the orchestrator: remove the redirect URI `http://localhost/m365-spike/callback` and delete the client secret `spike-2026-10` (owner, 2026-11-26). The production secret and redirect URI stay.
- **D-06:** After the owner confirms, the orchestrator checks that Microsoft sign-in and Outlook Sync still work in production, marks the spike lines RETIRADO in `docs/m365/GUIA-ADMIN-ENTRA.md`, and adds a Historial row to `docs/m365/RUNBOOK-entra-app.md`. This is a human checkpoint in the plan.

**Impersonation (SEC-04)**
- **D-07:** Keep the current behaviour: while an admin impersonates a user, the calendar shows no Outlook lane, no Sync/Connect controls and no note — it looks like plain solidtime (owner is the only admin and has no preference, 2026-11-26). Time entries stay visible as in core.
- **D-08:** `GraphAccessGuard` (Phase 3 D-22) already gates the token service, sync, meeting endpoints, conversions, series, out-of-sync and the shared calendar prop. Phase 7 audits every Outlook entry point against it (including the daily `m365:check-out-of-sync` job and queued jobs, which run with no session and must never be triggered by an impersonated request) and adds a test matrix proving no Graph call and no meeting data leaves while impersonating.

### Claude's Discretion
- Deletion cleanup details: which tables are removed on user deletion, organization deletion and member removal (identity, tokens, cached meetings, sync windows, meeting links, series settings, out-of-sync state), and whether through FK cascades or `DeletionService` hooks; time entries themselves follow core rules and are never deleted by fork code.
- Off-switch behaviour: with the env vars unset, all fork data stays in the database untouched and reappears when re-enabled; nothing Microsoft-related renders or is scheduled (including the 05:30 daily job and the Outlook icon on entries); routes answer 404 as today.
- Scheduler/queue healthchecks: fix the `unhealthy` status of the scheduler and queue containers (the image healthcheck probes HTTP, which those modes do not serve) in the fork compose file, not in core Docker files where avoidable.
- Fork-module isolation and any refactor needed to keep core edits to seams.

### Deferred Ideas (OUT OF SCOPE)
- Non-series meeting suggestions feedback (owner will send later; Phase 5 tuning, not Phase 7).
- Drag-to-wrong-hour report (12:00 → 4:00) could not be reproduced; reopen only if it happens again.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-03 | Deleting a user (or organization) removes their Microsoft identity, tokens, cached meetings, links and rules | Every fork table already has an `ON DELETE CASCADE` FK to `users` or `time_entries` (table of gaps below: no data gap, one proof gap). Needs one consolidated deletion test plus a schema guard test. |
| SEC-04 | An admin impersonating a user cannot trigger Graph calls with that user's Microsoft token | Token service, sync, meeting/series/out-of-sync/conversion endpoints, calendar prop and the daily job are covered. THREE real gaps found: Connect (OAuth start + callback), Disconnect, and the profile `account` prop. Needs a route-matrix test. |
| OPS-02 | The integration is disabled cleanly (no login button, no calendar overlay) when M365 env vars are not set | Routes 404, Inertia prop `enabled=false`, schedule filter, frontend gating all verified. Remaining work is proof (a consolidated test + one e2e), not behaviour. |
| OPS-03 | Fork code is isolated in its own module with a documented list of touched core files, and an upstream merge can be performed without conflicts beyond that list | Dry run executed: exactly 4 conflicting files, all in the ledger. Ledger covers every non-added fork file (40 of 40). Merge recipe verified in a throwaway worktree. |
</phase_requirements>

## Summary

The phase is mostly verification and one real merge, not new features. The repo audit found that the fork's data model is already deletion-safe: all five Microsoft tables (`microsoft_accounts`, `outlook_meetings`, `outlook_sync_windows`, `outlook_meeting_links`, `outlook_series_settings`) carry `ON DELETE CASCADE` foreign keys to `users` (and the links also to `time_entries`), so every core deletion path (user, owner organization, member removal, placeholder removal) removes them in the database even where core deletes in bulk without Eloquent events. SEC-03 therefore needs proof (a consolidated test and a schema guard that fails when a future fork table lacks a cascade), not new cleanup code. Do not add `DeletionService` hooks or a listener on the new upstream `BeforeUserDeletion` event; FK cascades are stronger.

SEC-04 has real gaps beyond what D-08 listed. `GraphAccessGuard` correctly covers the token service, sync service, all `OutlookMeeting*`, series, out-of-sync and conversion endpoints, the calendar prop and (indirectly) the daily job. But three Outlook entry points never ask the guard: the Microsoft **Connect** flow (`/auth/microsoft/redirect?intent=connect` and the callback, which would link the admin's own Microsoft identity to the impersonated user), the **Disconnect** endpoint (`DELETE /user/microsoft`, which purges the user's tokens and cached meetings), and the **profile `account` prop** (shows the user's Microsoft email, connect and disconnect URLs while impersonating). D-07 ("looks like plain solidtime") says all three must go quiet.

The upstream merge is smaller than feared. 67 upstream commits since merge base `b46f0157`; a dry run (`git merge-tree --write-tree` plus a throwaway worktree, since deleted) conflicts in exactly `composer.json`, `composer.lock`, `resources/js/Pages/Auth/Login.vue` and `resources/js/Pages/Profile/Show.vue`, all ledgered. After resolving them per the recipe below, `vitest` (67 files, 1790 tests), `prettier` and `eslint` on the resolved files pass; `vue-tsc` showed only the artifact of the worktree having no `vendor/`. The scheduler/queue "unhealthy" cause is confirmed: the Dockerfile's own `HEALTHCHECK` is commented out, so the status comes from the **base image** `dunglas/frankenphp`, which probes the Caddy admin endpoint `localhost:2019/metrics` that scheduler and worker modes never start. The image already ships a mode-aware `/usr/local/bin/healthcheck`; the compose file only has to call it.

**Primary recommendation:** Merge upstream first (wave 1) so every new test runs against the final code, fix the three SEC-04 gaps behind the existing `GraphAccessGuard`, add three proof test files plus one e2e, override the scheduler/queue `healthcheck` in the fork compose with `["CMD","healthcheck"]`, then take the DB backup, deploy once, and run the owner's Entra cleanup checkpoint against the deployed build.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deletion cleanup of Microsoft data | Database / Storage (FK `ON DELETE CASCADE`) | API / Backend (`DeletionService` unchanged) | Core deletes entries and users in bulk without Eloquent events; only DB cascades are guaranteed on every path. |
| Impersonation guard | API / Backend (`GraphAccessGuard`) | Frontend Server (Inertia shared prop omits data) | The server decides; the client only renders what it is given (D-07). |
| Off switch | API / Backend (`MicrosoftConfig::isConfigured`, `EnsureMicrosoftIsEnabled`, schedule `->when`) | Browser (components render only when the `microsoft.calendar` prop and labels exist) | One server-side source of truth; frontend is a pure function of the shared prop. |
| Upstream merge and ledger | Repo / CI (git, `TOUCHED-CORE-FILES.md`) | — | Pure source-control work plus CI gates. |
| Scheduler/queue health | Infra (Compose healthcheck in `docs/deploy/dokploy-compose.fork.yml`) | Container image (`healthcheck` script, supervisord) | Fork-owned compose overrides the inherited base-image healthcheck. |
| Entra spike cleanup | External (owner in Entra portal) | Docs (`docs/m365/*.md`, `validate-docs.mjs`) | Portal steps cannot be automated; docs and verification are repo work. |

## Standard Stack

No new runtime libraries are needed. Everything below already exists in the repo.

### Core
| Library / tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `stechstudio/filament-impersonate` | `^5.0` (`composer.json`, from CLAUDE.md stack) | Impersonation; `ImpersonateManager::isImpersonating()` read by `GraphAccessGuard` | Already the single check. [VERIFIED: app/Microsoft365/Graph/GraphAccessGuard.php read this session] |
| `laravel/socialite` + `socialiteproviders/microsoft` | `^5.31` / `^4.10` in fork `composer.json` | Microsoft sign-in | Already in the lock; the merge only needs the lock regenerated. [VERIFIED: ran `composer update` in a throwaway worktree: "4 installs, 0 updates"] |
| PHPUnit 12 | `phpunit/phpunit ^12` | PHP tests | Project standard (CLAUDE.md). |
| Vitest 4.1 / Playwright 1.60 | `package.json` | Frontend unit, e2e | Project standard. |
| Git `merge-tree --write-tree` | git 2.54 local | Side-effect-free merge rehearsal | Needs git >= 2.38. [VERIFIED: `git --version` 2.54.0] |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `node tests/Tools/m365-spike/validate-docs.mjs guide\|runbook\|secrets` | Validates the Entra guide and runbook structure | After the spike cleanup doc edits. Baseline today: `guide: OK (117 checks)`, `runbook: OK (30 checks)`, `secrets: OK (2297 checks)`. [VERIFIED: ran this session] |
| `gh -R UntangleSL/solidtime ...` | CI status for the Gate W/B checks | Always pass `-R`; see Pitfall 6. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FK cascades only | Listener on upstream `BeforeUserDeletion` | Event only fires on `DeletionService::deleteUser`; it does not cover placeholder removal or bulk entry deletion. Cascades cover all. Not recommended. |
| Override `healthcheck` in compose | Edit `docker/prod/Dockerfile` `HEALTHCHECK` | Edits a core file the upstream merge touches (it changed the Dockerfile). CONTEXT says fork compose. |

**Installation:** none. For the merge only: `composer update laravel/socialite socialiteproviders/microsoft --no-scripts --no-install --ignore-platform-reqs` (do NOT add `laravel/passport` to that command, see Pitfall 3).

**Version verification:** no package is added or bumped by this phase on purpose, so there is no registry lookup to record. The merged lock keeps upstream's Passport pin.

## Package Legitimacy Audit

This phase installs no new external package. The only dependency change is the upstream merge (upstream's `composer.lock` plus the four fork-owned socialite entries already in the fork's lock), regenerated with `composer update` for the two named packages.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `laravel/socialite`, `league/oauth1-client`, `socialiteproviders/manager`, `socialiteproviders/microsoft` | Packagist | already in production lock since Phase 2 | n/a | github.com/laravel/socialite, SocialiteProviders/* | not re-run (not new) | Approved (existing since Phase 2) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Informational: `composer update` in the merged tree printed "Found 32 security vulnerability advisories affecting 12 packages" (composer audit). This comes from the merged lock (upstream's pins) and is not caused by the fork packages; the planner should not treat it as a phase blocker but may record it. [VERIFIED: composer output this session; per-package detail not inspected]

## Architecture Patterns

### System Architecture Diagram

```
 Entry points (all web group, session + CSRF, /m365/* and /auth/microsoft/*)
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ Browser ──► EnsureMicrosoftIsEnabled (404 unless isConfigured())          │
 │            ├─ /auth/microsoft/redirect|callback  ► MicrosoftAuthController │  <-- GAP: no impersonation check on connect
 │            ├─ DELETE /user/microsoft             ► MicrosoftAccountCtrl    │  <-- GAP: no impersonation check
 │            └─ /m365/*  ► OutlookMeeting|Series|OutOfSync|Conversion ctrl   │  guarded (GraphAccessGuard)
 │                                                                           │
 │ every web page ─► ShareMicrosoftInertiaData ─► `microsoft` prop           │
 │     off: {enabled:false}; profile.show: `account`  <-- GAP unguarded;     │
 │     calendar: `calendar` block (guarded)                                  │
 └───────────────────────────────────────────────────────────────────────────┘
          │ every Graph call funnels through
          ▼
 OutlookMeetingSyncService.sync ─► MicrosoftTokenService.accessToken ─► Graph HTTP
          ▲   (both check GraphAccessGuard first)           ▲
          │                                                 │
 Scheduler container (supercronic ► schedule:run, no session)
   05:30 Europe/Madrid, ->when(isConfigured) ─► m365:check-out-of-sync
        ─► queue (database) ─► CheckOutOfSyncForUser (no session ⇒ guard false)
                                  ─► OutOfSyncLookups ─► TokenService ─► Graph

 Deletion paths (core) ─► DB FK ON DELETE CASCADE removes:
   users ─► microsoft_accounts, outlook_meetings, outlook_sync_windows,
            outlook_meeting_links, outlook_series_settings
   time_entries ─► outlook_meeting_links (org deletion / member removal)
```

### Recommended Project Structure (additions only)

```
app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php   # new, tiny: 404 while GraphAccessGuard::blocked()
tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php       # SEC-03 consolidated + schema guard
tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php  # SEC-04 route matrix + canary
tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php         # OPS-02 consolidated
tests/Unit/Microsoft365/ForkIsolationTest.php                 # static canaries (job dispatch site, ledger paths)
e2e/outlook-off-switch.spec.ts                                # OPS-02 browser proof on /calendar
docs/m365/UPSTREAM-MERGE.md                                   # repeatable merge runbook (OPS-03)
```

### Pattern 1: SEC-03, proof instead of code

**What:** Rely on the existing cascades; add one consolidated test and one schema guard.
**When to use:** Always for fork tables; every future fork table must pass the guard.

Gap table (audited against the migrations in `app/Microsoft365/database/migrations`, read in full this session):

| Table | Link to core | FK in migration (verbatim) | User deletion | Org deletion (`deleteOrganization`) | Member removal | Gap |
|-------|--------------|----------------------------|---------------|--------------------------------------|----------------|-----|
| `microsoft_accounts` (identity + encrypted tokens + Graph state) | `user_id` unique | `->cascadeOnDelete()` on `user_id` | removed | not removed, by design: the user survives and keeps signing in | not removed, by design | none (user-level data) |
| `outlook_meetings` (cache incl. attendees, subject) | `user_id` | `->cascadeOnDelete()` on `user_id` | removed | user-level, kept | kept | none |
| `outlook_sync_windows` | `user_id` | `->cascadeOnDelete()` on `user_id` | removed | kept | kept | none |
| `outlook_meeting_links` (links, signals, out-of-sync state) | `user_id` AND `time_entry_id` unique | cascade on both (`user_id`; `time_entry_id` "The cascade lives in the database because core deletes entries in bulk without Eloquent events") | removed (user FK) | removed (entries bulk-deleted, `time_entry_id` FK) | removed when entries are deleted (`delete_related`) | none |
| `outlook_series_settings` (series "rules": ignore/forget) | `user_id` | `->cascadeOnDelete()` on `user_id` | removed | kept (user-level, no org data) | kept | none |

Appearance tables are not Microsoft data, but for completeness: `user_appearance_settings` and `organization_icons` also cascade; the icon FILE is removed by a `BeforeOrganizationDeletion` listener (`app/Appearance/Listeners/DeleteOrganizationIconFile.php`).

Facts that shape the proof:
- `DeletionService::deleteUser` turns non-owner memberships into **placeholder users** via `makeMemberToPlaceholder` (`$user->replicate()`), reassigns the entries to the placeholder, then `$user->delete()`. The user's Microsoft rows therefore vanish by cascade while the time entries survive under the placeholder; their Outlook marker disappears with the link. This is intended and must be asserted, not changed. [VERIFIED: app/Service/DeletionService.php and app/Service/MemberService.php:249-280 read this session]
- Fork code adds no column to `users`, so `replicate()` copies no Microsoft data to the placeholder. [VERIFIED: grep of fork migrations; only FKs reference `users`]
- Placeholder removal (`MemberService::removeMember`) calls `$user->delete()` for placeholders, also covered by the cascade. [VERIFIED: MemberService.php lines ~100-130]
- `MicrosoftAccount`, `OutlookMeeting`, `OutlookMeetingLink`, `OutlookSeriesSetting` are deliberately not audited, so no `audits` row can carry tokens or subjects. [VERIFIED: model docblocks, grep "Deliberately" in app/Microsoft365/Models]
- Cache holds only short lock keys (`m365:meetings-sync:{user}`, `m365:osync:{user}`) and no Microsoft data. [VERIFIED: grep `Cache::` in app/Microsoft365]
- A queued `CheckOutOfSyncForUser` payload holds only the user id; if the user is gone, `User::find` returns null and the job logs `not_connected` and returns. [VERIFIED: job read this session]
- Upstream (post-merge) will also dispatch `BeforeUserDeletion` and delete refresh tokens through a new cascading FK. Neither is needed by the fork. [VERIFIED: `git diff` of upstream DeletionService]
- Users that sign in only with Microsoft have no password; upstream's new `IdentityConfirmationService` means they cannot self-delete the account from the profile (an administrator must). Admin deletion (Filament `DeleteUser` action, `admin:*` commands, API) all route through `DeletionService`. [VERIFIED: upstream diff; grep of Filament resources shows UserResource/OrganizationResource call `DeletionService`]

**Test shape (one test class, runs in CI):**
```php
// Source: pattern of tests/Feature/Microsoft365/OutlookSeriesSettingsTest.php:553-572 (existing deleteUser test)
public function test_deleting_a_user_leaves_no_microsoft_row(): void
{
    // Arrange: account with tokens, meetings, sync window, link, series setting for $data->user;
    //          a second user with one row in every table (must survive)
    // Act
    app(DeletionService::class)->deleteUser($data->user);
    // Assert: every fork table has 0 rows for the user's id, the other user's rows are untouched
}

public function test_every_fork_table_cascades_from_users_or_time_entries(): void
{
    // information_schema guard: for each table in ['microsoft_accounts','outlook_meetings',
    // 'outlook_sync_windows','outlook_meeting_links','outlook_series_settings'] there is a FK to
    // users(id) with delete_rule = 'CASCADE'; outlook_meeting_links also one to time_entries(id).
    // Better: derive the table list from the fork migration directory so a new table fails the test.
}
```
Add cases for: owner of a single-member org (org deleted then user), non-owner member (placeholder path), `delete_related` member removal (link gone, other user's link kept), full `deleteOrganization` (links gone, member accounts kept). Two of these already exist partially (`test_settings_are_deleted_with_the_user`, `OutlookMeetingLinkLifecycleTest.php:291`); the new class consolidates them across all five tables.

### Pattern 2: SEC-04, close three gaps behind the single guard

Entry-point audit (every fork route, controller, job, command; files read this session):

| Entry point | Reaches Graph / user Outlook data? | Covered by `GraphAccessGuard`? | Evidence |
|---|---|---|---|
| `MicrosoftTokenService::accessToken` (the single choke point of every Graph token) | yes | YES, first statement | `if ($this->access->blocked()) { throw new GraphException(SyncStatus::NotConnected); }` |
| `OutlookMeetingSyncService::sync` | yes | YES, "Defence in depth" before any query | same pattern |
| `OutlookMeetingController` index / sync / dismiss / restore | cached meetings, sync | YES (`index` returns empty collection; `ownMeeting()` throws 404) | file read |
| `OutlookSeriesController` ignore / unignore / forget | writes series settings | YES (404) | line 75 |
| `OutOfSyncController` keep / adjust / moveEntry | writes links/entries | YES (404) | line 300 helper |
| `MeetingConversionController::store` | creates entries from meetings | YES | line 68 |
| `ShareMicrosoftInertiaData` calendar block | URLs, state, labels | YES: `if ($request->routeIs('calendar') && ! $this->access->blocked())` | line 63 |
| `CheckOutOfSyncForUser` job and `m365:check-out-of-sync` command | yes (Graph lookups) | Indirect: no session in scheduler/queue so guard answers false; all Graph tokens still go through the guarded token service; only the command dispatches the job | grep: `CheckOutOfSyncForUser::dispatch` appears only in `CheckOutOfSyncCommand.php:64` |
| `MicrosoftAuthController::redirect` with `?intent=connect` and `callback` (`completeConnect`) | starts OAuth for the session user and links the signed-in Microsoft identity to them | **NO** | `redirect()` puts `INTENT_SESSION_KEY` and `CONNECT_USER_SESSION_KEY` (the impersonated user's id) with no check; `completeConnect` compares `Auth::guard('web')->user()` to that id, which matches under impersonation, then `$resolver->connect($identity, $user)` |
| `MicrosoftAccountController::destroy` (`DELETE /user/microsoft`) | deletes the user's tokens and all cached meetings and sync windows | **NO** | method has no guard; it acts on `$request->user()` which is the impersonated user |
| `ShareMicrosoftInertiaData` profile `account` block | Microsoft email, linked/connected state, connect and disconnect URLs | **NO** | `if ($request->routeIs('profile.show')) { ... $data['account'] = ... }` runs without `blocked()` |

Impact of the first gap: an impersonating admin who completes Microsoft sign-in at the prompt with their own account would attach the admin's Microsoft identity to the target user (if the target has no linked identity), a persistent way to sign in as that user. The resolver refuses only when the user is already linked to another identity. [VERIFIED by reading the controller and `MicrosoftIdentityResolver::connect`; the end-to-end exploit was not executed]

**Recommended fix (small, fork-only, consistent with the existing 404-on-impersonation convention D-14):**
1. New `EnsureNotImpersonating` middleware that aborts 404 when `GraphAccessGuard::blocked()`; add it to the connect-related routes. Because the `redirect` route also serves normal sign-in (guests), apply it as a check inside `MicrosoftAuthController::redirect` only on the connect branch, and in `completeConnect`/`callback` before reading the session intent, rather than on the route group. For `DELETE /user/microsoft` add it as route middleware.
2. In `ShareMicrosoftInertiaData`, skip the `account` block when `blocked()` (same condition as the calendar block). With no `account`, `MicrosoftConnectionForm.vue` already renders nothing (`account` computed is null). [VERIFIED: resources/js/m365/components/MicrosoftConnectionForm.vue read]
3. Keep `GraphAccessGuard` stateless and fail-closed; do not add a second implementation of the check.

Octane note: `GraphAccessGuard` reads the session on every call and stores nothing. Keep it that way.

**Test matrix (the proof D-08 asks for):** one feature test class that, for the impersonation state, hits every route whose name starts with `microsoft.` (except the guest sign-in pair) with a connected account and `Http::fake()`, asserting (a) 404 or an empty payload, (b) `Http::assertNothingSent()`, (c) no row changed. Add a **route canary**: iterate `Route::getRoutes()`, collect routes whose action class is in `App\Microsoft365\Http\Controllers`, and fail if one is missing from the matrix list. Add a static canary that `CheckOutOfSyncForUser::dispatch` appears only in `CheckOutOfSyncCommand`. Existing impersonation tests to reuse the helper from: `OutlookMeetingPrivacyTest.php:186-190` (`session()->put(ImpersonateManager::SESSION_KEY, 1)`).

### Pattern 3: OPS-02, behaviour is already correct, add consolidated proof

Audit with env vars unset (config values blank; `isConfigured()` false):

| Surface | State today | Evidence |
|---|---|---|
| Routes `/auth/microsoft/*`, `/user/microsoft`, `/m365/*` | registered but every one answers 404 via `EnsureMicrosoftIsEnabled` | routes file: every group lists `EnsureMicrosoftIsEnabled::class`; `abort(404)` |
| Inertia `microsoft` prop | `['enabled' => false]` on every page; no `account`, no `calendar` | `ShareMicrosoftInertiaData::handle` |
| Login button | `MicrosoftSignInButton` renders only when `prop.enabled` | component read |
| Profile card | `MicrosoftConnectionForm` renders only with `prop.enabled && prop.account` | component read |
| Calendar | `useOutlookMeetings`: `calendar` is null unless `enabled === true`; the meetings query has `enabled: calendar !== null && ...`; `labels` null, so `OutlookSelectionBar`/`OutlookSyncFlagPanel` (`v-if="outlook.labels.value"`) and the controls/badge/marker render nothing | `useOutlookMeetings.ts:302-306, 388-392, 436-441`; `Calendar.vue:201-202` |
| Outlook icon on entries | `OutlookEntryBadge` needs `context.labels` (null) and `linkedTimeEntryIds` (no query) | component read |
| Schedule | the `m365:check-out-of-sync` event IS registered (visible in `schedule:list`) but `->when(fn () => app(MicrosoftConfig::class)->isConfigured())` keeps it from running; the command itself prints `configured: no` and exits 0 | provider + command read; test `OutlookOutOfSyncScheduleTest::test_daily_check_never_runs_while_the_integration_is_not_configured` |
| Data | migrations still run (`loadMigrationsFrom`), tables keep their rows, nothing deleted | provider |
| Console | `m365:check` and `m365:check-out-of-sync` stay registered (harmless, report `configured: no`) | provider |
| Core features | the CI Playwright environment sets no `SOLIDTIME_MICROSOFT_*` variables, so the whole core e2e suite already runs in the off state | comment in `e2e/microsoft-signin.spec.ts` lines 5-6 |

Gaps (proof only): there is no single test that sweeps all fork routes while unconfigured, and no browser assertion that `/calendar` carries no Outlook controls. Recommended decision on the schedule: **keep the `->when()` filter** (it also lets a config change take effect without a restart) and add an assertion rather than gating registration at boot; "nothing is scheduled" is satisfied in effect (the filter returns false), and CONTEXT's own wording covers "including the 05:30 daily job" as not running. If the owner wants it absent from `schedule:list`, gate registration on `isConfigured()` too, but then tests must `forgetInstance(Schedule::class)` (the existing `dailyChecks()` helper already does).

Test shape: unconfigured user with seeded fork rows: (1) every `microsoft.*` route is 404 (same canary as SEC-04), (2) calendar page props have `microsoft.enabled === false` and no `calendar`/`account`, (3) the schedule event's `filtersPass()` is false, (4) fork tables still hold the seeded rows, (5) re-configuring restores the endpoints and the rows. e2e: with the CI default (off), `/calendar` has zero of `outlook-calendar-controls`, `outlook-lane`, `outlook-entry-badge`, `outlook-selection-bar`, `outlook-out-of-sync` test ids and issues no request to `/m365/`. These test ids exist in the m365 components. [VERIFIED: grep of data-testid in resources/js/m365/calendar]

### Pattern 4: upstream merge as a repeatable, side-effect-free procedure

Rehearsal results (executed this session; the `upstream` remote was added to the local repo config and fetched; no commit or push touched `feature/m365-integration`; the throwaway worktree and branch `tmp/phase7-merge-rehearsal` were removed):

- Upstream HEAD `d0f5e7452f1aeb9ff842395b654e4588af29eac6`; fork base `259088b4`; merge base `b46f015754a19493418a3129dcfcf8890587c6a8`; 67 upstream commits since the base, 155 files changed (+4828 / -448).
- `git merge-tree --write-tree HEAD upstream/main` exits 1 and lists exactly four conflicting files; `git merge --no-commit --no-ff upstream/main` in the worktree confirmed the same four.
- Files changed on both sides: 9. Four conflict, five merge cleanly (`.env.example`, `app/Providers/FortifyServiceProvider.php`, `e2e/calendar-settings.spec.ts`, `e2e/profile.spec.ts`, `tests/Feature/AuthenticationTest.php`); all nine are in `TOUCHED-CORE-FILES.md`.
- Ledger completeness: all 40 non-added files the fork changed since the base are present in the ledger (checked mechanically with `git diff --name-status` against the ledger text). Zero conflicts outside the ledger.

Conflicts and the resolution recipe (tested in the worktree):

| File | Conflict | Resolution |
|---|---|---|
| `composer.json` | one line: fork `laravel/socialite ^5.31` vs upstream `laravel/passport ^13.10.0` | keep both: `"laravel/passport": "^13.10.0",` then `"laravel/socialite": "^5.31",` |
| `composer.lock` | content | `git checkout --theirs composer.lock`, then `composer update laravel/socialite socialiteproviders/microsoft --no-scripts --no-install --ignore-platform-reqs`. Result: "4 installs, 0 updates", `composer validate` OK. Do NOT list `laravel/passport` (it would bump 13.10.0 to 13.12.0). |
| `resources/js/Pages/Auth/Login.vue` | (a) props: upstream converted `defineProps({...})` to typed `withDefaults(defineProps<{canResetPassword?: boolean; status?: string}>(), {...})` and dropped `canRegister`; fork has `canRegister: Boolean`. (b) upstream added `<slot name="alternatives" />` where the fork has `<MicrosoftSignInButton />` | (a) take upstream's typed form and ADD `canRegister?: boolean` with default `false` (the register link keeps `v-if="canRegister"`, which merged cleanly); (b) keep upstream's slot and keep the fork element after it. Note: the ledger's Login.vue row mentions only the button; the `canRegister` prop and `v-if` must be added to its merge note. |
| `resources/js/Pages/Profile/Show.vue` | upstream now wraps UpdatePassword + TwoFactor in `<template v-if="confirmsWithPassword">` with an `v-else-if="user"` "managed externally" card, and passes `confirms-with-password` to the sessions form; fork added `<MicrosoftConnectionForm />` after the two-factor section | add the fork import beside upstream's new imports; place `<MicrosoftConnectionForm />` immediately before `<LogoutOtherBrowserSessionsForm ... />` (after upstream's `v-if/v-else-if` block). Update the ledger note. |

Post-resolution checks that passed in the worktree: `vitest run` 67 files / 1790 tests, `prettier --check` and `eslint` on both Vue files. `vue-tsc` reported only `Cannot find module '../../vendor/tightenco/ziggy'` (the worktree has no `vendor/`, an artifact, not a regression). PHP/Feature tests cannot run locally; CI is the gate.

Upstream content the owner should hear about (D-02 input, from commit subjects; user-visible items first):
- Fixes that matter to the fork: **calendar drag fix** ("Fix calendar drag moving events by the start hour offset", `useEventDrag.ts`, a file the fork does not edit; very likely the cause of the deferred "drag to wrong hour" report, which the owner could not reproduce); DST-correct grouping of entries by date; project/task spent time recalculated after admin time-entry edits; the client of an entry follows its project; reports need the view-all permission to create/update.
- New: **exit impersonation in the user menu**; `is_impersonating` Inertia prop; invoicing logo and invoice settings (only meaningful with the private Invoicing extension, which the fork does not install); core support for extendable auth and passwordless users (SSO extension seam, `AuthenticationContract`, `confirms_with_password`); email case normalization everywhere; membership check middleware (`check-organization-member`) on the API; Markdown in mail values rendered as plain text.
- Infra: FrankenPHP 1.13, prod Dockerfile fails the build if PHP < 8.3.37 (`MIN_PHP_VERSION`), `session.upload_progress` off, Passport 13.10 with the device grant disabled, cosign-signed upstream images (not relevant to the fork image), Postgres 18 in the CI matrix, optional heartbeat monitoring for scheduler and queue.
- Migrations (3, all additive or data fixes, none touch fork tables): `2026_11_03_000001_sync_client_id_of_time_entries_with_project` (sets `client_id = NULL` on time entries that have no project; a core data fix), `2026_11_05_000001_delete_orphaned_oauth_refresh_tokens` (deletes orphan refresh tokens, adds an FK to access tokens), `2026_11_18_000001_lowercase_organization_invitation_emails` (dedupes and lowercases invitation emails; lowercases placeholder user emails). No schema dump changes. [VERIFIED: read in full]
- New env vars: only optional `HEARTBEAT_SCHEDULER_URL`, `HEARTBEAT_QUEUE_URL` (and `HEARTBEAT_TIMEOUT` in `config/heartbeat.php`); a new scheduled `heartbeat:send` every minute that no-ops while both URLs are unset. `BCRYPT_ROUNDS` is no longer read (fixed at 12). `SUPER_ADMINS` entries are now trimmed and lowercased. No variable is required, so no Dokploy UI step is forced by this merge (D-02 condition). [VERIFIED: config diffs read]
- Package changes: `composer.json` Passport constraint; `composer.lock` (21+/20-); `package.json` and `package-lock.json` unchanged; `extensions/manifest.json` pins newer extension tags and adds SSO (the fork does not fetch private extensions, so no effect); `tsconfig.json` includes `extensions/SSO` paths. Workflows: Postgres 18 in the `phpunit.yml` matrix, API-docs deploy, Dependabot limits.

Merge mechanics for the plan:
1. `git fetch upstream`; on `feature/m365-integration`: `git merge --no-ff upstream/main` (not rebase).
2. Resolve the four files per the table; run the checks; amend nothing upstream-owned.
3. Push; wait for the ten active workflows (Gate W set: PHPUnit Tests, PHP Linting, Static code analysis (PHPStan), NPM Test Unit, NPM Lint, NPM Typecheck, NPM Format Check, NPM Build, Playwright Tests, Fork - Build image). [VERIFIED: `gh workflow list --all -R UntangleSL/solidtime`: these ten are `active`, the rest `disabled_manually`]
4. The fork image build now fails if the base image's PHP is below 8.3.37; the fork workflow passes only `DOCKER_FILES_BASE_PATH`, so a stale base image is the one realistic build break. Escape hatch, fork-owned: add `MIN_PHP_VERSION=<lower>` to the `build-args` in `.github/workflows/fork-image.yml` (the Dockerfile `ARG` is overridable) [CITED: upstream Dockerfile diff, `ARG MIN_PHP_VERSION=8.3.37`]. Prefer to leave it unset and let CI prove the image.
5. Update the ledger and add `docs/m365/UPSTREAM-MERGE.md` with the exact commands above (including the completeness check below).

Ledger completeness check (reusable, run before and after every merge):
```bash
# Files the fork modified or deleted that exist upstream (adds can never conflict)
MB=$(git merge-base HEAD upstream/main)
git diff --name-status "$MB" HEAD | grep -v '^A' | cut -f2- | grep -v '^\.planning' |
  while read -r f; do grep -q "\`$f\`" docs/m365/TOUCHED-CORE-FILES.md || echo "NOT IN LEDGER: $f"; done
# Would-be conflicts without touching the working tree
git merge-tree --write-tree --name-only --no-messages HEAD upstream/main
```

### Pattern 5: scheduler/queue healthcheck

Root cause (verified): `docker/prod/Dockerfile` line 24 builds `FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_VERSION}` and line 174 has the image `HEALTHCHECK` commented out (`#HEALTHCHECK --start-period=30s --interval=10s --timeout=3s --retries=3 CMD healthcheck || exit 1`). The inherited instruction comes from the FrankenPHP base image: `HEALTHCHECK CMD curl -f http://localhost:2019/metrics || exit 1`, defined in its `common` stage. [CITED: raw.githubusercontent.com/php/frankenphp/main/Dockerfile, fetched this session] Only `CONTAINER_MODE=http` starts Caddy (port 2019 metrics); `scheduler` (supercronic under supervisord) and `worker` modes do not, so they are `unhealthy` forever while working fine (the earlier README note says the same).

The image already ships the right probe: line 131 copies `docker/prod/deployment/healthcheck` to `/usr/local/bin/healthcheck`, and the script handles `scheduler` and `worker` modes by running `supervisorctl status scheduler:scheduler_0` / `worker:worker_0` and requiring `running`. The programs are named `scheduler` and `worker` with `process_name = %(program_name)s_%(process_num)s` in the supervisord confs; `supervisord.conf` exposes `[inet_http_server] port = 127.0.0.1:9001`, which is `supervisorctl`'s default target. [VERIFIED: files read this session]

**Fix (fork compose only):**
```yaml
# docs/deploy/dokploy-compose.fork.yml, under both `scheduler:` and `queue:`
    healthcheck:
      test:
        - CMD
        - healthcheck
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```
Verification after deploy: container health in Dokploy shows `healthy` for `scheduler` and `queue`. If `healthcheck` reports failure (supervisorctl default URL not resolving), fall back, in order, to `["CMD-SHELL","supervisorctl status worker:worker_0 | grep -q RUNNING"]` (and the `scheduler:scheduler_0` twin), then to `healthcheck: {disable: true}` which removes the inherited probe. [ASSUMED: not executed in a container, no Docker locally; see A1]

Optional, not required: upstream's heartbeat feature (`HEARTBEAT_*` URLs) is the supported external liveness mechanism for scheduler and queue; it needs an external monitor service, so skip unless the owner has one.

### Anti-Patterns to Avoid
- **A second impersonation check:** do not re-implement `isImpersonating()` anywhere else; call `GraphAccessGuard::blocked()` (fail-closed, stateless).
- **Deleting fork data in PHP on user/organization deletion:** bulk deletes skip Eloquent events; keep the DB cascade as the single mechanism.
- **Gating the sign-in route group on impersonation:** the same `redirect` route serves guests; check inside the connect branch only.
- **Editing core Docker files for the healthcheck:** the merge changes `docker/prod/Dockerfile`; keep the fix in the fork compose.
- **Hand-merging `composer.lock`:** the ledger forbids it; regenerate.
- **Committing on the throwaway merge branch or leaving worktrees:** `git worktree remove --force` on a worktree containing a `node_modules` junction can delete the junction's target; remove the junction with `cmd /c rmdir` first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cleaning fork data on deletion | A `DeletionService` hook or listener | Existing `ON DELETE CASCADE` FKs plus a schema guard test | Core bulk-deletes entries and users without model events; only DB cascades are universal. |
| Impersonation detection | New session-key reads | `GraphAccessGuard::blocked()` | One fail-closed seam, already tested. |
| Scheduler/queue liveness probe | A new script or curl against a port | `/usr/local/bin/healthcheck` (already in the image) | Already mode-aware via supervisorctl. |
| Merge conflict preview | Manual diffing | `git merge-tree --write-tree` | Side-effect-free, exits 1 with the file list. |
| Docs validation | Reading the guide by eye | `node tests/Tools/m365-spike/validate-docs.mjs guide\|runbook\|secrets` | Already encodes the TEMPORAL/RETIRADO and runbook-slot rules. |
| `composer.lock` merge | Manual edit | `composer update <fork packages> --no-install` | Keeps the content hash consistent. |

**Key insight:** this phase adds guards, proofs and one merge, not machinery. Every mechanism needed (FKs, guard, config gate, healthcheck script, validators) already exists; the risk is in leaving the three unguarded entry points and in an untested merge.

## Runtime State Inventory

This phase includes a real upstream migration/merge applied to production, so the migration categories are answered explicitly (the string-rename framing does not apply).

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | Production Postgres (volume `database-storage-m365`). The merge runs three upstream migrations on it via `AUTO_DB_MIGRATE` (see list above), one of which updates `time_entries.client_id` and one of which deletes rows (orphan refresh tokens, duplicate-case invitations). | Take the Dokploy DB backup immediately before deploy (D-03); the plan records the restore path. |
| Live service config | Dokploy compose (image pin `sha-d379903`; scheduler/queue healthchecks); Dokploy Environment (never edited by the agent). No new required env var. | Update the compose through the Dokploy MCP: new image tag and the two healthcheck blocks. |
| OS-registered state | None (containers only; supercronic crontab is inside the image). | none, verified by reading the Dockerfile/supervisord confs |
| Secrets / env vars | `SOLIDTIME_MICROSOFT_*` unchanged; spike secret `spike-2026-10` and spike redirect URI live only in Entra (Doppler keys already removed 2026-10-19 per the runbook). | Owner removes both in the Entra portal; no code change. |
| Build artifacts | Image `ghcr.io/untanglesl/solidtime:sha-d379903` is the rollback target; new image built by `Fork - Build image` on push. | Keep the old tag; record rollback = previous tag + DB backup. |

## Common Pitfalls

### Pitfall 1: the Connect flow looks like a harmless redirect
**What goes wrong:** The impersonation guard is added to Graph paths only; Connect under impersonation links the admin's own Microsoft identity to the target user.
**Why it happens:** Connect does no Graph call, so it was outside "Graph call with that user's token".
**How to avoid:** Guard `redirect` (connect branch), the callback and `DELETE /user/microsoft`, and drop the profile `account` prop while blocked.
**Warning signs:** Matrix test row for `microsoft.redirect?intent=connect` or `microsoft.account.destroy` returns 302/200 instead of 404.

### Pitfall 2: guard keys on the session, so jobs must never be dispatched from a request
**What goes wrong:** With `QUEUE_CONNECTION=sync`, a job dispatched inside an impersonated request would run in that session.
**Why it happens:** `GraphAccessGuard` reads the session; queue workers and the scheduler have none (RESEARCH A1 of Phase 6).
**How to avoid:** Keep the static canary that only `CheckOutOfSyncCommand` dispatches `CheckOutOfSyncForUser`; production uses `QUEUE_CONNECTION=database` (compose).
**Warning signs:** A new `dispatch` call outside `app/Microsoft365/Console`.

### Pitfall 3: `composer update` pulling Passport forward
**What goes wrong:** `composer update laravel/passport ...` upgraded 13.10.0 to 13.12.0 in the rehearsal.
**How to avoid:** Update only `laravel/socialite socialiteproviders/microsoft`; the result is "4 installs, 0 updates".
**Warning signs:** Lock diff shows a Passport version change.

### Pitfall 4: forgetting `canRegister` in the merged `Login.vue`
**What goes wrong:** Taking upstream's `defineProps` wholesale drops the prop; the "Register here!" link (still guarded by `v-if="canRegister"`) disappears for everyone, or `canRegister` becomes an unknown attribute.
**How to avoid:** Add `canRegister?: boolean` (default false) to the typed props and keep the `FortifyServiceProvider` line (it auto-merged); the two `AuthenticationTest` tests cover it.

### Pitfall 5: marking guide lines RETIRADO in a way the validator rejects
**What goes wrong:** `validate-docs.mjs guide` requires the spike URI text to still exist and every line mentioning `m365-spike/callback` or `spike-AAAA-MM` to contain `TEMPORAL` or `RETIRADO`; the runbook validator requires `Redirect URIs` and `Caducidad del secreto spike` rows to remain, the latter starting with an ISO date, and the `## Limpieza tras el spike` heading.
**How to avoid:** Replace `TEMPORAL` with `RETIRADO 2026-11-DD` on those lines; keep the rows and the ISO date prefix, append "(eliminado AAAA-MM-DD)"; run all three validators.

### Pitfall 6: `gh` queries the wrong repository once `upstream` exists
**What goes wrong:** After `git remote add upstream`, a bare `gh run list`/`gh workflow list` resolved to `solidtime-io/solidtime` here (the first `gh run list --branch feature/m365-integration` returned `[]`, and `gh workflow list` listed upstream's workflows as active).
**How to avoid:** Always use `-R UntangleSL/solidtime` in Gate W/B commands, or run `gh repo set-default UntangleSL/solidtime`.

### Pitfall 7: restore points and the one-way migrations
**What goes wrong:** Rolling back the image alone does not undo the upstream migrations (they stay applied, and the FK on refresh tokens stays).
**How to avoid:** D-03 backup right before deploy; rollback = previous image tag `sha-d379903` plus restoring the backup, as D-01 says.

### Pitfall 8: OAuth authorize flow and the Microsoft callback after the merge
**What goes wrong:** Upstream reworked how an unauthenticated visit to `/oauth/authorize` is redirected to login (`AuthenticationException::redirectUsing`). The fork's callback relies on `redirect()->intended(...)` written by the guest middleware (comment in `MicrosoftAuthController::callback`), which is how the browser extension/desktop app returns after Microsoft sign-in.
**How to avoid:** Include the browser-extension login (Microsoft sign-in then back to `/oauth/authorize`) in the post-deploy smoke test. [ASSUMED: not exercised locally; the interaction is inferred from the upstream diff, see A3]

## Code Examples

### Merge dry run without side effects
```bash
# Source: git documentation for merge-tree --write-tree; run this session
git remote add upstream https://github.com/solidtime-io/solidtime.git   # once
git fetch upstream --no-tags
git merge-tree --write-tree --name-only --no-messages HEAD upstream/main  # exit 1 = conflicts; lists files
```

### Impersonation matrix row (shape)
```php
// Source: existing helper at tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php:186-190
Http::fake();
session()->put(ImpersonateManager::SESSION_KEY, 1);
$response = $this->actingAs($user, 'web')->delete(route('microsoft.account.destroy', [], false));
$response->assertNotFound();
Http::assertNothingSent();
$this->assertNotNull(MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->value('refresh_token'));
```

### Spike cleanup edits the validators accept
```text
GUIA-ADMIN-ENTRA.md  line 138: `http://localhost/m365-spike/callback` | RETIRADO 2026-11-DD: eliminado del registro ...
                     lines 66-67, 227-247, 451, 454: replace TEMPORAL with RETIRADO 2026-11-DD (keep the text)
RUNBOOK-entra-app.md  Redirect URIs row: `http://localhost/m365-spike/callback` (RETIRADO 2026-11-DD, eliminado)
                      Caducidad del secreto spike: 2027-04-19 (secreto `spike-2026-10`; eliminado 2026-11-DD)
                      Limpieza tras el spike: tick the three open boxes; Historial: one new row
```
Line numbers are those of the files read this session (guide lines 66-67, 138, 227-247, 451, 454; runbook lines 18, 25, 126-131, Historial from 135); re-grep before editing.

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| Core had password-only login | Core has `AuthenticationContract`, `IdentityConfirmationService`, `User::hasLocalPassword()`, passwordless users | upstream 2026-10-26 (`f845c900`) | The fork's null-password Microsoft users now see "managed externally" on the profile; self-delete needs an administrator. |
| Refresh tokens deleted by `DeletionService` | FK cascade on `oauth_refresh_tokens.access_token_id` | upstream 2026-11-05 | Nothing for the fork, but confirms cascade-as-mechanism is upstream's direction. |
| No impersonation signal in the UI | `is_impersonating` Inertia prop, exit in the user menu | upstream 2026-11-13 | Complements D-07; no fork change needed. |

**Deprecated/outdated:** `BCRYPT_ROUNDS` env var (fixed at 12 upstream); Passport device grant (disabled).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `["CMD","healthcheck"]` reports healthy for `scheduler` and `worker` containers (supervisorctl reaches `127.0.0.1:9001` with its default URL, config at `/etc/supervisord.conf`). Not run in a container; no Docker locally. | Pattern 5 | Containers stay unhealthy; fallbacks are listed. Verify in Dokploy after deploy. |
| A2 | The Connect-under-impersonation link takeover works end to end (admin signs in at Microsoft with their own account and the resolver links it to a user without a linked identity). Derived from reading the controller and resolver, not executed. | Pattern 2 | If a resolver rule blocks it, the gap is smaller but D-07 still requires hiding Connect/Disconnect. |
| A3 | Upstream's `AuthenticationException::redirectUsing` change keeps the fork's `redirect()->intended` return path for the browser-extension OAuth login working. | Pitfall 8 | Extension login lands on the dashboard instead of `/oauth/authorize`; found by the post-deploy smoke test. |
| A4 | `docker/prod/Dockerfile`'s `FROM dunglas/frankenphp:1.13-php8.3` resolves to PHP >= 8.3.37 today, so the new `MIN_PHP_VERSION` build check passes. | Pattern 4 | `Fork - Build image` fails; override `MIN_PHP_VERSION` in `fork-image.yml` build-args or wait for the base image. |
| A5 | The Dokploy MCP can read container health and trigger a manual Postgres backup for the compose database (CONTEXT D-03 assumes it). | Environment Availability | Backup must then be taken by the owner in the Dokploy UI before the deploy. |
| A6 | The Playwright CI job really runs with `SOLIDTIME_MICROSOFT_*` unset (stated in an e2e spec comment; `.env.ci` is protected and was not read, and no `MICROSOFT` string appears in `.github`, `phpunit.xml`, `playwright.config.ts` or `docker-compose.yml`). | Pattern 3 | The new off-switch e2e would run with the integration on; set it explicitly in the spec or fixture. |

## Open Questions (RESOLVED)

1. **Gate registration of the 05:30 job on `isConfigured()` as well?**
   - Known: the event is registered but its `->when()` filter blocks it (tested).
   - Unclear: whether the owner reads "nothing is scheduled" as "not listed in `schedule:list`".
   - Recommendation: keep the filter (no behaviour change, config changes apply live). Ask only if the owner objects; the extra gate is a two-line change plus test.
   - RESOLVED (orchestrator, 2026-11-27): keep the `->when(isConfigured)` filter; plan 07-04 proves it.

2. **Should the Microsoft routes also carry core's new `check-organization-member` middleware?**
   - Known: upstream added it to the API group; the fork's `m365/organizations/{organization}/...` routes use `check-organization-blocked` and membership checks inside the controllers (conversion/move-entry controllers read the user's own organization).
   - Unclear: whether adding it is worth the diff.
   - Recommendation: not in Phase 7 scope; optionally note as hardening if the controllers do not already reject non-members (the Phase 4 tests cover foreign organizations).
   - RESOLVED (orchestrator, 2026-11-27): out of Phase 7 scope; no task.

3. **Does the owner want the drag fix called out as the probable resolution of the deferred report?**
   - Recommendation: mention it in the D-02 summary; do not reopen the deferred item unless it recurs after deploy.
   - RESOLVED (orchestrator, 2026-11-27): named in the D-02 summary (07-05 Task 3); the deferred item stays closed unless it recurs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| PHP CLI (portable toolchain) | Gate P/U, composer | yes | 8.3.36 at `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe` | CI |
| Composer | merge lock regeneration | yes | `composer.phar` in the toolchain; `composer update` ran | CI |
| Node | vitest, eslint, prettier, validators | yes | v24.13.1 (CI uses 20.x) | — |
| git | merge rehearsal | yes | 2.54.0 | — |
| gh CLI | CI gates, `gh workflow list` | yes | authenticated as `untangle-juan` | — |
| Postgres (local) | Feature PHPUnit | no | — | CI only (as stated in the task) |
| Docker (local) | verify healthcheck in a container | no (`which docker` failed) | — | Verify in Dokploy after deploy |
| Dokploy MCP / UI | compose update, backup, health | not probed from here | — | Owner uses the Dokploy UI for the backup if the MCP cannot (A5) |
| Entra portal | spike cleanup | owner only | — | Human checkpoint (D-05) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local Postgres and Docker (CI and Dokploy are the verifiers).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (Unit local, Feature in CI with Postgres), Vitest 4.1, Playwright 1.60, plus `validate-docs.mjs` (Node test runner for the tool itself) |
| Config file | `phpunit.xml` (suites Unit, Feature, Modules), `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `"C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe" vendor/bin/phpunit tests/Unit/Microsoft365/<File>.php` (Gate U); `npx vitest run <files>` |
| Full suite command | Push and read CI: Gate W (ten workflows) and Gate B (count of `PASS.*Tests.Feature.Microsoft365.` and `PASS.*Tests.Unit.Microsoft365.` lines in the PHPUnit Tests log, always `gh ... -R UntangleSL/solidtime`) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-03 | User deletion leaves no row in any of the five fork tables; other users' rows survive | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` (CI) | Wave 0 |
| SEC-03 | Every fork table has a CASCADE FK to `users` (links also to `time_entries`); a new fork migration table fails the guard | feature (CI, information_schema) | same file, `test_every_fork_table_cascades...` | Wave 0 |
| SEC-03 | Org deletion removes links; member removal with `delete_related` removes only that member's links | feature (CI) | existing partial: `OutlookMeetingLinkLifecycleTest` (line ~270-300); consolidated in the new file | partial |
| SEC-04 | Every `microsoft.*` route is 404 or empty while impersonating, `Http::assertNothingSent()`, no row changed | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` | Wave 0 |
| SEC-04 | Connect, callback, Disconnect and profile `account` prop are inert while impersonating | feature (CI) | same file | Wave 0 |
| SEC-04 | Only `CheckOutOfSyncCommand` dispatches `CheckOutOfSyncForUser`; the job makes no Graph call when the user has no connection | unit + existing feature | `phpunit tests/Unit/Microsoft365/ForkIsolationTest.php` (local); `OutlookOutOfSyncJobTest` exists | Wave 0 / exists |
| OPS-02 | Unconfigured: all fork routes 404, props off, schedule filter false, data kept, re-enable restores | feature (CI) | `php artisan test tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` | Wave 0 |
| OPS-02 | `/calendar` shows no Outlook controls and makes no `/m365/` request when off | e2e (CI) | `npx playwright test e2e/outlook-off-switch.spec.ts` | Wave 0 |
| OPS-02 | Existing: unconfigured prop/routes/schedule | feature | `MicrosoftLoginPageTest`, `OutlookCalendarPropTest::test_unconfigured_integration_carries_no_calendar_block`, `OutlookOutOfSyncScheduleTest`, `MicrosoftAccountTest::test_unconfigured_integration_has_no_account_payload_on_the_profile` | exists |
| OPS-03 | Ledger lists every modified/deleted fork file; dry-run merge conflicts only inside the ledger | script (local) | the ledger completeness command and `git merge-tree --write-tree --name-only --no-messages HEAD upstream/main` from Pattern 4 | procedure, add to `UPSTREAM-MERGE.md` |
| OPS-03 | Merged tree: frontend and PHP gates green | CI | Gate W ten workflows green on the merge commit; locally `npx vitest run`, `npx prettier --check`, `npx eslint` on resolved files | CI |
| Healthcheck | scheduler and queue report healthy after deploy | manual (human-verify, post-deploy) | Dokploy container health; fallback chain in Pattern 5 | n/a |
| Entra | docs updated and valid; sign-in and Sync still work in production | script + manual | `node tests/Tools/m365-spike/validate-docs.mjs guide`, `runbook`, `secrets` (all must print `OK`); owner signs in with Microsoft and presses Sync | exists |

### Sampling Rate
- **Per task commit:** Gate U on touched `tests/Unit/Microsoft365` files, `npx vitest run` for touched frontend files, `vendor/bin/pint --test <touched>` and `vendor/bin/phpstan analyse` (Gate P).
- **Per wave merge:** push, then Gate W plus Gate B. CI is fail-fast across the Postgres jobs, so one red test can hide others.
- **Phase gate:** merge commit green on all ten workflows, DB backup taken, deploy done, healthchecks green, owner Entra checkpoint confirmed, then `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` — SEC-03 consolidated deletion matrix + schema cascade guard
- [ ] `tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` — SEC-04 route matrix, route canary, connect/disconnect/profile cases
- [ ] `tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` — OPS-02 consolidated
- [ ] `tests/Unit/Microsoft365/ForkIsolationTest.php` — static canaries (job dispatch site; every ledger path exists)
- [ ] `e2e/outlook-off-switch.spec.ts` — OPS-02 browser proof (add to the fork-owned list in the ledger)
- [ ] `docs/m365/UPSTREAM-MERGE.md` — repeatable merge and rollback procedure

## Security Domain

`security_enforcement` is enabled and `security_asvs_level` is 1 in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Microsoft sign-in (state + PKCE, tenant and domain checks); Phase 7 adds: no Connect under impersonation (identity-linking gap) |
| V3 Session Management | yes | Laravel session; the impersonation flag is a session key read by `GraphAccessGuard`; Connect session keys are pulled on every exit |
| V4 Access Control | yes | Guard + 404-instead-of-403 convention (no oracle); per-user scoping of every query; FK cascades for data lifecycle |
| V5 Input Validation | yes (unchanged) | Existing Form Requests and `whereUuid` route constraints; no new input surface |
| V6 Cryptography | yes (unchanged) | `encrypted` cast on tokens, never hand-rolled |
| V8 Data Protection | yes | Deletion completeness (SEC-03), no tokens in audits/logs/Inertia props, token columns `$hidden` |
| V14 Configuration | yes | Off switch (OPS-02), no secrets in the repo, spike secret removal, healthcheck and image pin |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin impersonation links their own Microsoft identity to the target (Connect) | Elevation of privilege / Spoofing | Guard the connect branch and callback; matrix test |
| Admin impersonation disconnects the user or purges their cache | Tampering / Denial of service | Guard `DELETE /user/microsoft`; matrix test |
| Admin impersonation reads the user's Microsoft email and Outlook data from Inertia props | Information disclosure | Omit `account` and `calendar` props while blocked |
| Residual personal data after account deletion (tokens, meetings with attendees, links) | Information disclosure | `ON DELETE CASCADE` FKs + schema guard test |
| Disabled integration still reachable (routes, jobs, props) | Elevation of privilege | `EnsureMicrosoftIsEnabled` 404 on every route, schedule filter, `enabled:false` prop, consolidated test |
| Compromised or forgotten secondary Entra secret/redirect URI (spike) | Spoofing | Owner deletes `spike-2026-10` and the localhost spike redirect URI (D-05) |
| Merge regression silently re-enabling an upstream default | Tampering | Ledger completeness check, CI gates, post-merge e2e (auth, profile) |

## Sources

### Primary (HIGH confidence)
- Repository files read in full this session: `app/Microsoft365/**` (service provider, config, routes, middleware, guard, token and sync services, controllers, job, commands, migrations, models docblocks), `app/Service/DeletionService.php`, `app/Service/MemberService.php:249-280` and removal section, `docs/deploy/dokploy-compose.fork.yml`, `docker/prod/Dockerfile`, `docker/prod/deployment/{healthcheck,start-container,supervisord*.conf}`, `.github/workflows/fork-image.yml`, `docs/m365/{TOUCHED-CORE-FILES,RUNBOOK-entra-app,GUIA-ADMIN-ENTRA}.md` (spike lines), `tests/Tools/m365-spike/validate-docs.mjs`
- Executed this session: `git fetch upstream`, `git merge-base`, `git merge-tree --write-tree`, throwaway-worktree `git merge --no-commit --no-ff`, `composer update` (lock recipe), `npx vitest run` (1790 tests passed), prettier/eslint on resolved files, `node tests/Tools/m365-spike/validate-docs.mjs guide|runbook|secrets` (all OK), `gh workflow list --all -R UntangleSL/solidtime`
- Upstream diffs read: `app/Service/DeletionService.php`, `app/Console/Kernel.php`, `config/heartbeat.php`, `app/Models/User.php`, `app/Service/{AuthenticationContract,IdentityConfirmationService,UserService}.php`, `app/Providers/{FortifyServiceProvider,AuthServiceProvider,AppServiceProvider}.php`, the three new migrations, `docker/prod/Dockerfile`, `composer.json`, `extensions/manifest.json`

### Secondary (MEDIUM confidence)
- [CITED: raw.githubusercontent.com/php/frankenphp/main/Dockerfile] base-image `HEALTHCHECK CMD curl -f http://localhost:2019/metrics || exit 1` in the `common` stage (main branch; the pinned 1.13 tag was not separately fetched)

### Tertiary (LOW confidence)
- Behaviour of `supervisorctl` default server URL inside the image, and the OAuth `intended` interaction (A1, A3): reasoned, not executed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is introduced.
- Architecture / gap audits (SEC-03, SEC-04, OPS-02): HIGH for the code read; the Connect exploit path is MEDIUM until a test executes it (A2).
- Merge rehearsal: HIGH, executed and reproducible with the commands above.
- Healthcheck fix: MEDIUM, cause verified from sources, fix not run in a container (A1).
- Pitfalls: HIGH for 1-6, MEDIUM for 7-8.

**Research date:** 2026-11-26
**Valid until:** 2026-12-03 for the merge facts (upstream moves; re-run `git merge-tree` before the real merge and re-check the conflict list), 30 days for the code audits.
