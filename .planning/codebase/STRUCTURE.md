---
last_mapped_commit: b46f015754a19493418a3129dcfcf8890587c6a8
last_mapped_at: 2026-10-19
---
# Codebase Structure

**Analysis Date:** 2026-10-19

## Directory Layout

```
solidtime/
├── app/                     # Laravel application code (PSR-4 "App\")
│   ├── Actions/Fortify/     # Fortify user/team actions
│   ├── Console/             # Kernel (scheduler) + Artisan commands
│   ├── Enums/               # PHP enums
│   ├── Events/              # Domain events
│   ├── Exceptions/Api/      # API exception classes
│   ├── Extensions/          # Core hooks: Auditing resolvers, Fortify, Scramble
│   ├── Filament/            # Admin panel resources, pages, widgets
│   ├── Http/                # Controllers, Middleware, Requests, Resources
│   ├── Jobs/                # Queued jobs (spent-time recalculation)
│   ├── Mail/                # Mailables
│   ├── Models/              # Eloquent models (+ Concerns/, Passport/)
│   ├── Providers/           # Service providers (App, Auth, Event, Route, Fortify, Telescope, Filament/)
│   ├── Rules/               # Custom validation rules
│   ├── Service/             # Domain services, contracts, DTOs, import/export
│   └── Support/             # Helpers
├── bootstrap/               # App bootstrap, cache
├── config/                  # Laravel config (app, queue, scheduling, passport, fortify, ...)
├── database/
│   ├── factories/           # Model factories (+ Passport/)
│   ├── migrations/          # Schema migrations
│   ├── schema/              # Schema dumps
│   └── seeders/             # Database seeders
├── docker/                  # Local and production container definitions (local/, prod/)
├── docs/                    # Project documentation
├── e2e/                     # Playwright E2E helpers (e2e/utils)
├── extensions/              # Optional extension modules (see manifest.json)
├── lang/en/                 # Translation strings
├── playwright/              # Playwright setup/auth fixtures
├── public/                  # Web root assets (fonts, images, favicons, desktop-version)
├── resources/
│   ├── css/                 # Tailwind entry styles
│   ├── js/                  # Vue + TypeScript frontend (see below)
│   └── views/               # Blade shells (app.blade.php), auth, emails, errors, filament, reports, vendor
├── routes/                  # web.php, api.php (+ console/broadcast entries as configured)
├── storage/                 # Runtime storage (logs, cache, uploads)
├── tests/                   # PHPUnit/Pest tests (Feature, Unit)
├── artisan                  # CLI entry point
├── composer.json            # PHP dependencies and autoload (includes extensions/extensions_autoload.php)
├── package.json             # Frontend dependencies and npm workspaces
├── vite.config.js           # Vite + laravel-vite-plugin + Vue
├── tailwind.config.js       # Tailwind config
├── vitest.config.ts         # Frontend unit test config
├── playwright.config.ts     # E2E config
└── openapi.json             # Generated OpenAPI spec (Scramble)
```

**Frontend tree (`resources/js/`):**

```
resources/js/
├── app.ts                   # Inertia bootstrap, page resolver (incl. extension "Module::Page")
├── bootstrap.js             # Axios / globals
├── Components/              # App-level components
│   ├── Billing/             # Billing UI
│   ├── CommandPalette/      # Command palette
│   ├── Common/              # Shared small components
│   ├── Dashboard/           # Dashboard widgets
│   ├── Timesheet/           # Timesheet grid parts
│   ├── ui/                  # Local UI primitives copy
│   └── TimeTracker.vue, CurrentSidebarTimer.vue, ...
├── Layouts/AppLayout.vue    # Authenticated layout
├── Pages/                   # Inertia pages (one file per route)
│   ├── Auth/  Profile/  Teams/
│   └── Calendar.vue, Time.vue, Timesheet.vue, Dashboard.vue, Projects.vue, ProjectShow.vue,
│       Clients.vue, Members.vue, Goals.vue, Reporting.vue, ReportingDetailed.vue,
│       ReportingShared.vue, SharedReport.vue, Tags.vue, Import.vue, Welcome.vue, ...
├── lib/                     # Library helpers
├── packages/
│   ├── api/                 # @solidtime/api workspace: generated client (src/index.ts, src/openapi.json.client.ts)
│   └── ui/                  # @solidtime/ui workspace: component library (src/...)
├── types/                   # Shared TS types (e.g. types/models)
├── utils/                   # Queries (use*Query.ts), stores (use*.ts), helpers (billing, permissions, money, format)
├── test-setup.ts            # Vitest setup
├── ziggy.d.ts / ziggy.js    # Ziggy route typings and generated route table
```

**UI package (`resources/js/packages/ui/src/`):**

