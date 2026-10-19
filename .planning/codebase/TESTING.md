---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
# Testing Patterns

**Analysis Date:** 2026-10-19

## Test Framework

**Backend (PHP):**
- PHPUnit (config `phpunit.xml`, bootstrap `vendor/autoload.php`). Test classes extend `Tests\TestCase` or `Tests\TestCaseWithDatabase`.
- Mocking: Mockery (`Mockery::mock`) plus Laravel fakes (`Mail::fake()`, `Http::preventStrayRequests()`, `Http::fake`, `Storage::fake`).
- Auth in tests: `Laravel\Passport\Passport::actingAs($user)`.
- Config: `phpunit.xml` sets `DB_CONNECTION=pgsql_test`, `CACHE_DRIVER=array`, `SESSION_DRIVER=array`, `QUEUE_CONNECTION=sync`, `MAIL_MAILER=array`, `BCRYPT_ROUNDS=4`.
- Static analysis is a separate gate: PHPStan level 7 (`phpstan.neon`) and Pint (`pint.json`).

**Frontend (TypeScript/Vue):**
- Vitest 4 (`vitest.config.ts`): `environment: 'happy-dom'`, `globals: false` (import `describe`, `it`, `expect` explicitly), setup file `resources/js/test-setup.ts`.
- Vue Test Utils (`@vue/test-utils`) for component mounting.
- Test include glob: `resources/js/**/*.{test,spec}.{ts,tsx}`; `e2e/` is excluded.

**E2E:**
- Playwright (`playwright.config.ts`, specs in `e2e/`, helpers in `playwright/`). Extension E2E tests run via `.github/workflows/playwright-extensions.yml`.

**Run Commands:**

```bash

# Backend

php artisan test                         # Or: vendor/bin/phpunit (runs Unit, Feature, Modules suites)
vendor/bin/phpunit --testsuite Unit      # Single suite (Unit | Feature | Modules)
vendor/bin/phpunit --filter ClientEndpointTest

# Frontend unit tests

npm run test:unit                        # vitest run
npm run test:unit:watch                  # vitest (watch mode)
npx vitest run resources/js/utils/timesheet/cellMath.test.ts   # Single file

# E2E

npm run test:e2e                         # rm -rf test-results/.auth && npx playwright test

# Static checks that run alongside tests in CI

npm run type-check                       # vue-tsc --noEmit
npm run lint
npm run format:check
vendor/bin/pint --test
vendor/bin/phpstan analyse
```

**Coverage:**
- No coverage threshold found in `phpunit.xml` or `vitest.config.ts`. Coverage is not enforced in CI.

## Test File Organization

**PHP location:**
- `tests/Unit/` mirrors `app/` namespaces and is the largest suite: `tests/Unit/Endpoint/Api/V1/`, `tests/Unit/Console/Commands/`, `tests/Unit/Database/`, `tests/Unit/Filament/`, `tests/Unit/Jobs/`, `tests/Unit/Model/`, and others.
- `tests/Feature/` holds HTTP/web flow tests (auth, registration, password reset, two-factor, profile, invitations): e.g. `tests/Feature/RegistrationTest.php`.
- `extensions/*/tests/Feature` and `extensions/*/tests/Unit` run as the "Modules" suite (files must end in `Test.php`).
- Base classes: `tests/TestCase.php` (no DB), `tests/TestCaseWithDatabase.php` (uses `RefreshDatabase`), `tests/Unit/Endpoint/Api/V1/ApiEndpointTestAbstract.php` (API helpers).

**Frontend location:**
- Co-located with the source: `resources/js/utils/useCurrentTimeEntry.ts` next to `resources/js/utils/useCurrentTimeEntry.test.ts`; `resources/js/Components/Timesheet/TimesheetCell.vue` next to `TimesheetCell.test.ts`.
- Package tests live beside package sources: `resources/js/packages/ui/src/utils/time.test.ts`.
- Some utility tests sit in `resources/js/utils/timesheet/` (`cellMath.test.ts`, `useBreakPlacement.test.ts`, `useTimesheetRowMutations.test.ts`).

**E2E location:** `e2e/*.spec.ts` (one spec per feature area: `timesheet.spec.ts`, `reporting.spec.ts`, `two-factor.spec.ts`, ...).

**Naming:**
- PHP: `<Subject>Test.php`, class `<Subject>Test`, methods `test_<behavior_in_snake_case>`. Examples: `ClientEndpointTest`, `UserTimeEntryEndpointTest`, `SelfHostGenerateKeysCommandTest`.
- Vitest: `<unit>.test.ts`. Specs in `describe('<Unit>', ...)` blocks with `it('<behavior sentence>', ...)`.
- Playwright: `<feature>.spec.ts`.

**Structure (PHP):**

