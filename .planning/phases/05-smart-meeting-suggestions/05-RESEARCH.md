# Phase 5: Smart Meeting Suggestions - Research

**Researched:** 2026-11-17
**Domain:** Learned project assignment for Outlook meetings (series history + explainable scoring) on the Phase 4 conversion path (Laravel 13 / PostgreSQL / Vue 3)
**Confidence:** HIGH for code contracts and data model, MEDIUM for Graph series behaviour on "this and following" edits (community-observed, not fixture-backed), LOW (tunable) for scoring weights and thresholds

## Summary

Phase 4 left exactly the hooks Phase 5 needs, with two gaps. The conversion path (`MeetingConversionController`, per-meeting transaction, `outlook_meeting_links`) is reusable as is. The meeting cache already stores `series_master_id`. But **the link table does not record the series**, and **links survive Disconnect while meeting rows do not** (`MicrosoftAccountController` deletes `outlook_meetings` in the disconnect transaction). So any history that must outlive a disconnect (series pre-assignment and learned signals) has to be captured **onto the link at conversion time**. Deriving it later by joining links to `outlook_meetings` breaks after the first disconnect or scrub.

Recommended design: **derive, don't duplicate**. A series' pre-assignment is the project/task/tags/billable of the time entry behind the **most recent link of that series** (`outlook_meeting_links.series_master_id`, new column). It is read live from core `time_entries`, so latest-wins (D-05) and later corrections of that entry come for free, and nothing about time entries is copied. Only two kinds of extra state are needed: (1) one small `outlook_series_settings` table for **ignore** (`ignored_at`) and **forget** (`forgotten_at`, which hides links older than the forget), and (2) a `signals` jsonb column on each link with **HMAC-hashed** organizer, attendee, domain and subject-token features captured at conversion. Hashing keeps Phase 4's "the link never holds the subject" invariant and D-09's "purged on disconnect" promise: no readable address or subject word outlives the meeting cache. Matching still works, because scoring only needs equality. The readable value for the reason text ("@client.com") comes from the current meeting's cache.

Learned suggestions use a small, explainable scorer in PHP: weighted feature matches × IDF (capped) × recency half-life, summed per project, with an absolute + margin confidence rule. It runs **inside the existing meetings read** (one history load per read, scoring all visible meetings in memory), so the mini form opens already filled with no extra request or flicker. Pre-assigned meetings are confirmed through the **Phase 4 convert endpoint** with a new `use_series_assignment: true` mode: the server resolves each meeting's assignment at confirm time, so bulk confirm of meetings from different series is one request with the existing per-meeting results UI.

**Primary recommendation:** Add `attendees` + `organizer_address` to the meeting cache. Add `series_master_id` + hashed `signals` to links at conversion. Add one `outlook_series_settings` table. Return `is_recurring`, `series_ignored`, `assignment` and `suggestions` per meeting from `GET /m365/meetings`. Confirm through `POST .../meetings/time-entries` with `use_series_assignment`. Do all of this in fork-owned files, with no new core touch.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

### Direction (owner, 2026-11-17)
- **D-01:** Owner asked that recurring meetings open the mini form "already filled", and for an engine that suggests client → project from names, emails and so on. Offered three layers (series history, learned engine, AI button); owner had no strong preference and delegated. Chosen: series history + learned engine now; AI button deferred (PROD-05) until the engine's hit rate is known. Reason: most meeting time is recurring or with known people; history is instant, free, private and needs no setup.

### Series pre-assignment (RULE-01, RULE-02)
- **D-02:** No manual "assign this series" rule is required. Once the user converts any occurrence of a series (same `seriesMasterId`, Phase 1 series key), every other unassigned occurrence of that series in view (past and future) shows pre-assigned with the most recent conversion's project, task, tags and billable.
- **D-03:** Pre-assigned meetings are never converted automatically. The lane shows them distinctly (e.g. the project colour/name on the block and a "Confirm" affordance); confirming one is one click (no form) and goes through the Phase 4 convert endpoint; "Edit" opens the mini form prefilled with the pre-assignment.
- **D-04:** Bulk confirm: one action confirms all pre-assigned meetings visible in the current day/week, reusing the Phase 4 per-meeting results UI (created / existing / failed + retry).
- **D-05:** If the user converts an occurrence to a different project than the series' pre-assignment, the series follows the newest choice from then on (latest wins). Existing entries are never changed.

