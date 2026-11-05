# Phase 3: Outlook Meetings in the Calendar - Pattern Map

**Mapped:** 2026-11-05
**Files analyzed:** 27 (new and modified)
**Analogs found:** 24 / 27
**Tracked-source gate:** all analog paths below were checked against `git ls-files` (tracked). No gitignored mirror paths used.

## Confirmed: CalendarDayColumn events container offsets (UI-SPEC delegates ghost inset to these)

Source: `resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue`

Template, lines 83-88 (events container):
```vue
<div
    class="absolute inset-y-0 left-0.5 right-0.5"
    :class="{
        'fc-events-inset': hasActivityStatus && !isDayView,
        'fc-events-inset-expanded': hasActivityStatus && isDayView,
    }">
```
Scoped CSS, lines 412-418:
```css
.fc-events-inset { left: 8px; }
.fc-events-inset-expanded { left: 204px; }
```
Column root (lines 75-82): `class="fc-timegrid-col relative border-r border-border bg-transparent pointer-events-none"` with `has-activity-status` and `activity-expanded` classes, and `:style="{ height: totalGridHeight + 'px' }"`.

Resolved values for the ghost layer container:
- Default: `absolute inset-y-0 left-0.5 right-0.5` (2px each side). Note: Tailwind `left-0.5` = 2px.
- hasActivityStatus && week view: `left: 8px` (right stays 2px)
- hasActivityStatus && day view: `left: 204px` (right stays 2px)
- Warning: the inline `left: 8px/204px` CSS overrides `left-0.5` because the CSS class `.fc-events-inset` is scoped and is declared after utilities. Scoped CSS does not reach slot content, so the ghost layer must set `:style="{ left: '8px' | '204px' }"` (or its own equally specific class) when `hasActivityStatus` is true. Do not invent a 4px value.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `app/Microsoft365/Graph/MicrosoftTokenService.php` | service | request-response (OAuth refresh) | `app/Microsoft365/Auth/MicrosoftIdentityResolver.php` (writeTokens, lock) + `Http::` usage | role-match |
| `app/Microsoft365/Graph/GraphCalendarClient.php` | service | request-response, paging | `tests/Unit/M365/CalendarViewFixturesTest.php` (URL/headers contract) | partial |
| `app/Microsoft365/Graph/OutlookMeetingEligibility.php` | utility | transform | none (pure filter), spec in `docs/m365/DECISIONS-graph.md` | no analog |
| `app/Microsoft365/Graph/OutlookMeetingSyncService.php` | service | batch / CRUD upsert | `MicrosoftIdentityResolver.php` | role-match |
| `app/Microsoft365/Models/OutlookMeeting.php`, `OutlookSyncWindow.php` | model | CRUD | `app/Microsoft365/Models/MicrosoftAccount.php` | exact |
| `app/Microsoft365/database/migrations/*_create_outlook_meetings_table.php` | migration | - | `app/Microsoft365/database/migrations/2026_10_22_000001_create_microsoft_accounts_table.php` | exact |
| `app/Microsoft365/database/migrations/*_add_graph_state_to_microsoft_accounts.php` | migration | - | same file | role-match |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php` | controller | request-response | `app/Microsoft365/Http/Controllers/MicrosoftAccountController.php` | role-match |
| `app/Microsoft365/Http/Resources/OutlookMeetingResource.php`, `Requests/MeetingRangeRequest.php` | resource / request | transform / validation | `app/Http/Resources/V1/...`, `BaseFormRequest` (core) | role-match |
| `app/Microsoft365/routes/microsoft365.php` (modify) | route | request-response | itself, second group | exact |
| `app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php` (modify) | middleware | request-response | itself (`account()` on `profile.show`) | exact |
| `MicrosoftAccountController::destroy`, `MicrosoftIdentityResolver::writeTokens`, `MicrosoftAuthController` return=calendar (modify) | controller | request-response | themselves | exact |
| `lang/en/microsoft365.php`, `lang/es/microsoft365.php` (modify) | config/i18n | - | themselves + `tests/Unit/Microsoft365/MicrosoftLangTest.php` | exact |
| `resources/js/m365/calendar/useOutlookMeetings.ts` (+test) | hook | request-response + mutation | `resources/js/utils/useTimeEntriesCalendarQuery.ts` | role-match |
| `resources/js/m365/calendar/meetingsApi.ts` | utility | request-response | `resources/js/utils/useUserQuery.ts`, `notification.ts` (axios) | role-match |
| `resources/js/m365/calendar/ghostLayout.ts` (+test) | utility | transform | `useActivityBoxes.ts` | role-match |
| `resources/js/m365/calendar/OutlookGhostLayer.vue` | component | event-driven | `CalendarDayColumn.vue` activity box markup + `useActivityBoxes.ts` | role-match |
| `resources/js/m365/calendar/OutlookGhostDetail.vue` | component | event-driven | `CalendarSettingsPopover.vue` | role-match |
| `resources/js/m365/calendar/OutlookCalendarControls.vue` | component | event-driven | `resources/js/m365/components/MicrosoftConnectionForm.vue` + `navigation.ts` | role-match |
| `resources/js/m365/types.ts` (modify) | types | - | itself | exact |
| `FullCalendar/CalendarDayColumn.vue`, `TimeEntryCalendar.vue`, `CalendarToolbar.vue`, `CalendarSettingsPopover.vue`, `useSlotSelection.ts` (modify, ledgered) | component/hook | event-driven | themselves | exact |
| `resources/js/Pages/Calendar.vue` (modify) | page | request-response | itself (`__TEST_SET_ACTIVITY_PERIODS__`) | exact |
| `docs/m365/TOUCHED-CORE-FILES.md` (modify) | docs | - | itself | exact |
| `tests/Feature/Microsoft365/Outlook*Test.php`, `MicrosoftTokenRefreshTest.php` | test | - | `MicrosoftAccountTest.php`, `InteractsWithMicrosoft365` trait | exact |
| `tests/Unit/Microsoft365/OutlookMeetingEligibilityTest.php`, `GraphCalendarClientTest.php` | test | - | `tests/Unit/M365/CalendarViewFixturesTest.php` | role-match |
| `e2e/outlook-ghosts.spec.ts` | test | - | `e2e/microsoft-signin.spec.ts`, `e2e/calendar.spec.ts` | role-match |

## Pattern Assignments

### Backend routes: `app/Microsoft365/routes/microsoft365.php`
**Analog:** same file (full content, 17 lines). Add a third group under the existing authenticated stack.
```php
Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])->group(function (): void {
    Route::delete('/user/microsoft', [MicrosoftAccountController::class, 'destroy'])->name('microsoft.account.destroy');
});
```
New routes (`/m365/meetings`, `/m365/meetings/sync`, `/m365/meetings/{meeting}/dismiss`) go in this same stack plus `throttle:60,1` and `throttle:12,1` on sync. Do not prefix with `api/` (Scramble `api_path` = `api`). Existing public group uses `'throttle:30,1'`.

### Controller + user scoping: `OutlookMeetingController`
**Analog:** `app/Microsoft365/Http/Controllers/MicrosoftAccountController.php` lines 20-52.
```php
$user = $request->user();
DB::transaction(function () use ($user): void {
    $account = MicrosoftAccount::query()
        ->where('user_id', '=', $user->getKey())
        ->lockForUpdate()
        ->first();
```
Copy: user scoping through `$request->user()`, no route param for the user, `lockForUpdate()` in `DB::transaction` for the token refresh. For disconnect purge (D-21), add `OutlookMeeting::query()->where('user_id', ...)->delete()` and same for sync windows inside this same transaction (after `$account->save()`). Also reset `reconnect_required_at`/`graph_backoff_until` here.

### Inertia shared prop: `ShareMicrosoftInertiaData` (modify)
**Analog:** same file lines 31-60. Extend the closure, same gating as `profile.show`:
```php
if ($request->routeIs('profile.show')) {
    $user = Auth::guard('web')->user();
    if ($user instanceof User) {
        $data['account'] = $this->account($request, $user);
    }
}
```
Add `if ($request->routeIs('calendar')) { $data['calendar'] = $this->calendar(...); }`. Rules: computed inside the `Inertia::share` closure (Octane), labels from `__('microsoft365.calendar.*')`, URLs through `route(...)`, connect URL `route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'])`. Omit the `calendar` key entirely when integration is off or impersonating (UI-SPEC). Never include token data. Reuse `MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->first()` and `$account?->isConnected()`.

### Middleware: `EnsureMicrosoftIsEnabled` (reuse, no change)
`abort(404)` when `! $this->config->isConfigured()`. Apply to every new route group.

### Migrations
**Analog:** `app/Microsoft365/database/migrations/2026_10_22_000001_create_microsoft_accounts_table.php`.
```php
return new class extends Migration {
    public function up(): void {
        Schema::create('microsoft_accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->unique();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete()->cascadeOnUpdate();
            $table->text('access_token')->nullable();
            $table->dateTime('access_token_expires_at')->nullable();
            $table->jsonb('scopes')->nullable();
            $table->dateTime('disconnected_at')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('microsoft_accounts'); }
};
```
Copy: anonymous class, `declare(strict_types=1)`, uuid PK, FK with `cascadeOnDelete()->cascadeOnUpdate()`, `dateTime` columns, `: void` closures. Name with `2026_11_*` prefix in the same folder. `outlook_meetings` uses a non-unique `user_id` plus `unique(['user_id','graph_id'])`. The alter migration uses `Schema::table`, nullable `dateTime` columns.

### Models: `OutlookMeeting`, `OutlookSyncWindow`
**Analog:** `app/Microsoft365/Models/MicrosoftAccount.php` (not read in full this pass; planner should open it for the `HasUuids`, `$hidden` and casts block before writing). It is non-auditable on purpose; do not add `Auditable`.

### Token refresh row lock + token write
**Analog:** `MicrosoftIdentityResolver.php` `writeTokens` (lines ~230-236) and the connect path (lines ~99-105, `$account->disconnected_at = null; $this->writeTokens(...)`). Clear `reconnect_required_at` in `writeTokens`. The outbound call is `Http::asForm()->post(...)`, not Socialite (RESEARCH Pattern 1).

### Graph client contract and test replay
**Analog:** `tests/Unit/M365/CalendarViewFixturesTest.php` (fixture loading, `Http::fake`, manifest-driven file order: never list the directory, page-10 sorts before page-2).
```php
$json = file_get_contents(base_path('tests/Fixtures/M365/'.$path));
$data = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
```
Class attributes: `#[CoversNothing]` in the fixture test; new tests use `#[CoversClass]`. `protected bool $mockBillingContract = false;` appears there; reuse it where the test does not need the billing mock. Remaining contract details (literal URL, `$select`, `Prefer` header on every page and nextLink, empty pages with nextLink, `max_pages` >= 22 in the replay test) are in RESEARCH Pattern 2 and Pitfall 3.

### Feature tests
**Analog:** `tests/Feature/Microsoft365/MicrosoftAccountTest.php` + trait `tests/Feature/Microsoft365/Support/InteractsWithMicrosoft365.php`.
```php
use InteractsWithMicrosoft365;   // in the test class
$this->configureMicrosoft365($organization);   // sets Config microsoft365.* and app.url
$identity = $this->microsoftIdentity(['accessToken' => 'at-marker-7f3c']);
```
Constants `MICROSOFT_TEST_TENANT_ID` etc. Scopes default: `['openid','profile','email','offline_access','User.Read','Calendars.Read']`. Use marker tokens (`at-marker-...`) to assert secrets never appear in logs/props (with `timacdonald/log-fake`). Style: `// Arrange / Act / Assert`, `test_` snake_case names.

### i18n
**Analog:** `lang/en/microsoft365.php` (nested arrays `ui`, `error`; `:placeholder` syntax). Add `calendar` => [...] keys for every UI-SPEC copy row; mirror in `lang/es/microsoft365.php`; `tests/Unit/Microsoft365/MicrosoftLangTest.php` enforces parity (read it first).

### Frontend: query hook
**Analog:** `resources/js/utils/useTimeEntriesCalendarQuery.ts`.
```ts
return useQuery<TimeEntryResponse>({
    queryKey: computed(() => createCalendarQueryKey(...)),
    enabled: enableCalendarQuery,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {...},
    staleTime: 1000 * 30,
});
```
Copy: `Ref<Dayjs|undefined>` params, `computed` key and `enabled`, `placeholderData`, `localDateToUtc` from `@/packages/ui/src/utils/time` for range strings, `getWeekStartDayNumber` from `@/packages/ui/src/utils/settings` for week bucketing. Differences: use axios (not the zodios `api`), `retry: false`, `refetchOnWindowFocus: false`; sync is `useMutation`, never `useQuery`.

### Frontend: ghost layout and layer
**Analog:** `resources/js/packages/ui/src/FullCalendar/useActivityBoxes.ts` lines 1-80.
```ts
const periodStart = getLocalizedDayJs(period.start);
if (periodEnd.isBefore(dayStart) || periodStart.isAfter(dayEnd)) continue;
const actualStart = periodStart.isAfter(dayStart) ? periodStart : dayStart;
const actualEnd = periodEnd.isBefore(dayEnd) ? periodEnd : dayEnd;
const clampedStart = Math.max(actualStartMin, startMin);
const clampedEnd = Math.min(actualEndMin, endMin);
if (clampedEnd <= clampedStart) continue;
const top = params.minutesToPixels(clampedStart - startMin);
const height = params.minutesToPixels(clampedEnd - clampedStart);
```
Copy this clipping per day exactly. Imports: `getLocalizedDayJs` from `../utils/time` (from m365 use `@/packages/ui/src/utils/time`). Add lane assignment (cap 3), 16px minimum height.

### Frontend: pointer guard (core, one line)
`useSlotSelection.ts` line 25, current:
```ts
if (target.closest('.fc-event')) return;
```
Change to `if (target.closest('.fc-event, [data-calendar-overlay]')) return;`. Ghosts must not carry `.fc-event`, `data-event-id`, `.fc-timegrid-col`, `touch-none`.

### Frontend: day column overlay slot (core)
`CalendarDayColumn.vue`: insert `<slot name="overlay" :day-str="dayStr" :is-day-view="isDayView" :has-activity-status="hasActivityStatus" :total-grid-height="totalGridHeight" />` as first child of the root `div.fc-timegrid-col` (line ~75), before the events container at line 83. Root is `pointer-events-none`; ghosts opt in with `pointer-events-auto` (events use `pointer-events-auto` too, line ~92).

### Frontend: toolbar and settings slots (core)
- `CalendarToolbar.vue`: root `div.flex.items-center.justify-between...` (line 24), right cluster `div.flex.items-center.gap-1` (line 34). Add `<slot name="extra" />` in the right cluster before the tabs.
- `CalendarSettingsPopover.vue`: `import { Popover, PopoverContent, PopoverTrigger, Button } from '..';` (line 2), content `<PopoverContent align="end" class="w-72 p-4">` (line 110). Add `<slot name="settings-extra" />` after a `Separator` at the bottom of the content. Detail panel copies this Popover usage: `<Popover><PopoverTrigger as-child>...</PopoverTrigger><PopoverContent ...>`.

### Frontend: page wiring and test hook
**Analog:** `resources/js/Pages/Calendar.vue` lines 40-55.
```ts
const testActivityPeriods = ref<ActivityPeriod[]>([]);
onMounted(() => {
    (window as unknown as Record<string, unknown>).__TEST_SET_ACTIVITY_PERIODS__ = (data: ActivityPeriod[]) => {
        testActivityPeriods.value = data;
    };
    const windowData = (window as unknown as Record<string, unknown>).__TEST_ACTIVITY_PERIODS__;
    if (Array.isArray(windowData)) { setTimeout(() => { testActivityPeriods.value = windowData; }, 2000); }
});
```
Copy for `__TEST_SET_OUTLOOK_MEETINGS__` so Playwright (integration is off in CI) can inject ghosts without Graph.

### Frontend: Connect/Reconnect navigation
**Analog:** `resources/js/m365/navigation.ts` (`navigateTo(url)` wraps `window.location.assign`, mockable) and `resources/js/m365/components/MicrosoftConnectionForm.vue` (+ `.test.ts` for mocking `navigateTo`). Reuse for Connect/Reconnect buttons; never Inertia `<Link>`.

### E2E
**Analog:** `e2e/microsoft-signin.spec.ts` (imports `PLAYWRIGHT_BASE_URL` from `../playwright/config`, logged-in `test` from `../playwright/fixtures`, `getByTestId`, `toHaveCount(0)` for the integration-off case) and `e2e/calendar.spec.ts` (entries located via `.fc-event`). Ghost locator: `.m365-ghost` / `[data-calendar-overlay]`; assert `.fc-event` count unchanged.

## Shared Patterns

### Owner scoping (CAL-03)
Always `->where('user_id', '=', $request->user()->getKey())`; resolve `{meeting}` via scoped `firstOrFail()` (404, no implicit binding).

### Octane safety
Shared props computed inside the closure (as in `ShareMicrosoftInertiaData`), services bound with `bind`, no instance state (see `Microsoft365ServiceProvider.php`).

### No secrets
Same rule as the `ShareMicrosoftInertiaData` docblock: nothing token-related in props, logs or exceptions; log fixed reason codes only.

### PHP style
`declare(strict_types=1)`, `: void` on closures, strict `=` operator in `where`, typed returns, `@param Closure(Request): Response` docblocks.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `OutlookMeetingEligibility.php` | utility | Pure filter; follow `docs/m365/DECISIONS-graph.md` and RESEARCH "Eligibility" example |
| `GraphCalendarClient.php` paging / `Retry-After` handling | service | No outbound paged client exists in the fork; closest contract is the fixture test and RESEARCH Pattern 2 |
| `MicrosoftTokenService.php` refresh grant | service | No refresh logic exists yet; use RESEARCH Pattern 1 classification table |

## Metadata
**Analog search scope:** `app/Microsoft365/`, `tests/Feature/Microsoft365/`, `tests/Unit/M365/`, `resources/js/m365/`, `resources/js/packages/ui/src/FullCalendar/`, `resources/js/utils/`, `resources/js/Pages/Calendar.vue`, `e2e/`, `lang/`
**Not fully read:** `MicrosoftAccount.php`, `MicrosoftIdentityResolver.php`, `MicrosoftAuthController.php`, `TimeEntryCalendar.vue`, `MicrosoftLangTest.php` (planner should open them when writing the matching plan; line refs for them come from RESEARCH.md)
**Pattern extraction date:** 2026-11-05
