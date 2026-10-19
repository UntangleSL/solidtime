---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
# Codebase Concerns

**Analysis Date:** 2026-10-19

## Tech Debt

**Hardcoded development URL in OpenAPI security scheme:**
- Issue: The OAuth2 authorization URL for the API docs is hardcoded to a local dev host instead of `config('app.url')`.
- Files: `app/Providers/AppServiceProvider.php` (line ~95, `https://solidtime.test/oauth/authorize`)
- Impact: Generated API docs on any non-`solidtime.test` deployment advertise a non-working authorization URL. Fork-specific drift risk if the upstream fixes it differently.
- Fix approach: Derive the URL from `url('/oauth/authorize')` or `config('app.url')`. Keep the change minimal to ease upstream merges.

**Static, process-wide state in permission handling:**
- Issue: `PermissionStore` keeps custom role permissions in static properties that persist for the life of a PHP process.
- Files: `app/Service/PermissionStore.php` (lines ~277-315, `self::$customRolePermissions`), `app/Service/Dto/UserAgentDto.php` (lines ~20-37, static arrays)
- Impact: Under Laravel Octane (`config/octane.php`, `checkOctaneCompatibility: true` in `phpstan.neon`), state can leak between requests and between tenants if it is written per request. Tests that mutate it must reset it manually.
- Fix approach: Scope the store to the container (`scoped`/`instance` bound per request) or reset in an Octane `RequestTerminated` listener. Confirm every writer calls the reset helper.

**Open TODO in API routes:**
- Issue: A route is annotated `// TODO` without a tracking reference.
- Files: `routes/api.php` (line ~126, `/users/me/time-entries`)
- Impact: Unclear whether the endpoint is complete or is missing scope/permission checks.
- Fix approach: Confirm the route's authorization and either close the TODO or link an issue.

**Very large controllers and services:**
- Issue: Several classes concentrate many responsibilities.
- Files: `app/Http/Controllers/Api/V1/TimeEntryController.php` (985 lines), `app/Service/TimeEntryAggregationService.php` (562), `app/Service/DashboardService.php` (476), `app/Service/PermissionStore.php` (394), `app/Service/Export/ExportService.php` (391)
- Impact: High merge-conflict probability when upstream changes the same files (see Fork Mergeability below); harder to test in isolation.
- Fix approach: Extract query building and export/rounding helpers into dedicated classes. Do this only when touching the code for a feature, to keep upstream diffs small.

**Raw SQL with per-driver expressions:**
- Issue: Time aggregation relies on PostgreSQL-specific SQL (`extract(epoch from ...)`, `distinct on`, `::varchar`, `is distinct from`) built as raw strings.
- Files: `app/Models/Project.php` (~104, ~121), `app/Models/Task.php` (~87, ~104), `app/Service/DashboardService.php` (~157-356), `app/Service/TimeEntryAggregationService.php` (~58-173), `app/Console/Commands/SelfHost/SelfHostDatabaseConsistency.php` (~42-95)
- Impact: Hard to port to another database; `@phpstan-ignore` markers hide type issues on these lines.
- Fix approach: Keep raw expressions centralized in one helper per concern and cover them with feature tests against PostgreSQL in CI.

## Known Bugs

**Not determined from static review:**
- Symptoms: No confirmed bugs were reproduced during this mapping pass. Test runs were not executed.
- Files: Not applicable
- Trigger: Not applicable
- Workaround: Not applicable

## Security Considerations

**Wildcard CORS on the API:**
- Risk: `allowed_origins` is `*` for `api/*` and `sanctum/csrf-cookie`. Any origin can make credentialless cross-origin calls. Risk is limited while the API authenticates only with bearer tokens, but it becomes serious if any cookie-authenticated endpoint is exposed under `api/*`.
- Files: `config/cors.php` (lines 20, 24)
- Current mitigation: API routes use Passport bearer tokens (`app/Providers/AuthServiceProvider.php`), not cookies.
- Recommendations: Restrict `allowed_origins` to the configured app URL and known front-ends via env, and add a test asserting that cookie-auth routes are not under `api/*`.

**No encrypted attribute casts on models:**
- Risk: No model uses an `encrypted` cast or `Crypt::` call. Any secret stored in the database (for example a future OAuth refresh token) would be plaintext at rest.
- Files: `app/Models/` (no `encrypted` casts found); `config/session.php` (line 50, `'encrypt' => false`)
- Current mitigation: No provider credentials are stored yet. Passport token storage was not audited in detail in this pass.
- Recommendations: See "Microsoft 365 OAuth token storage" below.

