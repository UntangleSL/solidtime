---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
<!-- refreshed: 2026-10-19 -->

# Coding Conventions

**Analysis Date:** 2026-10-19

## Naming Patterns

**Files:**
- PHP classes: one class per file, named after the class in PascalCase, matching the namespace path. Examples: `app/Http/Controllers/Api/V1/ClientController.php`, `app/Service/TimeEntryService.php`, `app/Exceptions/Api/EntityStillInUseApiException.php`.
- Note the singular `App\Service` namespace (directory `app/Service/`), not `Services`.
- Form requests are grouped per resource under `app/Http/Requests/V1/<Resource>/` with names `<Resource>IndexRequest`, `<Resource>StoreRequest`, `<Resource>UpdateRequest`, e.g. `app/Http/Requests/V1/Client/ClientStoreRequest.php`.
- Vue single-file components: PascalCase, e.g. `resources/js/Components/Timesheet/TimesheetCell.vue`, `resources/js/packages/ui/src/TimeTracker/TimeTrackerStartStop.vue`.
- TypeScript utilities and composables: camelCase. Composables are prefixed with `use`: `resources/js/utils/useCurrentTimeEntry.ts`, `resources/js/utils/useClientsQuery.ts`, `resources/js/utils/timesheet/useBreakPlacement.ts`.
- Pure helper modules: camelCase noun files, e.g. `resources/js/utils/timesheet/cellMath.ts`, `resources/js/packages/ui/src/utils/time.ts`.
- Vitest tests are co-located next to the source with `.test.ts` suffix: `resources/js/utils/useTimesheetGrid.test.ts`.
- PHP tests mirror the app namespace under `tests/Unit/...` or `tests/Feature/...` and use the `Test.php` suffix: `tests/Unit/Endpoint/Api/V1/ClientEndpointTest.php`.
- Playwright specs are kebab-case in `e2e/`: `e2e/timesheet-overlap.spec.ts`.
- Directories under `resources/js/Components/` use PascalCase (`Timesheet/`, `Common/Goal/`); under `resources/js/packages/ui/src/` they use mixed case, with both PascalCase (`TimeTracker/`, `FullCalendar/`) and kebab-case (`dropdown-menu/`, `context-menu/`, `number-field/`) present. Follow the sibling directory when adding to `packages/ui`.

**Functions and methods:**
- PHP methods: camelCase (`checkPermission`, `hasPermission`). Test methods use snake_case with `test_` prefix: `test_index_endpoint_returns_list_of_all_clients_of_organization_ordered_by_created_at_desc_per_default`.
- TypeScript functions: camelCase (`getLastWorkTimeEntry`, `formatHumanReadableDuration`, `buildCell`).
- Vue handlers and computed values are camelCase (`displaySeconds`, `isSaving`, `readonlyTooltip`, `inputClass`).

**Variables:**
- PHP: camelCase locals and properties; array keys and request/JSON fields are snake_case (`organization_id`, `archived_at`, `filter[archived]`).
- TypeScript: camelCase; test fixtures use descriptive ids (`'organization-1'`, `'user-1'`).

**Types and constants:**
- PHP enums in `app/Enums/` (e.g. `Role::Owner`). Class constants use `public const string KEY = '...'` typed constants (see `app/Exceptions/Api/EntityStillInUseApiException.php`).
- TypeScript types/interfaces: PascalCase (`TimeEntry`, `TimesheetCell`, `CellSaveStatus`). Types are imported with `import type`.
- Entity IDs in TS and JSON are strings.

## Code Style

**PHP formatting:**
- Laravel Pint with preset `laravel` and extra rules in `pint.json`: `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`, `void_return`.
- Every PHP file starts with `<?php` followed by `declare(strict_types=1);`.
- Return types and parameter types are declared on all methods; `void` is written explicitly.
- Docblock array shapes are used for generics and collections: `@return array<string, array<string|ValidationRule>>`.

