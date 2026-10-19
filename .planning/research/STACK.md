# Stack Research

**Domain:** Microsoft 365 integration (Entra ID single-tenant SSO + read-only Outlook calendar via Microsoft Graph) in an existing Laravel 13 / PHP 8.3 / Inertia-Vue app (solidtime fork)
**Researched:** 2026-10-19
**Confidence:** HIGH on package choices and versions (read directly from Packagist metadata, upstream source, Microsoft Learn); MEDIUM on Octane and a few Graph behaviours flagged inline.

Scope: only the NEW stack for this milestone. Existing stack (Laravel 13.33, Fortify, Passport, Octane/FrankenPHP, Guzzle 8.2, firebase/php-jwt 7.2, PostgreSQL 15, owen-it auditing) is in `.planning/codebase/STACK.md` and is not re-researched.

Confidence note: the `classify-confidence` seam tiers the `webfetch`/`websearch` providers as LOW regardless of content. The HIGH/MEDIUM tags below are my own assessment based on primary sources (Packagist JSON API, upstream GitHub source, learn.microsoft.com) cross-checked against each other. Anything resting on training knowledge alone is tagged LOW and listed under "Verify in phase".

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `laravel/socialite` | `^5.31` (v5.31.0, 2026-08-31) | OAuth2 authorization-code flow: redirect, state check, code exchange, `refreshToken()` | First-party. Supports Laravel 13 (`illuminate/contracts ^13`). Has built-in `enablePKCE()` (S256, verifier kept in session, single-use), `hash_equals` state check, and `Socialite::fake()` for tests. |
| `socialiteproviders/manager` | `^4.10` (4.10.0, 2026-08-16) | Lets community drivers plug into Socialite | Required by every SocialiteProviders driver. 4.10.0 requires PHP `^8.3`, `illuminate/support ^12 or ^13`, `laravel/socialite ^5.29`. Fits this project. |
| `socialiteproviders/microsoft` | `^4.10` (4.10.0, 2026-07-21) | Entra ID / Microsoft identity platform v2.0 driver | Uses v2.0 endpoints with a configurable tenant. Validates the `id_token` (JWKS signature, `iss` resolved from `tid`, `aud`, `exp`) with `firebase/php-jwt`. Default scopes `openid profile User.Read`. Already-locked `firebase/php-jwt` 7.2.0 satisfies its `^7.0` requirement, so no new transitive conflict. |
| Laravel `Http` client (built in) | Laravel 13.33 / Guzzle 8.2 (both already locked) | Graph calls: `GET /me/calendarView`, `GET /me/events/{id}`, and the refresh-token POST | Only 2 or 3 endpoints are needed. No new dependency, trivially testable with `Http::fake()` and `Http::preventStrayRequests()`, explicit timeouts and retry, no second token abstraction competing with Socialite. |
| Microsoft Graph v1.0 REST | `https://graph.microsoft.com/v1.0` | Calendar data source | Use v1.0, never `/beta`. `calendarView` is GA and supports everything required (occurrences, `seriesMasterId`, `responseStatus`, `isOrganizer`, `isCancelled`, `isAllDay`). |

