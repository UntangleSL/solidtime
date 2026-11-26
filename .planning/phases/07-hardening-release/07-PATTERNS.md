# Phase 7: Hardening & Release - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 14 new/modified (plus docs edits)
**Analogs found:** 13 / 14

All analog paths were read this session and live in tracked source (`app/Microsoft365/**`, `tests/**`, `e2e/**`, `docs/**`). None is a `.gsd/capabilities` mirror. Run `git ls-files -- <path>` once before the plan names any new path.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/Microsoft365/Http/Controllers/MicrosoftAuthController.php` (modify: guard connect branch + callback) | controller | request-response | itself (lines 51-113) + `GraphAccessGuard` usage in `OutlookSeriesController` | exact |
| `app/Microsoft365/Http/Controllers/MicrosoftAccountController.php` (modify) or route middleware | controller | CRUD | `app/Microsoft365/Http/Middleware/EnsureMicrosoftIsEnabled.php` | role-match |
| `app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php` (new) | middleware | request-response | `EnsureMicrosoftIsEnabled.php` | exact |
| `app/Microsoft365/routes/*.php` (modify: add middleware to `DELETE /user/microsoft`) | route | request-response | same file, lines 17-20 | exact |
| `app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php` (modify: skip `account` while blocked) | middleware | request-response | same file, calendar block | exact |
| `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` (new, SEC-03) | test | CRUD | `OutlookSeriesSettingsTest::test_settings_are_deleted_with_the_user` | exact |
| `tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` (new, SEC-04) | test | request-response | `OutlookMeetingPrivacyTest::test_impersonation_hides_meetings_and_blocks_graph` | exact |
| `tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` (new, OPS-02) | test | request-response | `OutlookOutOfSyncScheduleTest` + `MicrosoftRedirectTest` | role-match |
| `tests/Unit/Microsoft365/ForkIsolationTest.php` (new) | test | static check | `tests/Unit/Microsoft365/MicrosoftConfigTest.php` (location/namespace only) | partial |
| `e2e/outlook-off-switch.spec.ts` (new) | test | request-response | `e2e/microsoft-signin.spec.ts`, `e2e/outlook-meeting-look.spec.ts` | exact |
| `docs/deploy/dokploy-compose.fork.yml` (modify: 2 healthchecks, image pin) | config | n/a | same file, `app` healthcheck lines 80-88 | exact |
| `docs/m365/TOUCHED-CORE-FILES.md` (modify) | docs | n/a | same file, table rows | exact |
| `docs/m365/UPSTREAM-MERGE.md` (new) | docs | n/a | RESEARCH.md Pattern 4 commands | partial |
| `docs/m365/GUIA-ADMIN-ENTRA.md`, `RUNBOOK-entra-app.md` (modify) | docs | n/a | themselves + `validate-docs.mjs` rules | exact |

## Pattern Assignments

### `app/Microsoft365/Http/Middleware/EnsureNotImpersonating.php` (middleware, request-response)

**Analog:** `app/Microsoft365/Http/Middleware/EnsureMicrosoftIsEnabled.php` (whole file, 31 lines). Copy this shape and swap the check:

```php
namespace App\Microsoft365\Http\Middleware;

use Closure; use Illuminate\Http\Request; use Symfony\Component\HttpFoundation\Response;

class EnsureMicrosoftIsEnabled
{
    public function __construct(private readonly MicrosoftConfig $config) {}

    /** @param  Closure(Request): Response  $next */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->config->isConfigured()) {
            abort(404);
        }
        return $next($request);
    }
}
```
New version: inject `App\Microsoft365\Graph\GraphAccessGuard`, `if ($this->access->blocked()) { abort(404); }`. Do not add a second `isImpersonating()` read.

### `routes` file (route) - add the middleware to Disconnect only

**Analog:** the existing group (routes file lines 17-20):
```php
Route::middleware(['web', EnsureMicrosoftIsEnabled::class, 'auth:web', 'auth.session', 'verified'])->group(function (): void {
    Route::delete('/user/microsoft', [MicrosoftAccountController::class, 'destroy'])->name('microsoft.account.destroy');
});
```
Add `EnsureNotImpersonating::class` to this group's array. Do NOT add it to the `/auth/microsoft/*` guest group (the same `redirect` route serves guests).

### `MicrosoftAuthController.php` (controller, request-response) - guard connect

**Analog:** itself. Gap points: `redirect()` connect branch (lines 61-73) and `callback()` before the intent pull (lines 98-113).
```php
if ($connect) {
    $request->session()->put(self::INTENT_SESSION_KEY, self::CONNECT_INTENT);
    $request->session()->put(self::CONNECT_USER_SESSION_KEY, Auth::guard('web')->id());
```
Pattern to add: constructor/method-injected `GraphAccessGuard`; `if ($connect && $this->access->blocked()) { abort(404); }` placed right after the `$connect && ! $isAuthenticated` check (line 57-59), so the branch order stays binding. In `callback()`, when `blocked()`, pull and forget the three session keys (read-and-forget convention at lines 98-100), then `abort(404)`. 404 (not 403) is the D-14/D-22 convention used by `OutlookSeriesController` and `OutOfSyncController`.

### `ShareMicrosoftInertiaData.php` (middleware) - hide `account` while blocked

**Analog:** same file, lines ~56-71. The calendar block already does it right:
```php
if ($request->routeIs('calendar') && ! $this->access->blocked()) {
```
Change the profile block from `if ($request->routeIs('profile.show')) {` to `if ($request->routeIs('profile.show') && ! $this->access->blocked()) {`. `$this->access` is already injected. `MicrosoftConnectionForm.vue` renders nothing when `account` is null (no frontend change).

### `docs/deploy/dokploy-compose.fork.yml` (config) - healthchecks

**Analog:** the `app` service healthcheck (lines 80-88) for YAML style (list-form `test`, `interval/timeout/retries`):
```yaml
    healthcheck:
      test:
        - CMD
        - curl
        - --fail
        - http://localhost:8000/health-check/up
      interval: 30s
      timeout: 10s
      retries: 5
```
Add under `scheduler:` (after its environment block, service starts line 89) and `queue:` (starts line 144):
```yaml
    healthcheck:
      test:
        - CMD
        - healthcheck
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```
Also bump the three `image: ghcr.io/untanglesl/solidtime:sha-d379903` pins (app, scheduler, queue) to the merged build's tag at deploy time; keep the old tag in the runbook as rollback. Fallbacks (RESEARCH Pattern 5): `CMD-SHELL supervisorctl status worker:worker_0 | grep -q RUNNING`, then `healthcheck: {disable: true}`.

### `tests/Feature/Microsoft365/MicrosoftImpersonationMatrixTest.php` (test, request-response)

**Analog:** `tests/Feature/Microsoft365/OutlookMeetingPrivacyTest.php` (lines 1-60 imports/attributes, 175-262).

**Imports/traits:** `use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures; use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365; use Tests\TestCaseWithDatabase; use STS\FilamentImpersonate\ImpersonateManager;` plus `Http`, `Route`, `MicrosoftAccount` models. Helpers: `configureMicrosoft365()`, `createUser()`, `connectedAccount($user, expired: true)`, `fakeTokenEndpoint([...])`, `fakeMicrosoftGateway()->willReturn($this->microsoftIdentity())`.

**Impersonation helper (lines ~186-190):**
```php
private function startImpersonation(): void
{
    // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
    session()->put(ImpersonateManager::SESSION_KEY, 1);
}
```

**Arrange/act/assert shape (lines ~215-247):** `configureMicrosoft365(); $user = createUser(); connectedAccount($user); Http::fake(); actingAs($user); $control = ...; startImpersonation(); ...; assertNotFound(); ...; Http::assertNothingSent();` Add a before/after row snapshot using the `accountRow()` helper (`(array) DB::table('microsoft_accounts')->where('id', '=', $account->getKey())->first()`, lines ~199-205) to prove no row changed.

**Rows to add:** `microsoft.redirect?intent=connect` (404 and session keys not set), `microsoft.callback` with a fake gateway (404, `authenticateCalls() === 0`, identity not linked), `microsoft.account.destroy` (404, `refresh_token` still not null), profile page prop has no `microsoft.account`. **Route canary:** iterate `Route::getRoutes()` for actions whose controller is in `App\Microsoft365\Http\Controllers` and fail if absent from the matrix list. **Static canary:** `CheckOutOfSyncForUser::dispatch` appears only in `app/Microsoft365/Console/CheckOutOfSyncCommand.php` (File::allFiles + str_contains, as `OutlookMeetingPrivacyTest` already imports `File`).

### `tests/Feature/Microsoft365/MicrosoftDataCleanupTest.php` (test, CRUD)

**Analog:** `OutlookSeriesSettingsTest.php` lines 553-572:
```php
$other = User::factory()->create();
OutlookSeriesSetting::query()->create([
    'user_id' => $other->getKey(), 'series_master_id' => self::SERIES, 'ignored_at' => '2026-10-19 08:00:00',
]);
app(DeletionService::class)->deleteUser($data->user);
$this->assertSame(0, OutlookSeriesSetting::query()->where('user_id', '=', $data->user->getKey())->count());
$this->assertSame(1, OutlookSeriesSetting::query()->where('user_id', '=', $other->getKey())->count());
```
Extend across all five tables (`microsoft_accounts`, `outlook_meetings`, `outlook_sync_windows`, `outlook_meeting_links`, `outlook_series_settings`) with a second surviving user. Further cases: non-owner member (placeholder path, entries survive, link gone), `delete_related` member removal, `deleteOrganization` (links gone, accounts kept). Existing partial coverage: `OutlookMeetingLinkLifecycleTest.php:291`. **Schema guard:** query `information_schema` for FKs with `delete_rule = 'CASCADE'`, deriving the table list from `app/Microsoft365/database/migrations`, so a future fork table without a cascade fails. No new production code (no `DeletionService` hook, no `BeforeUserDeletion` listener).

### `tests/Feature/Microsoft365/MicrosoftOffSwitchTest.php` (test, request-response)

**Analog:** `OutlookOutOfSyncScheduleTest.php` lines 35-75 for the schedule portion:
```php
private function dailyChecks(): array
{
    $this->app->forgetInstance(Schedule::class);
    $events = array_filter(app(Schedule::class)->events(),
        fn (Event $event): bool => is_string($event->command) && str_ends_with($event->command, 'm365:check-out-of-sync'));
    return array_values($events);
}
// ...
$this->assertCount(1, $events);
$this->assertFalse($events[0]->filtersPass($this->app));
```
For the 404 sweep reuse the route canary from the matrix test; for configured vs unconfigured toggling use `configureMicrosoft365()` and `Config::set('microsoft365...')` (as in the schedule test, line 81). Assert: every `microsoft.*` route 404; calendar page has `microsoft.enabled === false` and no `calendar`/`account`; seeded fork rows intact; re-configuring restores endpoints and rows.

### `tests/Unit/Microsoft365/ForkIsolationTest.php` (test, static)

**Analog:** location and namespace conventions of `tests/Unit/Microsoft365/*Test.php` (PHPUnit attributes `CoversClass`). Pure static canaries: dispatch-site check and "every non-added fork path is in `docs/m365/TOUCHED-CORE-FILES.md`" if feasible without git (CI checkout has no upstream remote; keep it text-based).

### `e2e/outlook-off-switch.spec.ts` (test, request-response)

**Analog:** `e2e/microsoft-signin.spec.ts` lines 1-40 (imports, logged-in fixture, off-state comment) and `e2e/outlook-meeting-look.spec.ts` lines 1-6 (calendar weekend helper).
```ts
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import { showCalendarWeekends } from './utils/calendar';
// ...
await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');
await loggedInExpect(page.getByTestId('microsoft-connection')).toHaveCount(0);
```
Go to `/calendar` and assert `toHaveCount(0)` for `outlook-calendar-controls`, `outlook-lane`, `outlook-entry-badge`, `outlook-selection-bar`, `outlook-out-of-sync`; register `page.on('request', ...)` and assert no URL contains `/m365/`. Assumption A6: the CI env leaves `SOLIDTIME_MICROSOFT_*` unset.

### Docs (ledger, merge runbook, Entra cleanup)

- **Ledger row format** (`docs/m365/TOUCHED-CORE-FILES.md` lines 8-18): `| File | Change | Plan | Merge note |`. Update the `Login.vue` row (add typed `canRegister?: boolean` default false, keep upstream `alternatives` slot, fork button after it) and `Profile/Show.vue` row (place `<MicrosoftConnectionForm />` immediately before `<LogoutOtherBrowserSessionsForm ... />`, after upstream's `v-if/v-else-if` block); add any new core touch (none expected: healthcheck is in docs/compose, the guard is in fork paths).
- **`docs/m365/UPSTREAM-MERGE.md`:** copy the commands from RESEARCH.md Pattern 4 (`git merge-tree --write-tree --name-only --no-messages HEAD upstream/main`, ledger completeness loop, `composer update laravel/socialite socialiteproviders/microsoft --no-scripts --no-install --ignore-platform-reqs`, never list `laravel/passport`, use `gh -R UntangleSL/solidtime`).
- **Entra edits:** `GUIA-ADMIN-ENTRA.md` replace `TEMPORAL` with `RETIRADO 2026-11-DD` on lines mentioning `m365-spike/callback` / `spike-AAAA-MM`; keep the text. `RUNBOOK-entra-app.md`: keep the `Redirect URIs` and `Caducidad del secreto spike` rows (ISO date prefix, append "eliminado"), keep the `## Limpieza tras el spike` heading, tick boxes, add one Historial row. Validate with `node tests/Tools/m365-spike/validate-docs.mjs guide|runbook|secrets` (baselines 117 / 30 / 2297 checks).

## Shared Patterns

### Impersonation guard (single seam)
**Source:** `app/Microsoft365/Graph/GraphAccessGuard.php` (stateless, fails closed, Octane safe)
**Apply to:** `EnsureNotImpersonating`, `MicrosoftAuthController`, `ShareMicrosoftInertiaData`
```php
public function blocked(): bool
{
    try { return app(ImpersonateManager::class)->isImpersonating(); }
    catch (Throwable) { return true; }
}
```
Never re-implement the check; never store its answer.

### Off switch
**Source:** `EnsureMicrosoftIsEnabled` (404 unless `MicrosoftConfig::isConfigured()`), `ShareMicrosoftInertiaData` returns `['enabled' => false]`, schedule `->when(isConfigured)` in `Microsoft365ServiceProvider`. Behaviour is already correct; Phase 7 only adds proof.

### Test scaffolding
**Source:** `tests/Feature/Microsoft365/Support/InteractsWithMicrosoft365.php` and `InteractsWithGraphFixtures.php`, base class `Tests\TestCaseWithDatabase`. Test names are `test_snake_case`; bodies use `// Arrange`, `// Act`, `// Assert` comments; every PHP file has `declare(strict_types=1);`. Feature tests run only in CI (Postgres), Gate B counts `PASS.*Microsoft365` lines.

### Style
Pint (strict types, void returns), PHPStan level 7 (no `env()` outside config), Prettier 4-space for TS, `@/` alias in Vue.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `docs/m365/UPSTREAM-MERGE.md` | docs | n/a | No prior merge runbook; use RESEARCH.md Pattern 4 verbatim. |

(Static dispatch-site canary in `ForkIsolationTest` has only a partial analog, a new test style in this repo.)

## Metadata

**Analog search scope:** `app/Microsoft365/**`, `tests/Feature/Microsoft365`, `tests/Unit/Microsoft365`, `e2e/`, `docs/deploy`, `docs/m365`
**Files read:** about 12 (partial reads of long files)
**Pattern extraction date:** 2026-11-26
