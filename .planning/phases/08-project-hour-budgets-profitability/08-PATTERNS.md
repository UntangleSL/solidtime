# Phase 8: Project Hour Budgets & Profitability - Pattern Map

**Mapped:** 2026-11-27
**Files analyzed:** 46 (new fork files grouped by family) + 3 core seams
**Analogs found:** 44 / 46 (all analogs verified git-tracked via `git ls-files`)

All paths are relative to repo root `C:\Users\JuanHerrero\Documents\projects\solidtime`. Primary analog module: `app/Microsoft365/`; secondary: `app/Appearance/`.

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `app/Profitability/ProfitabilityServiceProvider.php` | provider | event-driven + scheduler | `app/Microsoft365/Microsoft365ServiceProvider.php` (+ `app/Appearance/AppearanceServiceProvider.php` for event hook) | exact |
| `config/app.php` (edit: 1 `use` + 1 providers line) | config | n/a | existing `Microsoft365ServiceProvider::class,` line (config/app.php ~251) | exact |
| `app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php` | middleware | request-response | `app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php` | exact |
| `app/Profitability/routes/profitability.php` | route | request-response | `app/Microsoft365/routes/microsoft365.php` | exact |
| `app/Profitability/Http/Controllers/*` (ContractTerms, Plan, Projects/Clients/People views, CostRates, WorkWeeks, Assignments, AbsenceProjects, Summary) | controller | CRUD + request-response | `app/Microsoft365/Http/Controllers/OutlookSeriesController.php` (404-not-403 lookup, idempotent writes) | role-match |
| `app/Profitability/Http/Requests/*` | request | request-response | `app/Microsoft365/Http/Requests/MeetingConversionRequest.php` | exact |
| `app/Profitability/Http/Resources/*` (hours shape + money shape) | resource | transform | `app/Microsoft365/Http/Resources/OutlookMeetingResource.php` (explicit allow-list) | exact |
| `app/Profitability/Models/*` (8 models) | model | CRUD | `app/Microsoft365/Models/OutlookSeriesSetting.php` | exact |
| `app/Profitability/database/migrations/*` (8 tables) | migration | CRUD | `app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php` | exact |
| `app/Profitability/Access/AccessScope.php`, `ProfitabilityAccess.php` | service/DTO | request-response | `app/Microsoft365/Graph/GraphAccessGuard.php` (guard shape; not read, name only) + `PermissionStore::getMember` | partial |
| `app/Profitability/Console/RenewPeriodsCommand.php`, `ReportNonBillableCommand.php` | command | batch | `app/Microsoft365/Console/CheckOutOfSyncCommand.php` | exact |
| `app/Profitability/Periods/PeriodCalendar.php`, `PlanDistributor.php`; `Reporting/Projection.php`, `AvailableHoursCalculator.php` | utility (pure) | transform | `app/Microsoft365/OutOfSync/OutOfSyncRules.php` | exact |
| `app/Profitability/Periods/PeriodMaterializer.php` | service | batch/CRUD | `OutlookSeriesController::ensureSetting` (insertOrIgnore idempotency) | partial |
| `app/Profitability/Reporting/ConsumptionQuery.php`, `ProjectBalanceService`, `ClientRollupService`, `ChargeabilityService` | service | batch (SQL aggregation) | `app/Service/TimeEntryAggregationService.php` (LATERAL at ~l.59) + `TimezoneService::getLocalDateTimeSqlExpression` | role-match |
| `app/Profitability/TimeEntries/EnforceBillableOnBillableProject.php` | listener | event-driven | `TimeEntry::booted()` saving hook (`app/Models/TimeEntry.php` l.131-145) | role-match |
| `config/profitability.php` | config | n/a | `config/microsoft365.php` | exact |
| `lang/en/profitability.php`, `lang/es/profitability.php` | config | n/a | `lang/en/microsoft365.php`, `lang/es/microsoft365.php` | exact |
| `resources/js/Pages/Profitability.vue` | page | request-response | `resources/js/Pages/Goals.vue` (AppLayout + MainContainer + PageTitle + TabBar) | exact |
| `resources/js/profitability/api.ts`, `types.ts`, `format.ts` | utility | request-response | `resources/js/m365/calendar/meetingsApi.ts` | exact |
| `resources/js/profitability/*View.vue`, `ProfitabilityPage.vue`, `ProjectSummaryCard.vue`, editors | component | request-response | `resources/js/m365/calendar/OutlookSyncFlagCounter.vue` (conventions) + `Pages/Goals.vue` (layout) | role-match |
| `resources/js/profitability/Planned*Chart.vue`, `ChargeabilityChart.vue`, `ClientMarginChart.vue` | component | transform | `resources/js/Components/Common/Reporting/ReportingChart.vue` | exact |
| `resources/js/Layouts/AppLayout.vue` (edit: nav item) | component (core seam) | n/a | `Goals` NavigationSidebarItem l.241-246 | exact |
| `resources/js/Pages/ProjectShow.vue` (edit: summary card) | page (core seam) | n/a | insertion point l.154-156 | exact |
| `tests/Unit/Profitability/*Test.php` (pure calculators) | test | n/a | `tests/Unit/Microsoft365/OutOfSyncRulesTest.php` | exact |
| `tests/Unit/Profitability/ProfitabilityLangTest.php` | test | n/a | `tests/Unit/Microsoft365/MicrosoftLangTest.php` | exact |
| `tests/Unit/Profitability/ForkIsolationTest.php` | test | n/a | `tests/Unit/Microsoft365/ForkIsolationTest.php` | exact |
| `tests/Feature/Profitability/*Test.php` | test | request-response | `tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php` + `Tests\TestCaseWithDatabase::createUserWithRole` | exact |
| `resources/js/profitability/*.test.ts` | test | n/a | `resources/js/m365/calendar/OutlookSyncFlagCounter.test.ts`, `meetingsApi.test.ts` | exact |
| `docs/m365/TOUCHED-CORE-FILES.md` (edit: new Phase 8 section) | docs | n/a | existing "Phase 6" section (l.292+) | exact |

