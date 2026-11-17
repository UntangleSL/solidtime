# Phase 5: Smart Meeting Suggestions - Pattern Map

**Mapped:** 2026-11-17
**Files analyzed:** 34 (new + modified)
**Analogs found:** 31 / 34

## Naming conflicts (RESEARCH vs UI-SPEC) - resolve before planning

| Topic | RESEARCH says | UI-SPEC says | Recommendation |
|-------|---------------|--------------|----------------|
| Pure TS helper for prefill/reason | `suggestions.ts` (prefill order, reason text, quick picks) | `suggestionReason.ts` (reason object to label) | Keep both but split responsibilities: `suggestions.ts` = prefill resolution + quick picks (sibling of `lastProject.ts`); `suggestionReason.ts` = label builder only. Pure TS helpers stay lowerCamelCase with no prefix (existing convention: `lastProject.ts`, `ghostLayout.ts`, `conversionApi.ts`). |
| Vue components | none new named (extends existing) | `OutlookProjectDot.vue`, `OutlookPreassignment.vue`, `OutlookSuggestionPicks.vue`, `OutlookConfirmAll.vue` | Adopt UI-SPEC names; every new `.vue` in `resources/js/m365/calendar/` MUST use the `Outlook*` prefix (all 14 existing components do). |
| Bulk confirm placement | `OutlookCalendarControls.vue` toolbar-extra slot | `OutlookConfirmAll.vue` toolbar button + popover | Same thing: `OutlookConfirmAll.vue` rendered inside the `OutlookCalendarControls` slot. |
| Series settings | `OutlookSeriesSetting` model, `OutlookSeriesController` | not named | Keep `Outlook*` prefix on PHP model/controller (matches `OutlookMeeting`, `OutlookMeetingLink`, `OutlookSyncWindow`, `OutlookMeetingController`). Exception: existing `MeetingConversionController`/`MeetingConversionRequest` stay unprefixed (not renamed). |
| Suggestion services | `App\Microsoft365\Suggestions\*` (SubjectTokenizer, MeetingSignals, ...) | n/a | Fine; new namespace folder `app/Microsoft365/Suggestions/` parallel to `Graph/`, `TimeEntries/`. |
| Field names | `assignment`, `suggestions[]`, `prefill_source`, `prefill_kept` | "advisory" `reason: {kind,count,value}` | UI-SPEC explicitly says its names are advisory; RESEARCH/D-16 names win. |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `app/Microsoft365/database/migrations/2026_11_18_000001_add_attendees_to_outlook_meetings.php` | migration | schema | `2026_11_05_000001_create_outlook_meetings_tables.php` | exact |
| `.../2026_11_18_000002_add_signals_to_outlook_meeting_links.php` (hashed signals, prefill_source, prefill_kept, project snapshot) | migration | schema | `2026_11_17_000001_create_outlook_meeting_links_table.php` | exact |
| `.../2026_11_18_000003_create_outlook_series_settings_table.php` | migration | schema | `2026_11_17_000001_create_outlook_meeting_links_table.php` | exact |
| `app/Microsoft365/Models/OutlookSeriesSetting.php` | model | CRUD | `Models/OutlookMeetingLink.php` | exact |
| `app/Microsoft365/Models/OutlookMeetingLink.php` (mod: fillable/casts) | model | CRUD | itself | - |
| `app/Microsoft365/Models/OutlookMeeting.php` (mod: attendees cast) | model | CRUD | itself | - |
| `app/Microsoft365/Graph/GraphCalendarClient.php` (mod: `$select` + attendees) | service | request-response | itself (line 24) | - |
| `app/Microsoft365/Graph/OutlookMeetingSyncService.php` (mod: buildRow, upsert list 368-382, scrubIneligible 222) | service | batch | itself | - |
| `app/Microsoft365/Suggestions/SubjectTokenizer.php` | utility | transform (pure) | `Graph/OutlookMeetingEligibility.php` | role-match |
| `app/Microsoft365/Suggestions/MeetingSignals.php` | utility | transform (pure) | `Graph/OutlookMeetingEligibility.php` | role-match |
| `app/Microsoft365/Suggestions/ProjectSuggestionEngine.php` | service | transform (pure) | `Graph/OutlookMeetingEligibility.php` | role-match |
| `app/Microsoft365/Suggestions/SeriesAssignmentResolver.php` | service | CRUD read | `Http/Controllers/OutlookMeetingController.php` (ownMeeting query) | partial |
| `app/Microsoft365/Suggestions/SuggestionHistory.php` | service | CRUD read | same | partial |
| `app/Microsoft365/Suggestions/BookableProjects.php` | service | CRUD read | core `TimeEntryStoreRequest.php:57` + `Project::scopeVisibleByEmployee` | partial |
| `app/Microsoft365/Suggestions/{Assignment,Suggestion,Reason}.php` | value object | - | `Graph/SyncOutcome.php` | role-match |
| `app/Microsoft365/Http/Controllers/OutlookSeriesController.php` | controller | request-response | `OutlookMeetingController::dismiss/restore` | exact |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php` (mod: index attaches hints) | controller | request-response | itself | - |
| `app/Microsoft365/Http/Controllers/MeetingConversionController.php` (mod: store signals + prefill_source) | controller | request-response | itself | - |
| `app/Microsoft365/Http/Requests/MeetingConversionRequest.php` (mod: prefill_source, tag/task) | request | validation | itself (41-48) | - |
| `app/Microsoft365/Http/Resources/OutlookMeetingResource.php` (mod: hints ctor, `assignment`, `series_ignored`) | resource | transform | itself | - |
| `app/Microsoft365/routes/microsoft365.php` (mod: 3 series routes) | route | - | dismiss routes 36-43 | exact |
| `lang/en/microsoft365.php`, `lang/es/microsoft365.php` | config | - | themselves | - |
| `docs/m365/DECISIONS-graph.md`, `docs/m365/TOUCHED-CORE-FILES.md` | docs | - | themselves | - |
| `resources/js/m365/types.ts` (mod) | types | - | itself | - |
| `resources/js/m365/calendar/suggestions.ts` (+ `.test.ts`) | utility | transform (pure) | `lastProject.ts` / `lastProject.test.ts` | exact |
| `resources/js/m365/calendar/suggestionReason.ts` (+ `.test.ts`) | utility | transform (pure) | `labels.ts`, `lastProject.ts` | exact |
| `resources/js/m365/calendar/conversionApi.ts` (mod: series ignore/forget calls) | utility | request-response | itself (`postConversion`) | - |
| `resources/js/m365/calendar/meetingsApi.ts`, `useOutlookMeetings.ts` (mod) | hook | request-response | themselves | - |
| `OutlookConvertForm.vue`, `OutlookGhostLayer.vue`, `OutlookGhostDetail.vue`, `OutlookMeetingHoverCard.vue`, `OutlookMeetingContextItems.vue`, `OutlookCalendarControls.vue`, `OutlookAssignResults.vue` (mod, + their `.test.ts`) | component | event-driven | themselves | - |
| `OutlookProjectDot.vue`, `OutlookPreassignment.vue`, `OutlookSuggestionPicks.vue`, `OutlookConfirmAll.vue` (+ `.test.ts`) | component | event-driven | `OutlookEntryBadge.vue` (dot/badge), `OutlookMeetingSummary.vue` (compact/full block), `OutlookSelectionBar.vue` (bulk action + results) | role-match |
| `resources/js/branding/contrast.test.ts` (mod: dot ring rows) | test | - | itself | - |
| Tests: `tests/Unit/Microsoft365/{SubjectTokenizer,MeetingSignals,ProjectSuggestionEngine}Test.php` | test | - | `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php` | exact |
| Tests: `tests/Feature/Microsoft365/OutlookSeriesAssignmentTest.php`, series ignore/forget, suggestions; mod `OutlookMeetingPrivacyTest.php` (route count 5 -> 8, line 708) | test | - | `OutlookMeetingDismissTest.php`, `OutlookMeetingConversionTest.php`, `Support/InteractsWithGraphFixtures.php` | exact |
| `e2e/outlook-suggestions.spec.ts` | test | - | `e2e/outlook-convert.spec.ts` | exact |

## Pattern Assignments

### Migrations (all three)
**Analog:** `app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php` (lines 1-56). Conventions: `declare(strict_types=1)`, anonymous `return new class extends Migration`, docblock on `up()` explaining the decision ID, uuid PK, `user_id` FK with `cascadeOnDelete()->cascadeOnUpdate()`, a comment above each non-obvious column citing the D-number, composite unique.
```php
Schema::create('outlook_meeting_links', function (Blueprint $table): void {
    $table->uuid('id')->primary();
    $table->uuid('user_id');
    // Deleting the user removes their links
    $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete()->cascadeOnUpdate();
    // ... Deliberately no foreign key to the meetings table: Disconnect purges those rows ... (D-15).
    $table->string('graph_id', 255);
    ...
    $table->unique(['user_id', 'graph_id']);
});
```
- Series settings: same shape; `series_master_id string(255)`, `ignored_at`/`forgotten_at` nullable dateTime, `unique(['user_id','series_master_id'])`, no FK to meetings (survives Disconnect, D-17).
- Attendees migration: `Schema::table('outlook_meetings', ...)` adding `organizer_address` nullable string, `attendees` jsonb nullable, `attendee_count`; update the comment in `2026_11_05_000001` lines 34-35 ("Display name only, never the address") is a NEW migration concern, not an edit of the old file - put the rationale in the new migration and DECISIONS-graph.md.

### `app/Microsoft365/Models/OutlookSeriesSetting.php` (model)
**Analog:** `app/Microsoft365/Models/OutlookMeetingLink.php` (whole file, 1-63): `use App\Models\Concerns\HasUuids;`, class docblock stating privacy invariant ("holds ids only ... survives Disconnect"), `@property` list, explicit `$table`, `$fillable` list, `$casts` datetimes. Do the same additions to `OutlookMeetingLink` for hashed signals (`'signals' => 'array'`) and `prefill_source`, `prefill_kept`.

### `OutlookSeriesController.php` (controller, request-response)
**Analog:** `app/Microsoft365/Http/Controllers/OutlookMeetingController.php` lines 149-190.
```php
public function dismiss(Request $request, string $meeting): OutlookMeetingResource
{
    $row = $this->ownMeeting($request->user(), $meeting);
    if ($row->dismissed_at === null) {
        $row->dismissed_at = now();
        $row->save();
    }
    return new OutlookMeetingResource($row);
}
```
Idempotent writes; `ownMeeting()` (line 178) gives plain 404 for foreign/unknown ids (no 403 oracle). Copy/share `ownMeeting`, then upsert `OutlookSeriesSetting` keyed by `$row->series_master_id` (404/422 if null). Impersonation: same guard as index/dismiss (D-14).

### Routes
**Analog:** `app/Microsoft365/routes/microsoft365.php` lines 34-43:
```php
Route::post('/meetings/{meeting}/dismiss', [OutlookMeetingController::class, 'dismiss'])
    ->whereUuid('meeting')
    ->middleware('throttle:60,1,m365-dismiss:')
    ->name('microsoft.meetings.dismiss');
