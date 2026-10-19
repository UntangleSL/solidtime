---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
# External Integrations

**Analysis Date:** 2026-10-19

## APIs & External Services

**Import sources (inbound data, no live API calls):**
- Clockify, Harvest, Toggl, generic CSV, and solidtime-native exports are parsed from uploaded files
  - Implementation: `app/Service/Import/Importers/` (`ClockifyTimeEntriesImporter.php`, `ClockifyProjectsImporter.php`, `HarvestTimeEntriesImporter.php`, `HarvestProjectsImporter.php`, `HarvestClientsImporter.php`, `TogglTimeEntriesImporter.php`, `TogglDataImporter.php`, `GenericTimeEntriesImporter.php`, `GenericProjectsImporter.php`, `SolidtimeImporter.php`), dispatched by `ImporterProvider.php`
  - Parsing: `league/csv`, `maatwebsite/excel`, `ZipImportHelper.php`
  - Auth: none (file upload only)

**PDF rendering:**
- Gotenberg (HTML-to-PDF microservice), optional
  - SDK/Client: `gotenberg/gotenberg-php`
  - Config: `services.gotenberg.url`, `services.gotenberg.basic_auth_username`, `services.gotenberg.basic_auth_password` (env `GOTENBERG_URL`, `GOTENBERG_BASIC_AUTH_USERNAME`, `GOTENBERG_BASIC_AUTH_PASSWORD`) in `config/services.php`
  - Used in: `app/Http/Controllers/Api/V1/TimeEntryController.php` (imports `Gotenberg\Gotenberg`, `Gotenberg\Stream`)
  - Behavior: when URL is null and not in debug, the controller takes the failure path rather than rendering

**solidtime-hosted endpoints (outbound, self-hosted instances only):**
- `https://app.solidtime.io/api/v1/ping/version` - update check
- `https://app.solidtime.io/api/v1/ping/telemetry` - aggregate counts (users, orgs, projects, clients, tasks, audits, time entries) plus version, build, URL, and `is_premium` flag
  - Implementation: `app/Service/ApiService.php` (`API_URL` constant, `Http::asJson()` with 2s connect / 3s timeout)
  - Scheduling: `app/Console/Kernel.php`, gated by `config('scheduling.tasks.self_hosting_check_for_update')` and `self_hosting_telemetry` (`config/scheduling.php`)
  - Failure is logged and swallowed

**Generic outbound HTTP:**
- Guzzle clients constructed directly in `app/Http/Controllers/Api/V1/TimeEntryController.php` (two instances, around lines 313 and 502); their exact remote targets were not traced in this pass and should be confirmed before adding new outbound calls

**Extensions pulled from GitHub at build time:**
- `solidtime-io/extension-billing`, `extension-services`, `extension-invoicing`, `extension-auditing` - pinned refs in `extensions/manifest.json`; checked by `.github/workflows/extension-manifest-check.yml`

## Data Storage

**Databases:**
- PostgreSQL (primary, `config/database.php` default `pgsql`)
  - Connection: `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`; test connection `pgsql_test` via `DB_TEST_*`
  - Client: Eloquent via Laravel; `tpetry/laravel-postgresql-enhanced` for PG-specific schema features
  - Migrations: `database/migrations/` (includes `2026_08_24_000001_add_application_query_indexes.php`)
  - Dev/CI image: `postgres:15` (`docker-compose.yml`)

