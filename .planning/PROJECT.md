# solidtime × Microsoft 365 (Untangle fork)

## What This Is

Untangle's fork of solidtime (open-source time tracker: Laravel 13 + Inertia/Vue 3 + PostgreSQL), extended so the Untangle team can sign in with their Microsoft 365 accounts and see their Outlook meetings directly in solidtime's calendar view. From the calendar, users turn meetings into time entries by assigning them to projects, and can set rules so a recurring meeting series is pre-assigned to a project going forward.

## Core Value

A user opens the solidtime calendar and their Outlook meetings are already there, so logging meeting time to the right project takes one click instead of re-typing it from Outlook.

## Requirements

### Validated

<!-- Inferred from the existing solidtime codebase (.planning/codebase/). -->

- ✓ Email/password login with Fortify: registration modes (on/off/invite-only), email verification, password reset, TOTP 2FA — existing
- ✓ Organization multi-tenancy: `Organization` / `Member` / `User`, invitations, roles — existing
- ✓ Time entries with project/task/client/tags, billable rates, rounding — existing
- ✓ Projects, clients, tasks, tags management — existing
- ✓ Calendar view (`/calendar`, `TimeEntryCalendar.vue`) showing time entries for week/day, with create/edit/drag — existing
- ✓ Versioned REST API (`/api/v1`) with Passport OAuth2 and personal access tokens — existing
- ✓ Reporting, exports, imports (Clockify/Harvest/Toggl/CSV), Filament admin panel — existing
- ✓ Self-hostable Docker image (FrankenPHP/Octane) — existing

### Active

- [ ] Users can sign in with "Sign in with Microsoft" (Entra ID, Untangle tenant only) alongside existing email/password login
- [ ] First Microsoft sign-in auto-provisions the solidtime user and joins them to the Untangle organization; existing users with the same email are linked, not duplicated
- [ ] Users' Outlook meetings are fetched from Microsoft Graph when the calendar is opened, and via a manual "Sync" button
- [ ] Only relevant meetings are imported: organized by the user, or accepted/tentative; excluded: declined, cancelled, all-day events
- [ ] Meetings render in the calendar view as "ghost"/suggestion blocks that do NOT count as tracked time
- [ ] User can select a meeting suggestion and assign it to a project (optionally task/tags/description) → creates a real time entry linked to that meeting
- [ ] User can select multiple meeting suggestions and assign them to a project in one action
- [ ] User can dismiss/ignore a meeting suggestion so it stops appearing
- [ ] For a recurring meeting, user can create a rule "this series → project X" that pre-assigns all future (and current unassigned) occurrences; each occurrence still needs a one-click confirmation to become a time entry
- [ ] User can view, edit and delete their recurring-meeting rules
- [ ] If a meeting already converted to a time entry changes time or is cancelled in Outlook, the time entry is flagged as "out of sync" — never modified or deleted automatically
- [ ] Microsoft tokens stored encrypted, hidden from serialization/audits, revoked on user deletion; user can disconnect their Microsoft account

### Out of Scope

- Multi-tenant M365 (each customer org connecting its own tenant) — only Untangle's tenant is needed; keep config single-tenant
- Real-time sync via Graph webhooks / background periodic sync — chosen "sync on open + manual button" for simplicity; no public webhook endpoint or subscription renewal
- Writing back to Outlook (creating/editing events from solidtime) — read-only integration
- Auto-creating time entries without user confirmation (both for single meetings and recurring rules) — user wants to confirm each occurrence
- Automatically adjusting or deleting time entries when Outlook changes — never lose logged hours; flag instead
- Disabling email/password login — both login methods coexist
- Google Calendar / CalDAV / ICS — only Microsoft 365 needed
- Upstreaming to solidtime-io — fork-only feature; but keep it isolated to ease upstream merges

## Context

