# Phase 4: Assign Meetings to Projects - Research

**Researched:** 2026-11-17
**Domain:** Laravel 13 fork module (`app/Microsoft365`) reusing the core time-entry create path; Vue 3 calendar overlay UI (`resources/js/m365/calendar`)
**Confidence:** HIGH (codebase-verified). The few framework-behaviour claims that were not run are tagged [ASSUMED].

## Summary

Core solidtime has **no reusable create service**. All create rules sit inline in `TimeEntryController::store()` / `private storeTimeEntry()`: permission checks (`time-entries:create:own|all`), the org's optional overlap check (`prevent_overlapping_time_entries`), forcing `billable=false` when the org cannot use billable rates, `setComputedAttributeValue('billable_rate')`, and dispatching `RecalculateSpentTimeForProject` / `RecalculateSpentTimeForTask`. Project visibility for employees is checked in `TimeEntryStoreRequest`. `TimeEntryService` only builds rounding SQL for reports. Rounding is a read/report option, not something that happens on create. So "reuse `TimeEntryService`" (D-10) in practice means "reuse the controller action and its Form Request". The approach with no core edits and an atomic result is: a **fork web endpoint that builds a `TimeEntryStoreRequest` in-process and calls `TimeEntryController::store()`**, inside one DB transaction together with the link insert. The browser never calls the core API for a conversion. Any concurrent duplicate then rolls back its entry, because the link has a unique constraint.

The link **cannot be a column on `outlook_meetings`**. Phase 3 D-21 deletes every `outlook_meetings` row of the user on Microsoft disconnect (`MicrosoftAccountController::destroy`, line 39). Links stored there would be lost, and after a reconnect every converted meeting would come back as a suggestion and could be converted twice. Use a separate fork table `outlook_meeting_links` keyed by `(user_id, graph_id)`, with `graph_id` being the immutable occurrence key. Give it `time_entry_id` unique and `FOREIGN KEY → time_entries(id) ON DELETE CASCADE`. Core deletes time entries with **query-builder bulk deletes** in `DeletionService`, `MemberService` and `destroyMultiple` loops. Those fire no Eloquent events, so only a DB-level FK re-surfaces the suggestion on every delete path. Model observers would miss some of them.

On the frontend, all new UI lives in `resources/js/m365/calendar`:
- one `OutlookConvertForm.vue` mini form, reused by the panel and by the multi-select bar;
- selection state in the shared `useOutlookMeetings` context;
- a floating bar teleported to `body` from an already-mounted fork component.

The project, task, tag and billable pickers are the core components `TimeTrackerProjectTaskDropdown`, `TagDropdown` and the billable `Select` used by `TimeEntryCreateModal`. The modal itself cannot be reused because it has no prefill props for description or project. The Outlook icon on converted entries needs one small, ledgered core slot chain: `FullCalendarEventContent` ← `CalendarDayColumn` ← `TimeEntryCalendar` ← `Calendar.vue`. The ids to mark come from the existing `GET /m365/meetings` response.

**Primary recommendation:** Add `POST /m365/organizations/{organization}/meetings/time-entries` (batch, 1..N meeting ids; a single conversion is N=1). For each meeting it runs `DB::transaction { lock meeting row → return the existing link if there is one → core TimeEntryController::store() via a constructed TimeEntryStoreRequest → insert outlook_meeting_links → clear dismissal }` and returns a result per meeting. Store links in a new `outlook_meeting_links` table with `UNIQUE(user_id, graph_id)`, `UNIQUE(time_entry_id)` and `FK time_entry_id → time_entries ON DELETE CASCADE`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Creating one entry (owner, 2026-11-17)
- **D-01:** A "Create time entry" action is added to the meeting hover card, the click detail panel (`OutlookGhostDetail.vue`) and the meeting context menu (`OutlookMeetingContextItems.vue`), next to "Open in Outlook" and "Dismiss" (roadmap criterion 6).
- **D-02:** The action opens a small inline form (mini form), not a direct create. Prefilled: project = the project the user used last for a meeting conversion (fallback: the user's most recent time entry's project; else empty), description = meeting subject, start/end = meeting start/end, billable = the project's default. Editable: project (required), task, tags, billable, description, start, end. Enter or "Create" confirms, so a repeat conversion to the same project is two clicks.
- **D-03:** Start/end are editable in the form so a user who joined late or left early logs the real time. The entry stays linked to the meeting occurrence regardless of the edited times.

#### After conversion (owner, 2026-11-17)
- **D-04:** A converted meeting no longer appears in the Outlook lane (ASGN-03). The time entry renders as a normal entry with a small Outlook icon so its origin is visible. This refines Phase 3 D-01 ("converted meeting display is Phase 4's call").
- **D-05:** The entry is a normal, fully editable/deletable time entry (ASGN-05). Deleting it brings the meeting back as a suggestion. Editing its times does not bring the meeting back.
- **D-06:** One occurrence → at most one time entry, enforced server-side (unique link per user + occurrence), so double clicks and concurrent requests never duplicate (ASGN-03). A repeated request returns the existing entry rather than an error.