```
packages/ui/src/
├── FullCalendar/            # Time-entry calendar (TimeEntryCalendar.vue, CalendarDayColumn.vue,
│                            #   FullCalendarEventContent.vue, FullCalendarDayHeader.vue, CalendarToolbar.vue,
│                            #   CalendarSettingsPopover.vue, calendarSettings.ts, calendarTypes.ts,
│                            #   useCalendarEvents.ts, useCalendarGrid.ts, useCalendarNavigation.ts)
├── calendar/                # Generic calendar grid primitives (Calendar.vue, CalendarGrid*.vue, CalendarCell*.vue)
├── range-calendar/          # Range calendar primitives
├── TimeEntry/               # Time entry row/form components
├── TimeTracker/             # Timer UI
├── Project/  Client/  Tag/  # Entity components
├── Buttons/  Input/  Icons/ # Base controls
├── dialog/ dropdown-menu/ popover/ select/ tabs/ tooltip/ ...   # Headless/shadcn-style primitives
└── index.ts                 # Barrel export (imported as '@/packages/ui/src' or '@solidtime/ui')
```

**Extensions (`extensions/`):**

```
extensions/
├── .gitkeep
├── extensions_autoload.php  # Requires each <Name>/vendor/autoload.php if present
└── manifest.json            # Pins Billing, Services, Invoicing, Auditing repos + refs
```

Extension directories (`extensions/Billing/`, etc.) are not in the repo; they are checked out per manifest at build time, each with `resources/js/Pages/` and `vendor/`.

## Directory Purposes

**`app/Service/`:**
- Purpose: Domain logic shared by controllers, Filament, console commands, and jobs.
- Contains: `TimeEntryService.php`, `TimeEntryAggregationService.php`, `TimeEntryFilter.php`, `ReportService.php`, `DashboardService.php`, `MemberService.php`, `InvitationService.php`, `OrganizationService.php`, `PermissionStore.php`, `BillingContract.php`, `GoalsContract.php`, `IntervalService.php`, `TimezoneService.php`, `CurrencyService.php`, `ColorService.php`.
- Subfolders: `Dto/`, `Export/`, `Import/` (with `Importers/`), `ReportExport/`, `IpLookup/`.

**`app/Http/Controllers/Api/V1/`:**
- Purpose: One controller per REST resource.
- Key files: `TimeEntryController.php`, `UserTimeEntryController.php`, `ProjectController.php`, `ReportController.php`, `ImportController.php`, `ExportController.php`.
- Public: `Public/ReportController.php` for unauthenticated shared reports.

**`app/Http/Requests/V1/` and `app/Http/Resources/V1/`:**
- Purpose: Input validation and output shaping, mirrored per resource folder (`TimeEntry/`, `Project/`, `Organization/`, `Member/`, `Report/`, `Import/`, ...).

**`app/Models/`:**
- Purpose: Eloquent models; one per table. Key: `TimeEntry.php`, `Project.php`, `Organization.php`, `Member.php`, `User.php`, `Client.php`, `Task.php`, `Tag.php`, `Goal.php`, `Report.php`, `ProjectMember.php`, `OrganizationInvitation.php`, `Audit.php`, `FailedJob.php`.

**`app/Filament/`:**
- Purpose: Admin panel. `Resources/` has 27 resource folders (e.g. `TimeEntryResource/`, `OrganizationResource/`, `UserResource/`, `ProjectResource/`, `FailedJobResource/`); panel provider in `app/Providers/Filament/`.

**`app/Extensions/`:**
- Purpose: Core-side integration points for extensions: `Auditing/Resolvers/`, `Fortify/`, `Scramble/`.

**`app/Jobs/`:**
- Purpose: Queued work. `RecalculateSpentTimeForProject.php`, `RecalculateSpentTimeForTask.php`; `Test/` for queue tests.

**`app/Console/`:**
- Purpose: `Kernel.php` (schedule) and `Commands/` grouped as `Admin/`, `Auth/`, `Correction/`, `Report/`, `SelfHost/`, `Test/`, `TimeEntry/`.

**`resources/js/Pages/`:**
- Purpose: Inertia page components. Name must match the string passed to `Inertia::render` in `routes/web.php`.

**`resources/js/utils/`:**
- Purpose: Data and state layer for the SPA: `use<Entity>Query.ts` (TanStack Query hooks), `use<Entity>.ts` (Pinia/store helpers), `useTimeEntries*.ts` (time entry queries/mutations), `prefetch.ts`, `billing.ts`, `permissions.ts`, `roles.ts`, `money.ts`, `format.ts`, `timeEntryGrouping.ts`, `timesheet/`. Tests sit beside sources as `*.test.ts`.