### Supporting Libraries / Framework Features

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Eloquent `encrypted` cast | Laravel 13 built-in | Encrypt access/refresh tokens at rest (AES-256-CBC with `APP_KEY`) | On a new `microsoft_connections` table, columns typed `text`. MS access tokens are JWTs of 1.5 KB or more, which do not fit `varchar(255)` once encrypted. |
| `Prefer: IdType="ImmutableId"` header | Graph feature | Event ids that survive moves between folders and calendars | Send on every Graph request that returns events. The format must never change after you store ids. Without it, the id of an event can change when the item is moved. |
| DB row lock (`lockForUpdate()` in a transaction) | PostgreSQL / Eloquent | Serialise token refresh per user | Wrap "read connection, refresh if near expiry, write new tokens" in one transaction. Do not depend on the `file` cache driver for locking. |
| `Socialite::forgetDrivers()` | Socialite 5.x | Drop cached driver instances (the manager is a singleton that injects the request when building a driver) | Defensive call at the top of the Microsoft redirect and callback actions under Octane (see "Verify in Phase": Octane item). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `Socialite::fake('microsoft', User::fake([...]))` | Test redirect and callback without hitting Entra | Documented in the Laravel 13 Socialite docs. `User::fake` accepts `token`, `refreshToken`, `expiresIn`, `approvedScopes`. |
| `Http::fake()` + `Http::preventStrayRequests()` | Test Graph client, refresh, 401 retry, 429 backoff | Fake `graph.microsoft.com/*` and `login.microsoftonline.com/*`. Use `Http::fakeSequence()` for 429 then 200 and 401 then refresh then 200. |
| Entra admin center, single app registration | Platform: "Web" redirect URI, single tenant (`AzureADMyOrg`), client secret | Delegated permissions only: `openid profile email offline_access User.Read Calendars.Read` (none requires admin consent per the Microsoft permissions reference for `Calendars.Read`). Enable "Assignment required" on the enterprise app if only some Untangle staff should sign in. |

## Concrete Decisions

### 1. Socialite provider: `socialiteproviders/microsoft`, not `microsoft-azure`

| Aspect | `microsoft` 4.10.0 (choose) | `microsoft-azure` 5.2.1 |
|--------|------------------------------|--------------------------|
| Endpoints | v2.0 authorize/token, tenant from config | v2.0 authorize/token, tenant from config |
| `id_token` validation | Yes: signature (JWKS, cached 300 s, one retry on unknown `kid`), `iss`, `aud`, `exp` | None. The code never reads or verifies an `id_token`. |
| Default scopes | `openid profile User.Read` | `User.Read` only |
| Identity returned | Graph `/me`: `id` (equals the `oid`), `displayName`, `userPrincipalName`, `mail` (raw) | `id`, `name`, `email` |
| Tenant claim | Resolves `iss` from the token `tid` | n/a |

Rationale: the `microsoft` driver does verifiable OIDC (token signature plus tenant-bound issuer). With `tenant` set to the Untangle tenant GUID, the authorize/token endpoints are tenant-specific and the issuer check is tenant-bound, which is what "single-tenant" requires in code and not only in portal config. Confidence: HIGH (source read on `master` plus Packagist metadata).

Known gaps in the driver (read from source, handle in app code):
- `email` is mapped from `userPrincipalName`, not `mail`. Read the raw `mail` from `$socialiteUser->user['mail']` and fall back to the UPN only if `mail` is null. Both can differ from the address solidtime already holds.
- `aud` is checked with `str_contains`, not strict equality, and no `nonce` is checked. Compensate with PKCE plus `state` plus the confidential-client secret, and add an explicit `tid === config tenant` assertion in your callback (cheap defence in depth).

Config (`config/services.php`; the entry must exist even if values are empty):

```php
'microsoft' => [
    'client_id'     => env('MICROSOFT_CLIENT_ID'),
    'client_secret' => env('MICROSOFT_CLIENT_SECRET'),
    'redirect'      => env('MICROSOFT_REDIRECT_URI'), // explicit https URL of the Dokploy domain
    'tenant'        => env('MICROSOFT_TENANT_ID'),    // the Untangle tenant GUID, never "common"
],
```

The provider page says to keep `common` in `.env` when you read the tenant from `env('MICROSOFT_TENANT_ID')`. Ignore that; for this project the value must be the tenant GUID. Use an explicit `MICROSOFT_REDIRECT_URI` rather than a relative path, because the app sits behind Dokploy's proxy and the scheme must be `https`.

