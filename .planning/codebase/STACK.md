---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
# Technology Stack

**Analysis Date:** 2026-10-19

## Languages

**Primary:**
- PHP 8.3 (`composer.json` `"php": "8.3.*"`) - all backend code under `app/`, `routes/`, `config/`, `database/`
- TypeScript / Vue 3 SFCs - frontend under `resources/js/` (Pages, Components, Layouts) and workspace packages in `resources/js/packages/`

**Secondary:**
- JavaScript (ESM) - build and config files (`vite.config.js`, `vite-module-loader.js`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.mjs`)
- Blade - only the minimal root template for Inertia (`resources/views/`)
- SQL - PostgreSQL migrations in `database/migrations/`

## Runtime

**Backend:**
- PHP 8.3 served by FrankenPHP 1.11 (`docker/prod/Dockerfile`, `ARG FRANKENPHP_VERSION=1.11`, `dunglas/frankenphp:*-php8.3`)
- Laravel Octane 2.3+ (`laravel/octane`, `config/octane.php`, `OCTANE_SERVER` env var)
- Composer 2.8 for dependency install (build stage in `docker/prod/Dockerfile`)

**Frontend:**
- Node.js 20.x in CI (`.github/workflows/phpunit.yml`, `npm-build.yml`); no `.nvmrc` present
- Vite 7 (`package.json` devDependencies `vite ^7.3.3`) with `laravel-vite-plugin ^2.1.0`

**Package Managers:**
- Composer (PHP) - lockfile present: `composer.lock`
- npm (Node) - lockfile present: `package-lock.json`; npm workspaces declared in root `package.json` (`resources/js/packages/ui`, `resources/js/packages/api`)
- `.npmrc` sets `min-release-age=7` (npm will skip package versions published less than 7 days ago)

## Frameworks

**Core (backend):**
- Laravel Framework 13.x (`laravel/framework ^13.0`) - application framework
- Laravel Fortify 1.37+ (`laravel/fortify`) - session auth, registration, password reset, email verification, two-factor auth (config: `config/fortify.php`, provider: `app/Providers/FortifyServiceProvider.php`)
- Laravel Passport 13.0.5+ (`laravel/passport`) - OAuth2 server and personal access tokens for the REST API (config: `config/passport.php`, setup: `app/Providers/AuthServiceProvider.php`)
- Inertia.js server adapter 3.3+ (`inertiajs/inertia-laravel`) - SPA-style pages rendered from Laravel routes (`config/inertia.php`; SSR explicitly disabled per `.env.example`)
- Filament 5.0 (`filament/filament`) - admin panel (panel id `admin`, path `/admin`, provider in `app/Providers/Filament/`, resources in `app/Filament/Resources/`)
- Laravel Modules 13.x (`nwidart/laravel-modules`) - extension/module system rooted at `extensions/` (`config/modules.php`)

**Core (frontend):**
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

**API documentation:**
- Scramble 0.13.43+ (`dedoc/scramble`) - generates OpenAPI from routes; configured in `config/scramble.php`, extended with OAuth scheme in `app/Providers/AppServiceProvider.php`. Checked-in spec: `openapi.json` (repo root).

**Testing:**
- PHPUnit 12 (`phpunit/phpunit ^12`) with `phpunit.xml`; Laravel test runner via `php artisan test` (`composer test`)
- Paratest 7.3 for parallel PHP tests (`composer ptest`)
- Mockery 1.4, `timacdonald/log-fake`
- Vitest 4.1 with happy-dom 20 (`vitest.config.ts`, `npm run test:unit`); `@vue/test-utils ^2.4.6`
- Playwright 1.60 for E2E (`playwright.config.ts`, `e2e/`, `npm run test:e2e`); Playwright Docker image `mcr.microsoft.com/playwright:v1.60.0-jammy` in `docker-compose.yml`

**Build/Dev:**
- Vite 7 + `vite-plugin-checker ^0.12.0` (type/lint checks in dev) - `vite.config.js`
- TypeScript 5.9 and `vue-tsc ^3.2.8` (`npm run type-check`), `tsconfig.json`, `jsconfig.json`
- ESLint 9 flat config (`eslint.config.mjs`, `npm run lint`) with `eslint-plugin-unused-imports`
- Prettier (`.prettierrc.json`, `npm run format`) and Laravel Pint 1.x (`pint.json`, `composer fix`)
- PHPStan via Larastan 3.5 (`phpstan.neon`, `composer analyse`)
- Laravel Telescope 5.x (dev dependency; registered only in `local` env via `app/Providers/AppServiceProvider.php`; `config/telescope.php`)
- Laravel Sail 1.18 and IDE helper 3.x (dev dependencies; `docker-compose.yml` is Sail-style)
- `openapi-zod-client ^1.18.3` for typed client generation

## Key Dependencies

**Critical (backend):**
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

**Critical (frontend):**
- `@solidtime/ui` and `@solidtime/api` - in-repo workspace packages (`resources/js/packages/ui`, `resources/js/packages/api`, both published via `.github/workflows/npm-publish-*.yml`)
- `@tanstack/vue-query`, `zod`, `@zodios/core` - API data layer

**Infrastructure:**
- `laravel/octane ^2.3` - long-running worker server
- `laravel/tinker ^3.0` - REPL
- `nwidart/laravel-modules ^13.0.0` - extension loader (`extensions/extensions_autoload.php`)

## Extensions (Git-sourced modules)

Declared in `extensions/manifest.json`, pulled at build time by GitHub repository and pinned ref:
- `Billing` - `solidtime-io/extension-billing` @ `v0.0.11`
- `Services` - `solidtime-io/extension-services` @ `v0.0.4`
- `Invoicing` - `solidtime-io/extension-invoicing` @ `v0.0.12` (its presence flips `is_premium` in telemetry, see `app/Service/ApiService.php`)
- `Auditing` - `solidtime-io/extension-auditing` @ `v0.0.5`

## Configuration

**Environment:**
- Configured through `.env` files loaded by Laravel. Templates in repo: `.env.example` (full variable list), `.env.ci`, `.env.production`.
- Do not commit real `.env` values. The active environment file is not documented here by design.
- Key variable groups (names only, from `.env.example`): `APP_*` (name, env, key, URL, `APP_FORCE_HTTPS`, `APP_ENABLE_REGISTRATION` = `on|off|invite-only`, `SUPER_ADMINS`), `DB_*` and `DB_TEST_*`, `CACHE_DRIVER`, `QUEUE_CONNECTION`, `SESSION_DRIVER`/`SESSION_LIFETIME`, `MAIL_*`, `FILESYSTEM_DISK`/`PUBLIC_FILESYSTEM_DISK`, `S3_*`, `PASSPORT_PERSONAL_ACCESS_CLIENT_ID`/`_SECRET`, `AUDITING_ENABLED`, `TELESCOPE_ENABLED`, `GOTENBERG_URL`, `OCTANE_SERVER`, `INERTIA_SSR_ENABLED`
- Passport key material is read from `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY` (`config/passport.php`); CI generates keys with `php artisan passport:keys`.
- Defaults that differ from `.env.example`: DB default connection `pgsql` (`config/database.php`), cache `file`, queue `sync`, filesystem `local`, mail `smtp`, broadcast `null`.

**Build:**
- `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `components.json` (shadcn-style component registry config), `tsconfig.json`, `jsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `phpstan.neon`, `phpunit.xml`, `pint.json`, `.prettierrc.json`, `.editorconfig`
- Docker: `docker/prod/Dockerfile` (multi-stage: `composer:2.8` vendor stage, `dunglas/frankenphp` builder, runtime image), `docker/local/`, `docker-compose.yml`, `.dockerignore`
- Deployment assets: `docker/prod/deployment/`

**Database:**
- Primary driver: PostgreSQL (`config/database.php`, default `pgsql`); dev and CI use `postgres:15` images (`docker-compose.yml`)
- Separate test connection `pgsql_test` (`DB_TEST_*`); `composer refresh-schema-dump` regenerates the schema dump from it

## Platform Requirements

**Development:**
- PHP 8.3 with `ext-zip` (`composer.json`)
- Composer 2.x, Node.js 20.x, npm
- Docker (Laravel Sail-style `docker-compose.yml`): PostgreSQL 15, Mailpit (mail capture), MinIO (S3 dev storage, `minio/minio:latest`), Playwright container, Gotenberg (optional, only needed for PDF features)

**Production:**
- Container image built by `.github/workflows/build-public.yml`, `build-private.yml`, `build-onpremise.yml` and published to GHCR (`ghcr.io/solidtime-io/solidtime`)
- Runtime: FrankenPHP (Caddy-based PHP server) on Linux, running as UID/GID 1000, TZ default UTC (`docker/prod/Dockerfile`)
- Requires PostgreSQL, a mail transport (SMTP), optional S3-compatible storage, optional Gotenberg service, and a queue/cache backend of choice (defaults are `sync`/`file`; no Redis dependency is declared in `composer.json`)

---

*Stack analysis: 2026-10-19*