### Learned suggestions (RULE-03)
- **D-06:** For meetings without series history, the server ranks projects from the user's own links only (never other users' data), using signals: organizer, attendee email addresses and domains (external domains weigh more than the user's own tenant domains), and subject words. Simple, explainable scoring (counts/weights with recency), no ML library, no external service.
- **D-07:** The mini form opens prefilled with the top suggestion when it is confident enough; otherwise it keeps the Phase 4 behaviour (last-used project). Up to two alternatives are shown as quick picks. The form says briefly why ("Same series", "Like 4 meetings with @client.com", "Last used").
- **D-08:** Suggestions do not pre-assign meetings in the lane (only series history does, D-02); they prefill the form and the multi-assign form. Bulk "confirm" applies only to series pre-assignments.
- **D-09:** Attendee emails/names become part of the cached meeting data (Graph `$select` adds `attendees`, still within `Calendars.Read`). Stored only for the meeting owner, never shown to other users, purged with the meeting cache on disconnect (Phase 3 D-21) and with the user. Signals learned from links keep only what scoring needs (e.g. domains/addresses and normalised subject tokens), no meeting bodies.

### Ignore and control (RULE-04, RULE-05)
- **D-10:** "Always ignore this series" from the meeting menu/panel hides all its occurrences; undo is available from the "Show dismissed" view (consistent with Phase 3 dismiss).
- **D-11:** User can see why a meeting is pre-assigned/suggested, change a series' assignment (by converting/editing with another project, D-05) and "Forget this series" (removes the pre-assignment until the next conversion). No separate rules manager page in this phase unless research shows it is cheap; orphaned series need no UI.
- **D-12:** Nothing in this phase modifies or deletes existing time entries.

### Carried forward
- **D-13:** Fork isolation, ledgered core touches, fork endpoints outside `/api/v1` OpenAPI (Phase 3 D-17, Phase 4 D-12). English + Spanish lang keys.
- **D-14:** Privacy and impersonation rules unchanged (Phase 3 D-15/D-16/D-22): impersonation returns no suggestions and cannot confirm.
- **D-15:** Release ends with an owner-free deploy: the system is not in production yet, so the orchestrator deploys as soon as CI is green unless the owner must act first (owner, 2026-11-17).

### Claude's Discretion
- Storage shape for series assignments and learned signals (derive from `outlook_meeting_links` + stored meeting fields vs separate tables), confidence threshold, weights, tokenisation (Spanish + English stop words), how the reason text is built.
- Exact lane visuals for pre-assigned meetings, confirm/edit affordances, bulk-confirm placement (selection bar or toolbar), wording.
- Whether "Forget this series" lives in the menu, the panel or both.

### Deferred Ideas (OUT OF SCOPE)
- PROD-05: "Propose my day/week" AI agent button (Claude API) reviewing unassigned meetings against clients/projects, results shown in the multi-assign review. Revisit once the history engine's hit rate is known.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RULE-01 | An occurrence of a recurring series in which the user already converted another occurrence shows pre-assigned with that series' last project, task, tags and billable, with no rule setup; the mini form opens prefilled with it | Pattern 2 (series history derived from links + live time entry), Pattern 1 (capture `series_master_id` on link), migration backfill, Pattern 6 (form prefill order), Pitfalls 3, 4, 5, 9 |
| RULE-02 | A pre-assigned meeting becomes a time entry only when the user confirms it: one click per meeting, or several at once | Pattern 4 (`use_series_assignment` convert mode, server resolves per meeting), Pattern 7 (bulk confirm over rendered blocks, chunks of 50), Pitfalls 6, 7 |
| RULE-03 | Suggest a project (and its client) from the user's own past conversions using organizer, attendee emails/domains and subject words; prefill best, offer next alternatives; suggestions never leave the server | Pattern 1 (attendees in cache), Pattern 3 (hashed signals), Pattern 5 (scorer: weights, IDF, decay, confidence, reasons), tokenizer with ES+EN stop words, Pitfalls 1, 2, 8, 10 |
| RULE-04 | "Always ignore this series" stops its occurrences appearing, with undo | Pattern 8 (`outlook_series_settings.ignored_at`, read filter, show-dismissed variant with `series_ignored`), new routes |
| RULE-05 | See why a meeting is pre-assigned/suggested, change a series' assignment, make the system forget it; never changes existing entries | Reason payload `{kind, count, value}` + lang keys, latest-wins by conversion (D-05), `forgotten_at`, data-safety snapshot tests (D-12) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`.
- Every PHP file uses `declare(strict_types=1);`. Pint uses the `laravel` preset plus `strict_comparison`, `strict_param`, `void_return` and `no_unused_imports`. PHPStan level 7 runs with `checkOctaneCompatibility` and `noEnvCallsOutsideOfConfig`: no `env()` outside `config/`, no static or singleton per-request state (Octane).
- Domain errors extend `App\Exceptions\Api\ApiException` with a `KEY`. Validation goes in Form Requests. Controllers return Resources, never raw models.
- Vue: `<script setup lang="ts">`, `defineProps<{...}>()`, no Options API, server state in TanStack Vue Query, Tailwind theme tokens only, no `console.log`. Prettier: 4 spaces, single quotes, width 100.
- Tests: Vitest co-located `*.test.ts`. PHPUnit in `tests/Feature/Microsoft365/` and `tests/Unit/Microsoft365/` with `test_` snake_case names. Playwright kebab-case in `e2e/`.
- Graph scopes stay minimal (`openid profile email offline_access User.Read Calendars.Read`). `attendees` is readable under `Calendars.Read` (verified by the Phase 1 experiment pass, below).
- Mergeability: fork code isolated; every core touch goes in `docs/m365/TOUCHED-CORE-FILES.md`.
- Data safety: Outlook changes never modify or delete existing time entries (and D-12: nothing in this phase does).
- Web routes use the `web` guard; fork routes stay out of `api/` and `openapi.json`.
- GSD workflow: edits only through GSD commands.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch attendees + organizer address | API / Backend (`GraphCalendarClient::SELECT`, `OutlookMeetingSyncService::buildRow`) | Database (`outlook_meetings` new columns) | Graph is read server-side only; attendee data never reaches the browser (D-09) |
| Capture series key + hashed signals at conversion | API / Backend (`MeetingConversionController::convertOne`) | Database (`outlook_meeting_links` new columns) | Only moment the meeting row is guaranteed present and locked; links survive disconnect, rows don't |
| Series pre-assignment (latest wins, forget) | Database (DISTINCT ON over links ⨝ time_entries) + Backend resolver | Browser (lane visual) | Live derivation from core entries is the source of truth; no copied state to drift |
| Project bookability filter | API / Backend (mirror of core `TimeEntryStoreRequest` project rule) | — | Same rule as core creation; the browser project list is not authoritative |
| Learned scoring + reasons | API / Backend (pure PHP scorer) | — | "Never leaves the server" (RULE-03); user's own links only; no external service |
| Confirm one / bulk confirm | API (convert endpoint, `use_series_assignment`) | Browser (collect rendered pre-assigned blocks, results UI) | Server resolves the assignment at confirm time; core create rules apply per meeting |
| Ignore / unignore / forget series | API (new fork routes, user-scoped) + Database (`outlook_series_settings`) | Browser (menu/panel items, show-dismissed variant) | Same ownership/404 rules as Phase 3 dismiss |
| Form prefill order, quick picks, reason line | Browser (`OutlookConvertForm.vue`) | API (data in the read) | Pure UI state over server-provided hints |
| Impersonation block | Backend (`GraphAccessGuard`) | — | Same guard as Phase 3/4 (D-14) |

## Standard Stack

No new packages. Everything is built from what the repo already uses.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Laravel framework | ^13.0 (in repo) | Migrations (jsonb), Eloquent, Form Requests, `Str::ascii`/`Str::lower`, `hash_hmac` via PHP | Existing stack [VERIFIED: composer.json via CLAUDE.md; `vendor/laravel/framework/src/Illuminate/Support/Str.php:142` `public static function ascii($value, $language = 'en')`] |
| PostgreSQL | 15 (CI 15/16/17) | `jsonb`, `DISTINCT ON`, partial filters | Existing DB; `DISTINCT ON` is the idiomatic "latest row per group" query [ASSUMED: standard Postgres feature, not re-checked this session] |
| Vue 3 + TanStack Vue Query | in repo | Read data, invalidation after convert/ignore/forget | Phase 3/4 pattern (`MEETINGS_QUERY_KEY`) |

### Supporting (existing in-repo pieces to reuse)
| Piece | Purpose | When to Use |
|-------|---------|-------------|
| `MeetingConversionController` + `CoreTimeEntryCreator` | Create entries through core | Confirm path (`use_series_assignment`) and Edit path |
| `OutlookConvertForm.vue` (single + batch) | Mini form | Prefill order, reason line, quick picks |
| `OutlookSelectionBar.vue` / `OutlookAssignResults.vue` | Batch results UI | Bulk confirm results (D-04) |
| `OutlookCalendarControls.vue` (toolbar-extra slot) | Toolbar | "Confirm N pre-assigned" button, no core touch |
| `OutlookMeetingContextItems.vue`, `OutlookGhostDetail.vue`, `OutlookMeetingHoverCard.vue` | Menu, panel, hover card | Confirm / Edit / Ignore series / Forget series |
| `MicrosoftConfig::allowedDomains()` | Tenant (internal) domains | Internal vs external domain weighting |
| `PermissionStore::userHas()` + `Project::scopeVisibleByEmployee` | Core project visibility | Bookable-project filter |
| `InteractsWithGraphFixtures::graphPages($round, 'experiment-select')` | Fixture pages that include `attendees` | Sync tests for the new columns |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Derive series assignment from latest link + live time entry | `outlook_series_assignments` table with copied project/task/tags/billable | Copy drifts when the user edits the entry, needs its own latest-wins writes, and duplicates core data. Derivation needs only `series_master_id` on the link plus `forgotten_at` |
| Hashed signals jsonb on the link | Clear-text signals table | Clear text breaks Phase 4 D-13 "link never holds the subject" and keeps addresses after disconnect (against D-09). Hashes keep equality matching |
| Suggestions inside `GET /m365/meetings` | Separate `GET .../meetings/suggestions` called when the form opens | Separate endpoint = extra route, prefetch logic, prefill arriving late (form flicker), more test-hook plumbing. In-read cost is one history query per read (bounded, see Pattern 5) |
| Server-resolved confirm (`use_series_assignment`) | Client groups pre-assigned meetings by assignment and sends one convert per group | Grouping keeps the endpoint unchanged but needs N requests (throttle 30/min), merged results and still a race on staleness. Server resolution is one request with the existing results contract |
| Hand-written ES+EN stop-word list | A stop-word package | ~200 words; a dependency adds supply-chain surface for a constant array |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed in this phase. Nothing to audit.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Graph calendarView ($select + attendees)
        │
        ▼
 OutlookMeetingSyncService.buildRow ──► outlook_meetings (+ organizer_address, attendees jsonb, attendee_count)
        │                                   │   (purged on Disconnect; scrubbed when ineligible)
        │                                   │
 User converts (form / batch) ──► MeetingConversionController.convertOne (row locked)
        │                                   │
        │                     core TimeEntryController::store (via CoreTimeEntryCreator)
        │                                   │
        │                                   ▼
        │                   outlook_meeting_links (+ series_master_id, signals jsonb = HMAC features)
        │                                   │   (survives Disconnect; cascades with the time entry)
        ▼                                   │
 GET /m365/meetings ──────────────────────► SeriesAssignmentResolver ── latest link per series in current org
   (session user, current org)              │      ⨝ time_entries (project, task, tags, billable)
        │                                   │      − forgotten (link.created_at <= forgotten_at)
        │                                   │      − not bookable (archived / not visible / done task / gone tags)
        │                                   ▼
        │                         ProjectSuggestionEngine (meetings without assignment)
        │                                   │  history = user's links in org (≤ 2000, ≤ 365 d), bookable projects
        │                                   │  score = Σ weight × idf × decay → top 3 + confidence + reason
        ▼                                   ▼
 Resource per meeting: { …, is_recurring, series_ignored, assignment|null, suggestions[] }
        │
        ▼
 Browser: lane (pre-assigned look, Confirm/Edit), form prefill (assignment > confident suggestion > last used),
          toolbar "Confirm N" ──► POST convert { meeting_ids, use_series_assignment: true }
          menu/panel "Ignore series" / "Forget series" ──► POST|DELETE /m365/meetings/{meeting}/series/…
```

### Recommended Project Structure
```
app/Microsoft365/
├── Suggestions/                       # new, pure + query services (no state, Octane safe)
│   ├── SubjectTokenizer.php           # normalise + ES/EN stop words (pure)
│   ├── MeetingSignals.php             # features of a meeting: clear view + HMAC view (pure)
│   ├── BookableProjects.php           # mirror of core project rule + archived/done/tag checks
│   ├── SeriesAssignmentResolver.php   # latest link per series → Assignment|null
│   ├── ProjectSuggestionEngine.php    # scorer over plain arrays (unit-testable without DB)
│   ├── SuggestionHistory.php          # loads the user's link history rows for the engine
│   └── Assignment.php / Suggestion.php / Reason.php   # small readonly value objects
├── Models/OutlookSeriesSetting.php    # user_id, series_master_id, ignored_at, forgotten_at
├── Http/Controllers/OutlookSeriesController.php   # ignore / unignore / forget
└── database/migrations/2026_11_18_00000{1,2,3}_*.php
resources/js/m365/calendar/
├── suggestions.ts (+ .test.ts)        # prefill resolution, reason text, quick picks (pure)
└── existing files extended (types.ts, useOutlookMeetings.ts, OutlookConvertForm.vue, OutlookGhostLayer.vue,
    OutlookGhostDetail.vue, OutlookMeetingContextItems.vue, OutlookMeetingHoverCard.vue, OutlookCalendarControls.vue)
```

### Pattern 1: Attendees in the cache (D-09)

**What exists:** the production `$select` [VERIFIED: app/Microsoft365/Graph/GraphCalendarClient.php:24]:
`public const string SELECT = 'id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting';`

The cache stores the organizer **name only**, by explicit Phase 3 design [VERIFIED: app/Microsoft365/database/migrations/2026_11_05_000001_create_outlook_meetings_tables.php:34-35 `// Display name only, never the address` / `$table->string('organizer_name', 255)->nullable();`]. D-09 deliberately reverses this for scoring. Update that comment and the DECISIONS-graph text in the same plan.

**Change:**
- Append `attendees` to `SELECT` (keep the order of the existing fields; the string is one literal). Phase 1 proved `attendees` comes back under `Calendars.Read` in this tenant [VERIFIED: tests/Fixtures/M365/manifest.json `"select_experiment":{"status":200,...,"attendees_returned":true}`; docs/m365/DECISIONS-graph.md:328-329 "a pass that added `lastModifiedDateTime` and `attendees` to the `$select` returned 200 and returned both properties"]. Do **not** add `lastModifiedDateTime` (DECISIONS-graph.md:343-345 forbids depending on it).
- Payload shape [VERIFIED: tests/Fixtures/M365/calendarview/roundA.experiment-select.page-2.json]: `"attendees": [ { "type": "required", "status": { "response": "none", "time": "0001-01-01T00:00:00Z" }, "emailAddress": { "name": "Test User B", "address": "person-b@example.test" } }, … ]` and `"organizer": { "emailAddress": { "name": "Test User B", "address": "person-b@example.test" } }`. Attendee `type` is `required`, `optional` or `resource` [CITED: learn.microsoft.com/en-us/graph/api/resources/attendee]. An event holds at most 500 attendees [CITED: learn.microsoft.com/en-us/graph/api/resources/event].
- New migration on `outlook_meetings`: `organizer_address` string(320) nullable, `attendees` jsonb nullable, `attendee_count` integer nullable. Store at most **50** attendees as `[{address (lowercased), name (≤255), type}]` with `status` dropped. Keep the real count in `attendee_count` (for the broadcast guard, Pattern 5). Skip `type = resource` (rooms and equipment): they say nothing about the client [ASSUMED].
- `buildRow` fills the three fields. The `store()` upsert update list must add `organizer_address`, `attendees`, `attendee_count` [VERIFIED: OutlookMeetingSyncService.php:368-382 explicit update list]. `scrubIneligible` must null them too, beside `'subject' => null, 'organizer_name' => null, 'web_link' => null` [VERIFIED: OutlookMeetingSyncService.php:222].
- `OutlookMeetingResource` stays an allow-list and **must not** expose `attendees` or `organizer_address` [VERIFIED: app/Microsoft365/Http/Resources/OutlookMeetingResource.php:29-37, fields `id … dismissed`].
- Disconnect already deletes the rows [VERIFIED: app/Microsoft365/Http/Controllers/MicrosoftAccountController.php:39-40 `OutlookMeeting::query()->where('user_id', '=', $user->getKey())->delete();` / `OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->delete();`], so attendee data goes with them (D-09). The FK `cascadeOnDelete` on `user_id` covers user deletion.
- Size: a typical 2–10 attendee meeting adds about 0.3–2 KB per event to the Graph page. Pages are `$top=100` and capped at `max_pages` 10, so worst case is all-hands meetings with hundreds of attendees. Accepted; the 50-row storage cap bounds the DB. [ASSUMED: size estimate from the fixture shape]
- `hideAttendees = true` events list only the user [CITED: learn.microsoft.com/en-us/graph/api/resources/event "each attendee only sees themselves"]. They simply contribute no attendee features. No special case is needed.

### Pattern 2: Series pre-assignment derived from links (RULE-01, D-02, D-05)

**Series identity in practice:**
- Occurrences **and exceptions** carry the same `seriesMasterId`; single meetings carry `null` [VERIFIED: docs/m365/DECISIONS-graph.md:69-75, 85-86 "Phase 5 keys series rules on it, stores nothing else about the series, and treats `type in {occurrence, exception}` as 'belongs to a series'"].
- An edited occurrence keeps its id and becomes `type=exception` (DECISIONS-graph.md:31-34).
- A **"this and following" edit creates a new series master with a new id and a new iCalUId**, and nothing links the old and new masters [CITED: pnp.github.io/blog/post/one-outlook-edit-became-two-microsoft-graph-events/, published 2026-09-17, observed behaviour; E2 was not captured in Phase 1, DECISIONS-graph.md:23-25, 87-89].
- Consequence: after a split, the new series starts **without history**. That is exactly the orphan rule DECISIONS-graph.md:87-89 asks for: "keep it visible to the user, do not delete it and do not auto-apply it to another series". With derivation there is no rule object to orphan. The old series' links simply stop matching anything in view. The learned engine (Pattern 5) still ranks the old project first via the same organizer/attendees/subject, so the form opens prefilled. The first conversion of the new series makes it pre-assigned. D-11 "orphaned series need no UI" is satisfied for free.
- `seriesMasterId = null` (single meetings): never pre-assigned, never "ignore series" (menu item hidden, server answers 404). The learned engine only.

**Data:** new migration on `outlook_meeting_links`: `series_master_id` string(255) nullable plus index `(user_id, series_master_id, created_at)`, and `signals` jsonb nullable (Pattern 3). Backfill existing Phase 4 links in the migration:
```sql
UPDATE outlook_meeting_links l SET series_master_id = m.series_master_id
FROM outlook_meetings m
WHERE m.user_id = l.user_id AND m.graph_id = l.graph_id AND l.series_master_id IS NULL;
```
Links whose meeting row was purged stay null and are harmless. Signals are **not** backfilled (no attendee data existed before this phase). The system is not in production use yet (D-15), so this costs nothing.

**Resolver query** (one per read, only for the series in view):
```sql
SELECT DISTINCT ON (l.series_master_id)
       l.series_master_id, te.project_id, te.task_id, te.tags, te.billable
FROM outlook_meeting_links l
JOIN time_entries te ON te.id = l.time_entry_id AND te.user_id = l.user_id   -- entry still the user's (Phase 4 rule)
LEFT JOIN outlook_series_settings s ON s.user_id = l.user_id AND s.series_master_id = l.series_master_id
WHERE l.user_id = :user AND te.organization_id = :org
  AND l.series_master_id IN (:visibleSeries)
  AND (s.forgotten_at IS NULL OR l.created_at > s.forgotten_at)
ORDER BY l.series_master_id, l.created_at DESC, l.meeting_starts_at DESC, l.id DESC
```
Then apply `BookableProjects`. The latest link's project must be non-archived and bookable for this user. Its task is dropped if done. Tags no longer in the org are dropped. **No fallback to an older link** when the latest is unusable: an older choice is stale by definition, and the meeting falls through to learned suggestions.

- "Latest" = most recent **conversion** (`created_at`), not the latest meeting date. Converting an old backlog occurrence with another project wins, which is what D-05 says ("newest choice").
- Reading project/task/tags/billable **live from the entry** means a later correction of that entry in core (project changed in the time list) moves the series too. The meetings read already refetches after any `timeEntries` refetch (Phase 4 04-06), so the lane updates without a reload. Treat this as intended and say so in the reason ("Same series").
- Organization: compute for the user's `current_team_id`, the same source as `urls.convert` [VERIFIED: app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php:89-91 `'convert' => $user->current_team_id === null ? null : route('microsoft.meetings.convert', ['organization' => $user->current_team_id]),`]. The read and the confirm then always agree. No current team or no membership means `assignment: null` and `suggestions: []`.

### Pattern 3: Hashed signals captured at conversion (D-09)

At `convertOne`, after the link insert (same transaction, meeting row locked), compute `MeetingSignals::hashed($meeting, $ownAddresses, $internalDomains)` and store it on the link:
```json
{ "v": 1, "o": "9f2c…", "a": ["1b7e…", "…"], "d": ["c41a…"], "i": ["77d0…"], "t": ["e3a1…", "…"], "n": 7 }
```
- `o` = organizer address, only when the user is **not** the organizer (`is_organizer=false`). Otherwise it is the user himself and carries no information.
- `a` = **external** attendee addresses; `i` = **internal** colleague addresses (domain in `allowedDomains()`). Both exclude the organizer, the user's own addresses (`users.email`, `microsoft_accounts.microsoft_email`, lowercased) and `type=resource`.
- `d` = external domains (deduped). Internal domains are not features at all: they occur in every meeting, so their IDF is about 0 anyway.
- `t` = subject tokens (Pattern 5 tokenizer), max 12.
- `n` = attendee count (broadcast guard).
- Hash: `substr(hash_hmac('sha256', $kind.'|'.$value, (string) config('app.key')), 0, 16)` (64 bits, lower-hex). Prefixing with the kind keeps a token from colliding with a domain. Pure static function, no state, so it is Octane safe.
- Why hashed: the Phase 4 link invariant [VERIFIED: app/Microsoft365/Models/OutlookMeetingLink.php:18 "Deliberately not audited and not in Filament: it holds ids and times only, never the subject (D-13)."] and D-09 (attendee data purged on disconnect, while links survive disconnect [VERIFIED: links migration lines 28-31 "Deliberately no foreign key to the meetings table: Disconnect purges those rows … the link must survive both"]). Equality matching is all scoring needs. The readable value for the reason text is taken from the **current** meeting (still cached) at scoring time.
- APP_KEY rotation silently resets learning (hashes stop matching). Acceptable; document it in the runbook. Version `v` allows a future re-hash.
- Domain internal list = `MicrosoftConfig::allowedDomains()` [VERIFIED: config/microsoft365.php:32 `'allowed_domains' => env('SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS', 'untanglegrowth.com,untangle.es'),`] plus the user's own email domain.

### Pattern 4: Confirm through the Phase 4 convert endpoint (RULE-02, D-03, D-04)

The existing request requires a project for every call [VERIFIED: app/Microsoft365/Http/Requests/MeetingConversionRequest.php:41-48 `'meeting_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEETINGS]`, `'project_id' => ['required', 'string', 'uuid']`, `'billable' => ['required', 'boolean']`]. Extend it:
- `use_series_assignment` `['sometimes', 'boolean']`. When true, `project_id`, `task_id`, `tags`, `billable`, `description`, `start` and `end` are **prohibited** (`Rule::prohibitedIf`), and `project_id`/`billable` stop being required (`Rule::requiredIf(! useSeries)`).
- `convertOne` takes the fields either from the request (unchanged) or from `SeriesAssignmentResolver::forMeeting($meeting, $organization, $user)` **inside the per-meeting transaction**, after the row lock and the existing-link check. No usable assignment means `failed` with key `no_assignment` and a translated message ("This meeting has no series assignment any more."). Description = subject, times = the meeting's own (multi-mode behaviour).
- Everything else is untouched: core create rules (overlap, permissions, billable lock, Recalculate jobs), idempotent `existing`, conflict recovery, impersonation 404 [VERIFIED: MeetingConversionController.php:49-51, 64-82].
- Single confirm = batch of one with `use_series_assignment`. "Edit" = the normal single form with explicit fields (and so it may change the series: latest wins).
- Ignored series: a confirm or convert of an occurrence of an ignored series is allowed (the user acted on it from the show-dismissed view) and does **not** un-ignore the series. Only the explicit "Stop ignoring" does that. [Discretion, recommended]

### Pattern 5: Explainable scoring (RULE-03, D-06, D-07)

**History load** (once per read, when at least one visible meeting has no assignment):
```sql
SELECT l.signals, l.created_at, l.series_master_id, te.project_id
FROM outlook_meeting_links l JOIN time_entries te ON te.id = l.time_entry_id AND te.user_id = l.user_id
WHERE l.user_id = :user AND te.organization_id = :org AND te.project_id IS NOT NULL
  AND l.signals IS NOT NULL AND l.created_at >= now() - interval '365 days'
ORDER BY l.created_at DESC LIMIT 2000
```
Then keep only projects that pass `BookableProjects` (one `whereIn` query). At "hundreds to thousands" of links this is one indexed query plus about 2000 small jsonb decodes, well under 50 ms in PHP [ASSUMED: estimate, not benchmarked; add a query-count assertion, not a timing test].

**Engine** (pure: takes arrays, returns value objects, so it can be unit-tested locally without Postgres):

| Feature (target meeting ∩ link) | Weight (start) |
|---|---|
| organizer address `o` (external organizer) | 4.0 |
| organizer address `o` (internal colleague) | 2.0 |
| external attendee address `a` | 3.0 |
| internal colleague address `i` | 1.0 |
| external domain `d` | 2.0 |
| subject token `t` | 1.0 |

- `idf(f) = min(3, ln(1 + N / df(f)))`, where N = history size and df = links containing f. Ubiquitous features (the boss in every meeting, "weekly") fade; one rare token cannot dominate beyond 3×.
- `decay(link) = 0.5 ^ (ageDays / 90)` (90-day half-life).
- `score(project) = Σ_links_of_project decay × Σ_shared_f weight × idf`.
- Broadcast guard: if the target's or the link's attendee count is above 25, ignore `a`, `i` and `d` for that pair (all-hands meetings) [ASSUMED threshold].
- Series hygiene: for a meeting whose series was **forgotten**, exclude that series' links created before `forgotten_at` from scoring. Otherwise "forget" would be undone at once by the same history.
- **Confident** when `top ≥ 3.0` AND `top ≥ 1.5 × second` AND (`supporting links ≥ 2` OR the top's strongest contribution comes from `o`, `a` or `d`). One rare subject word alone never prefills. [ASSUMED starting values; tune after owner UAT]
- Output per meeting: up to 3 `{project_id, confident (only first may be true), reason}`. Not confident means the client keeps last-used prefill and shows the top 2 as quick picks.
- **Reason** = the single strongest feature kind of the top project, with `count` = links of that project sharing it, and a readable `value` taken from the **target meeting's cache**:
  - `domain`: value `@client.com`, label "Like :count meetings with :value"
  - `organizer` / `person`: value = the attendee's display name (fallback: address), label "Like :count meetings with :value"
  - `subject`: value = the matching words joined (max 3), label "Like :count meetings about “:value”"
  - Client-only kinds: `series` ("Same series") and `last_used` ("Last used").

  Labels live in `microsoft365.calendar.*` en/es and are filled client-side with `fillLabel` (existing pattern). No score is sent.

**Tokenizer** (`SubjectTokenizer`, pure):
1. `Str::lower`, `Str::ascii` (reunión → reunion).
2. Replace `[^a-z0-9]+` with a space and split.
3. Drop tokens shorter than 3 characters, digits-only tokens and stop words.
4. Dedupe, keep the first 12.

Stop words = ES + EN function words plus meeting noise.
- EN function words: the, and, for, with, from, this, that, about, into, over, our, your, are, was, will, can…
- ES function words: los, las, del, para, con, por, una, uno, que, sobre, este, esta, nuestro, entre, tras, sin, mas…
- Meeting noise: meeting, meet, call, sync, catch, weekly, daily, monthly, review, update, follow, reunion, llamada, semanal, diaria, mensual, seguimiento, revision, punto, teams, zoom, online, invite, invitacion, accepted, aceptado, canceled, cancelado, plus the prefixes re, fw, fwd, rv.
- Calendar words: month and weekday names (EN/ES, ascii-folded).

Keep it a `private const array` of about 200 entries [ASSUMED: list content is a judgement call; test that "Reunión semanal ACME – Q3" gives `["acme","q3"]`]. "q3" passes because it is not digits-only.

### Pattern 6: Form prefill order (D-07)

`OutlookConvertForm` currently prefills from `resolvePrefillProject(stored, projects, recent)` and sets billable from the project in a watcher [VERIFIED: resources/js/m365/calendar/OutlookConvertForm.vue:146 `if (project) billable.value = project.is_billable && !billableRatesLocked.value;` inside `watch([projectId, projects], …)`]. New order, in a pure `suggestions.ts` helper:
1. `meeting.assignment` (series) → project, task, tags, billable (billable `&& !locked`), reason `series`.
2. else `suggestions[0]` with `confident` → project (billable from project default), reason from the server.
3. else Phase 4 last-used chain, reason `last_used` (only when that chain produced a value).

Quick picks: up to 2 other projects (`suggestions` minus the chosen one, or the top 2 when not confident). Clicking one sets the project and marks it touched. Batch form: if all selected meetings share one assignment, use it; else majority vote of confident tops when the votes are at least half of the meetings ("Suggested for 3 of 4 meetings"); else last used.

### Pattern 7: Bulk confirm (D-04)

- Candidates = meetings with `assignment !== null`, not dismissed or ignored, **whose block is rendered** (`[data-ghost-id]` inside `.fc`). The Phase 4 range selection uses the same rule because hidden weekends and the day view must not confirm what the user cannot see [VERIFIED: 04-04-SUMMARY "Shift range candidates = context meetings whose [data-ghost-id] is rendered inside the calendar root (.fc)"].
- Toolbar button in `OutlookCalendarControls` ("Confirm 5 pre-assigned"), opening the existing results popover. Chunk the ids in groups of 50 (`MAX_MEETINGS`) and merge the results.
- Convert throttle is 30/min [VERIFIED: app/Microsoft365/routes/microsoft365.php:48-51 `->middleware(['check-organization-blocked', 'throttle:30,1,m365-convert:'])`]. A week will not exceed one or two chunks.

### Pattern 8: Ignore / forget series (RULE-04, RULE-05, D-10, D-11)

- New table `outlook_series_settings`:
  - `id` uuid
  - `user_id` FK users cascade
  - `series_master_id` string(255)
  - `ignored_at` nullable
  - `forgotten_at` nullable
  - timestamps
  - unique `(user_id, series_master_id)`

  Not Auditable and not in Filament (add it to the privacy-test needles). Ids only, so it **survives Disconnect** like links. The same mailbox reconnects with the same immutable ids. [Discretion, recommended]
- Routes in the existing m365 group, keyed by the meeting (no Graph id leaves the server), with the same 404 rules as dismiss [VERIFIED: microsoft365.php dismiss routes `->whereUuid('meeting')` + `throttle:60,1,m365-dismiss:`]:
  - `POST /m365/meetings/{meeting}/series/ignore` (`microsoft.meetings.series.ignore`)
  - `DELETE /m365/meetings/{meeting}/series/ignore` (`microsoft.meetings.series.unignore`)
  - `DELETE /m365/meetings/{meeting}/series/assignment` (`microsoft.meetings.series.forget`)

  A meeting without a series answers 404 (same answer as unknown, no oracle). Forget sets `forgotten_at = now()`, so the next conversion of the series creates a newer link and the assignment returns (D-11).
- Read: when `include_dismissed` is false, add `whereNotExists(settings where ignored_at is not null and series_master_id = outlook_meetings.series_master_id)`. With `include_dismissed`, ignored occurrences come back with `dismissed: true` and `series_ignored: true`, so the Phase 3 dismissed styling, `visibleCount` and the show-dismissed toggle keep working unchanged. The panel and menu show "Stop ignoring this series" instead of "Restore".
- The route-count test must change from 5 [VERIFIED: tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php:708 `$this->assertCount(5, $routes);`] to 8. Parameters stay `meeting` or `organization` only.
- A rules manager page is **not** cheap enough to be worth it. It would need a list of series with a readable name, and the series name lives only in the purgeable cache. Skip it, as D-11 allows.

### Pattern 9: Read payload (resource)

Per meeting, add:
- `is_recurring` (series_master_id ≠ null)
- `series_ignored`
- `assignment: {project_id, task_id, tags, billable} | null`
- `suggestions: [{project_id, confident, reason: {kind, count, value}}]`, empty when an assignment exists.

Build the resources with the hints already attached (`new OutlookMeetingResource($meeting, $hints)` with a subclass constructor), then wrap them. `ResourceCollection` keeps pre-built resources as they are [VERIFIED: vendor/laravel/framework/src/Illuminate/Http/Resources/CollectsResources.php:42-43 `$this->collection = $collects && ! $resource->first() instanceof $collects ? $resource->mapInto($collects) …`]. Dismiss and restore keep returning the plain resource (hints default to none). Impersonation keeps the early empty return.

### Anti-Patterns to Avoid
- **Joining links to `outlook_meetings` for series or signals at read time:** breaks after Disconnect or scrub (rows deleted or nulled). Capture onto the link at conversion.
- **Copying project/task/tags into a series table:** drifts from the user's entry edits and needs its own latest-wins writes.
- **Exposing attendees, organizer address, Graph ids or scores to the browser:** D-09 and the resource allow-list.
- **Scoring other users' links or other orgs' entries:** always `l.user_id = session user`, `te.user_id = l.user_id`, `te.organization_id = current org`.
- **Auto-converting pre-assigned meetings:** never (D-03, Out of Scope "Auto-creating time entries without confirmation").
- **Logging signals, addresses or subjects:** Phase 3 D-15; log counts only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Entry creation on confirm | Fork-side TimeEntry insert | `CoreTimeEntryCreator` via the convert endpoint | Overlap, permissions, billable rates, Recalculate jobs (ASGN-02) |
| Project visibility rule | Own membership logic | `PermissionStore::userHas` + `Project::scopeVisibleByEmployee` (same as core) [VERIFIED: TimeEntryStoreRequest.php:57 `$builder = $builder->visibleByEmployee(Auth::user());`; Project.php:182-190] | Must match what core will accept at confirm time |
| Keyed hashing | Custom hash scheme | PHP `hash_hmac('sha256', …, config('app.key'))` | Standard keyed hash; plain sha256 of an email is dictionary-reversible |
| Accent folding | Own transliteration table | `Str::ascii` | Laravel helper over portable-ascii |
| Latest row per group | PHP loop over all links | Postgres `DISTINCT ON … ORDER BY … DESC` | One indexed query |
| Results UI for bulk | New results list | `OutlookAssignResults.vue` + batch result view | D-04 says reuse |

**Key insight:** the "rules" the owner wanted are already in the data, because every conversion is a labelled example. The hard part is not ML. It is keeping evidence that survives disconnects, edits and deletes without storing personal data, and making sure the suggested project is one core will still accept.

## Common Pitfalls

### Pitfall 1: Signals lost after Disconnect
**What goes wrong:** Scoring joins links to `outlook_meetings` and learns nothing after the user reconnects.
**Why:** Disconnect deletes meeting rows; links survive (Phase 4 D-15).
**How to avoid:** Hashed signals and `series_master_id` on the link at conversion (Patterns 2, 3).
**Warning signs:** A test "disconnect + reconnect + sync keeps suggestions" fails.

### Pitfall 2: Attendee data outliving the cache
**What goes wrong:** Clear addresses stored on links remain after Disconnect, against D-09.
**How to avoid:** HMAC only on links. `scrubIneligible` and Disconnect null or delete the clear columns. The resource never serializes them.
**Warning signs:** `grep -rn "@" ` in link signals in a test DB dump; a privacy test asserting no `@` in `outlook_meeting_links.signals`.

### Pitfall 3: Tags or tasks that no longer validate
**What goes wrong:** Confirm fails with a validation error because the series' tag was deleted. Entries keep tag ids in a jsonb array with no FK. `project_id` and `task_id` are `restrictOnDelete` [VERIFIED: database/migrations/2024_01_20_110837_create_time_entries_table.php:36-46 `->restrictOnDelete();` for project and task, `$table->jsonb('tags')->nullable();`].
**How to avoid:** The resolver filters tags to existing org tags and drops done tasks (`tasks.done_at`). An archived or no-longer-visible project makes the assignment null.

### Pitfall 4: Billable watcher overwrites the series' billable
**What goes wrong:** The form's `watch([projectId, projects])` sets billable from the project default after the assignment set it.
**How to avoid:** Apply the assignment's billable after the project (`nextTick`), or skip the watcher's first run when the prefill came from an assignment. Vitest: assignment `billable=false` on a billable project stays false.

### Pitfall 5: Read and confirm in different organizations
**What goes wrong:** Lane shows org A's assignment, confirm posts to org B.
**How to avoid:** Both use `current_team_id` (Pattern 2). The convert URL already does. The assignment must be resolved again at confirm time anyway.

### Pitfall 6: Confirming what the user cannot see
**What goes wrong:** Bulk confirm includes weekend meetings hidden by the view option, or other days in day view.
**How to avoid:** Candidates come from rendered blocks (Pattern 7).

### Pitfall 7: Stale pre-assignment at confirm
**What goes wrong:** The user converts occurrence A to project X, then quickly confirms B before the read refetched, expecting the old project.
**How to avoid:** The convert already invalidates the meetings read [VERIFIED: 04-03-SUMMARY "invalidates ['timeEntries'], ['goals'], ['m365','meetings']"]. Confirm resolves server-side to the latest (correct per D-05). The confirmation toast and row show the project actually used.

### Pitfall 8: Overconfident suggestions from one rare word
**How to avoid:** IDF cap 3, confidence needs 2 supporting links or a person/domain match, margin 1.5×. Unit matrix of cases.

### Pitfall 9: "Forget" undone by learned scoring
**How to avoid:** Exclude the forgotten series' pre-forget links from scoring for its own occurrences (Pattern 5).

### Pitfall 10: Hard-coded counts in existing tests
**What goes wrong:** CI fails on unrelated assertions.
**How to avoid:** Update `->has('microsoft.calendar.labels', 84)` [VERIFIED: tests/Feature/Microsoft365/OutlookCalendarPropTest.php:55, 165, 291] to the new total, and the route count (Pattern 8). `MicrosoftLangTest` enforces en/es parity.

### Pitfall 11: Selection/hover/menu conflicts with new affordances
**What goes wrong:** A "Confirm" button inside the block triggers the panel (PopoverTrigger) or breaks Ctrl-click selection.
**How to avoid:** Put Confirm in the hover card, panel and context menu, not as a button inside the block. The block only shows the project colour and name. Phase 4 Pitfall 6 (modifier clicks) still applies.

### Pitfall 12: Project colour contrast
**What goes wrong:** Arbitrary project colours fill the block and break BRAND-04 contrast.
**How to avoid:** Use the project colour only for a left bar or dot. Keep the Outlook fill and text tokens (Phase 3.2 `--m365-*`).

## Code Examples

### Signals (pure, Octane safe)
```php
// Source: pattern for this phase; hash_hmac is core PHP
final class MeetingSignals
{
    public static function hash(string $kind, string $value): string
    {
        return substr(hash_hmac('sha256', $kind.'|'.$value, (string) config('app.key')), 0, 16);
    }
}
```

### Confirm mode in the request (sketch)
```php
$useSeries = fn (): bool => $this->boolean('use_series_assignment');
'use_series_assignment' => ['sometimes', 'boolean'],
'project_id' => [Rule::requiredIf(fn () => ! $useSeries()), Rule::prohibitedIf($useSeries), 'nullable', 'string', 'uuid'],
'billable'   => [Rule::requiredIf(fn () => ! $useSeries()), Rule::prohibitedIf($useSeries), 'boolean'],
// task_id, tags, description, start, end: add Rule::prohibitedIf($useSeries)
```

### Test hook extension (frontend)
The existing third argument [VERIFIED: resources/js/m365/calendar/useOutlookMeetings.ts:141-145 `export interface OutlookTestHookOptions { actions?: boolean; convertUrl?: string; linkedTimeEntryIds?: string[]; }`] gains `seriesUrl?: string` (base for ignore/forget, answered by `page.route`). Injected meetings simply carry `is_recurring`, `series_ignored`, `assignment` and `suggestions`, so no new hook mechanism is needed for prefill and confirm.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual "assign this series" rules (original RULE-01..05) | Learned from conversions (revised RULE-01..05) | 2026-11-17 (owner) | No rules UI, no rule table |
| Organizer name only in cache (Phase 3) | Organizer address + attendees in cache (D-09) | Phase 5 | DECISIONS-graph `$select` section and migration comment must be updated |
| `$select` without attendees (DECISIONS-graph.md:338-346 "Add no `body`, no `attendees`") | `$select` + `attendees` | Phase 5 | Record the change and its reason (D-09) in DECISIONS-graph.md; `GraphCalendarClientTest` asserts the new string |

**Deprecated/outdated:** DECISIONS-graph.md line 343 "Add no `body`, no `attendees` and no `lastModifiedDateTime`". Amend it to "no `body` and no `lastModifiedDateTime`; `attendees` added in Phase 5 for suggestions (D-09)". The docs validator (`tests/Tools/m365-spike/validate-docs.mjs`) checks this file, so run it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Weights, IDF cap 3, 90-day half-life, threshold 3.0, margin 1.5×, broadcast guard 25 are good starting values | Pattern 5 | Too many or too few confident prefills. Constants live in one class and are tuned after UAT; no data migration needed |
| A2 | Rooms (`type=resource`) carry no client signal and can be skipped | Pattern 1 | Minor lost signal |
| A3 | History query + scoring stays under ~50 ms for ≤ 2000 links | Pattern 5 | Slower read. Mitigate by lowering LIMIT or moving the engine to a separate endpoint (same service) |
| A4 | Postgres `DISTINCT ON` semantics as described | Pattern 2 | Low; standard Postgres |
| A5 | "This and following" always yields a new master id (community observation, E2 not captured) | Pattern 2 | If Graph kept the id, the series would simply stay pre-assigned (harmless) |
| A6 | Stop-word list content | Pattern 5 | Noisy tokens slightly reduce precision |
| A7 | Series settings may survive Disconnect (ids only) | Pattern 8 | If the owner wants a full wipe, add one delete to the disconnect transaction |
| A8 | Graph payload growth from `attendees` is acceptable within `max_pages` 10 | Pattern 1 | Very large calendars could truncate earlier. Monitor the `truncated` flag |

## Open Questions (RESOLVED)

1. **Separate tables vs derive from links?** RESOLVED (CONTEXT: Claude's discretion). Derive the assignment from links + live entries; one `outlook_series_settings` table for ignore/forget; hashed `signals` jsonb on links.
2. **Suggestions in the read or a separate endpoint?** RESOLVED (discretion). In the read (Pattern 5/9). The engine is a service, so a separate endpoint stays a cheap fallback (A3).
3. **What when `seriesMasterId` is null?** RESOLVED. No pre-assignment and no ignore-series; learned suggestions only.
4. **Bulk-confirm placement?** RESOLVED (discretion). Toolbar button in `OutlookCalendarControls`, plus a "Confirm" item in the selection bar when every selected meeting is pre-assigned. Final look is for UI-SPEC.
5. **Forget in menu, panel or both?** RESOLVED (discretion). Both, next to the reason line in the panel ("Same series · Forget"). Ignore series goes in the menu and panel.
6. **Rules manager page?** RESOLVED (D-11). Not built; not cheap (series names live only in the purgeable cache).
7. **Measuring the hit rate before PROD-05 (D-01)?** Recommendation (not locked): add `prefill_source` (`series|suggestion|last_used|none`) and `prefill_kept` (bool) to the link, sent by the client and compared server-side. The hit rate is then one SQL query, with no personal data. Planner may include it as a small task; if dropped, PROD-05 has no evidence base.
8. **Should converting an ignored-series occurrence un-ignore it?** RESOLVED (discretion). No, only "Stop ignoring" does.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | Vitest, vue-tsc, eslint, prettier | ✓ | v24.13.1 / 11.8.0 | — |
| vitest, playwright binaries | JS gates | ✓ (`node_modules/.bin/vitest`, `node_modules/.bin/playwright`) | per package.json | — |
| PHP 8.3 portable | Pint, PHPStan, DB-free PHPUnit unit tests | ✓ `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe` | 8.3.x | — |
| System PHP on PATH / PostgreSQL / Docker | Feature PHPUnit, full Playwright | ✗ (`command -v php` and `command -v docker` empty) | — | GitHub CI on push (Phase 3/4 precedent) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** feature PHPUnit and Playwright run in CI only. Keep the scorer, tokenizer and signals pure so their unit tests run locally.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (feature: CI only; DB-free unit: local) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60 (CI) |
| Config file | `phpunit.xml`, `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run resources/js/m365` · `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365` · `"$PHP_BIN" vendor/bin/pint --test <files>` · `"$PHP_BIN" vendor/bin/phpstan analyse` |
| Full suite command | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check`; CI: PHPUnit (Microsoft365 PASS lines), PHPStan, Pint, Playwright, fork image — all green on HEAD |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RULE-01 | Converting one occurrence pre-assigns the others (past + future) with project/task/tags/billable; latest conversion wins; entry edit moves the series; other org's links ignored; reassigned entry ignored; archived/invisible project → null; deleted tag dropped; done task dropped; single meeting never pre-assigned | PHP feature | CI `--filter OutlookSeriesAssignmentTest` | ❌ Wave 0 |
| RULE-01 | Link stores `series_master_id` at conversion; migration backfill; survives disconnect + reconnect + sync (fixture replay) | PHP feature | CI `--filter OutlookMeetingLinkLifecycleTest` (extend) | ✅ extend |
| RULE-01 | Form prefill order (assignment > confident > last used), billable not overwritten, reason line | Vitest | `npx vitest run resources/js/m365/calendar/suggestions.test.ts resources/js/m365/calendar/OutlookConvertForm.test.ts` | ❌ / ✅ extend |
| RULE-02 | `use_series_assignment`: per-meeting server resolution, prohibited fields → 422, `no_assignment` failure, mixed batch (2 series + 1 single), idempotent `existing`, impersonation 404, entry created via core (overlap rule applies) | PHP feature | CI `--filter OutlookMeetingConversionTest` (extend) | ✅ extend |
| RULE-02 | Confirm one click from hover/panel/menu; bulk confirm only rendered pre-assigned, chunks of 50, results/retry | Vitest + Playwright | `npx vitest run resources/js/m365`; CI `e2e/outlook-suggestions.spec.ts` | ❌ Wave 0 |
| RULE-03 | Tokenizer ES/EN (accents, stop words, digits); signals hashing (own address excluded, internal vs external, resources skipped, broadcast guard); scorer matrix (organizer > domain > subject; IDF cap; decay; confidence rules; top 3; reason kind/count) | PHP unit (local) | `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/SubjectTokenizerTest.php tests/Unit/Microsoft365/MeetingSignalsTest.php tests/Unit/Microsoft365/ProjectSuggestionEngineTest.php` | ❌ Wave 0 |
| RULE-03 | Read returns suggestions only from the session user's links in the current org; other users never influence; archived excluded; impersonation empty; no attendee/address/score in JSON; no `@` in stored link signals | PHP feature | CI `--filter OutlookMeetingSuggestionTest`, `--filter OutlookMeetingPrivacyTest` (extend) | ❌ / ✅ extend |
| RULE-03 | Sync stores attendees/organizer_address from `experiment-select` fixture pages; scrub nulls them; Disconnect deletes them; `SELECT` contains `attendees` | PHP feature + unit | CI `--filter OutlookMeetingSyncTest` (extend); `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/GraphCalendarClientTest.php` | ✅ extend |
| RULE-04 | Ignore/unignore: 404 for foreign/unknown/gone/non-recurring; read hides; `include_dismissed` returns `dismissed+series_ignored`; impersonation 404; route count 8 | PHP feature | CI `--filter OutlookSeriesSettingsTest`, `--filter OutlookMeetingPrivacyTest` | ❌ / ✅ extend |
| RULE-04 | Menu/panel items only for recurring meetings with canAct; undo in show-dismissed | Vitest + Playwright | `npx vitest run resources/js/m365/calendar/OutlookMeetingContextItems.test.ts resources/js/m365/calendar/OutlookGhostDetail.test.ts` | ✅ extend |
| RULE-05 | Forget → null until the next conversion; forgotten links excluded from scoring of that series; reasons render en/es; lang parity | PHP feature + Vitest + unit | CI `--filter OutlookSeriesSettingsTest`; `"$PHP_BIN" vendor/bin/phpunit tests/Unit/Microsoft365/MicrosoftLangTest.php` | ❌ / ✅ |
| D-12 | No new endpoint modifies or deletes time entries (snapshot before/after ignore, forget, read) | PHP feature | CI `--filter OutlookMeetingPrivacyTest` (reuse `timeEntrySnapshot()`) | ✅ extend |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched m365 files>` + prettier; PHP tasks: Pint on touched files + full-app PHPStan + local DB-free unit tests.
- **Per wave merge:** push, then the CI gate (PHPUnit Microsoft365 PASS count ≥ previous + new classes × 3 Postgres jobs, PHPStan, Pint; Playwright on the UI wave).
- **Phase gate:** all CI workflows green on the release sha before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/Unit/Microsoft365/SubjectTokenizerTest.php`, `MeetingSignalsTest.php`, `ProjectSuggestionEngineTest.php` (pure, local)
- [ ] `tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php`, `OutlookMeetingSuggestionTest.php`, `OutlookSeriesSettingsTest.php`
- [ ] Shared helper for links with signals (extend the existing inline `meeting()` helper pattern or move it to `Support/`)
- [ ] `resources/js/m365/calendar/suggestions.test.ts`
- [ ] `e2e/outlook-suggestions.spec.ts` (injected meetings with `assignment`/`suggestions`, `page.route` for convert and series URLs, real entries via core API like 04-08)
- [ ] Update hard-coded counts: labels 84 → new total (3 places), routes 5 → 8

## Security Domain

`security_enforcement: true`, ASVS level 1 [VERIFIED: .planning/config.json `"security_enforcement": true`, `"security_asvs_level": 1`].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `auth:web`, `auth.session`, `verified` route stack |
| V3 Session Management | yes (inherited) | Web session + XSRF |
| V4 Access Control | yes | All queries scoped to the session user; links ⨝ entries with `te.user_id = l.user_id` and current org; series routes look the meeting up in the user's rows (404 otherwise); impersonation via `GraphAccessGuard` (no hints, no confirm, 404 on series routes) |
| V5 Input Validation | yes | `MeetingConversionRequest` (`use_series_assignment` boolean, prohibited fields), uuid route params |
| V6 Cryptography | yes (light) | `hash_hmac('sha256', …, app.key)`; no custom crypto |
| V7 Errors/Logging | yes | No subjects, addresses or signals in logs; per-meeting translated errors |
| V8 Data Protection | yes | Attendee data minimised (50 rows, no status), never in responses, purged on Disconnect and with the user; links hold hashes only |
| V11 Business Logic | yes | No auto-conversion; confirm through core rules; throttles (`m365-convert`, `m365-dismiss`, `m365-read`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Suggestions leaking other users' meeting data | Information disclosure | History query filtered by session user and entry owner; test that a second user's links never change the ranking |
| Attendee addresses exposed to the browser or other users | Information disclosure | Resource allow-list; privacy test asserts no `attendees`/address keys in JSON |
| IDOR on ignore/forget | Tampering | Meeting lookup inside the user's non-gone rows, 404 for foreign ids |
| Confirm creating entries on a project the user lost access to | Elevation of privilege | Resolver bookability filter + core `TimeEntryStoreRequest` rule at create |
| Admin impersonation confirming or learning | Elevation of privilege | `GraphAccessGuard::blocked()` → empty hints, 404 on mutations |
| Dictionary reversal of stored signals | Information disclosure | Keyed HMAC (secret app key), not plain hashes |
| Heavy scoring per read | DoS | History LIMIT 2000 / 365 days, read throttle 60/min |
| XSS via reason values (domain, names, subject words) | Tampering | Vue text interpolation + `fillLabel` (no `v-html`) |

## Sources

### Primary (HIGH confidence, read this session)
- `app/Microsoft365/Graph/GraphCalendarClient.php` (SELECT), `Graph/OutlookMeetingSyncService.php` (buildRow, store, scrub), `Models/OutlookMeeting.php`, `Models/OutlookMeetingLink.php`
- `app/Microsoft365/database/migrations/2026_11_05_000001_create_outlook_meetings_tables.php`, `2026_11_17_000001_create_outlook_meeting_links_table.php`
- `app/Microsoft365/Http/Controllers/MeetingConversionController.php`, `OutlookMeetingController.php`, `MicrosoftAccountController.php`, `Http/Requests/MeetingConversionRequest.php`, `Http/Resources/OutlookMeetingResource.php`, `Http/Middleware/ShareMicrosoftInertiaData.php`, `routes/microsoft365.php`
- `app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php`, `app/Models/Project.php`, `app/Http/Controllers/Api/V1/TimeEntryController.php` (store), time_entries migration
- `resources/js/m365/calendar/useOutlookMeetings.ts`, `OutlookConvertForm.vue`, `lastProject.ts`, `meetingsApi.ts`, `OutlookGhostLayer.vue`, `OutlookGhostDetail.vue`, `OutlookMeetingContextItems.vue`, `types.ts`, `resources/js/Pages/Calendar.vue`
- `docs/m365/DECISIONS-graph.md` (occurrence key, series key, $select), `tests/Fixtures/M365/manifest.json`, `calendarview/roundA.experiment-select.page-2.json`, `tests/Feature/Microsoft365/Support/InteractsWithGraphFixtures.php`
- Phase 4 artifacts: 04-0x-SUMMARY.md, 04-RESEARCH.md, 04-VALIDATION.md
- learn.microsoft.com/en-us/graph/api/resources/attendee, learn.microsoft.com/en-us/graph/api/resources/event (attendees, hideAttendees, seriesMasterId, 500-attendee limit)

### Secondary (MEDIUM confidence)
- pnp.github.io/blog/post/one-outlook-edit-became-two-microsoft-graph-events/ (2026-09-17): "this and following" creates a new master with a new id/iCalUId; no linking field

### Tertiary (LOW confidence)
- Scoring weights, thresholds, stop-word list: design judgement, to be tuned with real conversions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages; all reused pieces read this session)
- Architecture / data model: HIGH (derived from the actual Phase 4 contracts and the disconnect behaviour)
- Graph series behaviour on splits: MEDIUM (community-observed, not fixture-backed)
- Scoring parameters: LOW (explicitly tunable starting values)
- Pitfalls: HIGH (each tied to a verified code fact)

**Research date:** 2026-11-17
**Valid until:** 2026-12-17 (stable codebase; re-check if Phase 6 changes the link table first)