Registration on this codebase (it uses the Laravel 10-style layout: no `bootstrap/providers.php`, providers listed in `config/app.php`):
1. `composer require laravel/socialite socialiteproviders/microsoft` (manager comes with it).
2. Add `"laravel/socialite"` to `extra.laravel.dont-discover` in `composer.json` and add `\SocialiteProviders\Manager\ServiceProvider::class` to `config/app.php` providers, per the SocialiteProviders usage guide. Confidence MEDIUM: the guide describes this for Laravel 11+ but does not mention 12 or 13. Verify with `php artisan about` and a smoke test that `Socialite::driver('microsoft')` resolves.
3. Register the driver in a NEW small service provider (for example `app/Providers/MicrosoftSocialiteServiceProvider.php`, one extra line in `config/app.php`) via `Event::listen(SocialiteWasCalled::class, fn ($e) => $e->extendSocialite('microsoft', \SocialiteProviders\Microsoft\Provider::class))`. This keeps upstream hot spots (`AppServiceProvider`, `EventServiceProvider`) untouched.

### 2. Flow hardening: state + PKCE + scopes

```php
Socialite::forgetDrivers();
return Socialite::driver('microsoft')
    ->enablePKCE()                                   // S256, verifier in session, pulled once
    ->setScopes(['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'])
    ->with(['prompt' => 'select_account'])           // optional UX
    ->redirect();
```

- State: Socialite stores a 40-char random `state` in the session and verifies it with `hash_equals`, pulled once. Do NOT call `->stateless()`; the routes live in the `web` group with sessions. Confidence HIGH (source read).
- PKCE: `enablePKCE()` is on `AbstractProvider` and the Microsoft driver's `getTokenFields()` calls `parent::`, so the `code_verifier` is sent. Entra supports PKCE for confidential web clients; the client secret stays in addition. Confidence MEDIUM-HIGH (parent behaviour read; no end-to-end run against Entra yet, so test it).
- `setScopes` overrides the driver's defaults (`openid profile User.Read`). `offline_access` is required or no refresh token is issued.
- Callback cookie: Entra returns by top-level GET (`response_mode=query`), so the default `SameSite=Lax` session cookie is sent. Do not set `SameSite=None`.

### 3. Identity linking: `(tid, oid)`, never email alone

Microsoft's claim-validation guidance says never use `email`, `preferred_username` or `unique_name` to decide access; use the immutable `tid` + `oid` pair as the key. The UPN is unique but changes over time.

- Store `microsoft_tenant_id` and `microsoft_oid` (the Graph `id`) on the new connection row, with a unique index on `(tenant_id, oid)`.
- First sign-in: look up by `(tid, oid)`. If not found, look up an existing non-placeholder `User` by email (`mail` falling back to UPN, case-insensitive) and link; otherwise provision. With a single tenant that Untangle administers, email-based first link is acceptable, but record it and never re-link on later sign-ins by email.
- `tid` comes from the validated id_token (the driver exposes it through its JWT handling and the tenant-bound `iss`), and you assert it equals `config('services.microsoft.tenant')`.

### 4. Token storage and refresh

