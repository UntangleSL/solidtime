# Project Research Summary

**Project:** solidtime × Microsoft 365 (Untangle fork)
**Domain:** Microsoft 365 integration: Entra ID single-tenant SSO plus read-only Outlook calendar suggestions (Microsoft Graph) inside an existing Laravel 13 / PHP 8.3 / Inertia + Vue 3 / PostgreSQL time tracker, deployed on Dokploy behind Traefik
**Researched:** 2026-10-19
**Confidence:** MEDIUM overall (HIGH on package versions, Entra/Graph documented behaviour and integration seams; MEDIUM-LOW on Outlook behaviour for cancelled/moved/series-split events, which must be proven in a Phase 0 spike against the real Untangle tenant)

## Executive Summary

This is a brownfield feature, not a new product. Untangle wants its staff to sign in with Microsoft 365 and see their Outlook meetings as "ghost" suggestion blocks in the existing solidtime calendar, so turning a meeting into a time entry takes one click. Experts building this kind of integration (Clockify, Toggl, Harvest, Timely, Tempo) all treat calendar events as a read-only overlay the user copies into real entries. None auto-creates entries or mirrors the calendar, and none documents recurring-series rules or out-of-sync detection. The PROJECT.md scope is already ahead of the market; research's job is to make it safe to build.

Recommended approach: a fork-owned module with thin seams into core. `laravel/socialite` + `socialiteproviders/microsoft` (not `microsoft-azure`, which does not validate the id_token), pinned to the Untangle tenant GUID, with PKCE, state and an explicit `tid` assertion. Graph v1.0 `GET /me/calendarView` via plain Laravel `Http` (not the Graph SDK), with `Prefer: outlook.timezone="UTC"` and `Prefer: IdType="ImmutableId"`. Identity and tokens in a dedicated, non-audited table with `encrypted` casts. Read the calendar from cache on open and sync as a separate call; never let Graph latency or failure block the time-entry calendar. Create time entries through a fork service replicating core creation rules, in a transaction that also writes a unique meeting-to-entry link. Never write to `time_entries` columns, never modify/delete entries automatically.

Main risks: identity/security (email-based linking and pre-registration takeover, guest users, token leakage via audits/logs), data correctness (mutable Graph ids, timezone/DST, treating "absent from window" as "cancelled"), operations (redirect URI scheme behind Traefik, client-secret expiry, Octane state leakage, refresh-token rotation races). Each has a concrete, cheap mitigation if decided before the first migration.

## Key Findings

### Recommended Stack

Two Composer packages; no Graph SDK, no frontend packages.

- `laravel/socialite` ^5.31: OAuth2 code flow, state check, `enablePKCE()`, `Socialite::fake()`.
- `socialiteproviders/manager` ^4.10 + `socialiteproviders/microsoft` ^4.10: Entra v2.0 driver validating id_token (JWKS, `iss` from `tid`, `aud`, `exp`). Reuses locked `firebase/php-jwt` 7.2.0.
- Laravel `Http` (Guzzle, already locked) for Graph GETs and refresh POST; `Http::fake()` / `preventStrayRequests()` in tests.
- Graph v1.0 `calendarView`: server-side recurrence expansion, no RRULE code.
- Eloquent `encrypted` cast on `text` columns for tokens.

**Config requirements:**
- `MICROSOFT_TENANT_ID` = Untangle tenant GUID; never `common`/`organizations`/`consumers`.
- Scopes: `openid profile email offline_access User.Read Calendars.Read`.
- Registration: `dont-discover` for `laravel/socialite`, `SocialiteProviders\Manager\ServiceProvider` in `config/app.php`, small provider calling `extendSocialite('microsoft', ...)`. Smoke test on Laravel 13.

### Expected Features