#### Several at once (owner, 2026-11-17)
- **D-07:** Multi-select with Ctrl/Cmd-click or Shift-click on meetings. While one or more are selected, a floating bar shows "Assign N meetings" and opens the same mini form without start/end fields (each meeting keeps its own times; description = each meeting's own subject). Escape or clicking elsewhere clears the selection.
- **D-08:** After a multi-assign the user sees a per-meeting result: created, or failed with the reason (e.g. no permission on the project, meeting no longer exists, already converted). Successful ones disappear from the lane; failed ones stay selected so the user can retry.

#### Future meetings (owner, 2026-11-17)
- **D-09:** Future meetings can be converted, with no time limit, same as manual future entries in solidtime.

#### Rules carried forward
- **D-10:** Entries created from meetings go through the same core path as manual entries (permissions, billable rate resolution, rounding, overlap handling, project/task spent-time recalculation jobs), i.e. reuse `TimeEntryService` / the existing create flow rather than inserting rows directly (ASGN-02). Do not add overlap blocking that manual entries don't have.
- **D-11:** Dismissed meetings are not convertible from the lane while hidden; when "Show dismissed" is on, converting a dismissed meeting is allowed and clears its dismissal.
- **D-12:** Fork isolation (Phase 2 D-15 / Phase 3 D-17): backend in `app/Microsoft365/`, frontend in `resources/js/m365/`; any core touch (e.g. the Outlook icon on calendar entries) is minimal and ledgered in `docs/m365/TOUCHED-CORE-FILES.md`. Fork endpoints stay out of the public `/api/v1` OpenAPI spec.
- **D-13:** Privacy and token rules unchanged (Phase 3 D-15, D-16, D-22): meeting subject only goes into the user's own time entry description; impersonation cannot convert meetings.
- **D-14:** Calendar shows weekends hidden by default (owner, 2026-11-17, shipped as a 3.1 follow-up); nothing in this phase depends on weekends being visible.

### Claude's Discretion
- Link storage shape (link table vs column on `outlook_meetings`) and how deleting an entry re-surfaces the suggestion, as long as D-05/D-06 hold and the link survives re-syncs.
- Where "last used project" is remembered (server or local).
- Exact mini-form layout (popover anchored to the meeting vs reusing parts of the existing time-entry create modal), keyboard behaviour, floating bar placement, icon choice and wording (English strings with the existing lang files).
- Whether the multi-assign is one batch endpoint or several single calls, as long as results are per meeting.

### Deferred Ideas (OUT OF SCOPE)
None raised in this discussion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASGN-01 | Select a meeting suggestion and assign it to a project (hover tooltip or detail panel), optional task/tags/billable, description prefilled, real entry with meeting start/end | Fork convert endpoint (Pattern 1), mini form built from core pickers (Pattern 5), action slots already reserved in `OutlookMeetingHoverCard.vue` (comment line 9) and `OutlookMeetingContextItems.vue` (line 118) |
| ASGN-02 | Same rules as manual entries (permissions, billable rates, rounding, overlap, project totals) | In-process call of `TimeEntryController::store()` with a real `TimeEntryStoreRequest` (Pattern 1); `check-organization-blocked` on the fork route; jobs are `ShouldDispatchAfterCommit` |
| ASGN-03 | Converted once; no longer a suggestion; double clicks / concurrency never duplicate | `outlook_meeting_links` with `UNIQUE(user_id, graph_id)` + same-transaction insert + row lock (Pattern 2); index excludes linked meetings (Pattern 3) |
| ASGN-04 | Multi-select and assign in one action with per-meeting success/failure | Batch endpoint with per-item transaction and per-item result (Pattern 4); selection in the shared context + teleported floating bar (Pattern 6) |
| ASGN-05 | Entries stay normal; deleting re-surfaces the meeting | DB-level `ON DELETE CASCADE` from `time_entries` to the link covers every core delete path (Pitfall 1); the frontend refetches meetings after time-entry changes (Pattern 7) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15. Follow `.planning/codebase/CONVENTIONS.md`.
- Every PHP file uses `declare(strict_types=1);`. Pint uses the `laravel` preset plus `strict_comparison`, `strict_param`, `void_return` and `no_unused_imports`. PHPStan level 7 runs with `checkOctaneCompatibility` and `noEnvCallsOutsideOfConfig`, so do not call `env()` outside `config/`.
- Domain errors extend `App\Exceptions\Api\ApiException` with a `KEY`. Authorization failures throw `AuthorizationException`. Validation goes in Form Requests.
- API-style controllers return Resources, never raw models.
- Vue uses `<script setup lang="ts">` and `defineProps<{...}>()`. No new Options API components. Server state goes through TanStack Vue Query. Tailwind theme tokens only. No `console.log`.
- Vitest specs sit next to the source as `*.test.ts`. PHPUnit tests go in `tests/Feature/Microsoft365/` and `tests/Unit/Microsoft365/`. Playwright specs are kebab-case in `e2e/`.
- Octane is in use: no static or singleton per-request state.
- Web routes use the `web` guard and API routes use Passport. Do not mix guards in new routes.
- Mergeability: changes stay isolated. Every core touch goes in the ledger `docs/m365/TOUCHED-CORE-FILES.md`.
- Data safety: Outlook changes never modify or delete time entries automatically.
- GSD workflow: edits only through GSD commands.
- Prettier settings: 4 spaces, single quotes, printWidth 100.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Create entry with core rules | API / Backend (core `TimeEntryController::store` called from the fork controller) | — | Rules live server-side in the controller and Form Request; duplicating them in JS or in the fork would break D-10 |
| One occurrence → one entry | Database (unique constraints) + Backend (transaction, row lock) | — | Only DB constraints survive double clicks, concurrency and Octane workers |
| Re-surface on delete | Database (FK `ON DELETE CASCADE`) | Browser (refetch meetings) | Core bulk deletes bypass Eloquent events |
| Hide converted meetings / list linked entry ids | API (`GET /m365/meetings`) | Browser | Server is the source of truth; entries can move weeks |
| Mini form, pickers, prefill, last-used project | Browser | — | Pure UI state; the project list comes from existing queries |
| Multi-select, floating bar, per-meeting results | Browser | API (batch result shape) | Selection spans day columns (one ghost layer per column) |
| Outlook icon on entries | Browser (fork component through a core slot) | API (linked ids) | Core touch limited to a slot chain |
| Impersonation block | Backend (`GraphAccessGuard`) | — | Same guard as dismiss (Phase 3 D-22) |

## Standard Stack

No new packages. Everything below is already installed and in use.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| laravel/framework | v13.33.0 [VERIFIED: composer.lock:4285-4286] | Transactions, `lockForUpdate`, `UniqueConstraintViolationException`, FormRequest | Already the app framework |
| @tanstack/vue-query | ^5.100.10 [VERIFIED: package.json:64] | Meetings query and mutations, invalidation | Project convention |
| reka-ui | ^2.10.1 [VERIFIED: package.json:82] | Popover, HoverCard, ContextMenu (already used by the ghost layer) | Already used in every fork surface |
| @lucide/vue | in use (`OutlookGhostLayer.vue` line 3) | Icons | Fork convention |

### Supporting (existing in-repo components to reuse)
| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `@/packages/ui/src/TimeTracker/TimeTrackerProjectTaskDropdown.vue` | Project + task picker (`v-model:project`, `v-model:task`) | Mini form |
| `@/packages/ui/src/Tag/TagDropdown.vue` | Tag multi-select | Mini form |
| `Select` + `BillableIcon` + `useBillableRatesLock` | Billable choice, locked when the plan disallows billable rates | Mini form |
| `@/packages/ui/src/TimeEntry/TimeRangeFields.vue` (`v-model:start`, `v-model:end`) | Start/end editing | Single mode only (D-07 removes it in multi) |
| `@/utils/useProjectsQuery`, `useTasksQuery`, `useTagsQuery`, `useClientsQuery`, `useProjectsStore().createProject`, `useTagsStore().createTag` | Data + creators, same caches as `Calendar.vue` | Fork components call them directly (app code, not packages/ui) |
| `getLastWorkTimeEntry` (`resources/js/utils/useCurrentTimeEntry.ts:45`) + `useTimeEntriesInfiniteQuery` | Fallback "most recent entry's project" | D-02 fallback |
| `useNotificationsStore` | Error toasts | Same as dismiss |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed in this phase, so the gate does not apply.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Ghost block (hover card / panel / context menu)        Ctrl/Shift-click ghosts
              │ "Create time entry"                               │
              ▼                                                   ▼
   OutlookConvertForm (single: start/end shown)     selection (shared context) → floating bar
              │  project, task, tags, billable, description         │ "Assign N meetings" → OutlookConvertForm (multi, no times)
              └──────────────┬───────────────────────────────────────┘
                             ▼  POST /m365/organizations/{org}/meetings/time-entries  (web: session + XSRF)
             ┌────────────────────────────────────────────────────────────────┐
             │ Fork MeetingConversionController                                 │
             │  guard: impersonating? → 404 · org blocked? → 4xx                 │
             │  for each meeting id:                                             │
             │   DB::transaction:                                                │
             │     own non-gone meeting row  lockForUpdate ──► not found → failed│
             │     link(user, graph_id) with entry still owned? → "existing"     │
             │     build TimeEntryStoreRequest(member_id=self, start/end, …)     │
             │     core TimeEntryController::store()  ── permissions, project    │
             │        visibility, overlap (org opt-in), billable lock,           │
             │        billable_rate, Recalculate* jobs (after commit)            │
             │     INSERT outlook_meeting_links (unique user+graph_id, entry)    │
             │     clear dismissed_at                                             │
             │   catch Validation/Authorization/ApiException/Unique → per-item    │
             └──────────────┬─────────────────────────────────────────────────┘
                            ▼ { results: [{meeting_id, status, time_entry_id?, error?}] }
   Browser: drop created meetings from the cache (optimistic), invalidate ['timeEntries'], ['goals'], ['m365','meetings']
                            ▼
   GET /m365/meetings → data excludes linked meetings; additional.linked_time_entry_ids
                            ▼
   Calendar: core entries render; fork badge in the event-extra slot shows the Outlook icon for linked ids

 Delete of an entry (any core path: DELETE /time-entries, bulk delete, member removal, org deletion)
   → FK ON DELETE CASCADE removes the link row → next meetings read shows the suggestion again
```

### Recommended Project Structure
```
app/Microsoft365/
├── Http/Controllers/MeetingConversionController.php   # batch convert endpoint (N=1 for single)
├── Http/Requests/MeetingConversionRequest.php          # meeting_ids, project_id, task_id, tags, billable, description?, start?, end?
├── Http/Resources/  (inline array response is fine; or MeetingConversionResultResource)
├── TimeEntries/CoreTimeEntryCreator.php                # the only class that knows how to call core store()
├── Models/OutlookMeetingLink.php                       # not Auditable, not in Filament
└── database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php
resources/js/m365/calendar/
├── OutlookConvertForm.vue (+ .test.ts)                 # mini form, single + multi mode
├── OutlookSelectionBar.vue (+ .test.ts)                # teleported floating bar + per-meeting results
├── OutlookEntryBadge.vue (+ .test.ts)                  # Outlook icon for linked entries
├── conversionApi.ts (+ .test.ts)                       # axios POST, result parsing
├── lastProject.ts (+ .test.ts)                         # localStorage last-used project per org
└── (extend) useOutlookMeetings.ts, OutlookGhostLayer.vue, OutlookGhostDetail.vue,
             OutlookMeetingHoverCard.vue (actions slot), OutlookMeetingContextItems.vue, meetingsApi.ts, types.ts
tests/Feature/Microsoft365/OutlookMeetingConversionTest.php, OutlookMeetingLinkLifecycleTest.php
e2e/outlook-convert.spec.ts
```

### Pattern 1: Reuse the core create action in-process (no core edit)

**What:** Build a real `TimeEntryStoreRequest` from the fork request, validate it, and call the core controller action. All D-10 rules run unchanged: `checkPermission` against `time-entries:create:own|all`, member membership, `ExistsEloquent` project visibility (`visibleByEmployee` unless `time-entries:create:all` or `projects:view:all`), `assertNoOverlap` (only when `prevent_overlapping_time_entries`), the billable lock, `billable_rate` computation and the recalc jobs.

Verified facts it relies on:
- Core create path [VERIFIED: app/Http/Controllers/Api/V1/TimeEntryController.php:608-669]. Signature `public function store(Organization $organization, TimeEntryStoreRequest $request): JsonResource`. Permission branch `'time-entries:create:own'` / `'time-entries:create:all'`. Overlap via `$this->assertNoOverlap($organization, $member, $start, $end);`. `if ($timeEntry->billable && ! $this->canUseBillableRates($organization)) { $timeEntry->billable = false; }`. `$timeEntry->setComputedAttributeValue('billable_rate');`. `RecalculateSpentTimeForProject::dispatch($project);` / `RecalculateSpentTimeForTask::dispatch($task);`. Returns `new TimeEntryResource($timeEntry)`.
- Overlap is opt-in per org [VERIFIED: TimeEntryController.php:66-70]: `if (! $organization->prevent_overlapping_time_entries) { return; }`.
- Jobs wait for commit [VERIFIED: app/Jobs/RecalculateSpentTimeForProject.php:16 `class RecalculateSpentTimeForProject implements ShouldDispatchAfterCommit, ShouldQueue`; RecalculateSpentTimeForTask.php:16 same], so wrapping the call in `DB::transaction` is safe and a rollback drops them.
- Core route middleware [VERIFIED: routes/api.php:117]: `Route::post('/time-entries', [TimeEntryController::class, 'store'])->name('store')->middleware('check-organization-blocked');`. The fork route must add the same `'check-organization-blocked'` alias [VERIFIED: app/Http/Kernel.php:108]. That middleware reads `$request->route('organization')`, so **the fork route parameter must be named `{organization}`**.
- Formats [VERIFIED: app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php:80-86]: `'date_format:Y-m-d\TH:i:s\Z'` for `start` and `end`. `description` is `'max:5000'` (line 108). `billable` is `'required'` (line 91).
- `Request::createFrom` shares the JSON bag: `$request->setJson($from->json());` [VERIFIED: vendor/laravel/framework/src/Illuminate/Http/Request.php:524]. Give the copy fresh bags so per-item payloads never leak into each other or into the original request.
- Container wiring for Form Requests [VERIFIED: vendor/.../FormRequestServiceProvider.php:29-37]: `setContainer($app)->setRedirector(...)`, then `validateResolved()`.
- `PermissionStore` is request-scoped [VERIFIED: app/Providers/AppServiceProvider.php:100 `$this->app->scoped(PermissionStore::class, ...)`], so it is Octane-safe.

```php
// app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php  (sketch; names are recommendations)
final class CoreTimeEntryCreator
{
    /** @param array<string, mixed> $payload member_id, project_id, task_id, tags, billable, description, start, end */
    public function create(Request $base, Organization $organization, array $payload): TimeEntry
    {
        $request = TimeEntryStoreRequest::createFrom($base);
        // createFrom shares the json bag with $base: replace every input source with a fresh bag
        $request->setJson(new InputBag($payload));
        $request->request = new InputBag($payload);
        $request->query = new InputBag([]);
        $request->setContainer(app())->setRedirector(app(Redirector::class));
        $request->validateResolved();   // throws ValidationException (core messages)

        $resource = app(TimeEntryController::class)->store($organization, $request);
        $entry = $resource->resource;
        assert($entry instanceof TimeEntry);

        return $entry;
    }
}
```
Rules for the payload:
- `member_id` is always the session user's member in `$organization`, resolved server-side and never taken from the client.
- `end` is always non-null. A null `end` would start a running timer through the core lock path.
- `type` stays at its `'work'` default.
- `$this->organization` inside `TimeEntryStoreRequest` resolves through the copied route resolver. That only works because the fork route binds `{organization}`.

**Contract guard:** add a unit test that reflects `TimeEntryController::store` and asserts the parameter types `(Organization, TimeEntryStoreRequest)` and the return type. An upstream refactor then fails CI instead of production.

### Pattern 2: Link table and duplicate safety

```php
// app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php (sketch)
Schema::create('outlook_meeting_links', function (Blueprint $table): void {
    $table->uuid('id')->primary();
    $table->uuid('user_id');
    $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete()->cascadeOnUpdate();
    $table->string('graph_id', 255);                 // occurrence key, same type as outlook_meetings.graph_id
    $table->uuid('time_entry_id')->unique();
    $table->foreign('time_entry_id')->references('id')->on('time_entries')->cascadeOnDelete()->cascadeOnUpdate();
    // Optional snapshot for Phase 6 (out-of-sync) and the Phase 5 fallback key (DECISIONS-graph.md:43-47)
    $table->dateTime('meeting_starts_at')->nullable();
    $table->dateTime('meeting_ends_at')->nullable();
    $table->timestamps();
    $table->unique(['user_id', 'graph_id']);
});
```

Why a separate table and not a column:
- Disconnect purges meetings [VERIFIED: app/Microsoft365/Http/Controllers/MicrosoftAccountController.php:39 `OutlookMeeting::query()->where('user_id', '=', $user->getKey())->delete();`].
- The occurrence key is `graph_id` [VERIFIED: create_outlook_meetings_tables.php:44 `$table->unique(['user_id', 'graph_id']);`; docs/m365/DECISIONS-graph.md:43 "the occurrence key is the immutable Graph `id`"].
- Re-sync never rewrites row ids or non-listed columns [VERIFIED: OutlookMeetingSyncService.php:367-368 `// Explicit update list: never id, user_id, graph_id, dismissed_at or created_at` / `OutlookMeeting::query()->upsert($chunk, ['user_id', 'graph_id'], [`].
- A table keyed by `(user_id, graph_id)` therefore survives re-sync, purge and reconnect.

Per-meeting algorithm (inside `DB::transaction`):
1. Lock the meeting row: `OutlookMeeting::query()->where('user_id', $uid)->whereKey($id)->whereNull('gone_at')->lockForUpdate()->first()`. If there is no row, the result is `failed: meeting_not_found`. This is the same 404 semantics as `ownMeeting`, so it is no oracle.
2. Look up an existing link for `(uid, graph_id)`:
   - If the linked entry still has `user_id = uid`, return `status: existing` with `time_entry_id` (D-06 idempotent).
   - If the entry was reassigned to another user (see Pitfall 4), delete the stale link and continue.
3. Call `CoreTimeEntryCreator::create(...)`.
4. Insert the link, then set `dismissed_at = null` on the row (D-11).
5. Outside the transaction, catch `Illuminate\Database\UniqueConstraintViolationException` [VERIFIED: vendor/laravel/framework/src/Illuminate/Database/UniqueConstraintViolationException.php exists]. The rollback already removed that request's entry, so re-read the link and return `existing`.

This gives two independent guarantees:
- The row lock serializes concurrent requests for the same row.
- The unique index plus same-transaction insert rolls back any duplicate entry, even if the lock were bypassed.

### Pattern 3: Read side (hide converted meetings, expose linked ids for the icon)

Extend `OutlookMeetingController::index` [VERIFIED: OutlookMeetingController.php:51-60 current query]:
- Add `whereNotExists` over `outlook_meeting_links l JOIN time_entries te ON te.id = l.time_entry_id` where `l.user_id = outlook_meetings.user_id AND l.graph_id = outlook_meetings.graph_id AND te.user_id = l.user_id`.
- Add `additional['linked_time_entry_ids']`: ids of the user's links whose time entry overlaps `[start, end)`, joining on the entry's own `start`/`end`. This is entry-centric, so an entry the user dragged to another week still gets its icon there.
- When impersonating, return an empty list (the index already returns early, line 46).
- On the frontend, extend `OutlookMeetingsResponse` and `fetchMeetings` (`meetingsApi.ts`) to parse the new field, defaulting to `[]`.

### Pattern 4: Batch endpoint with per-meeting results (single = N of 1)

```
POST /m365/organizations/{organization}/meetings/time-entries
middleware: web, EnsureMicrosoftIsEnabled, auth:web, auth.session, verified, check-organization-blocked, throttle:30,1,m365-convert:
body: { meeting_ids: uuid[1..50] distinct, project_id: uuid (required, D-02), task_id?: uuid|null, tags?: uuid[],
        billable: bool, description?: string|null (single only), start?: Y-m-d\TH:i:s\Z, end?: … (single only; both or neither) }
200: { results: [ { meeting_id, status: 'created'|'existing'|'failed', time_entry_id: string|null,
                    error: { key: string, message: string } | null } ] }
```
- Multi mode (D-07): `description` comes from each meeting's own subject, read **server-side** from the row. Times are the row's `starts_at`/`ends_at` formatted UTC `Y-m-d\TH:i:s\Z`. A null subject becomes `''`. Core sets `description ?? ''` anyway (TimeEntryController.php:656).
- Map errors per item:

| Source | `key` |
|--------|-------|
| `ValidationException` | `validation`, with the first message (e.g. project not visible → core's `project_id` message) |
| `AuthorizationException` | `forbidden` |
| `ApiException` | `$e->getKey()` + `getTranslatedMessage()` (e.g. `overlapping_time_entry`) [VERIFIED: app/Exceptions/Api/ApiException.php getKey/getTranslatedMessage; OverlappingTimeEntryApiException KEY `'overlapping_time_entry'`] |
| Missing row | `meeting_not_found` |
| Existing link | `status: existing` |

  D-08 lists "already converted" as a reason: show `existing` in the result list as "Already converted" without counting it as a failure. Ask the owner if it should count as a failure (Open Question 2).
- Single mode (N=1) uses the same endpoint. If the one item failed, the UI shows the error inline in the form.
- **Mirror of a core shape:** `destroyMultiple` returns `{ success: [...], error: [...] }` [VERIFIED: TimeEntryController.php:978-981]. The richer per-item result is needed for D-08 reasons.

### Pattern 5: Mini form (`OutlookConvertForm.vue`)

- Host:
  - From the **detail panel**: the panel switches to a "form" mode inside the same `Popover` (`OutlookGhostDetail.vue`, which already has an `actions` slot and `canAct` gating).
  - From the **hover card**: the action closes the card and opens that meeting's panel in form mode. The hover card is supplemental and not focus-trapped (`OutlookMeetingHoverCard.vue` comment lines 7-10), so it should not host inputs.
  - From the **context menu** (first item, per the reserved comment at `OutlookMeetingContextItems.vue:118`): after the menu closes, open the panel in form mode, using the existing `afterMenuClosed` helper.
- Fields:
  - Project (required): `TimeTrackerProjectTaskDropdown variant="input"`.
  - Tags: `TagDropdown`.
  - Billable: `Select` with `useBillableRatesLock`. Watch `project_id` and set `billable = project.is_billable`, exactly as `TimeEntryCreateModal.vue` does in its project watch.
  - Description: `TextInput` prefilled with the subject, or empty when there is none.
  - Start/end: `TimeRangeFields`, single mode only. Times are shown in the user's timezone via `getLocalizedDayJs`, and sent as `getLocalizedDayJs(v).utc().format()` with seconds 0.
- Enter submits. Disable "Create" while saving and while there is no project.
- Last-used project (discretion, recommended):
  - Store it in `localStorage` under `solidtime:m365-last-meeting-project:<organizationId>`. Write it on a successful conversion. Ignore it on read if the project is missing or archived in `useProjectsQuery`.
  - Fallback: `getLastWorkTimeEntry(useTimeEntriesInfiniteQuery pages)?.project_id`. Load it lazily when the form opens, because the calendar page does not mount `TimeTracker` (that only happens on Dashboard and Time).
  - The localStorage convention matches `solidtime:m365-show-dismissed` [VERIFIED: useOutlookMeetings.ts:47].
- Copy: add keys to `lang/en/microsoft365.php` **and** `lang/es/microsoft365.php`, under `calendar`. They are served automatically through `calendarLabels()` (ShareMicrosoftInertiaData.php:122-134). Then extend `OutlookCalendarLabels` in `resources/js/m365/types.ts`. `MicrosoftLangTest` enforces en/es key parity and non-empty values.

### Pattern 6: Multi-select

- State: add `selectedIds: Ref<string[]>`, `selectionAnchorId`, `toggleSelect(id)`, `selectRange(id)`, `clearSelection()` and `convert(ids, fields)` to `OutlookMeetingsContext` (provided with `OUTLOOK_MEETINGS_KEY`). It must be shared because there is one `OutlookGhostLayer` per day column.
- Click interception: on the lane root (`.m365-lane`), use `@click.capture`. If `ctrlKey || metaKey || shiftKey`, call `preventDefault()` and `stopPropagation()` in the capture phase. The reka `PopoverTrigger` click listener on the block then never runs. Then toggle the meeting, or select a range by chronological order of the visible meetings. A plain click keeps the current behaviour (opens the panel) and clears the selection.
- Ranges: the list is already ordered by `starts_at, ends_at, graph_id` (OutlookMeetingController.php:57-59).
- Selected look: `data-selected` attribute plus a ring, consistent with `data-[panel-open]:ring-2`.
- Floating bar: `OutlookSelectionBar.vue` uses `<Teleport to="body">`, fixed bottom-center. Mount it inside an already-rendered fork component such as `OutlookCalendarControls` (toolbar-extra slot), so no new core touch is needed. "Assign N meetings" opens the form in multi mode in a popover anchored to the bar. After the response, show a result list: created / already converted / failed with reason. Remove created ids from the cache, and keep failed ids selected (D-08).
- Clearing: Escape (document `keydown`) or a `pointerdown` outside any `[data-ghost-id]`, the bar and its popover content.
- Keyboard: `el.click()` from the existing Enter/Space handlers drops modifier keys. Add a keyboard path, for example Shift+Space or Ctrl+Space toggles selection on a focused block.
- Dismissed meetings: only selectable while "Show dismissed" is on (they are not rendered otherwise, D-11).

### Pattern 7: Keep the lane and icons fresh after core edits and deletes

The core mutations only invalidate `['timeEntries']` and `['goals']` [VERIFIED: resources/js/utils/useTimeEntriesMutations.ts onSuccess]. In `useOutlookMeetings`:
- Subscribe to `queryClient.getQueryCache()`.
- When a query whose `queryKey[0] === 'timeEntries'` finishes a successful fetch, invalidate `['m365','meetings']`.
- Debounce this (about 500 ms). The read route is throttled at `throttle:60,1,m365-read:` (routes/microsoft365.php), and drags fire many updates.

After a conversion, invalidate `['timeEntries']`, `['goals']` and `['m365','meetings']` (the same keys core uses on create). Before the request, drop the converted meeting from the cache (optimistic, like `changeDismissal`, useOutlookMeetings.ts:442-509). Restore it on failure.

### Pattern 8: Outlook icon (ledgered core slot chain)

The icon cannot be rendered by the fork alone. `FullCalendarEventContent` is rendered only by `CalendarDayColumn.vue:138`, which is rendered only by `TimeEntryCalendar.vue:697` [VERIFIED: grep]. The minimal, merge-friendly chain:
1. `FullCalendarEventContent.vue`: `<slot name="title-extra" />` after the title `<span>`. Nothing changes without slot content.
2. `CalendarDayColumn.vue`: `<template v-if="$slots['event-extra']" #title-extra><slot name="event-extra" :time-entry="dayEvent.event.timeEntry" /></template>` on the `FullCalendarEventContent` element. It is already a ledgered file (overlay slot).
3. `TimeEntryCalendar.vue`: forward `event-extra` to each `CalendarDayColumn`, the same pattern as the existing `day-overlay` forwarding (lines 783-794).
4. `Calendar.vue`: `<template v-if="outlook.labels.value" #event-extra="{ timeEntry }"><OutlookEntryBadge :time-entry-id="timeEntry.id" /></template>`.

`OutlookEntryBadge` reads `linkedTimeEntryIds` from the injected context and renders a 12px icon with `aria-hidden` and a `title` such as "Created from an Outlook meeting". `dayEvent.event.timeEntry` exists [VERIFIED: resources/js/packages/ui/src/FullCalendar/calendarTypes.ts:9-11 `export interface CalendarEvent { id: string; timeEntry: TimeEntry;`].

Zero-core alternative: generate a `<style>` with `.fc-event[data-event-id="<uuid>"]::after { ... }` from the linked ids. The `data-event-id` attribute exists (CalendarDayColumn template). It is less accessible and harder to test, so use it only if the owner rejects any new core file.

### Anti-Patterns to Avoid
- **Frontend orchestration (core `POST /api/v1/.../time-entries` and then a fork "link" call):** two requests, not atomic. A double click creates two entries before either link exists, and a crash between the calls leaves an unlinked duplicate. This breaks D-06.
- **Inserting `TimeEntry` rows directly in the fork:** skips permissions, the overlap opt-in, billable lock, `billable_rate` and the recalc jobs. This breaks D-10.
- **Copying the ~40 lines of `storeTimeEntry` into the fork:** the rules drift silently when upstream changes them.
- **Extracting `storeTimeEntry` into a core service:** edits `TimeEntryController.php`, an upstream hot file, and creates merge conflicts every release.
- **Eloquent `deleted` observer on `TimeEntry` to clear links:** core bulk deletes bypass it (Pitfall 1).
- **Link column on `outlook_meetings`:** purged on disconnect (Pitfall 2).
- **Accepting `member_id`, subject or user id from the client:** the fork derives all of them.
- **Sub-requests through the HTTP kernel** (`app()->handle(Request::create(...))`): needs Passport `auth:api`, mutates the container request and is risky under Octane.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Entry creation rules | Own validation, permission, overlap or billable code | `TimeEntryStoreRequest` + `TimeEntryController::store()` | Single source of the D-10 rules |
| Duplicate prevention | App-level "check then insert" | DB `UNIQUE(user_id, graph_id)` + same-transaction insert + `lockForUpdate` | Races and Octane workers |
| Re-surface on delete | Observers or scheduled cleanup | FK `ON DELETE CASCADE` | Bulk deletes in core |
| Project/task/tag pickers | New comboboxes | `TimeTrackerProjectTaskDropdown`, `TagDropdown` | Same UX, create-project/tag built in |
| Billable default and lock | Custom logic | `project.is_billable` watch + `useBillableRatesLock`; server forces false via `canUseBillableRates` | Matches core |
| Recalculating project totals | Manual `spent_time` updates | Core already dispatches `RecalculateSpentTimeFor*` | Jobs are after-commit |
| Impersonation detection | New session checks | `GraphAccessGuard::blocked()` | Stateless, fails closed (GraphAccessGuard.php) |

**Key insight:** In this domain every rule already exists in core or in Phase 3 code. The fork's only new logic is the link row and the per-meeting loop.

## Common Pitfalls

### Pitfall 1: Core deletes bypass Eloquent
**What goes wrong:** The meeting never comes back after an org deletion, a member removal or a placeholder merge.
**Why:** `TimeEntry::query()->whereBelongsTo($organization, 'organization')->delete();` [VERIFIED: app/Service/DeletionService.php:60]. `MemberService.php:102` also uses a query-builder delete.
**How to avoid:** Use a DB-level `cascadeOnDelete` FK from the link to `time_entries`.
**Warning signs:** Re-surfacing tests that only use `DELETE /time-entries/{id}`. Add `destroyMultiple` and member-removal cases.

### Pitfall 2: Disconnect purges `outlook_meetings`
**What goes wrong:** After Disconnect and Reconnect, all converted meetings show again and can be converted twice.
**Why:** MicrosoftAccountController.php:39 deletes all meeting rows (Phase 3 D-21).
**How to avoid:** Use a link table keyed by `(user_id, graph_id)` and do not delete links on disconnect (see Open Question 1).

### Pitfall 3: `createFrom` shares the JSON bag
**What goes wrong:** In a batch loop, every core request validates the last payload, or the original request input is overwritten.
**Why:** `$request->setJson($from->json());` (Request.php:524).
**How to avoid:** Use fresh `InputBag`s for json, request and query (Pattern 1). Add a unit test that converts two meetings with different times in one batch.

### Pitfall 4: Entries reassigned to another user
**What goes wrong:** The user's meeting stays hidden although the entry now belongs to someone else.
**Why:** `assignOrganizationEntitiesToDifferentMember` bulk-updates `user_id`/`member_id` [VERIFIED: app/Service/MemberService.php:170-176]. `assignOrganizationEntitiesToDifferentUser` does the same (UserService.php:79-84). Admins can also change `member_id` through update.
**How to avoid:** The hide rule joins `te.user_id = l.user_id`. Conversion deletes a stale link before creating a new entry.

### Pitfall 5: Popover-in-popover and modal-in-popover
**What goes wrong:** Opening the project dropdown, or "Create project" (`ProjectCreateModal`), inside the panel closes the panel.
**Why:** `Dropdown.vue` uses the same reka `Popover`. Nested reka dismissable layers normally do not dismiss their parent [ASSUMED], but a `DialogModal` opened from inside may count as an outside interaction [ASSUMED].
**How to avoid:** Write an e2e check for "pick project, pick tag, create project from the form". If the panel closes, keep the panel open while a child layer is open (handle `@interact-outside` / `@pointer-down-outside` with `preventDefault` when the target is inside `[data-reka-popper-content-wrapper]` or a dialog).

### Pitfall 6: Click with modifiers still toggles the panel
**What goes wrong:** Ctrl-click opens the panel and selects at the same time.
**Why:** `PopoverTrigger as-child` merges its click listener onto the block. A `.stop` on the block does not stop other listeners on the same element.
**How to avoid:** Use a capture-phase handler on an ancestor (`.m365-lane`) with `stopPropagation()`. Test it in Vitest by dispatching `click` with `ctrlKey: true`.

### Pitfall 7: Throttle exhaustion from refetch loops
**What goes wrong:** 429s on `GET /m365/meetings` while dragging entries.
**How to avoid:** Debounce the invalidation (Pattern 7) and refetch only on success events.

### Pitfall 8: Timezone and seconds
**What goes wrong:** 422 from core (`date_format:Y-m-d\TH:i:s\Z`), or entries shifted by the offset.
**How to avoid:** Send UTC with a `Z` suffix and seconds. Meetings are stored UTC (`starts_at`, cast datetime). Format server-side with `->utc()->format('Y-m-d\TH:i:s\Z')` (same as `OutlookMeetingResource::FORMAT`).

### Pitfall 9: Running timer by accident
**What goes wrong:** A missing `end` creates a running entry and takes the core lock path.
**How to avoid:** The fork request requires both `start` and `end` in single mode (`after_or_equal:start`). Multi mode always uses the meeting times.

### Pitfall 10: Organization context
**What goes wrong:** The entry lands in a different org than the one the calendar shows (the user switched org in another tab).
**How to avoid:** The URL carries `{organization}` from `getCurrentOrganizationId()`. Core `checkPermission` already rejects non-members.
**Multi-org note:** the link is per user (D-06), so a meeting converted in org A is also hidden in org B.

### Pitfall 11: Graph id instability
**What goes wrong:** If Outlook issues a new immutable id for an occurrence, a new row appears unlinked, so the suggestion can be converted again.
**How to avoid:** Out of scope (Phase 6 out-of-sync). Store the `meeting_starts_at`/`meeting_ends_at` snapshot, and optionally `series_master_id` + `original_start` (the documented fallback key, DECISIONS-graph.md:43-47), so Phase 5/6 can detect it.

## Code Examples

### Fork route (follows the existing group in app/Microsoft365/routes/microsoft365.php)
```php
// Inside the existing ->prefix('m365') group (web, EnsureMicrosoftIsEnabled, auth:web, auth.session, verified)
Route::post('/organizations/{organization}/meetings/time-entries', [MeetingConversionController::class, 'store'])
    ->whereUuid('organization')
    ->middleware(['check-organization-blocked', 'throttle:30,1,m365-convert:'])
    ->name('microsoft.meetings.convert');
```
Add the URL to the calendar prop (`ShareMicrosoftInertiaData::calendar()` `urls`) as a template the client fills, or let the client build it from `urls.meetings`. The prop already carries URLs only (ShareMicrosoftInertiaData.php:85-88).

### Per-item loop (sketch)
```php
foreach ($request->meetingIds() as $id) {
    try {
        $results[] = DB::transaction(fn (): array => $this->convertOne($request, $organization, $member, $user, $id));
    } catch (UniqueConstraintViolationException) {
        $results[] = $this->existingResult($user, $id);          // concurrent winner already linked
    } catch (ValidationException $e) {
        $results[] = $this->failed($id, 'validation', (string) collect($e->errors())->flatten()->first());
    } catch (AuthorizationException) {
        $results[] = $this->failed($id, 'forbidden', __('microsoft365.calendar.convert_forbidden'));
    } catch (ApiException $e) {
        $results[] = $this->failed($id, $e->getKey(), $e->getTranslatedMessage());
    }
}
```
Impersonation: `if ($this->access->blocked()) throw (new ModelNotFoundException)->setModel(OutlookMeeting::class);` before anything else, mirroring `ownMeeting()` (OutlookMeetingController.php:128-131).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 3: meetings never become entries (`OutlookMeetingSyncService` doc: "never touches time entries") | Explicit user action converts through core | Phase 4 | The privacy test snapshot for "sync never changes time entries" must still pass; conversion is a separate endpoint |
| Context menu slot "Reserved for Phase 4" | First item "Create time entry" | Phase 4 | Update `OutlookMeetingContextItems.test.ts` expectations |

**Deprecated/outdated:** the e2e assertion "no create flow" in `e2e/outlook-ghosts.spec.ts` (ledger text: "reachability beside entries, totals, no create flow"). Clicking a ghost must still never open the *core* create dialog. Keep that assertion and add the conversion specs separately.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Nested reka popovers (project/tag dropdowns) do not dismiss the parent panel; a `DialogModal` opened from inside might | Pitfall 5 | Form closes while picking: needs outside-interaction guards |
| A2 | Calling `TimeEntryController::store()` in-process with a manually built FormRequest behaves identically to the HTTP path (no hidden middleware other than `check-organization-blocked`, `auth:api`, `verified`) | Pattern 1 | A core rule enforced in middleware would be skipped. Mitigation: feature tests compare against the core endpoint for the same inputs |
| A3 | The owner accepts keeping links after Microsoft disconnect (they are entry metadata, not calendar cache) | Pattern 2 / Open Q1 | If links must be purged too, converted meetings re-surface after reconnect |
| A4 | Postgres row lock + unique index is enough; no `Cache::lock` needed | Pattern 2 | Low: the unique index alone prevents duplicates |

## Open Questions

1. **Do links survive "Disconnect Microsoft"?**
   - What we know: Phase 3 D-21 purges meetings, dismissals and windows on disconnect. Links stored on meeting rows would vanish.
   - What's unclear: whether the owner considers the opaque `graph_id` link "Outlook data that must not outlive the connection".
   - Recommendation: keep links. They hold no subject and are deleted with the entry or the user, and they prevent double conversions after a reconnect. Confirm with the owner as a functional point.
2. **Is "already converted" a failure in the multi-assign result?** D-06 says single repeats return the existing entry, while D-08 lists "already converted" as a failure reason. Recommendation: return `existing` and show it as "Already converted" in a neutral style, deselected like successes.
3. **Hover-card action:** the hover card is pointer-only and transient. Recommendation: the button there opens the panel in form mode, rather than hosting the form in the card.
4. **UI-SPEC:** `workflow.ui_phase` is true. The mini form, floating bar and badge are new visual surfaces, so the orchestrator may want `/gsd-ui-phase 4` before planning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | Vitest, vue-tsc, eslint, prettier | ✓ | v24.13.1 / 11.8.0 | — |
| vitest, vue-tsc, playwright binaries | JS gates | ✓ (`node_modules/.bin`) | vitest ^4.1.4, @playwright/test ^1.60.0 | — |
| PHP 8.3 (portable) | Pint, PHPStan locally | ✓ at `C:/Users/JuanHerrero/.local/solidtime-php-toolchain/phprun/php.exe` | 8.3.36 | — |
| System PHP / PostgreSQL / Docker | PHPUnit, Playwright full stack | ✗ (no `php` on PATH; `docker info` empty) | — | GitHub CI on push to `feature/m365-integration` (Phase 3/3.1 precedent: PHPUnit on Postgres 15/16/17, Playwright) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** PHPUnit and Playwright run only in CI, using the Phase 3.1 CI-gate protocol (`export PHP_TOOLCHAIN_DIR=...; PHP_BIN=...`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (CI only) · Vitest 4 + happy-dom + @vue/test-utils · Playwright 1.60+ (CI; chromium locally if the app runs) |
| Config file | `phpunit.xml`, `vitest.config.ts` (setup `resources/js/test-setup.ts`, include `resources/js/**/*.{test,spec}.{ts,tsx}`), `playwright.config.ts` |
| Quick run command | `npx vitest run resources/js/m365 resources/js/packages/ui/src/FullCalendar` · PHP: `"$PHP_BIN" vendor/bin/pint --test <files>` and `"$PHP_BIN" vendor/bin/phpstan analyse <files>` |
| Full suite command | `npm run test:unit && npm run type-check && npx tsc --noEmit && npm run lint && npm run format:check`; CI: PHPUnit (`--filter Microsoft365`), PHPStan, Pint, Playwright workflows green for HEAD |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASGN-01 | Convert creates entry with the meeting's start/end, project, task, tags, billable, description; dismissed meeting conversion clears `dismissed_at` | PHP feature | CI `--filter OutlookMeetingConversionTest` | ❌ Wave 0 |
| ASGN-01 | Action present in hover card, panel and context menu (gated by `canAct`); form prefill (subject, times, last project, billable from project); Enter submits | Vitest | `npx vitest run resources/js/m365/calendar/OutlookConvertForm.test.ts OutlookGhostDetail.test.ts OutlookMeetingContextItems.test.ts OutlookMeetingHoverCard.test.ts` | ❌ / ✅ extend |
| ASGN-02 | Employee without project visibility → failed `validation`; no `time-entries:create:own` → `forbidden`; org `prevent_overlapping_time_entries` → `overlapping_time_entry`, and the same entry without the flag succeeds; billable forced false when `BillingContract` disallows; `RecalculateSpentTimeForProject`/`Task` dispatched (`Queue::fake`); `billable_rate` set; org blocked → error | PHP feature | `--filter OutlookMeetingConversionTest` | ❌ Wave 0 |
| ASGN-02 | Contract: `TimeEntryController::store(Organization, TimeEntryStoreRequest): JsonResource` signature unchanged | PHP unit (reflection) | `--filter CoreTimeEntryCreatorContractTest` | ❌ Wave 0 |
| ASGN-03 | Repeat request returns `existing` with the same id; entry count stays 1; direct duplicate link insert raises the unique violation; index excludes converted meeting; link survives a re-sync (fixture replay via `InteractsWithGraphFixtures`) and a disconnect/reconnect | PHP feature | `--filter OutlookMeetingLinkLifecycleTest` | ❌ Wave 0 |
| ASGN-03 | Double submit sends one request (button disabled while saving); optimistic removal and rollback on failure | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts` | ✅ extend |
| ASGN-04 | Batch of 3: 1 created, 1 foreign/gone id → `meeting_not_found`, 1 already converted → `existing`; per-item times and subjects come from each row; ids max 50, distinct | PHP feature | `--filter OutlookMeetingConversionTest` | ❌ Wave 0 |
| ASGN-04 | Ctrl/Cmd/Shift click selects without opening the panel; range by start order; Escape and outside click clear; bar shows N; results keep failed ones selected | Vitest | `npx vitest run resources/js/m365/calendar/OutlookGhostLayer.test.ts OutlookSelectionBar.test.ts` | ✅ extend / ❌ |
| ASGN-05 | Delete via `DELETE /api/v1/.../time-entries/{id}`, `DELETE /time-entries` (bulk), member removal and org deletion all remove the link and re-surface the meeting; editing the entry's times keeps it hidden; reassigned entry re-surfaces | PHP feature | `--filter OutlookMeetingLinkLifecycleTest` | ❌ Wave 0 |
| ASGN-05 | Meetings refetch after a `timeEntries` fetch (debounced); badge renders only for linked ids | Vitest | `npx vitest run resources/js/m365/calendar/useOutlookMeetings.test.ts OutlookEntryBadge.test.ts` | ❌ / ✅ |
| D-13 | Impersonation → 404 and no entry created; foreign meeting id → `meeting_not_found`; `OutlookMeetingLink` not Auditable and not in Filament; `member_id` from the client ignored | PHP feature | `--filter OutlookMeetingPrivacyTest` (extend) | ✅ extend |
| D-12 | Fork route not under `api/` (openapi untouched); core slot chain renders identically without slot content | PHP route test + Vitest | `--filter OutlookMeetingConversionTest`; `npx vitest run resources/js/packages/ui/src/FullCalendar` | ❌ |
| UI e2e | Mini form from panel/menu; Ctrl-click multi-select + bar; nested dropdowns keep the panel open (A1) | Playwright | `npx playwright test e2e/outlook-convert.spec.ts --project=chromium` (CI) | ❌ Wave 0 |

**E2E note:** CI runs with the integration off. Ghosts come from `window.__TEST_SET_OUTLOOK_MEETINGS__`, and in that mode `canAct` is false, so the actions are hidden [VERIFIED: useOutlookMeetings.ts:424 `const canAct = computed(() => calendar.value !== null && testMeetings.value === null);`]. To test the UI flow in the browser, extend the hook with an optional third argument, e.g. `{ actions: true, convertUrl }`, that enables actions in test mode. Fulfil the conversion with `page.route()`. In the route handler, create a real entry through `createTimeEntryViaApi(ctx, …)` (e2e/utils/api.ts:408) so the calendar shows it, and inject the linked ids for the badge. Server behaviour stays covered by PHPUnit. Without this hook extension, the browser checks for the new actions are manual UAT only.

### Sampling Rate
- **Per task commit:** `npx vitest run <touched m365 files>` + `npx prettier --check <files>`; PHP tasks: Pint + PHPStan on the touched files with `$PHP_BIN`.
- **Per wave merge:** local JS full suite + push, then the PHPUnit / PHPStan / Pint CI runs for the sha.
- **Phase gate:** all CI workflows green (incl. Playwright) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/Feature/Microsoft365/OutlookMeetingConversionTest.php`: ASGN-01/02/04, route not under api/
- [ ] `tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php`: ASGN-03/05 (delete paths, re-sync, disconnect, reassignment)
- [ ] `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php`: core signature guard
- [ ] `resources/js/m365/calendar/OutlookConvertForm.test.ts`, `OutlookSelectionBar.test.ts`, `OutlookEntryBadge.test.ts`, `conversionApi.test.ts`, `lastProject.test.ts`
- [ ] `e2e/outlook-convert.spec.ts` + test-hook extension in `useOutlookMeetings.ts`
- [ ] Shared fixture helper `meeting(User, graphId, overrides)` already exists inline in `OutlookMeetingDismissTest.php` (lines 59-75). Copy it or move it into `Support/` for the new tests.

## Security Domain

`security_enforcement: true`, ASVS level 1 [VERIFIED: .planning/config.json].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | `auth:web`, `auth.session`, `verified` route stack (same as dismiss) |
| V3 Session Management | yes (inherited) | Web session + XSRF (`PreventRequestForgery` in the web group, Kernel.php:71) |
| V4 Access Control | yes | Meeting lookup scoped to the session user (404 for foreign ids); core `checkPermission` for org membership and create permission; core project visibility rule; `member_id` derived server-side; impersonation blocked via `GraphAccessGuard` |
| V5 Input Validation | yes | `MeetingConversionRequest` (uuid ids, max 50, distinct, booleans, date formats) + core `TimeEntryStoreRequest` |
| V6 Cryptography | no | — |
| V7 Errors/Logging | yes | Per-item errors use core translated messages; never log subjects (Phase 3 D-15) |
| V11 Business Logic | yes | Unique link + transaction against duplicate creation; throttle `m365-convert:` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR on meeting ids (convert someone else's meeting) | Information disclosure / Tampering | Query `where user_id = session user`; unknown and foreign ids get the same `meeting_not_found` |
| Creating entries for another member or org | Elevation of privilege | `member_id` set server-side; org from route bound + core permission check |
| Duplicate entries via races or double clicks | Tampering (integrity) | `UNIQUE(user_id, graph_id)`, same-transaction insert, row lock |
| Admin impersonation converting a user's meetings | Elevation of privilege | `GraphAccessGuard::blocked()` → 404 before any work |
| Batch abuse | DoS | Max 50 ids, throttle 30/min |
| XSS via meeting subject in description | Tampering | Vue text interpolation only (existing rule); core renders descriptions as text |
| Subject leakage | Information disclosure | Subject goes only into the user's own entry; `OutlookMeetingLink` stores no subject and is not audited |

## Sources

### Primary (HIGH confidence, read this session)
- `app/Http/Controllers/Api/V1/TimeEntryController.php` (lines 1-110, 600-985): create/update/delete rules
- `app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php`: validation, project visibility
- `app/Http/Controllers/Api/V1/Controller.php`, `app/Http/Controllers/Controller.php` (member/user), `app/Service/PermissionStore.php`, `app/Providers/AppServiceProvider.php:79,100,131`
- `app/Jobs/RecalculateSpentTimeForProject.php`, `RecalculateSpentTimeForTask.php`; `config/queue.php`
- `app/Service/DeletionService.php:60`, `app/Service/MemberService.php:102,160-176`, `app/Service/UserService.php:75-84`
- `app/Microsoft365/**` (controllers, models, migrations, sync service, guard, routes, sharing middleware)
- `resources/js/m365/calendar/*` (layer, detail, hover card, context items, composable, api), `resources/js/m365/types.ts`
- `resources/js/Pages/Calendar.vue`, `resources/js/packages/ui/src/FullCalendar/{CalendarDayColumn,FullCalendarEventContent,TimeEntryCalendar,calendarTypes}`, `resources/js/packages/ui/src/TimeEntry/TimeEntryCreateModal.vue`, `TimeRangeFields.vue`, `TimeTrackerProjectTaskDropdown.vue`
- `vendor/laravel/framework` `Request::createFrom`, `FormRequestServiceProvider`, `UniqueConstraintViolationException`
- `docs/m365/TOUCHED-CORE-FILES.md`, `docs/m365/DECISIONS-graph.md`
- `e2e/outlook-ghosts.spec.ts`, `playwright/fixtures.ts`, `e2e/utils/api.ts`, `tests/Feature/Microsoft365/*`

### Secondary / Tertiary
- None; no web sources were needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Nothing new; versions read from the lock and package files.
- Architecture: HIGH for the server path and link design (every dependency read in code). MEDIUM for the in-process FormRequest call (A2), mitigated by feature tests.
- Pitfalls: HIGH for the delete, disconnect and createFrom pitfalls (verified in code). MEDIUM for nested popover behaviour (A1).

**Research date:** 2026-11-17
**Valid until:** 2026-12-17, or earlier on an upstream merge touching `TimeEntryController`.