New table `microsoft_connections` (new migration; do NOT add token columns to `users`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | follow repo convention |
| `user_id` | FK `users`, `cascadeOnDelete`, unique | one connection per user; gives "deleted with the user" for free |
| `tenant_id`, `oid` | string | unique together |
| `access_token` | `text`, cast `encrypted` | |
| `refresh_token` | `text`, cast `encrypted` | |
| `expires_at` | timestamp | access token expiry (`expiresIn` from Socialite) |
| `scopes` | json | granted scopes |
| `needs_reauth` | bool | set when refresh fails with `invalid_grant` |

- Model: `$hidden = ['access_token', 'refresh_token']` and do NOT use `CustomAuditable` on it. `User` is audited (`owen-it/laravel-auditing`), which is exactly why tokens must not live on `users`. If an audit trait is ever added, list the columns in `$auditExclude`.
- Never log token values or raw token responses; the SocialiteProviders user object exposes `accessTokenResponseBody` (full token response, including `id_token` and `refresh_token`), so do not dump it.
- Refresh: call the token endpoint yourself, 10 lines of `Http::asForm()->post("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", [grant_type=refresh_token, client_id, client_secret, refresh_token, scope])`. Socialite's `refreshToken()` also works and builds a `Token`, but the direct call keeps refresh decoupled from the request-bound driver (useful inside a service called from the API layer). Either is acceptable; prefer the direct call.
- Rotation rule (official): a refresh token is replaced on every use, and Microsoft does not revoke the old one. Always overwrite BOTH tokens with the response. Default lifetime is 90 days for confidential web apps. Refresh when `expires_at` is within 5 minutes.
- Locking: do refresh inside `DB::transaction` with `lockForUpdate()` on the connection row, and re-check expiry after acquiring the lock (a concurrent request may already have refreshed). Under rotation, the old token staying valid makes a race non-fatal, but the lock avoids a lost write.
- Failure handling: `invalid_grant` or `interaction_required` (revoked, expired after 90 days of no use, admin reset, conditional access) means set `needs_reauth = true`, return a typed "reconnect Microsoft" error, and let the UI send the user through the sign-in redirect again. Never retry in a loop.
- "Revoke on disconnect": Entra gives the app no per-token revoke call for a delegated user without extra admin-level permissions, so "disconnect" means delete the local row (tokens are gone) and tell the user they can remove the app from their My Apps/account page. Do not add `User.ReadWrite.All` or similar just for revocation.

Confidence: HIGH on rotation, lifetime and revocation table (Microsoft Learn "Refresh tokens", updated 2026-06); MEDIUM on the locking design (standard practice, not an Entra requirement).

### 5. Graph client: plain Laravel `Http`, not the Graph PHP SDK

`microsoft/microsoft-graph` is now v3.8.0 (2026-10-06), a Kiota-generated SDK requiring PHP `^8.2`, and it is Guzzle-8 compatible (`kiota-http-guzzle 2.2.1` accepts `guzzlehttp/guzzle ^7.4.5 || ^8.0`). So it is installable here. It is still the wrong tool for this scope:

- The need is 2 or 3 GET requests plus one form POST. The SDK pulls `microsoft-graph-core`, `kiota-abstractions`, `kiota-http-guzzle`, `kiota-authentication-phpleague`, three `kiota-serialization-*` packages, `league/oauth2-client` and `ramsey/uuid`, and a large generated model surface.
- Its authentication layer (`league/oauth2-client` token contexts) is a second OAuth abstraction next to Socialite and your encrypted token table. You would write an adapter to feed stored tokens into it.
- It changes `composer.lock` substantially, and the fork is trying to stay mergeable with upstream.
- Testing becomes SDK-mock-heavy instead of `Http::fake()`.

Use `app/Service/Microsoft/GraphClient.php` (new file) wrapping `Http::baseUrl('https://graph.microsoft.com/v1.0')` with:

```php
Http::baseUrl('https://graph.microsoft.com/v1.0')
    ->withToken($accessToken)
    ->acceptJson()
    ->connectTimeout(5)->timeout(15)                 // calendar open must not hang the page
    ->withHeaders(['Prefer' => 'outlook.timezone="UTC", IdType="ImmutableId"']);
```

- Retry only on 429, 503 and 504, honouring `Retry-After` and capping total wait (a few seconds, because this runs inside a user request). On 401, refresh once and replay once; if it fails again set `needs_reauth`.
- Pagination: follow `@odata.nextLink` verbatim and do not rebuild the URL. Set `$top` explicitly (calendarView allows 1 to 1000); do not rely on the default page size.
- Concurrency: do not use `Http::pool`. Outlook allows 4 concurrent requests and 10,000 requests per 10 minutes per app+mailbox; sequential paging stays far inside both. Confidence HIGH (Microsoft Learn throttling limits, Outlook section).

Reconsider the SDK only if scope grows to many Graph resources (mail, Teams, groups) or you add write-back (explicitly out of scope).

### 6. Calendar fetch: `calendarView` (bounded window), not delta

Query:

```
GET /me/calendarView
    ?startDateTime={window start, ISO-8601 with Z}
    &endDateTime={window end, ISO-8601 with Z}
    &$select=id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,
             type,seriesMasterId,organizer,showAs,sensitivity,webLink,lastModifiedDateTime,isOnlineMeeting
    &$orderby=start/dateTime
    &$top=100
```

> Correction (Phase 1 spike, 2026-10-19): see docs/m365/DECISIONS-graph.md § Corrections to earlier research. The production `$select` adds `originalStart` and drops `lastModifiedDateTime`; `Prefer` must be sent on every request, including each `@odata.nextLink`.

Why calendarView and not delta:
- calendarView expands recurring series server-side into `occurrence` / `exception` / `singleInstance` events, each with its own real start and end. You never have to evaluate RRULE-style recurrence or DST yourself.
- Delta on calendarView (`/me/calendarView/delta`) does NOT support `$select`, `$filter`, `$orderby`, `$expand` or `$search`. It also returns `@removed` entries for events outside the date range, which you must filter. It needs a stored `deltaLink` per user per window and a re-baseline whenever the window changes, which is exactly what a calendar the user pages through does constantly.
- The project chose "sync on open + manual button", with no background job and no webhooks. Delta's whole value is cheap repeated polling, which does not apply. At this scale, a few GETs per calendar open are well under every limit.
- Revisit delta only if background sync or webhooks are added later (a separate milestone).

Filtering: Graph's calendarView does not support filtering on `responseStatus` or `isOrganizer` in a way worth depending on. Fetch with `$select` and filter in PHP: keep `isOrganizer || responseStatus.response in {accepted, tentativelyAccepted}`; drop `declined`, `isCancelled`, `isAllDay`. (`organizer` itself returns `responseStatus.response = "organizer"`; treat `isOrganizer` as the primary signal.) Confidence: HIGH on query shape and delta limitations (Microsoft Learn event-delta and calendarView pages); MEDIUM on server-side `$filter` limitations (not exhaustively verified; filtering in PHP is safe regardless).

Series info for recurring rules:
- Key rules on `seriesMasterId` (present on occurrences and exceptions; `type` tells which). Do NOT key on `iCalUId`: the docs state it differs for each occurrence in a recurring series.
- `recurrence` (the pattern) is a property of the series master. Occurrences returned by calendarView carry `seriesMasterId` and `type`. If the UI ever needs a "repeats weekly" label, fetch the master once with `GET /me/events/{seriesMasterId}` (cache it); it is not required for pre-assignment rules.
- Because the master id is stored long term, ImmutableId is mandatory (section above). Use `text` or `varchar(512)` columns; the ids are long.

"Out of sync" detection for already-converted entries (data-safety requirement):
- A cancelled or deleted meeting may simply stop appearing in calendarView, and a meeting moved outside the window also disappears. Absence in the window is therefore NOT proof of deletion.
- For each linked time entry in the current window, compare stored snapshot (event id, start, end) with the fetched event; for linked events not returned, do a targeted `GET /me/events/{id}` (404 means deleted or no access; `isCancelled=true` means cancelled; otherwise compare times). Flag only, never mutate the time entry.

### 7. Timezone handling

- Send `Prefer: outlook.timezone="UTC"` explicitly. Without it Graph already returns UTC, but the explicit header documents intent and survives a default change. The header affects only the returned `start`/`end`; the `startDateTime`/`endDateTime` query values are read with their own offset (UTC if none), unaffected by the header (Microsoft Learn).
- Graph returns `start`/`end` as `{ "dateTime": "2026-10-19T09:00:00.0000000", "timeZone": "UTC" }`, with NO offset in the string. Parse with `CarbonImmutable::parse($dt, 'UTC')` (or `createFromFormat` with an explicit UTC zone). Parsing without a zone uses the app zone and shifts everything on a non-UTC server. Confidence: MEDIUM (format shape from training knowledge; Learn page confirms the default-UTC behaviour and the `dateTimeTimeZone` type; confirm with one real response).
- Store UTC (solidtime time entries are UTC already). Convert to the user's `users.timezone` only at the edges: computing the calendar window and rendering in Vue (dayjs).
- Compute the fetch window in the user's timezone first, then convert to UTC ISO strings with `Z`. A "week" for a user in Europe/Madrid must not be a UTC week.
- Do not rely on IANA names in the Prefer header. Microsoft documents Windows time zone names for `outlook.timezone`; IANA acceptance is unconfirmed from Microsoft's own docs. UTC avoids the question entirely. Confidence HIGH that UTC works; LOW on IANA.
- Occurrences: each is already placed at its real local-time-correct UTC instant by the server, so DST shifts across a series are handled for you. This is a major reason to prefer calendarView expansion over client-side recurrence math.

### 8. Scopes

Keep the project constraint `openid profile email offline_access User.Read Calendars.Read`. Note for the roadmap: Microsoft now lists `Calendars.ReadBasic` as the least-privileged permission for `calendarView` (it excludes `body`, `attachments`, `extensions`; the page does not say whether `attendees` is excluded), while the event delta page lists `Calendars.Read` as least privileged. This app never reads bodies or attachments, so `Calendars.ReadBasic` may be sufficient. Treat it as an optional tightening to test in a spike (does `responseStatus` and `isOrganizer` come back intact?), not as the default. Neither requires admin consent for delegated use.

## Installation

```bash
# Core (PHP)
composer require laravel/socialite:^5.31 socialiteproviders/microsoft:^4.10
# socialiteproviders/manager ^4.10 is pulled in automatically

# Then edit composer.json extra.laravel.dont-discover to include "laravel/socialite",
# and add \SocialiteProviders\Manager\ServiceProvider::class to config/app.php providers.

# No Graph SDK. No frontend packages are needed for auth or Graph (calendar UI work reuses
# the existing FullCalendar components, dayjs and TanStack Query).
```

`.env` additions: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` (the exact HTTPS callback URL registered in Entra). Entra client secrets expire (maximum 24 months in the portal), so put the expiry date in the runbook.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `socialiteproviders/microsoft` | `socialiteproviders/microsoft-azure` 5.2.1 | Only if you needed its logout-URL helper and are willing to validate the `id_token` yourself. It does not validate tokens. |
| `socialiteproviders/microsoft` | `thenetworg/oauth2-azure` v2.2.6 on `league/oauth2-client` 2.9.1 | If you were not on Laravel/Socialite. Here it would duplicate Socialite's flow and lose `Socialite::fake()`. |
| `socialiteproviders/microsoft` | Hand-rolled OIDC (`Http` + `firebase/php-jwt`) | Never for this scope; it re-implements state, PKCE, JWKS rotation and issuer checks that the driver already does. |
| Plain `Http` client | `microsoft/microsoft-graph` v3.8.0 | If the integration grows to many Graph resources or write operations, and you accept the Kiota dependency tree and a token-provider adapter. |
| `calendarView` window | `calendarView/delta` | If background sync or webhooks are added later and you want to avoid refetching windows. |
| Tokens in `microsoft_connections` | Token columns on `users` | Never here: `User` is audited and serialised in many places. |
| Refresh via direct `Http` POST | `Socialite::driver('microsoft')->refreshToken()` | Fine inside a controller where the request-bound driver is already available; works, but couples token service to the web request. |
| Prefer `UTC` | `Prefer: outlook.timezone="W. Europe Standard Time"` (Windows name) | Only if you wanted Graph to return local times; it adds a Windows-to-IANA mapping problem for no benefit. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `tenant = common` / `organizations` / `consumers` | Allows other organisations' (or personal) accounts to complete sign-in. Defeats single-tenant. | Tenant GUID in `MICROSOFT_TENANT_ID`, plus `tid` assertion in the callback |
| Linking or authorising by `email` / `preferred_username` / UPN alone | Microsoft explicitly warns these are not unique or immutable and can be changed by admins (nOAuth class of account takeover) | `(tid, oid)` as the key; email only for the one-time first link |
| `socialiteproviders/microsoft-azure` | No `id_token` validation, minimal default scopes | `socialiteproviders/microsoft` |
| Azure AD v1 endpoints (`/oauth2/authorize` with `resource=`), ADAL, `azure-ad` guides from 2019 to 2021 | Retired generation; the Microsoft drivers above use v2.0 and scopes | v2.0 with scopes |
| `microsoft/microsoft-graph` v1/v2 (2.x, `Microsoft\Graph\Graph` + `Model\*` style) | Older non-Kiota SDK line; most blog posts and Stack Overflow answers describe it | Plain `Http` (or v3 only if the SDK is later justified) |
| Graph `/beta` endpoints | Unstable, can change without notice | `/v1.0` |
| `->stateless()` on the Socialite driver | Disables the session `state` check | Default stateful flow on `web` routes |
| Delta query for this phase | No `$select`/`$filter`, out-of-range `@removed` noise, per-window token state | Bounded `calendarView` |
| Application permissions (`Calendars.Read` as app role, client-credentials flow) | Reads every mailbox in the tenant, needs admin consent and an application access policy; violates least privilege and the "per-user ghost events" model | Delegated `Calendars.Read` with the signed-in user's token |
| Storing tokens in session, cache, or `users` | Lost on logout or flush; audited and serialised; not encrypted | Encrypted columns on a dedicated, non-audited table |
| Resolving `Socialite` in a service provider's `boot()` under Octane | A driver built at boot captures the boot-time request in a long-lived worker (the manager is a singleton that caches drivers, and `buildProvider` injects the current request into each driver; MEDIUM confidence, untested under Octane) | Resolve inside the controller action; call `Socialite::forgetDrivers()` first |
| Using `iCalUId` as the series key | Differs per occurrence in a recurring series (Microsoft Learn) | `seriesMasterId` |
| Passing token values or `accessTokenResponseBody` to logs, Telescope-visible payloads, audits, Inertia props | Leaks refresh tokens | Keep tokens server-side only; `$hidden`; never return them in responses |
| Making Passport accept Entra tokens / bridging Entra to the REST API | Out of scope; Passport has no external-IdP token validation | Keep Passport for API tokens; Entra only logs the user into the web session |

## Stack Patterns by Variant

**If the callback is hit behind Dokploy's proxy and the redirect URI scheme looks wrong (`http://`):**
- Set the explicit `MICROSOFT_REDIRECT_URI` and make sure the trusted-proxy configuration and `APP_FORCE_HTTPS` are right.
- Because Entra requires an exact redirect-URI match including scheme and path, a scheme mismatch fails with `AADSTS50011`.

**If a user's tenant admin later restricts sign-in to assigned users:**
- Enable "Assignment required" on the enterprise application. Unassigned users get an Entra-side error and never reach the callback. No app code change is needed.

**If calendar opens become slow or hit throttling in practice:**
- First cache the fetched window per user for a short TTL (30 to 60 s) and keep the manual "Sync" button as the cache-bypass.
- Move to a queued job or delta only if measurements justify it; the default `sync` queue would run it inline anyway.

**If APP_KEY is ever rotated:**
- Existing `encrypted` columns become unreadable unless `APP_PREVIOUS_KEYS` is set. Failing to decrypt should be treated as `needs_reauth`, not a 500.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `laravel/socialite ^5.31` | `laravel/framework ^13` | Declares `illuminate/contracts ^6 to ^13`; PHP `^8.1`. |
| `socialiteproviders/manager ^4.10` | PHP `^8.3`, `illuminate/support ^12 or ^13`, `laravel/socialite ^5.29` | Project pins PHP `8.3.*`: OK. |
| `socialiteproviders/microsoft ^4.10` | `firebase/php-jwt ^7.0`, `socialiteproviders/manager ^4.4` | Lock already has `firebase/php-jwt` 7.2.0. Passport uses `lcobucci/jwt` 5.6, so no clash. |
| Laravel `Http` client | `guzzlehttp/guzzle 8.2.0` (locked; 8.3.0 released 2026-10-18) | No change needed. |
| `microsoft/microsoft-graph` 3.8.0 (NOT recommended) | `guzzlehttp/guzzle ^7.4.5 or ^8`, PHP `^8.2` | Would install here, so the decision is about scope and weight, not blocked compatibility. |
| `laravel/octane` + Socialite | n/a | See "Verify in Phase": the Socialite manager is a singleton that caches drivers (holding the request used to build them). |

## Verify in Phase (open items, tagged LOW or MEDIUM)

- `dont-discover` + manager `ServiceProvider` registration works on Laravel 13.33 with this repo's `config/app.php` layout (MEDIUM; docs predate 13).
- Octane: confirm a callback under FrankenPHP/Octane keeps `state` and `code_verifier` in the right session across two sequential logins; write an Octane-mode test or manual check, and keep `Socialite::forgetDrivers()` in the action regardless (MEDIUM).
- Exact `dateTimeTimeZone` string shape and that `Prefer: outlook.timezone="UTC"` combined with `IdType="ImmutableId"` in one comma-separated header is accepted (MEDIUM; expected, verify with a real response once).
- `Calendars.ReadBasic` sufficiency (does `responseStatus`/`isOrganizer`/`seriesMasterId` survive?) if you want to tighten permissions (LOW until tested).
- Behaviour of cancelled meetings in an attendee's calendarView (appears with `isCancelled=true` versus disappears) on Untangle's tenant: determines the exact "out of sync" detection branch (LOW; test with real data).
- Whether the tenant uses Conditional Access (MFA or compliant-device) that can make refresh return `interaction_required`; the `needs_reauth` path must handle it (LOW; tenant-specific).
- `Retry-After` presence on Outlook 429s: Microsoft notes some resource groups omit it; the retry helper must fall back to a short exponential backoff (MEDIUM).

## Sources

- Packagist JSON API (queried 2026-10-19): `laravel/socialite` v5.31.0, `socialiteproviders/manager` 4.10.0, `socialiteproviders/microsoft` 4.10.0, `socialiteproviders/microsoft-azure` 5.2.1, `microsoft/microsoft-graph` v3.8.0, `microsoft/microsoft-graph-core` v3.0.0, `microsoft/kiota-http-guzzle` 2.2.1, `guzzlehttp/guzzle` 8.3.0, `league/oauth2-client` 2.9.1, `thenetworg/oauth2-azure` v2.2.6 (HIGH: primary registry data)
- https://laravel.com/docs/13.x/socialite (HIGH): install, scopes, `with()`, user properties (`token`, `refreshToken`, `expiresIn`), `userFromToken`, `stateless`, `Socialite::fake`
- https://github.com/laravel/socialite `5.x` `src/Two/AbstractProvider.php`, `src/SocialiteManager.php`, `src/SocialiteServiceProvider.php` (HIGH): PKCE, state, `refreshToken`, driver caching and singleton registration
- https://github.com/SocialiteProviders/Providers `src/Microsoft/Provider.php` and `src/Azure/Provider.php` (HIGH for what the code does at read time; the Azure file was read at `src/Azure`, the Microsoft one at `src/Microsoft`)
- https://socialiteproviders.com/Microsoft/, https://socialiteproviders.com/Microsoft-Azure/, https://socialiteproviders.com/usage/ (MEDIUM: docs predate Laravel 13 and are partly ambiguous)
- https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0 (HIGH; page updated 2026-06): query params, `Prefer: outlook.timezone`, `$top` 1 to 1000, paging, permissions
- https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0 (HIGH; updated 2026-05): delta limitations, `@removed` semantics
- https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0 (HIGH; updated 2026-04): `type`, `seriesMasterId`, `iCalUId`, `id` and ImmutableId, `originalStart`
- https://learn.microsoft.com/en-us/graph/outlook-immutable-id (HIGH): `Prefer: IdType="ImmutableId"`, supported for events and delta
- https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens (HIGH; updated 2026-06): 90-day lifetime, rotation on every use, old token not revoked, revocation table
- https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation (HIGH): use `tid`+`oid`, never email/UPN for authorization
- https://learn.microsoft.com/en-us/graph/throttling-limits (HIGH): Outlook limits, 10,000 requests per 10 minutes and 4 concurrent per app+mailbox
- https://learn.microsoft.com/en-us/graph/permissions-reference (MEDIUM: page truncated at 100k characters; only the Calendars permissions were read)
- Web search on `Prefer: outlook.timezone` name formats (LOW: Windows names documented, IANA unconfirmed)

---
*Stack research for: Microsoft 365 (Entra ID SSO + Outlook calendar via Graph) in Laravel 13 / Vue 3 Inertia*
*Researched: 2026-10-19*