**Table stakes:**
- Sign in with Microsoft, tenant-restricted, alongside password login; idempotent auto-provision/link under concurrent first logins.
- Connect/disconnect Microsoft; disconnect deletes local tokens; converted entries survive disconnect and user deletion.
- Read-only overlay in week/day views, visually distinct, excluded from totals, reports, running timer, exports.
- Only timed relevant meetings: no all-day, declined, cancelled; keep organizer/accepted/tentative.
- One-click conversion (description from subject, start/end from meeting) through same rules as manual entries.
- Persistent unique link per occurrence; converted meeting stops showing as suggestion.
- Correct timezones/DST.
- Graph failure states never break the calendar (timeout, throttling, reauth).
- Meetings private to owner until converted.
- Sync on open + manual Sync, scoped to visible range, debounced.
- Dismiss a single occurrence, reversibly.

**Differentiators:**
- Assign project/task/tags/description directly from the suggestion.
- Bulk multi-select assign in one call with per-item results.
- Series rules pre-assigning future and current unassigned occurrences; each occurrence confirmed with one click; rules list with edit/delete.
- "Always ignore this series" rule.
- Out-of-sync flag (moved/cancelled), flag-only with explicit user actions.

**Defer (v2+):** "Confirm all pre-assigned this week", last-used-project hint, weekly unassigned summary, overlap hint, skip `showAs=free`; background sync/webhooks/delta; additional calendars, Google/ICS, write-back; keyword rules; manager view; SSO-only mode.

### Architecture Approach

New code in `app/Microsoft365/` (own provider, routes, migrations, config) and `resources/js/m365/`. Core touched only at: `config/app.php` (one line), `Login.vue`, `Calendar.vue`, `TimeEntryCalendar.vue`, `CalendarDayColumn.vue`, `CalendarToolbar.vue` (named slots), `.env.example`. Untouched: `TimeEntryController`, `routes/api.php`, `AppServiceProvider`, `FortifyServiceProvider`, `openapi.json`, `TimeEntry`/`TimeEntryResource`, `useTimeEntriesMutations.ts`.

Fork JSON endpoints under `/m365/api/organizations/{org}/...` on `web` group (`auth:web`), not `/api/v1`, so Scramble output does not churn.

**Major components:**
1. `MicrosoftAuthController`, `MicrosoftIdentityResolver`, `MicrosoftUserProvisioner`: state/PKCE, `tid` check, match `(tid, oid)`, else verified-email link, else provision via `MemberService::addMember(..., asSuperAdmin: true)`.
2. `MicrosoftTokenManager`: sole reader of token columns; refresh ~120 s before expiry under lock; overwrite both tokens; `needs_reauth` on `invalid_grant`/`interaction_required`.
3. `GraphClient`: `calendarView` + `GET /me/events/{id}`, explicit timeouts, retry only 429/503/504 with capped `Retry-After`, sequential `@odata.nextLink`, per-call `Prefer` headers.
4. `MeetingSyncService`, `MeetingEligibility` (pure), `LinkReconciler`: upsert eligible events into minimal cache; point-lookup linked meetings absent from window (404 deleted, 200 moved).
5. `MeetingAssignmentService`: per-item transaction with row lock, copies core creation rules, writes link, dispatches recalculate jobs; parity test vs core endpoint.
6. `SeriesRuleService`: rules on `(user, org, seriesMasterId)`, resolved at read time.
7. Data model: `microsoft_accounts` (identity + encrypted tokens, not Auditable), `m365_meetings` (minimal cache, dismissal flag, no body/attendees), `m365_meeting_links` (unique on meeting and entry, snapshot, `sync_state`), `m365_series_rules`. All FKs cascade. No new columns on upstream tables.

### Critical Pitfalls