**File Storage:**
- Local filesystem by default (`FILESYSTEM_DISK=local`); `PUBLIC_FILESYSTEM_DISK` for public assets
- S3-compatible object storage optional
  - Client: `league/flysystem-aws-s3-v3`
  - Env: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_BUCKET`, `S3_URL`, `S3_ENDPOINT`, `S3_USE_PATH_STYLE_ENDPOINT`
  - Dev: MinIO container (`docker-compose.yml`, `minio-create-bucket` service)

**Caching:**
- Default `CACHE_DRIVER=file` (`config/cache.php`). No Redis or Memcached client is declared in `composer.json`.

**Queues and broadcasting:**
- Default `QUEUE_CONNECTION=sync` (`config/queue.php`); no queue worker service is required by default
- `BROADCAST_DRIVER=null` (`config/broadcasting.php`); no Pusher, Reverb, or Ably dependency is present

**Sessions:**
- `SESSION_DRIVER` / `SESSION_LIFETIME` (`config/session.php`); session auth guard `web` (`config/auth.php`)

## Authentication & Identity

**Current state: no third-party identity provider. No SSO, OIDC, SAML, Socialite, or social login was found in the codebase.**

**Web session auth (Fortify):**
- Provider: Laravel Fortify 1.37+, guard `web`, username field `email`, lowercased usernames (`config/fortify.php`)
  - Implementation: `app/Providers/FortifyServiceProvider.php` binds `CreateNewUser`, `UpdateUserProfileInformation`, `UpdateUserPassword`, `ResetUserPassword`; views are Inertia pages
  - Features enabled: registration, password reset, email verification, profile update, password update
  - Two-factor authentication (TOTP) enabled with `confirm` and `confirmPassword` options (`config/fortify.php`)
  - Registration policy controlled by `APP_ENABLE_REGISTRATION` (`on`, `off`, `invite-only`)
  - Super admins from `SUPER_ADMINS` env (`.env.example`)
- Route protection: `auth:web`, `auth.session`, `verified` middleware on app routes (`routes/web.php`)
- Other browser sessions management: `app/Http/Controllers/Web/OtherBrowserSessionsController.php`

**API auth (Laravel Passport):**
- OAuth2 server with authorization code, refresh tokens, and personal access tokens
  - Setup: `app/Providers/AuthServiceProvider.php` (`Passport::tokensCan` scopes `create`, `read`, `update`, `delete`; default scope `read`; PATs expire in 12 months; authorization view `auth.oauth.authorize`)
  - Custom models: `Token`, `RefreshToken`, `AuthCode`, `Client` in `app/Models/` (Passport model overrides registered via `Passport::use*Model`)
  - Config: `config/passport.php` (guard `web`, keys from `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`, connection `PASSPORT_CONNECTION`)
  - Personal access client: `PASSPORT_PERSONAL_ACCESS_CLIENT_ID` / `_SECRET`
  - Guard: `api` guard uses `passport` driver (`config/auth.php`)
  - Schema: OAuth tables in `database/migrations/2016_06_01_*` through `2025_07_17_*`; hashed client secrets (`2025_07_15_105949_hash_oauth_clients.php`)
  - Device-code table exists (`database/migrations/2024_06_01_000001_create_oauth_device_codes_table.php`) but no app code path using it was found; treat device-flow support as unverified
- API docs advertise OAuth flow via Scramble (`app/Providers/AppServiceProvider.php`)

**Admin panel:**
- Filament 5 at `/admin` (`app/Providers/Filament/`), impersonation via `stechstudio/filament-impersonate`

**Microsoft / Entra ID status:**
- No Entra ID (Azure AD), OIDC, or Microsoft Graph code, config, or dependency exists yet
- Integration points that would be extended: `config/services.php` (add a `microsoft` block), `config/fortify.php` and `FortifyServiceProvider.php` (login and user creation via `CreateNewUser`), `app/Models/User.php` (needs a provider identifier column via a new migration), `app/Service/UserService.php` and `app/Service/InvitationService.php` (provisioning and invitations), `app/Providers/AuthServiceProvider.php` (Passport client if Entra tokens are to be accepted for API access)
- Passport does not natively validate external IdP tokens; an SSO bridge would need a custom guard or token exchange

## Calendar Features

**Internal calendar only, no external calendar sync:**
- Web route `/calendar` renders the Inertia page `Calendar` (`routes/web.php`)
- Time-entry calendar UI: `resources/js/packages/ui/src/FullCalendar/` (`TimeEntryCalendar.vue`, `useCalendarEvents.ts`, `useCalendarGrid.ts`, `CalendarSettingsPopover.vue`, `calendarSettings.ts`)
- Generic calendar primitives: `resources/js/packages/ui/src/calendar/`
- E2E coverage: `e2e/calendar.spec.ts`, `e2e/calendar-settings.spec.ts`
- No ICS feed, `text/calendar` response, CalDAV, Google Calendar, or Outlook/Microsoft Graph integration was found. Grep for `.ics`/`ical` returned no server-side generators.

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Bugsnag, Flare, or similar SDK in `composer.json` or `package.json`)
- Exception handling in `app/Exceptions/Handler.php`

**Logs:**
- Laravel logging (`config/logging.php`, `LOG_CHANNEL`, `LOG_LEVEL`, `LOG_DEPRECATIONS_CHANNEL`)

**Debugging (dev):**
- Laravel Telescope 5.x, registered only when `APP_ENV=local` (`app/Providers/AppServiceProvider.php`), toggled via `TELESCOPE_ENABLED`; authorization via `Laravel\Telescope\Http\Middleware\Authorize`

**Auditing:**
- `owen-it/laravel-auditing` writes to the database (`config/audit.php`); `AUDITING_ENABLED`

## Email

- Mail transport `MAIL_MAILER=smtp` by default (`config/mail.php`); host, port, credentials, encryption, from and reply-to addresses via `MAIL_*`
- Dev: Mailpit container (`axllent/mailpit`) in `docker-compose.yml`
- Used for verification, password reset (Fortify notifications), and organization invitations (`app/Service/InvitationService.php` queues `app/Mail/OrganizationInvitationMail`)

## CI/CD & Deployment

**Hosting:**
- Self-hostable Docker image; public image at `ghcr.io/solidtime-io/solidtime` (`.github/workflows/build-public.yml`); private and on-premise variants via `build-private.yml` and `build-onpremise.yml`
- Docker Compose for local stack (`docker-compose.yml`)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`):
  - Tests: `phpunit.yml` (PHP 8.3, Node 20, Postgres), `phpunit-extensions.yml`, `playwright.yml`, `playwright-extensions.yml`, `npm-test-unit.yml`
  - Quality: `phpstan.yml`, `pint.yml`, `npm-lint.yml`, `npm-typecheck.yml`, `npm-format-check.yml`, `npm-build.yml`
  - Packages: `npm-publish-api.yml`, `npm-publish-ui.yml` (publish `@solidtime/api` and `@solidtime/ui`)
  - API docs: `generate-api-docs.yml`
  - Container registry login: `docker/login-action` to GHCR
  - Community gating: `vouch-*.yml`, `extension-manifest-check.yml`