## Pattern Assignments

### `app/Profitability/ProfitabilityServiceProvider.php` (provider)

**Analog:** `app/Microsoft365/Microsoft365ServiceProvider.php` (l.1-65) and `app/Appearance/AppearanceServiceProvider.php` (l.28-39).

Copy exactly: plain `bind` in `register()`, `pushMiddlewareToGroup('web', ...)`, `loadRoutesFrom`, `loadMigrationsFrom`, console-only `commands([...])`, `callAfterResolving(Schedule::class, ...)` with `withoutOverlapping()`, and a private `configString()` helper.

```php
public function boot(Router $router): void
{
    $router->pushMiddlewareToGroup('web', ShareMicrosoftInertiaData::class);
    $this->loadRoutesFrom(__DIR__.'/routes/microsoft365.php');
    $this->loadMigrationsFrom(__DIR__.'/database/migrations');
    if ($this->app->runningInConsole()) {
        $this->commands([MicrosoftCheckCommand::class, CheckOutOfSyncCommand::class]);
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('m365:check-out-of-sync')
                ->dailyAt($this->configString('microsoft365.out_of_sync.daily_at', '05:30'))
                ->timezone($this->configString('microsoft365.out_of_sync.daily_timezone', 'Europe/Madrid'))
                ->withoutOverlapping();
        });
    }
}
private function configString(string $key, string $default): string
{
    $value = config($key);
    return is_string($value) && $value !== '' ? $value : $default;
}
```

Model-event hook: register `TimeEntry::saving([EnforceBillableOnBillableProject::class, 'handle'])` in `boot()` (Appearance registers its hook the same place: `Event::listen(BeforeOrganizationDeletion::class, DeleteOrganizationIconFile::class);` l.35). Docblock must say "only thing core knows about: one line in config/app.php" and "Inertia data is deliberately not shared from boot(): Octane flushes shared props".

---

### `app/Profitability/Http/Middleware/ShareProfitabilityInertiaData.php` (middleware)

**Analog:** `app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php` (l.27-75).

```php
public function handle(Request $request, Closure $next): Response
{
    Inertia::share('microsoft', function () use ($request): array {
        if (! $this->config->isConfigured()) { return ['enabled' => false]; }
        $data = ['enabled' => true, 'login_url' => route('microsoft.redirect'),
                 'labels' => ['sign_in' => __('microsoft365.ui.sign_in')]];
        ...
        return $data;
    });
    return $next($request);
}
```

