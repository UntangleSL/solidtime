# Architecture Research

**Domain:** Microsoft 365 SSO + Outlook meeting suggestions inside an existing Laravel 13 / Inertia / Vue 3 time tracker (solidtime fork)
**Researched:** 2026-10-19
**Confidence:** HIGH for integration seams (read from the actual code); HIGH for Graph behaviours quoted from Microsoft docs; MEDIUM for series-key behaviour and a few items marked inline (validate in Phase 0 spike)

## Standard Architecture

### Guiding decision: one fork-owned module, thin seams into core

Everything new lives in **new files** under two roots. Core files are touched only at a short, enumerated list of seams (see "Core Touch-Point Ledger").

- Backend root: `app/Microsoft365/` (namespace `App\Microsoft365\...`). Autoloaded by the existing `App\` PSR-4 mapping, so no `composer.json` edit. It owns its own service provider, routes file, migrations, config and console commands.
- Frontend root: `resources/js/m365/` (composables, API wrapper, components). Reached through `@/m365/...`.

Why not `extensions/Microsoft365/` (the upstream extension mechanism)? Verified in the repo: `.gitignore` ignores `/extensions/*` except three files, `extensions_autoload.php` only loads an extension that has its own `vendor/autoload.php`, the nwidart loader depends on a gitignored `modules_statuses.json`, and extension directories are meant to be checked out from `extensions/manifest.json`. An in-repo extension would need a `.gitignore` edit, a nested composer project and a Docker build change. `app/Microsoft365/` gives the same isolation with one line of core config.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Browser (Inertia + Vue 3)                                                    │
│  Auth/Login.vue ──► [MicrosoftSignInButton]      Pages/Calendar.vue          │
│                                                   │  (existing queries)      │
│                                                   ├─► useTimeEntriesCalendarQuery ──► /api/v1/.../time-entries (core)
│                                                   └─► [useM365CalendarOverlay]        │
│                                                        sync query · meetings query · selection store · mutations
│  TimeEntryCalendar ─slot:day-overlay─► [MeetingGhostLayer / OutOfSyncMarker]          │
│  CalendarToolbar   ─slot:actions────► [M365Toolbar: Sync, account, rules dialog]      │
│  [MeetingSelectionBar] (fixed bar, multi-select -> assign / dismiss)                  │
└───────────────┬───────────────────────────────────────────────┬──────────────────────┘
                │ top-level navigation (OAuth)                  │ JSON, session cookie + CSRF (web guard)
                ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ routes/microsoft365.php  (loaded by Microsoft365ServiceProvider, `web` group) │
│  /auth/microsoft/{redirect,callback}        /m365/api/organizations/{org}/... │
│  MicrosoftAuthController                    MeetingController, SyncController │
│                                             AssignmentController, RuleController, AccountController
└───────────────┬───────────────────────────────────────────────┬──────────────┘
                ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ App\Microsoft365 services (stateless, Octane-safe)                            │
│  MicrosoftIdentityResolver ─► MicrosoftUserProvisioner ──► (core) MemberService│
│  MicrosoftTokenManager  ◄──── GraphClient (Http::, timeouts, Retry-After)     │
│  MeetingSyncService ─► MeetingEligibility, LinkReconciler (out-of-sync)       │
│  MeetingAssignmentService ─► (core) BillableRateService, Recalculate* jobs    │
│  SeriesRuleService                                                            │
└───────────────┬───────────────────────────────────────────────┬──────────────┘
                ▼                                               ▼
┌───────────────────────────────────────┐   ┌──────────────────────────────────┐
│ Fork tables (PostgreSQL)              │   │ External                         │
│  microsoft_accounts   (tokens, oid)   │   │  login.microsoftonline.com/{tid} │
│  m365_meetings        (cache)         │   │  graph.microsoft.com/v1.0        │
│  m365_meeting_links   (meeting↔entry) │   └──────────────────────────────────┘
│  m365_series_rules                    │
│  FK → users / organizations / time_entries / projects (ON DELETE CASCADE)     │
└───────────────────────────────────────┘
        core tables read/written only through: time_entries (INSERT via assignment service)
```

### Component Responsibilities

| Component | Responsibility | Talks to |
|-----------|----------------|----------|
| `Microsoft365ServiceProvider` | Registers routes (`loadRoutesFrom`), migrations (`loadMigrationsFrom`), config (`mergeConfigFrom`, including a `services.microsoft` block so `config/services.php` is not edited), console commands, the `Inertia::share('m365', ...)` prop for the login button, the `User::deleting` cleanup listener | Laravel container, Socialite, Inertia |
| `MicrosoftAuthController` | Redirect to Entra (state + PKCE, single-tenant authority), handle callback, `tid` claim check, login or link, session regeneration | `MicrosoftIdentityResolver`, `MicrosoftTokenManager` |
| `MicrosoftIdentityResolver` | Resolve an Entra identity (`tid`+`oid`) to a solidtime `User`: match by oid, else link by lower-cased email (non-placeholder), else provision | `MicrosoftUserProvisioner`, `User` |
| `MicrosoftUserProvisioner` | Create passwordless verified user and add as Member of the configured Untangle org | core `MemberService::addMember(..., asSuperAdmin: true)` |
| `MicrosoftTokenManager` | Store tokens (encrypted), return a valid access token, refresh under a cache lock, mark `needs_reauth` on `invalid_grant` | `MicrosoftAccount`, Entra token endpoint |
| `GraphClient` | One method per Graph call (`calendarView`, `getEvent`); sets `Prefer: outlook.timezone="UTC"` and `Prefer: IdType="ImmutableId"`; timeouts; 429/503 handling; maps JSON to `MeetingData` DTOs | Graph |
| `MeetingEligibility` | Pure function: `MeetingData` -> `active` / `cancelled` / `declined` / `ineligible` (all-day) | none |
| `MeetingSyncService` | Fetch window, upsert cache, reconcile removals, point-lookup missing linked meetings, call `LinkReconciler` | `GraphClient`, `MeetingEligibility`, `LinkReconciler`, models |
| `LinkReconciler` | Compare current meeting state with link snapshot; set/clear `out_of_sync` | `MeetingLink` |
| `MeetingAssignmentService` | Turn meeting(s) into real `TimeEntry` rows plus link rows, per-item results | core `TimeEntry`, `BillableRateService`, `RecalculateSpentTimeFor*` jobs, `PermissionStore` |
| `SeriesRuleService` | CRUD for rules; resolve rule per meeting at read time | `SeriesRule` |
| HTTP controllers (fork) | Thin: Form Request, permission check, delegate to service, return Resource | services |
| `resources/js/m365/*` | Query/mutation composables and components; all UI for ghosts, selection, sync, rules | fork JSON API; reads core query cache keys |

## Recommended Project Structure

```
app/Microsoft365/
├── Microsoft365ServiceProvider.php
├── config/microsoft365.php            # tenant_id, client_id, client_secret (env via config only), org id, role, default tz, redirect uri
├── routes/microsoft365.php
├── database/migrations/               # fork migrations, kept out of database/migrations/
├── Auth/                              # MicrosoftAuthController, MicrosoftIdentityResolver, MicrosoftUserProvisioner
├── Token/MicrosoftTokenManager.php
├── Graph/                             # GraphClient, MeetingData (DTO), Exceptions/ (Throttled, ReauthRequired, GraphUnavailable)
├── Sync/                              # MeetingSyncService, MeetingEligibility, LinkReconciler, SyncResult
├── Assignment/MeetingAssignmentService.php
├── Rules/SeriesRuleService.php
├── Models/                            # MicrosoftAccount, Meeting, MeetingLink, SeriesRule  (NOT Auditable)
├── Http/{Controllers,Requests,Resources}/
└── Console/                           # m365:sync {user}, m365:prune
tests/Feature/Microsoft365/            # Http::fake based; no real Graph in CI

resources/js/m365/
├── api.ts, types.ts                   # axios wrapper (global axios, session cookie) + local zod/TS types
├── useM365CalendarOverlay.ts          # single entry composable used by Calendar.vue
├── useMeetingsQuery.ts, useM365Sync.ts, useMeetingMutations.ts, useMeetingSelection.ts, useM365Account.ts
└── components/                        # MeetingGhostLayer, MeetingGhostBlock, OutOfSyncMarker, MeetingSelectionBar,
                                       # MeetingAssignDialog, M365Toolbar, MeetingRulesDialog, MicrosoftSignInButton
```

### Structure Rationale

- **Module in `app/Microsoft365/`:** brand-new directory upstream will never touch, PSR-4 for free, analysed by PHPStan level 7 like the rest of `app/`, and `tests/Feature/Microsoft365/` is a new directory too.
- **Fork migrations outside `database/migrations/`:** no timestamp ordering collisions with upstream. Tests load `database/schema/pgsql_test-schema.sql` and then run migrations, and `loadMigrationsFrom` paths run on top, so test setup is unchanged.
- **JSON endpoints on the `web` group, not `/api/v1`:** verified that Scramble documents everything under `api` (`config/scramble.php` `api_path`) and that the generated `openapi.json` and `openapi.json.client.ts` are committed. Putting fork endpoints in `/api/v1` forces regenerating both on every upstream merge. A `/m365/api/...` route group using `auth:web`, `verified` (the same session guard Inertia pages use; `CreateFreshApiToken` is irrelevant) needs no OpenAPI churn and respects the "do not mix guards" rule. CSRF works because axios already sends the XSRF cookie.
- **UI under `resources/js/m365/`:** components are imported by the few core files that gain a slot, never the reverse. Rules management and the account status live in a dialog opened from the calendar toolbar, so the sidebar (`AppLayout.vue`) is not edited.

## Data Model

All ids are UUIDs (core `HasUuids` pattern, `$table->uuid('id')->primary()`). Timestamps are UTC `timestampTz`/`dateTime` like core. Every FK to core tables is `ON DELETE CASCADE` so `DeletionService` (which deletes entities by query, not by model) never hits an FK violation.

### `microsoft_accounts` (identity + tokens, one row per user)

| Column | Notes |
|--------|-------|
| `id`, `user_id` (unique, FK users cascade) | one Microsoft identity per user (single tenant) |
| `tenant_id`, `microsoft_oid` | unique `(tenant_id, microsoft_oid)`. **oid is the identity key, never the email claim.** |
| `microsoft_email` | display / audit of what matched |
| `access_token`, `refresh_token` | `text`, Eloquent `encrypted` cast; `$hidden`; **model does not use `CustomAuditable`** |
| `access_token_expires_at`, `scopes` | |
| `calendar_connected` (bool), `needs_reauth` (bool) | `disconnect` nulls tokens and sets `calendar_connected=false`, keeps the identity so SSO login still works |
| `last_synced_at`, `last_sync_error` | non-secret diagnostics for the toolbar |

No `Auditable` means no audit rows and no morph-map entry. This matters: `AppServiceProvider` calls `Relation::enforceMorphMap([...])`, so any fork model that became auditable would force an edit of that hot file.

### `m365_meetings` (suggestion cache, per user, not per organization)

Outlook is user-level data; the organization only enters at assignment time.

| Column | Notes |
|--------|-------|
| `id`, `user_id` (FK cascade) | |
| `graph_event_id` | immutable id (`Prefer: IdType="ImmutableId"`); unique `(user_id, graph_event_id)` |
| `series_master_id` (nullable, indexed), `ical_uid`, `event_type`, `original_start` | `event_type` in singleInstance / occurrence / exception |
| `subject`, `start_at`, `end_at` | UTC; index `(user_id, start_at)` |
| `is_organizer`, `response_status`, `show_as`, `is_online_meeting`, `web_link`, `organizer_name` | **no body, no attendee list** (data minimisation) |
| `graph_state` | `active` / `cancelled` / `declined` / `removed` (Outlook-driven) |
| `dismissed_at` (nullable) | user-driven; **upsert must never reset it** |
| `graph_last_modified`, `graph_change_key`, `last_seen_at` | change detection, pruning |

Rule: only eligible events create rows; an existing row whose event becomes cancelled/declined/missing is updated to the new `graph_state` rather than deleted, because a link may depend on it.

### `m365_meeting_links` (meeting becomes a time entry)

| Column | Notes |
|--------|-------|
| `id`, `meeting_id` (unique, FK cascade), `time_entry_id` (unique, FK cascade), `user_id`, `organization_id` (FK cascade) | one occurrence to one entry. Deleting the entry cascades the link, so the meeting returns to "suggested". |
| `snapshot_start_at`, `snapshot_end_at` | meeting times at link (or last acknowledge) |
| `sync_state` | `in_sync` / `out_of_sync` |
| `out_of_sync_reason` | `time_changed` / `cancelled` / `declined` / `removed` |
| `out_of_sync_detected_at`, `acknowledged_at` | |
| `created_via` | `manual` / `rule` |

Deliberately **no new columns on `time_entries`**: `TimeEntry::SELECT_COLUMNS`, `TimeEntryResource`, exports, reports, aggregation, audits and the generated zod client stay untouched. The "out of sync" fact is delivered by a separate fork endpoint and joined client-side.

### `m365_series_rules`

| Column | Notes |
|--------|-------|
| `id`, `user_id`, `organization_id` (FK cascade) | rule is per user and per org because projects are org-scoped |
| `series_master_id` | unique `(user_id, organization_id, series_master_id)` |
| `ical_uid`, `series_subject` | fallback key and display label |
| `project_id` (FK cascade), `task_id` (nullable, FK null on delete), `tags` (json), `billable` (bool), `description` (nullable) | |

**Rules are resolved at read time, not copied onto meetings.** `GET meetings` loads the rule rows for the `series_master_id`s in the window in one query and attaches `suggested_assignment`. Editing or deleting a rule therefore changes all pending suggestions immediately ("future and current unassigned occurrences") with no backfill job. Confirmation is still per occurrence (assign with `use_rule: true`).

### Series identity (the one genuinely uncertain data point)

Microsoft's `event` docs say `iCalUId` "is different for each occurrence in a recurring series", while a 2020 Microsoft 365 dev blog describes an intended per-series value and a fix that may or may not have shipped (could not be settled from sources). `seriesMasterId` is documented as "the ID for the recurring series master item" and `calendarView` returns it on every occurrence and exception. **Use `seriesMasterId` (with ImmutableId) as the rule key; store `iCalUId` only as a fallback.** ImmutableId survives moves between folders but changes if the item moves to an archive mailbox or is exported and re-imported. A known Outlook behaviour (one edit producing a second series master) can orphan a rule; see Pitfalls. Phase 0 must run a real `calendarView` against a recurring Untangle meeting and record what `iCalUId`/`seriesMasterId` do.

## Architectural Patterns

### Pattern 1: Fork-owned module with a Laravel service provider
**What:** All routes, migrations, config, listeners live behind `Microsoft365ServiceProvider`; core gets exactly one registration line in `config/app.php` `providers` (this project lists providers there; there is no `bootstrap/providers.php`).
**When:** Any feature that must survive upstream merges.
**Trade-off:** One-line merge-conflict surface (`config/app.php`) versus none for composer package discovery, which would need a `composer.json` edit anyway.

```php
public function boot(): void
{
    $this->mergeConfigFrom(__DIR__.'/config/microsoft365.php', 'microsoft365');
    $this->mergeConfigFrom(__DIR__.'/config/services.php', 'services'); // adds services.microsoft only
    $this->loadMigrationsFrom(__DIR__.'/database/migrations');
    $this->loadRoutesFrom(__DIR__.'/routes/microsoft365.php');
    Inertia::share('m365', fn () => ['enabled' => config('microsoft365.enabled')]);
    User::deleting(fn (User $u) => app(MicrosoftTokenManager::class)->forgetFor($u));
}
```

### Pattern 2: Read from cache, sync as a separate call
**What:** `GET /meetings` never calls Graph. `POST /sync` does. The calendar paints from cache instantly, then the sync result invalidates the meetings query.
**When:** Always; Graph latency or failure must never block the calendar (`useTimeEntriesCalendarQuery` shows a full loading state when `loading` is true, so keep Graph out of that path).
**Trade-off:** Two round trips on open, but failure isolation and a trivial "Sync" button (`refetch({force:true})`).

### Pattern 3: Overlay layer through slots, not new props
**What:** `TimeEntryCalendar` is an 827-line component with a long prop and event surface; `CalendarDayColumn` already renders an `activityBoxes` overlay through props. Instead of threading more props, add **three named slots** and implement ghosts in fork-owned components: `CalendarToolbar` slot `actions`, `CalendarDayColumn` slot `overlay` (slot props: `dayStr`, `minutesToPixels`, `calendarSettings`), re-exported by `TimeEntryCalendar` as `#toolbar-actions` and `#day-overlay`.
**When:** Adding any renderable layer to the calendar.
**Trade-off:** Slightly unusual slot-prop plumbing; far smaller diffs than prop threading.

Ghost block rules: dashed, translucent, lower z-order than real entries; `@pointerdown.stop` so the column's slot-selection drag (`guardedSlotPointerDown`) does not start; click toggles selection, shift/ctrl-click multi-selects; linked meetings render no ghost (the real entry is there). **Out-of-sync is drawn by the same layer**: an amber dashed outline at the meeting's *current* Outlook time with "Outlook changed / cancelled" and Keep / Update actions. That avoids editing `FullCalendarEventContent.vue` or the core event rendering at all.

### Pattern 4: Cross-cache invalidation without editing core mutations
**What:** `useM365CalendarOverlay` registers one `queryClient.getMutationCache().subscribe(...)` listener that invalidates `['m365']` whenever any mutation succeeds that touches time entries. Core mutations already invalidate `['timeEntries']`; the fork's own mutations invalidate both.
**Why:** Deleting or editing a linked entry from the calendar must refresh ghost state, and `useTimeEntriesMutations.ts` should not be edited.
**Alternative rejected:** editing `useTimeEntriesMutations.ts` (hot, frequently changed upstream).

### Pattern 5: Server-side assignment service, per-item results
**What:** `POST /m365/api/organizations/{org}/assignments` accepts `items: [{meeting_id, project_id?, task_id?, tags?, billable?, description?, use_rule?}]` and returns `[{meeting_id, status: created|skipped|failed, time_entry_id?, error?}]`. Each item runs in its own `DB::transaction` with `lockForUpdate` on the meeting row, so concurrent double-clicks cannot create two entries (the unique `meeting_id` on links is the backstop).
**Why not the frontend two-step (`POST /time-entries` then `POST /link`)?** It is zero duplication but non-atomic: an entry can exist without its link, the meeting stays a suggestion and the user logs it twice. The batch case amplifies this.
**Why not call core?** Verified: the create logic lives in `TimeEntryController::storeTimeEntry` (private, controller-bound); `TimeEntryService` only contains rounding SQL. The fork service therefore re-implements the small creation path. Copy exactly what the controller does: member must be the caller's member in that org (`time-entries:create:own` via `PermissionStore::userHas`), project and task visibility/belonging, `billable` forced false when `BillingContract::canUseBillableRates` is false, `client()->associate(project->client)`, `setComputedAttributeValue('billable_rate')`, then dispatch `RecalculateSpentTimeForProject/Task`, plus the **overlap check** when `organization->prevent_overlapping_time_entries` (the core check is a private controller method; copy the three-case query and keep a parity test). Apply `check-organization-blocked` middleware (needs the `organization` route param, hence org-in-path).
**Mitigation for drift:** a PHPUnit parity test creating the same entry through `POST /api/v1/.../time-entries` and through the assignment service and asserting identical `billable`, `billable_rate`, `client_id`, `type`. It fails loudly if upstream changes the creation rules.

### Pattern 6: Window reconcile with point-lookup for linked meetings
**What:** `calendarView` returns expanded occurrences for a window and does not report deletions. Sync therefore (1) pages through the window, (2) upserts eligible events and updates `graph_state` of known-but-ineligible ones, (3) for cached rows inside the window **not returned**, marks unlinked ones `removed`, but for **linked** ones calls `GET /me/events/{id}`: 404 means deleted (`removed`), 200 means it moved out of the window or changed (update times), (4) runs `LinkReconciler` over touched linked meetings.
**Why:** a meeting dragged to next month is "missing" from this window but not deleted; flagging it `cancelled` would be a false alarm on the one thing the product promises to get right.
**Why not delta:** `calendarView/delta` requires a start/end per round, no `$select`/`$filter`, and returns `@removed` entries for events outside the range too; per-window delta tokens add state with little benefit for a team-sized, on-demand sync. Windowed full fetch plus reconcile is simpler and sufficient. Revisit only if Graph throttling shows up.

### Pattern 7: Token manager as the only code that touches tokens
**What:** Controllers and `GraphClient` never read `microsoft_accounts.*_token`. `MicrosoftTokenManager::accessTokenFor(MicrosoftAccount)` refreshes when `expires_at - 120s` is past, under `Cache::lock('m365:refresh:'.$accountId, 10)` (Entra rotates refresh tokens; two concurrent refreshes would race). `invalid_grant` or `interaction_required` sets `needs_reauth`, the API returns a typed `reauth_required` status, and the UI shows "Reconnect Microsoft" (same OAuth route). Core already uses the same `Cache::lock` idiom for running time entries.

## Data Flow

### 1. Sign-in (first time, link, or return)

```
Login.vue [Sign in with Microsoft] ──GET──► /auth/microsoft/redirect
   state + PKCE verifier in session; authority https://login.microsoftonline.com/{tenant_id}
   scopes: openid profile email offline_access User.Read Calendars.Read
   ◄── 302 Entra ──► user MFA/consent ──► /auth/microsoft/callback?code&state
MicrosoftAuthController:
   validate state+PKCE → exchange code → verify id_token tid == config tenant → read oid
   identity = MicrosoftIdentityResolver:
        by (tid,oid)              → existing user
        else by lower(email), is_placeholder=false → link (create microsoft_accounts row)
        else MicrosoftUserProvisioner → User(password null, email_verified_at=now, tz default)
                 + MemberService::addMember($user, $untangleOrg, Role::Employee, asSuperAdmin: true)
   MicrosoftTokenManager::store(tokens encrypted)
   Auth::guard('web')->login($user, remember) ; session()->regenerate()
   redirect to session('url.intended') ?? route('dashboard')
```

Integration facts that shape this flow (all verified in code):
- Do **not** use `UserService::createUser`: it requires a password, hashes it, and creates a personal organization when there is no accepted invitation. Use a fork provisioner.
- `MemberService::addMember(..., asSuperAdmin: true)` skips the `MemberAdding`/`MemberAdded` events (billing limits) and also merges any placeholder member with the same email into the new member, which gives historical data to imported placeholders for free.
- Registration mode (`RegistrationMode::Off`/`InviteOnly`) lives in `CreateNewUser`, so SSO provisioning is not affected; the tenant check is the gate.
- Fortify's `authenticateUsing` closure and 2FA are bypassed by a direct `login()`; Entra MFA is the second factor. Passwordless users also skip `auth.session` password-hash checks (MEDIUM: confirm `AuthenticateSession` behaviour with a null password in a test).
- Local users must always be looked up with `is_placeholder = false`; placeholder users can share an email.
- Login button visibility comes from `Inertia::share('m365', ...)` registered in the fork provider; `Auth/Login.vue` gets a small component import.

### 2. Opening the calendar (sync on open)

```
Calendar.vue mounts → TimeEntryCalendar emits dates-change(start,end)
 ├─► useTimeEntriesCalendarQuery (core, unchanged)  ──► /api/v1/.../time-entries
 └─► useM365CalendarOverlay(calendarStart, calendarEnd)
       window = getExpandedCalendarDateRange(start,end)   // exported by core util; same prev+cur+next window
       a) meetings query  GET /m365/api/organizations/{org}/calendar?start&end   (cache only, instant)
              → { meetings:[…+suggested_assignment], linked:[{time_entry_id, meeting, sync_state, reason}], account:{connected, needs_reauth, last_synced_at} }
       b) sync query      POST /m365/api/sync {start,end}  staleTime 120s; Sync button = refetch(force)
              server: per-user Cache::lock('m365:sync:'.$userId, 30) → MeetingSyncService
              returns { status: ok|reauth_required|throttled|error, counts, synced_at }
       c) on sync success → invalidate ['m365','calendar'] → ghosts update
```

`GraphClient` calls use a hard overall budget (about 15 s: `Http::timeout(8)->connectTimeout(3)`, at most two retries, honouring `Retry-After` only if short, otherwise return `throttled`). Pagination is sequential, because Outlook allows few concurrent requests per mailbox per app (throttling doc, MEDIUM from memory). Queue stays `sync`: no worker required, no webhook, consistent with the out-of-scope decisions.

### 3. Assign meetings to a project (single and multi-select)

```
click / shift-click ghosts → useMeetingSelection (Pinia/module ref: Set<meetingId>)
MeetingSelectionBar → MeetingAssignDialog (reuses core project/task/tag pickers from @solidtime/ui)
   POST /m365/api/organizations/{org}/assignments {items:[…]}
   MeetingAssignmentService per item (txn): lock meeting → check active & unlinked →
        create TimeEntry(start=start_at,end=end_at,description=subject,member/user,org,project,task,tags,billable)
        → MeetingLink(snapshot_start/end, created_via) → after-commit Recalculate jobs
   ◄── per-item results → toast summary; failures (overlap, project not visible) listed
   invalidate ['timeEntries'] and ['m365']
```

### 4. Create and apply a series rule

```
Ghost popover on an occurrence with series_master_id → "Always assign this series to…"
   POST /m365/api/organizations/{org}/series-rules {meeting_id, project_id, task_id?, tags, billable}
   server derives series_master_id from the meeting row (client never supplies the key)
   next GET /calendar → every pending occurrence carries suggested_assignment (computed on read)
   "Confirm N pre-assigned" → POST assignments {items:[{meeting_id, use_rule:true}, …]}
   Rules dialog (toolbar): list / edit / delete → GET/PUT/DELETE series-rules
```

### 5. Outlook changed after logging (out-of-sync)

```
sync touches linked meeting M (link L, snapshot S)
  M.graph_state in (cancelled, declined, removed)   → L.out_of_sync, reason cancelled|declined|removed
  M.start/end != S.start/end                        → L.out_of_sync, reason time_changed
  M matches S again                                 → clear flag (auto-heal)
  NEVER writes to time_entries.
UI: OutOfSyncMarker at current Outlook time (or at old time for cancelled) with
    [Keep my entry]  → POST acknowledge (snapshot := current, flag cleared)
    [Update entry]   → explicit user action: calls the core PUT /time-entries/{id} with the new times
                       (core overlap/permission rules apply), then acknowledge
    delete entry     → normal core delete; link cascades; meeting becomes a suggestion again
```

### 6. Account lifecycle

`Disconnect` (toolbar): `calendar_connected=false`, tokens nulled, cached meetings of unlinked state purged (links kept). If the user has no password, full unlink is refused so they cannot lock themselves out. User deletion: FK cascade on `users`, plus the `User::deleting` listener so any future revoke logic has one home. Microsoft offers no per-app revoke for a delegated refresh token short of `revokeSignInSessions` (which signs the user out of everything), so "revoked" means "destroyed locally" and the UI should link to the user's Microsoft app-permissions page. Do not claim server-side revocation.

## State Management

```
Server state (TanStack Query)
  ['timeEntries','calendar',…]            core, unchanged
  ['m365','calendar',{start,end,org}]     meetings + linked + account  (staleTime ~30s like core)
  ['m365','sync',{start,end,org}]         mutation-like query, staleTime 120s, forced by button
  ['m365','rules',org]                    rules dialog
Client state
  selection: Set<meetingId> (cleared on org change, view change, and after assign)
```

Keep the `m365` key prefix distinct from `timeEntries` so the two caches are independent, bridged only by Pattern 4.

## Core Touch-Point Ledger (the only edits outside fork-owned paths)

| File | Edit | Size | Merge risk |
|------|------|------|------------|
| `config/app.php` | add `Microsoft365ServiceProvider::class` | 1 line | low |
| `resources/js/Pages/Auth/Login.vue` | import + render `MicrosoftSignInButton` | ~3 lines | low |
| `resources/js/Pages/Calendar.vue` | call `useM365CalendarOverlay`, pass slots/mount selection bar | ~10 lines | medium (file changes upstream) |
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | forward `toolbar-actions` and `day-overlay` slots | ~6 lines | medium (827-line hot file) |
| `resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue` | `<slot name="overlay" ...>` inside the events container | ~3 lines | medium |
| `resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue` | `<slot name="actions">` next to settings | ~1 line | low |
| `.env.example` | document `M365_*` variables | few lines | low |

Explicitly **not** edited: `TimeEntryController.php`, `routes/api.php`, `routes/web.php`, `AppServiceProvider.php`, `config/services.php`, `FortifyServiceProvider.php`, `UserService.php`, `DeletionService.php`, `HandleInertiaRequests.php`, `useTimeEntriesMutations.ts`, `openapi.json`, `openapi.json.client.ts`, `TimeEntry.php`/`TimeEntryResource.php`. Everything those would have needed is done through provider hooks (`loadRoutesFrom`, `Inertia::share`, `User::deleting`, `mergeConfigFrom`), FK cascades, or the mutation-cache listener. Add a CI/grep check listing this ledger so an upstream merge that grows the diff is noticed.

## Build Order (dependency-driven)

```
P0 spike ─► P1 foundation+SSO ─► P2 graph+sync+cache ─► P3 calendar ghosts ─► P4 assignment ─┬─► P5 series rules
                                                                                             └─► P6 out-of-sync
                                                                                                    └─► P7 hardening
```

1. **Phase 0, spike and environment (no product code).** Entra app registration in the Untangle tenant, redirect URI on the Dokploy HTTPS URL, client secret into env, consent. Run real `calendarView` against a recurring meeting and record: `seriesMasterId`, `iCalUId` per occurrence, `type`, `responseStatus` values, `isCancelled` behaviour for cancelled and declined meetings, page size. Also test whether `Calendars.ReadBasic` is enough (it excludes only body, attendees and extensions per its permission description, MEDIUM; `Calendars.Read` is the documented requirement, so keep it unless the spike proves otherwise). Output: confirmed series key and fixtures for `Http::fake` tests.
2. **Phase 1, module skeleton + Microsoft sign-in.** Provider, config, `microsoft_accounts` migration with encrypted casts, OAuth flow (state, PKCE, `tid` check), identity resolver and provisioner, token storage, login button, disconnect, deletion cleanup. Nothing else depends on Graph yet. Dependency for everything: tokens and the module skeleton.
3. **Phase 2, Graph client + sync + cache (backend only).** `GraphClient`, `MicrosoftTokenManager` refresh, `m365_meetings`, eligibility rules, windowed reconcile, point-lookup, `m365:sync {user}` artisan command for verification, `GET calendar` read endpoint. Build `LinkReconciler` as an interface with a no-op implementation so Phase 6 plugs in without changing the sync service. Testable end to end with `Http::fake` and no UI.
4. **Phase 3, calendar ghosts (read-only) + sync UX + dismiss.** The three slots, `MeetingGhostLayer`, `useM365CalendarOverlay`, sync-on-open, Sync button, reauth banner, dismiss. First user-visible value; proves the slot approach and pointer-event handling before any write path exists. Needs Phase 2 endpoints.
5. **Phase 4, assignment to time entries (single and batch).** `m365_meeting_links`, `MeetingAssignmentService`, selection store and bar, assign dialog, parity test against core creation. Needs Phase 3 selection UI and the core project/task pickers.
6. **Phase 5, recurring series rules.** `m365_series_rules`, read-time resolution, create-from-meeting, rules dialog (list/edit/delete), "confirm N pre-assigned". Needs Phase 4 (assignment with `use_rule`) and the Phase 0 series-key decision.
7. **Phase 6, out-of-sync detection and resolution.** Real `LinkReconciler`, `sync_state` columns in use, `OutOfSyncMarker`, acknowledge and "update entry" actions. Needs Phase 4 links and Phase 2 point-lookup. Can run in parallel with Phase 5 (disjoint tables and UI).
8. **Phase 7, hardening and release.** Throttling and error UX, prune command, token-redaction review (logs, Telescope, exception context on the callback URL), Docker/Dokploy env docs, Playwright happy path, an upstream-merge rehearsal against the ledger.

Roadmap research flags: Phase 0 and Phase 2 need the deepest verification (real-tenant Graph behaviour, series identity, removed/cancelled semantics); Phase 3 needs a focused look at `useSlotSelection.ts` / `useEventDrag.ts` pointer handling; Phases 1, 4, 5, 6 follow well-trodden patterns once those are settled.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Untangle team (tens of users) | Everything above. On-demand sync, per-user lock, `sync` queue. No worker, no cron. |
| A few hundred users | Still fine. Add short server-side memo (skip Graph if `last_synced_at` for that window under 60 s) to absorb tab spam; index `(user_id, start_at)` already present. |
| Thousands, or Graph throttling observed | Move sync to a queued job with the same service; add `calendarView/delta` per rolling window; webhooks are an explicit non-goal today. |

First bottleneck is Graph itself (few concurrent requests per mailbox per app, `429` with `Retry-After`), not the database. Second is the synchronous request holding an Octane worker while Graph is slow, mitigated by the strict time budget.

## Anti-Patterns

### Anti-Pattern 1: Meetings as `time_entries` rows (type or flag)
**What people do:** insert suggestions as time entries with a `suggested` flag so the calendar renders them for free.
**Why it's wrong:** reports, exports, aggregation, goals, billable totals, still-running mails and the overlap check all read `time_entries`; every one would need an exclusion. This directly violates "ghosts do not count as tracked time" and touches the most-merged table.
**Do this instead:** separate `m365_meetings` cache and a link table; the entry is created only on assignment.

### Anti-Pattern 2: Adding the out-of-sync flag as a `time_entries` column
**What people do:** `ALTER TABLE time_entries ADD out_of_sync`.
**Why it's wrong:** changes `SELECT_COLUMNS`, `TimeEntryResource`, the OpenAPI spec and the generated client, and invites auditing noise.
**Do this instead:** keep the flag on the link row and join by `time_entry_id` in a fork endpoint.

### Anti-Pattern 3: Calling Graph inside `GET` that the calendar blocks on
**What people do:** make the meetings endpoint sync-then-return.
**Why it's wrong:** one slow or throttled Graph call freezes the whole calendar and ties up an Octane worker.
**Do this instead:** Pattern 2.

### Anti-Pattern 4: Identity by email claim
**What people do:** match or create users purely from the `email` claim.
**Why it's wrong:** Entra's `email` claim is mutable and not guaranteed verified; it is the root of the nOAuth class of account takeover. Single tenant reduces but does not remove the risk (any tenant admin can set a UPN).
**Do this instead:** `tid`+`oid` as the durable identity; email only to link an existing local account once, then never again.

### Anti-Pattern 5: Treating "absent from the window" as "cancelled"
**What people do:** mark every cached row not returned by `calendarView` as deleted.
**Why it's wrong:** a meeting moved outside the window looks identical; users would see false "cancelled" flags on logged hours.
**Do this instead:** Pattern 6 point-lookup for linked meetings.

### Anti-Pattern 6: Hand-merging generated artifacts
**What people do:** put fork endpoints in `/api/v1` and commit regenerated `openapi.json` / `openapi.json.client.ts`.
**Why it's wrong:** guaranteed conflicts on every upstream merge.
**Do this instead:** fork routes on the web group; hand-written typed wrapper in `resources/js/m365/api.ts`.

### Anti-Pattern 7: Making fork models `Auditable` or logging token-bearing payloads
**What people do:** copy `CustomAuditable` from other models.
**Why it's wrong:** audit rows would capture token attributes, and `enforceMorphMap` would demand an `AppServiceProvider` edit.
**Do this instead:** plain Eloquent models, `$hidden`, `encrypted` casts; never `Log::` a Graph/token response.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Microsoft Entra ID | Authorization code + PKCE, authority `https://login.microsoftonline.com/{tenant_id}` (single tenant), scopes `openid profile email offline_access User.Read Calendars.Read` | Validate `state`, `tid`. Refresh tokens rotate; refresh under lock. Conditional Access or 90-day inactivity can force re-auth: surface as `needs_reauth`, never as a 500. |
| Microsoft Graph `GET /me/calendarView` | Window fetch with `startDateTime`/`endDateTime` (ISO 8601, offset-aware), `Prefer: outlook.timezone="UTC"`, `Prefer: IdType="ImmutableId"`, explicit `$select`, sequential `@odata.nextLink` paging | Returns occurrences, exceptions and single instances already expanded. Default page is small; set a page size. `createdDateTime`/`lastModifiedDateTime` are not `$select`-able, so omit `$select` or accept they are always returned. |
| Microsoft Graph `GET /me/events/{id}` | Point-lookup for linked meetings missing from a window | 404 = deleted. |
| Dokploy / HTTPS | Redirect URI must equal the public HTTPS URL exactly | Behind a proxy set trusted proxies/`APP_URL` so Socialite builds the correct callback URL. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Fork module -> core models | Direct Eloquent on `User`, `Member`, `Organization`, `TimeEntry`, `Project`, `Task`; reads only, except `TimeEntry` creation in the assignment service and `MemberService::addMember` | Core never references fork classes (no core->fork imports except provider registration and the slot consumers in Vue). |
| Fork -> `PermissionStore` | `userHas($org,$user,'time-entries:create:own')` | Reuses role definitions; no new permissions. |
| Fork -> `BillingContract` | Respect `canUseBillableRates` and `check-organization-blocked` | Keeps behaviour identical to manual entry creation. |
| `resources/js/m365` -> core Vue | Imports core pickers and query helpers (`getExpandedCalendarDateRange`, `getCurrentOrganizationId`) | One-directional. Core files import only the slot content components. |
| Vue core -> fork | Slots only | If upstream removes a slot anchor the build still works; ghosts just stop rendering (graceful degradation). |

## Sources

- Codebase (verified by reading): `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `.planning/PROJECT.md`; `app/Http/Controllers/Api/V1/TimeEntryController.php` (store/update/assertNoOverlap), `app/Service/TimeEntryService.php`, `app/Service/MemberService.php`, `UserService.php`, `DeletionService.php`, `app/Providers/{AppServiceProvider,FortifyServiceProvider,RouteServiceProvider}.php`, `config/app.php` (provider list), `config/modules.php`, `.gitignore`, `extensions/extensions_autoload.php`, `resources/js/Pages/Calendar.vue`, `useTimeEntriesCalendarQuery.ts`, `useTimeEntriesMutations.ts`, `FullCalendar/{TimeEntryCalendar,CalendarDayColumn,CalendarToolbar,useActivityBoxes}.*` (HIGH)
- Microsoft Graph `event` resource (property semantics for `iCalUId`, `id`, `seriesMasterId`, `type`, `originalStart`): https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0 (HIGH)
- Microsoft Graph List calendarView (required params, timezone header, permissions): https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0 (HIGH)
- Microsoft Graph event delta (calendarView delta constraints, `@removed` semantics): https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0 (HIGH)
- Immutable identifiers for Outlook resources (header, lifetime, caveats): https://learn.microsoft.com/en-us/graph/outlook-immutable-id (HIGH)
- iCalUId behaviour is contested: Microsoft 365 dev blog "Microsoft Graph calendar events iCalUId update" https://devblogs.microsoft.com/microsoft365dev/microsoft-graph-calendar-events-icaluid-update/ versus the current `event` doc; and PnP write-up on one Outlook edit producing two series masters https://pnp.github.io/blog/post/one-outlook-edit-became-two-microsoft-graph-events/ (LOW to MEDIUM, validate in Phase 0)
- Graph throttling limits per mailbox (concurrency, retry-after), recalled from Microsoft throttling guidance, not re-fetched this session (MEDIUM)

---
*Architecture research for: Microsoft 365 SSO + Outlook meeting suggestions in solidtime (Untangle fork)*
*Researched: 2026-10-19*
