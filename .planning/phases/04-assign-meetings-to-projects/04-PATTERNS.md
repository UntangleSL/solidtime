# Phase 4: Assign Meetings to Projects - Pattern Map

**Mapped:** 2026-11-17
**Files analyzed:** 27 (new + modified)
**Analogs found:** 25 / 27

## Naming conflicts the planner must resolve first

1. **Component names differ between RESEARCH and UI-SPEC.** RESEARCH: `OutlookConvertForm.vue`, `OutlookSelectionBar.vue`, `OutlookEntryBadge.vue`, `conversionApi.ts`, `lastProject.ts`. UI-SPEC (line 75): `MeetingEntryForm.vue`, `MeetingSelectionBar.vue`, `MeetingAssignResults.vue`, `useMeetingSelection.ts`, API additions in `meetingsApi.ts`. Recommendation: keep the `Outlook*` prefix (every existing file in `resources/js/m365/calendar/` uses it) and pick one set; the rest of this file uses RESEARCH names.
2. **Outlook icon on entries.** RESEARCH Pattern 8 = named-slot chain (`title-extra` / `event-extra`) through `FullCalendarEventContent` <- `CalendarDayColumn` <- `TimeEntryCalendar` <- `Calendar.vue`. UI-SPEC line 378 = `isFromMeeting` prop. The slot chain mirrors the existing `day-overlay` seam and keeps the badge fork-owned; prefer it.
3. **Already-converted wording:** D-16 fixes it as "Already had a time entry", neutral (not a failure). RESEARCH Open Question 2 is resolved by D-16.

## File Classification

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php` | new | migration | - | `app/Microsoft365/database/migrations/2026_11_05_000001_create_outlook_meetings_tables.php` | exact |
| `app/Microsoft365/Models/OutlookMeetingLink.php` | new | model | CRUD | `app/Microsoft365/Models/OutlookMeeting.php` | exact |
| `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` | new | service (core adapter) | request-response | RESEARCH Pattern 1 sketch; core `app/Http/Controllers/Api/V1/TimeEntryController.php:608-669` | no fork analog |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php` (add `convert`, extend `index`) or new `OutlookMeetingConversionController.php` | mod/new | controller | batch request-response | same file `dismiss`/`ownMeeting` (lines 98-146) | exact |
| `app/Microsoft365/Http/Requests/MeetingConversionRequest.php` | new | validation | request-response | `app/Microsoft365/Http/Requests/MeetingRangeRequest.php` | exact |
| `app/Microsoft365/routes/microsoft365.php` | mod | route | - | same file lines 23-43 | exact |
| `app/Microsoft365/Http/Controllers/MicrosoftAccountController.php` | verify only | controller | - | line 39 purge; D-15 says links must NOT be purged | n/a |
| `lang/en/microsoft365.php`, `lang/es/microsoft365.php` | mod | config (i18n) | - | existing `calendar` keys | exact |
| `tests/Feature/Microsoft365/OutlookMeetingConversionTest.php` | new | test | - | `tests/Feature/Microsoft365/OutlookMeetingDismissTest.php` | exact |
| `tests/Feature/Microsoft365/OutlookMeetingLinkLifecycleTest.php` | new | test | - | `OutlookMeetingDismissTest.php` | exact |
| `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` | new | test (reflection guard) | - | none | no analog |
| `resources/js/m365/calendar/meetingsApi.ts` | mod | api client | request-response | same file (`dismissMeeting`, `fetchMeetings`) | exact |
| `resources/js/m365/calendar/conversionApi.ts` (+test) | new | api client | batch | `meetingsApi.ts` lines 44-71 | exact |
| `resources/js/m365/calendar/lastProject.ts` (+test) | new | utility | localStorage | `useOutlookMeetings.ts:47` (`solidtime:m365-show-dismissed`) | role-match |
| `resources/js/m365/calendar/useOutlookMeetings.ts` (+test) | mod | composable/store | optimistic mutation, pub-sub | same file `changeDismissal` 442-498 | exact |
| `resources/js/m365/calendar/OutlookConvertForm.vue` (+test) | new | component (form) | request-response | core `resources/js/packages/ui/src/TimeEntry/TimeEntryCreateModal.vue` | role-match |
| `resources/js/m365/calendar/OutlookSelectionBar.vue` (+test) | new | component | event-driven | `OutlookCalendarControls.vue` (mount host) | partial |
| `resources/js/m365/calendar/OutlookEntryBadge.vue` (+test) | new | component | read | `OutlookLaneCaption.vue` (inject context, tiny render) | role-match |
| `resources/js/m365/calendar/OutlookGhostDetail.vue` (+test) | mod | component | event-driven | itself (emit pattern, `actions` slot, `canAct`) | exact |
| `resources/js/m365/calendar/OutlookMeetingHoverCard.vue` (+test) | mod | component | event-driven | itself (`actions` slot line 43-45) | exact |
| `resources/js/m365/calendar/OutlookMeetingContextItems.vue` (+test) | mod | component | event-driven | itself (`onRestore`, reserved line 118) | exact |
| `resources/js/m365/calendar/OutlookGhostLayer.vue` (+test) | mod | component | event-driven (multi-select) | itself | exact |
| `resources/js/m365/types.ts` | mod | types | - | `OutlookCalendarLabels`, `OutlookMeetingsResponse` | exact |
| `resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.vue` | mod (core, ledger) | component | - | title span line 50 | exact |
| `resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue` | mod (core, ledger) | component | - | existing `#overlay` slot forwarding | exact |
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | mod (core, ledger) | component | - | `day-overlay` forwarding lines 783-794 | exact |
| `resources/js/Pages/Calendar.vue` | mod (core, ledger) | page | - | existing Outlook slot fills in this page | exact |
| `docs/m365/TOUCHED-CORE-FILES.md` | mod | docs | - | existing per-phase sections | exact |
| `e2e/outlook-convert.spec.ts` | new | e2e test | - | `e2e/outlook-ghosts.spec.ts` | exact |