**Passport personal access tokens last 12 months:**
- Risk: Long-lived bearer tokens increase the blast radius of a leaked token.
- Files: `app/Providers/AuthServiceProvider.php` (line 64, `personalAccessTokensExpireIn(now()->addMonths(12))`); refresh and access token expiry lines 62-63 are commented out.
- Current mitigation: Expiry reminder jobs (`auth:send-mails-expiring-api-tokens`, scheduled in `app/Console/Kernel.php`) notify users.
- Recommendations: Make the lifetime configurable via env with a shorter default, and consider enabling `tokensExpireIn` / `refreshTokensExpireIn` explicitly.

**Outbound version check sends instance metadata:**
- Risk: `ApiService::checkForUpdate()` posts app version, build, the instance `app.url`, and premium status to `https://app.solidtime.io/api/v1/ping/version`. This is enabled by `scheduling.tasks.self_hosting_check_for_update` / `self_hosting_telemetry`.
- Files: `app/Service/ApiService.php` (lines 13-40, 58-70), `app/Console/Kernel.php` (scheduling block using `hash('md5', config('app.key'))` as a seed)
- Current mitigation: Gated by config flags; the schedule seed is derived from `APP_KEY` only for timing, not as a secret.
- Recommendations: Document the telemetry in self-host docs, make it opt-out by default for privacy-sensitive forks, and use a timeout-protected, non-blocking call (already 2-3 s timeouts).

**Outbound Gotenberg PDF calls without explicit timeout:**
- Risk: Guzzle clients for Gotenberg are created without a `timeout`, so a stalled renderer can hold PHP workers.
- Files: `app/Http/Controllers/Api/V1/TimeEntryController.php` (lines ~313, ~502), `config/services.php` (`gotenberg` block)
- Current mitigation: Export is gated by `PdfRendererIsNotConfiguredException` when the URL is unset.
- Recommendations: Pass `'timeout' => 30` and `'connect_timeout' => 5` to the client, and move PDF generation to a queued job for large reports.

**Session cookies not encrypted and cache unserialization policy:**
- Risk: `config/session.php` disables session encryption (`'encrypt' => false`). Cache serialization is allowed only through the default `allowed_classes` setting in `config/cache.php`; a leaked `APP_KEY` would allow gadget chains through serialized sessions or cache values.
- Files: `config/session.php` (line 50), `config/cache.php` (lines 134-136)
- Current mitigation: Session cookies are `http_only` by default (`config/session.php` line 185) and `same_site` is `lax`.
- Recommendations: Enable session encryption or confirm the session driver stores only non-sensitive data; keep `APP_KEY` out of logs and exports.

**Debug and admin surfaces reachable in production builds:**
- Risk: Telescope and Filament impersonation are installed as runtime dependencies (`composer.json`: `laravel/telescope` is dev-only but `stechstudio/filament-impersonate` is a production dependency), and admin access is controlled by `SUPER_ADMINS`.
- Files: `composer.json`, `.env.example` (`SUPER_ADMINS`, `TELESCOPE_ENABLED`, `APP_DEBUG`), `config/telescope.php`, `config/filament.php`
- Current mitigation: Telescope is dev-only in `composer.json`; `APP_DEBUG` defaults to `false` in `config/app.php`.
- Recommendations: Verify production images run with `composer install --no-dev`, and add an explicit check that `TELESCOPE_ENABLED` is false in production.

**Upload parsing of untrusted import files:**
- Risk: Import endpoints parse user-supplied JSON/CSV archives (Toggl, Clockify, Solidtime importers) using `file_get_contents` on extracted paths.
- Files: `app/Http/Requests/V1/Import/ImportRequest.php` (line ~27, size limit from `config/import.php`), `app/Service/Import/Importers/TogglDataImporter.php` (lines 35-178), `app/Service/Import/Importers/SolidtimeImporter.php` (line 44)
- Current mitigation: Size cap via `config('import.max_data_size')`; extraction goes through `spatie/temporary-directory`.
- Recommendations: Validate archive entries against path traversal (zip-slip) before extraction, and validate MIME type and extension server-side.

## Performance Bottlenecks

**Aggregation over full time-entry sets:**
- Problem: Dashboard and aggregate endpoints compute sums with `extract(epoch ...)` over `time_entries` on each request.
- Files: `app/Service/DashboardService.php` (~157-356), `app/Service/TimeEntryAggregationService.php` (~58-173), `app/Models/Project.php` (~104-121), `app/Models/Task.php` (~87-104)
- Cause: Totals are recomputed rather than stored; `coalesce("end", now())` prevents index-only scans.
- Improvement path: Add indexes on `(organization_id, start)` and `(member_id, start)` if not present (check `database/migrations`), and cache per-day totals for closed entries.

**Import of large files in memory:**
- Problem: Importers read whole JSON files with `file_get_contents` and decode them in memory.
- Files: `app/Service/Import/Importers/TogglDataImporter.php`, `app/Service/Import/ImportDatabaseHelper.php` (`md5($jsonData)` on full payload, line ~140)
- Cause: Entire payload is held in memory, plus hashing.
- Improvement path: Stream with a JSON streaming parser and chunk inserts.