1. **Email-based linking (nOAuth, pre-registration takeover).** Key on `(tid, oid)`; email only for one-time first link to a non-placeholder verified account; case-insensitive; never copy `email_verified`; restrict auto-provisioning to allowed domain.
2. **Guests / wrong tenant.** "Assignment required" + Untangle group; reject `#EXT#`/Guest in code; lowest role; org id from env.
3. **Redirect URI behind Traefik.** Explicit https `MICROSOFT_REDIRECT_URI`, Web platform, `APP_URL`, `APP_FORCE_HTTPS=true`, `TRUSTED_PROXIES`; calendar client-secret expiry (≤24 months); surface `invalid_client`.
4. **Refresh races / token leakage.** `text` + `encrypted`, `$hidden`, not Auditable; never log token responses; row lock for refresh; `invalid_grant` → `needs_reauth`; revocation = delete local rows.
5. **Mutable ids / series semantics.** `IdType="ImmutableId"` on every request; never `iCalUId` as series key; rules only when `seriesMasterId` non-null; split series orphan rules → surface in UI.
6. **Out-of-sync false positives.** Snapshot vs fresh Graph data, never entry vs meeting; absence ≠ cancellation; Graph failure = unknown; architecture test forbids time-entry writes from sync.
7. **Timezone/DST.** UTC Prefer; parse with explicit UTC; window in user tz → UTC; Europe/Madrid DST fixtures.
8. **Octane state leakage.** `scoped()` services; resolve Socialite in controller, `forgetDrivers()`; never `stateless()`; two-user-per-worker test.
9. **Duplicates / bulk races.** Entry + link in one transaction; unique constraints; return existing on violation; row lock per meeting.
10. **Throttling / refetch storms.** Separate query key, long `staleTime`, `refetchOnWindowFocus: false`; server cache 30–120 s; never sleep on 429 in web request.

## Implications for Roadmap

### Phase 0: Spike and tenant setup (no product code)
Facts only a real mailbox shows (series ids, cancelled/declined/moved representation, responseStatus, Prefer across nextLink, ReadBasic, Conditional Access) plus admin actions (app registration, redirect URIs, consent, assignment required, secret). Delivers app registration, recorded JSON fixtures, decision doc on series key and out-of-sync branches, secret-expiry runbook.

### Phase 1: Module skeleton and Microsoft sign-in
Provider, config, Socialite wiring, `microsoft_accounts` with encrypted casts, redirect/callback with state+PKCE+`tid`+domain gates, resolver/provisioner, login button, disconnect, user-deletion cleanup, `m365:check` command. Decide consent split here.

### Phase 2: Graph client, sync and cache (backend only)
`GraphClient`, refresh under lock, `m365_meetings`, `MeetingEligibility`, windowed reconcile with point lookups, `m365:sync {user}`, `GET /m365/api/organizations/{org}/calendar`, typed `reauth_required`/`throttled`/`error`, no-op `LinkReconciler`.

### Phase 3: Calendar ghosts, sync UX and dismiss
Named slots in core calendar components, ghost layer (dashed, translucent, `@pointerdown.stop`, non-editable, excluded from totals), own query key, sync on open + debounced button, reauth banner, dismiss + show-dismissed toggle.

### Phase 4: Assignment to time entries (single and bulk)
`m365_meeting_links` with unique constraints, `MeetingAssignmentService` (transaction, row lock, core rules incl. billable, client, overlap, locked periods, recalc jobs), selection store/bar, assign dialog reusing core pickers, per-item results, parity test.

### Phase 5: Recurring series rules
`m365_series_rules`, read-time resolution, "always assign this series", one-click confirm of pre-assigned, rules dialog, "always ignore this series", orphaned-rule indicator.

### Phase 6: Out-of-sync detection and resolution (parallel with 5)
Real `LinkReconciler` (snapshot vs snapshot: start, end, cancelled, declined, removed), marker, acknowledge, explicit "update entry" via core rules, delete via core path, architecture test.

### Phase 7: Hardening and release
Throttling/error UX, cache prune, token redaction review, outbound logging without tokens/subjects, DeletionService tests, impersonation guard, Octane two-user test, Dokploy env docs + secret runbook, Playwright happy path, upstream-merge rehearsal, PHPStan.