- Brownfield: codebase mapped in `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS).
- No SSO/OIDC/Socialite/Microsoft Graph code exists today. Integration points: `config/services.php`, `app/Providers/FortifyServiceProvider.php`, `app/Models/User.php`, `app/Service/UserService.php`, `app/Service/InvitationService.php`, `app/Service/DeletionService.php`.
- Calendar UI: `resources/js/Pages/Calendar.vue` + `resources/js/packages/ui/src/FullCalendar/*` (`TimeEntryCalendar.vue`, `useCalendarEvents.ts`); data via TanStack Query (`useTimeEntriesCalendarQuery.ts`) against `GET /api/v1/organizations/{org}/time-entries`.
- Time entries are organization-scoped (`organization_id`, `member_id`, `user_id`); creation goes through `TimeEntryService` / `TimeEntryController`.
- No model uses encrypted casts yet; auditing (`owen-it/laravel-auditing`) may record attribute changes — token columns must be excluded.
- Default queue is `sync`; since sync is on-demand (calendar open / button), no dedicated queue worker is strictly required, but Graph calls must have timeouts and not block the page unduly.
- Fork mergeability: keep fork code in new files/modules, avoid editing hot spots (`TimeEntryController.php`, `routes/api.php`, `AppServiceProvider.php`) in place where possible; regenerate `openapi.json` and lockfiles rather than hand-merge.
- Tracking: the user (Untangle) acts as product owner; Claude acts as project overview/control.

## Constraints

- **Tech stack**: Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15 — follow existing conventions in `.planning/codebase/CONVENTIONS.md`
- **Identity provider**: Microsoft Entra ID, single tenant (Untangle; domains untanglegrowth.com primary + untangle.es) — one app registration; tenant ID, client ID, secret via env (Doppler `vps`, `SOLIDTIME_*`)
- **Graph scopes**: minimal — `openid profile email offline_access User.Read Calendars.Read` — least privilege
- **Security**: refresh tokens encrypted at rest (`encrypted` cast), `$hidden`, excluded from audits/logs, state + PKCE validated, deleted with the user
- **Deployment**: Docker image on Untangle's own Dokploy server — redirect URI must match the Dokploy public URL over HTTPS
- **Mergeability**: changes isolated so upstream solidtime updates can still be merged
- **Data safety**: Outlook changes never modify or delete existing time entries automatically

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single-tenant M365 (Untangle only) | Only internal use; avoids multi-tenant app consent complexity | — Pending |
| Keep email/password + add Microsoft login, auto-provision on first login | No disruption for existing users; frictionless onboarding for team | — Pending |
| Meetings shown as suggestions, not time entries, until assigned | Avoids polluting tracked hours with meetings not worked/irrelevant | — Pending |
| Recurring rules pre-assign project; user confirms each occurrence | User wants control over each logged occurrence | — Pending |
| Import only organized/accepted/tentative, non-all-day, non-cancelled meetings | Reduce noise | — Pending |
| Outlook changes flag time entries as out-of-sync, never auto-modify | Never lose or silently change logged hours | — Pending |
| Sync on calendar open + manual button (no webhooks/background job) | Simplest; no public webhook endpoint or worker needed | — Pending |
| Deploy on own Dokploy | Existing Untangle infra | — Pending |
| Work on branch `feature/m365-integration` | Keep `main` aligned with upstream | — Pending |
| Private/confidential Outlook meetings are not shown at all | Avoid leaking private titles into shared timesheets | — Pending |
| Personal blocks without attendees are shown as suggestions | Focus blocks are often real work; can be ignored/ruled | — Pending |
| Out-of-sync actions: keep / adjust to Outlook / delete (user-triggered) | Explicit control, never automatic | — Pending |
| "Always ignore this series" rule in v1 | Same rules table, avoids weekly dismissals | — Pending |
| Auto-provisioned users get lowest (employee) role; Entra MFA replaces solidtime 2FA for Microsoft sign-ins | Least privilege; MFA enforced by Entra | — Pending |
| Tenant-wide Microsoft sign-in (no Entra "assignment required"); guests rejected in code; allowed domains `untanglegrowth.com` (primary) + `untangle.es` | Business Standard has no Entra P1 (no group assignment); owner prefers convenience over per-person assignment | — Pending |
| F1 (freelance) users can sign in with Microsoft but get no meeting suggestions (no Exchange mailbox) | F1 licence has no mailbox | — Pending |
| Secrets in Doppler project `vps` (configs `dev`/`prd`), keys prefixed `SOLIDTIME_` | One vault for all VPS apps | — Pending |
| Identity matched on Entra `tid`+`oid`, email only for one-time verified link | Prevent account takeover (nOAuth) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-19 after initialization*