## Pattern Assignments

### Migration `2026_11_17_000001_create_outlook_meeting_links_table.php`
**Analog:** `app/Microsoft365/database/migrations/2026_11_05_000001_create_outlook_meetings_tables.php` lines 1-46
```php
declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outlook_meetings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')
                ->cascadeOnDelete()->cascadeOnUpdate();
            // Immutable Graph id of the occurrence (Prefer: IdType="ImmutableId"), unique per user mailbox
            $table->string('graph_id', 255);
            ...
            $table->unique(['user_id', 'graph_id']);
```
Apply: same header/foreign style; add `time_entry_id` uuid unique + FK `time_entries` cascadeOnDelete (D-05: delete entry -> link gone -> meeting resurfaces); `unique(['user_id','graph_id'])` (D-06). No FK to `outlook_meetings` (D-15: survives disconnect purge). Full sketch: RESEARCH Pattern 2.

### Model `OutlookMeetingLink.php`
**Analog:** `app/Microsoft365/Models/OutlookMeeting.php` lines 1-60: `declare(strict_types=1)`, `use App\Models\Concerns\HasUuids;`, docblock `@property` list, explicit `protected $table`, `$casts` array, docblock note "Deliberately not audited". Not Auditable, not in Filament.

### `CoreTimeEntryCreator.php`
No fork analog. Copy RESEARCH Pattern 1 sketch (createFrom + fresh InputBags + `setContainer(app())->setRedirector(...)` + `validateResolved()` + `app(TimeEntryController::class)->store($organization, $request)`). Wrap per-meeting call in `DB::transaction` (recalc jobs are `ShouldDispatchAfterCommit`).

