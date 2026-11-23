# Phase 6: Out-of-Sync Detection - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 30 (new + modified)
**Analogs found:** 28 / 30

All paths are tracked fork source under `app/Microsoft365/`, `resources/js/m365/`, `tests/`, `e2e/`, `lang/`, `docs/deploy/`. No mirror paths.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `app/Microsoft365/database/migrations/2026_11_23_000001_add_sync_state_to_outlook_meeting_links.php` (new) | migration | schema + backfill | `app/Microsoft365/database/migrations/2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php` | exact |
| partial unique index (inside the migration) | migration | schema | `database/migrations/2014_10_12_000000_create_users_table.php:38-39` | exact |
| `app/Microsoft365/OutOfSync/OutOfSyncRules.php` (new) | utility (pure) | transform | `app/Microsoft365/Suggestions/ProjectSuggestionEngine.php` / `SeriesAssignmentResolver.php` | role-match |
| `app/Microsoft365/OutOfSync/Observation.php`, `Decision.php` (new) | model (value) | transform | `app/Microsoft365/Suggestions/Assignment.php:1-40` (final readonly + toArray) | exact |
| `app/Microsoft365/OutOfSync/LinkedSightings.php` (new) | utility | transform | `app/Microsoft365/Graph/OutlookMeetingEligibility.php` + `OutlookMeetingSyncService::buildRow/parseGraphUtc` | role-match |
| `app/Microsoft365/OutOfSync/OutOfSyncScope.php` (new) | service (query) | CRUD read | `OutlookMeetingController::linkedTimeEntryIds` (:179-206) | role-match |
| `app/Microsoft365/OutOfSync/OutOfSyncApplier.php` (new) | service | CRUD write, locked | `MeetingConversionController::store/convertOne` (:84-135) | role-match |
| `app/Microsoft365/TimeEntries/CoreTimeEntryUpdater.php` (new) | service | request-response (in-process core) | `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` | exact twin |
| `app/Microsoft365/Graph/GraphCalendarClient.php` (+ `event()`) | service | request-response (HTTP) | same file `calendarView()` :44-135, `get()` :173 | exact |
| `app/Microsoft365/Graph/OutlookMeetingSyncService.php` (detector hook) | service | batch | same file `traverse()` :109-176 | exact (self) |
| `app/Microsoft365/Jobs/CheckOutOfSyncForUser.php` (new) | job | batch / queue | none in fork; sync lock pattern `OutlookMeetingSyncService::sync` :43-75 | partial |
| `app/Microsoft365/Console/CheckOutOfSyncCommand.php` (new) | command | batch fan-out | `app/Microsoft365/Console/MicrosoftCheckCommand.php` | role-match |
| `app/Microsoft365/Microsoft365ServiceProvider.php` (schedule + command) | config/provider | - | same file :32-43 | exact (self) |
| `app/Microsoft365/Http/Controllers/OutOfSyncController.php` (new: keep/adjust/move-entry) | controller | request-response | `OutlookMeetingController::dismiss/restore/ownMeeting` (:224-268), `OutlookSeriesController` | exact |
| `app/Microsoft365/routes/microsoft365.php` (new routes) | route | - | same file :35-59 | exact (self) |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php` (index: `out_of_sync`, `previous_entry`, D-03 visibility) | controller | read | same file :52-66, :87-94, :143-150 | exact (self) |
| `app/Microsoft365/Http/Resources/OutlookMeetingResource.php` (+ `previous_entry`) | resource | transform | same file | exact (self) |
| `app/Microsoft365/Models/OutlookMeetingLink.php` (casts for new cols) | model | - | same file | exact (self) |
| `config/microsoft365.php` (graph block constants) | config | - | same file `graph` block | exact (self) |
| `resources/js/m365/calendar/OutlookEntryBadge.vue` (marker + popover) | component | event-driven | same file (33 lines) + popover/menu in `OutlookGhostDetail.vue` | exact (self) |
| `resources/js/m365/calendar/OutlookCalendarControls.vue` (counter) | component | event-driven | same file :161-298 (Button use) | exact (self) |
| `resources/js/m365/calendar/outOfSync.ts` (new pure helpers) | utility | transform | helpers exported from `useOutlookMeetings.ts` (`weekBucket` :158) | role-match |
| `resources/js/m365/calendar/useOutlookMeetings.ts` (outOfSync list, keep/adjust/moveEntry, jump, hook) | hook | request-response | same file: `syncMutation` :316-324, conversion invalidation :882-884, hook options :178-183 | exact (self) |
| `resources/js/m365/calendar/types.ts` (OutOfSyncItem, previous_entry) | model (types) | - | same file :257-260 (`linked_time_entry_ids` defensive parse) | exact (self) |
| `resources/js/m365/calendar/OutlookGhostDetail.vue`, `OutlookMeetingContextItems.vue` ("Move my entry here") | component | event-driven | `OutlookGhostDetail.vue:283-288` (emit('create') SecondaryButton) | exact (self) |
| `lang/en/microsoft365.php`, `lang/es/microsoft365.php` | config (i18n) | - | `'calendar' =>` block (en :23) | exact |
| `docs/deploy/dokploy-compose.fork.yml` | config | - | app env :36-42 copied into `scheduler` (:86) and `queue` (:134); image tags :16/:87/:135 | exact |
| `tests/Unit/Microsoft365/OutOfSyncRulesTest.php` | test | - | `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php` | role-match |
| `tests/Unit/Microsoft365/CoreTimeEntryUpdaterContractTest.php` | test | - | `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` | exact |
| `tests/Feature/Microsoft365/OutOfSync*Test.php` (applier, job, endpoints, read) | test | - | `OutlookMeetingLinkLifecycleTest.php`, `OutlookMeetingSyncTest.php`, `OutlookSeriesAssignmentTest.php`, support `Support/InteractsWithMicrosoft365.php` | exact |
| `tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php` (route count :751) | test | - | self | exact |
| `resources/js/m365/calendar/*.test.ts` (badge, controls, outOfSync) | test | - | `OutlookEntryBadge.test.ts`, `OutlookCalendarControls.test.ts` | exact |
| `e2e/outlook-out-of-sync.spec.ts` | test | - | `e2e/outlook-convert.spec.ts` (page.route :207-230, header comment :11-16) | exact |

## Pattern Assignments

### Migration `2026_11_23_000001_add_sync_state_to_outlook_meeting_links.php`
**Analog:** `app/Microsoft365/database/migrations/2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php` (whole file, 69 lines). Copy: `declare(strict_types=1)`, anonymous `return new class extends Migration`, a docblock per column explaining why, `Schema::table('outlook_meeting_links', ...)`, `$this->backfill()` at end of `up()`, public `backfill()` with raw SQL, explicit `down()`:
```php
public function up(): void
{
    Schema::table('outlook_meeting_links', function (Blueprint $table): void {
        $table->string('series_master_id', 255)->nullable();
        ...
    });
    $this->backfill();
}
public function backfill(): void
{
    DB::statement(<<<'SQL'
        UPDATE outlook_meeting_links AS l
        SET series_master_id = m.series_master_id
        FROM outlook_meetings AS m
        WHERE m.user_id = l.user_id AND m.graph_id = l.graph_id
          AND m.series_master_id IS NOT NULL AND l.series_master_id IS NULL
        SQL);
}
```
Partial unique (replace the plain unique on `(user_id, graph_id)` from `2026_11_17_000001_create_outlook_meeting_links_table.php`): `$table->uniqueIndex([...])->where('released_at IS NULL');` as core `create_users_table.php:38-39` `$table->uniqueIndex('email')->where('is_placeholder = false');` (tpetry Blueprint). Backfill only `WHERE meeting_starts_at IS NULL`, never overwrite a snapshot (RESEARCH Pattern 2). Document in `down()` docblock that restoring the plain unique fails with two links per occurrence.

### `OutOfSync/Observation.php`, `Decision.php`
**Analog:** `app/Microsoft365/Suggestions/Assignment.php:1-40`: `final readonly class`, constructor promotion, `CarbonImmutable` times, `toArray()` with an array-shape `@return` docblock. Namespace `App\Microsoft365\OutOfSync`.

### `OutOfSync/OutOfSyncRules.php` (pure)
**Analog:** `Suggestions/ProjectSuggestionEngine.php` (pure engine, no DB). `decide(Observation, linkState, entry, CarbonImmutable $now): Decision`, no `now()` inside, compare UTC `Y-m-d H:i:s` strings. Sketch in RESEARCH "Pure rules (sketch)".

### `OutOfSync/OutOfSyncApplier.php`
**Analog:** `app/Microsoft365/Http/Controllers/MeetingConversionController.php:84-135`. Per-link `DB::transaction` with the catch outside, row lock and re-read:
```php
try {
    $results[] = DB::transaction(fn (): array => $this->convertOne(...));
} catch (UniqueConstraintViolationException) { ... }
  catch (ValidationException $exception) { ... }
  catch (AuthorizationException) { ... }
  catch (ApiException $exception) { ... }
...
$meeting = OutlookMeeting::query()
    ->where('user_id', '=', $user->getKey())
    ->whereKey($meetingId)->whereNull('gone_at')
    ->lockForUpdate()->first();
```
On ApiException (overlap) / blocked org during auto-adjust: flag instead of failing (Pitfall 6). Never log subject/ids (Phase 3 D-15 comment at :86-88).

### `TimeEntries/CoreTimeEntryUpdater.php`
**Analog:** `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` (whole file, 58 lines). Copy imports :7-17 (swap `TimeEntryStoreRequest` for `TimeEntryUpdateRequest`), the docblock style :19-29 ("Not final on purpose: tests bind a double"), `@throws` list :32-38, and the bag reset :44-51:
```php
$request = TimeEntryStoreRequest::createFrom($base);
$request->setJson(new InputBag($payload));
$request->request = new InputBag($payload);
$request->query = new InputBag([]);
$request->setContainer(app())->setRedirector(app(Redirector::class));
$request->validateResolved();
$entry = app(TimeEntryController::class)->store($organization, $request)->resource;
if (! $entry instanceof TimeEntry) { throw new LogicException('...'); }
```
Differences (RESEARCH Pattern 4): build with `TimeEntryUpdateRequest::create($uri,'PUT')`, bind route `v1.time-entries.update` with `organization` + `timeEntry` params, `setUserResolver`, call `->update($organization, $entry, $request)`, payload `start`/`end` only in `MeetingConversionRequest::FORMAT`; check `BillingContract::isBlocked` manually; in job context `Auth::guard('web')->setUser($actor)` in try / `forgetUser()` in finally.

### `Graph/GraphCalendarClient.php` (+ `event()`)
**Analog:** same file `calendarView(Closure $token, ...)` :44 onward: reuse `intConfig('microsoft365.graph.connect_timeout', 3)` / `timeout 8` (:53-54), `$this->get($url, $accessToken, $connectTimeout, $timeout)` (:173), retry with `$token($rejected)` on 401, `failedResponse()` :135 / `tokenFailure()` :156 / `result()` :168 shapes, Prefer header note :18. 404/410 -> `removed`, `isCancelled true` -> `cancelled`.

### `Graph/OutlookMeetingSyncService.php` (detector hook)
**Analog (self):** `traverse()` :109-176. Collect linked sightings in the event loop BEFORE the eligibility `continue` (:130-137) so cancellation is not lost (Pitfall 2); hand them to the applier after `$this->store(...)` (:150) inside the existing lock held in `sync()` :57-75. "removed" only after `$result['complete']` (same rule as `markUnseenGone` :167-170). Guard `if ($this->access->blocked())` :46 stays first.

### `Console/CheckOutOfSyncCommand.php`
**Analog:** `app/Microsoft365/Console/MicrosoftCheckCommand.php:1-40`: namespace, `protected $signature = 'm365:check-out-of-sync'`, `$description`, `handle(MicrosoftConfig $config): int`, no secrets in output (counts only). Select `MicrosoftAccount` with `calendarAccessState() === 'connected'` and `backoffRemainingSeconds() === null` (`Models/MicrosoftAccount.php:111-127`), dispatch staggered.

### `Jobs/CheckOutOfSyncForUser.php`
**No in-fork job analog.** Use the per-user lock from `OutlookMeetingSyncService::sync` :57-75 (`Cache::lock('m365:meetings-sync:'.$user->getKey(), ...)`, release in finally) so job and interactive sync never overlap; token via `MicrosoftTokenService::accessToken()` closure as in `traverse()` :113-117; `$tries = 3`, `release(RetryAfter::seconds(...))` on back-off.

### `Microsoft365ServiceProvider.php`
**Analog (self) :32-43:**
```php
if ($this->app->runningInConsole()) {
    $this->commands([MicrosoftCheckCommand::class]);   // add CheckOutOfSyncCommand::class
}
```
Add `$this->callAfterResolving(Schedule::class, fn (Schedule $s) => $s->command('m365:check-out-of-sync')->dailyAt('05:30')->timezone(config('microsoft365.default_timezone'))->withoutOverlapping()->when(fn () => app(MicrosoftConfig::class)->isConfigured()));` Keep the class docblock rule: nothing request-scoped in boot (:14-19).

### `Http/Controllers/OutOfSyncController.php` (keep / adjust / move-entry)
**Analog:** `OutlookMeetingController.php:224-268` and `OutlookSeriesController.php` (`__construct(private readonly GraphAccessGuard $access)` :29, `ownSeries` :73).
```php
private function ownMeeting(?Authenticatable $user, string $id): OutlookMeeting
{
    // Impersonation answers like a foreign id: no oracle for what exists
    if ($this->access->blocked()) {
        throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
    }
    return OutlookMeeting::query()
        ->where('user_id', '=', $this->sessionUser($user)->getKey())
        ->whereKey($id)->whereNull('gone_at')->firstOrFail();
}
```
Write an `ownFlaggedLink($user, $entryId)` the same way (links.user_id and time_entries.user_id = auth id, flagged, active). Idempotent actions like `dismiss` :224-234. `sessionUser()` :290-295 and `currentOrganization()` :271-288 copied/shared. Adjust calls `CoreTimeEntryUpdater` and maps exceptions like `MeetingConversionController` :91-102.

### `routes/microsoft365.php`
**Analog (self) :45-59:**
```php
Route::post('/meetings/{meeting}/series/ignore', [OutlookSeriesController::class, 'ignore'])
    ->whereUuid('meeting')
    ->middleware('throttle:60,1,m365-series:')
    ->name('microsoft.meetings.series.ignore');
```
New: `/out-of-sync/{entry}/keep|adjust`, `/meetings/{meeting}/move-entry` inside the `m365` group :25-27, `whereUuid`, `throttle:60,1,m365-osync:`, names `microsoft.out-of-sync.*`. Adjust/move need org: follow the convert route :64-67 (`{organization}` + `check-organization-blocked`) or do the billing check in the updater. Update `OutlookMeetingPrivacyTest.php:751` count.

### `OutlookMeetingController::index` (read additions)
**Analog (self):** empty branch :61-66 must add `'out_of_sync' => ['items' => []]`; normal `additional` :143-150 adds `out_of_sync` from `OutOfSyncScope`; `linkedTimeEntryIds()` :179-206 is the query template (join links + time_entries, own user). Visibility `whereNotExists` :87-94 must only count links with `released_at IS NULL`; `previous_entry` via released link with live owned entry in current org.

### `OutlookEntryBadge.vue`
**Analog (self, whole file):**
```vue
const context = inject(OUTLOOK_MEETINGS_KEY, null);
const linked = computed(() => context?.linkedTimeEntryIds.value.includes(props.timeEntryId) ?? false);
...
<span v-if="linked && label" data-testid="outlook-entry-badge" class="inline-flex shrink-0 items-center" :title="label">
    <CalendarDays class="w-3 h-3 shrink-0" aria-hidden="true" />
```
Add `flag` computed from context out-of-sync map, a `<button data-testid="outlook-out-of-sync-marker">` with `TriangleAlert` `text-amber-600 dark:text-amber-400`, `@pointerdown.stop @click.stop @keydown.enter.stop`, reka-ui Popover; actions via `Button`/`PrimaryButton`/`SecondaryButton` imports as `OutlookGhostDetail.vue:16-18`.

### `OutlookCalendarControls.vue` (counter)
**Analog (self):** gate `v-if="context && (context.calendar.value || context.canAct?.value)"` :161, `Button` from `@/packages/ui/src/Buttons/Button.vue` :6 used at :189-242. Counter visible when `items.length > 0 && canAct`.

### `OutlookGhostDetail.vue` / `OutlookMeetingContextItems.vue` ("Move my entry here")
**Analog (self):** `OutlookGhostDetail.vue:283-288` `<SecondaryButton @click="emit('create')">`; emits declared at :60; component owns no network code (:35 comment) - add `emit('move-entry')`, caller in `useOutlookMeetings` acts. Context items: same emit-only pattern.

### `useOutlookMeetings.ts`
**Analog (self):** mutation `syncMutation` :316-324 with `onSettled: invalidateQueries({ queryKey: MEETINGS_QUERY_KEY })`; after entry writes invalidate as :882-884 (`['timeEntries']`, `['goals']`, meetings unless `injected`); hook options :178-183 extend with `outOfSync?: OutOfSyncItem[]; outOfSyncUrl?: string;`.

### Lang en/es
Add keys under `'calendar' => [` (`lang/en/microsoft365.php:23`); Spanish uses "registro de tiempo" (`lang/es/microsoft365.php:88-98`). Parity enforced by `tests/Unit/Microsoft365/MicrosoftLangTest.php`; served by `ShareMicrosoftInertiaData::calendarLabels()` :128-139 automatically.

### Compose `docs/deploy/dokploy-compose.fork.yml`
Copy lines 36-42 (`SOLIDTIME_MICROSOFT_*: ${...:-}`) into the `scheduler` (:86) and `queue` (:134) environment blocks; bump image tag at :16, :87, :135.

### Tests
- `CoreTimeEntryUpdaterContractTest.php`: copy `CoreTimeEntryCreatorContractTest.php:1-40` (ReflectionMethod on `TimeEntryController::update`, `#[CoversNothing]`, Arrange/Act/Assert comments), assert 3 params `[Organization, TimeEntry, TimeEntryUpdateRequest]`, JsonResource return, and route name `v1.time-entries.update` resolves.
- `OutOfSyncRulesTest.php`: unit, table-driven like `OutlookMeetingEligibilityTest.php`.
- Feature tests: use `Support/InteractsWithMicrosoft365.php` and Http fakes as `OutlookMeetingSyncTest.php`; keep `test_sync_does_not_change_time_entries` (:345-360) as the unlinked-entry proof.
- Vitest: extend `OutlookEntryBadge.test.ts`, `OutlookCalendarControls.test.ts`; new `outOfSync.test.ts`.
- Playwright: `e2e/outlook-convert.spec.ts` - integration off, `page.route(URL, ...)` at :207 answers fork routes and performs real core `/api/v1` calls; inject meetings through the test hook.

## Shared Patterns

- **Impersonation guard / 404 not 403:** `GraphAccessGuard::blocked()` -> `ModelNotFoundException` (`OutlookMeetingController.php:253-268`). Apply to every new endpoint and to the read branch :61-66.
- **Own-rows only, no user param:** route comment `routes/microsoft365.php:23-24`; all queries `where('user_id', '=', $user->getKey())`.
- **Per-item failure isolation:** transaction inside try, catch outside (`MeetingConversionController.php:86-102`). Applier and job.
- **Per-user lock:** `Cache::lock('m365:meetings-sync:'.$userId)` (`OutlookMeetingSyncService.php:57-75`) shared by job and interactive sync.
- **No PII logging:** counts only (`OutlookMeetingSyncService.php:152-155`).
- **Frontend components emit, composable acts;** invalidate `MEETINGS_QUERY_KEY` and `['timeEntries']`.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `app/Microsoft365/Jobs/CheckOutOfSyncForUser.php` | queued job | Fork has no ShouldQueue job yet; use RESEARCH Pattern 7 + core jobs (`RecalculateSpentTimeForProject`) for class shape |
| Schedule registration via `callAfterResolving(Schedule::class)` | provider hook | Not used anywhere yet; RESEARCH "Schedule from the fork provider" (core schedule style `app/Console/Kernel.php:17-49`) |

## Metadata
**Analog search scope:** `app/Microsoft365/**`, `resources/js/m365/**`, `tests/{Unit,Feature}/Microsoft365`, `e2e/`, `lang/`, `docs/deploy/`, core `database/migrations`.
**Files scanned:** ~25
**Pattern extraction date:** 2026-11-23