**Export without row streaming:**
- Problem: CSV/XLSX exports build collections before writing.
- Files: `app/Service/Export/ExportService.php`, `app/Http/Requests/V1/TimeEntry/TimeEntryIndexExportRequest.php`
- Cause: `maatwebsite/excel` used without `FromQuery`/chunk-based export.
- Improvement path: Implement `FromQuery` with chunking.

## Fragile Areas

**Time-entry rounding and boundary logic:**
- Files: `app/Http/Controllers/Api/V1/TimeEntryController.php` (lines ~200-201, `getStartSelectRawForRounding` / `getEndSelectRawForRounding`), `app/Service/TimeEntryFilter.php`, `app/Service/TimezoneService.php`
- Why fragile: Rounding is applied in SQL and timezone conversions occur in both PHP and SQL, with `@phpstan-ignore` on the call sites.
- Safe modification: Change one layer at a time and run the time-entry feature tests in `tests/` after each change.
- Test coverage: Feature tests exist; DST and cross-midnight rounding cases should be checked explicitly.

**Frontend timesheet math:**
- Files: `resources/js/utils/timesheet/breakPlacementMath.ts` (649 lines), `resources/js/utils/timesheet/useTimesheetCellMutations.ts`
- Why fragile: Dense calculation logic with large colocated tests (`breakPlacementMath.test.ts` 684 lines, `useTimesheetCellMutations.test.ts` 793 lines).
- Safe modification: Keep the tests green and extend them before changing break placement rules.
- Test coverage: Unit tests present; only 16 frontend test files exist across `resources/js`.

**Permission model split between code and database:**
- Files: `app/Service/PermissionStore.php`, `app/Policies/` (if present), `app/Http/Middleware/`
- Why fragile: Custom role permissions can be overridden at runtime through static setters (see Tech Debt).
- Safe modification: Add a test per role before modifying permission mappings.

**Generated API client:**
- Files: `resources/js/packages/api/src/openapi.json.client.ts` (5,523 lines, generated), `openapi.json` (repo root), `package.json` script `zod:generate`
- Why fragile: Regenerated from a running server; manual edits are lost and drift is easy.
- Safe modification: Regenerate with `npm run zod:generate` after API changes; never hand-edit.

## Scaling Limits

**Single PostgreSQL database and single PHP process model:**
- Current capacity: Not measured in this review.
- Limit: Dashboard and aggregate queries scan time entries per organization; Octane static state (see Tech Debt) limits safe concurrency per worker.
- Scaling path: Read replicas for reporting, indexed aggregate tables, and per-request scoped services.

**Queue and scheduler:**
- Current capacity: `config/queue.php` default driver from `QUEUE_CONNECTION` in `.env.example`.
- Limit: Expiry mails, import jobs, and PDF exports share the same queue configuration.
- Scaling path: Separate queues for exports and mail, with timeouts set per job.

## Dependencies at Risk

**Pre-release or wide-range packages:**
- Risk: `filament/filament` pinned to `^5.0`, `laravel/framework` `^13.0`, `dedoc/scramble` `^0.13.43`, `@tanstack/vue-form` `^1.32.0` and `@vueuse/core` `^14.4.0` are recent major lines. Caret ranges allow minor/patch drift.
- Files: `composer.json`, `package.json`, `composer.lock`, `package-lock.json`
- Impact: Upstream and fork can diverge on minor versions, producing lockfile conflicts.
- Migration plan: Commit lockfiles only from one branch of truth; when merging upstream, regenerate lockfiles rather than hand-merging.

**Abandonware-prone small packages:**
- Risk: `novadaemon/filament-pretty-json`, `pxlrbt/filament-environment-indicator`, `stechstudio/filament-impersonate` are single-maintainer packages wired into the admin panel.
- Files: `composer.json`
- Impact: Admin panel breakage on Filament upgrades.
- Migration plan: Pin tested versions and verify on each Filament upgrade.

## Missing Critical Features

**No secret storage abstraction for third-party integrations:**
- Problem: The codebase has no table or service for storing per-user or per-organization third-party OAuth credentials.
- Blocks: Microsoft 365 connection cannot be stored securely without first adding encrypted storage, token rotation, and revocation.

**No outbound-integration audit trail:**
- Problem: External calls (update check, Gotenberg, future OAuth) are not logged with correlation IDs or outcome status.
- Blocks: Diagnosing failed integrations and proving what data left the system.

## Test Coverage Gaps

**Backend integration with external services:**
- What's not tested: Gotenberg PDF generation and `ApiService` version check are not verified against real or fake HTTP responses in the reviewed files.
- Files: `app/Service/ApiService.php`, `app/Http/Controllers/Api/V1/TimeEntryController.php`
- Risk: Timeouts and malformed responses go unnoticed.
- Priority: Medium