```
Add `POST/DELETE /meetings/{meeting}/series/ignore` and `POST /meetings/{meeting}/series/forget` in the same group, `whereUuid('meeting')`, own throttle key `m365-series:`, names `microsoft.meetings.series.*`. Update route-count assertion in `OutlookMeetingPrivacyTest.php:708`.

### `OutlookMeetingResource.php` (mod)
**Analog:** itself (lines 17-38). Remains an explicit allow-list; add a constructor taking optional hints, emit `assignment` / `series_ignored` only. Must NOT emit `attendees` or `organizer_address`.

### Pure PHP services (`SubjectTokenizer`, `MeetingSignals`, `ProjectSuggestionEngine`)
**Analog:** `app/Microsoft365/Graph/OutlookMeetingEligibility.php` (pure, array-in verdict-out), tested by `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php` lines 1-40:
```php
declare(strict_types=1);
namespace Tests\Unit\Microsoft365;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

#[CoversClass(OutlookMeetingEligibility::class)]
class OutlookMeetingEligibilityTest extends TestCase
{
    /** @return array<string, array{0: string, 1: string, 2: bool}> */
    public static function scenarioProvider(): array { return ['S1 single meeting' => ['S1','round_a',true], ...]; }
```
Use `#[DataProvider]` named-case arrays for tokenizer stop words (ES/EN) and scoring cases; `test_` snake_case names.

### `resources/js/m365/calendar/suggestions.ts` + `suggestionReason.ts`
**Analog:** `resources/js/m365/calendar/lastProject.ts` lines 1-50. Header comment explaining the rule and decision IDs; small local interfaces (`interface PrefillProject { id; is_archived }`); pure exported functions; "usable" guard pattern:
```ts
export function resolvePrefillProject(storedId, projects, fallbackId): string | null {
    const usable = (id: string | null): id is string =>
        id !== null && projects.some((project) => project.id === id && !project.is_archived);
    if (usable(storedId)) return storedId;
    if (usable(fallbackId)) return fallbackId;
    return null;
}
```
New order: series assignment -> confident suggestion -> `resolvePrefillProject(...)` (last used) -> null; return also the `prefill_source` for D-16. Tests copy `lastProject.test.ts` structure (`describe`/`it`, fixture `projects` array with an archived one, `beforeEach` clearing state).

### `conversionApi.ts` (mod)
**Analog:** itself: global `axios` (never the generated OpenAPI client, comment line 9), `postConversion` (line 55), `conversionErrorMessage` (line 83). Add `ignoreSeries/unignoreSeries/forgetSeries(url)` in the same style; URLs come from shared Inertia `urls` (`ShareMicrosoftInertiaData.php:89-91`), not hard-coded.

### New Vue components
- `OutlookProjectDot.vue`: copy structure from `OutlookEntryBadge.vue` (+ its test).
- `OutlookPreassignment.vue` (`variant: 'compact' | 'full'`): copy from `OutlookMeetingSummary.vue`.
- `OutlookSuggestionPicks.vue`: child of `OutlookConvertForm.vue`; emit `pick(projectId)`.
- `OutlookConfirmAll.vue`: copy flow from `OutlookSelectionBar.vue` + reuse `OutlookAssignResults.vue` for rows (add optional checkbox slot), mounted in `OutlookCalendarControls.vue` toolbar slot.
- `OutlookConvertForm.vue:146` billable watcher (`if (project) billable.value = project.is_billable && !billableRatesLocked.value;`) must skip when prefill_source is `series` (Pitfall 4).

## Shared Patterns

- **Ownership / 404:** `OutlookMeetingController::ownMeeting` (line 178) for every per-meeting endpoint.
- **Impersonation:** early empty return in index / 404 on writes (as Phase 3/4); apply to suggestions, confirm, series actions.
- **Organization source:** `$user->current_team_id` exactly as `ShareMicrosoftInertiaData.php:89-91` so read and confirm agree.
- **Privacy:** resource allow-list; links hold ids + HMAC hashes only (`OutlookMeetingLink.php:18`); scrub attendees in `scrubIneligible` (`OutlookMeetingSyncService.php:222`) and upsert list (368-382).
- **Lang:** every string in both `lang/en/microsoft365.php` and `lang/es/microsoft365.php`; `MicrosoftLangTest` checks parity.
- **Fork isolation:** no core file edits for UI; any core touch goes in `docs/m365/TOUCHED-CORE-FILES.md`.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `ProjectSuggestionEngine.php` scoring | service | No scoring code exists; use RESEARCH Pattern 5 |
| HMAC signal hashing in `MeetingSignals.php` | utility | No hashing in fork; use RESEARCH Pattern 3 (`hash_hmac` with app key) |
| `BookableProjects.php` | service | Mirrors core rule; copy from core `TimeEntryStoreRequest.php:57` / `Project.php:182-190` rather than a fork analog |

## Metadata
**Analog search scope:** `app/Microsoft365/**`, `resources/js/m365/**`, `tests/{Unit,Feature}/Microsoft365`, `e2e/`
**Pattern extraction date:** 2026-11-17