### Controller (convert + index extension)
**Analog:** `app/Microsoft365/Http/Controllers/OutlookMeetingController.php`
- Impersonation guard (lines 127-138), reuse for the convert path (D-13):
```php
if ($this->access->blocked()) {
    throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
}
return OutlookMeeting::query()
    ->where('user_id', '=', $this->sessionUser($user)->getKey())
    ->whereKey($id)->whereNull('gone_at')->firstOrFail();
```
  For the batch, use the same query with `->lockForUpdate()->first()` and map null to `failed: meeting_not_found`.
- Index query (lines 51-61): add `whereNotExists` over links JOIN time_entries; add `'linked_time_entry_ids'` beside `'sync'` in `->additional([...])` (lines 69-75); empty list in the impersonation branch (lines 45-49).
- Session user helper lines 141-146 (`assert($user instanceof User)`).
- Dismiss clearing on convert (D-11): copy lines 115-118 (`$row->dismissed_at = null; $row->save();`).
- Error mapping per item: RESEARCH Pattern 4 table (ValidationException / AuthorizationException / ApiException `getKey()`+`getTranslatedMessage()` / UniqueConstraintViolationException -> `existing`).

### Route
**Analog:** `app/Microsoft365/routes/microsoft365.php` lines 23-43
```php
Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])
    ->prefix('m365')
    ->group(function (): void {
        Route::post('/meetings/{meeting}/dismiss', [OutlookMeetingController::class, 'dismiss'])
            ->whereUuid('meeting')
            ->middleware('throttle:60,1,m365-dismiss:')
            ->name('microsoft.meetings.dismiss');
```
New: `Route::post('/organizations/{organization}/meetings/time-entries', ...)->middleware(['check-organization-blocked', 'throttle:30,1,m365-convert:'])->name('microsoft.meetings.convert')`. Parameter MUST be named `{organization}` (check-organization-blocked and `TimeEntryStoreRequest` read it). Never under `api/` (D-12). The URL must reach the frontend via the shared `calendar.urls` prop (see `ShareMicrosoftInertiaData.php`, where `urls.meetings` is built).

### Lang files
Add keys under `calendar` in both `lang/en/microsoft365.php` and `lang/es/microsoft365.php` in the same task (`MicrosoftLangTest` parity); served by `calendarLabels()` (`ShareMicrosoftInertiaData.php:122-134`); mirror in `OutlookCalendarLabels` (`resources/js/m365/types.ts`). Plurals as `_one`/`_many`; placeholders `:name` via `fillLabel` (`labels.ts`).

### Feature tests
**Analog:** `tests/Feature/Microsoft365/OutlookMeetingDismissTest.php` fixture helper lines 59-75:
```php
private function meeting(User $user, string $graphId, array $overrides = []): OutlookMeeting
{
    return OutlookMeeting::query()->create(array_merge([
        'user_id' => $user->getKey(),
        'graph_id' => $graphId,
        'event_type' => 'singleInstance',
        'subject' => 'Subject '.$graphId,
        'starts_at' => '2026-10-20 09:00:00',
        'ends_at' => '2026-10-20 10:00:00',
        ...
```
Copy or move into `tests/Feature/Microsoft365/Support/`. Cover impersonation 404/empty, foreign id, idempotent repeat, cascade on entry delete, disconnect keeps links (D-15).

### `meetingsApi.ts` / `conversionApi.ts`
**Analog:** `resources/js/m365/calendar/meetingsApi.ts` lines 44-71 (global axios, web routes with session + XSRF; comment line 4):
```ts
export async function dismissMeeting(meetingsUrl: string, id: string): Promise<void> {
    await axios.post(`${meetingsUrl}/${encodeURIComponent(id)}/dismiss`);
}
```
`fetchMeetings` (line 21): parse `linked_time_entry_ids`, default `[]`.

### `useOutlookMeetings.ts` (convert, selection, refetch-on-timeEntries)
**Analog:** same file `changeDismissal`, lines 442-498: guard `url/bucket/labels`; `cancelQueries(key)`; snapshot `before`; optimistic `setQueryData` filter; `try { await api; announce(...) } catch { restore before; useNotificationsStore().addNotification('error', ..., current.retry_body) }`; finally `invalidateQueries({ queryKey: MEETINGS_QUERY_KEY })`. For convert also invalidate `['timeEntries']` and `['goals']`. Expose new members on `OutlookMeetingsContext` (line 56) provided via `provide(OUTLOOK_MEETINGS_KEY, context)` (line 574). localStorage key convention: line 47 `solidtime:m365-show-dismissed` -> `solidtime:m365-last-meeting-project:<orgId>`.

