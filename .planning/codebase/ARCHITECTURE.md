---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
<!-- refreshed: 2026-10-19 -->

# Architecture

**Analysis Date:** 2026-10-19

## System Overview

```text
┌────────────────────────────────────────────────────────────────────────┐
│                 Browser: Inertia + Vue 3 SPA pages                     │
│  `resources/js/app.ts` → `resources/js/Pages/*.vue` (Inertia pages)    │
│  TanStack Query + Pinia stores  →  `resources/js/packages/api/src`     │
└───────────────┬───────────────────────────────────────┬────────────────┘
                │ Inertia page requests (web routes)    │ JSON /api/v1/* (Passport)
                ▼                                       ▼
┌──────────────────────────────────┐   ┌───────────────────────────────────────┐
│  Web layer                       │   │  API layer                            │
│  `routes/web.php`                │   │  `routes/api.php` (prefix v1)         │
│  `app/Http/Controllers/Web/*`    │   │  `app/Http/Controllers/Api/V1/*`      │
│  `app/Http/Middleware/*`         │   │  Requests `app/Http/Requests/V1/*`    │
│                                  │   │  Resources `app/Http/Resources/V1/*`  │
└───────────────┬──────────────────┘   └───────────────┬───────────────────────┘
                │                                      │
                ▼                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Service layer  `app/Service/*` (TimeEntryService, ReportService,       │
│  MemberService, InvitationService, ...), DTOs `app/Service/Dto/*`        │
│  Contracts swapped by extensions: BillingContract, GoalsContract        │
└───────────────┬───────────────────────────────────────┬────────────────┘
                ▼                                       ▼
┌──────────────────────────────────┐   ┌───────────────────────────────────────┐
│  Domain models  `app/Models/*`   │   │  Async + scheduled work               │
│  Eloquent, PostgreSQL            │   │  Jobs `app/Jobs/*`, Events            │
│  `database/migrations/*`         │   │  `app/Events/*`, `routes/console.php` │
└──────────────────────────────────┘   │  / `app/Console/Kernel.php`           │
                                       └───────────────────────────────────────┘

Extension modules (`extensions/<Name>/`, loaded via `extensions/extensions_autoload.php`)
add routes, pages (`Invoicing::Page`), contract implementations and auditing.
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

**Overall:** Modular monolith. A Laravel 13 backend (PHP 8.3) serves both an Inertia.js + Vue 3 SPA and a versioned JSON REST API. Business logic lives in `app/Service/*` and models; controllers are thin. Optional capabilities (billing, services, invoicing, auditing) are external extension packages loaded from `extensions/`.

**Key Characteristics:**
- Two HTTP surfaces over the same services: Inertia web routes (session auth, `routes/web.php`) and `/api/v1` (Passport tokens, `routes/api.php`).
- Organization-scoped multi-tenancy: API routes are nested under `/organizations/{organization}/...`; time entries carry `organization_id`, `member_id`, `user_id`.
- Contract classes (`BillingContract`, `GoalsContract`) are bound in the service container so the OSS core can run without the Billing extension.
- Frontend state split: server state in TanStack Query (`resources/js/utils/use*Query.ts`), client/UI state in Pinia and small `use*Store` composables (`resources/js/utils/useCurrentTimeEntry.ts`, `useProjects.ts`).
- Generated API types: `openapi.json` is produced by Scramble (`app/Extensions/Scramble`, `config/scramble.php`); the TypeScript client is regenerated with `npm run zod:generate`.

## Layers

**HTTP / Controllers (web):**
- Purpose: Render Inertia pages and handle non-JSON endpoints.
- Location: `app/Http/Controllers/Web/`
- Contains: `DashboardController`, `OrganizationController`, `UserController`, `UserProfileController`, `OtherBrowserSessionsController`, `HealthCheckController`.
- Depends on: Services, Inertia.
- Used by: `routes/web.php`.
- Note: Most Inertia pages are defined as closures returning `Inertia::render('<PageName>')` directly in `routes/web.php` (e.g. `Calendar`, `Time`, `Timesheet`, `Reporting`), not via controllers.

**HTTP / Controllers (API):**
- Purpose: JSON endpoints under `/api/v1`.
- Location: `app/Http/Controllers/Api/V1/` (one controller per resource: `TimeEntryController`, `UserTimeEntryController`, `ProjectController`, `ClientController`, `TaskController`, `TagController`, `GoalController`, `ReportController`, `ChartController`, `ExportController`, `ImportController`, `MemberController`, `InvitationController`, `OrganizationController`, `UserController`, `UserMembershipController`, `ApiTokenController`, `CurrencyController`, `TimeZoneController`, `ProjectMemberController`).
- Public subset: `app/Http/Controllers/Api/V1/Public/ReportController.php` (shared-report endpoints, reached without login).
- Depends on: Form requests (`app/Http/Requests/V1/<Resource>/`), API resources (`app/Http/Resources/V1/<Resource>/`), Services.
- Used by: `routes/api.php`, the Vue SPA via `resources/js/packages/api`, and external clients.

**Validation / Transformation:**
- Requests: `app/Http/Requests/V1/<Resource>/*Request.php` validate and authorize.
- Resources: `app/Http/Resources/V1/<Resource>/*Resource.php` shape JSON output.
- Custom rules: `app/Rules/`.
- Exceptions to JSON: `app/Exceptions/Api/`.

**Service layer:**
- Purpose: Domain logic, aggregation, import/export, permission checks.
- Location: `app/Service/` (flat, plus `app/Service/Dto`, `app/Service/Export`, `app/Service/Import` with `Importers/`, `app/Service/ReportExport`, `app/Service/IpLookup`).
- Depends on: Models, Eloquent query builders, Spatie/Excel/CSV libraries.
- Used by: Controllers, Filament resources, console commands, jobs.

**Domain / Persistence:**
- Purpose: Eloquent models, relations, computed attributes, auditing.
- Location: `app/Models/`, concerns in `app/Models/Concerns/` (`HasUuids`, `AuditableThroughParent`, `AuditableWithoutOwner`, `CustomAuditable`), Passport models in `app/Models/Passport/`.
- Migrations: `database/migrations/` plus schema dumps in `database/schema/`.
- Depends on: PostgreSQL (`tpetry/laravel-postgresql-enhanced`), `korridor/laravel-computed-attributes`, `korridor/laravel-has-many-sync`.

**Async / Events:**
- Jobs: `app/Jobs/` (spent-time recalculation); `app/Jobs/Test/` for queue testing.
- Events: `app/Events/` (`AfterCreateOrganization`, `MemberAdding`, `MemberAdded`, `MemberRemoved`, `MemberMadeToPlaceholder`, `OrganizationInvitationAdding`, `BeforeOrganizationDeletion`, `NewsletterRegistered`, `DatabaseSeederAfterSeed`, `DatabaseSeederBeforeDelete`). Listeners are registered via `app/Providers/EventServiceProvider.php`.
- Queue: `config/queue.php`; default connection is `sync` unless `QUEUE_CONNECTION` is set (drivers include database, beanstalkd, Redis, etc.).
- Scheduler: `app/Console/Kernel.php` registers `time-entry:send-still-running-mails`, `auth:send-mails-expiring-api-tokens`, and self-host commands (`self-host:check-for-update`, `self-host:telemetry`, `self-host:database-consistency`).
- Console: `app/Console/Commands/` grouped by domain (`Admin`, `Auth`, `Correction`, `Report`, `SelfHost`, `Test`, `TimeEntry`).

**Frontend (Inertia pages):**
- Purpose: Full-page Vue components rendered by Inertia.
- Location: `resources/js/Pages/` (e.g. `Calendar.vue`, `Time.vue`, `Timesheet.vue`, `Dashboard.vue`, `Projects.vue`, `ProjectShow.vue`, `Clients.vue`, `Members.vue`, `Goals.vue`, `Reporting*.vue`, `Import.vue`, `Tags.vue`, `Auth/`, `Profile/`, `Teams/`).
- Layout: `resources/js/Layouts/AppLayout.vue`.
- Depends on: `resources/js/packages/ui` (component library), `resources/js/packages/api` (client), `resources/js/utils` (queries, stores, helpers).

**Frontend (shared UI library):**
- Purpose: Reusable components; workspace package `@solidtime/ui`.
- Location: `resources/js/packages/ui/src/` (`FullCalendar/`, `calendar/`, `range-calendar/`, `TimeEntry/`, `TimeTracker/`, `Project/`, `Client/`, `Tag/`, shadcn-style primitives such as `dialog/`, `select/`, `tabs/`, `tooltip/`).
- Note: `resources/js/Components/` holds app-level components (`TimeTracker.vue`, `Timesheet/`, `Dashboard/`, `CommandPalette/`, `Billing/`, `Common/`); `resources/js/Components/ui` is a local copy.

**Frontend (API client package):**
- Purpose: Typed HTTP client generated from the OpenAPI spec.
- Location: `resources/js/packages/api/src/` (`index.ts` exports `api`, types such as `TimeEntry`, `CreateProjectBody`, `Client`, `TimeEntryResponse`).
- Generation: `npm run zod:generate` (`openapi-zod-client` against `/docs/api.json`).

## Data Flow

### Primary Request Path (Inertia page, e.g. Calendar)

1. Browser requests `/calendar`; route in `routes/web.php` runs `auth:web`, `auth.session`, `verified` middleware, then returns `Inertia::render('Calendar')`.
2. `resources/js/app.ts` resolves `./Pages/Calendar.vue` through `resolvePageComponent` and mounts the app with Pinia, Ziggy, and TanStack Query (`VueQueryPlugin`).
3. `Calendar.vue` (`resources/js/Pages/Calendar.vue`) calls `useTimeEntriesCalendarQuery(calendarStart, calendarEnd)` (`resources/js/utils/useTimeEntriesCalendarQuery.ts`), which computes an expanded date range (previous + current + next period) in UTC and calls `api.getTimeEntries(...)` from `resources/js/packages/api/src`.
4. The request hits `GET /api/v1/organizations/{organization}/time-entries` (`routes/api.php` → `app/Http/Controllers/Api/V1/TimeEntryController.php`), which validates via a request class in `app/Http/Requests/V1/TimeEntry/` and delegates to `app/Service/TimeEntryService.php` / `TimeEntryFilter.php`.
5. The controller returns `app/Http/Resources/V1/TimeEntry/` JSON; TanStack Query caches it; `TimeEntryCalendar` (`resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue`) renders events via `useCalendarEvents.ts` and `useCalendarGrid.ts`.
6. Mutations (create/edit/drag) go through `resources/js/utils/useTimeEntriesMutations.ts`, which calls the same API client and invalidates the query keys.

### Primary Request Path (API client, external)

1. Client sends `Authorization: Bearer <Passport token>` to `/api/v1/...`.
2. Middleware group in `routes/api.php` (auth, organization membership, `check-organization-blocked` on write routes) runs.
3. Controller → Form request → Service → Eloquent model → Resource response.

### Background Work

1. Time entry or project change dispatches `RecalculateSpentTimeForProject` / `RecalculateSpentTimeForTask` (`app/Jobs/`).
2. Scheduler (`app/Console/Kernel.php`) runs commands daily/hourly; they are executed by `php artisan schedule:run` through the queue/worker configured in `config/queue.php`.

**State Management:**
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

Implication for new features: a Microsoft 365 login or Outlook import that is optional or premium should follow the contract pattern (interface-like class in `app/Service/`, default no-op binding, real implementation in an extension) rather than hard-coding into core.

## Key Abstractions

**Contracts (`BillingContract`, `GoalsContract`):**
- Purpose: Decouple core from paid/optional features.
- Examples: `app/Service/BillingContract.php`, `app/Service/GoalsContract.php`.
- Pattern: Container binding in `AppServiceProvider`, overridden by extensions.

**Services:**
- Purpose: Stateless domain operations.
- Examples: `app/Service/TimeEntryService.php`, `app/Service/ReportService.php`, `app/Service/MemberService.php`, `app/Service/OrganizationInvitationService.php`, `app/Service/PermissionStore.php`.
- Pattern: Injected into controllers/resources; permission roles defined in `PermissionStore::roleDefinitions()`.

**DTOs:**
- Purpose: Typed data crossing service boundaries.
- Examples: `app/Service/Dto/`.

**Calendar primitives (frontend):**
- `TimeEntryCalendar.vue`, `CalendarDayColumn.vue`, `FullCalendarEventContent.vue`, `useCalendarEvents.ts`, `useCalendarGrid.ts`, `useCalendarNavigation.ts`, `calendarTypes.ts`, `activityTypes` (imported by `Calendar.vue` from `@/packages/ui/src/FullCalendar/activityTypes`).
- Pattern: Presentational calendar in the UI package; data fetching and mutations in `resources/js/utils`; page composes both.

**Permissions:**
- `PermissionStore` (`app/Service/PermissionStore.php`) defines roles and abilities; frontend mirrors checks in `resources/js/utils/permissions.ts` and `roles.ts`.

## Entry Points

**Web (Inertia):**
- Location: `routes/web.php`
- Triggers: Browser navigation.
- Responsibilities: Auth gating, page rendering.

**API:**
- Location: `routes/api.php` (`/api/v1`)
- Triggers: SPA fetches and external API clients.
- Responsibilities: JSON CRUD and reporting.

**Frontend bootstrap:**
- Location: `resources/js/app.ts`, Vite config `vite.config.js`.

**Console:**
- Location: `artisan`, `app/Console/Kernel.php`, `app/Console/Commands/`.

**Queue worker / scheduler:**
- Triggered by the process manager (`docker/` configs, `docker-compose.yml`) running `queue:work` and `schedule:run`.

**Health:**
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

**What happens:** Feature checks branch on whether a paid/optional capability exists (e.g. `BillingContract` usage in controllers).
**Why it's wrong:** Core then depends on an extension that may not be installed; OSS builds break.
**Do this instead:** Add or extend a contract in `app/Service/` and bind a default in `app/Providers/AppServiceProvider.php`; implement the real behavior in an extension.

### Adding page logic inline in `routes/web.php`

**What happens:** Many pages are closures in `routes/web.php` returning `Inertia::render('X')`.
**Why it's wrong:** Page-level data (props) cannot be injected or tested cleanly, and the file grows.
**Do this instead:** For pages needing server data, use a controller in `app/Http/Controllers/Web/` (as done for `DashboardController`, `OrganizationController`).

### Duplicating time-entry fetch logic in pages

**What happens:** Pages call the API client directly without the shared query composables.
**Why it's wrong:** Cache keys diverge; the calendar and timesheet stop invalidating each other.
**Do this instead:** Reuse `resources/js/utils/useTimeEntriesCalendarQuery.ts`, `useTimeEntriesInfiniteQuery.ts`, `useTimeEntriesMutations.ts`.

## Error Handling

**Strategy:** Exceptions are mapped to JSON for the API via `app/Exceptions/Api/` and `bootstrap/app.php`; web errors use `resources/views/errors/`.

**Patterns:**
- Validation through Form requests (422 JSON).
- Domain errors as dedicated exception classes in `app/Exceptions/Api/`.
- Frontend uses `resources/js/utils/apiValidation.ts` and `feedback.ts` for toasts.

## Cross-Cutting Concerns

**Logging:** Laravel logging (`config/logging.php`); Telescope in dev (`config/telescope.php`, `app/Providers/TelescopeServiceProvider.php`).
**Validation:** Form requests under `app/Http/Requests/V1/`; custom rules in `app/Rules/`.
**Authentication:** Fortify for web (`config/fortify.php`, `app/Providers/FortifyServiceProvider.php`, `app/Actions/Fortify/`, `app/Extensions/Fortify/`); Passport for API (`config/passport.php`, `app/Models/Passport/`); session checks through `app/Http/Middleware/Authenticate.php` and `auth.session`; verified-email via `app/Http/Middleware/EnsureEmailIsVerified.php`.
**Authorization:** Role-based via `app/Service/PermissionStore.php`; organization membership checks in API middleware.
**Auditing:** `owen-it/laravel-auditing` (`config/audit.php`, `app/Models/Audit.php`).

## Relevance to Microsoft 365 Login and Outlook Calendar Import

- **Login:** Fortify is the web auth stack (`config/fortify.php`, `app/Actions/Fortify/`); a Microsoft OAuth/OIDC login would be an additional provider beside Fortify's email/password flow, wired in `routes/web.php` auth routes and `app/Providers/FortifyServiceProvider.php`. Socialite is not currently a dependency (`composer.json`), so it must be added.
- **Outlook import:** Import already exists as a pattern: `app/Http/Controllers/Api/V1/ImportController.php`, `app/Service/Import/` with `Importers/`, and `resources/js/Pages/Import.vue`. An Outlook importer should follow the same importer structure and produce `TimeEntry` records through `TimeEntryService`.
- **Calendar display:** Imported meetings would be rendered in `resources/js/packages/ui/src/FullCalendar/` alongside time entries; the data source would be a new API endpoint or an extension-provided source, with the query composable in `resources/js/utils/`.
- **Optional gating:** If the feature is paid, gate it through `BillingContract` (`app/Service/BillingContract.php`) and `resources/js/utils/billing.ts`.

---

*Architecture analysis: 2026-10-19*