**Import edge cases:**
- What's not tested: Zip-slip paths, malformed Toggl/Clockify payloads, and very large archives were not confirmed as covered (test files not exhaustively reviewed).
- Files: `app/Service/Import/Importers/`, `tests/`
- Risk: Crashes or unsafe file writes during import.
- Priority: High

**Frontend component coverage:**
- What's not tested: Only 16 frontend test files exist against roughly 18k lines of TS/Vue in `resources/js` (excluding generated client).
- Files: `resources/js/components`, `resources/js/Components/Common/Reporting/ReportingOverview.vue`, `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue`
- Risk: Regressions in calendar and reporting views.
- Priority: Medium

## Fork Mergeability Risks (vs. upstream solidtime)

- **Extension manifest coupling:** `extensions/manifest.json` pins upstream extension repos (`solidtime-io/extension-billing` v0.0.11, `-services` v0.0.4, `-invoicing` v0.0.12, `-auditing` v0.0.5). Bumping these in upstream requires a matching change here. `.github/workflows/extension-manifest-check.yml` enforces consistency.
- **Parallel CI pipelines:** `build-private.yml`, `build-public.yml`, `build-onpremise.yml`, and `phpunit-extensions.yml` / `playwright-extensions.yml` differ by target. Changes to one often need mirroring; keep fork-only edits out of these files.
- **Hardcoded upstream endpoint:** `app/Service/ApiService.php` targets `https://app.solidtime.io/api/v1`. A fork must decide whether to keep this telemetry target or redirect it, and document the choice.
- **Generated artifacts in the diff:** `openapi.json`, `resources/js/packages/api/src/openapi.json.client.ts`, `composer.lock`, `package-lock.json` will conflict on every upstream sync. Regenerate rather than merge by hand.
- **Large shared files:** `TimeEntryController.php` (985 lines), `routes/api.php`, `app/Providers/AppServiceProvider.php`, and `config/*.php` are hot spots. Keep fork customizations in new files or in config/env rather than editing these in place.
- **Configuration drift:** `.env.example` is the only documented env contract; `.env.ci` and `.env.production` also exist and should be diffed on each sync (not read for values in this review).
- **Composer merge plugin:** `composer.json` uses `wikimedia/composer-merge-plugin`; check that fork-local `composer.local.json` (if added) does not shadow upstream requirements.
- **Modules and extensions:** `config/modules.php` and `extensions/` (gitignored except manifest) allow code injection from separate repos. Fork-specific modules should live in a separate directory name to avoid colliding with upstream module names such as `Invoicing`.

## Microsoft 365 OAuth Token Storage: Security Risks

The codebase currently has no Microsoft Graph/Azure AD integration (no `microsoft`/`graph`/`azure` provider code found in `app/`, `config/`, or `routes/`). Adding one introduces these specific risks:

- **Refresh tokens at rest in plaintext:** No model uses `encrypted` casts. Store Microsoft refresh tokens in a dedicated table with `'refresh_token' => 'encrypted'` cast (Laravel uses `APP_KEY`), and never in `users` or in the session. Plan for `APP_KEY` rotation, which invalidates existing ciphertext unless re-encrypted.
- **Key management:** Keep the Azure client secret in environment variables only (`.env` is gitignored), never in `config/services.php` values with defaults. Prefer certificate or managed-identity auth in production.
- **Scope minimization:** Request only the Graph scopes needed (for example `Calendars.Read` or `offline_access` only if required). Store the granted scopes alongside the token row to detect drift.
- **Token exposure in logs and audits:** `owen-it/laravel-auditing` (`config/audit.php`, `app/Extensions/Auditing`) may record model attribute changes. Exclude the token columns via `$auditExclude` on the model, and ensure Telescope (dev-only) and Log channels never receive token payloads.
- **Hidden attributes:** Add token columns to `$hidden` on the model so that API serialization and Inertia props never expose them. Existing precedent: `app/Models/User.php` (line 94, `$hidden`).
- **Redirect and state handling:** Validate the OAuth `state` parameter per session and enforce PKCE. Note that `Passport::authorizationView` and the Passport auth-code flow are for solidtime's own clients, not for Microsoft callbacks; keep the two flows separate.
- **Revocation on user or organization deletion:** `app/Service/DeletionService.php` (around lines 170-190) already deletes Passport tokens explicitly. Microsoft tokens must be added to the same deletion path, or they will survive account deletion.
- **Outbound calls:** Microsoft Graph calls should use the same timeout discipline as Gotenberg (see Security), and failures should be logged without token values.
- **Database encryption and backups:** Encrypted columns protect against DB dumps only if the `APP_KEY` is stored separately from the backup. Document this in self-host guides.

---

*Concerns audit: 2026-10-19*