**`database/`:**
- `migrations/` for schema changes, `schema/` for dumps, `factories/` used by tests (`factories/Passport/`), `seeders/` for dev data.

**`tests/`:**
- PHPUnit tests (`phpunit.xml`); frontend unit tests are colocated in `resources/js/**` (`*.test.ts`) and run with `vitest.config.ts`; E2E in `e2e/` and `playwright/` driven by `playwright.config.ts`.

**`docker/`:**
- `local/8.3`, `local/minio`, `local/pgsql` for dev services; `prod/deployment/octane/FrankenPHP` for production image.

**`lang/en/`:**
- Translation keys used by Laravel and Vue (via the Inertia shared locale, see `app/Http/Middleware/HandleInertiaRequests.php`).

## Key File Locations

**Entry Points:**
- `routes/web.php`: Inertia page routes (`/calendar`, `/time`, `/timesheet`, `/reporting`, `/projects/{project}`, ...).
- `routes/api.php`: `/api/v1` REST routes.
- `resources/js/app.ts`: SPA bootstrap and page resolver.
- `artisan`: CLI entry point.
- `vite.config.js`: frontend build entry.

**Configuration:**
- `config/queue.php`, `config/scheduling.php`, `config/passport.php`, `config/fortify.php`, `config/audit.php`, `config/inertia.php`, `config/scramble.php`, `config/octane.php`, `config/filament.php`, `config/import.php`, `config/modules.php`.
- `extensions/manifest.json`: extension pins.
- `.env.example`: documented env vars (do not commit real `.env`).
- `tsconfig.json`, `jsconfig.json`: path alias `@/` → `resources/js/`.
- `eslint.config.mjs`, `.prettierrc.json`, `pint.json`, `phpstan.neon`, `.editorconfig`.

**Core Logic:**
- `app/Service/TimeEntryService.php`: time entry rules and rounding.
- `app/Service/TimeEntryAggregationService.php`: totals for reports/charts.
- `app/Models/TimeEntry.php`: time entry model with computed attributes and scopes.
- `app/Http/Controllers/Api/V1/TimeEntryController.php`: time entry API.

**Calendar (frontend):**
- `resources/js/Pages/Calendar.vue`: calendar page; reads `?date=` deep link, fetches with `useTimeEntriesCalendarQuery`, mutates with `useTimeEntriesMutations`.
- `resources/js/utils/useTimeEntriesCalendarQuery.ts`: expanded date-range query; week start from `getWeekStartSetting()`.
- `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue`: the calendar component.
- `resources/js/packages/ui/src/FullCalendar/useCalendarEvents.ts`: maps time entries and activity periods to calendar events.
- `resources/js/packages/ui/src/FullCalendar/calendarSettings.ts`: user display settings.
- `resources/js/packages/ui/src/FullCalendar/activityTypes.ts`: `ActivityPeriod` type (imported by `Calendar.vue`).
- `resources/js/packages/ui/src/FullCalendar/calendarTypes.ts`: calendar event types.

**Frontend API client:**
- `resources/js/packages/api/src/index.ts`: exports `api` and types.
- `resources/js/packages/api/src/openapi.json.client.ts`: generated; do not hand-edit (regenerate with `npm run zod:generate`).

**Testing:**
- `phpunit.xml`, `tests/`: backend tests.
- `vitest.config.ts`, `resources/js/**/*.test.ts`: frontend unit tests (e.g. `useCurrentTimeEntry.test.ts`, `useTimesheetGrid.test.ts`).
- `playwright.config.ts`, `e2e/`, `playwright/`: E2E.

## Naming Conventions

**PHP files:**
- Classes are PascalCase and suffixed by role: `*Controller.php`, `*Service.php`, `*Request.php`, `*Resource.php`, `*Contract.php`, `*Job` (class name without suffix, e.g. `RecalculateSpentTimeForProject`), `*Command` in Console, `*Resource` in Filament (`TimeEntryResource`).
- Models are singular (`TimeEntry.php`); tables are plural snake_case.
- Events are verb-phrase or state names (`MemberAdded`, `BeforeOrganizationDeletion`).

**Routes:**
- API route names: `v1.<resource>.<action>` (e.g. `v1.organizations.show`); paths are kebab-case (`/time-entries`, `/invite-placeholder`).
- Web route names are kebab-case or dotted (`reporting.detailed`, `organization-invitations.accept`).

**Vue / TypeScript:**
- Pages and components: PascalCase `.vue` (`Calendar.vue`, `TimeEntryCalendar.vue`).
- Composables and queries: camelCase with `use` prefix (`useTimeEntriesCalendarQuery.ts`, `useCalendarGrid.ts`).
- Pure helpers: camelCase (`calendarSettings.ts`, `format.ts`).
- Tests: `<name>.test.ts` next to the source.