Labels helper to copy (l.134-147): resolve every key of `trans('profitability', [], 'en')` through `__()`, so the key set always comes from the English file. Share only flags, `url`, `views`, `labels` (RESEARCH "Fork Inertia share"). Use `url('profitability')` for the nav href (m365 does `url('m365/out-of-sync')`, l.94). Skip computation while impersonating the way m365 does with `GraphAccessGuard::blocked()` only if a write path needs it; reads are computed from the authenticated user.

---

### `app/Profitability/routes/profitability.php` (route)

**Analog:** `app/Microsoft365/routes/microsoft365.php` (l.28-92).

```php
Route::middleware(['web', 'auth:web', 'auth.session', 'verified'])
    ->prefix('m365')
    ->group(function (): void {
        Route::post('/organizations/{organization}/meetings/time-entries', [MeetingConversionController::class, 'store'])
            ->whereUuid('organization')
            ->middleware(['check-organization-blocked', 'throttle:30,1,m365-convert:'])
            ->name('microsoft.meetings.convert');
        Route::post('/meetings/{meeting}/dismiss', [OutlookMeetingController::class, 'dismiss'])
            ->whereUuid('meeting')->middleware('throttle:60,1,m365-dismiss:');
```

Rules to copy: web group only (never `api/`, never in `routes/web.php`), parameter must be literally named `organization` so `check-organization-blocked` works on write routes, `->whereUuid([...])` on every id, per-route `throttle:N,1,<prefix>:`, one comment per route stating the 404-not-403 rule. Use `profitability` prefix and the Inertia page route `GET /profitability` with name `profitability`.

---

### Controllers (`app/Profitability/Http/Controllers/*`)

**Analog:** `app/Microsoft365/Http/Controllers/OutlookSeriesController.php`.

Copy: `Illuminate\Routing\Controller` base (not the API `Controller`), constructor-injected guard, tiny actions returning `response()->noContent()`/Resources, and the single private "own lookup" that turns every non-visible id into the same 404 (l.73-93):

```php
if ($this->access->blocked()) {
    throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
}
$user = $request->user();
assert($user instanceof User);
$meeting = OutlookMeeting::query()->where('user_id', '=', $user->getKey())->whereKey($id)->whereNull('gone_at')->firstOrFail();
```

Phase 8 adaptation: replace the user filter with `AccessScope` (`forUser($organization, $user)`), always filter `where('organization_id', $organization->getKey())`, and throw `ModelNotFoundException` when the scope does not cover the project/client/member. Idempotent upserts follow `ensureSetting` (l.99-111): `Model::query()->insertOrIgnore([... 'id' => Str::uuid()->toString(), 'created_at' => $now, 'updated_at' => $now])` relying on the unique index; use this for `PeriodMaterializer` and assignment adds. Controller docblock states who may write what (D-12, A7) and "no id of a user is accepted".

---

### Form Requests (`app/Profitability/Http/Requests/*`)