**TypeScript/Vue formatting:**
- Prettier, config `.prettierrc.json`: 4-space indent (`tabWidth: 4`), single quotes, `printWidth: 100`, `trailingComma: "es5"`, `bracketSameLine: true`, `quoteProps: "preserve"`.
- `.editorconfig`: LF line endings, UTF-8, 4 spaces, final newline, trailing whitespace trimmed (YAML uses 2 spaces; Markdown keeps trailing whitespace).
- Run `npm run format` / `npm run format:check`.
- Semicolons are used.

**Linting:**
- ESLint flat config `eslint.config.mjs`: `eslint:recommended`, `typescript-eslint` recommended, `eslint-plugin-vue` flat/recommended, `eslint-config-prettier` last.
- Enforced rules: `unused-imports/no-unused-imports` = error; `unused-imports/no-unused-vars` = error with `_`-prefix ignore pattern for variables and arguments.
- Disabled rules: `vue/multi-word-component-names` (single-word component names are allowed) and `@typescript-eslint/no-unused-vars` (replaced by the unused-imports plugin rule).
- Run `npm run lint` / `npm run lint:fix`.

**Static analysis (PHP):**
- PHPStan / Larastan at level 7 over `app/` (`phpstan.neon`), with `checkOctaneCompatibility`, `checkModelProperties`, and `noEnvCallsOutsideOfConfig` enabled. Do not call `env()` outside `config/`.