### Phase Ordering Rationale
Identity/tokens → Graph/cache → read-only UI → writes → link-dependent features. Phase 0 first because series identity, cancellation and id stability change schema. Phases 5 and 6 independent after 4. Fork isolation in every phase.

### Research Flags
Needs research: Phase 0 (spike), 1 (Socialite+Octane, L13 registration, consent split), 2 (response shapes, Retry-After, ImmutableId on calendarView, attendee cancellations), 3 (pointer handling in `useSlotSelection.ts`/`useEventDrag.ts`), 5 (series identity), 6 (cancelled/declined representation). Standard: 4, 7.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Packagist versions; driver source; Microsoft Learn. Octane and L13 registration MEDIUM. |
| Features | MEDIUM | Competitor docs HIGH where documented; rules/out-of-sync undocumented (LOW-MEDIUM). |
| Architecture | HIGH seams / MEDIUM series | Seams verified in repo code. |
| Pitfalls | MEDIUM-HIGH | Codebase items HIGH; Entra/Graph MEDIUM, several VERIFY. |

**Overall:** MEDIUM. Approach well founded; uncertainty concentrated in Outlook series/cancellation/move representation, resolved by Phase 0.

### Conflicts Between Research Files (resolved)
- Socialite driver: **`socialiteproviders/microsoft`**.
- Token table: **`microsoft_accounts`**.
- Module location: **`app/Microsoft365/`**.
- Provider registration: **`config/app.php`**.
- Refresh lock: **row lock in transaction** (cache lock additional).
- Persist events: **minimal pruned cache** (no body/attendees).
- Series key: **`seriesMasterId`**, `iCalUId` fallback only; occurrence identity on immutable event id with `originalStart` + `seriesMasterId`. Confirm in Phase 0.
- Graph concurrency: **sequential**; `$batch` only if needed.
- Scope: **keep `Calendars.Read`** per PROJECT.md.

### Gaps to Address
- Series identity in practice — Phase 0.
- Cancelled/declined/moved in `calendarView` — Phase 0 fixtures.
- ImmutableId stability and survival across nextLink — Phase 0/2.
- Timezone response shape, combined Prefer — one real response.
- Conditional Access on refresh — admin check Phase 0; `needs_reauth` path regardless.
- Consent split — decide Phase 1 (recommend at login with admin consent pre-granted).
- Email-based first link — follow PITFALLS (verified or proven control).
- Octane + Socialite caching — two-login test Phase 1.
- SocialiteProviders on Laravel 13 — smoke test Phase 1.
- Client-secret lifecycle — runbook + 30-day reminder.
- Retry-After on Outlook 429 — fallback exponential backoff.

## Sources

### Primary (HIGH)
- Packagist (2026-10-19): `laravel/socialite` 5.31.0, `socialiteproviders/manager` 4.10.0, `socialiteproviders/microsoft` 4.10.0, `socialiteproviders/microsoft-azure` 5.2.1, `microsoft/microsoft-graph` 3.8.0, `guzzlehttp/guzzle` 8.3.0.
- Laravel Socialite docs/source; SocialiteProviders Microsoft/Azure provider source.
- Microsoft Learn: calendarView, event delta, event resource, immutable ids, refresh tokens, claims validation, Outlook throttling.
- Codebase files (see ARCHITECTURE.md / PITFALLS.md).

### Secondary (MEDIUM)
- Competitor help pages (Clockify, Toggl, Harvest, Timely, Everhour, Tempo); SocialiteProviders usage docs; PnP series-master write-up; nOAuth research; Graph calendar guides.

### Tertiary (LOW, validate)
- Windows vs IANA names in `Prefer: outlook.timezone`; cancelled-meeting visibility and `Retry-After` on 429; Octane + Socialite driver caching.

---
*Research completed: 2026-10-19*
*Ready for roadmap: yes*