**Analog:** `app/Microsoft365/Http/Requests/MeetingConversionRequest.php` (l.32-157). Fork requests live in the module, extend `Illuminate\Foundation\Http\FormRequest`, `authorize(): bool { return true; }` (authorization is the controller's `AccessScope` check), typed `rules()` with `@return array<string, array<int, string|Closure|ValidationRule|...>>`, public `const` limits, and typed accessor methods over `validated()`:

```php
public function rules(): array
{
    return [
        'meeting_ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEETINGS],
        'meeting_ids.*' => ['required', 'string', 'uuid', 'distinct'],
        'project_id' => [Rule::requiredIf($explicit), 'string', 'uuid'],
        'start' => ['nullable', 'string', 'date_format:'.self::FORMAT, 'required_with:end', ...],
    ];
}
public function projectId(): string { return (string) $this->validated('project_id'); }
```

Phase 8: `Rule::enum(ContractSchedule::class)`, `date_format:Y-m-d`, `integer|min:0` for cents/seconds, `Rule::requiredIf` for one-off `ends_on`, `after:starts_on`; organization id comes from the route, never the body.

---

### Resources (`app/Profitability/Http/Resources/*`)

**Analog:** `app/Microsoft365/Http/Resources/OutlookMeetingResource.php` (l.26-62): `public static $wrap = 'data'`, `@property Model $resource`, explicit allow-list, never `toArray()` of the model.

```php
public function toArray(Request $request): array
{
    return [
        'id' => $this->resource->id,
        'start' => $this->resource->starts_at->utc()->format(self::FORMAT),
        ...
    ];
}
```

Phase 8 rule (RESEARCH Pitfall 4): build `hours()` and `money()` arrays and merge `money()` only when `AccessScope` allows; keys must be absent, not null.

---

### Models (`app/Profitability/Models/*`)

**Analog:** `app/Microsoft365/Models/OutlookSeriesSetting.php` (l.1-57):

```php
use App\Models\Concerns\HasUuids;
class OutlookSeriesSetting extends Model
{
    use HasUuids;
    /** @var string */ protected $table = 'outlook_series_settings';
    /** @var list<string> */ protected $fillable = [...];
    /** @var array<string, string> */ protected $casts = ['ignored_at' => 'datetime'];
}
```

Copy: `@property` docblock for every column, `HasUuids` from `App\Models\Concerns`, explicit `$table`/`$fillable`/`$casts`, and the docblock "Deliberately not audited and not in Filament" (do NOT add `Auditable` to cost tables, V7/V8). Cast dates as `'date'`, money/seconds as `'integer'`.

---

### Migrations (`app/Profitability/database/migrations/2026_11_*`)

**Analog:** `app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php` (l.9-57): anonymous `return new class extends Migration`, `declare(strict_types=1)`, `uuid('id')->primary()`, FKs with `->cascadeOnDelete()->cascadeOnUpdate()`, comment explaining that the cascade lives in the DB because core bulk-deletes without Eloquent events, composite `unique([...])`, `dropIfExists` in `down()`.

```php
$table->uuid('time_entry_id')->unique();
$table->foreign('time_entry_id')->references('id')->on('time_entries')->cascadeOnDelete()->cascadeOnUpdate();
$table->unique(['user_id', 'graph_id']);
```

Apply to every table in the RESEARCH Data Model; each carries `organization_id` FK to `organizations`.

---

### Commands (`RenewPeriodsCommand`, `ReportNonBillableCommand`)

**Analog:** `app/Microsoft365/Console/CheckOutOfSyncCommand.php` (l.23-80): `$signature` with `--dry-run`, `$description`, `handle(): int` returning `self::SUCCESS`, output holds counts only (`$this->line('users: '.count(...))`), config read through a typed private helper (`is_int($value) && $value >= 0 ? $value : 10`). `ReportNonBillableCommand` is read-only: print project/hours counts, no names beyond what is needed. Do not dispatch jobs from outside `app/Profitability/Console/` (mirrors ForkIsolationTest).

---

### Pure calculators (`PeriodCalendar`, `PlanDistributor`, `Projection`, `AvailableHoursCalculator`)

**Analog:** `app/Microsoft365/OutOfSync/OutOfSyncRules.php` (l.1-50): `final class`, header docblock listing every owner rule in evaluation order with decision ids (D-xx), `public const int`, `private const string FORMAT`, caller passes `CarbonImmutable $now` (no clock, no DB):

```php
final class OutOfSyncRules
{
    public const int WINDOW_DAYS = 60;
    public function decide(LinkState $link, Observation $seen, CarbonImmutable $now): Decision
```

Phase 8 classes are `final`, static or constructor-free, take `CarbonImmutable` for "today", return small readonly DTOs (like `Decision`, `LinkState` in `app/Microsoft365/OutOfSync/`).

---

### `ConsumptionQuery` and report services

**Analog:** `app/Service/TimeEntryAggregationService.php` (LATERAL join ~l.59, read before writing) plus `app/Service/TimezoneService.php` l.340-359:

```php
public function getLocalDateTimeSqlExpression(string $column, CarbonTimeZone $timeZone): array
// returns ['sql' => '("start" AT TIME ZONE \'UTC\' AT TIME ZONE CAST(? AS text))', 'bindings' => [$tz]]
```

Use `['sql' => $sql, 'bindings' => $b]` in `DB::select`/`selectRaw` with bindings; column name must match `/^[a-z_]+$/i` (so call with `'start'`, not `'te.start'`; alias in a subquery/CTE if a table prefix is needed). SQL shape is in RESEARCH Pattern 4.

---

### `EnforceBillableOnBillableProject` (listener)

**Analog:** `app/Models/TimeEntry.php` `booted()` l.131-145 (saving hook shape). Guard on `type === TimeEntryType::Work`, `project_id !== null`, `! billable`; then force `billable = true` and `$entry->setComputedAttributeValue('billable_rate')` (RESEARCH Pattern 2, Pitfall 1). Must not touch break entries.

---

### `ProfitabilityAccess` / `AccessScope`

No fork analog that resolves per-org scope. Use `app(PermissionStore::class)->getMember($organization, $user)` (scoped, Octane-safe, `app/Providers/AppServiceProvider.php` l.105) and `App\Enums\Role` (`Owner`, `Admin`). Plain-bind in provider, never cache in statics.

---

### `lang/{en,es}/profitability.php` and `ProfitabilityLangTest`

**Analog:** `lang/en/microsoft365.php` (nested arrays `ui`, `calendar`, `declare(strict_types=1)`, `:placeholder` syntax) and `tests/Unit/Microsoft365/MicrosoftLangTest.php`. Copy the test wholesale and change the file name and the English/Spanish anchor assertion (`'Profitability'` / `'Rentabilidad'`); keep the four tests (same dotted keys, no empty values, anchors, placeholders via `/:[a-z_]+/`). NB: UI-SPEC uses `{name}` in prose; the lang files must use Laravel `:name` so the placeholder test works.

---

### `config/profitability.php`

**Analog:** `config/microsoft365.php`: `declare(strict_types=1)`, banner comment, plain array. Keys: `timezone` (`'Europe/Madrid'`), `at_risk_threshold` (1.10), `run_rate_min_weekdays` (5). No `env()` calls needed (PHPStan `noEnvCallsOutsideOfConfig`).

---

### `resources/js/Pages/Profitability.vue` (page, new in core dir)

**Analog:** `resources/js/Pages/Goals.vue` l.1-40 (shell). Page = `AppLayout` + `MainContainer` header (`py-5 border-b border-default-background-separator flex justify-between items-center`) + `PageTitle` + `TabBar`:

```vue
<AppLayout title="Goals" data-testid="goals_view">
    <MainContainer class="py-5 border-b border-default-background-separator flex justify-between items-center">
        <div class="flex items-center space-x-6">
            <PageTitle :icon="Target" title="Goals"></PageTitle>
            <TabBar v-model="activeTab"> <TabBarItem value="active">Active</TabBarItem> </TabBar>
```

Keep `Profitability.vue` a thin wrapper importing `@/profitability/ProfitabilityPage.vue`; imports use `@/Layouts/AppLayout.vue`, `@/packages/ui/src/MainContainer.vue`, `@/Components/Common/PageTitle.vue`, `{ TabBar, TabBarItem } from '@/packages/ui/src'`, icons from `@lucide/vue`. Inertia route `GET /profitability` is defined in the fork routes file with `Inertia::render('Profitability')`, not in `routes/web.php`.

---

### `resources/js/profitability/api.ts` (+ `types.ts`, `format.ts`)

**Analog:** `resources/js/m365/calendar/meetingsApi.ts` (l.1-206). Global `axios` (web routes, XSRF), never the generated client; defensive runtime parsers (`isRecord`, `isString`, `stringOrNull`, `numberOrNull`) so malformed payloads degrade; ids `encodeURIComponent`'d:

```ts
import axios from 'axios';
// The fork routes are web-group routes (session cookie + XSRF), so they use the global axios
// instance and never the generated OpenAPI client, which must not know about fork routes.
export async function fetchMeetings(url: string, range: MeetingsRange, options = {}) {
    const response = await axios.get<OutlookMeetingsResponse>(url, { params: { ... } });
    const body = response.data;
    return { data: parseMeetings(body?.data), ... };
}
await axios.post(`${meetingsUrl}/${encodeURIComponent(id)}/dismiss`);
```

Money keys: parsers must leave a money key absent when absent (UI-SPEC "Money keys": `'amount_cents' in row`). Query keys `['profitability', orgId, view, params]` (UI-D12), hooks as `use<Resource>Query` per CONVENTIONS.

---

### Vue components (`profitability/*View.vue`, editors, `ProjectSummaryCard.vue`)

**Analog:** `resources/js/m365/calendar/OutlookSyncFlagCounter.vue` l.1-30 conventions: `<script setup lang="ts">`, `@lucide/vue` icons, `Button` from `@/packages/ui/src/Buttons/Button.vue`, tooltip family from `@/packages/ui/src/tooltip`, header comment citing decision ids, labels read from a context/props object (not hard-coded), `computed` visibility flags. Layout analogs: `Card` (`@/Components/Common/Card.vue`), `CardTitle` (`@/packages/ui/src/CardTitle.vue`), `Badge`, `formatCents` (`ProjectShow.vue` imports `formatCents` from `../packages/ui/src/utils/money` and `getOrganizationCurrencyString` from `../utils/money`), `useTableSortState` (`@/utils/useTableSortState`), `useOrganizationQuery(getCurrentOrganizationId()!)` for currency formats.

Labels reach components through `page.props.profitability.labels` (Inertia shared prop) like m365's `labels`.

---

### Chart components

**Analog:** `resources/js/Components/Common/Reporting/ReportingChart.vue` l.1-60:

```ts
import VChart, { THEME_KEY } from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { useCssVariable } from '@/packages/ui/src';
use([CanvasRenderer, BarChart, TitleComponent, GridComponent, TooltipComponent, LegendComponent]);
provide(THEME_KEY, 'dark');
const accentColor = useCssVariable('--theme-color-chart');
const labelColor = useCssVariable('--color-text-secondary');
const splitLineColor = useCssVariable('--color-border-tertiary');
// colour usage: 'rgba(' + accentColor.value + ',0.7)'
```

Copy not import (UI-SPEC); add `ScatterChart` for the target tick and `LegendComponent` as needed.

---

### Core seam: `AppLayout.vue` nav item

**Analog:** l.241-246 (Goals item), insert directly after it in the same `<ul>`:

```vue
<NavigationSidebarItem
    v-if="canViewGoals()"
    title="Goals"
    :icon="Target"
    :current="route().current('goals')"
    :href="route('goals')"></NavigationSidebarItem>
```

New item: `v-if="page.props.profitability?.enabled"`, `:icon="TrendingUp"`, `:title="page.props.profitability.labels.nav"`, `:href="page.props.profitability.url"`, `:current` via `route().current('profitability')`. `page` is already in scope (used at l.314). Ledger it.

### Core seam: `ProjectShow.vue`

Insert between l.154 (`</MainContainer>` of header) and l.155 (`<MainContainer>` of the grid): `<MainContainer><ProjectSummaryCard :project-id="projectId" /></MainContainer>` with one import near the other imports (l.1-37). `projectId` const exists (l.~46). Ledger it.

---

### Tests

**Pure unit tests** (`tests/Unit/Profitability/*`): analog `tests/Unit/Microsoft365/OutOfSyncRulesTest.php`: extends `Tests\TestCase` (no DB), `#[CoversClass(...)]`, `private const string NOW = '2026-12-01 08:00:00'` fixed clock, `#[DataProvider]`, docblock "proven without a database". Arrange/Act/Assert comments.

**ForkIsolationTest**: analog `tests/Unit/Microsoft365/ForkIsolationTest.php`: `File::allFiles(app_path())` scan, `LEDGER_PREFIXES`, `assertGreaterThanOrEqual(100, count($paths))`. For Phase 8 add: (a) a scan asserting no `App\Profitability` reference outside `app/Profitability/`, the provider line in `config/app.php`, tests and `lang`; (b) the existing ledger-path-exists test already covers new ledger rows (only add rows for files that exist).

**Feature tests** (`tests/Feature/Profitability/*`): analog `tests/Feature/Microsoft365/OutlookMeetingEndpointTest.php` (l.1-80): `extends TestCaseWithDatabase`, `#[CoversClass]`/`#[UsesClass]` attributes, private fixture helpers, rows made with `Model::query()->create([...])` (no fork factories). Users via `$this->createUserWithRole(Role::Employee)` (`tests/TestCaseWithDatabase.php` l.58-84) returning `{user, organization, member, owner, ownerMember}`; for the authorization matrix create assignments with `ProjectManager::query()->create([...])`. CI-only (no local Postgres).

**Vitest**: analog `resources/js/m365/calendar/OutlookSyncFlagCounter.test.ts`: `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'`, `mount` from `@vue/test-utils`, label fixtures cast `as XLabels`, co-located `*.test.ts`; and `meetingsApi.test.ts` for the axios parsers.

---

## Shared Patterns

### Fork isolation + ledger
**Source:** `docs/m365/TOUCHED-CORE-FILES.md` (per-phase sections "Core files edited / New files inside core directories / Fork-owned paths / Hot files deliberately not touched / Reconciliation"). Add a "Phase 8" section listing: edited `config/app.php`, `resources/js/Layouts/AppLayout.vue`, `resources/js/Pages/ProjectShow.vue`; new in core dirs `resources/js/Pages/Profitability.vue`, `config/profitability.php`, `lang/en/profitability.php`, `lang/es/profitability.php`, `e2e/profitability-*.spec.ts`; fork-owned `app/Profitability/`, `resources/js/profitability/`, `tests/Unit/Profitability/`, `tests/Feature/Profitability/`. Backticked paths must exist and contain no globs, braces, colons or whitespace (ForkIsolationTest filter), so list concrete files, not `*.spec.ts`, in backticks. Run `tests/Tools/m365-merge/ledger-check.sh`.

### 404 instead of 403 for out-of-scope ids
**Source:** `OutlookSeriesController::ownSeries` (l.73-93) and routes comment "a foreign or unknown id is a plain 404 (never a 403 oracle)". Apply to every Profitability endpoint, plus the summary endpoint (Vue renders nothing on 404).

### Web-guard middleware stack
**Source:** `app/Microsoft365/routes/microsoft365.php` l.28: `['web', 'auth:web', 'auth.session', 'verified']`; write routes add `check-organization-blocked` and `throttle:N,1,<prefix>:`. Apply to all routes; never register in `routes/web.php`/`routes/api.php`.

### Octane-safe wiring
**Source:** both providers: plain `bind`, share Inertia from a `web` middleware, no statics. Apply to every service and the access resolver.

### Idempotent insert with unique index
**Source:** `OutlookSeriesController::ensureSetting` l.99-111 (`insertOrIgnore` with `Str::uuid()`). Apply to period/plan-month materialization, assignments, absence markers.

### Money redaction
**Source:** design rule (RESEARCH Pitfall 4) over the `OutlookMeetingResource` allow-list pattern. Keys absent, never null; shared Inertia prop holds flags/URLs/labels only.

### Localization
**Source:** `lang/en/microsoft365.php` + `MicrosoftLangTest`. App locale stays `en`; Spanish prepared with identical keys (D-17).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `app/Profitability/Access/ProfitabilityAccess.php` / `AccessScope.php` | service | request-response | No fork class resolves per-organization, assignment-based scope; build on `PermissionStore::getMember` and `Role` (RESEARCH Pattern 5) |
| `app/Profitability/Reporting/ConsumptionQuery.php` (dated-cost `LEFT JOIN LATERAL`) | service | batch | Only partial: `TimeEntryAggregationService` has a LATERAL but no dated-cost join (read it before writing); SQL is in RESEARCH Pattern 4 |
| `BudgetMeter.vue`, `PlanGrid.vue`, `PersonSettingsDialog.vue`, `ContractEditor.vue` | component | request-response | No existing meter/grid-editor in fork; use UI-SPEC anatomy and core UI-package primitives (`DialogModal`, `field`, `number-field`, `DatePicker`) |

## Metadata

**Analog search scope:** `app/Microsoft365`, `app/Appearance`, `resources/js/m365`, `tests/Unit/Microsoft365`, `tests/Feature/Microsoft365`, `tests/TestCaseWithDatabase.php`, `config/`, `lang/en`, `resources/js/Pages`, `resources/js/Layouts/AppLayout.vue`, `resources/js/Components/Common/Reporting`, `app/Service/TimezoneService.php`, `app/Models/TimeEntry.php`
**Files read:** ~25; all analog paths confirmed tracked (`git ls-files`), none are `.gsd` capability mirrors
**Pattern extraction date:** 2026-11-27