### `OutlookConvertForm.vue`
**Analog:** `resources/js/packages/ui/src/TimeEntry/TimeEntryCreateModal.vue`
- Imports (lines 5-19): `TimeTrackerProjectTaskDropdown`, `TagDropdown`, `useBillableRatesLock`.
- Billable from project (lines 89-99):
```ts
watch(() => timeEntry.value.project_id, (value) => {
    if (value) {
        const project = props.projects.find((p) => p.id === value);
        if (project) timeEntry.value.billable = project.is_billable;
    }
});
```
Per UI-SPEC: `TimePickerSimple` not `TimeRangeFields`; `:can-create-project="false"`; `PrimaryButton` with `loading`. Data via `useProjectsQuery` etc. (as in `Calendar.vue`).

### `OutlookGhostDetail.vue` / `OutlookMeetingHoverCard.vue` / `OutlookMeetingContextItems.vue`
- Detail: emits-only, no network (comment lines 11-12, `defineEmits` line 21, `canAct` gating line 79, `actions` slot line 87). Add `form` mode + `convert` emit.
- Hover card: fill `actions` slot (lines 43-45); action opens panel in form mode (D-17).
- Context menu: replace reserved comment line 118 with first `ContextMenuItem`; copy `onRestore` (lines ~109-120): `menu = rootEl.value?.closest('[role="menu"]')`, `await afterMenuClosed(menu)`, then open the block's panel. Item markup copies the `outlook-menu-open` item (`class="space-x-3"`, lucide icon `w-4 h-4 text-icon-default aria-hidden`, `data-testid`).

### Core slot chain (ledgered)
- `TimeEntryCalendar.vue` lines 783-794 (forwarding pattern):
```vue
<template v-if="$slots['day-overlay']" #overlay="overlay">
    <slot name="day-overlay" v-bind="overlay" :minutes-to-pixels="minutesToPixels" ...
```
- `FullCalendarEventContent.vue` line 50: `<span class="truncate">{{ title }}</span>` -> add `<slot name="title-extra" />` after it.
- Ledger: add a Phase 4 section to `docs/m365/TOUCHED-CORE-FILES.md` in the same format as earlier sections.

## Shared Patterns

- **Impersonation / ownership:** `GraphAccessGuard::blocked()` + user-scoped query, 404 never 403 (`OutlookMeetingController.php:127-138`). All new backend endpoints.
- **Fork isolation:** backend in `app/Microsoft365/`, frontend in `resources/js/m365/`; core edits ledgered.
- **Optimistic mutation + rollback + notification:** `useOutlookMeetings.ts:442-498`.
- **Copy via shared labels:** `lang/*/microsoft365.php` -> `calendarLabels()` -> `OutlookCalendarLabels`.
- **Throttle naming:** `throttle:N,1,m365-<name>:`.
- **Tests:** Vitest `*.test.ts` beside source; PHPUnit in `tests/Feature|Unit/Microsoft365/`; e2e kebab-case in `e2e/`, keep the "no core create flow on ghost click" assertion in `e2e/outlook-ghosts.spec.ts`.

## No Analog Found

| File | Reason |
|------|--------|
| `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` | First in-process reuse of a core controller action; use RESEARCH Pattern 1 |
| `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` | No reflection-based contract tests yet |

## Metadata
**Search scope:** `app/Microsoft365/`, `resources/js/m365/calendar/`, `resources/js/packages/ui/src/{TimeEntry,FullCalendar}`, `tests/Feature/Microsoft365/`, `docs/m365/`
**Analogs verified tracked:** yes (`git ls-files`)
