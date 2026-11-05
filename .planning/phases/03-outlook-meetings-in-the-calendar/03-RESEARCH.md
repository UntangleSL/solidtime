# Phase 3: Outlook Meetings in the Calendar - Research

**Researched:** 2026-11-05
**Domain:** Microsoft Graph `calendarView` sync (Laravel 13 backend, delegated tokens) + a read-only "ghost" overlay in solidtime's custom Vue calendar
**Confidence:** HIGH on in-repo facts (code and fixtures were read this session); MEDIUM on Graph error-code classification (documented classes are cited, specific AADSTS and Outlook error codes are flagged `[ASSUMED]`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Which meetings appear (product, decided this session)**
- **D-01:** Meetings that overlap a time entry the user already logged are shown anyway, with the same ghost style. Nothing is hidden or dimmed automatically; the user decides by dismissing. (Phase 4 linking may later change how a converted meeting is shown; that is Phase 4's call.)
- **D-02:** All eligible meetings in the visible range are shown, past and future, same style. There is no "only until now" cut-off.
- **D-03:** Eligibility follows SYNC-03 exactly, as fixed in `docs/m365/DECISIONS-graph.md`: every timed meeting regardless of response status (organizer, accepted, tentative, not responded, personal blocks without attendees); exclude `isCancelled=true`, `isAllDay=true`, and `sensitivity` other than `normal`. Declined ones are already removed by Graph; skipping a residual `responseStatus=declined` defensively is allowed. `showAs=free` meetings ARE shown (skipping them is v2 PROD-04).

**Ghost block interaction (product, decided this session)**
- **D-04:** Clicking a ghost block opens a small detail panel (popover) with: subject, start-end time, organizer, location / online-meeting indicator (Teams), and a "Dismiss" action. Phase 4 will add "Assign to project" in the same panel, so the panel must be built as an extendable component.
- **D-05:** Ghost blocks are not draggable or resizable and must not block slot selection, drag or resize of real time entries (CAL-02). Clicking a ghost opens the panel; it never starts creating a time entry.
- **D-06:** Ghost blocks are visually distinct from time entries (e.g. outlined / hatched / translucent, not the project colour) and are never counted in tracked time, day/week totals, reports or exports (CAL-01). Exact visual is Claude's discretion following existing theme tokens.

**Dismiss (product)**
- **D-07:** Dismiss is per occurrence (one meeting instance, keyed by the immutable occurrence id). "Always ignore this series" is Phase 5. Dismissals persist server-side per user.
- **D-08:** A "Show dismissed" toggle lets the user see dismissed suggestions again (rendered distinctly) and un-dismiss them. Placement is Claude's discretion; the existing calendar settings popover (`CalendarSettingsPopover.vue`) is the natural place.

**Connection state in the calendar (product, decided this session)**
- **D-09:** Users without a connected Microsoft account (password-only users, or after Disconnect) see a small, non-blocking "Connect Microsoft 365" button next to the Sync control, which starts the existing Phase 2 connect flow (`?intent=connect`) and returns to the calendar. The calendar otherwise works exactly as today. Only shown when the integration is enabled (D-14 of Phase 2).
- **D-10:** When the token cannot be refreshed (revoked, expired, Conditional Access, `invalid_grant`), the same spot shows "Reconnect Microsoft" instead of an error (SEC-02). Silent refresh when the access token is merely expired.

**Sync and status**
- **D-11:** Meetings load after (and never block) time entries. Fetch on calendar open and on range navigation, plus a manual "Sync" button; repeated presses and fast navigation are debounced/coalesced so Graph is not hammered (SYNC-02). A short server-side reuse window for the same user+range is allowed to avoid repeat Graph calls.
- **D-12:** A non-blocking status near the Sync button shows "last synced <time>" and, on Graph failure/slowness/429, "Outlook unavailable, retry later" while the calendar keeps showing time entries (and the last known meetings if cached). Honour `Retry-After` on 429.

**Carried forward (locked by earlier phases)**
- **D-13:** Graph details fixed in Phase 1 (`docs/m365/DECISIONS-graph.md`): `calendarView` on the primary calendar; combined header `Prefer: outlook.timezone="UTC", IdType="ImmutableId"` on every request including every `@odata.nextLink`; `$top=100` with a page cap; the production `$select` string from that document; occurrence key = immutable `id`; series key = `seriesMasterId` (stored now so Phase 5 can use it).
- **D-14:** Times arrive in UTC and are displayed in the user's solidtime timezone, correct across DST (SYNC-04).
- **D-15:** Tokens live only encrypted in `microsoft_accounts` (Phase 2 D-09/SEC-01). No token, Graph payload or meeting subject goes to logs, audits, session, cache keys visible to others, Inertia shared props or the public `/api/v1` OpenAPI spec.
- **D-16:** Privacy: meetings are visible only to their owner; no manager/admin view; endpoints return only the authenticated user's own meetings (CAL-03).
- **D-17:** Fork isolation (Phase 2 D-15): backend in `app/Microsoft365/`, frontend in `resources/js/m365/`; minimal, ledgered touches to core calendar files (`docs/m365/TOUCHED-CORE-FILES.md`). Fork endpoints stay out of the public `/api/v1` OpenAPI spec.
- **D-18:** UI strings in English (Phase 2 D-18).
- **D-19:** F1/freelance users without a mailbox must not see errors: a Graph "no mailbox" answer is treated as "no meetings" with a quiet status.

### Claude's Discretion
- Whether meetings are cached in the database or fetched live per range (must support dismissals now and Phase 4/6 linking later; research recommends).
- Debounce timing, server reuse window, page cap, Graph timeouts.
- Exact ghost visual, panel layout, toggle placement, status wording.
- How the ghost layer is wired into `TimeEntryCalendar.vue` / `useCalendarEvents.ts` (a separate layer like the existing activity boxes vs mixed events), as long as D-05 holds.

### Deferred Ideas (OUT OF SCOPE)
- Hiding or dimming meetings already covered by logged time (rejected for now, D-01); revisit only if the calendar feels noisy.
- Skip `showAs=free` meetings: v2 PROD-04.
- Background sync / webhooks: v2 SYNC2-01.
- Also out of this phase (CONTEXT domain): turning a meeting into a time entry (Phase 4), series rules and "always ignore this series" (Phase 5), out-of-sync flags (Phase 6), deletion cleanup and impersonation guard (Phase 7), shared calendars (v2 SYNC2-02).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Meetings for the visible range are fetched from Graph (read-only) without blocking time entries | Separate DB-read endpoint plus a POST sync mutation; `loading` prop of `TimeEntryCalendar` is never tied to meetings (Architecture, Pitfall 6) |
| SYNC-02 | Sync button; repeated presses/navigation debounced, no Graph throttling | Client debounce + in-flight coalescing, server reuse window, per-user lock, persisted `Retry-After` back-off (Sync Strategy) |
| SYNC-03 | Every timed meeting shown regardless of response; exclude declined, cancelled, all-day, private/confidential | `OutlookMeetingEligibility` fail-closed filter, tested by replaying the Phase 1 scenarios (Eligibility, Validation Architecture) |
| SYNC-04 | Times correct in the user's timezone incl. DST | Graph UTC naive strings parsed as UTC, stored UTC, emitted as `...Z`, converted client-side with `getLocalizedDayJs` (Time Zone) |
| SYNC-05 | Graph unavailable/slow/throttled: calendar keeps working, non-blocking status | Typed sync outcome returned as HTTP 200 with a `status` field; timeouts and deadline; cached meetings still served (Error Taxonomy) |
| CAL-01 | Ghost blocks distinct, not counted in totals/reports/exports | Separate overlay layer fed by a separate prop; `dailyTotals` only reads `timeEntries`; ghosts never touch `time_entries` (Architecture) |
| CAL-02 | Ghosts not draggable/resizable, no interference with entries | Ghosts carry none of `.fc-event`, `data-event-id`, `.fc-timegrid-col`; one-line selector in `onSlotPointerDown`; z-order behind entries (Pointer Handling) |
| CAL-03 | Meetings visible only to their owner | Every query scoped by `auth()->id()`, no user parameter, dismiss by explicit scoped lookup (Security Domain) |
| CAL-04 | Dismiss and show-dismissed | `dismissed_at` on the cached row, preserved by upsert, `include_dismissed` flag, restore endpoint (Data Model) |
| SEC-02 | Tokens refresh automatically; reconnect prompt on failure | `MicrosoftTokenService` with row lock + skew; terminal vs transient classification; `reconnect_required_at` state (Token Refresh) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `.claude/CLAUDE.md` (treated as locked):

- Stack: Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`.
- Every PHP file: `declare(strict_types=1);`, typed params and returns, Pint rules `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`, `void_return`. PHPStan/Larastan level 7 over `app/` with `checkOctaneCompatibility`, `checkModelProperties`, `noEnvCallsOutsideOfConfig` (never `env()` outside `config/`).
- Tests: `// Arrange / Act / Assert` sections, `test_` snake_case methods, `#[UsesClass]` / `#[CoversClass]` attributes; Vitest co-located `*.test.ts`; Playwright specs kebab-case in `e2e/`.
- Frontend: `<script setup lang="ts">` only, `defineProps<{...}>()`, theme tokens (`text-text-primary`, `border-input-border`, `bg-card-background`) instead of raw colours, TanStack Query hooks named `use<Resource>Query`, Prettier (4 spaces, single quotes, printWidth 100), ESLint with `unused-imports`.
- Controllers return Resources, never raw models. No `console.log` in shipped code. Logging through the `Log` facade only.
- Security: tokens encrypted at rest, `$hidden`, excluded from audits/logs, deleted with the user. Data safety: Outlook changes never modify or delete existing time entries automatically.
- Mergeability: isolate fork code; every core-file touch goes into `docs/m365/TOUCHED-CORE-FILES.md`.
- GSD workflow enforcement: edits go through GSD commands. No project skills directory exists (`.claude/skills/` absent) [VERIFIED: directory listing].
- Never read `.env` files; do not print secrets.

## Summary

Phase 3 adds a read-only Outlook overlay to the existing week/day calendar. Everything the planner needs already exists in the repo and in the Phase 1 fixtures; the open design questions have clear answers once the code is read. The recommended architecture is a **database cache of eligible meetings per user** (`outlook_meetings`), a **read endpoint that never calls Graph** (`GET /m365/meetings`) and a **separate sync endpoint that does** (`POST /m365/meetings/sync`), with the calendar rendering a **separate ghost layer injected through slots** so that the core calendar files change by a handful of ledgered lines. A DB cache is the only option that supports all three of: showing last-known meetings when Graph is down (D-12), dismissals that survive re-syncs (D-07), and Phase 4/6 linking against a stored occurrence (SEC-03 in REQUIREMENTS already speaks of "cached meetings").

The Graph side is fully specified by `docs/m365/DECISIONS-graph.md` and verified against the fixtures: literal URL with the exact `$select`, one combined `Prefer` header on every request including every `nextLink`, `$top=100`, a page cap, and UTC-naive `start`/`end` strings (`"2026-10-27T13:00:00.0000000"` with `timeZone: "UTC"`). The fixtures contain a trap worth testing explicitly: most `prod-select` pages have **zero events but still carry an `@odata.nextLink`** (an artefact of sanitization dropping untagged events, but a real Graph behaviour to be robust against). The sync must follow `nextLink` until it is absent, never stop at an empty page, and must **never mark cached rows as gone from a partial traversal**.

Token refresh builds on the Phase 2 storage (`access_token`, `refresh_token` encrypted casts, `access_token_expires_at`, `scopes`, `disconnected_at`). The refresh is a plain `grant_type=refresh_token` POST to the tenant-pinned v2 token endpoint, serialized with a row lock, with a 2-minute skew, and with a strict split between **terminal** errors (`invalid_grant`, `interaction_required`, `consent_required`, which set a new `reconnect_required_at` and show "Reconnect Microsoft") and **non-user-fixable** errors (`invalid_client`, `unauthorized_client`, i.e. an expired or wrong client secret, which must NOT show "Reconnect" to every user at once but "Outlook unavailable"). Throttling (429) is persisted per account as `graph_backoff_until` from `Retry-After`, so every tab and every request honours it.

**Primary recommendation:** Build `app/Microsoft365/Graph/` (token service, calendar client, eligibility, sync service) behind four session-authenticated routes under `/m365/*`, cache eligible meetings in `outlook_meetings` with `dismissed_at`, render ghosts through a `day-overlay` slot behind real entries with a `data-calendar-overlay` attribute that `onSlotPointerDown` ignores, and keep sync as a user-triggered mutation (open, debounced navigation, Sync button), never a focus-triggered query.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch meetings from Graph, paging, eligibility filter | API / Backend | - | Tokens never leave the server (SEC-01); Graph paging and eligibility are server logic |
| Token refresh and reconnect classification | API / Backend | Database | Refresh token is only decryptable server-side; state persisted in `microsoft_accounts` |
| Cache of meetings, dismissals, sync windows, back-off | Database / Storage | API / Backend | Must survive Graph outages and support Phase 4/6 links; FK cascade on user delete |
| Connection state for the calendar (connected / reconnect / not connected), labels, URLs | Frontend Server (Inertia shared prop) | - | Same mechanism as the Phase 2 profile card; Octane-safe middleware; no token data |
| Debounce, in-flight coalescing, status display, Sync/Connect/Reconnect controls | Browser / Client | - | UX timing logic; server independently enforces limits |
| Ghost rendering, positioning, clipping to day, DST-correct display | Browser / Client | - | Display timezone is the user's solidtime timezone (client helper `getLocalizedDayJs`) |
| Pointer handling (ghost never starts selection/drag/resize) | Browser / Client | - | Lives in `useSlotSelection.ts` and in ghost markup |
| Privacy (own meetings only) | API / Backend | Database | Query scoping by `user_id`; client never sends a user id |
| Exclusion from totals, reports, exports | API / Backend + Browser | - | Server: meetings never enter `time_entries`; client: ghost data never merged into `timeEntries` prop |

## Standard Stack

No new packages are needed. Everything is already a dependency of the repo [VERIFIED: `.claude/CLAUDE.md` Technology Stack, `composer.json`/`package.json` as summarized there].

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Laravel `Http` facade (Guzzle 8) | laravel/framework ^13, guzzlehttp/guzzle ^8.2 | Graph and token-endpoint calls | `Http::fake`/`Http::sequence` is exactly how `CalendarViewFixturesTest` replays the fixtures; Phase 2 gateway already depends on Guzzle |
| Laravel `Cache::lock` | framework | Per-user sync coalescing | Atomic lock; array driver in tests supports it |
| Eloquent + `tpetry/laravel-postgresql-enhanced` | ^3.0 | Tables, upsert | Existing migration style (uuid PK, explicit FK) |
| `@tanstack/vue-query` | ^5.100.10 | Meetings read query + sync mutation | Calendar already uses it (`useTimeEntriesCalendarQuery`) |
| axios (global, `resources/js/bootstrap.js`) | existing | Session-authenticated JSON calls (cookies + XSRF) | Already used outside the zodios client (`useUserQuery.ts`, `notification.ts`); the generated `api` client is OpenAPI-only and must not include fork routes |
| `dayjs` (+utc/tz plugins via `packages/ui/src/utils/time.ts`) | ^1.11.20 | DST-correct local conversion | `getLocalizedDayJs(utcString)` is the repo's single conversion point |
| `reka-ui` Popover (re-exported by `packages/ui`) | ^2.10.1 | Ghost detail panel | `CalendarSettingsPopover.vue` already imports `Popover, PopoverContent, PopoverTrigger` from `..` |
| Vitest 4 + happy-dom, `@vue/test-utils` | existing | Frontend unit/component tests | Phase 2 `m365` tests use this |
| Playwright 1.60 | existing | E2E | See Validation Architecture for the integration-off constraint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `timacdonald/log-fake` | existing dev dep | Assert nothing sensitive is logged | SEC tests for D-15 |
| `Illuminate\Support\Facades\RateLimiter` / `throttle:N,1` | framework | Route-level cap (Phase 2 uses `throttle:30,1`) | All `/m365/meetings*` routes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB cache of meetings | Live fetch per request + `Cache::remember` | Simpler, but no last-known data after the cache TTL, dismissals need their own table anyway, and Phase 4/6 would have to add the cache later. Rejected |
| Synchronous sync inside the POST | Queue job + polling | `QUEUE_CONNECTION=database` is configured in `docs/deploy/dokploy-compose.fork.yml`, but a job needs a status channel and polling; a 5-page worst case with an 8 s timeout is acceptable for a per-user, rate-limited, single-flight endpoint. Revisit only for v2 background sync (SYNC2-01) |
| Mixed events (meetings inside `timeEntries`) | Separate overlay layer | Mixing makes totals, drag, resize, context menu and edit modal all treat meetings as entries (CAL-01/02 risk). Rejected |
| Microsoft Graph PHP SDK (`microsoft/microsoft-graph`) | Plain `Http` | SDK adds a heavy dependency and hides the exact headers/URL form Phase 1 verified. Rejected |
| `Calendars.ReadBasic` | `Calendars.Read` | Locked by PROJECT.md; DECISIONS-graph.md says do not depend on `ReadBasic` |

**Installation:** none (`npm install` / `composer require` not needed).

**Version verification:** not applicable (no new package). Existing versions come from the repo's own manifests as summarized in `.claude/CLAUDE.md`.

## Package Legitimacy Audit

No external packages are installed by this phase, so the `package-legitimacy` gate has nothing to check.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none added) | - | - | - | - | n/a | n/a |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                        BROWSER (Calendar.vue, resources/js/m365/*)
 calendar opens / range changes ──► useOutlookMeetings(calendarStart, calendarEnd)
        │                              │  bucket = visible range quantized to the user's week
        │                              │
        │   (1) GET /m365/meetings?start&end[&include_dismissed=1]   ── DB only, no Graph ──┐
        │   (2) debounce 400 ms, one in-flight sync, latest bucket wins                     │
        │       POST /m365/meetings/sync {start,end[,force]}  ─────────────┐                │
        │                                                                  ▼                ▼
        │                                        ┌────────────── LARAVEL (web group, session auth) ───────────────┐
        │                                        │ EnsureMicrosoftIsEnabled → auth:web → auth.session → verified  │
        │                                        │ → throttle:N,1                                                  │
        │                                        │                                                                 │
        │                                        │ OutlookMeetingSyncService::sync(user, range, force)             │
        │                                        │   account not connected? ─► status not_connected / reconnect    │
        │                                        │   graph_backoff_until in future? ─► status throttled (no call)  │
        │                                        │   window synced < reuse window? ─► status reused                │
        │                                        │   Cache::lock(user) busy? ─► status coalesced                   │
        │                                        │   MicrosoftTokenService::accessToken()  ─┐                      │
        │                                        │      row lock, skew, refresh_token grant │──► login.microsoft…  │
        │                                        │      terminal ─► reconnect_required_at   │    /{tenant}/token   │
        │                                        │   GraphCalendarClient::calendarView()    │                      │
        │                                        │      literal URL + exact $select         │──► graph.microsoft…  │
        │                                        │      Prefer on EVERY page, nextLink verbatim, page cap,        │
        │                                        │      deadline, host check                                       │
        │                                        │   eligibility filter (fail closed) → upsert                     │
        │                                        │   complete traversal only → mark unseen rows gone               │
        │                                        │   200 { status, retry_after, last_synced_at, truncated }        │
        │                                        └──────────────┬──────────────────────────────────────────────────┘
        │                                                       ▼
        │                        PostgreSQL: outlook_meetings, outlook_sync_windows, microsoft_accounts(+cols)
        │
        ▼  on sync finished: invalidate ['m365','meetings'] → refetch (1)
 TimeEntryCalendar (core, + 2 slots)
   ├─ time entries (unchanged path, `loading` = time entries only)
   ├─ <slot day-overlay> → OutlookGhostLayer.vue per day (behind entries, data-calendar-overlay)
   │        click → OutlookGhostDetail popover → Dismiss / Restore (POST|DELETE /m365/meetings/{id}/dismiss)
   └─ <slot toolbar-extra> → OutlookCalendarControls.vue (Sync, status, Connect/Reconnect, Show dismissed)
```

### Recommended Project Structure
```
app/Microsoft365/
├── Graph/
│   ├── MicrosoftTokenService.php          # refresh + classification (SEC-02)
│   ├── TokenOutcome.php / exceptions      # ReconnectRequired, GraphUnavailable, GraphThrottled
│   ├── GraphCalendarClient.php            # literal URL, headers, paging, error mapping
│   ├── CalendarViewPage.php (DTO)         # events + nextLink
│   ├── OutlookMeetingEligibility.php      # pure, fail closed
│   ├── OutlookMeetingSyncService.php      # orchestration, lock, reconcile
│   └── SyncOutcome.php                    # enum-like status + retry_after + last_synced_at
├── Models/OutlookMeeting.php, OutlookSyncWindow.php
├── Http/Controllers/OutlookMeetingController.php   # index, sync, dismiss, restore
├── Http/Resources/OutlookMeetingResource.php       # explicit allow-list, never the model
├── Http/Requests/MeetingRangeRequest.php
├── database/migrations/2026_11_*_create_outlook_meetings_table.php
├── database/migrations/2026_11_*_add_graph_state_to_microsoft_accounts.php
└── routes/microsoft365.php                         # + one new group (existing file)
resources/js/m365/calendar/
├── useOutlookMeetings.ts (+ .test.ts)   # query + sync mutation + debounce/coalesce + test hook
├── meetingsApi.ts                       # axios calls, status typing
├── ghostLayout.ts (+ .test.ts)          # clip to day, column assignment, pure
├── OutlookGhostLayer.vue                # slot content
├── OutlookGhostDetail.vue               # extendable panel (Phase 4 adds actions via slot)
├── OutlookCalendarControls.vue          # Sync / status / Connect / Reconnect / Show dismissed
└── types.ts additions                   # in existing resources/js/m365/types.ts
tests/Feature/Microsoft365/  OutlookMeetingSyncTest, OutlookMeetingEndpointTest, MicrosoftTokenRefreshTest, ...
tests/Unit/Microsoft365/     OutlookMeetingEligibilityTest, GraphCalendarClientTest
e2e/outlook-ghosts.spec.ts
```

### Decision 1: Database cache (answers "cache or live?")

**Recommend: cache eligible meetings in the database, write-through on every successful sync, read-only endpoint serves the cache.**

Why (each point maps to a locked requirement):
1. D-12 "keeps showing the last known meetings if cached" and SYNC-05 need data that outlives any short `Cache::remember` TTL.
2. D-07 dismissals persist server-side per user and must survive a re-sync: `dismissed_at` lives on the same row and is excluded from the upsert's update columns.
3. SYNC-01 "without blocking": the first paint comes from the DB read (tens of ms), Graph refreshes in the background.
4. Phase 4 links a time entry to an occurrence; Phase 6 compares stored `starts_at`/`ends_at` with fetched values (DECISIONS-graph.md "compare stored fields with the fetched ones"). Both need a persisted row. REQUIREMENTS SEC-03 already lists "cached meetings" among data to delete with the user.
5. Phase 5 needs `series_master_id` (D-13 "stored now").

**`outlook_meetings`** (fork migration, uuid PK, `Schema::create` style as in `create_microsoft_accounts_table`):

| Column | Type | Note |
|--------|------|------|
| `id` | uuid PK | Our id, used by the client and by dismiss routes. Phase 4 FK target |
| `user_id` | uuid FK to `users`, `cascadeOnDelete` | CAL-03 scoping and SEC-03 cleanup |
| `graph_id` | varchar(255) | Immutable occurrence id (max observed 84 chars, default-format max 168) [CITED: DECISIONS-graph.md "Occurrence key"] |
| `series_master_id` | varchar(255) null | D-13 |
| `original_start` | dateTime null | Secondary key `(series_master_id, original_start)` |
| `event_type` | varchar(20) | `singleInstance` / `occurrence` / `exception` (values seen in fixtures) |
| `subject` | text null | Stored only for eligible events (private never persisted) |
| `starts_at`, `ends_at` | dateTime (UTC) | Same column type the repo uses for `time_entries.start/end` [VERIFIED: `database/migrations/2024_01_20_110837_create_time_entries_table.php` lines 19-20: `$table->dateTime('start'); $table->dateTime('end')->nullable();`] |
| `organizer_name` | varchar(255) null | Display only; do not store the organizer address (data minimization) |
| `is_organizer`, `is_online_meeting` | boolean | `isOrganizer`, `isOnlineMeeting` |
| `show_as` | varchar(20) null | stored for Phase 6/PROD-04, not used now |
| `web_link` | text null | "Open in Outlook" link; treated as untrusted (see Security) |
| `last_seen_at` | dateTime | Set to the sync start time on every sighting |
| `gone_at` | dateTime null | Set when a complete sync of a covering window no longer returns the row; cleared if it reappears |
| `dismissed_at` | dateTime null | D-07 |
| timestamps | | |
| unique `(user_id, graph_id)`, index `(user_id, starts_at)` | | |

**`outlook_sync_windows`**: `id`, `user_id` FK cascade, `window_start`, `window_end` (UTC), `synced_at`, unique `(user_id, window_start, window_end)`. One row per week bucket a user visited. It provides the per-range "last synced" (D-12) and the reuse-window check. Pruning belongs to Phase 7 retention.

**`microsoft_accounts` additions** (new migration, nullable columns, fork-owned table): `graph_backoff_until` (dateTime null), `reconnect_required_at` (dateTime null). Clear `reconnect_required_at` in `MicrosoftIdentityResolver::writeTokens()` (both the sign-in path and the connect path call it) and in `MicrosoftAccountController::destroy()` [VERIFIED: `MicrosoftIdentityResolver.php` lines 99-105 (`$account->disconnected_at = null; $this->writeTokens(...)`) and 230-236 (`writeTokens` body); `MicrosoftAccountController.php` destroy body].

Reconcile rule (the dangerous part): after a **complete** traversal (no page failed, page cap not hit), rows of this user that overlap the window (`starts_at < :end AND ends_at > :start`, the same overlap predicate calendarView uses) and have `last_seen_at < :syncStartedAt` get `gone_at = now()`. After a truncated or failed traversal, upsert what was seen but **never** mark anything gone. Rows are never hard-deleted in Phase 3 (dismissal and Phase 4 link continuity); an explicitly ineligible event that comes back (cancelled, now private) is marked gone and its `subject`, `organizer_name`, `web_link` are nulled so a meeting that later turned private does not keep its title.

On Disconnect (`MicrosoftAccountController::destroy`) also delete that user's `outlook_meetings` and `outlook_sync_windows` in the same transaction (data minimization, matches AUTH-07's "disconnecting deletes stored Microsoft tokens"), and have `GET /m365/meetings` return an empty list unless the account is connected. `[ASSUMED]` product expectation; it is cheap to reverse (see Assumptions A3).

### Decision 2: Routes (answers "what fork-only routes?")

All inside `app/Microsoft365/routes/microsoft365.php`, one new group using the same stack core uses for authenticated pages plus the Phase 2 off switch [VERIFIED: existing group `Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])` in that file]:

| Method + path | Name | Purpose |
|---------------|------|---------|
| `GET /m365/meetings` | `microsoft.meetings.index` | Cache read for `start`,`end` (+ `include_dismissed`). Never calls Graph. Returns `{ data: [...], sync: { last_synced_at } }` |
| `POST /m365/meetings/sync` | `microsoft.meetings.sync` | Runs the sync. Always HTTP 200 with a typed status for expected degradations |
| `POST /m365/meetings/{meeting}/dismiss` | `microsoft.meetings.dismiss` | Idempotent |
| `DELETE /m365/meetings/{meeting}/dismiss` | `microsoft.meetings.restore` | Idempotent |

- They do **not** start with `api/`, so Scramble (`config/scramble.php`: `'api_path' => 'api'`) ignores them [VERIFIED: `config/scramble.php` line 12] and `openapi.json` is untouched. Add a test asserting no new route URI starts with `api/`.
- Do not use implicit route-model binding for `{meeting}`: resolve with `OutlookMeeting::query()->where('user_id', $request->user()->getKey())->whereKey($id)->firstOrFail()` so a foreign id is a 404, not a 403 (no existence oracle).
- Validate `start`/`end` (ISO 8601 with offset, `end > start`, span <= 35 days), `include_dismissed` boolean, `{meeting}` uuid.
- Route throttle: `throttle:60,1` on index/dismiss/restore, `throttle:12,1` on sync (Laravel's throttle middleware keys by the authenticated user id when present, else IP `[ASSUMED]`). Outlook's documented ceiling is 10,000 requests per 10 minutes and four concurrent requests per app+mailbox [CITED: learn.microsoft.com/en-us/graph/throttling-limits, "Outlook service limits"]; at most ~10 pages per sync and 12 syncs per minute keeps a user far below it.
- Responses use `JsonResource` allow-lists (`id`, `subject`, `start`, `end`, `organizer_name`, `is_organizer`, `is_online_meeting`, `web_link`, `dismissed`), timestamps as `Y-m-d\TH:i:s\Z`. Never `->toArray()` the model.
- Expected degradations are HTTP 200 + `status` (`ok`, `reused`, `coalesced`, `throttled`, `unavailable`, `reconnect`, `not_connected`, `no_mailbox`) with `retry_after` seconds and `last_synced_at`. Reserve 401 (session expired), 404 (integration off), 422 (validation), 429 (our own throttle) for real HTTP semantics, so no global error handling or retry kicks in for "Graph is slow".

Connection state for the page comes from the **Inertia shared prop** (Phase 2 pattern): extend `ShareMicrosoftInertiaData` to add a `calendar` block only when `$request->routeIs('calendar')`: `{ state: 'connected'|'reconnect'|'not_connected', connect_url (with return=calendar), meetings_url, sync_url, dismiss_url, labels }`. All copy is resolved server-side in `lang/en/microsoft365.php` (and `lang/es`; see Pitfall 11). Nothing token-related, ever [VERIFIED: `ShareMicrosoftInertiaData.php` docblock + `account()` shape].

Connect flow return (D-09 "returns to the calendar"): today `completeConnect` always redirects to `profile.show` and `connectFailureResponse` likewise [VERIFIED: `MicrosoftAuthController.php` lines 174-175 and 190-197]. Add an allow-listed `return=calendar` query value on the redirect leg only, stored in a server-side session key (like `microsoft.intent`, pulled on every exit path), mapped to `route('calendar')`. Never accept a URL. This is a fork-owned file edit, no ledger entry.

### Pattern 1: Token refresh (answers "how does refresh work with Phase 2 storage?")

`MicrosoftTokenService::accessToken(MicrosoftAccount $account): string` (throws typed exceptions).

1. Inside `DB::transaction`, re-read the row with `lockForUpdate()` (same discipline as `MicrosoftAccountController::destroy`) and check state:
   - `disconnected_at !== null`, or `refresh_token === null` with no reconnect marker: not connected.
   - `scopes` is a non-empty array and does not contain `Calendars.Read` (case-insensitive): reconnect required (stored scope strings look like `Calendars.Read email openid profile User.Read` [VERIFIED: `tests/Fixtures/M365/token-response.shape.json` `"scope": "Calendars.Read email openid profile User.Read"`]). Empty/unknown scopes do not block.
2. If `access_token !== null && access_token_expires_at` is more than 120 s in the future: return it (double-checked after the lock, so a concurrent request that already refreshed is reused).
3. Else `POST https://login.microsoftonline.com/{MicrosoftConfig::tenantId()}/oauth2/v2.0/token`, form body `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`, `scope=Calendars.Read offline_access`, timeouts 3 s connect / 8 s total. Documented request shape: `grant_type` required `refresh_token`, `scope` optional and must be equal or a subset of the original scopes, `client_secret` required for web apps; a new `refresh_token` is only returned if `offline_access` was requested [CITED: learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow, "Refresh the access token"]. Never log the request or response body.
4. Success: store `access_token`, `access_token_expires_at = now + expires_in`, and **replace** `refresh_token` when one is returned ("Replace the old refresh token with this newly acquired refresh token") [CITED: same page]. Do not overwrite `scopes` with the (narrower) response scope. Refresh tokens are not revoked on use and have no specified lifetime, but can expire, be revoked or lack privileges, so the caller "needs to expect and handle errors" [CITED: same page].
5. Failure classification (token endpoint `error` field; names from the documented table [CITED: same page, "Error codes for token endpoint errors"]):

| Token endpoint result | Class | Effect |
|-----------------------|-------|--------|
| `invalid_grant`, `interaction_required`, `consent_required` | **Terminal, user-fixable** | Set `reconnect_required_at = now`, null `access_token`, `refresh_token`, `access_token_expires_at`; state `reconnect` (D-10). Specific AADSTS values behind `invalid_grant` (e.g. revoked grant AADSTS50173 is documented as "the provided grant has expired due to it being revoked" [CITED: learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50173-grant-expired-revoked]); 70008/700082/50076/53003 meanings are `[ASSUMED]`, so classify on the OAuth `error` string, never on AADSTS numbers |
| `invalid_client`, `unauthorized_client`, `invalid_request`, `invalid_scope`, `unsupported_grant_type`, `invalid_resource` | **Config/operator error, not user-fixable** | Keep tokens, no reconnect marker, outcome `unavailable` with a fixed internal code; log fixed reason + AADSTS code only (Phase 2 `providerCode()` pattern). An expired client secret (documented to expire 2028-10-19 [CITED: STATE.md 01-05]) must not make every user see "Reconnect" |
| `temporarily_unavailable`, `server_error`, HTTP 5xx, connection/timeout exception | **Transient** | Keep tokens, outcome `unavailable` |
| HTTP 429 | **Throttled** | Persist `graph_backoff_until` from `Retry-After` |

Concurrency: the lock plus the post-lock expiry check prevent two requests from refreshing at once; because refresh tokens are not revoked on use, a lost race is benign, but rotation must still be written atomically with the access token (same `save()`).

Graph 401 on the actual call: refresh once (force, ignoring skew) and retry the failing page once; a second 401 means reconnect. Graph 403: treat as `reconnect` after one refresh attempt `[ASSUMED]` (re-consent via the connect flow is the only user action).

### Pattern 2: Graph calendar client

- Build the **literal URL** exactly like the captured requests, no Laravel query array, so `$select` and `$orderby` keep the form Phase 1 proved:
  `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=<rawurlencode(Z)>&endDateTime=<...>&$select=<SELECT>&$orderby=start/dateTime&$top=100`, with `SELECT` the exact string `id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting` [VERIFIED: `docs/m365/DECISIONS-graph.md` lines 338-349 and `tests/Fixtures/M365/calendarview/roundA.prod-select.requests.json` request URL]. Pass it as a string to `Http::get()`. Whether Guzzle would accept a percent-encoded `$select` is `[ASSUMED]`; avoid the question.
- Headers on **every** request including every `nextLink`: `Authorization: Bearer`, `Accept: application/json`, `Prefer: outlook.timezone="UTC", IdType="ImmutableId"` (one combined header) [VERIFIED: DECISIONS-graph.md "Time zone and DST" and "ImmutableId and nextLink"]. Use each `@odata.nextLink` verbatim, but first require `https` and host exactly `graph.microsoft.com` (the Phase 1 harness refuses a nextLink on another origin so the bearer token never follows a link elsewhere [CITED: STATE.md 01-02]).
- Loop until `@odata.nextLink` is absent. **Do not stop on an empty `value`.**
- Config (read through `config('microsoft365.graph.*')`, never `env()` in app code): `max_pages` default 10, `connect_timeout` 3, `timeout` 8, `deadline` 15 s total per sync. Hitting the cap or the deadline sets `truncated = true` and skips the gone-marking.
- Octane: bind client/services with plain `bind` (never `singleton`), no static state (Phase 2 `Microsoft365ServiceProvider` pattern).

### Pattern 3: Ghost layer plugs into the calendar (answers "how without breaking pointer handling?")

Use the activity-boxes overlay as the analog but make it a **slot** so the fork component lives in `resources/js/m365/`:

1. `CalendarDayColumn.vue`: add `<slot name="overlay" :day-str :is-day-view :has-activity-status :total-grid-height />` as the **first child** of the column root (before the events container). Later positioned siblings paint on top, so real `.fc-event` blocks always win hit testing where they overlap a ghost.
2. `TimeEntryCalendar.vue`: forward a `day-overlay` slot into each `CalendarDayColumn` and a `toolbar-extra` slot into `CalendarToolbar`; pass `minutesToPixels` and the settings through slot props.
3. `CalendarToolbar.vue`: one `<slot name="extra" />` before the view tabs.
4. `Calendar.vue`: call `useOutlookMeetings(calendarStart, calendarEnd)` and provide the slot content; `:loading` stays `timeEntriesLoading`.

The inset that `CalendarDayColumn` applies when `hasActivityStatus` is scoped CSS (`.fc-events-inset { left: 8px }`, `.fc-events-inset-expanded { left: 204px }`) and does not reach slot content, so the ghost layer applies the same offsets from the slot props itself.

The existing structure and why ghosts stay inert (all verified by reading the files this session):

- Slot selection is a single `@pointerdown="guardedSlotPointerDown($event)"` on the wrapper `div.flex-1.min-w-0.relative` around the grid [VERIFIED: `TimeEntryCalendar.vue` template, lines ~594-595]. `onSlotPointerDown` returns early only for `if (target.closest('.fc-event')) return;` [VERIFIED: `useSlotSelection.ts` lines 23-27]. A ghost is a descendant of that wrapper, so without a guard its pointerdown bubbles up and **starts a time-entry selection**.
- Drag starts only from `@pointerdown` on `.fc-event` elements via the `event-pointerdown` emit, and resize only from `.fc-event-resizer` children [VERIFIED: `CalendarDayColumn.vue` template; `useEventDrag.ts` `onEventPointerDown` bails on `.fc-event-resizer`]. Ghosts use neither class, so drag and resize are impossible by construction.
- During a selection or drag, tracking uses `document` `pointermove`/`pointerup` listeners and pure coordinate maths (`clientYToGridPixels`, `getDayFromClientX`) [VERIFIED: `useSlotSelection.ts`, `useEventDrag.ts`], never hit testing. A ghost under the cursor therefore cannot interrupt an in-progress selection or drag.
- Day detection reads `rootRef.querySelectorAll('.fc-timegrid-col')` [VERIFIED: `useCalendarGrid.ts` `getDayColumnBounds`]. The ghost container must not carry that class.
- Right-click resolves the entry with `target.closest('[data-event-id]')` [VERIFIED: `useContextMenu.ts` line 46]; ghosts must not carry `data-event-id` (they then fall into the "empty slot" create-menu path, acceptable).
- Daily totals come from `params.timeEntries()` only [VERIFIED: `useCalendarEvents.ts` `computeDailyTotals`], and the E2E suite locates entries with `.fc-event` [VERIFIED: `e2e/calendar.spec.ts` many lines], so a distinct class (`.m365-ghost`) keeps every existing locator and total correct.

**Recommended pointer rule:** ghost root carries `data-calendar-overlay` (generic name, not M365-specific, so core stays vendor-neutral), `pointer-events-auto`, `select-none`, `tabindex="0"`, `role="button"`; the ghost layer container is `pointer-events-none`. Change the single line in `onSlotPointerDown` to `if (target.closest('.fc-event, [data-calendar-overlay]')) return;`. This is one ledgered core line, keeps Reka's document-level outside-click handling intact (the existing comment on `guardedSlotPointerDown` explains Reka's non-capture listener), and a click on a ghost only opens the popover. Zero-core-edit fallback: `@pointerdown.stop` on the ghost; downside is that an open context menu or other popover will not see the outside click.

Known consequence of "behind entries, full width": a ghost completely covered by a logged entry cannot be clicked. That is consistent with D-01 (the user already logged it); if UAT disagrees, switch to a reserved lane (add a right inset class when a day has ghosts, the same mechanism as `has-activity-status`). Overnight events are clipped per day exactly as `useActivityBoxes` does (`actualStart`/`actualEnd` clamped to `dayStart`/`dayEnd`, then to `startHour`/`endHour`). Concurrent ghosts need their own small greedy column assignment in `ghostLayout.ts`; `layoutDayEvents` in `useCalendarEvents.ts` is module-private and the file is a hot core file, so do not export from it.

### Pattern 4: Sync strategy: debounce, coalescing, 429 (answers the strategy question)

Client (`useOutlookMeetings`):
- **Bucket:** quantize the visible range to whole weeks using the user's week start (`getWeekStartDayNumber()`); in week view this equals the visible range, in day view it is the containing week, so day-to-day navigation inside a week causes no extra Graph call. The meetings read query key is `['m365','meetings', bucketStartUtc, includeDismissed]`.
- **Read first, sync second:** the GET fires immediately (DB only). The sync is a `useMutation`, never a `useQuery`, so TanStack's default `refetchOnWindowFocus`/`retry: 3` (the app uses `new QueryClient()` with defaults [VERIFIED: `resources/js/app.ts` line 15]) can never turn a tab focus or an error into Graph traffic. Set `retry: false` on both.
- **Debounce** range-change syncs 400 ms trailing. **Single flight:** while a sync runs, remember only the latest desired bucket and run it once afterwards if it differs. **Cooldown:** the Sync button is disabled while syncing and for 10 s after completion, and while `retry_after` is pending. Auto syncs skip when the read response's `last_synced_at` is younger than 60 s.
- On completion invalidate `['m365','meetings']`; ignore results for a bucket that is no longer visible.

Server (`OutlookMeetingSyncService`):
- Reuse window **60 s** per `(user, window)` for automatic syncs; a forced (button) sync bypasses it but not a **10 s** minimum interval.
- `Cache::lock("m365:meetings-sync:{user_id}", 20)` non-blocking; if busy return `coalesced` with the cached data (assumes one web container; with the file cache store the lock is per container, so scaling out needs the `database` cache store `[ASSUMED]`, see A5).
- **429:** do not retry in-request ("avoid immediate retries, because all requests accrue against your usage limits" and use the `Retry-After` delay [CITED: learn.microsoft.com/en-us/graph/throttling]). Parse `Retry-After` as integer seconds (the documented sample is `Retry-After: 10`), clamp 1..300, default 30 when absent (documentation says to use exponential backoff when there is no header [CITED: same page]), persist `graph_backoff_until`, return `throttled` + `retry_after`. Every later sync for that account short-circuits before any HTTP call until the time passes. 503/504 with a `Retry-After` get the same treatment.
- Fixed numbers (all discretionary, configurable under `microsoft365.graph`): reuse 60 s, min interval 10 s, lock 20 s, 10 pages, 8 s per request, 15 s total deadline.

### Pattern 5: Time zone (answers "UTC to user timezone")

- Graph returns naive strings with `timeZone: "UTC"`, e.g. `"dateTime": "2026-10-27T13:00:00.0000000"` (seven fractional digits, no `Z`) [VERIFIED: `tests/Fixtures/M365/scenarios/S8.roundA.json` `start`]. `originalStart` is different: `"2026-11-03T09:00:00Z"` with a `Z` [VERIFIED: `calendarview/roundB.prod-select.page-14.json`]. Parse `start`/`end` with an explicit UTC zone (`CarbonImmutable::parse($dt, 'UTC')`, whether PHP accepts seven fractional digits is `[ASSUMED]`, so trim to 6 digits in the parser and unit-test with the fixture string) and refuse an event whose `timeZone` is not `UTC` (defensive; skip, count, log the count only).
- Store UTC; emit `...Z`; convert in the browser only with `getLocalizedDayJs(utcString)` which is `dayjs.utc(ts).tz(getUserTimezone())` [VERIFIED: `packages/ui/src/utils/time.ts` lines 170-172]. Never evaluate recurrence or add 7 days in PHP (DECISIONS-graph.md).
- DST proof from fixtures: S2 occurrences are `08:00Z` on 2026-10-20 and `09:00Z` on 2026-10-27, both 10:00 local in Europe/Madrid [VERIFIED: DECISIONS-graph.md "Time zone and DST"; `roundA.prod-select.page-2.json` shows `2026-10-20T08:00:00.0000000`]. The edited exception starts `2026-11-03T10:00:00` UTC = 11:00 local.
- Range sent to Graph: the browser sends `localDateToUtc(...)` strings (same helper the time-entry query uses) and the server forwards `Z` instants.

### Anti-Patterns to Avoid
- **Merging meetings into `timeEntries`/`calendarEvents`:** breaks totals, drag, resize, edit modal and context menu in one move.
- **Setting `TimeEntryCalendar`'s `loading` from the meetings query:** `v-if="!loading"` hides the toolbar and the whole grid [VERIFIED: `TimeEntryCalendar.vue` template].
- **Marking rows gone after a partial or capped traversal.**
- **Stopping at the first empty page** (most `prod-select` fixture pages are empty yet have a `nextLink`).
- **Syncing from a `useQuery`** (focus refetch, retries).
- **Classifying `invalid_client` as "reconnect".**
- **Reading the token or Graph body into logs, exceptions, Inertia props, audit rows.** Do not add `Auditable` to the new models (Phase 2 left `MicrosoftAccount` non-auditable on purpose).
- **Implicit route-model binding for `{meeting}`** (leaks existence across users).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP mocking of Graph | A fake Graph class | `Http::fake` / `Http::sequence` with fixture pages (pattern in `CalendarViewFixturesTest`) | Same code path as production; `Http::assertSent` can check every page's headers |
| Per-user single flight | Home-made mutex files | `Cache::lock()` | Atomic, auto-expiring |
| Row-level token serialization | Custom lock table | `lockForUpdate()` in a transaction (Phase 2 pattern) | Postgres guarantees it |
| Timezone/DST maths | Manual offset arithmetic | `getLocalizedDayJs` / `getLocalizedDayJsFromMinutes` | Repo's single DST-safe path |
| Popover | Custom floating div | `Popover`/`PopoverContent` from `packages/ui` (Reka) | Focus trap, escape, outside-click handled; used by `CalendarSettingsPopover` |
| Recurrence expansion | Evaluating `recurrence` in PHP | Let Graph expand (`calendarView` already returns occurrences) | DECISIONS-graph.md |
| Token encryption | Custom crypto | The existing `encrypted` casts on `MicrosoftAccount` | SEC-01 already done |
| OAuth client for refresh | Socialite for the refresh leg | One small `Http::asForm()->post` | Socialite's driver is per-call and built for the authorization-code leg; the refresh grant is a single documented POST |
| Rate limiting | Counters in the DB | `throttle:N,1` + persisted `graph_backoff_until` | Standard |

**Key insight:** every hard part here (paging, DST, throttling, locks) already has a verified primitive in the repo or the framework; the risk is in the seams (partial traversal, empty pages, pointer bubbling, misclassified token errors), not in missing libraries.

## Runtime State Inventory

Not a rename/refactor/migration phase, so the full inventory is omitted. The one data-touching change is additive: new tables and two nullable columns on `microsoft_accounts`. Existing rows need no data migration; `reconnect_required_at` and `graph_backoff_until` default to `NULL`, which means "no problem recorded".

## Common Pitfalls

### Pitfall 1: A ghost pointerdown starts a time-entry selection
**What goes wrong:** Clicking a ghost opens the create modal (the grid wrapper's `guardedSlotPointerDown` runs because the ghost is not `.fc-event`).
**Why it happens:** `onSlotPointerDown` only exempts `.fc-event` [VERIFIED: `useSlotSelection.ts` line 25].
**How to avoid:** `data-calendar-overlay` on the ghost plus the one-line selector change; test it (vitest pointer test and the Playwright test).
**Warning signs:** Create modal or a blue selection rectangle appears when clicking a ghost.

### Pitfall 2: Partial traversal marks real meetings as gone
**What goes wrong:** Page 3 times out, the sync "succeeds" with 20 of 60 events, 40 meetings vanish (and their dismissals/links look orphaned).
**How to avoid:** `gone_at` only after a complete traversal; page cap or deadline sets `truncated` and skips it; test with `Http::sequence` ending in a 500 and with `max_pages=2`.

### Pitfall 3: Empty pages with a `nextLink`
**What goes wrong:** Loop stops at page 1 (zero events) and shows nothing.
**Why:** Most `prod-select` fixture pages are `value: []` with a `nextLink` (round A counts per page: `[0,1,1,1,0,0,0,2,0,1,2,1,2,0,1,1,0,0,0,1,0,0]`) [VERIFIED: computed from `tests/Fixtures/M365/calendarview/roundA.prod-select.page-1..22.json`].
**How to avoid:** loop on `nextLink` presence only; the fixture replay test needs `max_pages >= 22` (make it configurable and set 30 in the test).

### Pitfall 4: `upsert()` bypasses model events and casts
**What goes wrong:** `HasUuids` does not run, so `id` is NULL (insert fails); Carbon values are not cast.
**How to avoid:** supply `Str::uuid()->toString()` per row, format timestamps as `Y-m-d H:i:s` UTC yourself, and list update columns explicitly (never `dismissed_at`, `id`, `created_at`).

### Pitfall 5: Default QueryClient retries and refetches
**What goes wrong:** A 5xx or a tab focus becomes repeated Graph calls (`new QueryClient()` defaults: retry 3, refetch on window focus [VERIFIED: `app.ts` line 15]).
**How to avoid:** sync is a mutation with `retry: false`; the read query sets `retry: false`, `refetchOnWindowFocus: false`.

### Pitfall 6: Coupling meetings to the calendar `loading` flag
Covered above: toolbar and grid disappear while meetings load. Keep the meetings state completely separate.

### Pitfall 7: Misclassifying a bad client secret as a reconnect
An expired secret yields `invalid_client` for **every** user; showing "Reconnect Microsoft" would send everyone through a flow that cannot work. Classify on the OAuth `error` string as in Pattern 1 and surface "Outlook unavailable" (+ fixed log reason, AADSTS code only).

### Pitfall 8: Storing the private meeting's title
Filter **before** persisting; scrub `subject`/`organizer_name`/`web_link` when a stored row is later seen as ineligible (DECISIONS-graph.md "Private meetings": "the filter runs before anything is stored").

### Pitfall 9: Window/predicate mismatch in reconcile
calendarView returns events overlapping the window; reconcile must use `starts_at < end AND ends_at > start`, not `starts_at BETWEEN`, or meetings straddling a boundary flip to gone on every other bucket.

### Pitfall 10: Octane state leakage
New services must not cache the account, token or user in properties of a shared instance; register with plain `bind`. Larastan `checkOctaneCompatibility` will flag some, not all.

### Pitfall 11: `MicrosoftLangTest` and Spanish parity
A test exists at `tests/Unit/Microsoft365/MicrosoftLangTest.php` and `lang/es/microsoft365.php` exists [VERIFIED: grep results]. Read the test before adding `lang/en` keys; add matching `lang/es` keys in the same task or the test will fail in CI.

### Pitfall 12: Prettier/Pint/PHPStan only run in CI for PHP
There is no PHP on the dev host. Pint (`strict_comparison`, `declare_strict_types`) and PHPStan level 7 will reject loose code. Treat `Http` `->json()` as `mixed` (guard with `is_array`), annotate Eloquent builders (`Builder<OutlookMeeting>`), and push early.

## Code Examples

### Eligibility (fail closed) [pattern from DECISIONS-graph.md "Eligibility signals"]
```php
public function isEligible(array $event): bool
{
    // Missing flag = not eligible: a field that did not come back must never widen what is shown.
    if (($event['isCancelled'] ?? true) !== false) {
        return false;
    }
    if (($event['isAllDay'] ?? true) !== false) {
        return false;
    }
    if (($event['sensitivity'] ?? null) !== 'normal') { // private, confidential, personal all excluded
        return false;
    }
    // Defensive only: Graph removes declined meetings, S4 [DECISIONS-graph.md "Declined meetings"]
    if (($event['responseStatus']['response'] ?? null) === 'declined') {
        return false;
    }

    return is_string($event['id'] ?? null);
}
```

### Header assertion on every page [pattern from `CalendarViewFixturesTest` + DECISIONS-graph.md]
```php
Http::fake(['https://graph.microsoft.com/v1.0/me/calendarView*' => $sequence]);
// ... run sync ...
Http::assertSentCount(count($pages));
Http::assertSent(fn ($request) => $request->hasHeader('Prefer', 'outlook.timezone="UTC", IdType="ImmutableId"')
    && $request->hasHeader('Authorization'));   // repeat per recorded request, not only the first
```

### Fixture loading (existing pattern, copy it)
```php
$manifest = json_decode(file_get_contents(base_path('tests/Fixtures/M365/manifest.json')), true, flags: JSON_THROW_ON_ERROR);
$pageFiles = $manifest['files']['calendarview']['A']['prod-select']['pages']; // array order, never a directory listing
```

### Ghost pointer guard (core one-liner)
```ts
// useSlotSelection.ts, onSlotPointerDown
if (target.closest('.fc-event, [data-calendar-overlay]')) return;
```

### Debounced single-flight sync (shape)
```ts
// useOutlookMeetings.ts (sketch)
const syncMutation = useMutation({ mutationFn: postSync, retry: false });
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Bucket | null = null;
function requestSync(bucket: Bucket, force = false) {
    pending = bucket;
    clearTimeout(timer);
    timer = setTimeout(runPending, force ? 0 : 400);
}
async function runPending() {
    if (syncMutation.isPending.value || !pending) return; // single flight; runs again on settle
    const bucket = pending; pending = null;
    await syncMutation.mutateAsync(bucket); // invalidates ['m365','meetings'] on success
    if (pending && pending.key !== bucket.key) runPending();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Calendar events by default-format ids | `Prefer: IdType="ImmutableId"` | Phase 1 (2026-10-19) | Occurrence key stable across moves; header must ride every page |
| `lastModifiedDateTime`/`attendees(count only)` in `$select` | Production `$select` from DECISIONS-graph.md | Phase 1 | `STACK.md` section 6 is superseded; do not copy it |
| Single `Prefer` per call assumption | One combined `Prefer` header accepted | Phase 1 experiment | Laravel `Http::withHeaders` produces it |

**Deprecated/outdated:**
- `STACK.md` section 6 `$select` and `PITFALLS.md` pitfall 11 `attendees(count only)`: superseded by DECISIONS-graph.md.
- `Calendars.ReadBasic` is the documented least privilege for `calendarView` [CITED: learn.microsoft.com/en-us/graph/api/user-list-calendarview, permissions table] but the project keeps `Calendars.Read` (locked).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `location` is not in the binding `$select`, so Phase 3 shows the Teams/online indicator and an "Open in Outlook" link, not the location text. Adding `location` is an unverified amendment to a binding document | Decision 2 / panel | Low; D-04 says "location / online-meeting indicator". If the owner wants location text, amend DECISIONS-graph.md and re-run a capture first |
| A2 | Graph 403 on calendarView means "consent/permission problem, ask to reconnect" | Pattern 1 | Medium: a permanent 403 would loop the user through Reconnect; keep the code path behind a single mapping so it can become "unavailable" |
| A3 | Disconnect should delete the user's cached meetings and sync windows | Decision 1 | Low-medium: product expectation; if the owner wants dismissals kept across disconnect, keep rows but never serve them while disconnected |
| A4 | Other Outlook "no mailbox" error codes besides `MailboxNotEnabledForRESTAPI` (documented in Microsoft Q&A for `me/calendarView`: "the mailbox is either inactive, soft-deleted, or is hosted on-premise") may occur (`MailboxNotSupportedForRESTAPI`, `ErrorInvalidUser`) | Error taxonomy | Low: allow-list on 404 only; unknown 404s become `unavailable`, not an error |
| A5 | Production is a single web container with the file cache store, so `Cache::lock` coalesces correctly; scaling out needs the `database` cache store | Sync strategy | Low: worst case two concurrent syncs, both bounded by the route throttle and the backoff column |
| A6 | PHP accepts a 7-digit fractional second in `"2026-10-27T13:00:00.0000000"` | Time zone | Low: parser trims to 6 digits and a unit test covers the fixture string |
| A7 | Laravel's `throttle` middleware keys by authenticated user id | Routes | Low: even keyed by IP it caps load; verify in a feature test |
| A8 | `scope=Calendars.Read offline_access` on the refresh request returns a Graph token and a rotated refresh token | Pattern 1 | Medium: if the token endpoint rejects the narrower scope, omit `scope` (documented as optional); covered by a first-deploy smoke (UAT) |
| A9 | AADSTS numbers behind `invalid_grant` (70008, 700082, 50076, 53003) are expiry/inactivity/MFA/Conditional Access | Pattern 1 | None for logic: classification uses the OAuth `error` string only |

## Open Questions

1. **Impersonation window between Phase 3 and Phase 7 (SEC-04).**
   - Known: an admin impersonating a user via Filament runs in that user's session; `STS\FilamentImpersonate\Facades\Impersonation::isImpersonating()` exists [VERIFIED: `vendor/stechstudio/filament-impersonate/src/Facades/Impersonation.php` declares `@method static bool isImpersonating()`]. SEC-04 is formally Phase 7, but from Phase 3 on, an impersonating admin would see the user's meeting titles and trigger Graph with the user's token.
   - Unclear: whether the owner wants the guard now.
   - Recommendation: route every Graph and meeting read through one choke point (the controller base or one middleware) and add a 5-line fail-closed check there now (return `status: not_connected`-like empty payload while impersonating); Phase 7 then verifies and extends. If rejected, record the exposure in the Phase 3 SUMMARY.

2. **Location text in the detail panel (A1).**
   - Recommendation: ship without it; webLink covers "see details in Outlook".

3. **Playwright and the integration-off CI environment.** See Validation Architecture: the CI Playwright job sets no `SOLIDTIME_MICROSOFT_*`, and the Phase 2 spec asserts the login button is absent in that environment, so the integration cannot be switched on globally. Recommendation: the test-hook approach below.

4. **Ghost fully covered by an entry is not clickable.** Accepted under D-01; switch to a reserved lane if UAT objects.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PHP / Composer on dev host | Running PHPUnit/Pint/PHPStan locally | no | - | GitHub Actions (push, then read logs with `gh`) as in Phase 2 |
| Node + npm | Vitest, vue-tsc, ESLint, Prettier locally | yes | Node v24.13.1; `vitest`, `vue-tsc`, `eslint`, `prettier` present in `node_modules/.bin` | - |
| `gh` CLI | CI verification | yes | at `C:\Program Files\GitHub CLI` | - |
| git | commits, `gh run list --commit` | yes | branch `feature/m365-integration`, remote `UntangleSL/solidtime` | - |
| PostgreSQL 15 | PHP feature tests | CI only (workflow runs `postgres:15/16/17`) | - | - |
| Microsoft Graph / real mailbox | Manual UAT only | external | - | All automated tests use `Http::fake` with Phase 1 fixtures |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** PHP locally, so every PHP task is verified in CI (see Validation Architecture "CI verification").

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| PHP framework | PHPUnit 12 via `php artisan test`/`vendor/bin/phpunit`; `Tests\TestCaseWithDatabase` for DB tests; CI-only on this host [VERIFIED: `.planning/codebase/TESTING.md`] |
| Frontend framework | Vitest 4 + happy-dom, `globals: false`, include `resources/js/**/*.{test,spec}.{ts,tsx}` [VERIFIED: `vitest.config.ts`] |
| E2E | Playwright 1.60, specs in `e2e/`, fixtures in `playwright/fixtures.ts` |
| PHP quick run (CI) | `vendor/bin/phpunit --filter 'Microsoft365'` |
| Frontend quick run (local) | `npx vitest run resources/js/m365` |
| Frontend full (local) | `npm run test:unit && npm run type-check && npm run lint && npm run format:check` |
| Full suite (CI) | all workflows green for the HEAD sha (list below) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | `GET /m365/meetings` returns cached rows and sends no HTTP; sync is a separate call; `loading` unaffected | PHP feature + Vitest | `Http::assertNothingSent()` test; `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts` | Wave 0 |
| SYNC-02 | Reuse window (2 syncs, 1 Graph call), forced min-interval, lock coalescing, route throttle, debounce, single flight, button cooldown | PHP feature + Vitest fake timers | `--filter OutlookMeetingSyncTest`; vitest file above | Wave 0 |
| SYNC-03 | Replay fixtures: S1/S1b/S2/S5/S6b/S8 shown; S3 (cancelled), S6 (private), S7 (all-day), SYN-confidential, SYN-personal excluded; S4 absent; S5 `notResponded` shown | PHP unit/feature via `Http::sequence` from `manifest.json` | `--filter OutlookMeetingEligibilityTest` and `OutlookMeetingSyncTest` | Wave 0 (reuses `tests/Fixtures/M365`) |
| SYNC-04 | S2 stored as 08:00Z/09:00Z; emitted `...Z`; client conversion equals 10:00 Europe/Madrid for both; spring-forward synthetic | PHP + Vitest | `--filter OutlookMeetingSyncTest`; `npx vitest run resources/js/m365/calendar/ghostLayout.test.ts` | Wave 0 |
| SYNC-05 | 429 + `Retry-After` persists back-off and returns cached data; 500/timeout gives `unavailable`; no-mailbox gives quiet empty; partial traversal never marks gone; status label rendering | PHP + Vitest | `--filter OutlookMeetingSyncTest`; vitest controls test | Wave 0 |
| CAL-01 | Daily totals unchanged with ghosts; sync never changes `time_entries` count | Vitest (`useCalendarEvents`/layout) + PHP | `npx vitest run`; PHP count assertion | Wave 0 |
| CAL-02 | Pointerdown on ghost starts no selection; control: empty grid does; ghost has no `.fc-event`/`data-event-id`/`.fc-timegrid-col`; no resizer | Vitest component + Playwright | `npx vitest run resources/js/m365/calendar/OutlookGhostLayer.test.ts`; `npx playwright test e2e/outlook-ghosts.spec.ts` | Wave 0 |
| CAL-03 | Other users' rows never returned (member, manager, owner roles); dismiss of a foreign id is 404; no user-id parameter accepted | PHP feature | `--filter OutlookMeetingEndpointTest` | Wave 0 |
| CAL-04 | Dismiss/restore idempotent; dismissal survives a re-sync (upsert excludes `dismissed_at`); `include_dismissed` toggles; restore works | PHP feature + Vitest | same filters | Wave 0 |
| SEC-02 | Expired token refreshes once (form params asserted, rotated refresh token stored encrypted); skew; `invalid_grant` gives reconnect + tokens cleared; `invalid_client` gives unavailable, tokens kept; 5xx transient; second request after lock reuses fresh token; 401 then refresh then retry once; connect clears marker | PHP feature with `Http::fake` | `--filter MicrosoftTokenRefreshTest` | Wave 0 |
| (D-15) | No token, subject or Graph body in `Log`, exception text, Inertia props | PHP via `log-fake` | `--filter OutlookMeetingLoggingTest` (or folded in) | Wave 0 |
| (D-17) | New routes not under `api/`; `openapi.json` unchanged | PHP | route-list assertion | Wave 0 |

### Pointer-handling test design (CAL-02)
- **Vitest (always runs in CI and locally):** mount a harness that renders `CalendarDayColumn` with the overlay slot containing `OutlookGhostLayer` inside a wrapper that wires `useSlotSelection`'s `onSlotPointerDown` (or mount `TimeEntryCalendar` if provider setup proves manageable; `useContextMenu.test.ts` shows the composable-level style). Assertions: (a) dispatch `pointerdown` (button 0) on an empty grid area: `isSelecting` becomes true (control, happy-dom's zero rects still pick a day via the nearest-centre fallback in `getDayFromClientX`); (b) dispatch on a ghost: `isSelecting` stays false; (c) ghost DOM has none of `.fc-event`, `[data-event-id]`, `.fc-timegrid-col`, `.fc-event-resizer`.
- **Playwright:** the CI Playwright job sets no `SOLIDTIME_MICROSOFT_*` variables and `e2e/microsoft-signin.spec.ts` depends on that (login page must show no Microsoft button) [VERIFIED: `e2e/microsoft-signin.spec.ts` header comment], so the integration cannot be enabled for the suite. Follow the existing precedent in `Calendar.vue` (`window.__TEST_SET_ACTIVITY_PERIODS__`, "no-ops in production, safe to ship"): expose `window.__TEST_SET_OUTLOOK_MEETINGS__` from `useOutlookMeetings`, and render the ghost layer whenever meeting data is present (independent of the `enabled` flag). The spec then seeds ghosts and asserts: clicking a ghost opens the panel and no create dialog appears; dragging from a ghost across empty slots creates a selection only after the pointer starts on empty grid (and a drag that **starts** on empty grid and passes over a ghost still completes); an existing time entry overlapping a ghost can still be dragged/resized/edited; `.fc-event` count and day totals are unchanged by ghosts; with no meetings and the integration off the calendar has no Sync control (off switch, OPS-02 groundwork).

### Sampling Rate
- **Per task commit (JS):** `npx vitest run <touched path>` plus `npx prettier --check <touched files>`
- **Per task commit (PHP):** push, then `gh run list --commit "$SHA"` for "PHPUnit Tests", "PHP Linting", "Static code analysis (PHPStan)" (about 10 minutes)
- **Per wave merge:** all JS gates locally (`npm run test:unit`, `type-check`, `lint`, `format:check`, `npm run build` is a CI workflow) and the three PHP workflows in CI
- **Phase gate:** every workflow green for the release sha, same gate as Phase 2 (`gh run list --commit "$SHA" ...` equals the ten `=success` entries: "Fork - Build image", "NPM Build", "NPM Format Check", "NPM Lint", "NPM Test Unit", "NPM Typecheck", "PHP Linting", "PHPUnit Tests", "Playwright Tests", "Static code analysis (PHPStan)") [VERIFIED: `02-11-PLAN.md` Task 1 `<verify>` block]

### CI verification (answers "no PHP on the host")
Adopt the Phase 2 protocol [VERIFIED: `02-11-PLAN.md` Task 1]: commit, push `feature/m365-integration` (workflow `PHPUnit Tests` has `on: push`, 3 Postgres versions, 10-minute timeout [VERIFIED: `.github/workflows/phpunit.yml`]), then:
```bash
SHA=$(git rev-parse HEAD)
gh run list --commit "$SHA" --limit 40 --json workflowName,conclusion --jq '[.[] | .workflowName+"="+.conclusion] | sort | join(";")'
RID=$(gh run list --commit "$SHA" --workflow "PHPUnit Tests" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RID" --log | grep -E "PASS|FAIL" | grep -E "Microsoft365"
```
Count `PASS` lines for each new class and expect `classes x 3` (one per Postgres version). Prefer one push per backend plan (not one per phase) because Pint and PHPStan cannot be run locally; a style failure found at phase end costs a full cycle. Frontend plans verify locally with vitest/vue-tsc/eslint/prettier before pushing. Playwright runs 8 shards (up to 60 min), so start the wait loop in the background as Phase 2 did.

### Wave 0 Gaps
- [ ] `tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php`: manifest-driven fixture loader (page sequence for a pass, scenario event by id), `fakeGraphCalendar()`, `linkAccount(..., expiredToken: true)` (extends `InteractsWithMicrosoft365`)
- [ ] `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php`, `GraphCalendarClientTest.php`
- [ ] `tests/Feature/Microsoft365/OutlookMeetingSyncTest.php`, `OutlookMeetingEndpointTest.php`, `MicrosoftTokenRefreshTest.php`
- [ ] `resources/js/m365/calendar/*.test.ts` (composable, layout, ghost layer, controls)
- [ ] `e2e/outlook-ghosts.spec.ts` plus the `__TEST_SET_OUTLOOK_MEETINGS__` hook
- [ ] Framework install: none

### Manual UAT checklist (end of phase, `human_verify_mode: end-of-phase`)
Real Untangle account: ghosts appear at the right local time for a DST-crossing week; Sync button; revoke the app in Entra then see "Reconnect Microsoft" and complete it returning to `/calendar`; throttle cannot be forced, so rely on the automated 429 tests; non-admin member sees only their own meetings.

## Security Domain

`security_enforcement` is enabled (ASVS level 1, block on high) [VERIFIED: `.planning/config.json`].

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (token handling) | Existing Entra OIDC; refresh via documented grant; secrets only from env |
| V3 Session Management | yes | Session-authenticated routes (`auth:web`, `auth.session`, `verified`); CSRF via the `web` group |
| V4 Access Control | yes | `user_id` scoping on every query, explicit lookup for `{meeting}`, no user id input, no manager path |
| V5 Input Validation | yes | Form Request: ISO range, max span 35 days, uuid, boolean |
| V6 Cryptography | yes | Existing `encrypted` casts; no new crypto |
| V8 Data Protection | yes | Subject only for eligible events; scrub on ineligibility; no payloads in logs; disconnect purges cache |
| V13 API | yes | JSON allow-list resources, throttling, no `/api/v1` exposure |

### Threat Model (STRIDE)

| # | Threat | STRIDE | Standard Mitigation | Test |
|---|--------|--------|---------------------|------|
| T1 | User A reads or dismisses user B's meeting (IDOR) | Information disclosure / Tampering | Scope by `auth id`, explicit `firstOrFail`, 404 for foreign id, no user-id parameter, no implicit binding | `OutlookMeetingEndpointTest` with two users and an admin/manager |
| T2 | Manager/admin views another user's meetings | Information disclosure | No such endpoint; responses only for the session user; Filament has no resource for the new models (do not create one) | Endpoint test + route list |
| T3 | Admin impersonation triggers Graph with the victim's token | Elevation of privilege | Single choke point guard on `Impersonation::isImpersonating()` (Open Question 1; formal owner Phase 7) | Feature test if guard included |
| T4 | Token or Graph body leaks via logs, exceptions, Inertia, audits, cache keys | Information disclosure | Log fixed reasons + exception class + AADSTS code only (Phase 2 pattern); `$hidden`; new models not `Auditable`; shared prop carries labels/URLs/state only; cache keys contain user id only | `log-fake` assertions; assert shared prop keys |
| T5 | Bearer token sent to another host via a forged `nextLink` | Information disclosure / Spoofing | Require https and host exactly `graph.microsoft.com` before following | `GraphCalendarClientTest` with a foreign-host nextLink |
| T6 | Private/confidential meeting title stored or shown | Information disclosure | Fail-closed eligibility before persistence; scrub on later ineligibility; `personal` also excluded | Fixture S6, SYN-confidential, SYN-personal |
| T7 | Stored XSS / unsafe link via `subject`, `organizer_name`, `webLink` | Tampering | Vue text interpolation only (never `v-html`); render `webLink` as `<a>` only if it parses as `https:`, with `rel="noopener noreferrer"` and `target="_blank"` | Vitest with `javascript:` and HTML-in-subject cases |
| T8 | Request flood causes Graph throttling or worker exhaustion | Denial of service | Route throttle, per-user lock, reuse window, persisted `Retry-After` back-off, request/deadline timeouts, page cap, 35-day max span | `OutlookMeetingSyncTest` |
| T9 | Expired client secret causes mass false "Reconnect" | Denial of service (UX) | Classify on OAuth `error`; `invalid_client` is `unavailable` | `MicrosoftTokenRefreshTest` |
| T10 | Refresh race corrupts the token pair | Tampering | `lockForUpdate` + post-lock expiry check; write access and refresh token in one `save()` | `MicrosoftTokenRefreshTest` |
| T11 | Meetings leak into reports/exports/totals | Information disclosure / integrity | Separate tables and client prop; no code path writes `time_entries` in this phase | PHP count assertion; vitest totals |
| T12 | Redirect abuse via the connect return target | Spoofing | `return=calendar` allow-list only, stored server-side, never a URL | `MicrosoftRedirectTest`-style test |
| T13 | CSRF on dismiss/sync | Tampering | `web` middleware group CSRF (XSRF cookie + axios header) | Feature test without token in a non-testing env is not practical; rely on group membership and a route-middleware assertion |

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `docs/m365/DECISIONS-graph.md`, `docs/m365/TOUCHED-CORE-FILES.md`, `tests/Fixtures/M365/README.md` and fixture files (`calendarview/roundA.prod-select.page-*.json`, `roundA.prod-select.requests.json`, `roundB.prod-select.page-14.json`, `scenarios/S8.roundA.json`, `token-response.shape.json`, `manifest.json`), `tests/Unit/M365/CalendarViewFixturesTest.php`, `app/Microsoft365/**` (service provider, config, model, routes, migration, controllers, middleware, gateway, resolver), `config/microsoft365.php`, `lang/en/microsoft365.php`, `resources/js/packages/ui/src/FullCalendar/*` (TimeEntryCalendar, CalendarDayColumn, CalendarToolbar, useSlotSelection, useEventDrag, useCalendarEvents, useCalendarGrid, useContextMenu, useActivityBoxes, useCalendarNavigation, types), `resources/js/Pages/Calendar.vue`, `resources/js/utils/useTimeEntriesCalendarQuery.ts`, `resources/js/app.ts`, `resources/js/m365/*`, `e2e/calendar.spec.ts`, `e2e/microsoft-signin.spec.ts`, `.github/workflows/phpunit.yml`, `02-11-PLAN.md`, `config/scramble.php`, `vendor/stechstudio/filament-impersonate/src/Facades/Impersonation.php`, `.planning/config.json`
- https://learn.microsoft.com/en-us/graph/throttling (429, `Retry-After` in seconds, avoid immediate retries, exponential backoff when absent)
- https://learn.microsoft.com/en-us/graph/throttling-limits (Outlook: 10,000 requests per 10 minutes, four concurrent requests per app+mailbox)
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow (refresh grant parameters, rotation, error code table)
- https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0 (calendarView parameters, `Prefer: outlook.timezone`, start/end interpretation, `$select` note)

### Secondary (MEDIUM confidence)
- https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50173-grant-expired-revoked (revoked grant)
- https://learn.microsoft.com/en-sg/answers/questions/1657546/how-to-fix-mailboxnotenabledforrestapi and https://learn.microsoft.com/en-us/answers/questions/761931/microsoft-graph-api-throws-the-mailbox-is-either-i.html (MailboxNotEnabledForRESTAPI on `me/calendarView`, "inactive, soft-deleted, or hosted on-premise"; Microsoft Q&A, not reference docs)

### Tertiary (LOW confidence)
- Training knowledge only, flagged `[ASSUMED]`: meanings of specific AADSTS numbers, Laravel throttle key, Guzzle handling of encoded `$select`, PHP fractional-second parsing, 403 handling.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages; all verified in repo.
- Architecture (cache, routes, ghost layer, pointer handling): HIGH, derived from code read this session.
- Token and Graph error classification: MEDIUM, OAuth `error` strings cited; Outlook-specific codes partly from Microsoft Q&A.
- Pitfalls: HIGH for repo-derived (empty pages, `upsert`, `loading`, QueryClient defaults, pointer bubbling); MEDIUM for Graph runtime behaviour not captured in fixtures (E1-E6 scenarios were never captured, per DECISIONS-graph.md).

**Research date:** 2026-11-05
**Valid until:** 2026-12-05 (Graph throttling and Entra refresh behaviour are stable; the core calendar files are upstream code and should be re-read if an upstream merge lands first)
