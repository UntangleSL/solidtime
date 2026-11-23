# Phase 6: Out-of-Sync Detection - Research

**Researched:** 2026-11-23
**Domain:** Keeping Outlook-linked time entries consistent with later Outlook changes: change detection on the existing Graph sync plus a daily job, link state on `outlook_meeting_links`, an in-process core update path, and flag UI on calendar entries (Laravel 13 / PostgreSQL 15 / Vue 3)
**Confidence:** HIGH for code contracts, data model and the Graph behaviours captured in Phase 1 fixtures (moved, cancelled, declined, moved out of window). MEDIUM for the in-process core update outside a request (job context) and for Inertia remount navigation. LOW (uncaptured) for cancelled occurrences of a series and for organizer-side deletes.

## Summary

Phase 4 already recorded the snapshot this phase needs. Every link stores the meeting's own time at conversion (`meeting_starts_at`, `meeting_ends_at`), even when the entry got custom times. So D-01 ("the reference is the meeting time recorded at conversion") needs **no new snapshot columns and practically no backfill**. What is missing is **state**: whether a link is flagged (and why, with the new Outlook times), whether a started-and-moved meeting has been **released** back to the suggestions (D-03), and whether the user chose "Keep" on a cancelled or removed meeting. There are also two structural blockers. First, `UNIQUE(user_id, graph_id)` on links makes the D-03 "second entry for the same occurrence" impossible. Second, `CoreTimeEntryCreator` only knows how to **create**, and it depends on an HTTP request whose route carries `{organization}`. The daily job has neither a request nor a session user.

The Graph side is well covered by Phase 1 fixtures. A moved occurrence keeps its immutable id and comes back at its new times. An organizer cancellation the attendee has not processed stays in `calendarView` with `isCancelled=true`. A declined or deleted meeting disappears from `calendarView`, and a direct lookup answers `404 ErrorItemNotFound`. A meeting moved **out of the window** also disappears, but its lookup answers `200` with `isCancelled=false`. So "absent from a complete window" cannot by itself tell "removed" from "moved elsewhere". The safe classifier is: positive sightings in a window (moved, cancelled) are acted on directly, and every absent linked id is confirmed with `GET /me/events/{id}` before anything is flagged. Today's sync throws the cancellation signal away: cancelled events are "ineligible", scrubbed and marked gone with no record of why. The detector must receive the raw `id/start/end/isCancelled/isAllDay` of linked ids **before** the eligibility filter. It needs ids and times only, never the subject.

**Primary recommendation:** Add state columns to `outlook_meeting_links`: `flag_reason`, `flagged_at`, `outlook_starts_at`/`outlook_ends_at`, `released_at`, `detached_at` and `checked_at`. Replace `UNIQUE(user_id, graph_id)` with a partial unique index `WHERE released_at IS NULL`. Put every decision in one **pure** rules class (`OutOfSyncRules::decide(snapshot, entry, observation, now)`) so it can be unit-tested locally. Apply decisions under a per-user lock with row locks. Add `CoreTimeEntryUpdater`, the update twin of the creator, that builds the request against core's real `v1.time-entries.update` route and can act as the link's user inside a job, resetting auth afterwards. Feed the rules from: (a) the interactive sync, with positive sightings plus at most a few lookups for absent linked ids; and (b) a daily scheduled command, registered from `Microsoft365ServiceProvider` through `callAfterResolving(Schedule::class)`, that dispatches one queued job per connected user and does per-link lookups for all active links in scope (future and the last 60 days). The UI needs no new core touch: a flagged marker and popover in `OutlookEntryBadge` (the existing `#event-extra` seam), the counter in `OutlookCalendarControls` (the existing `#toolbar-extra` seam), the flag list carried by the meetings read, and "jump to first" through the existing `/calendar?date=` deep link. **The queue and scheduler containers need the `SOLIDTIME_MICROSOFT_*` variables added in the compose file**, or token refresh fails in the job.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### The rule: "started" vs "not started" (owner, 2026-11-23)
- **D-01:** The reference is the meeting time recorded at conversion (a snapshot of start and end on the link), not the entry's own times. A meeting counts as **started** when its recorded start is at or before "now" at the moment the change is detected (it happened, or is happening).
- **D-02:** **Started meeting, any Outlook change** (moved, shortened, cancelled, removed): the entry is never modified and never flagged. An Outlook clean-up of old meetings therefore produces no warnings.
- **D-03:** **Started meeting moved to a new slot.** This is the owner's "second session" case: the organiser drags the existing meeting to another day instead of creating a new one.
  - The meeting shows again as a normal suggestion at its new slot.
  - From there the user can "Create time entry" (the default: a second entry for the new session).
  - Or the user can "Move my entry here": the existing linked entry takes the new times. This covers a meeting rescheduled at the last minute.
  - The original entry and link stay as they are until the user chooses.
- **D-04:** **Not-started meeting moved** (start, end or duration changed):
  - If the entry's start and end still equal the recorded meeting times, the entry is adjusted automatically to the new Outlook times and the snapshot is updated. The adjustment goes through the core update path (permissions, rounding, recalculation jobs).
  - If the user had changed the entry's times by hand, the entry is flagged instead ("Moved in Outlook: old → new"), with **Adjust to Outlook** / **Keep as is**.
- **D-05:** **Not-started meeting cancelled or removed:** the entry is flagged ("Meeting cancelled in Outlook" / "Meeting removed from Outlook"), with **Delete entry** / **Keep as is**. It is never deleted automatically.
- **D-06:** Only time changes and cancellation/removal matter. Changes to the subject, attendees, location or body never flag or modify anything.
- **D-07:** What never flags anything:
  - Editing an entry's times in solidtime never flags it on its own. It only turns off the automatic adjust of D-04.
  - Graph errors, throttling, and partial or failed syncs never flag, adjust or resurface anything.
  - A meeting counts as "removed" only when a successful sync of a window covering its recorded slot no longer returns it, or a direct lookup answers 404 (per the Phase 1 decision document).

#### Visibility (owner, 2026-11-23)
- **D-08:** A flagged entry carries a visible marker on its calendar block, next to the Outlook icon, plus the reason with the old and new time. The choice is offered from the entry (click or menu).
- **D-09:** When there are flagged entries, the calendar toolbar shows "N out of sync". Clicking it jumps to the first one.
- **D-10:** Flags, the counter and the checks cover only entries whose recorded meeting start is in the future or within the last 60 days. Older entries are never checked or flagged.
- **D-11:** Besides the sync that runs when a week is opened, a daily background job checks linked meetings in that window (future plus the last 60 days) for every connected user. This keeps the counter right even for weeks the user has not opened. The job follows the Phase 3 throttling/backoff rules and never runs for users without a valid connection.

#### Carried forward
- **D-12:** The auto adjust in D-04 is an explicit owner exception to the original rule that Outlook changes never modify entries. It is limited to entries of not-started meetings that the user has not edited. The PROJECT constraint and OSYNC-02 are revised accordingly. Deletion is never automatic.
- **D-13:** Fork isolation as before:
  - Core touches (the entry marker on calendar blocks) are kept minimal and ledgered.
  - Fork endpoints stay outside the `/api/v1` OpenAPI spec.
  - Strings are in English and Spanish.
- **D-14:** Privacy and impersonation rules are unchanged (Phase 3 D-15/D-16/D-22). An impersonating admin sees no flags and cannot act on them.
- **D-15:** The release ends with an owner-free deploy as soon as CI is green, because the system is not in production.

### Claude's Discretion
- Where the snapshot and flag are stored (columns on `outlook_meeting_links` or a new table).
- How the snapshot is backfilled for links created before this phase: from the cached meeting when available, otherwise from the entry times.
- How the daily job fetches (calendarView windows or per-event lookups), when it runs, and how it batches.
- The marker icon, the wording, where the toolbar counter sits, how "jump to first" navigates, and where "Move my entry here" lives (form, panel or menu).
- If the linked entry was deleted, there is nothing to do: the link already cascades away.

