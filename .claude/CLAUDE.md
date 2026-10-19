<!-- GSD:project-start source:PROJECT.md -->

## Project

**solidtime × Microsoft 365 (Untangle fork)**

Untangle's fork of solidtime (open-source time tracker: Laravel 13 + Inertia/Vue 3 + PostgreSQL), extended so the Untangle team can sign in with their Microsoft 365 accounts and see their Outlook meetings directly in solidtime's calendar view. From the calendar, users turn meetings into time entries by assigning them to projects, and can set rules so a recurring meeting series is pre-assigned to a project going forward.

**Core Value:** A user opens the solidtime calendar and their Outlook meetings are already there, so logging meeting time to the right project takes one click instead of re-typing it from Outlook.

### Constraints

- **Tech stack**: Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15 — follow existing conventions in `.planning/codebase/CONVENTIONS.md`
- **Identity provider**: Microsoft Entra ID, single tenant (Untangle) — one app registration; tenant ID, client ID, secret via env
- **Graph scopes**: minimal — `openid profile email offline_access User.Read Calendars.Read` — least privilege
- **Security**: refresh tokens encrypted at rest (`encrypted` cast), `$hidden`, excluded from audits/logs, state + PKCE validated, deleted with the user
- **Deployment**: Docker image on Untangle's own Dokploy server — redirect URI must match the Dokploy public URL over HTTPS
- **Mergeability**: changes isolated so upstream solidtime updates can still be merged
- **Data safety**: Outlook changes never modify or delete existing time entries automatically

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- PHP 8.3 (`composer.json` `"php": "8.3.*"`) - all backend code under `app/`, `routes/`, `config/`, `database/`
- TypeScript / Vue 3 SFCs - frontend under `resources/js/` (Pages, Components, Layouts) and workspace packages in `resources/js/packages/`
- JavaScript (ESM) - build and config files (`vite.config.js`, `vite-module-loader.js`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.mjs`)
- Blade - only the minimal root template for Inertia (`resources/views/`)
- SQL - PostgreSQL migrations in `database/migrations/`

## Runtime

- PHP 8.3 served by FrankenPHP 1.11 (`docker/prod/Dockerfile`, `ARG FRANKENPHP_VERSION=1.11`, `dunglas/frankenphp:*-php8.3`)
- Laravel Octane 2.3+ (`laravel/octane`, `config/octane.php`, `OCTANE_SERVER` env var)
- Composer 2.8 for dependency install (build stage in `docker/prod/Dockerfile`)
- Node.js 20.x in CI (`.github/workflows/phpunit.yml`, `npm-build.yml`); no `.nvmrc` present
- Vite 7 (`package.json` devDependencies `vite ^7.3.3`) with `laravel-vite-plugin ^2.1.0`
- Composer (PHP) - lockfile present: `composer.lock`
- npm (Node) - lockfile present: `package-lock.json`; npm workspaces declared in root `package.json` (`resources/js/packages/ui`, `resources/js/packages/api`)
- `.npmrc` sets `min-release-age=7` (npm will skip package versions published less than 7 days ago)

## Frameworks

- Laravel Framework 13.x (`laravel/framework ^13.0`) - application framework
- Laravel Fortify 1.37+ (`laravel/fortify`) - session auth, registration, password reset, email verification, two-factor auth (config: `config/fortify.php`, provider: `app/Providers/FortifyServiceProvider.php`)
- Laravel Passport 13.0.5+ (`laravel/passport`) - OAuth2 server and personal access tokens for the REST API (config: `config/passport.php`, setup: `app/Providers/AuthServiceProvider.php`)
- Inertia.js server adapter 3.3+ (`inertiajs/inertia-laravel`) - SPA-style pages rendered from Laravel routes (`config/inertia.php`; SSR explicitly disabled per `.env.example`)
- Filament 5.0 (`filament/filament`) - admin panel (panel id `admin`, path `/admin`, provider in `app/Providers/Filament/`, resources in `app/Filament/Resources/`)
- Laravel Modules 13.x (`nwidart/laravel-modules`) - extension/module system rooted at `extensions/` (`config/modules.php`)
- Vue 3.5 (`vue ^3.5.34`) with `@inertiajs/vue3 ^2.3.23`
- Tailwind CSS 3.4 (`tailwindcss ^3.4.19`) with `@tailwindcss/forms`, `@tailwindcss/typography`, `@tailwindcss/container-queries`, `tailwindcss-animate`
- UI primitives: `reka-ui ^2.10.1` and `radix-vue ^1.9.17` (headless components), `class-variance-authority`, `tailwind-merge`, `clsx`
- Icons: `@lucide/vue ^1.28.0`, `@heroicons/vue ^2.2.0`
- State and data: `@tanstack/vue-query ^5.100.10` (server state), `pinia ^3.0.4` (client state), `@tanstack/vue-form`, `@tanstack/vue-table`, `@tanstack/vue-virtual`
- Charts and calendar: `echarts ^6.0.0` with `vue-echarts ^8.0.1`; FullCalendar-style time-entry calendar components under `resources/js/packages/ui/src/FullCalendar/`
- Date handling: `dayjs ^1.11.20`, `parse-duration ^2.1.6`
- Drag and drop: `vue-draggable-plus ^0.6.1`
- Validation (frontend): `zod ^3.25.76`; generated API client via `@zodios/core ^10.9.6` and `openapi-zod-client` (`zod:generate` script)
- Utilities: `@vueuse/core ^14`, `@vueuse/integrations`, `@floating-ui/vue`, `focus-trap`, `chroma-js`
- Scramble 0.13.43+ (`dedoc/scramble`) - generates OpenAPI from routes; configured in `config/scramble.php`, extended with OAuth scheme in `app/Providers/AppServiceProvider.php`. Checked-in spec: `openapi.json` (repo root).
- PHPUnit 12 (`phpunit/phpunit ^12`) with `phpunit.xml`; Laravel test runner via `php artisan test` (`composer test`)
- Paratest 7.3 for parallel PHP tests (`composer ptest`)
- Mockery 1.4, `timacdonald/log-fake`
- Vitest 4.1 with happy-dom 20 (`vitest.config.ts`, `npm run test:unit`); `@vue/test-utils ^2.4.6`
- Playwright 1.60 for E2E (`playwright.config.ts`, `e2e/`, `npm run test:e2e`); Playwright Docker image `mcr.microsoft.com/playwright:v1.60.0-jammy` in `docker-compose.yml`
- Vite 7 + `vite-plugin-checker ^0.12.0` (type/lint checks in dev) - `vite.config.js`
- TypeScript 5.9 and `vue-tsc ^3.2.8` (`npm run type-check`), `tsconfig.json`, `jsconfig.json`
- ESLint 9 flat config (`eslint.config.mjs`, `npm run lint`) with `eslint-plugin-unused-imports`
- Prettier (`.prettierrc.json`, `npm run format`) and Laravel Pint 1.x (`pint.json`, `composer fix`)
- PHPStan via Larastan 3.5 (`phpstan.neon`, `composer analyse`)
- Laravel Telescope 5.x (dev dependency; registered only in `local` env via `app/Providers/AppServiceProvider.php`; `config/telescope.php`)
- Laravel Sail 1.18 and IDE helper 3.x (dev dependencies; `docker-compose.yml` is Sail-style)
- `openapi-zod-client ^1.18.3` for typed client generation

## Key Dependencies

- `brick/money ^0.15.1` - monetary value handling (billing/invoicing paths)
- `owen-it/laravel-auditing ^14.0.0` - model audit trail; driver `database` (`config/audit.php`); toggled via `AUDITING_ENABLED`
- `korridor/laravel-model-validation-rules`, `korridor/laravel-has-many-sync`, `korridor/laravel-computed-attributes` - model validation and relation syncing
- `staudenmeir/eloquent-json-relations` - JSON-based Eloquent relations
- `tpetry/laravel-postgresql-enhanced ^3.0.0` - PostgreSQL-specific schema builder features
- `flowframe/laravel-trend ^0.5.0` - time-series aggregation for dashboards and reports
- `gotenberg/gotenberg-php ^2.8` - client for Gotenberg (HTML-to-PDF) service; config `config/services.php`
- `maatwebsite/excel ^4.0.3` and `league/csv ^9.16.0` - CSV/Excel import and export (`config/excel.php`, `app/Service/Import/`)
- `league/iso3166 ^4.3` - country code data
- `mobiledetect/mobiledetectlib ^4.11` - user-agent parsing (`app/Service/Dto/UserAgentDto.php`, `OtherBrowserSessionsController.php`)
- `guzzlehttp/guzzle ^8.2` - outbound HTTP (used directly in `app/Http/Controllers/Api/V1/TimeEntryController.php`)
- `league/flysystem-aws-s3-v3 ^3.0` - S3-compatible object storage adapter (`config/filesystems.php`)
- `tightenco/ziggy ^2.1.0` - exposes named Laravel routes to the frontend
- `spatie/temporary-directory ^2.2` - temp files for exports and imports
- `stechstudio/filament-impersonate ^5.0`, `pxlrbt/filament-environment-indicator`, `novadaemon/filament-pretty-json` - Filament add-ons
- `wikimedia/composer-merge-plugin ^2.1.0` - merges extra composer files (plugin configured in `composer.json`)
- `@solidtime/ui` and `@solidtime/api` - in-repo workspace packages (`resources/js/packages/ui`, `resources/js/packages/api`, both published via `.github/workflows/npm-publish-*.yml`)
- `@tanstack/vue-query`, `zod`, `@zodios/core` - API data layer
- `laravel/octane ^2.3` - long-running worker server
- `laravel/tinker ^3.0` - REPL
- `nwidart/laravel-modules ^13.0.0` - extension loader (`extensions/extensions_autoload.php`)

## Extensions (Git-sourced modules)

- `Billing` - `solidtime-io/extension-billing` @ `v0.0.11`
- `Services` - `solidtime-io/extension-services` @ `v0.0.4`
- `Invoicing` - `solidtime-io/extension-invoicing` @ `v0.0.12` (its presence flips `is_premium` in telemetry, see `app/Service/ApiService.php`)
- `Auditing` - `solidtime-io/extension-auditing` @ `v0.0.5`

## Configuration

- Configured through `.env` files loaded by Laravel. Templates in repo: `.env.example` (full variable list), `.env.ci`, `.env.production`.
- Do not commit real `.env` values. The active environment file is not documented here by design.
- Key variable groups (names only, from `.env.example`): `APP_*` (name, env, key, URL, `APP_FORCE_HTTPS`, `APP_ENABLE_REGISTRATION` = `on|off|invite-only`, `SUPER_ADMINS`), `DB_*` and `DB_TEST_*`, `CACHE_DRIVER`, `QUEUE_CONNECTION`, `SESSION_DRIVER`/`SESSION_LIFETIME`, `MAIL_*`, `FILESYSTEM_DISK`/`PUBLIC_FILESYSTEM_DISK`, `S3_*`, `PASSPORT_PERSONAL_ACCESS_CLIENT_ID`/`_SECRET`, `AUDITING_ENABLED`, `TELESCOPE_ENABLED`, `GOTENBERG_URL`, `OCTANE_SERVER`, `INERTIA_SSR_ENABLED`
- Passport key material is read from `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY` (`config/passport.php`); CI generates keys with `php artisan passport:keys`.
- Defaults that differ from `.env.example`: DB default connection `pgsql` (`config/database.php`), cache `file`, queue `sync`, filesystem `local`, mail `smtp`, broadcast `null`.
- `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `components.json` (shadcn-style component registry config), `tsconfig.json`, `jsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `phpstan.neon`, `phpunit.xml`, `pint.json`, `.prettierrc.json`, `.editorconfig`
- Docker: `docker/prod/Dockerfile` (multi-stage: `composer:2.8` vendor stage, `dunglas/frankenphp` builder, runtime image), `docker/local/`, `docker-compose.yml`, `.dockerignore`
- Deployment assets: `docker/prod/deployment/`
- Primary driver: PostgreSQL (`config/database.php`, default `pgsql`); dev and CI use `postgres:15` images (`docker-compose.yml`)
- Separate test connection `pgsql_test` (`DB_TEST_*`); `composer refresh-schema-dump` regenerates the schema dump from it

## Platform Requirements

- PHP 8.3 with `ext-zip` (`composer.json`)
- Composer 2.x, Node.js 20.x, npm
- Docker (Laravel Sail-style `docker-compose.yml`): PostgreSQL 15, Mailpit (mail capture), MinIO (S3 dev storage, `minio/minio:latest`), Playwright container, Gotenberg (optional, only needed for PDF features)
- Container image built by `.github/workflows/build-public.yml`, `build-private.yml`, `build-onpremise.yml` and published to GHCR (`ghcr.io/solidtime-io/solidtime`)
- Runtime: FrankenPHP (Caddy-based PHP server) on Linux, running as UID/GID 1000, TZ default UTC (`docker/prod/Dockerfile`)
- Requires PostgreSQL, a mail transport (SMTP), optional S3-compatible storage, optional Gotenberg service, and a queue/cache backend of choice (defaults are `sync`/`file`; no Redis dependency is declared in `composer.json`)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

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
- PHP methods: camelCase (`checkPermission`, `hasPermission`). Test methods use snake_case with `test_` prefix: `test_index_endpoint_returns_list_of_all_clients_of_organization_ordered_by_created_at_desc_per_default`.
- TypeScript functions: camelCase (`getLastWorkTimeEntry`, `formatHumanReadableDuration`, `buildCell`).
- Vue handlers and computed values are camelCase (`displaySeconds`, `isSaving`, `readonlyTooltip`, `inputClass`).
- PHP: camelCase locals and properties; array keys and request/JSON fields are snake_case (`organization_id`, `archived_at`, `filter[archived]`).
- TypeScript: camelCase; test fixtures use descriptive ids (`'organization-1'`, `'user-1'`).
- PHP enums in `app/Enums/` (e.g. `Role::Owner`). Class constants use `public const string KEY = '...'` typed constants (see `app/Exceptions/Api/EntityStillInUseApiException.php`).
- TypeScript types/interfaces: PascalCase (`TimeEntry`, `TimesheetCell`, `CellSaveStatus`). Types are imported with `import type`.
- Entity IDs in TS and JSON are strings.

## Code Style

- Laravel Pint with preset `laravel` and extra rules in `pint.json`: `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`, `void_return`.
- Every PHP file starts with `<?php` followed by `declare(strict_types=1);`.
- Return types and parameter types are declared on all methods; `void` is written explicitly.
- Docblock array shapes are used for generics and collections: `@return array<string, array<string|ValidationRule>>`.
- Prettier, config `.prettierrc.json`: 4-space indent (`tabWidth: 4`), single quotes, `printWidth: 100`, `trailingComma: "es5"`, `bracketSameLine: true`, `quoteProps: "preserve"`.
- `.editorconfig`: LF line endings, UTF-8, 4 spaces, final newline, trailing whitespace trimmed (YAML uses 2 spaces; Markdown keeps trailing whitespace).
- Run `npm run format` / `npm run format:check`.
- Semicolons are used.
- ESLint flat config `eslint.config.mjs`: `eslint:recommended`, `typescript-eslint` recommended, `eslint-plugin-vue` flat/recommended, `eslint-config-prettier` last.
- Enforced rules: `unused-imports/no-unused-imports` = error; `unused-imports/no-unused-vars` = error with `_`-prefix ignore pattern for variables and arguments.
- Disabled rules: `vue/multi-word-component-names` (single-word component names are allowed) and `@typescript-eslint/no-unused-vars` (replaced by the unused-imports plugin rule).
- Run `npm run lint` / `npm run lint:fix`.
- PHPStan / Larastan at level 7 over `app/` (`phpstan.neon`), with `checkOctaneCompatibility`, `checkModelProperties`, and `noEnvCallsOutsideOfConfig` enabled. Do not call `env()` outside `config/`.
- `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, and `phpstan-ignore` comments are rare (about 20 occurrences in `resources/js` and `app`). Prefer fixing types; if a suppression is needed, keep it on the line it affects.

## Import Organization

- `@/` maps to `resources/js/` (configured in `vitest.config.ts` and `tsconfig.json`/`jsconfig.json`).
- `@/packages/ui/src/...` and `@/packages/api/src` (or `@/packages/api/src/index.ts`) import the workspace packages `@solidtime/ui` and `@solidtime/api` (`package.json` workspaces: `resources/js/packages/ui`, `resources/js/packages/api`).
- Import from the package barrel `@/packages/api/src` for API types and clients.

## Error Handling

- Domain errors extend `App\Exceptions\Api\ApiException` and carry a stable `KEY` constant used by clients, e.g. `EntityStillInUseApiException::KEY = 'entity_still_in_use'` in `app/Exceptions/Api/EntityStillInUseApiException.php`. Throw them from controllers or services: `throw new EntityStillInUseApiException('client', 'project');` in `app/Http/Controllers/Api/V1/ClientController.php`.
- Authorization failures throw `Illuminate\Auth\Access\AuthorizationException`. Permission checks go through the base controller helpers in `app/Http/Controllers/Api/V1/Controller.php`: `checkPermission()`, `checkAnyPermission()`, `hasPermission()`. Do not inline permission strings in controllers without these helpers.
- Cross-organization access is rejected in the controller (`checkPermission` override in `ClientController` compares `organization_id`) before using a model.
- Validation lives in Form Requests extending `App\Http\Requests\V1\BaseFormRequest`; custom uniqueness uses `Korridor\LaravelModelValidationRules\Rules\UniqueEloquent` with `->withCustomTranslation('validation.<key>')`.
- Exception reporting is customized per exception through a `report(): bool` method (see `EntityStillInUseApiException`). Global handling is in `app/Exceptions/Handler.php`.
- `try/catch` is used around API calls and mutations; about 17 `catch (` blocks exist in `resources/js`. Surface user-facing errors through the notification helpers in `resources/js/utils/notification.ts` and `resources/js/utils/feedback.ts`.
- Optimistic updates record a save status (`'saving' | 'error' | ...`, type `CellSaveStatus` in `resources/js/utils/timesheet/useTimesheetCellMutations.ts`) and revert or mark the cell in error state, rather than throwing to the UI.
- Do not leave `console.log` in shipped code. About 6 `console.*` calls exist in `resources/js`; treat new ones as needing justification.

## Logging

- Laravel `Log` facade (`Log::` used across `app/`, about 24 call sites). Use the facade, not `error_log` or `dump`.
- `dump()` appears only in test helpers (`tests/Unit/Endpoint/Api/V1/ApiEndpointTestAbstract.php`).
- Use `console.*` sparingly; there is no shared logger module.

## Comments

- Explain the "why" for non-obvious UI or timing logic. Example from `resources/js/Components/Timesheet/TimesheetCell.vue`: `// Show the optimistic value while saving; `??` (not `||`) so a pending 0 (delete) wins.`
- Explain intent for non-obvious branches in PHP; avoid restating code.
- Controller actions carry a docblock used for OpenAPI generation: a summary line, `@throws` where relevant, and `@operationId` (e.g. `@operationId getClients` in `ClientController::index`). Keep these in sync with `openapi.json`.
- Use `@property` annotations on Form Requests to document route-bound models (`@property Organization $organization`).
- Used sparingly. Prefer self-describing names; add a short block comment for exported helpers with non-trivial behavior.

## Function Design

- PHP: typed, with `strict_param`. Route-bound models come first (`Organization $organization`), then the Form Request (`ClientStoreRequest $request`).
- TypeScript: Vue components take a single typed `defineProps<{...}>()` object and emit with `defineEmits<{ update: [newSeconds: number] }>()`.
- API controllers return Resources or ResourceCollections (`ClientResource`, `ClientCollection` in `app/Http/Resources/V1/Client/`). Do not return raw Eloquent models from controllers.
- Helpers return explicit types; prefer `null` over sentinel values (`getLastWorkTimeEntry(...)?.id`).

## Module Design

- Use `<script setup lang="ts">` (about 398 `.vue` files use it). Only about 7 components use the Options API; do not add new ones.
- Props use `defineProps<{...}>()` with TS types; optional props use `?`.
- Shared UI primitives come from `resources/js/packages/ui/src/` and are imported by path, not from a global registry (e.g. `@/packages/ui/src/tooltip`).
- Component names in `packages/ui` are re-exported via `resources/js/packages/ui/src/index.ts` where a barrel exists.
- Server state uses TanStack Vue Query. Query hooks are named `use<Resource>Query` (`useClientsQuery.ts`, `useProjectsQuery.ts`, `useReportsQuery.ts`); mutation/composite hooks are `use<Resource>` (`useClients.ts`, `useProjects.ts`).
- Global client state uses Pinia (`pinia` in `package.json`).
- Forms use `@tanstack/vue-form`.
- Styling is Tailwind CSS 3 with `class-variance-authority` and `clsx`/`tailwind-merge` for variants; use theme tokens (e.g. `text-text-primary`, `border-input-border`, `bg-card-background`) from `tailwind.config.js` rather than raw colors.
- Used in `resources/js/packages/ui/src/index.ts` and `resources/js/packages/api/src/index.ts`. Keep these as the public surface for the packages.
- `extensions/` holds optional modules with their own `tests/` and `database/`; they are excluded from the `app/` coverage source (`phpunit.xml`). Follow the extension manifest check (`.github/workflows/extension-manifest-check.yml`) when adding one.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Inertia bootstrap | Resolves page names to Vue components, sets up Pinia, Ziggy, TanStack Query, prefetching | `resources/js/app.ts` |
| Web routes | Serves Inertia pages (`/calendar`, `/time`, `/projects/{project}`, ...) behind `auth:web`, `auth.session`, `verified` | `routes/web.php` |
| API routes | Versioned REST API under `/api/v1`, Passport-protected, organization-scoped paths | `routes/api.php` |
| Inertia shared data | Shares auth user / org data with every page | `app/Http/Middleware/HandleInertiaRequests.php`, `app/Http/Middleware/ShareInertiaData.php` |
| Organization blocking | Blocks write routes for blocked organizations | `app/Http/Middleware/CheckOrganizationBlocked.php` |
| Time entries | Core domain: create/update/aggregate/round time entries | `app/Models/TimeEntry.php`, `app/Service/TimeEntryService.php`, `app/Service/TimeEntryAggregationService.php`, `app/Service/TimeEntryFilter.php` |
| Projects / clients / tasks / tags | Classification entities attached to time entries | `app/Models/Project.php`, `app/Models/Client.php`, `app/Models/Task.php`, `app/Models/Tag.php` |
| Organizations and membership | Tenant boundary; `Member` is the join between `User` and `Organization` | `app/Models/Organization.php`, `app/Models/Member.php`, `app/Models/ProjectMember.php`, `app/Service/MemberService.php`, `app/Service/InvitationService.php` |
| Billing contract | Interface-like hook for subscription/trial/limit checks; implemented by the Billing extension | `app/Service/BillingContract.php` (bound in `app/Providers/AppServiceProvider.php`) |
| Goals contract | Goal limit/progress hook | `app/Service/GoalsContract.php`, `app/Service/GoalProgressService.php` |
| Spent-time recalculation | Queued jobs keeping project/task totals up to date | `app/Jobs/RecalculateSpentTimeForProject.php`, `app/Jobs/RecalculateSpentTimeForTask.php` |
| Scheduler | Periodic commands (still-running mails, expiring API tokens, self-host checks) | `app/Console/Kernel.php`, `config/scheduling.php` |
| Admin UI | Filament panel with resources per entity | `app/Filament/Resources/*`, `app/Providers/Filament/*` |
| Calendar UI | Week/day time-entry calendar built on a FullCalendar-style component | `resources/js/Pages/Calendar.vue`, `resources/js/packages/ui/src/FullCalendar/*` |
| Frontend API client | Generated OpenAPI client + typed wrappers | `resources/js/packages/api/src/index.ts`, `resources/js/packages/api/src/openapi.json.client.ts` |
| Extensions manifest | Pins external extension repos and refs | `extensions/manifest.json` |

## Pattern Overview

- Two HTTP surfaces over the same services: Inertia web routes (session auth, `routes/web.php`) and `/api/v1` (Passport tokens, `routes/api.php`).
- Organization-scoped multi-tenancy: API routes are nested under `/organizations/{organization}/...`; time entries carry `organization_id`, `member_id`, `user_id`.
- Contract classes (`BillingContract`, `GoalsContract`) are bound in the service container so the OSS core can run without the Billing extension.
- Frontend state split: server state in TanStack Query (`resources/js/utils/use*Query.ts`), client/UI state in Pinia and small `use*Store` composables (`resources/js/utils/useCurrentTimeEntry.ts`, `useProjects.ts`).
- Generated API types: `openapi.json` is produced by Scramble (`app/Extensions/Scramble`, `config/scramble.php`); the TypeScript client is regenerated with `npm run zod:generate`.

## Layers

- Purpose: Render Inertia pages and handle non-JSON endpoints.
- Location: `app/Http/Controllers/Web/`
- Contains: `DashboardController`, `OrganizationController`, `UserController`, `UserProfileController`, `OtherBrowserSessionsController`, `HealthCheckController`.
- Depends on: Services, Inertia.
- Used by: `routes/web.php`.
- Note: Most Inertia pages are defined as closures returning `Inertia::render('<PageName>')` directly in `routes/web.php` (e.g. `Calendar`, `Time`, `Timesheet`, `Reporting`), not via controllers.
- Purpose: JSON endpoints under `/api/v1`.
- Location: `app/Http/Controllers/Api/V1/` (one controller per resource: `TimeEntryController`, `UserTimeEntryController`, `ProjectController`, `ClientController`, `TaskController`, `TagController`, `GoalController`, `ReportController`, `ChartController`, `ExportController`, `ImportController`, `MemberController`, `InvitationController`, `OrganizationController`, `UserController`, `UserMembershipController`, `ApiTokenController`, `CurrencyController`, `TimeZoneController`, `ProjectMemberController`).
- Public subset: `app/Http/Controllers/Api/V1/Public/ReportController.php` (shared-report endpoints, reached without login).
- Depends on: Form requests (`app/Http/Requests/V1/<Resource>/`), API resources (`app/Http/Resources/V1/<Resource>/`), Services.
- Used by: `routes/api.php`, the Vue SPA via `resources/js/packages/api`, and external clients.
- Requests: `app/Http/Requests/V1/<Resource>/*Request.php` validate and authorize.
- Resources: `app/Http/Resources/V1/<Resource>/*Resource.php` shape JSON output.
- Custom rules: `app/Rules/`.
- Exceptions to JSON: `app/Exceptions/Api/`.
- Purpose: Domain logic, aggregation, import/export, permission checks.
- Location: `app/Service/` (flat, plus `app/Service/Dto`, `app/Service/Export`, `app/Service/Import` with `Importers/`, `app/Service/ReportExport`, `app/Service/IpLookup`).
- Depends on: Models, Eloquent query builders, Spatie/Excel/CSV libraries.
- Used by: Controllers, Filament resources, console commands, jobs.
- Purpose: Eloquent models, relations, computed attributes, auditing.
- Location: `app/Models/`, concerns in `app/Models/Concerns/` (`HasUuids`, `AuditableThroughParent`, `AuditableWithoutOwner`, `CustomAuditable`), Passport models in `app/Models/Passport/`.
- Migrations: `database/migrations/` plus schema dumps in `database/schema/`.
- Depends on: PostgreSQL (`tpetry/laravel-postgresql-enhanced`), `korridor/laravel-computed-attributes`, `korridor/laravel-has-many-sync`.
- Jobs: `app/Jobs/` (spent-time recalculation); `app/Jobs/Test/` for queue testing.
- Events: `app/Events/` (`AfterCreateOrganization`, `MemberAdding`, `MemberAdded`, `MemberRemoved`, `MemberMadeToPlaceholder`, `OrganizationInvitationAdding`, `BeforeOrganizationDeletion`, `NewsletterRegistered`, `DatabaseSeederAfterSeed`, `DatabaseSeederBeforeDelete`). Listeners are registered via `app/Providers/EventServiceProvider.php`.
- Queue: `config/queue.php`; default connection is `sync` unless `QUEUE_CONNECTION` is set (drivers include database, beanstalkd, Redis, etc.).
- Scheduler: `app/Console/Kernel.php` registers `time-entry:send-still-running-mails`, `auth:send-mails-expiring-api-tokens`, and self-host commands (`self-host:check-for-update`, `self-host:telemetry`, `self-host:database-consistency`).
- Console: `app/Console/Commands/` grouped by domain (`Admin`, `Auth`, `Correction`, `Report`, `SelfHost`, `Test`, `TimeEntry`).
- Purpose: Full-page Vue components rendered by Inertia.
- Location: `resources/js/Pages/` (e.g. `Calendar.vue`, `Time.vue`, `Timesheet.vue`, `Dashboard.vue`, `Projects.vue`, `ProjectShow.vue`, `Clients.vue`, `Members.vue`, `Goals.vue`, `Reporting*.vue`, `Import.vue`, `Tags.vue`, `Auth/`, `Profile/`, `Teams/`).
- Layout: `resources/js/Layouts/AppLayout.vue`.
- Depends on: `resources/js/packages/ui` (component library), `resources/js/packages/api` (client), `resources/js/utils` (queries, stores, helpers).
- Purpose: Reusable components; workspace package `@solidtime/ui`.
- Location: `resources/js/packages/ui/src/` (`FullCalendar/`, `calendar/`, `range-calendar/`, `TimeEntry/`, `TimeTracker/`, `Project/`, `Client/`, `Tag/`, shadcn-style primitives such as `dialog/`, `select/`, `tabs/`, `tooltip/`).
- Note: `resources/js/Components/` holds app-level components (`TimeTracker.vue`, `Timesheet/`, `Dashboard/`, `CommandPalette/`, `Billing/`, `Common/`); `resources/js/Components/ui` is a local copy.
- Purpose: Typed HTTP client generated from the OpenAPI spec.
- Location: `resources/js/packages/api/src/` (`index.ts` exports `api`, types such as `TimeEntry`, `CreateProjectBody`, `Client`, `TimeEntryResponse`).
- Generation: `npm run zod:generate` (`openapi-zod-client` against `/docs/api.json`).

## Data Flow

### Primary Request Path (Inertia page, e.g. Calendar)

### Primary Request Path (API client, external)

### Background Work

- Server state: TanStack Query keyed by org/membership id (`useUser.ts` supplies `getCurrentOrganizationId()`, `getCurrentMembershipId()`).
- Auth/user settings: Inertia shared props (`auth.user`, including `week_start`, `timezone`) exposed globally via `window.getWeekStartSetting` / `window.getTimezoneSetting` in `resources/js/app.ts`.
- Running timer: `resources/js/utils/useCurrentTimeEntry.ts` (Pinia store plus query).
- Calendar settings: `resources/js/packages/ui/src/FullCalendar/calendarSettings.ts`, `CalendarSettingsPopover.vue`.

## Domain Model

- `Organization` (`app/Models/Organization.php`) is the tenant. It has `owner` (User), `members` (Member), `users` (through Member), `organizationInvitations`.
- `User` (`app/Models/User.php`) belongs to many organizations through `Member`.
- `Member` (`app/Models/Member.php`) is the per-organization identity for a user (or a placeholder member with no user). Time entries reference `member_id` as well as `user_id`.
- `TimeEntry` (`app/Models/TimeEntry.php`) belongs to `organization`, `user`, `member`, optional `project`, `task`, `client` (computed from project), and has tags via a JSON relation (`tagsRelation`, `BelongsToJson`). Computed attributes: `getBillableRateComputed()`, `getClientIdComputed()`. Scopes: `scopeHasTag`, `scopeWorkTime`. Start/end are rounded through `TimeEntryService::getStartSelectRawForRounding` / `getEndSelectRawForRounding` using `TimeEntryRoundingType`.
- `Project` (`app/Models/Project.php`) belongs to `Client` (optional) and has `ProjectMember` rows for per-project membership and billable rates; has `Task`s.
- `Client`, `Task`, `Tag`, `Goal`, `Report` are organization-scoped entities.
- Audit trail: `Audit` model (`app/Models/Audit.php`) via `owen-it/laravel-auditing`, with resolvers in `app/Extensions/Auditing/Resolvers/`.

## Extensions Module System

- **Manifest:** `extensions/manifest.json` lists each optional extension with `repository` and `ref` (currently `Billing` v0.0.11, `Services` v0.0.4, `Invoicing` v0.0.12, `Auditing` v0.0.5, all under the `solidtime-io` GitHub org). The manifest is data only; the fetching step is external to the manifest.
- **Autoload (PHP):** `composer.json` `autoload.files` includes `extensions/extensions_autoload.php`. That file scans every direct subdirectory of `extensions/` and `require_once`s `<extension>/vendor/autoload.php` when present. An extension is active on disk only when it has its own composer vendor directory.
- **Contracts:** core services are bound through contract classes in `app/Providers/AppServiceProvider.php` (`BillingContract`, `GoalsContract`). Extensions override these bindings to add behavior; core code calls the contract, never the extension directly.
- **Frontend pages:** `resources/js/app.ts` resolves Inertia component names containing `::` (e.g. `Invoicing::Index`) from `../../extensions/<Module>/resources/js/Pages/<Page>.vue` via `import.meta.glob('../../extensions/**/resources/js/Pages/*.vue')`. Core pages resolve from `resources/js/Pages/`. Extension pages are rendered with `Inertia::render('Module::Page')`.
- **Routes:** extensions may register their own routes through their service providers when their autoload is loaded.
- **Auditing:** `Auditing` extension config and resolvers live under `app/Extensions/Auditing` and `config/audit.php`.
- **Scramble (OpenAPI):** `app/Extensions/Scramble` customizes API doc generation.

## Key Abstractions

- Purpose: Decouple core from paid/optional features.
- Examples: `app/Service/BillingContract.php`, `app/Service/GoalsContract.php`.
- Pattern: Container binding in `AppServiceProvider`, overridden by extensions.
- Purpose: Stateless domain operations.
- Examples: `app/Service/TimeEntryService.php`, `app/Service/ReportService.php`, `app/Service/MemberService.php`, `app/Service/OrganizationInvitationService.php`, `app/Service/PermissionStore.php`.
- Pattern: Injected into controllers/resources; permission roles defined in `PermissionStore::roleDefinitions()`.
- Purpose: Typed data crossing service boundaries.
- Examples: `app/Service/Dto/`.
- `TimeEntryCalendar.vue`, `CalendarDayColumn.vue`, `FullCalendarEventContent.vue`, `useCalendarEvents.ts`, `useCalendarGrid.ts`, `useCalendarNavigation.ts`, `calendarTypes.ts`, `activityTypes` (imported by `Calendar.vue` from `@/packages/ui/src/FullCalendar/activityTypes`).
- Pattern: Presentational calendar in the UI package; data fetching and mutations in `resources/js/utils`; page composes both.
- `PermissionStore` (`app/Service/PermissionStore.php`) defines roles and abilities; frontend mirrors checks in `resources/js/utils/permissions.ts` and `roles.ts`.

## Entry Points

- Location: `routes/web.php`
- Triggers: Browser navigation.
- Responsibilities: Auth gating, page rendering.
- Location: `routes/api.php` (`/api/v1`)
- Triggers: SPA fetches and external API clients.
- Responsibilities: JSON CRUD and reporting.
- Location: `resources/js/app.ts`, Vite config `vite.config.js`.
- Location: `artisan`, `app/Console/Kernel.php`, `app/Console/Commands/`.
- Triggered by the process manager (`docker/` configs, `docker-compose.yml`) running `queue:work` and `schedule:run`.
- `app/Http/Controllers/Web/HealthCheckController.php`.

## Architectural Constraints

- **Threading:** PHP request-per-process via PHP-FPM or FrankenPHP/Octane (`config/octane.php`, `docker/prod/deployment/octane/FrankenPHP`). Frontend is single-threaded browser code.
- **Global state:** `window.vueAppSetupHook`, `window.getWeekStartSetting`, `window.getTimezoneSetting` in `resources/js/app.ts`; test hooks `window.__TEST_SET_ACTIVITY_PERIODS__` in `resources/js/Pages/Calendar.vue`.
- **Octane caveat:** Octane keeps the app in memory; services with static or singleton state must reset between requests.
- **Circular imports:** Not assessed.
- **Organization scoping:** Every org-scoped query must filter by organization; the boundary is enforced by route model binding plus middleware, not by a global scope on every model.
- **Auth split:** Web routes use session guard `web`; API uses Passport. Do not mix guards in new routes.

## Anti-Patterns

### Hard-coding optional integrations into core services

### Adding page logic inline in `routes/web.php`

### Duplicating time-entry fetch logic in pages

## Error Handling

- Validation through Form requests (422 JSON).
- Domain errors as dedicated exception classes in `app/Exceptions/Api/`.
- Frontend uses `resources/js/utils/apiValidation.ts` and `feedback.ts` for toasts.

## Cross-Cutting Concerns

## Relevance to Microsoft 365 Login and Outlook Calendar Import

- **Login:** Fortify is the web auth stack (`config/fortify.php`, `app/Actions/Fortify/`); a Microsoft OAuth/OIDC login would be an additional provider beside Fortify's email/password flow, wired in `routes/web.php` auth routes and `app/Providers/FortifyServiceProvider.php`. Socialite is not currently a dependency (`composer.json`), so it must be added.
- **Outlook import:** Import already exists as a pattern: `app/Http/Controllers/Api/V1/ImportController.php`, `app/Service/Import/` with `Importers/`, and `resources/js/Pages/Import.vue`. An Outlook importer should follow the same importer structure and produce `TimeEntry` records through `TimeEntryService`.
- **Calendar display:** Imported meetings would be rendered in `resources/js/packages/ui/src/FullCalendar/` alongside time entries; the data source would be a new API endpoint or an extension-provided source, with the query composable in `resources/js/utils/`.
- **Optional gating:** If the feature is paid, gate it through `BillingContract` (`app/Service/BillingContract.php`) and `resources/js/utils/billing.ts`.

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