**Directories:**
- PHP: PascalCase namespaces under `app/`.
- Frontend: `Pages/`, `Components/`, `Layouts/` in PascalCase; `utils/`, `lib/`, `types/` lowercase; UI package folders are lowercase or PascalCase by component family.

## Where to Add New Code

**New API endpoint for an existing resource:**
- Route: `routes/api.php` (inside the `v1` group and the resource's org-scoped prefix group).
- Controller: `app/Http/Controllers/Api/V1/<Resource>Controller.php`.
- Request: `app/Http/Requests/V1/<Resource>/<Action>Request.php`.
- Resource: `app/Http/Resources/V1/<Resource>/<Name>Resource.php`.
- Logic: `app/Service/<Resource>Service.php` (or extend an existing service).
- Tests: `tests/Feature/...` and regenerate `openapi.json` / `resources/js/packages/api/src/openapi.json.client.ts`.

**New Inertia page:**
- Route: add `Route::get('/<path>', ...)->name('<name>')` inside the authenticated group in `routes/web.php` (use a controller if it needs server props).
- Component: `resources/js/Pages/<PageName>.vue`, using `AppLayout` from `resources/js/Layouts/AppLayout.vue`.
- Data: a composable in `resources/js/utils/use<Entity>Query.ts`.

**New calendar behavior (e.g. external meeting events):**
- Event mapping: `resources/js/packages/ui/src/FullCalendar/useCalendarEvents.ts` (add a new source alongside time entries and activity periods).
- Rendering: `resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.vue`, `CalendarDayColumn.vue`.
- Types: `resources/js/packages/ui/src/FullCalendar/calendarTypes.ts`, `activityTypes.ts`.
- Data fetching: a new query in `resources/js/utils/` mirroring `useTimeEntriesCalendarQuery.ts`.
- Page composition: `resources/js/Pages/Calendar.vue`.

**Microsoft 365 login (planned):**
- Auth flow: `app/Actions/Fortify/` and `app/Providers/FortifyServiceProvider.php` for web login; OAuth callback route in `routes/web.php`; config in `config/services.php` (add a `microsoft` block) and `config/fortify.php`.
- Frontend login UI: `resources/js/Pages/Auth/`.
- New dependency: none present (Socialite absent in `composer.json`); add `laravel/socialite` with the Microsoft provider when implementing.

**Outlook meeting import (planned):**
- Importer: `app/Service/Import/Importers/` (new `Outlook*Importer.php`, following existing importers), wired through `app/Http/Controllers/Api/V1/ImportController.php` and `config/import.php`.
- Sync scheduling: `app/Console/Kernel.php` for a recurring command, `app/Console/Commands/`; async work in `app/Jobs/`.
- Premium gating: `app/Service/BillingContract.php` and `resources/js/utils/billing.ts`.
- If the feature is delivered as an extension: place it under `extensions/<Module>/` with `vendor/autoload.php` and pages under `extensions/<Module>/resources/js/Pages/` (rendered as `Module::Page`).

**New Filament admin resource:**
- `app/Filament/Resources/<Name>Resource.php` with `<Name>Resource/Pages/`.

**New shared Vue component:**
- Generic UI: `resources/js/packages/ui/src/<Family>/`, exported from `resources/js/packages/ui/src/index.ts`.
- App-specific: `resources/js/Components/<Family>/`.

**New domain model:**
- Model: `app/Models/<Name>.php`; migration `database/migrations/`; factory `database/factories/<Name>Factory.php`; audit via `app/Models/Concerns/` trait.

**Utilities:**
- Backend shared helpers: `app/Support/`.
- Frontend shared helpers: `resources/js/utils/`.

## Special Directories

**`extensions/`:**
- Purpose: Mount point for optional extension packages.
- Generated: No (checked out from `extensions/manifest.json`).
- Committed: Only `.gitkeep`, `extensions_autoload.php`, `manifest.json`.

**`resources/js/packages/api/src/openapi.json.client.ts`:**
- Purpose: Generated TypeScript client.
- Generated: Yes (`npm run zod:generate`).
- Committed: Yes.

**`openapi.json`:**
- Purpose: API spec from Scramble.
- Generated: Yes.
- Committed: Yes.

**`public/build/` (Vite output, if present):**
- Generated: Yes (`npm run build`).
- Committed: No.

**`storage/`, `bootstrap/cache/`:**
- Runtime caches and logs.
- Generated: Yes.
- Committed: No (ignored via `.gitignore`).

**`node_modules/`, `vendor/`:**
- Dependencies.
- Generated: Yes.
- Committed: No.

**`.planning/`:**
- GSD planning artifacts, including this `codebase/` map.

---

*Structure analysis: 2026-10-19*