```php
<?php

declare(strict_types=1);

namespace Tests\Unit\Endpoint\Api\V1;

use App\Http\Controllers\Api\V1\ClientController;
use PHPUnit\Framework\Attributes\UsesClass;

#[UsesClass(ClientController::class)]
class ClientEndpointTest extends ApiEndpointTestAbstract
{
    public function test_index_endpoint_fails_if_user_has_no_permission_to_view_clients(): void
    {
        // Arrange
        $data = $this->createUserWithPermission();
        ...
        // Act
        $response = $this->getJson(route('api.v1.clients.index', [$data->organization->getKey()]));

        // Assert
        $response->assertForbidden();
    }
}
```

- Every test method uses the `// Arrange`, `// Act`, `// Assert` comment sections.
- Annotate with `#[UsesClass(...)]` for the class under test.
- Use `declare(strict_types=1);` in every test file.

**Structure (Vitest):**

```typescript
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TimesheetCell from './TimesheetCell.vue';

function mountTimesheetCell(totalSeconds = 2 * 3600) {
    return mount(TimesheetCell, { props: { ... } });
}

describe('TimesheetCell', () => {
    it('emits 0 when the cleared value is committed on blur', async () => {
        const wrapper = mountTimesheetCell();
        const input = wrapper.get('input');
        await input.trigger('focus');
        await input.setValue('');
        await input.trigger('blur');
        expect(wrapper.emitted('update')).toEqual([[0]]);
    });
});
```

- Use small factory functions (`buildCell`, `timeEntry`, `mountGoalCreateButton`) at the top of the file instead of shared fixtures.

## Test Structure

**Suite Organization (PHP):**
- One endpoint or unit per class; group by HTTP verb/behavior in method names: `test_index_endpoint_...`, `test_store_endpoint_...`, `test_update_endpoint_...`, `test_destroy_endpoint_...`.
- Method names describe the expected behavior as a full sentence, not the implementation.

**Setup (PHP):**
- `tests/TestCase::setUp()` fakes mail, binds `LogFake`, calls `Http::preventStrayRequests()`, and by default mocks the billing contract (`protected bool $mockBillingContract = true;`, method `actAsOrganizationWithoutSubscriptionAndWithoutTrial()`). Set `$mockBillingContract = false` in a test class to exercise real billing behavior.
- DB tests use `RefreshDatabase` via `TestCaseWithDatabase`.
- Build organization-scoped users with `createUserWithPermission(array $permissions = [], bool $isOwner = false)` (defined in `tests/TestCaseWithDatabase.php`). It registers a custom role with the given permission strings through `PermissionStore::registerCustomRole()`.
- Time-sensitive tests use `$this->travelTo(...)` (Carbon). Use `CarbonImmutable`/`Carbon` consistently.

**Setup (Vitest):**
- Global browser helpers that production code reads from `window` are stubbed in `resources/js/test-setup.ts` (`getTimezoneSetting`, `getWeekStartSetting`, `getNumberFormat`, `getIntervalFormat`). Add new `window` globals there rather than per test.
- `HTMLElement.prototype.offsetWidth/offsetHeight` are stubbed globally for TanStack Virtual.

**Patterns:**
- Arrange/Act/Assert comments in PHP tests.
- Use `->assertJson(fn (AssertableJson $json) => ...)` for JSON shape and ordering checks.
- Use `Client::factory()->forOrganization($org)->createMany(4)` style factories with fluent state methods (`randomCreatedAt()`, `isPrivate()`, `addMember()`).

## Mocking

**PHP (Mockery and fakes):**
- Prefer Laravel fakes first: `Mail::fake()`, `Storage::fake()`, `Http::fake([...])`, `Passport::actingAs($user)`.
- Partial mocks of Laravel facades for Storage: see `captureTemporaryUrlOptions()` in `tests/Unit/Endpoint/Api/V1/ApiEndpointTestAbstract.php`:

```php
$disk = Mockery::mock(Storage::disk($diskName))->makePartial();
$disk->shouldReceive('temporaryUrl')->andReturnUsing(
    function (string $path, DateTimeInterface $expiration, array $options) use (&$captured): string {
        $captured = $options;
        return 'https://storage.fake/'.$path;
    }
);
```

- Service contracts are swapped via the container; the billing contract is mocked by default in `tests/TestCase.php`.
- `Http::preventStrayRequests()` is active globally, so any outbound HTTP call in a test must be faked explicitly.

**Frontend (Vitest):**
- Module mocks with `vi.mock('<path>', () => ({ ... }))` (about 3 files use this): e.g. `vi.mock('@/utils/useUser', ...)`, `vi.mock('@/packages/api/src', ...)`, `vi.mock('@/utils/notification', ...)`, `vi.mock('@tanstack/vue-query', ...)`.
- Prefer stubs in Vue Test Utils for child components that are not under test:

```typescript
global: {
    stubs: {
        UpgradeModal: { name: 'UpgradeModal', props: ['show', 'feature'], template: '<div />' },
    },
},
```

- Query `wrapper.getComponent({ name: 'UpgradeModal' }).props('show')` to assert stub state.
- Use `vi.fn()` for `window` globals (see `resources/js/test-setup.ts`).

**What to Mock:**
- External HTTP APIs, mail, storage (private disk), billing/subscription providers, and time (`travelTo`) in backend tests.
- Network/API client modules and notification side effects in frontend tests.