### Deferred Ideas (OUT OF SCOPE)
- Updating an entry's description when the meeting is renamed. The owner chose time and cancellation only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OSYNC-01 | For entries created from meetings whose recorded start is in the future or within the last 60 days, Outlook changes are checked on calendar sync and by a daily background job. A meeting that had already started is never flagged and its entry is never changed. If such a meeting was moved, it shows again at its new slot, where the user can create a second entry or move the existing one there. | Q1 (sightings + lookups), Q3 (release + partial unique index + read hide rule + `previous_entry` on the meeting + move endpoint), Q5 (daily job), rules table (Pattern 1) |
| OSYNC-02 | Not-started meeting: moved and unedited → entry follows automatically; edited, cancelled or removed → flagged with what changed, toolbar counter; never deleted automatically; subject/attendee changes, user edits and Graph errors never flag or change anything. | Pattern 1 rules, Q4 `CoreTimeEntryUpdater`, Q2 flag columns, Q6 counter, Pitfalls 1-9 |
| OSYNC-03 | For a flagged entry, user can choose: keep as is (clears flag), adjust to the new Outlook time, or delete the entry. | Pattern 5 (keep/adjust endpoints), delete through core `deleteTimeEntry` mutation (link cascades), Q6 marker popover |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`: `declare(strict_types=1)`, typed signatures, Pint `laravel` preset with strict rules, PHPStan level 7 with `checkOctaneCompatibility` and `noEnvCallsOutsideOfConfig`, `<script setup lang="ts">`, Prettier 4-space / single quotes / width 100, ESLint unused-imports.
- Graph scopes stay minimal: `openid profile email offline_access User.Read Calendars.Read`. `GET /me/events/{id}` needs only `Calendars.Read` (or ReadBasic) [CITED: learn.microsoft.com/en-us/graph/api/event-get permissions table]. No new scope.
- Security: tokens encrypted, never logged; no subject, Graph payload or token in logs, audits, session, cache keys or Inertia props (Phase 3 D-15).
- Mergeability: changes isolated in `app/Microsoft365/` and `resources/js/m365/`; any core touch minimal and ledgered in `docs/m365/TOUCHED-CORE-FILES.md`; fork endpoints outside `/api/v1` and `openapi.json`.
- Octane: services must hold no static or singleton per-request state.
- `.claude/CLAUDE.md` "Constraints → Data safety" still reads "Outlook changes never modify or delete existing time entries automatically". That is **stale** against D-12 and `.planning/PROJECT.md:71`. `.planning/PROJECT.md:38` and `:47` are stale too [VERIFIED: grep of PROJECT.md lines 38, 47, 71]. The planner should add a docs task to align them, because a verifier reading CLAUDE.md would otherwise reject the D-04 auto adjust.
- GSD workflow enforcement: edits only through GSD commands. Not relevant to research output.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Observe Outlook changes (window sightings, per-event lookups) | API / Backend (fork Graph layer) | — | Only the backend holds tokens. It reuses `GraphCalendarClient` and `MicrosoftTokenService`. |
| Decide in sync / auto adjust / flag / release | API / Backend (pure rules class) | Database (link state) | Deterministic and testable without HTTP. Never in the browser (privacy, consistency across devices). |
| Apply auto adjust / Adjust / Move entry | API / Backend via core `TimeEntryController::update` in-process | Database | D-04 requires the core update path: permissions, overlap, recalculation jobs. |
| Daily check for all connected users | Scheduler + Queue workers | API / Backend services | D-11. Runs outside any request. |
| Link snapshot, flag, release, keep state | Database (`outlook_meeting_links`) | — | Fork-owned table that survives Disconnect (Phase 4 D-15). |
| Marker, reason popover, counter, jump-to-first | Browser / Client (fork components in core slots) | API (read payload carries flags) | Display only. Actions call fork endpoints or the core delete mutation. |
| Delete flagged entry | Browser → core `/api/v1` DELETE | Database cascade drops the link | Core mutation keeps TanStack caches right (D-05 OSYNC-03). |

## Standard Stack

### Core
No new packages. Everything is in the repo already.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| laravel/framework | ^13.0 (composer.json) | Scheduler, queued jobs, cache locks, HTTP client | Already the app framework |
| tpetry/laravel-postgresql-enhanced | ^3.0.0 | Partial unique index `uniqueIndex(...)->where(...)` | Core already uses it: `database/migrations/2014_10_12_000000_create_users_table.php:38-39` `$table->uniqueIndex('email')->where('is_placeholder = false');` [VERIFIED: file read] |
| Vue 3 + @tanstack/vue-query 5 | per package.json | Read payload, mutations, invalidation | Existing fork composable `useOutlookMeetings.ts` |
| @inertiajs/vue3 | 2.3.27 installed | `router.visit('/calendar?date=...')` remount for jump-to-first | Existing pattern `resources/js/Pages/Time.vue:108-110` [VERIFIED] |

### Supporting (existing in-repo pieces to reuse)
| Piece | Location | Use in Phase 6 |
|-------|----------|----------------|
| `GraphCalendarClient` | `app/Microsoft365/Graph/GraphCalendarClient.php` | Add an `event()` lookup method with the same token closure, Prefer header, timeouts and failure mapping |
| `MicrosoftTokenService::accessToken()` | `app/Microsoft365/Graph/MicrosoftTokenService.php:82-124` | Token refresh under a row lock in job context (no request needed) |
| `RetryAfter::seconds()` | `app/Microsoft365/Graph/RetryAfter.php` | Back-off clamp 1..300 s, default 30 |
| `MicrosoftAccount::calendarAccessState()` / `backoffRemainingSeconds()` | `app/Microsoft365/Models/MicrosoftAccount.php:111-127` | Job eligibility and back-off guard |
| `GraphAccessGuard::blocked()` | `app/Microsoft365/Graph/GraphAccessGuard.php` | Impersonation guard on read, actions and sync |
| `CoreTimeEntryCreator` | `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` | Template for `CoreTimeEntryUpdater` |
| Lookup fixtures S3/S4/S5/S5b | `tests/Fixtures/M365/lookups/*.roundB.json` | PHPUnit replays for cancelled / 404 / moved / moved-out-of-window |
| `OutlookEntryBadge.vue`, `OutlookCalendarControls.vue`, `useOutlookMeetings.ts` | `resources/js/m365/calendar/` | Marker, counter, actions, test hook |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Columns on `outlook_meeting_links` | New `outlook_link_changes` table | A second table needs its own cascade and join everywhere, while the state is 1:1 with the link. Columns follow the fork's `*_at` timestamp style (`dismissed_at`, `ignored_at`, `forgotten_at`). |
| Per-link lookups in the daily job | One `calendarView` over [now-60d, max future recorded end] | A wide window can hit `max_pages` 10 / deadline 15 s and come back **partial**, and absent ids still need lookups. Lookups are exact, and the job is bounded by link count. |
| Single GETs | JSON `$batch` (20 per request) | Fewer round trips. But batch items have per-item status and Retry-After, and Graph runs only 4 at a time per mailbox anyway [CITED: learn.microsoft.com/en-us/graph/throttling-limits "Outlook service limits for JSON batching"]. Not worth it at Untangle volumes. |
| Reload-free jump via a new core seam (`navigateTo` prop on `TimeEntryCalendar`) | `router.visit('/calendar?date=…&entry=…')` | The visit needs no core touch and is an existing pattern. The cost is a page remount. |
| Detection in the browser | — | Rejected: needs Graph data in the browser and breaks the daily job. |

**Installation:** none.

## Package Legitimacy Audit

Not applicable: this phase installs no external packages (npm, Composer or other).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Browser (calendar week open / Sync)            Scheduler (supercronic → schedule:run every minute)
        │ POST /m365/meetings/sync                      │ daily 05:30 Europe/Madrid
        ▼                                               ▼
 OutlookMeetingSyncService::traverse          m365:check-out-of-sync (command)
   calendarView window (all pages)              selects users with calendarAccessState()=='connected'
        │ raw events                            and no active back-off → dispatch CheckOutOfSyncForUser
        ├─► eligibility filter → cache rows        (queued, one per user, staggered)
        │                                               │
        └─► LinkedSightings (ids+times only,            ▼
            BEFORE the filter, for linked ids)   CheckOutOfSyncForUser (queue container)
                 │                                 active links in scope (recorded start ≥ now-60d,
                 │ complete window? absent          not released/detached, entry alive & owned)
                 │ linked ids → ≤N lookups          → GET /me/events/{id} per link (stop on 429)
                 ▼                                               │
          Observation per link: Present(s,e,allDay) | Cancelled | Removed(404) | Unknown
                 │                                               │
                 └──────────────────────┬────────────────────────┘
                                        ▼
                  OutOfSyncApplier (per-user lock m365:osync:{user})
                    re-read link + entry FOR UPDATE, skip if link.checked_at > observedAt
                    decision = OutOfSyncRules::decide(snapshot, entry, observation, now)  (pure)
                        ├─ Nothing / ClearFlag
                        ├─ AutoAdjust ──► CoreTimeEntryUpdater ──► core TimeEntryController::update
                        │                   (permissions, overlap, recalculation jobs)
                        │                   failure → Flag(moved)
                        ├─ Flag(moved | cancelled | removed, outlook times)
                        └─ Release (started + moved) ──► meeting row gets new times; read shows it again
                                        │
                                        ▼
                     outlook_meeting_links state  ◄── Keep / Adjust / Move-entry endpoints (session user)
                                        │
          GET /m365/meetings ──► meetings (hide only if an ACTIVE link exists), linked_time_entry_ids,
                                 out_of_sync {count, items[]} (current org, D-10 scope)
                                        │
                                        ▼
      OutlookEntryBadge (marker + popover: Keep / Adjust / Delete→core DELETE) · OutlookCalendarControls
      ("N out of sync" → jump to first via /calendar?date=…) · OutlookGhostDetail ("Move my entry here")
```

### Recommended Project Structure
```
app/Microsoft365/
├── OutOfSync/
│   ├── Observation.php            # readonly value: kind (present|cancelled|removed|unknown), start, end, allDay, observedAt
│   ├── OutOfSyncRules.php         # PURE decide(): no DB, no clock reads (now passed in)
│   ├── Decision.php               # readonly value: action + flag reason + outlook times
│   ├── OutOfSyncApplier.php       # locks, re-reads, applies a Decision (writes link, calls updater)
│   ├── LinkedSightings.php        # extracts {graph_id => Observation} from raw calendarView events for linked ids
│   └── OutOfSyncScope.php         # query of active links in D-10 scope (shared by job, read, counter)
├── Graph/GraphCalendarClient.php  # + event(Closure $token, string $graphId): lookup
├── Graph/OutlookMeetingSyncService.php  # + hand sightings to the applier (inside the existing lock)
├── TimeEntries/CoreTimeEntryUpdater.php # update twin of CoreTimeEntryCreator
├── Jobs/CheckOutOfSyncForUser.php       # ShouldQueue, tries 3, release on back-off
├── Console/CheckOutOfSyncCommand.php    # m365:check-out-of-sync, dispatches per-user jobs
├── Http/Controllers/OutOfSyncController.php   # keep / adjust / move-entry
└── database/migrations/2026_11_2x_000001_add_sync_state_to_outlook_meeting_links.php
resources/js/m365/calendar/
├── OutlookEntryBadge.vue          # + flagged marker + popover (reason, Keep / Adjust / Delete)
├── OutlookOutOfSyncCounter.vue    # (or inside OutlookCalendarControls) "N out of sync" button
├── outOfSync.ts                   # pure helpers: reason text, first item, format old → new
└── useOutlookMeetings.ts          # + outOfSync list, keep/adjust/moveEntry, jump, test hook option
```

### Pattern 1: The rules, as one pure function (D-01..D-07, D-10)

**What:** every decision from one function, with `now` passed in. The applier only moves data.

| Observation (for an ACTIVE link in scope) | started = snapshot_start ≤ now | Entry equals snapshot? | Decision |
|---|---|---|---|
| Present at snapshot slot | any | any | Nothing. If the link was flagged `moved`/`cancelled`/`removed` → **ClearFlag** (Outlook is back to what was recorded) |
| Present at another slot (start or end differ, not all-day) | yes | any | **Release** (D-03): `released_at = now`. Link and entry untouched otherwise. Any existing flag stays as is. |
| Present at another slot | no | yes | **AutoAdjust** to (s, e) and set snapshot = (s, e) (D-04). On updater failure → **Flag moved** |
| Present at another slot | no | no | If the entry already equals (s, e) (the user fixed it by hand) → **Resync**: snapshot = (s, e), clear flag. Else **Flag moved** with outlook = (s, e) (D-04) |
| Present, became all-day | no | any | **Flag moved** with outlook times, never auto-adjust (a 24 h UTC block is not a working slot); Adjust hidden in the UI [ASSUMED, see A3] |
| Present, became all-day | yes | any | Nothing (D-02; an all-day "slot" is not a session to resurface) [ASSUMED] |
| Cancelled (`isCancelled=true` in window or lookup) | no | any | **Flag cancelled** (D-05) |
| Removed (lookup `404` with `error.code = ErrorItemNotFound`) | no | any | **Flag removed** (D-05). Declined meetings also land here (DECISIONS-graph.md "Declined meetings") |
| Cancelled / Removed | yes | any | Nothing (D-02) |
| Unknown (401/403/429/5xx/timeout/other 404 code/partial window absence) | any | any | Nothing (D-07) |

Scope filter before the rules (D-10): `meeting_starts_at >= now - 60 days` (future included), `released_at IS NULL`, `detached_at IS NULL`, snapshot not null, entry exists and `time_entries.user_id = links.user_id` (otherwise the link is stale, per Phase 4 Pitfall 4).

Equality is compared as UTC strings `Y-m-d H:i:s` (columns are `dateTime`, second precision [VERIFIED: time_entries migration `$table->dateTime('start'); $table->dateTime('end')->nullable();`]). Core rounding is never stored: `TimeEntryService::getStartSelectRawForRounding` / `getEndSelectRawForRounding` only build SELECT expressions for reports [VERIFIED: app/Service/TimeEntryService.php:13-45]. So "entry equals snapshot" is an exact compare. Note: a Phase 4 conversion with custom times (Phase 4 D-03) never equals its snapshot, so its moves are flagged, not auto-adjusted. That is correct per D-04.

### Pattern 2: Link state columns (Q2)

Existing snapshot [VERIFIED: app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php:42-43]:
`$table->dateTime('meeting_starts_at')->nullable();` / `$table->dateTime('meeting_ends_at')->nullable();`. Written at every conversion from the meeting row [VERIFIED: MeetingConversionController.php:186-187 `'meeting_starts_at' => $meeting->starts_at,` `'meeting_ends_at' => $meeting->ends_at,`].

New columns (one additive fork migration):

| Column | Type | Meaning |
|---|---|---|
| `flag_reason` | `string(20)` nullable | `moved` \| `cancelled` \| `removed`; null = not flagged |
| `flagged_at` | `dateTime` nullable | when the flag was set (counter, ordering) |
| `outlook_starts_at`, `outlook_ends_at` | `dateTime` nullable | new Outlook slot for `moved` ("old → new"); the Adjust target |
| `released_at` | `dateTime` nullable | D-03: started meeting moved; the link no longer hides the meeting and is never checked again |
| `detached_at` | `dateTime` nullable | "Keep as is" on a cancelled/removed flag: never checked again |
| `checked_at` | `dateTime` nullable | time of the last applied observation (stale-observation guard, job ordering) |

Index changes:
- Drop `$table->unique(['user_id', 'graph_id']);` [VERIFIED: links migration :46] (default name `outlook_meeting_links_user_id_graph_id_unique` [ASSUMED: Laravel default naming]).
- Add `$table->uniqueIndex(['user_id', 'graph_id'], 'outlook_meeting_links_active_unique')->where('released_at is null');`: at most one **active** link per occurrence, so Phase 4 D-06 idempotency and the `UniqueConstraintViolationException` race path keep working.
- Keep `$table->uuid('time_entry_id')->unique();` [VERIFIED :35]. Each link still has its own entry.
- Add `index(['user_id', 'meeting_starts_at'])` for scope queries.

Backfill (discretion): `meeting_starts_at` is null only if a link was created outside `convertOne`, so expect zero rows. Still run, in this order, and only `WHERE meeting_starts_at IS NULL`: (1) from `outlook_meetings` on `(user_id, graph_id)`, (2) from `time_entries` (start, end). **Never overwrite a non-null snapshot with cached meeting times.** The cache may already show the moved time, and overwriting would silently swallow the change. Pattern: public `backfill()` with `DB::statement(<<<'SQL' … SQL)` as in `2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php:46-57` [VERIFIED].

Migration conventions [VERIFIED: app/Microsoft365/database/migrations/*]: file under `app/Microsoft365/database/migrations/` (loaded by `Microsoft365ServiceProvider::boot` `loadMigrationsFrom`), `declare(strict_types=1)`, anonymous class, docblock explaining why, `Schema::table`, explicit `down()`. Production runs it through `AUTO_DB_MIGRATE: "true"` on the app container [VERIFIED: docs/deploy/dokploy-compose.fork.yml]. `down()` re-adding the plain unique fails if two links of one occurrence exist; document that in the docblock.

### Pattern 3: Converted meeting visibility and D-03 (Q3)

Today the read hides a meeting while **any** link with a live, owned entry exists [VERIFIED: OutlookMeetingController.php:87-94 `->whereNotExists(... ->from('outlook_meeting_links')->join('time_entries', ...) ->whereColumn('time_entries.user_id', 'outlook_meeting_links.user_id'))`]. There is one cached row per `(user_id, graph_id)` [VERIFIED: create_outlook_meetings_tables.php:44 `$table->unique(['user_id', 'graph_id']);`], and the sync upsert moves it to the new times [VERIFIED: OutlookMeetingSyncService.php:436-453 update list includes `starts_at`, `ends_at`].

New rule: hide the meeting iff an **active** link exists (`released_at IS NULL`) with a live owned entry. Effects:
- Not started, auto-adjusted or flagged: the link stays active, so the meeting stays hidden. The decision lives on the entry.
- Started and moved: the link is released, so the meeting shows at its new slot as a normal suggestion, with Phase 5 pre-assignment for free.
- "Create time entry" on it: `convertOne` finds no active link (`linkOf` must add `->whereNull('released_at')`, today :253-260) and creates a second link with the new snapshot. The partial index allows it.
- "Move my entry here": new endpoint `POST /m365/organizations/{organization}/meetings/{meeting}/move-entry`. Under the meeting row lock it takes the **latest released link** of that graph id whose entry is live, owned and in `{organization}`. It updates the entry to the meeting's current slot through `CoreTimeEntryUpdater`, then sets snapshot = slot, `released_at = null`, clears the flag and sets `checked_at`. If an active link now exists (a race with Create), answer `existing` and do nothing.
- The read adds, per meeting, `previous_entry: {time_entry_id, start, end} | null`. Fill it only when the meeting has no active link and a released link with a live owned entry in the current org exists. The panel (`OutlookGhostDetail.vue`) and the context menu (`OutlookMeetingContextItems.vue`) then offer "Move my entry here" beside "Create time entry". Create stays the default (D-03). Own entries only, so there is no privacy change.
- Stale cache: when a lookup (daily job) releases a link, also update the cached meeting row's `starts_at`/`ends_at`. Times only, keyed by `(user_id, graph_id)`, and only when the row exists and is not gone. Otherwise the week with the original entry would show a ghost of the same meeting at the old time until that week is re-synced.
- `linked_time_entry_ids` stays as it is (all links), so both entries keep the Outlook icon.

Options evaluated for the unique constraint:
| Option | Verdict |
|---|---|
| Partial unique `(user_id, graph_id) WHERE released_at IS NULL` | **Recommended.** One active link per occurrence, any number of settled ones. Race safety unchanged. |
| `UNIQUE(user_id, graph_id, meeting_starts_at)` | Breaks when an auto adjust rewrites the snapshot onto a slot already used by a released link. The hide rule gets time-based and fragile. |
| Drop uniqueness, enforce in code | Loses the DB guarantee Phase 4 D-06 relies on (double clicks, concurrent requests). |

Phase 5 effects: series history and learned signals read all links. A second link is just another conversion of the series, which is harmless [VERIFIED: series resolver orders links by `created_at`, migration 2026_11_18_000001 index `['user_id', 'series_master_id', 'created_at']`].

### Pattern 4: `CoreTimeEntryUpdater` (Q4)

Core facts [VERIFIED: app/Http/Controllers/Api/V1/TimeEntryController.php:680-764, app/Http/Requests/V1/TimeEntry/TimeEntryUpdateRequest.php]:
- `update(Organization $organization, TimeEntry $timeEntry, TimeEntryUpdateRequest $request): JsonResource`. It checks `time-entries:update:own` (or `:all`) through `PermissionStore::has()`, which reads `Auth::user()` [VERIFIED: PermissionStore.php `has()` returns false when `Auth::user()` is null]. It also calls `$this->member($organization)`, which needs `Auth::user()` [VERIFIED: app/Http/Controllers/Controller.php:25-54]. It runs `assertNoOverlap` only when `prevent_overlapping_time_entries` is on, and dispatches `RecalculateSpentTimeForProject`/`Task` for the old and new project and task.
- `TimeEntryUpdateRequest::rules()` reads `$this->route('timeEntry')` and `$this->organization` (route parameters). `start`/`end` use `date_format:Y-m-d\TH:i:s\Z` and `end` is `after_or_equal:start`.
- The core route is `Route::put('/time-entries/{timeEntry}', [TimeEntryController::class, 'update'])->name('update')->middleware('check-organization-blocked')` inside `Route::prefix('v1')->name('v1.')` → `name('time-entries.')` [VERIFIED: routes/api.php:39, :112-118]. The in-process call bypasses that middleware, so the updater must reproduce it: `app(BillingContract::class)->isBlocked($organization)` → throw `OrganizationHasNoSubscriptionButMultipleMembersException` [VERIFIED: app/Http/Middleware/CheckOrganizationBlocked.php].

Design:
- Payload `['start' => …, 'end' => …]` only, in `MeetingConversionRequest::FORMAT` (`'Y-m-d\TH:i:s\Z'` [VERIFIED: MeetingConversionRequest.php:34]). Never send project or description, so nothing else changes.
- Build the request from scratch so it works with and without a base request. `TimeEntryUpdateRequest::create($uri, 'PUT')`, then a fresh `InputBag` for json/request (as the creator does at CoreTimeEntryCreator.php:44-49). Match the real core route (`app('router')->getRoutes()->getByName('v1.time-entries.update')` [ASSUMED name resolution; assert in a contract test]), `bind($request)`, `setParameter('organization', $organization)`, `setParameter('timeEntry', $entry)`, `setRouteResolver`, `setUserResolver(fn () => $actor)`, `setContainer(app())->setRedirector(...)`, `validateResolved()`, then `app(TimeEntryController::class)->update($organization, $entry, $request)`.
- Organization = the **entry's** organization (`$entry->organization`), never the user's current team. Links are not org-scoped.
- Acting user:
  - HTTP context (sync, Keep/Adjust/Move): assert `Auth::id() === $actor->getKey()` and do not touch the guard.
  - Job context: `Auth::guard('web')->setUser($actor)` in `try`, and `Auth::guard('web')->forgetUser()` in `finally`. `GuardHelpers::forgetUser()` exists [VERIFIED: vendor/laravel/framework/src/Illuminate/Auth/GuardHelpers.php:97]. The queue worker resets scoped instances and facades between jobs but **not auth guards** [VERIFIED: vendor/laravel/framework/src/Illuminate/Queue/QueueServiceProvider.php:248-266 resetScope], so the reset is mandatory. `PermissionStore` is `scoped` [VERIFIED: app/Providers/AppServiceProvider.php:100] and its cache is keyed `user|org`, so it is safe across users.
- Not final, with a contract test mirroring `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php`: the `update` signature is `[Organization, TimeEntry, TimeEntryUpdateRequest]` returning `JsonResource`, and the route name resolves.
- Failure mapping: `ValidationException`, `AuthorizationException`, `ApiException` (overlap, blocked org) → auto adjust becomes **Flag moved**. In the Adjust endpoint they become the per-entry error shown in the popover. Nothing is logged except a fixed reason key.
- Auditing: owen-it auditing attributes the change to `Auth::user()`, which is the link's user in both contexts. That is acceptable, and it is the user's own entry.

Race with a user edit: run decide and update inside one DB transaction that first locks the entry (`TimeEntry::query()->whereKey(...)->lockForUpdate()`) and the link, and re-reads both. A user PUT arriving meanwhile blocks on the row lock and then wins with its own values. The next check sees Outlook == snapshot (already moved), so nothing happens. That matches D-07: user edits never flag on their own.

### Pattern 5: Actions (OSYNC-03)

Routes in `app/Microsoft365/routes/microsoft365.php`: same group, `web` + `auth:web` + `auth.session` + `verified`, prefix `m365`, never `/api` [VERIFIED: routes file :25-27]. Parameter `{entry}` is `whereUuid`, looked up in the session user's own flagged links (`links.user_id = auth id`, `time_entries.user_id = auth id`). A foreign, unknown or unflagged id gives a plain 404, and impersonation also gives 404 (Phase 3 D-22 pattern `OutlookMeetingController::ownMeeting`).

| Action | Endpoint | Effect |
|---|---|---|
| Keep as is (moved) | `POST /m365/out-of-sync/{entry}/keep` | snapshot := outlook times, clear flag, `checked_at = now`. Tracking continues, so a later move is detected again. |
| Keep as is (cancelled/removed) | same | clear flag, `detached_at = now`. Never checked again (otherwise the next run re-flags). |
| Adjust to Outlook (moved only) | `POST /m365/out-of-sync/{entry}/adjust` | `CoreTimeEntryUpdater` → (outlook_starts_at, outlook_ends_at); then snapshot := outlook times, clear flag. 422-style per-entry error on failure, flag kept. Route also gets `check-organization-blocked`? It cannot: no `{organization}` param. The updater checks blocking itself (Pattern 4). |
| Delete entry | core `DELETE /api/v1/organizations/{org}/time-entries/{id}` through `useTimeEntriesMutations().deleteTimeEntry` | The link cascades [VERIFIED: links migration :36-40 `cascadeOnDelete`]. The mutation invalidates `['timeEntries']` [VERIFIED: useTimeEntriesMutations.ts:132], and the existing subscription refreshes the meetings read [VERIFIED: useOutlookMeetings.ts refresh on `timeEntries` success, `ENTRIES_REFRESH_DEBOUNCE_MS = 500`], so the counter updates. |
| Move my entry here (D-03) | `POST /m365/organizations/{organization}/meetings/{meeting}/move-entry` | Pattern 3 |

Throttle each new route like the others (`throttle:60,1,m365-osync:`). Update `OutlookMeetingPrivacyTest::test_no_meetings_route_takes_a_user_parameter` [VERIFIED: tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php:751 `$this->assertCount(8, $routes);`]. It counts `microsoft.meetings.*` routes and allows only `meeting`/`organization` parameters. Name the new routes `microsoft.out-of-sync.*`, or extend the allowed parameter list with `entry`.

### Pattern 6: Interactive sync integration (Q1)

The current flow [VERIFIED: OutlookMeetingSyncService.php:109-176]: traverse → per event `isEligible` → ineligible ids are collected, then `scrubIneligible` sets `gone_at` and nulls the subject and attendees → rows upserted. On failure there is no window record. On a **complete** traversal, `markUnseenGone`. Eligibility treats `isCancelled !== false` as ineligible [VERIFIED: OutlookMeetingEligibility.php:19 `if (($event['isCancelled'] ?? true) !== false) {`], so the cancellation reason is lost today.

Change:
1. Before the eligibility loop, load the user's **active link graph ids in scope** (one query). For each raw event whose `id` is in that set, record an `Observation` from `start`, `end` (`parseGraphUtc`, UTC only), `isCancelled === true`, `isAllDay === true`. Ids and times only, never subject or attendees, which preserves T-03-13. A private/confidential change keeps working, because times are still evaluated (D-06: only time and cancellation matter).
2. Apply observations for sighted ids whatever the traversal outcome. A sighting is a positive fact, just like `scrubIneligible` (":150 A positive sighting, so it holds after a partial or failed traversal too").
3. Only if the traversal is **complete** and had **no failure**: linked ids in scope whose snapshot overlaps the window (`meeting_starts_at < end AND meeting_ends_at > start`, the same predicate as `markUnseenGone` :249-250) and that were **not** sighted get a lookup each. Cap at `osync_lookups_per_sync` (proposal 5), stay within the remaining deadline, and stop at the first non-200/404. The rest is left to the daily job. This satisfies D-07 together with the Phase 1 rule "Phase 6 must confirm every missing id with `GET /me/events/{id}`" [VERIFIED: DECISIONS-graph.md:156-160].
4. Run the applier while the existing sync lock (`m365:meetings-sync:{user}`, :57) is held, so a concurrent sync of the same user cannot apply twice. The applier still takes its own `m365:osync:{user}` lock, which is shared with the job.
5. Update the class docblock ("Read-only towards Graph and never touches time entries", :19-20). It now changes entries through the core update path only (D-12).

Lookup client (add to `GraphCalendarClient`, same stateless style):
- URL: `'https://graph.microsoft.com/v1.0/me/events/'.rawurlencode($graphId).'?$select=id,start,end,isCancelled,isAllDay,type,seriesMasterId'`. `rawurlencode` because the immutable-id charset includes `=` [VERIFIED: DECISIONS-graph.md:43-46]. The Phase 1 harness used `LOOKUP_SELECT = 'id,isCancelled,start,end,responseStatus,type,seriesMasterId'` [VERIFIED: tests/Tools/m365-spike/lib/graph.mjs:18]. Add `isAllDay`. `responseStatus` is not needed.
- Header: `Prefer: outlook.timezone="UTC", IdType="ImmutableId"` (`GraphCalendarClient::PREFER` [VERIFIED :26]). It is required for UTC times. The IdType preference "only applies to the request it is included with" [CITED: learn.microsoft.com/en-us/graph/outlook-immutable-id].
- Answers: `200` → `isCancelled === true` ? Cancelled : Present (non-UTC zone → Unknown). `404` with `error.code === 'ErrorItemNotFound'` → Removed [VERIFIED: tests/Fixtures/M365/lookups/S4.roundB.json `"status": 404, "errorCode": "ErrorItemNotFound"`]. Any other 404 code, including `MailboxNotEnabledForRESTAPI`/`MailboxNotSupportedForRESTAPI` [VERIFIED :31 `NO_MAILBOX_CODES`] → Unknown. 401/403 → one forced refresh and a retry (same as :77-89), then Reconnect → Unknown. 429, or 503/504 with Retry-After → Throttled, persist `graph_backoff_until` (same as `failureOutcome` :178-196), stop. Connection exceptions → Unknown.
- Immutable ids survive folder moves within the mailbox. They change only on archive-mailbox moves or export/re-import [CITED: learn.microsoft.com/en-us/graph/outlook-immutable-id "Lifetime of immutable IDs"]. Those rare cases would look like 404 → flag "removed" for a not-started meeting. That is a safe outcome (user chooses Keep).

### Pattern 7: Daily background job (Q5, D-11)

- **Registration without touching core `app/Console/Kernel.php`:** in `Microsoft365ServiceProvider::boot()` call `$this->callAfterResolving(Schedule::class, fn (Schedule $schedule) => $schedule->command('m365:check-out-of-sync')->dailyAt('05:30')->timezone('Europe/Madrid')->withoutOverlapping()->when(fn () => app(MicrosoftConfig::class)->isConfigured()));`, and register the command in the existing `commands([...])` call (:40-42) [VERIFIED: app/Microsoft365/Microsoft365ServiceProvider.php]. This works because `Schedule` is a container singleton built by `ConsoleKernel::resolveConsoleSchedule()` [VERIFIED: vendor/laravel/framework/src/Illuminate/Foundation/Providers/FoundationServiceProvider.php:106-110], so `afterResolving` callbacks fire. `ServiceProvider::callAfterResolving` also runs immediately if the instance already exists [VERIFIED: vendor/.../Support/ServiceProvider.php:310-317]. Core's own schedule pattern (`->when(fn (): bool => config(...))`) is in `app/Console/Kernel.php:17-49` [VERIFIED].
- **Time:** 05:30 Europe/Madrid catches overnight moves of same-day meetings before they start. D-01 judges "started" at detection, so earlier is better. Use the time zone in `config('microsoft365.default_timezone')` [VERIFIED: config/microsoft365.php:35].
- **Fan-out:** the command selects `MicrosoftAccount` rows with `calendarAccessState() === 'connected'` [VERIFIED: MicrosoftAccount.php:111-121] and `backoffRemainingSeconds() === null` (D-11, never for users without a valid connection). It dispatches `CheckOutOfSyncForUser::dispatch($userId)->delay(now()->addSeconds($i * 10))` on the existing `database` queue (`QUEUE_CONNECTION: database` on the app, scheduler and queue services [VERIFIED: compose]). One user per job, so failures are isolated and requests never run concurrently on one mailbox (single worker).
- **Job:** `ShouldQueue`, `$tries = 3`, `$timeout = 120`. It re-checks the account state and back-off (`$this->release($seconds)` while backed off). It loads active links in scope (`OutOfSyncScope`) ordered by `checked_at NULLS FIRST`, caps at 300 lookups per run, looks each up, and hands observations to the applier. It stops at the first throttle or Reconnect. It also updates cached meeting times for released links (Pattern 3).
- **Budget:** Outlook allows 10,000 requests per 10 minutes and **4 concurrent requests** per app and mailbox [CITED: learn.microsoft.com/en-us/graph/throttling-limits "Outlook service limits → Limits per mailbox"]. Sequential lookups, at most a few hundred per user per day, stay far below that.
- **Tokens:** `MicrosoftTokenService::accessToken()` refreshes under a row lock with no request context [VERIFIED: :82-124]. In console, `GraphAccessGuard::blocked()` calls `session()->has(...)` on an unstarted store [VERIFIED: vendor/stechstudio/filament-impersonate/src/ImpersonateManager.php:18-21]. It should answer false (not blocked) [ASSUMED, A1]. A Wave 0 test must prove the job is not blocked, because the guard fails closed on exceptions [VERIFIED: GraphAccessGuard.php:26-28].
- **Deploy blocker:** in `docs/deploy/dokploy-compose.fork.yml` only the `app` service has `SOLIDTIME_MICROSOFT_CLIENT_ID/SECRET/TENANT_ID/...`. The `scheduler` and `queue` services do not [VERIFIED: compose file]. `MicrosoftTokenService::refresh()` returns a `client_error` failure when `! $this->config->isConfigured()` [VERIFIED: :142-144], so every expired token in the job would fail and nothing would be checked. Add the same `SOLIDTIME_MICROSOFT_*` lines to both services. The values already exist in the Dokploy environment (interpolated `${...}`), so this needs no owner action, only the compose update and a redeploy (D-15). Also bump the three image tags.

### Pattern 8: Frontend (Q6)

- **Payload:** extend `OutlookMeetingController::index` `additional` with `out_of_sync: { items: [{time_entry_id, reason, recorded_start, recorded_end, outlook_start, outlook_end, entry_start}] }`. The items are **all** flagged active links in D-10 scope for the current organization (`time_entries.organization_id = current_team_id`), not just the visible week, capped at 200. The count is `items.length`. When impersonating, not connected or without an org: `[]`, the same branch as :61-66 [VERIFIED]. `fetchMeetings` must parse it defensively, like `linked_time_entry_ids` [VERIFIED: types.ts:257-260 comment].
- **Marker:** in `OutlookEntryBadge.vue` (rendered via `#event-extra` → `title-prefix`; core seam ledgered in Phase 4 [VERIFIED: TOUCHED-CORE-FILES.md lines 162-166]), when the entry id is in the flag map, render a second icon after `CalendarDays`: lucide `AlertTriangle`/`TriangleAlert` with amber tokens, matching core's misplaced-break hint `text-amber-600 dark:text-amber-400` [VERIFIED: FullCalendarEventContent.vue]. Make it a real `<button>` that opens a reka-ui Popover with the reason line and the actions. It must use `@pointerdown.stop` (otherwise core's `onEventPointerDown` starts a drag [VERIFIED: CalendarDayColumn.vue `@pointerdown="emit('event-pointerdown', …)"`]) and `@keydown.enter.stop` / `@click.stop` (the block's `@keydown.enter.prevent` opens the edit modal [VERIFIED: CalendarDayColumn.vue]). **No new core touch.**
- **Counter:** in `OutlookCalendarControls.vue` (inside the existing `#toolbar-extra` slot [VERIFIED: Calendar.vue:174-176]), a button "N out of sync" visible when `items.length > 0` and `canAct`. Click → jump to first.
- **Jump to first:** first = earliest `entry_start`. If it is inside the current `bucket`, scroll `[data-event-id="<id>"]` into view [VERIFIED: event id is `timeEntry.id`, useCalendarEvents.ts:225; `:data-event-id` in CalendarDayColumn.vue] and open its popover. Otherwise `router.visit('/calendar?date=YYYY-MM-DD&outlook_entry=<id>')`. A visit without `preserveState` remounts the page because Inertia sets `key.value = options.preserveState ? key.value : Date.now()` [VERIFIED: node_modules/@inertiajs/vue3/dist/index.esm.js, version 2.3.27]. `Calendar.vue:43` reads `date` at setup. The composable reads `outlook_entry` on mount and opens that marker once the entries render. The date must be the entry's **local** day (`getLocalizedDayJs(entry_start).format('YYYY-MM-DD')`), because `initialDate` is parsed as local midnight [VERIFIED: TimeEntryCalendar.vue:166-169 comment].
- **Actions:** `keep(entryId)`, `adjust(entryId)` and `moveEntry(meetingId)` in `useOutlookMeetings`. They are pessimistic (wait for the server), then invalidate `['timeEntries']` and the meetings key, and announce in the existing polite live region. Delete uses the core mutation passed down, or `useTimeEntriesMutations()` directly in the fork component; both invalidate `['timeEntries']` and `['goals']`.
- **Test hook:** extend `OutlookTestHookOptions` [VERIFIED: useOutlookMeetings.ts:178-183 `actions?`, `convertUrl?`, `seriesUrl?`, `linkedTimeEntryIds?`] with `outOfSync?: OutOfSyncItem[]` and `outOfSyncUrl?: string`. Injected meetings accept `previous_entry`. In hook mode, keep/adjust post to `${outOfSyncUrl}/{id}/keep|adjust`, answered by `page.route`. Playwright runs with the integration off, so real fork routes answer 404 [VERIFIED: e2e/outlook-convert.spec.ts:11-16 comment]. Entries are created for real through `/api/v1/.../time-entries` (same file :207-230 pattern). The `adjust` route handler does the core PUT itself.
- **Strings:** add to `lang/en/microsoft365.php` and `lang/es/microsoft365.php` under `calendar.*`. They are served automatically by `calendarLabels()` [VERIFIED: ShareMicrosoftInertiaData.php:128-139], and `MicrosoftLangTest` enforces parity. Spanish uses "registro de tiempo" [VERIFIED: lang/es/microsoft365.php:88-98]. Proposed:

| key | en | es |
|---|---|---|
| `out_of_sync_count` | `:count out of sync` | `:count sin sincronizar` |
| `out_of_sync_marker` | `Out of sync with Outlook` | `No coincide con Outlook` |
| `osync_reason_moved` | `Moved in Outlook: :old → :new` | `Movida en Outlook: :old → :new` |
| `osync_reason_cancelled` | `Meeting cancelled in Outlook` | `Reunión cancelada en Outlook` |
| `osync_reason_removed` | `Meeting removed from Outlook` | `Reunión eliminada de Outlook` |
| `osync_keep` | `Keep as is` | `Mantener así` |
| `osync_adjust` | `Adjust to Outlook` | `Ajustar a Outlook` |
| `osync_delete` | `Delete entry` | `Eliminar registro` |
| `move_entry_here` | `Move my entry here` | `Mover mi registro aquí` |
| `osync_failed` | `Could not update this entry` | `No se pudo actualizar este registro` |

### Anti-Patterns to Avoid
- **Treating "absent from a window" as removed.** S5b proves a moved-out meeting is absent too. Always confirm with a lookup [VERIFIED: DECISIONS-graph.md:152-160].
- **Detecting cancellation from the subject prefix** ("Canceled: "). Use `isCancelled` only [VERIFIED: DECISIONS-graph.md:107-108].
- **Writing `time_entries` directly** (`$entry->update([...])`). That bypasses permissions, overlap and recalculation jobs (D-04, Phase 4 D-10).
- **Using the user's current organization for the update.** Use the entry's organization.
- **Leaving `Auth::setUser` in place after a job.** The worker does not reset guards.
- **Re-snapshotting from the cache in the backfill.** That hides changes.
- **Adding a core seam** for the marker or the counter. Both fit the existing `event-extra` / `toolbar-extra` slots.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Entry update rules | Own validation/permission/overlap/recalc | Core `TimeEntryController::update` via `CoreTimeEntryUpdater` | D-04 explicit; upstream changes flow in |
| Token refresh in jobs | A second refresh path | `MicrosoftTokenService::accessToken()` | Row lock + rotation handling already proven |
| Retry-After parsing | New parser | `RetryAfter::seconds()` | Clamped, tested |
| Scheduling | Edit `app/Console/Kernel.php` or `bootstrap/app.php` | `callAfterResolving(Schedule::class)` in the fork provider | Zero core touch |
| Partial unique index | Raw `CREATE UNIQUE INDEX` string | `uniqueIndex(...)->where(...)` (tpetry) | Same as core users migration |
| Calendar navigation | Core prop/expose | `/calendar?date=` deep link + Inertia remount | Existing pattern |
| Cross-container locking | Custom mutex table | `Cache::lock` (file store shared via `app-storage` volume) | Already used by the sync (:57) |

**Key insight:** the risky part of this phase is not detecting changes. It is applying them safely across two entry points (interactive and job), with stale observations, concurrent user edits and an auth context that does not exist in jobs. One pure rules function plus one locked applier keeps that manageable.

## Common Pitfalls

### Pitfall 1: Stale observation overwrites a newer one
**What goes wrong:** the job looks up at T1 (slot A). A user sync at T2 sees slot B and auto-adjusts. Then the job applies its T1 observation, sees A != snapshot B, and adjusts back to A.
**How to avoid:** every Observation carries `observedAt`. The applier skips it if `link.checked_at > observedAt`, and sets `checked_at = observedAt` when applying.
**Warning signs:** an entry flips between two times. Write a test with two observations applied out of order.

### Pitfall 2: Cancellation signal lost to the eligibility filter
**What goes wrong:** cancelled events are ineligible, scrubbed and set gone [VERIFIED: :129-137, :151]. The rules never see "cancelled", the link looks absent, and the lookup then answers 200 with `isCancelled=true` (S3), which costs an extra request.
**How to avoid:** extract linked sightings before the filter (Pattern 6 step 1).

### Pitfall 3: The job is silently blocked or cannot refresh
**What goes wrong:** (a) the compose file lacks `SOLIDTIME_MICROSOFT_*` on queue/scheduler, so refresh returns `client_error` and every user is "unavailable". (b) `GraphAccessGuard::blocked()` throws in console, so it fails closed and nothing runs.
**How to avoid:** add the compose variables. Write a feature test running the job (`Queue::fake` off, `Http::fake` for token + Graph) and asserting Graph was called. Also write a deploy smoke check: after deploy, `php artisan m365:check-out-of-sync --dry-run` (or a log count line) in the scheduler container.

### Pitfall 4: Started vs not started judged at detection time
**What goes wrong:** a meeting moved before it started but detected only after its recorded start counts as started (D-01). It is released, not auto-adjusted.
**How to avoid:** this is the locked behaviour. Run the job early (05:30 local) so it happens rarely. Document it in the SUMMARY so UAT does not report it as a bug.

### Pitfall 5: Ghost at the old slot after a release
**What goes wrong:** a link is released from a lookup but the cached row keeps the old times. The read shows the meeting as a suggestion next to the original entry.
**How to avoid:** a release from a lookup also updates `outlook_meetings.starts_at/ends_at` for that `(user_id, graph_id)` (Pattern 3).

### Pitfall 6: Overlap or blocked org makes auto adjust fail
**What goes wrong:** core `assertNoOverlap` (opt-in per org) or a blocked organization throws.
**How to avoid:** catch, then Flag moved (D-04 says the entry follows only "when that is safe"). Adjust shows the core message in the popover.

### Pitfall 7: "This and following" edits and occurrence id churn
**What goes wrong:** splitting a series yields a new master. Community-observed: old occurrence ids vanish [CITED in 05-RESEARCH: pnp.github.io blog, MEDIUM]. Linked future occurrences answer 404, so they are flagged "removed", while the new occurrences appear as fresh (pre-assigned) suggestions.
**How to avoid:** accept it (the user sees the flag and chooses). Optional: when a removed flag's series has a new occurrence at the same `original_start` day, word it softly. Not required by any decision.

### Pitfall 8: Cancelled occurrence of a series (E1 not captured)
**What goes wrong:** unknown whether the lookup of a cancelled series occurrence answers 404 or 200 `isCancelled`. Graph documents that cancelled occurrences "no longer exist" and are listed only by `occurrenceId` on the master [CITED: learn.microsoft.com/en-us/graph/api/event-get Example 3], so 404 → "removed" is the likely answer [ASSUMED].
**How to avoid:** both answers lead to a flag with Delete / Keep, and only the wording differs. Accept it.

### Pitfall 9: Organizer-side delete may stay reachable
**What goes wrong:** if a user deletes their own meeting and Graph still serves the item from Deleted Items by immutable id (ids survive folder moves [CITED: outlook-immutable-id]), the lookup is 200 at the same times, so no change and no flag. Not captured (S4 covered an attendee decline → 404).
**How to avoid:** fail-safe (no flag). Record it as an open question for owner UAT. Do not add `parentFolderId` heuristics without evidence.

### Pitfall 10: Existing tests and docs that assert the old invariant
- `OutlookMeetingSyncTest::test_sync_does_not_change_time_entries` and `OutlookMeetingPrivacyTest` snapshot tests use **unlinked** entries [VERIFIED: OutlookMeetingSyncTest.php:345-360]. They stay valid (keep them as proof that unlinked entries are never touched).
- `OutlookMeetingPrivacyTest.php:751` route count of 8.
- `OutlookMeetingSyncService` docblock :19-20, `.claude/CLAUDE.md` data-safety line, `PROJECT.md:38,47`.
- `docs/m365/TOUCHED-CORE-FILES.md`: add a Phase 6 section stating "no core files edited" (if that holds).

### Pitfall 11: Timezones and DST
Snapshot and Graph times are UTC instants. Series occurrences already carry DST-correct UTC per occurrence [VERIFIED: DECISIONS-graph.md "Time zone and DST"]. Never derive one occurrence's time from another. A DST change does not change an occurrence's UTC start, so it never looks like a move. Display old → new in the user's time zone with the existing `getLocalizedDayJs`. The jump date must be the local day.

### Pitfall 12: Octane and static state
New services (`OutOfSyncRules`, `Applier`, `Updater`, lookup client) are plain classes without static caches. `PermissionStore` stays scoped. The updater never calls `Auth::setUser` in HTTP context. PHPStan `checkOctaneCompatibility` will flag static properties.

## Code Examples

### Pure rules (sketch)
```php
// Source: design for this phase; times as UTC 'Y-m-d H:i:s' strings, now passed in
final class OutOfSyncRules
{
    public function decide(LinkSnapshot $link, EntryTimes $entry, Observation $seen, CarbonImmutable $now): Decision
    {
        if ($seen->kind === ObservationKind::Unknown) {
            return Decision::nothing();
        }
        $started = $link->start <= $now->utc()->format('Y-m-d H:i:s');
        if ($seen->kind === ObservationKind::Present && $seen->start === $link->start && $seen->end === $link->end) {
            return $link->flagReason !== null ? Decision::clearFlag() : Decision::nothing();
        }
        if ($started) {
            return $seen->kind === ObservationKind::Present && ! $seen->allDay ? Decision::release() : Decision::nothing();
        }
        return match ($seen->kind) {
            ObservationKind::Cancelled => Decision::flag('cancelled'),
            ObservationKind::Removed => Decision::flag('removed'),
            ObservationKind::Present => match (true) {
                $seen->allDay => Decision::flag('moved', $seen->start, $seen->end),
                $entry->start === $link->start && $entry->end === $link->end => Decision::autoAdjust($seen->start, $seen->end),
                $entry->start === $seen->start && $entry->end === $seen->end => Decision::resync($seen->start, $seen->end),
                default => Decision::flag('moved', $seen->start, $seen->end),
            },
        };
    }
}
```

### Partial unique index migration (pattern)
```php
// Source: core database/migrations/2014_10_12_000000_create_users_table.php:38-39 (uniqueIndex()->where())
Schema::table('outlook_meeting_links', function (Blueprint $table): void {
    $table->dropUnique(['user_id', 'graph_id']);
    $table->uniqueIndex(['user_id', 'graph_id'], 'outlook_meeting_links_active_unique')
        ->where('released_at is null');
    $table->index(['user_id', 'meeting_starts_at']);
});
```

### Schedule from the fork provider
```php
// Source: vendor/laravel/framework/src/Illuminate/Support/ServiceProvider.php:310-317 (callAfterResolving)
$this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
    $schedule->command('m365:check-out-of-sync')
        ->dailyAt('05:30')
        ->timezone((string) config('microsoft365.default_timezone', 'Europe/Madrid'))
        ->withoutOverlapping()
        ->when(fn (): bool => app(MicrosoftConfig::class)->isConfigured());
});
```

### Acting as the link's user in a job
```php
// Source: GuardHelpers::forgetUser (vendor/.../Auth/GuardHelpers.php:97); queue reset does not reset guards
$guard = Auth::guard('web');
$guard->setUser($user);
try {
    $updater->updateTimes($user, $entry, $start, $end);
} finally {
    $guard->forgetUser();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Outlook changes never modify entries" (PROJECT constraint, CLAUDE.md) | Auto adjust only for not-started, unedited entries (D-04, D-12) | 2026-11-23 owner | Docs and the sync service docblock must change; tests on unlinked entries stay |
| One link per occurrence forever (Phase 4 D-06) | One **active** link per occurrence; released links keep history (D-03) | Phase 6 | Partial unique index; `linkOf` filters active |
| Sync never does lookups | Bounded lookups for absent linked ids; daily per-link lookups | Phase 6 | New `event()` method; budget well below Outlook limits |

**Deprecated/outdated:** `OutlookMeetingSyncService` docblock lines 19-20; `.claude/CLAUDE.md` "Data safety" bullet; `.planning/PROJECT.md:38,47`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GraphAccessGuard::blocked()` answers false in queue/console (unstarted session store) | Pattern 7 | Job silently does nothing. Wave 0 test catches it; fix by short-circuiting the guard when `app()->runningInConsole()` and no session is started |
| A2 | Core route name is `v1.time-entries.update` and can be bound in-process | Pattern 4 | Updater cannot build its request. Contract test catches it; fall back to constructing a `Route` with the same URI |
| A3 | Not-started meeting turned all-day → flag moved, no auto adjust, Adjust hidden; started → nothing (RESOLVED: CONTEXT D-18) | Pattern 1 | Owner may prefer another treatment; low frequency |
| A4 | Lookup of a cancelled series occurrence answers 404 (E1 not captured) | Pitfall 8 | Wording "removed" instead of "cancelled"; same actions |
| A5 | Organizer-deleted own meeting answers 404 (only attendee decline captured) | Pitfall 9 | No flag (fail-safe) |
| A6 | Default unique index name `outlook_meeting_links_user_id_graph_id_unique` | Pattern 2 | `dropUnique([...])` derives the same name; migration test on CI Postgres confirms |
| A7 | 05:30 Europe/Madrid, 10 s stagger, 300 lookups per user, 5 lookups per interactive sync | Pattern 6/7 | Tunable constants in `config/microsoft365.php` `graph` block (no env) |
| A8 | "First" flagged entry = earliest entry start | Pattern 8 | UX preference only |
| A9 | Keep on moved re-baselines the snapshot (further moves detected); Keep on cancelled/removed detaches (RESOLVED: CONTEXT D-16) | Pattern 5 | Owner could want "never ask again" for moved too |
| A10 | Auto clear of a flag when Outlook returns to the recorded slot or the user aligns the entry by hand (RESOLVED: CONTEXT D-17) | Pattern 1 | Owner could prefer flags to persist until acted on |

## Open Questions (RESOLVED)

1. **Should flags show while disconnected?** RESOLVED: hidden while disconnected (CONTEXT D-19); flags return on reconnect.
   - What we know: links (and flags) survive Disconnect (Phase 4 D-15). The read returns nothing when not connected.
   - Resolution: the read's empty branch serves `out_of_sync.items: []` while not connected or impersonating, and the actions answer 404 (D-14, D-19); a reconnect-state account keeps serving its flags. Planned in 06-06 (read test: disconnected -> empty, reconnect state -> listed, Disconnect then a new connect -> the same flags listed again) and 06-10 (actions 404 while disconnected).
2. **Daily job fetch shape.** RESOLVED (discretion): per-link lookups, sequential, no `$batch` (06-15).
3. **Where "Move my entry here" lives.** RESOLVED (discretion, UI-SPEC section 4): meeting panel body + context menu, next to Create (Create stays primary); planned in 06-11 and 06-13.
4. **Organizer-deleted meetings (A5) and series cancellations (A4).** RESOLVED: the rules fail safe (Unknown never acts; a 200 at the same times changes nothing; a 404 or a cancellation of a not-started meeting only flags, never deletes, D-05/D-07); real-world confirmation in the 06-19 owner UAT (human check on a real cancel, delete and decline).
5. **Assumptions A3, A9, A10 (all-day, Keep semantics, automatic clear).** RESOLVED by CONTEXT D-16 (Keep on a moved flag re-baselines the snapshot; Keep on cancelled / removed detaches), D-17 (a flag clears by itself when Outlook returns to the recorded time or the meeting reappears) and D-18 (a not-started meeting that becomes all-day is flagged, never auto-adjusted, Adjust hidden). D-19 resolves question 1 and D-20 the compose variables of Pattern 7 (queue and scheduler services, no owner action; planned in 06-15).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | Vitest, vue-tsc, eslint, prettier | ✓ | v24.13.1 / 11.8.0 | — |
| vitest, playwright binaries | JS gates | ✓ (`node_modules/.bin/`) | per package.json | — |
| PHP 8.3 portable | Pint, PHPStan, DB-free PHPUnit (rules, lookup client with Http::fake) | ✓ `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe` | 8.3.36 | — |
| System PHP on PATH / PostgreSQL / Docker | Feature PHPUnit, migration, full Playwright | ✗ (`command -v php docker psql` empty) | — | GitHub CI on push (green on HEAD for Phase 5 runs) |
| Dokploy queue + scheduler containers | Daily job in production | ✓ (compose services `queue`, `scheduler`) | image sha-0f2d424 | — (needs the `SOLIDTIME_MICROSOFT_*` lines added) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** feature PHPUnit and Playwright run in CI only. Keep `OutOfSyncRules` pure and the lookup mapping testable with `Http::fake` so most logic runs locally.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (feature: CI only; DB-free unit: local) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60 (CI) |
| Config file | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run resources/js/m365` · `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365` · `"$PHP_BIN" vendor/bin/pint --test <files>` · `"$PHP_BIN" vendor/bin/phpstan analyse` |
| Full suite command | `npm run test:unit && npm run type-check && npm run lint && npm run format:check`; CI: PHPUnit (Microsoft365 PASS lines), PHPStan, Pint, Playwright, fork image, all green on HEAD |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OSYNC-01/02 | Rules matrix: every row of Pattern 1 (started/not started × present same/moved/all-day × cancelled × removed × unknown × entry edited/unedited/hand-aligned), boundary `start == now` counts as started, scope cut at now-60d | PHP unit (local) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/OutOfSyncRulesTest.php` | ❌ Wave 0 |
| OSYNC-01 | Lookup mapping: S3 → Cancelled, S4 → Removed, S5/S5b → Present with new times, 404 `MailboxNotEnabledForRESTAPI` → Unknown, 429 → Throttled + Retry-After, 401 → refresh + retry, non-UTC → Unknown, id `rawurlencode`d, Prefer header present | PHP unit (local, `Http::fake`) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/GraphCalendarClientTest.php` | ✅ extend |
| OSYNC-01/02 | Sync: moved sighting of not-started unedited entry → entry updated via core (recalc job dispatched, `Bus::fake`), snapshot updated; edited → flagged moved; cancelled sighting → flagged cancelled (subject still scrubbed); started moved → released + meeting visible in read; partial/failed traversal → no absent-id lookups and no flags; complete window absent id → lookup → removed; subject/attendee-only change → nothing | PHP feature | CI `--filter OutlookOutOfSyncSyncTest` | ❌ Wave 0 |
| OSYNC-01 | Daily job: only connected users without back-off; per-link lookups; stops on 429 and persists back-off; not blocked by `GraphAccessGuard` in console (A1); auth reset after job (`Auth::user()` null after); stale observation skipped (Pitfall 1); release updates cached times; scope excludes links older than 60 days, released and detached | PHP feature | CI `--filter OutlookOutOfSyncJobTest` | ❌ Wave 0 |
| OSYNC-01 | Schedule registered from the provider (`m365:check-out-of-sync` daily 05:30 Europe/Madrid, without overlapping) | PHP feature | CI `--filter OutlookOutOfSyncScheduleTest` (inspect `app(Schedule::class)->events()`) | ❌ Wave 0 |
| OSYNC-01 | D-03: second conversion of a released occurrence creates a second link (partial unique index); concurrent double convert of an active occurrence still yields one entry (unique violation path); move-entry updates the old entry and reactivates its link; `previous_entry` only for own entries in current org | PHP feature | CI `--filter OutlookMeetingConversionTest` (extend), `--filter OutlookMoveEntryTest` | ✅ extend / ❌ |
| OSYNC-02 | Updater contract: core `update` signature, route name resolves, blocked organization refused, overlap → flag not adjust, entry of another org uses its own org | PHP unit + feature | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php`; CI `--filter CoreTimeEntryUpdaterTest` | ❌ Wave 0 |
| OSYNC-02 | Migration: backfill only fills null snapshots (never overwrites), partial index exists, old unique gone | PHP feature | CI `--filter OutlookMeetingLinkLifecycleTest` (extend) | ✅ extend |
| OSYNC-02/03 | Read `out_of_sync`: current org only, D-10 scope, cap, empty under impersonation/not connected; no subject in payload | PHP feature | CI `--filter OutlookMeetingEndpointTest`, `--filter OutlookMeetingPrivacyTest` (extend; route count) | ✅ extend |
| OSYNC-03 | Keep (moved re-baselines, cancelled/removed detaches), Adjust (core update, snapshot := outlook), 404 for foreign/unflagged/impersonation, throttle; delete via core cascades link and flag | PHP feature | CI `--filter OutlookOutOfSyncActionTest` | ❌ Wave 0 |
| OSYNC-02/03 | Marker renders only for flagged ids; popover reason old → new in user TZ; Adjust hidden for cancelled/removed and all-day; Keep/Adjust call endpoints and invalidate; Delete calls core mutation; pointerdown/Enter do not reach the block | Vitest | `npx vitest run resources/js/m365/calendar/OutlookEntryBadge.test.ts resources/js/m365/calendar/outOfSync.test.ts` | ✅ extend / ❌ |
| OSYNC-02 | Counter "N out of sync" visible only with items and canAct; jump inside bucket scrolls+opens, outside visits `/calendar?date=<local day>&outlook_entry=<id>` | Vitest | `npx vitest run resources/js/m365/calendar/OutlookCalendarControls.test.ts resources/js/m365/calendar/useOutlookMeetings.test.ts` | ✅ extend |
| OSYNC-01/03 | Browser: injected flags via test hook on real entries; marker + counter; jump to another week; Keep/Adjust via `page.route`; Delete via core; "Move my entry here" on injected meeting with `previous_entry` | Playwright (CI) | CI `e2e/outlook-out-of-sync.spec.ts` | ❌ Wave 0 |
| OSYNC-01..03 | Lang parity en/es for new keys | PHP unit (local) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php` | ✅ |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched m365 files>` + prettier. PHP tasks: Pint on touched files, full-app PHPStan, and the local DB-free unit tests (`OutOfSyncRulesTest`, `GraphCalendarClientTest`, contract tests).
- **Per wave merge:** push, then the CI gate (PHPUnit Microsoft365 PASS count ≥ previous + new classes, PHPStan, Pint; Playwright on the UI wave).
- **Phase gate:** all CI workflows green on the release sha before `/gsd-verify-work`; post-deploy smoke: scheduler lists the event (`php artisan schedule:list` shows `m365:check-out-of-sync`) and one manual job run logs a count line.

### Wave 0 Gaps
- [ ] `tests/Unit/Microsoft365/OutOfSyncRulesTest.php` (pure matrix, local)
- [ ] `tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php`
- [ ] `tests/Feature/Microsoft365/OutlookOutOfSyncSyncTest.php`, `OutlookOutOfSyncJobTest.php`, `OutlookOutOfSyncActionTest.php`, `OutlookOutOfSyncScheduleTest.php`, `OutlookMoveEntryTest.php`, `CoreTimeEntryUpdaterTest.php`
- [ ] Shared helper: `linkedEntry($user, $graphId, $start, $end, $entryStart = null, $entryEnd = null)` in `tests/Feature/Microsoft365/Support/`; lookup fakes reading `tests/Fixtures/M365/lookups/*.roundB.json`
- [ ] `resources/js/m365/calendar/outOfSync.test.ts`
- [ ] `e2e/outlook-out-of-sync.spec.ts`
- [ ] Update hard-coded counts: `OutlookMeetingPrivacyTest.php:751` route count; any label-count assertions

## Security Domain

`security_enforcement: true`, ASVS level 1 [VERIFIED: .planning/config.json `"security_enforcement": true`, `"security_asvs_level": 1`].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `auth:web`, `auth.session`, `verified` route stack |
| V3 Session Management | yes (inherited) | Web session + XSRF on new POST routes |
| V4 Access Control | yes | Keep/Adjust look up `{entry}` inside the session user's flagged links joined to entries owned by the user (404 otherwise). Move-entry looks up the meeting in the user's rows and the released link's entry in `{organization}`. Core update re-checks `time-entries:update:own`. Impersonation → empty flags, 404 on actions, no sync (`GraphAccessGuard`) |
| V5 Input Validation | yes | uuid route params; no body fields on keep/adjust (targets come from the stored flag, never the client); move-entry takes the slot from the meeting row, not the body |
| V6 Cryptography | no | — |
| V7 Errors/Logging | yes | Log fixed reasons and counts only (no subject, no graph id, no times, no token). Failures in the job never throw to the scheduler output with payloads |
| V8 Data Protection | yes | Sightings keep ids and times only; ineligible events still scrubbed; flags carry times only |
| V11 Business Logic | yes | Never delete automatically; auto adjust limited by the rules; stale-observation guard; per-user locks; route throttles; daily job bounded (300 lookups/user) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR: keep/adjust another user's entry by id | Tampering | Lookup via links ⨝ entries scoped to auth user; 404 |
| Client-chosen adjust target | Tampering | Adjust uses `outlook_*` stored by the server; body ignored |
| Job acting as the wrong user (auth leak between jobs) | Elevation of privilege | `setUser` + `forgetUser` in `finally`; test that `Auth::user()` is null after the job |
| Impersonating admin acting on flags | Elevation of privilege | `GraphAccessGuard::blocked()` → 404 and empty list |
| Graph flood from the job | DoS (self) | Sequential, capped, stop on 429, persisted back-off, staggered dispatch |
| Entry change without audit | Repudiation | Changes go through core update → existing auditing with the user as actor |
| XSS via reason text | Tampering | Times formatted client-side; Vue interpolation, no `v-html` |

## Sources

### Primary (HIGH confidence, read this session)
- `app/Microsoft365/Graph/GraphCalendarClient.php`, `OutlookMeetingSyncService.php`, `OutlookMeetingEligibility.php`, `MicrosoftTokenService.php`, `RetryAfter.php`, `SyncStatus.php`, `GraphAccessGuard.php`
- `app/Microsoft365/Models/OutlookMeetingLink.php`, `OutlookMeeting.php`, `MicrosoftAccount.php`; all fork migrations under `app/Microsoft365/database/migrations/`
- `app/Microsoft365/Http/Controllers/MeetingConversionController.php`, `OutlookMeetingController.php`, `MicrosoftAccountController.php`; `Http/Middleware/ShareMicrosoftInertiaData.php`; `routes/microsoft365.php`; `Microsoft365ServiceProvider.php`; `TimeEntries/CoreTimeEntryCreator.php`; `config/microsoft365.php`
- Core: `app/Http/Controllers/Api/V1/TimeEntryController.php` (store/update/destroy, assertNoOverlap), `app/Http/Controllers/Controller.php`, `app/Http/Controllers/Api/V1/Controller.php`, `app/Http/Requests/V1/TimeEntry/TimeEntryUpdateRequest.php`, `app/Service/PermissionStore.php`, `app/Service/TimeEntryService.php`, `app/Http/Middleware/CheckOrganizationBlocked.php`, `app/Console/Kernel.php`, `routes/api.php`, `database/migrations/2014_10_12_000000_create_users_table.php`
- Vendor: Laravel `QueueServiceProvider` resetScope, `GuardHelpers::forgetUser`, `ServiceProvider::callAfterResolving`, `FoundationServiceProvider::registerConsoleSchedule`; `stechstudio/filament-impersonate` `ImpersonateManager::isImpersonating`; `tpetry/laravel-postgresql-enhanced` `uniqueIndex`/`IndexDefinition::where`; `@inertiajs/vue3` 2.3.27 remount key
- Frontend: `resources/js/Pages/Calendar.vue`, `resources/js/m365/calendar/useOutlookMeetings.ts`, `OutlookEntryBadge.vue`, `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue`, `CalendarDayColumn.vue`, `FullCalendarEventContent.vue`, `useCalendarNavigation.ts`, `useEventDrag.ts`, `resources/js/utils/useTimeEntriesMutations.ts`, `resources/js/Pages/Time.vue`
- Docs and fixtures: `docs/m365/DECISIONS-graph.md`, `docs/m365/TOUCHED-CORE-FILES.md`, `docs/deploy/dokploy-compose.fork.yml`, `docker/prod/deployment/supervisord.scheduler.conf`, `tests/Fixtures/M365/lookups/S3|S4|S5|S5b.roundB.json`, `tests/Tools/m365-spike/lib/graph.mjs`
- Tests: `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php`, `tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php`, `OutlookMeetingSyncTest.php`, `e2e/outlook-convert.spec.ts`
- learn.microsoft.com/en-us/graph/throttling-limits (Outlook limits per mailbox; JSON batching)
- learn.microsoft.com/en-us/graph/api/event-get (permissions, Prefer timezone, cancelledOccurrences "no longer exist")
- learn.microsoft.com/en-us/graph/outlook-immutable-id (header per request; lifetime of immutable ids)

### Secondary (MEDIUM confidence)
- 05-RESEARCH.md citation of pnp.github.io blog (2026-09-17) on "this and following" creating a new master

### Tertiary (LOW confidence)
- Behaviour of lookups for cancelled series occurrences and organizer-deleted meetings (not captured; A4, A5)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages; every reused piece read this session)
- Data model and read rule: HIGH (derived from actual constraints and queries)
- Graph classification: HIGH for S3/S4/S5/S5b fixture cases, LOW for E1 and organizer deletes
- Core update in job context: MEDIUM (verified pieces; the assembled request needs the Wave 0 contract and feature tests)
- Pitfalls: HIGH (each tied to a verified code fact)

**Research date:** 2026-11-23
**Valid until:** 2026-12-23 (stable codebase; re-check if upstream changes `TimeEntryController::update` or the core update route)