- Docker build via `docker/build-push-action@v7` with QEMU and Buildx

## Environment Configuration

**Required env vars (names only, from `.env.example`):**
- `APP_KEY`, `APP_URL`, `APP_ENV`, `APP_FORCE_HTTPS`
- `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
- `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM_ADDRESS`
- `PASSPORT_PERSONAL_ACCESS_CLIENT_ID`, `PASSPORT_PERSONAL_ACCESS_CLIENT_SECRET`, `PASSPORT_PRIVATE_KEY`, `PASSPORT_PUBLIC_KEY`
- Optional: `GOTENBERG_URL`, `S3_*`, `SUPER_ADMINS`, `APP_ENABLE_REGISTRATION`

**Secrets location:**
- Runtime secrets are provided through environment variables on the host or container. Local `.env` files are gitignored.
- Passport keys are generated (`php artisan passport:keys`) and not committed.
- Files in the repo named `.env.ci` and `.env.production` contain configuration templates. Their values were not reviewed for this document.

## Webhooks & Callbacks

**Incoming:**
- None detected (no webhook-named routes in `routes/web.php` or `routes/api.php`; the API is token-authenticated REST)

**Outgoing:**
- Telemetry and update-check pings to `app.solidtime.io` (self-hosted only, see above)
- No customer-facing outbound webhooks found

---

*Integration audit: 2026-10-19*