**What NOT to Mock:**
- The database in backend tests: `TestCaseWithDatabase` uses a real PostgreSQL connection (`pgsql_test`) with `RefreshDatabase`.
- Eloquent models and factories; create real records.
- Pure utility functions (`cellMath`, `breakPlacementMath`, `dateRange`, `time`); test them directly with real inputs.
- Permission checks: use `createUserWithPermission([...])` so the real `PermissionStore` logic runs.

## Fixtures and Factories

**Backend:**
- Eloquent factories in `database/factories/` (e.g. `Client::factory()`, `Project::factory()`, `Organization::factory()->withOwner($user)`, `Member::factory()->forUser(...)->forOrganization(...)`).
- Fluent helpers on factories: `forOrganization()`, `forClient()`, `addMember()`, `isPrivate()`, `randomCreatedAt()`, `withOwner()`.
- Use `createUserWithPermission()` for permission-scoped actors.

**Frontend:**
- Inline builder functions per test file, returning typed objects, e.g. `timeEntry(id, start, type): TimeEntry` in `resources/js/utils/useCurrentTimeEntry.test.ts` and `buildCell(totalSeconds): TimesheetCellType` in `resources/js/Components/Timesheet/TimesheetCell.test.ts`.
- Cast partial fixtures with `as TimeEntry` only when the full shape is irrelevant to the behavior under test.

**Location:**
- Backend factories: `database/factories/`. Seeders: `database/seeders/`.
- Frontend: no shared fixtures directory; keep builders next to the test.

## Coverage

**Requirements:** None enforced. No coverage thresholds in `phpunit.xml` or `vitest.config.ts`.

**View Coverage:**

```bash
vendor/bin/phpunit --coverage-text       # Requires Xdebug or PCOV
npx vitest run --coverage                 # Requires @vitest/coverage-* provider
```

## Test Types

**Unit Tests (PHP):**
- `tests/Unit/` covers controllers (via endpoint tests), console commands, jobs, rules, middleware, Filament resources, and models. Endpoint tests hit the full HTTP stack against the real DB.

**Feature Tests (PHP):**
- `tests/Feature/` covers user-facing web flows (auth, 2FA, registration, password reset, invitations).

**Module Tests (PHP):**
- `extensions/*/tests/` for optional extensions; run via `.github/workflows/phpunit-extensions.yml`.

**Unit Tests (Frontend):**
- Pure logic and composables in `resources/js/utils/` and `resources/js/packages/ui/src/utils/`.
- Component tests with Vue Test Utils for interaction behavior (`TimesheetCell`, `GoalCreateButton`, `TimeTrackerProjectControls`, `TimeTrackerProjectTaskDropdown`).

**E2E Tests:**
- Playwright specs in `e2e/` cover full user flows (timesheet, timetracker, reporting, invitations, two-factor, admin panel). Auth state is persisted under `test-results/.auth` (cleared by `npm run test:e2e`).
- Timezone edge cases have dedicated specs (`e2e/timezone-mismatch.spec.ts`, `e2e/timesheet-overlap.spec.ts`).

## Common Patterns

**Async Testing (Vitest):**

```typescript
it('emits on blur', async () => {
    const wrapper = mountTimesheetCell();
    await wrapper.get('input').trigger('blur');   // Vue Test Utils triggers return a nextTick promise
    expect(wrapper.emitted('update')).toEqual([[0]]);
});
```

- Always `await` `trigger()` and `setValue()` before asserting DOM or emitted state.

**Async Testing (PHP):**
- Feature/endpoint tests are synchronous; queued jobs run synchronously because `QUEUE_CONNECTION=sync`. Assert side effects directly.

**Error Testing (PHP):**

```php
public function test_index_endpoint_fails_if_user_has_no_permission_to_view_clients(): void
{
    $data = $this->createUserWithPermission();
    Passport::actingAs($data->user);
    $response = $this->getJson(route('api.v1.clients.index', [$data->organization->getKey()]));
    $response->assertForbidden();
}
```

- For domain errors, assert the status and the stable error `KEY` in the JSON body. Use `assertResponseCode($response, 422)` from `ApiEndpointTestAbstract` to dump the body on mismatch.

**Error Testing (Vitest):**
- Test the empty/invalid input path explicitly, e.g. `setValue('')` then `blur` should emit `0` (see `TimesheetCell.test.ts`).
- Assert "does not emit" with `expect(wrapper.emitted('update')).toBeUndefined()` or by checking the stub's `show` prop remains `false`.

**Rules for new tests:**
- Backend: add endpoint tests in `tests/Unit/Endpoint/Api/V1/<Resource>EndpointTest.php` for each permission boundary (no permission, view-own, view-all) and cross-organization access.
- Frontend: co-locate `<name>.test.ts` next to the unit; stub child Vue components rather than mounting the whole tree.
- Run `vendor/bin/pint` and `npm run lint` before committing.

---

*Testing analysis: 2026-10-19*