**TypeScript suppression:**
- `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, and `phpstan-ignore` comments are rare (about 20 occurrences in `resources/js` and `app`). Prefer fixing types; if a suppression is needed, keep it on the line it affects.

## Import Organization

**PHP order (as enforced by Pint's `ordered_imports` in the Laravel preset, alphabetical):**
1. `App\...` namespaces
2. Framework (`Illuminate\...`, `Laravel\...`, `Korridor\...`)
3. Third-party and attributes (`PHPUnit\...`, `Override`)

Example from `app/Http/Controllers/Api/V1/ClientController.php`: `App\Exceptions...`, `App\Http\Requests...`, `App\Models...`, then `Illuminate\...`.

**TypeScript/Vue order (observed pattern in `TimesheetCell.vue`):**
1. Vue/library imports (`vue`, `@heroicons/vue/...`)
2. Internal package imports via the `@/` alias (`@/packages/ui/src/...`)
3. Type-only imports (`import type ... from '@/utils/...'`)

**Path aliases:**
- `@/` maps to `resources/js/` (configured in `vitest.config.ts` and `tsconfig.json`/`jsconfig.json`).
- `@/packages/ui/src/...` and `@/packages/api/src` (or `@/packages/api/src/index.ts`) import the workspace packages `@solidtime/ui` and `@solidtime/api` (`package.json` workspaces: `resources/js/packages/ui`, `resources/js/packages/api`).
- Import from the package barrel `@/packages/api/src` for API types and clients.

## Error Handling

**Backend (Laravel API):**
- Domain errors extend `App\Exceptions\Api\ApiException` and carry a stable `KEY` constant used by clients, e.g. `EntityStillInUseApiException::KEY = 'entity_still_in_use'` in `app/Exceptions/Api/EntityStillInUseApiException.php`. Throw them from controllers or services: `throw new EntityStillInUseApiException('client', 'project');` in `app/Http/Controllers/Api/V1/ClientController.php`.
- Authorization failures throw `Illuminate\Auth\Access\AuthorizationException`. Permission checks go through the base controller helpers in `app/Http/Controllers/Api/V1/Controller.php`: `checkPermission()`, `checkAnyPermission()`, `hasPermission()`. Do not inline permission strings in controllers without these helpers.
- Cross-organization access is rejected in the controller (`checkPermission` override in `ClientController` compares `organization_id`) before using a model.
- Validation lives in Form Requests extending `App\Http\Requests\V1\BaseFormRequest`; custom uniqueness uses `Korridor\LaravelModelValidationRules\Rules\UniqueEloquent` with `->withCustomTranslation('validation.<key>')`.
- Exception reporting is customized per exception through a `report(): bool` method (see `EntityStillInUseApiException`). Global handling is in `app/Exceptions/Handler.php`.

**Frontend (Vue/TypeScript):**
- `try/catch` is used around API calls and mutations; about 17 `catch (` blocks exist in `resources/js`. Surface user-facing errors through the notification helpers in `resources/js/utils/notification.ts` and `resources/js/utils/feedback.ts`.
- Optimistic updates record a save status (`'saving' | 'error' | ...`, type `CellSaveStatus` in `resources/js/utils/timesheet/useTimesheetCellMutations.ts`) and revert or mark the cell in error state, rather than throwing to the UI.
- Do not leave `console.log` in shipped code. About 6 `console.*` calls exist in `resources/js`; treat new ones as needing justification.

## Logging

**Backend:**
- Laravel `Log` facade (`Log::` used across `app/`, about 24 call sites). Use the facade, not `error_log` or `dump`.
- `dump()` appears only in test helpers (`tests/Unit/Endpoint/Api/V1/ApiEndpointTestAbstract.php`).

**Frontend:**
- Use `console.*` sparingly; there is no shared logger module.

## Comments

**When to Comment:**
- Explain the "why" for non-obvious UI or timing logic. Example from `resources/js/Components/Timesheet/TimesheetCell.vue`: `// Show the optimistic value while saving; `??` (not `||`) so a pending 0 (delete) wins.`
- Explain intent for non-obvious branches in PHP; avoid restating code.

**PHPDoc:**
- Controller actions carry a docblock used for OpenAPI generation: a summary line, `@throws` where relevant, and `@operationId` (e.g. `@operationId getClients` in `ClientController::index`). Keep these in sync with `openapi.json`.
- Use `@property` annotations on Form Requests to document route-bound models (`@property Organization $organization`).

**JSDoc/TSDoc:**
- Used sparingly. Prefer self-describing names; add a short block comment for exported helpers with non-trivial behavior.

## Function Design

**Size:** Controllers are thin: validate (Form Request), authorize (`checkPermission`), delegate to a `Service` class or model query, return a Resource. Business logic lives in `app/Service/`.

**Parameters:**
- PHP: typed, with `strict_param`. Route-bound models come first (`Organization $organization`), then the Form Request (`ClientStoreRequest $request`).
- TypeScript: Vue components take a single typed `defineProps<{...}>()` object and emit with `defineEmits<{ update: [newSeconds: number] }>()`.

**Return Values:**
- API controllers return Resources or ResourceCollections (`ClientResource`, `ClientCollection` in `app/Http/Resources/V1/Client/`). Do not return raw Eloquent models from controllers.
- Helpers return explicit types; prefer `null` over sentinel values (`getLastWorkTimeEntry(...)?.id`).

## Module Design

**Vue components:**
- Use `<script setup lang="ts">` (about 398 `.vue` files use it). Only about 7 components use the Options API; do not add new ones.
- Props use `defineProps<{...}>()` with TS types; optional props use `?`.
- Shared UI primitives come from `resources/js/packages/ui/src/` and are imported by path, not from a global registry (e.g. `@/packages/ui/src/tooltip`).
- Component names in `packages/ui` are re-exported via `resources/js/packages/ui/src/index.ts` where a barrel exists.

**Composition and state:**
- Server state uses TanStack Vue Query. Query hooks are named `use<Resource>Query` (`useClientsQuery.ts`, `useProjectsQuery.ts`, `useReportsQuery.ts`); mutation/composite hooks are `use<Resource>` (`useClients.ts`, `useProjects.ts`).
- Global client state uses Pinia (`pinia` in `package.json`).
- Forms use `@tanstack/vue-form`.
- Styling is Tailwind CSS 3 with `class-variance-authority` and `clsx`/`tailwind-merge` for variants; use theme tokens (e.g. `text-text-primary`, `border-input-border`, `bg-card-background`) from `tailwind.config.js` rather than raw colors.

**Barrel files:**
- Used in `resources/js/packages/ui/src/index.ts` and `resources/js/packages/api/src/index.ts`. Keep these as the public surface for the packages.

**PHP modules:**
- `extensions/` holds optional modules with their own `tests/` and `database/`; they are excluded from the `app/` coverage source (`phpunit.xml`). Follow the extension manifest check (`.github/workflows/extension-manifest-check.yml`) when adding one.

---

*Convention analysis: 2026-10-19*
