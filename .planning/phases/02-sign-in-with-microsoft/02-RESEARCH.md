# Phase 2: Sign in with Microsoft - Research

**Researched:** 2026-10-22
**Domain:** Entra ID single-tenant OIDC sign-in (Laravel 13 / Fortify session auth / Octane+FrankenPHP / Inertia+Vue 3) with encrypted token storage, deployed on Dokploy behind Traefik
**Confidence:** HIGH on stack, codebase seams, Octane behaviour and dependency resolution (all read or executed this session); MEDIUM on deployment values that live outside the repo (Traefik CIDR, mail delivery in prod, desktop-app webview behaviour)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Identity and access (locked, owner decisions)**
- **D-01:** Single tenant: only the Untangle tenant (`tid` from env `SOLIDTIME_MICROSOFT_TENANT_ID` / app config). Never `common`/`organizations`.
- **D-02:** Tenant-wide access: Entra "Assignment required" = No. The app itself must reject: other tenants (tid mismatch), guest users (userType Guest / `#EXT#` UPN / `acct`=1 claim), and accounts whose email domain is not in the allowlist. Default allowlist: `untanglegrowth.com` (primary), `untangle.es` — configurable list via env.
- **D-03:** Identity is matched on Entra `tid` + `oid`, stored in a dedicated table (e.g. `microsoft_accounts`), never by email after the first link. Email (case-insensitive) is used only for the one-time first link to an existing **verified, non-placeholder** solidtime user; unverified password accounts are never silently linked (show a clear message instead).
- **D-04:** Auto-provision on first sign-in when no account exists: verified, passwordless user, joined to the configured Untangle organization with the lowest role (employee). Works even with `APP_ENABLE_REGISTRATION=off`/invite-only. Microsoft-provisioned users do NOT get a personal organization.
- **D-05:** Target organization is configured by env (e.g. `MICROSOFT_ORGANIZATION_ID`). If not configured or not found, Microsoft sign-in still links existing users but refuses to provision new ones with a clear message (so the owner can bootstrap: register once with email/password, which creates the Untangle org, then set the env var in Dokploy).
- **D-06:** Entra MFA is the second factor for Microsoft sign-ins (Fortify TOTP challenge not applied to Microsoft logins); email/password + TOTP unchanged for password logins.
- **D-07:** Concurrent first sign-ins must produce exactly one user (unique index on (tid, oid) + transactional provisioning).
- **D-08:** F1 (freelance) users have no mailbox: they can sign in normally; nothing in this phase may require a mailbox.

**Tokens and security (locked)**
- **D-09:** Scopes requested at login: `openid profile email offline_access User.Read Calendars.Read` (admin consent already granted tenant-wide, verified in Phase 1 — users see no consent screen). Store access + refresh tokens (for Phase 3) encrypted (`encrypted` cast on `text` columns), `$hidden`, never audited/logged/serialized/shared via Inertia, never in `users`/session/cache.
- **D-10:** Disconnect in profile deletes stored tokens (and the identity link per AUTH-07 wording — planner/researcher decide whether disconnect keeps the identity row for SSO but drops tokens; must not break the user's ability to log in if they have no password: a passwordless user who disconnects must be warned / prevented from locking themselves out). Time entries are never touched.
- **D-11:** Socialite (or equivalent) must be Octane/FrankenPHP-safe: no driver/user state leaking between requests; state + PKCE validated; never `stateless()`.
- **D-12:** Production secret: Doppler `vps/prd` `SOLIDTIME_MICROSOFT_CLIENT_SECRET`; client/tenant IDs `SOLIDTIME_MICROSOFT_CLIENT_ID`/`SOLIDTIME_MICROSOFT_TENANT_ID`. The first production sign-in is the first real use of the production secret (AADSTS7000215 = wrong value → new secret); record the date in docs/m365/RUNBOOK-entra-app.md.

**Deployment (locked)**
- **D-13:** Deploy target: Dokploy compose `untangle-solidtime-tq34sf` (composeId `PtyO0frWvgS_QEaN9g1bW`), image `ghcr.io/untanglesl/solidtime:feature-m365-integration` built by `.github/workflows/fork-image.yml` on push. Compose source of truth: `docs/deploy/dokploy-compose.fork.yml` (raw compose; env values live in Dokploy env, secrets copied from Doppler `vps/prd`). Redirect URI `https://time.untangle.es/auth/microsoft/callback` (already registered in Entra; also `https://solidtime.test/auth/microsoft/callback` and `http://localhost/auth/microsoft/callback`). APP_FORCE_HTTPS / TRUSTED_PROXIES must make Laravel build the https callback behind Traefik.
- **D-14:** The integration is fully off (no button, no routes) when the Microsoft env vars are absent (partial OPS-02 groundwork; full verification in Phase 7).
- **D-15:** Fork isolation: new code in `app/Microsoft365/` (own service provider, routes, migrations, config `config/microsoft365.php` or similar) and `resources/js/m365/`; minimal touches to core (provider registration line, login page button slot, profile section). Keep a touched-core-files list.

**UI (no separate UI-SPEC; decided here)**
- **D-16:** Login page: a secondary button "Sign in with Microsoft" (Microsoft logo, follows solidtime's existing button components and theme tokens), below or above the email/password form; only visible when the integration is configured. Error messages for rejected accounts shown on the login page in the app's existing flash/notification style. App UI language: follow existing solidtime i18n (lang/) — add strings to lang files rather than hard-coding.
- **D-17:** Profile page: a "Microsoft 365" section showing connected/not connected, the linked account email, and a Disconnect action with confirmation (reuse existing profile section components).

### Claude's Discretion
- Exact package choice and versions (research recommends `laravel/socialite` + `socialiteproviders/microsoft`), table/column names, route names, how disconnect treats passwordless users (must be safe), test structure.

### Deferred Ideas (OUT OF SCOPE)
- Graph calendar sync, token refresh usage — Phase 3.
- Full OPS-02 off-switch verification, SEC-03/SEC-04 — Phase 7.
- Entra spike cleanup — Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | "Sign in with Microsoft" on login page; email/password unchanged | Per-request `Provider` build + redirect route (Pattern 1); shared-prop button seam (Pattern 4); Microsoft branding rules |
| AUTH-02 | Reject other tenants, guests, domains outside allowlist, clear error | `MicrosoftIdentityGuard` (Pattern 2): `tid`/`aud` assert, Graph `userType` via driver `fields`, `#EXT#`, domain allowlist; flash via `message` |
| AUTH-03 | First sign-in provisions verified passwordless user in configured org as employee | Provisioner without `UserService::createUser`; `MemberService::addMember(..., Role::Employee, asSuperAdmin: true)`; no personal org |
| AUTH-04 | Link existing verified non-placeholder user by email (case-insensitive); never link unverified | Resolver rules (Pattern 3), `lower(email)` query, placeholder/ambiguity handling |
| AUTH-05 | Returning sign-ins by `(tid, oid)`; concurrent first sign-ins never duplicate | `microsoft_accounts` unique `(tenant_id, microsoft_oid)` + `unique(user_id)`, advisory xact lock, one retry on `UniqueConstraintViolationException` |
| AUTH-06 | Works with registration off; Entra MFA is the second factor | Provisioning bypasses `CreateNewUser`; `Auth::login()` bypasses Fortify 2FA pipeline; passwordless safe with `auth.session` |
| AUTH-07 | Profile shows connection status and disconnect; tokens deleted; time entries kept | Profile shared prop + `MicrosoftConnectionForm.vue`; disconnect keeps identity row, nulls tokens (uniform, lock-out-proof) |
| SEC-01 | Tokens encrypted at rest in dedicated table; never in users/session/cache/logs/audits/API/Inertia | `microsoft_accounts` (`text` + `encrypted`, `$hidden`, not Auditable), log discipline, test matrix |
| OPS-01 | Env-only configuration, documented for Dokploy incl. HTTPS redirect + trusted proxies | `config/microsoft365.php`, compose `environment:` additions, redirect from `APP_URL`, bootstrap runbook, `m365:check` |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Source: `.claude/CLAUDE.md` (read this session). Treated as locked.

- Stack: Laravel 13 / PHP 8.3 / Vue 3 + Inertia / PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`.
- Every PHP file: `<?php` then `declare(strict_types=1);`; typed params/returns; explicit `void`. Pint preset `laravel` + `declare_strict_types`, `strict_comparison`, `strict_param`, `no_unused_imports`, `void_return` (`pint.json`).
- PHPStan/Larastan level 7 over `app/` with `checkOctaneCompatibility`, `checkModelProperties`, `noEnvCallsOutsideOfConfig`. No `env()` outside `config/`.
- Singular namespace `App\Service`; tests `Test.php` suffix, methods `test_*` snake_case, Arrange/Act/Assert comments, `#[CoversClass]`/`#[UsesClass]`.
- Vue: `<script setup lang="ts">`, `defineProps<{...}>()`, theme tokens (`text-text-primary`, `border-input-border`, `bg-card-background`), no raw colours; Prettier 4 spaces, single quotes, `printWidth` 100.
- Fork isolation: new code in `app/Microsoft365/` and `resources/js/m365/`; core touched via thin seams; no hot-file edits (`AppServiceProvider`, `FortifyServiceProvider`, `routes/web.php`, `TimeEntryController`, `openapi.json`). Fork JSON endpoints never in `/api/v1`.
- Do not make direct repo edits outside a GSD workflow.
- Tokens: `encrypted` cast, `$hidden`, excluded from audits/logs, state + PKCE validated, deleted with the user (PROJECT constraints).

## Summary

The phase is a classic OIDC login added beside Fortify, and the repo already has almost every seam it needs. The cleanest design avoids the shared Socialite manager entirely: build `SocialiteProviders\Microsoft\Provider` **per request** inside a small fork class (`new Provider($request, ...)` + `setConfig(new Config(...))` + `enablePKCE()`), behind an interface that tests replace with a fake. This sidesteps provider registration (`SocialiteWasCalled`, `dont-discover`, `config/services.php`) and the Octane driver-cache question completely, and it is the only way to test `tid`/claims, because `Socialite::fake()` returns a plain user with no id_token claims. Octane v2.20.0 does reset the Socialite manager per request (`PrepareSocialiteForNextOperation`), so the facade route would also be survivable, but the Microsoft driver keeps `private ?\stdClass $claims` and caches `$this->user`, so a per-request instance is the safer default.

Three findings change the earlier project research. (1) `Inertia::share()` called in a service provider `boot()` is **lost under Octane**: Octane flushes shared props before every request (`PrepareInertiaForNextOperation` calls `flushShared()`), so the login button would vanish after the first request in production. Share the `microsoft` prop from a fork middleware appended to the `web` group instead. (2) Fork config must live in `config/microsoft365.php`, not `app/Microsoft365/config/`, because Larastan's `noEnvCallsOutsideOfConfig` only exempts `config_path()` and PHPStan analyses all of `app/`. (3) Passwordless users never get a remember-me session: `SessionGuard::userFromRecaller` returns null when the password is not a string, so log them in with `remember: false` and expect `SESSION_LIFETIME` (default 120 min idle) to govern. `AuthenticateSession` is safe for passwordless users (it returns early when `getAuthPassword()` is falsy).

The build needs a PHP toolchain the host lacks: `composer.lock` must change (4 new locked packages, dry-run verified: 0 updates, 0 removals) and CI is push-only. A portable PHP 8.3.36 + Composer 2.10.3 was downloaded and run this session (SHA-256 matched the php.net manifest), so Wave 0 can regenerate the lock and run Pint/PHPStan locally; PHPUnit still needs PostgreSQL and stays CI-only.

**Primary recommendation:** Add `laravel/socialite ^5.31` + `socialiteproviders/microsoft ^4.10`; implement a fork `Microsoft365ServiceProvider` (routes, migration, middleware push, `config/microsoft365.php`), a per-request provider factory behind an interface, a pure `MicrosoftIdentityGuard`, a transactional resolver/provisioner keyed on `(tid, oid)`, and a `microsoft_accounts` table with encrypted token columns; keep the identity row on disconnect (tokens nulled, `disconnected_at` set) so nobody can lock themselves out.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth redirect + callback, state/PKCE, id_token validation | API / Backend (Laravel `web` group) | — | Confidential client; secret and session live server-side; browser only follows redirects |
| Tenant/guest/domain gating | API / Backend | Entra (tenant-wide access, Security Defaults MFA) | Entra "Assignment required" is No (no P1), so the app is the gate |
| Identity resolve / link / provision | API / Backend | Database (unique indexes, advisory lock) | Exactly-once guarantees need DB constraints |
| Session login, session regeneration | API / Backend (Fortify `web` guard) | — | Same guard as password login; bypasses Fortify 2FA pipeline by design (D-06) |
| Token storage (encrypted) | Database / Storage | API / Backend (`encrypted` cast, `APP_KEY`) | Dedicated non-audited table |
| Login button visibility | API / Backend (shared Inertia prop) | Browser (renders `<a>`) | Gate is server config (D-14); browser gets booleans/URLs only |
| Profile status + disconnect/connect | API / Backend (controller) | Browser (Inertia form, dialog) | State changes server-side; UI reflects props |
| Env/config contract, HTTPS redirect URI | API / Backend (config) | CDN/Proxy tier (Traefik, `TRUSTED_PROXIES`) | Redirect URI built from `APP_URL`, independent of proxy headers |
| Passport authorize resume for desktop/extension | API / Backend (`url.intended`) | — | Existing web-session authorize flow; callback must resume intended URL |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `laravel/socialite` | `^5.31` (v5.31.0, 2026-08-31) | OAuth2 base provider: state in session, PKCE (`enablePKCE`, S256), token exchange | First-party; requires `illuminate/* ^13` allowed, `guzzlehttp/guzzle ^8.0` allowed, `phpseclib ^4.0` already locked |
| `socialiteproviders/microsoft` | `^4.10` (4.10.0, 2026-07-21) | Entra v2.0 driver: tenant-pinned endpoints, id_token JWKS validation, Graph `/me` | Validates signature/`iss`/`aud`/`exp`; exposes `getClaims()` (tid/oid) |
| `socialiteproviders/manager` | 4.10.0 (transitive) | Base class + `Config` object for the driver | Requires PHP `^8.3` (project pins `8.3.*`) |
| `league/oauth1-client` | v1.12.0 (transitive of Socialite) | Pulled by Socialite | Requires `ext-openssl`, guzzle `^8.0` allowed |

[VERIFIED: composer dry-run in a scratch copy of `composer.json`+`composer.lock`, 2026-10-22] output: `Lock file operations: 4 installs, 0 updates, 0 removals` / `Locking laravel/socialite (v5.31.0)` / `Locking league/oauth1-client (v1.12.0)` / `Locking socialiteproviders/manager (4.10.0)` / `Locking socialiteproviders/microsoft (4.10.0)`. Locked already and sufficient: `firebase/php-jwt` v7.2.0, `phpseclib/phpseclib` 4.0.1, `laravel/framework` v13.33.0, `laravel/octane` v2.20.0 [VERIFIED: composer.lock].

### Supporting (already in repo, reuse)

| Library / feature | Purpose | When to Use |
|-------------------|---------|-------------|
| Eloquent `encrypted` cast + `APP_KEY` | Token columns | Both token columns (`text`) |
| `Illuminate\Database\UniqueConstraintViolationException` | Concurrency backstop | Catch around the resolve transaction, retry once |
| `App\Service\TimezoneService` (`isValid`, `mapLegacyTimezone`) | Validate browser timezone passed on the redirect link | Provisioning default timezone |
| `inertiajs/inertia-laravel` v3.3.4 `Inertia::share` | Shared `microsoft` prop | From a fork middleware, never from `boot()` |
| Vitest 4 + `@vue/test-utils` | Component tests for button/profile section | Co-located `*.test.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-request `Provider` construction | `Socialite::driver('microsoft')` + `SocialiteWasCalled` registration | Needs `dont-discover` for `laravel/socialite`, a `services.microsoft` config entry (touches `config/services.php` or runtime `config()` set), and `Socialite::fake()` cannot supply claims. Octane resets drivers per request, so it is workable but has more moving parts |
| `socialiteproviders/microsoft` | `socialiteproviders/microsoft-azure` | Azure driver does not validate the id_token; rejected in project STACK research |
| Two-mode disconnect (delete row for password users) | Uniform "keep identity, null tokens" | Two-mode adds branches and a re-link-by-email surprise; uniform cannot lock anyone out or create a duplicate user after a UPN rename |

**Installation (Wave 0, with the portable toolchain):**
```bash
composer require laravel/socialite:^5.31 socialiteproviders/microsoft:^4.10 --no-scripts --ignore-platform-reqs
```

**Version verification:** versions and publish dates were read from `repo.packagist.org/p2/*.json` on 2026-10-22 (socialite v5.31.0 2026-08-31; manager 4.10.0 2026-08-16; microsoft 4.10.0 2026-07-21) and confirmed by the dry-run above.

## Package Legitimacy Audit

`gsd-tools query package-legitimacy check` supports only `npm|pypi|crates` [VERIFIED: tool usage error "package-legitimacy check --ecosystem <npm|pypi|crates>"], so Composer packages were checked against Packagist and official docs instead.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `laravel/socialite` | Packagist | years (first-party) | 130.4M total / 7.7M monthly | github.com/laravel/socialite | OK (manual) | Approved |
| `socialiteproviders/manager` | Packagist | years | 58.3M total / 3.7M monthly | github.com/SocialiteProviders/Manager | OK (manual) | Approved |
| `socialiteproviders/microsoft` | Packagist | years | 10.1M total / 1.0M monthly | github.com/SocialiteProviders/Providers (subtree) | OK (manual) | Approved |
| `league/oauth1-client` | Packagist | years (thephpleague) | transitive | github.com/thephpleague/oauth1-client | OK (manual) | Approved (transitive) |

[CITED: laravel.com/docs/13.x/socialite] "Adapters for other platforms are available via the community driven Socialite Providers website" (socialiteproviders.com). Packagist data via `packagist.org/packages/<name>.json` (downloads, repository, no `abandoned` flag).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none. No `checkpoint:human-verify` needed for these installs; Composer has no npm-style `postinstall` scripts for them.

## Architecture Patterns

### System Architecture Diagram

```
Browser                         solidtime (Laravel web group, FrankenPHP/Octane)                 Entra / Graph
-------                         ------------------------------------------------                 -------------
/login (Fortify view) ---------> Inertia::render('Auth/Login')  <- ShareMicrosoftInertiaData adds
   [Sign in with Microsoft]                                          props.microsoft {enabled, urls, labels}
   <a href=/auth/microsoft/redirect?timezone=Europe/Madrid>
        |
        v  GET /auth/microsoft/redirect    (throttle, microsoft.enabled -> 404 if unconfigured)
   MicrosoftAuthController::redirect
        - validate optional ?timezone (TimezoneService), ?intent=connect (requires auth)
        - provider = factory->make($request)   // NEW instance every request
        - session: state + code_verifier (Socialite) , microsoft.intent, microsoft.timezone
        - 302 ------------------------------------------------------------------>  login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
                                                                                     (MFA via Security Defaults, no consent screen)
        <---------------------------------------------------- GET /auth/microsoft/callback?code&state
   MicrosoftAuthController::callback
        - error param? -> mapped message
        - provider->user()  (state pulled+checked, code_verifier sent) ------------> /token  (client secret + PKCE)  ; Graph /me ; JWKS
        - identity = MicrosoftIdentity DTO (claims tid/oid/aud, Graph userType, mail/upn, tokens)
        - MicrosoftIdentityGuard: tid == config, aud == client id, userType == Member, no #EXT#, domain in allowlist
        - DB::transaction + pg_advisory_xact_lock(tid:oid):
              account by (tid,oid) -> user          [AUTH-05]
              else verified non-placeholder email match -> link   [AUTH-04]
              else org configured? -> provision user + Member(employee)   [AUTH-03]
              else refuse (D-05)
          store/overwrite encrypted tokens (unless disconnected_at set)
        - Auth::guard('web')->login($user, remember: has password)   // regenerates session id; skips Fortify 2FA
        - redirect session('url.intended') ?? dashboard   (resumes Passport /oauth/authorize)
   failures -> redirect('login')->with('message', <lang string>)  (shown by Login.vue flash box)

/user/profile -> UserProfileController (core, untouched) -> Inertia -> props.microsoft.account {connected,email,...}
   DELETE /user/microsoft  -> MicrosoftAccountController::destroy  (auth:web, auth.session, verified)
```

### Recommended Project Structure

```
app/Microsoft365/
├── Microsoft365ServiceProvider.php        # routes (web group), migrations, middleware push, command, gate
├── Auth/
│   ├── MicrosoftOAuthGateway.php          # interface: redirect(Request,...), authenticate(Request): MicrosoftIdentity
│   ├── SocialiteMicrosoftGateway.php      # builds a NEW SocialiteProviders Provider per call
│   ├── MicrosoftIdentity.php              # readonly DTO (tid, oid, name, mail, upn, userType, tokens, scopes)
│   ├── MicrosoftIdentityGuard.php         # pure: tenant/aud/guest/domain checks -> throws MicrosoftSignInException
│   ├── MicrosoftIdentityResolver.php      # (tid,oid) -> link -> provision, transactional
│   ├── MicrosoftUserProvisioner.php       # creates passwordless verified User + Member(employee)
│   └── MicrosoftSignInException.php       # enum-backed reason -> lang key
├── Http/
│   ├── Controllers/MicrosoftAuthController.php, MicrosoftAccountController.php
│   └── Middleware/EnsureMicrosoftIsEnabled.php, ShareMicrosoftInertiaData.php
├── Models/MicrosoftAccount.php            # NOT Auditable; hidden tokens; encrypted casts
├── Console/MicrosoftCheckCommand.php      # m365:check
└── database/migrations/2026_10_22_000001_create_microsoft_accounts_table.php
config/microsoft365.php                    # env() lives here (Larastan rule)
lang/en/microsoft365.php, lang/es/microsoft365.php
resources/js/m365/
├── components/MicrosoftSignInButton.vue, MicrosoftConnectionForm.vue (+ .test.ts)
└── types.ts                               # MicrosoftSharedProps
tests/Feature/Microsoft365/*Test.php, tests/Unit/Microsoft365/*Test.php   (NOT tests/Unit/M365, see Pitfall 11)
```

### Pattern 1: Per-request provider, behind an interface

**What:** `SocialiteMicrosoftGateway` constructs the driver itself each call; nothing is cached on the container, so no state can leak between users or requests (D-11). Bind it with `bind()` (not `singleton`/`scoped`), keep no static or instance state.

**Why this and not the facade:** Verified in source this session:
- The Manager's `ServiceProvider::boot()` runs `$this->app->booted(function () { event(app(SocialiteWasCalled::class)); });`, so `extendSocialite()` resolves the Socialite manager **at worker boot** [VERIFIED: SocialiteProviders/Manager 4.10.0 `src/ServiceProvider.php`; `SocialiteWasCalled::extendSocialite` calls `$this->app->make(SocialiteFactory::class)`]. In Octane that manager (and its driver cache) is shared by every request on the worker.
- `Laravel\Socialite\Two\AbstractProvider::user()` begins `if ($this->user) { return $this->user; }` and the SocialiteProviders override does the same, so a reused driver would return the **previous** user without checking state [VERIFIED: socialite v5.31.0 `src/Two/AbstractProvider.php:230-234`; Manager 4.10.0 `src/OAuth2/AbstractProvider.php`]. The Microsoft driver also caches `private ?\stdClass $claims = null` in `getClaims()` [VERIFIED: Providers master `src/Microsoft/Provider.php`].
- Octane v2.20.0 mitigates this: its default `RequestReceived` listeners include `PrepareSocialiteForNextOperation`, which calls `$factory->forgetDrivers(); $factory->setContainer($event->sandbox);` and this repo spreads the defaults: `...Octane::prepareApplicationForNextOperation(),` [VERIFIED: config/octane.php:76; Octane v2.20.0 `src/Listeners/PrepareSocialiteForNextOperation.php`]. So the facade is survivable, but only through a vendor-side listener this repo does not control. A fresh instance per request removes the dependency.
- `Socialite::fake()` returns a plain `Two\User` (Laravel docs, Testing section) with no `getClaims()`, so `tid`, `aud` and `userType` could not be exercised. A fork interface with a fake DTO can.

```php
// Illustrative skeleton. Values (scopes, endpoints) come from the verified sources above.
final class SocialiteMicrosoftGateway implements MicrosoftOAuthGateway
{
    private const array SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read']; // D-09

    public function __construct(private readonly MicrosoftConfig $config) {}

    private function provider(Request $request): Provider
    {
        $redirect = $this->config->redirectUri();           // APP_URL + path, or explicit override
        $provider = new Provider($request, $this->config->clientId(), $this->config->clientSecret(), $redirect,
            ['timeout' => 10, 'connect_timeout' => 5]);       // Guzzle options: no hung workers
        $provider->setConfig(new Config($this->config->clientId(), $this->config->clientSecret(), $redirect, [
            'tenant' => $this->config->tenantId(),            // never 'common'
            'fields' => ['userType'],                          // extra Graph /me $select
        ]));

        return $provider->enablePKCE()->setScopes(self::SCOPES);   // never ->stateless()
    }
    // redirect(): return $this->provider($request)->redirect();
    // authenticate(): $p = $this->provider($request); $u = $p->user(); $c = $p->getClaims(); -> MicrosoftIdentity
}
```

`ConfigTrait::setConfig` copies `client_id`, `client_secret`, `redirect` onto the provider and `getConfig('tenant')` feeds the authorize/token/JWKS URLs [VERIFIED: Manager 4.10.0 `ConfigTrait.php`; Provider `getAuthUrl`/`getTokenUrl`]. PKCE: `enablePKCE()` makes `getTokenFields()` add `code_verifier` pulled from the session, and the Microsoft driver's `getTokenFields` calls `parent::` [VERIFIED: socialite `AbstractProvider.php:336-338`; Provider `getTokenFields`]. Build the redirect and callback providers with the same factory so both have PKCE on.

### Pattern 2: A pure guard before any database work

Order (fail closed, cheapest first): (1) callback `error` param -> fixed message (never echo `error_description`); (2) `provider->user()` inside `try/catch` mapping `InvalidStateException` and Guzzle `ClientException`; (3) assert `claims->tid` equals configured tenant (case-insensitive) and `claims->aud` **equals** the client id (the driver only does `str_contains` on `aud` [VERIFIED: Provider `validate()`]); (4) `oid` present, GUID-shaped, equal to Graph `id`; (5) reject unless `userType === 'Member'` and the UPN has no `#EXT#`; if the optional `acct` claim is present and equals `1`, reject (it is not emitted by default, see Assumptions); (6) the address used for the account (`mail` else UPN, lower-cased) must have its domain in `config('microsoft365.allowed_domains')`.

Graph `userType`: the Phase 1 harness requests `$select=id,displayName,givenName,surname,mail,userPrincipalName,userType,preferredLanguage` and recorded `userType Member` for both test users [VERIFIED: tests/Tools/m365-spike/capture.mjs:47; docs/m365/RUNBOOK-entra-app.md:55-57 "userType Member"]. The driver's `fields` config key adds extra `$select` fields to `/me` [VERIFIED: Provider `additionalConfigKeys` `fields`, `getUserByToken`].

Email source: `mail` can be null (no mailbox, D-08); fall back to `userPrincipalName`. Claims `email`/`preferred_username` are mutable and must not drive authorization [CITED: learn.microsoft.com/entra/identity-platform/id-token-claims-reference] ("Never use it for authorization or to save data for a user").

### Pattern 3: Resolve in one transaction, keyed on `(tenant_id, microsoft_oid)`

```
DB::transaction:
  SELECT pg_advisory_xact_lock(hashtext('microsoft:{tid}:{oid}'))   // serialises same-identity logins
  1. account = MicrosoftAccount (tenant_id, microsoft_oid) FOR UPDATE      -> user (returning)         [AUTH-05]
  2. else candidates = users WHERE is_placeholder = false AND lower(email) IN (lower(mail), lower(upn) that pass the allowlist)
        0 users -> step 3
        >1 users -> refuse (ambiguous)
        1 user:  email_verified_at IS NULL -> refuse with "unverified account exists" (D-03)
                 user already has an account row (another oid)             -> refuse (already linked)
                 else create account row -> link                                                      [AUTH-04]
  3. provision (only if organization configured AND found, else refuse, D-05):                        [AUTH-03]
        user = new User { name, email = lower(mail ?? upn), password = null, email_verified_at = now(),
                          timezone = validated browser tz ?? config default }   (week_start/flags use model defaults)
        MemberService::addMember(user, org, Role::Employee, asSuperAdmin: true)   // sets current_team_id, merges same-email placeholders
        account row
  store tokens (encrypted) + scopes + expiry + last_login_at (skip tokens if disconnected_at is set)
catch UniqueConstraintViolationException -> retry the whole transaction once (winner's row now exists)
```

Facts this relies on, all read this session:
- `UserService::createUser` hashes a mandatory password and creates a personal organization when there is no accepted invitation [VERIFIED: app/Service/UserService.php:44, 54-66], so it must not be used.
- `MemberService::addMember` associates user and organization, saves the role, sets `current_team_id` on the user, and calls `mergePlaceholderMembersIntoExistingMember`, which matches placeholders by `where('email', '=', $user->email)` (case-sensitive), so lower-case the email before provisioning [VERIFIED: app/Service/MemberService.php:37-81]. With `asSuperAdmin: true` it skips `MemberAdding`/`MemberAdded`.
- Role value: `case Employee = 'employee';` [VERIFIED: app/Enums/Role.php:16].
- `users.password` is nullable and `users_email_unique` is partial and case-sensitive: `CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email) WHERE (is_placeholder = false);` [VERIFIED: database/schema/pgsql_test-schema.sql:486, 934]. All stored emails are lower-case (migration `2026_05_21_000002_lowercase_user_emails`), so compare with `lower(email)`.
- `User` mass-assignment is unguarded (`Model::unguard()` in AppServiceProvider) and in non-production `preventLazyLoading`, `preventSilentlyDiscardingAttributes`, `preventAccessingMissingAttributes` are on [VERIFIED: app/Providers/AppServiceProvider.php:63-65 `Model::preventLazyLoading(! $this->app->isProduction());` ... and :79 `Model::unguard();`], so tests will fail loudly on lazy loads and on attributes that are not columns.
- `Hash::check($plain, null)` returns false everywhere, so password login for a passwordless user fails cleanly (`if (is_null($hashedValue) || (string) $hashedValue === '') { return false; }`) [VERIFIED: laravel/framework v13.33.0 `Hashing/BcryptHasher.php`, `EloquentUserProvider::validateCredentials`].

### Pattern 4: Seams into core without editing hot files

- **Provider registration:** one entry in `config/app.php` `providers` (list starts at line 235; add `use` + `Microsoft365ServiceProvider::class`). No `bootstrap/providers.php` exists in this repo [VERIFIED: config/app.php:235-251]. `laravel/socialite` and `socialiteproviders/manager` are auto-discovered (the Manager declares `extra.laravel.providers`) [VERIFIED: Manager 4.10.0 composer.json]. With Pattern 1 neither a `dont-discover` entry nor `SocialiteWasCalled` is needed, because nothing resolves the Socialite factory.
- **Routes:** `Route::middleware('web')->group(__DIR__.'/../routes/microsoft365.php')` inside the provider (`loadRoutesFrom` alone would not wrap the `web` group). Register **always**, gated by `EnsureMicrosoftIsEnabled` (404 when unconfigured), so tests can flip config with `Config::set` after boot. `RouteServiceProvider` wraps only `routes/web.php` in `web` [VERIFIED: app/Providers/RouteServiceProvider.php]. Use controller classes, not closures: the container start script runs `php artisan optimize` (route cache) [VERIFIED: docker/prod/deployment/start-container:17-18].
- **Shared Inertia prop:** a middleware pushed with `$router->pushMiddlewareToGroup('web', ShareMicrosoftInertiaData::class)` in the provider `boot()`. Do **not** call `Inertia::share()` from `boot()`: Octane's `PrepareInertiaForNextOperation` calls `$factory->flushShared()` each request [VERIFIED: Octane v2.20.0 `src/Listeners/PrepareInertiaForNextOperation.php`], which is why core shares data inside middleware (`ShareInertiaData`, `HandleInertiaRequests`) [VERIFIED: app/Http/Kernel.php:73-74]. Alternative with the same effect: an `Event::listen(RouteMatched::class, ...)` that calls `Inertia::share`.
  - Payload (booleans, URLs, labels; never tokens): `microsoft: { enabled, login_url, labels, account }` where `account` is computed only when `$request->routeIs('profile.show')` and a user is present, so no extra query on other pages. `profile.show` is `Route::get('/user/profile', [UserProfileController::class, 'show'])->name('profile.show');` [VERIFIED: routes/web.php:110]; the login view is `Fortify::loginView(...Inertia::render('Auth/Login', ...))` [VERIFIED: app/Providers/FortifyServiceProvider.php:55-60].
- **Login page:** `Login.vue` gets one import and one element after `</form>`: `<MicrosoftSignInButton />`. Error text already renders from `page.props.flash.message` (red box) [VERIFIED: resources/js/Pages/Auth/Login.vue], fed by `'message' => fn () => $request->session()->get('message')` [VERIFIED: app/Http/Middleware/HandleInertiaRequests.php], so failures use `redirect()->route('login')->with('message', __('microsoft365.<key>'))`.
- **Profile page:** `Profile/Show.vue` gets one import and `<MicrosoftConnectionForm />` + `<SectionBorder />` (the page is a flat list of sections) [VERIFIED: resources/js/Pages/Profile/Show.vue].
- **Button must be a full-page navigation:** use `<a :href>` (or `window.location.href`), never Inertia `<Link>`; the XHR would fail on the cross-origin redirect.

### Pattern 5: Passwordless user semantics (verified)

- **Session auth:** `AuthenticateSession` returns early for users without a password: `if (! $request->hasSession() || ! $request->user() || ! $request->user()->getAuthPassword()) { return $next($request); }` [VERIFIED: laravel/framework v13.33.0 `Session/Middleware/AuthenticateSession.php:47`]. `routes/web.php:35-37` applies `auth:web`, `auth.session`, `verified`, so passwordless users are not logged out.
- **Remember-me does not work for them:** `userFromRecaller` ends with `if (! is_string($userPassword)) { return; }` [VERIFIED: laravel/framework v13.33.0 `Auth/SessionGuard.php:236`], and `queueRecallerCookie` hashes `getAuthPassword()` (null would be passed to `hash_hmac`). Use `remember: $user->getAuthPassword() !== null`. Passwordless sessions last `SESSION_LIFETIME` (sliding, default `env('SESSION_LIFETIME', 120)`) [VERIFIED: config/session.php:35]; consider a larger value in Dokploy (Open Question 3).
- **Session fixation:** `SessionGuard::login()` calls `updateSession()` which does `$this->session->regenerate(true)` [VERIFIED: SessionGuard.php:604-609], so an extra `regenerate()` is unnecessary.
- **Pages that need a password and therefore do not work for passwordless users** (document, do not fix in this phase): Update Password requires `current_password:web` (UpdateUserPassword.php); Delete Account (`UserDestroyRequest` does `Hash::check($password, (string) $user->password)`); Logout other browser sessions (`ConfirmPassword`); enabling TOTP (`confirmPassword: true` in `config/fortify.php`). The supported way to obtain a password is "Forgot password" by email: `ResetUserPassword` does not ask for the current password [VERIFIED: app/Actions/Fortify/ResetUserPassword.php]. Account deletion by the user is blocked for passwordless users (SEC-03 in Phase 7 should decide); an admin can still delete.
- **Disconnect policy (recommended, answers D-10):** uniform and lock-out-proof. `DELETE /user/microsoft` nulls `access_token`, `refresh_token`, `access_token_expires_at`, `scopes` and sets `disconnected_at = now()`; the identity row `(tenant_id, microsoft_oid, user_id)` stays, so Microsoft sign-in keeps working and no user can lock themselves out or get a duplicate account after a UPN rename. While `disconnected_at` is set, later Microsoft sign-ins authenticate but do **not** store tokens; an explicit "Connect Microsoft" action (`/auth/microsoft/redirect?intent=connect`, requires an authenticated session) clears it. Passwordless users get an informational line in the confirmation dialog; no blocking is needed. Rejected alternative: deleting the row for password users (second code path, re-link-by-email surprise, fails if the Entra UPN changed).

### Anti-Patterns to Avoid

- **`Inertia::share()` in the provider `boot()`:** vanishes under Octane after the first request.
- **Facade `Socialite::driver('microsoft')` cached across requests / `->stateless()`:** state bypass and identity leak risk (see Pattern 1).
- **Matching users by `email`/`preferred_username` after the first link, or copying `email_verified`:** set `email_verified_at = now()` only because the tenant check passed (PITFALLS #1).
- **Logging exception text from the Socialite flow:** `validate()` rethrows `InvalidStateException("Error on validating id_token. {$e}")` with the full exception string [VERIFIED: Provider `validate()`], which can embed token-derived text; log only a fixed reason plus the `AADSTS\d+` code.
- **Putting the fork config under `app/Microsoft365/config/`:** Larastan flags `env()` anywhere except `config_path()` [VERIFIED: larastan 3.x `NoEnvCallsOutsideOfConfigRule`: `$this->configDirectories = [config_path()]`].
- **Precomputing `enabled` inside the config file:** tests that `Config::set()` the id/secret would not flip it; compute in `MicrosoftConfig::isConfigured()`.
- **Making `MicrosoftAccount` `Auditable`:** audits would capture token attributes, and `Relation::enforceMorphMap` in `AppServiceProvider` would then demand a hot-file edit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State + PKCE + code exchange | Own authorize/token HTTP code | `Provider` (Socialite) with `enablePKCE()` | State pulled with `hash_equals`, S256 verifier from session, single use |
| id_token signature/JWKS/`iss`/`exp` | `firebase/php-jwt` calls | `Provider::getClaims()` | Already handles JWKS caching and key-rotation retry |
| Token encryption | Own AES wrapper | Eloquent `encrypted` cast | `APP_KEY`-based, MAC-protected |
| Exactly-once identity creation | Application-level "check then insert" | Unique index + `pg_advisory_xact_lock` + retry | Races are decided by the database |
| Org join + placeholder merge | Raw `Member::create` | `MemberService::addMember` | Sets current org, merges imported placeholder history |
| Timezone validation | Regex | `TimezoneService::isValid` / `mapLegacyTimezone` | Same rules as registration |
| Session login | Manual session writes | `Auth::guard('web')->login()` | Regenerates session id, fires `Login` event |
| Microsoft logo/button | Custom mark | Official four-square logo + text "Sign in with Microsoft" | Branding rules below |

**Key insight:** every dangerous step here (identity, tenant, state) already has a tested primitive; the fork's job is the gates around it and the exactly-once persistence.

## Common Pitfalls

### Pitfall 1: Shared Socialite driver returns the previous user (Octane)
**What goes wrong:** the second login on a worker authenticates as the first user. **Why:** driver cached in a manager resolved at boot; `user()` returns the cached `$this->user` before checking state (Pattern 1). **Avoid:** build the provider per request; two-requests-one-process test. **Warning signs:** same `oid` logged for two different Entra users.

### Pitfall 2: Login button disappears after the first request in production
**What goes wrong:** works under `php artisan serve` and the first request, then `microsoft` prop is missing. **Why:** Octane flushes Inertia shared props. **Avoid:** middleware-based sharing; a Feature test that issues two consecutive `GET /login` requests and asserts the prop both times.

### Pitfall 3: Empty-string env values count as "configured"
**What goes wrong:** Dokploy compose `environment: X: ${X}` passes `X=""` when the variable is not set in the Environment tab, and `env('X')` returns `''`, not `null`. **Avoid:** `MicrosoftConfig::isConfigured()` uses `filled()`/`trim() !== ''` for client id, secret, tenant (and validates tenant as a GUID); organization id empty means "provisioning off" (D-05). Use `${VAR:-default}` only for the allowlist.

### Pitfall 4: Redirect URI built from the request instead of `APP_URL`
**What goes wrong:** `AADSTS50011` behind Traefik when scheme or host is wrong. **Avoid:** derive `redirect_uri` as `rtrim(config('app.url'), '/').route('microsoft.callback', [], false)` with an optional full override env. `TrustHosts` already rejects hosts outside `APP_URL` [VERIFIED: app/Http/Middleware/TrustHosts.php docblock "Host-header poisoning of generated URLs (password reset, SSO callback, invitations)"]. Registered URIs: `https://time.untangle.es/auth/microsoft/callback`, `https://solidtime.test/auth/microsoft/callback`, `http://localhost/auth/microsoft/callback` [VERIFIED: docs/m365/RUNBOOK-entra-app.md:18]. `APP_FORCE_HTTPS=true` also makes the session cookie `Secure` (`'secure' => env('SESSION_SECURE_COOKIE', env('APP_FORCE_HTTPS'))`, config/session.php:172) and `SameSite=lax` (line 202) is correct for Entra's top-level GET return.

### Pitfall 5: Logging or flashing raw provider errors
**Avoid:** map every failure to a fixed `lang` key; log `reason`, `AADSTS` code, `tid`, `oid`; never `$e->getMessage()`, never `accessTokenResponseBody` (contains id_token and refresh token), never emails.

### Pitfall 6: First production sign-in fails with AADSTS7000215
**What:** the production secret was only length-checked, never used [VERIFIED: docs/m365/RUNBOOK-entra-app.md:59]. **Avoid:** catch Guzzle `ClientException` at the token step, parse `AADSTS\d+` from the body, log at `error` level with the code, show the generic message; runbook step "AADSTS7000215 -> create new secret".

### Pitfall 7: Bootstrap deadlock (nobody can create the Untangle org)
**What:** `APP_ENABLE_REGISTRATION` defaults to `off` [VERIFIED: config/app.php:103] and an unverified password account is never linked (D-03). **Avoid:** document the sequence: enable registration temporarily, register the owner, verify the email (mail link, or `UPDATE users SET email_verified_at = now() WHERE email = '<owner>'` through a DB shell if outbound mail is not working), read the org id from `/organizations/{id}` (route `organizations.show`, routes/web.php:103), set the org env var, switch registration back to `off`, redeploy.

### Pitfall 8: Two Entra identities map to one solidtime user (or one identity to two users)
**Avoid:** `unique(user_id)` and `unique(tenant_id, microsoft_oid)`; a candidate query that can return more than one user refuses; a user that already has an account row with a different oid refuses linking.

### Pitfall 9: Ghost "connected" state after disconnect
**Avoid:** "connected" means `refresh_token IS NOT NULL AND disconnected_at IS NULL`; login does not re-store tokens while `disconnected_at` is set.

### Pitfall 10: Docs gates from Phase 1 silently broken
`node tests/Tools/m365-spike/validate-docs.mjs runbook` fails on **unknown rows** in the runbook values table and `secrets` rejects GUIDs and non-`example.test` emails under `docs/m365/` and `tests/Unit/M365/` [VERIFIED: validate-docs.mjs `RUNBOOK_KEYS`, `PHASE_PREFIXES`, `isAllowedGuid`; both pass today: "runbook: OK (30 checks)", "secrets: OK (1818 checks)"]. **Avoid:** add Phase 2 runbook content only to `## Verificación` / `## Historial`, put new deployment text in a new file with placeholders (`<ORGANIZATION-UUID>`), keep Phase 2 tests out of `tests/Unit/M365/`, and run both gates before committing docs.

### Pitfall 11: Remember-me and long sessions for passwordless users
See Pattern 5. Expect re-login after `SESSION_LIFETIME` idle minutes; not a bug.

### Pitfall 12: `config:cache` and `route:cache` at container start
`php artisan optimize` runs on every container start [VERIFIED: docker/prod/deployment/start-container:17-18]. `env()` outside config returns null once cached; after changing Dokploy env, **redeploy** (restart) so Octane workers and caches pick it up.

## Code Examples

### Migration (repo style: uuid PK, explicit FKs, `Schema::create` with `Blueprint $table): void`)

```php
// Source: pattern from database/migrations/2026_09_02_000001_create_goals_table.php (read this session)
Schema::create('microsoft_accounts', function (Blueprint $table): void {
    $table->uuid('id')->primary();
    $table->uuid('user_id')->unique();
    $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete()->cascadeOnUpdate();
    $table->string('tenant_id', 36);
    $table->string('microsoft_oid', 36);
    $table->unique(['tenant_id', 'microsoft_oid']);
    $table->string('microsoft_email')->nullable();
    $table->text('access_token')->nullable();      // encrypted cast; ciphertext > 255 chars
    $table->text('refresh_token')->nullable();     // encrypted cast
    $table->timestampTz('access_token_expires_at')->nullable();
    $table->jsonb('scopes')->nullable();
    $table->timestampTz('disconnected_at')->nullable();
    $table->timestampTz('last_login_at')->nullable();
    $table->timestamps();
});
```
Place it in `app/Microsoft365/database/migrations/` and load with `loadMigrationsFrom`; tests run it on top of the schema dump (`RefreshDatabase`), and `AUTO_DB_MIGRATE: "true"` runs it in production [VERIFIED: docs/deploy/dokploy-compose.fork.yml `AUTO_DB_MIGRATE: "true"`].

### Model

```php
// Not Auditable, hidden tokens, encrypted casts. Phase 3 adds needs_reauth later.
class MicrosoftAccount extends Model
{
    use HasUuids; // App\Models\Concerns\HasUuids
    protected $hidden = ['access_token', 'refresh_token'];
    protected $casts = [
        'access_token' => 'encrypted',
        'refresh_token' => 'encrypted',
        'access_token_expires_at' => 'datetime',
        'scopes' => 'array',
        'disconnected_at' => 'datetime',
        'last_login_at' => 'datetime',
    ];
}
```

### Callback tail (login, intended URL)

```php
// Source: Fortify responses in this repo use session()->pull('url.intended', route('dashboard', [], false))
// (app/Extensions/Fortify/CustomLoginResponse.php). A plain redirect is right here (full-page GET).
Auth::guard('web')->login($user, remember: $user->getAuthPassword() !== null);
return redirect(session()->pull('url.intended', route('dashboard', [], false)));
```

### Config (`config/microsoft365.php`)

```php
// env() only here. Names follow the Doppler keys 1:1 (RUNBOOK:69-72), so values copy without renaming.
return [
    'client_id' => env('SOLIDTIME_MICROSOFT_CLIENT_ID'),
    'client_secret' => env('SOLIDTIME_MICROSOFT_CLIENT_SECRET'),
    'tenant_id' => env('SOLIDTIME_MICROSOFT_TENANT_ID'),
    'redirect_uri' => env('SOLIDTIME_MICROSOFT_REDIRECT_URI'),            // optional full override
    'organization_id' => env('SOLIDTIME_MICROSOFT_ORGANIZATION_ID'),
    'allowed_domains' => array_values(array_filter(array_map(
        fn (string $d): string => strtolower(trim($d)),
        explode(',', (string) env('SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS', 'untanglegrowth.com,untangle.es'))
    ))),
    'default_timezone' => env('SOLIDTIME_MICROSOFT_DEFAULT_TIMEZONE', 'Europe/Madrid'),
];
```

### Compose additions (`app` service `environment:`; queue/scheduler get them in Phase 3 when jobs need them)

```yaml
      SOLIDTIME_MICROSOFT_CLIENT_ID: ${SOLIDTIME_MICROSOFT_CLIENT_ID}
      SOLIDTIME_MICROSOFT_CLIENT_SECRET: ${SOLIDTIME_MICROSOFT_CLIENT_SECRET}
      SOLIDTIME_MICROSOFT_TENANT_ID: ${SOLIDTIME_MICROSOFT_TENANT_ID}
      SOLIDTIME_MICROSOFT_ORGANIZATION_ID: ${SOLIDTIME_MICROSOFT_ORGANIZATION_ID}
      SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS: ${SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS:-untanglegrowth.com,untangle.es}
```
Dokploy writes the Environment tab to a `.env` next to the compose file, and variables are **not** injected into containers unless the compose lists them under `environment:` (or uses `env_file`) [CITED: docs.dokploy.com/docs/core/docker-compose]; this repo's compose already uses explicit `${VAR}` lists [VERIFIED: docs/deploy/dokploy-compose.fork.yml].

### Deployment values (Dokploy env, names only)

| Variable | Value / source |
|----------|----------------|
| `APP_URL` | `https://time.untangle.es` (exact public URL; redirect URI base) |
| `APP_FORCE_HTTPS` | `true` (secure cookies, https URLs) [VERIFIED: config/app.php:101] |
| `TRUSTED_PROXIES` | Traefik/Docker network CIDR (client IP for throttling). Not needed for the redirect URI. `config/trustedproxy.php` reads it as a comma list [VERIFIED: config/trustedproxy.php] |
| `SOLIDTIME_MICROSOFT_CLIENT_ID`, `..._TENANT_ID` | Doppler `vps/prd` (RUNBOOK:71-72) |
| `SOLIDTIME_MICROSOFT_CLIENT_SECRET` | Doppler `vps/prd` (RUNBOOK:69) |
| `SOLIDTIME_MICROSOFT_ORGANIZATION_ID` | empty until the owner's org exists (bootstrap) |
| `APP_ENABLE_REGISTRATION` | `on` only during bootstrap, then `off` |

Doppler to Dokploy: copy manually. The three Microsoft values are static (the secret rotates every 24 months, RUNBOOK:22) and Dokploy documents no secrets-manager sync [CITED: docs.dokploy.com/docs/core/docker-compose "doesn't mention secrets providers or an API"]. Use the Doppler dashboard or `doppler secrets get <NAME> -p vps -c prd --plain`, paste into the compose Environment tab, redeploy. Never write values into git.

### `m365:check` (recommended, small)
Artisan command printing: configured yes/no (no secret values), effective redirect URI and a warning if not `https` outside local, allowed domains, whether the organization id resolves to a row, `APP_FORCE_HTTPS`, count of linked accounts. Run inside the container after deploy; also used by the owner for the first-production-sign-in checklist.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Register SocialiteProviders in `bootstrap/providers.php` + `Event::listen` (usage guide, Laravel 11+) | Not needed when the provider class is instantiated directly | n/a | This repo has no `bootstrap/providers.php`; avoids the registration question |
| Per-driver `Socialite::driver()` calls under Octane | Octane >= listed version resets Socialite drivers per request (`PrepareSocialiteForNextOperation`) | present in Octane v2.20.0 | Defence in depth, still prefer a fresh instance |
| PKCE only for public clients | Microsoft recommends `code_challenge` for **all** app types | current docs | Enable PKCE on this confidential client [CITED: learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow] |

**Deprecated/outdated:** `Inertia::share` from `boot()` under Octane; `microsoft-azure` driver for sign-in (no id_token validation).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Dokploy has no native Doppler integration (web search found none; docs fetched mention none) | Deployment values | Low: manual copy still works; an integration would only save effort |
| A2 | `TRUSTED_PROXIES` for the Traefik network is a Docker CIDR such as `172.16.0.0/12`; exact value unknown | Deployment values | Wrong value only degrades client-IP throttling and logs; redirect URI is unaffected |
| A3 | The desktop app and browser extension open the web login in a browser where Entra sign-in works (system browser vs embedded webview not verified) | Validation / UAT | If the desktop app uses an embedded webview with restrictions, Microsoft-only users could not authorize it: manual UAT decides |
| A4 | `acct` is not emitted in id_tokens unless configured as an optional claim (it is absent from the default claim table fetched) | Pattern 2 | Low: Graph `userType` + `#EXT#` + domain allowlist already cover guests |
| A5 | Combining `mail` and UPN as email candidates (both domain-gated, ambiguous result refused) is the right matching rule | Pattern 3 | Medium: owner may prefer UPN-only; changes only the candidate query |
| A6 | `MemberService::addMember(..., asSuperAdmin: true)` (skipping `MemberAdding`/`MemberAdded`) is acceptable for an internal org without Billing extension | Pattern 3 | Low now; revisit if an extension listens to those events |
| A7 | Doppler CLI flags `secrets get <NAME> -p vps -c prd --plain` | Deployment values | Low: dashboard copy works regardless |
| A8 | Spanish copy wording (table below) | UI copy | Low: owner confirms wording |
| A9 | Entra Security Defaults (MFA) remain enabled, so skipping Fortify TOTP is safe; the app does not verify an `amr`/MFA claim | Security Domain | Medium: if Security Defaults are disabled later, Microsoft sign-ins would skip any 2FA |
| A10 | Prod outbound mail works so the owner can verify the bootstrap account by email; otherwise use the SQL fallback | Pitfall 7 | Medium: bootstrap blocked without either path |

## Open Questions

1. **UI language.** solidtime ships only English: `lang/` contains `en/` only and `config/app.php:131` hard-codes `'locale' => 'en'` [VERIFIED]; the Vue app has no i18n (no i18n package in `package.json`, all copy hard-coded in English). Recommendation: put every new string in `lang/en/microsoft365.php` (D-16) and pass the Vue copy as a `labels` prop built from `trans()`, so no copy is hard-coded; ship `lang/es/microsoft365.php` from the table below but keep the app locale `en` unless the owner wants Spanish everywhere (that is a core `config/app.php` change, not part of this phase).
2. **Env prefix.** Recommendation: use `SOLIDTIME_MICROSOFT_*` for all variables (matches Doppler 1:1, D-12 names). D-05 wrote `MICROSOFT_ORGANIZATION_ID` as "e.g."; confirm.
3. **Session lifetime for passwordless users.** No remember-me for them (Pattern 5). Recommend the owner sets `SESSION_LIFETIME` (minutes, e.g. 10080) in Dokploy; default is 120.
4. **"Connect Microsoft" button in the profile.** D-17 lists only Disconnect. Recommend including Connect (same OAuth route, `intent=connect`): needed to re-enable after a disconnect and reused by Phase 3's "Reconnect Microsoft". Small; confirm scope.
5. **Admin unlink path** for a wrong/renamed Entra identity (no UI in this phase): document a tinker/SQL snippet in the runbook (`DELETE FROM microsoft_accounts WHERE user_id = ...`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PHP / Composer on host | `composer require`, lock, Pint, PHPStan | no (system) | — | Portable PHP 8.3.36 NTS + Composer 2.10.3 downloaded into the scratchpad this session; php.net manifest SHA-256 `3c9242622c7402b47c38d2ec2ed779cef3a290fd6f2bde6c35f9c482699e7900` matched; extensions loaded: openssl, mbstring, curl, zip, intl, gd, exif, fileinfo, pdo_pgsql, pgsql, sodium |
| Node.js | Vitest, lint, Prettier, type-check, docs gates | yes | v24.13.1 (CI uses 20.x) | — |
| `node_modules` | npm scripts | yes (369 entries) | — | `npm ci` |
| `vendor/` | `vue-tsc` (imports `vendor/tightenco/ziggy`), PHPStan, Pint | no | — | `composer install --ignore-platform-reqs` with the portable PHP |
| PostgreSQL | PHPUnit | no (no Docker) | — | CI only (phpunit.yml, PG 15/16/17 matrix); optional portable PostgreSQL for local runs |
| GitHub CLI `gh` | trigger/inspect CI | yes, authenticated as `untangle-juan` | — | — |
| Doppler CLI | read prod secret names/values | not on this shell's PATH | — | Doppler dashboard |
| CI | all PHP verification | yes | push-triggered: phpunit, phpstan, pint, npm-*, playwright | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** PHP/Composer/vendor (portable toolchain, treat as an environment step needing owner awareness: it downloads and runs a third-party binary; verify the SHA-256 above before extracting and run it from outside the repo), PostgreSQL (CI), Doppler CLI (dashboard).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | PHPUnit 12 (`php artisan test`), Vitest 4 + happy-dom, Playwright 1.60 |
| Config file | `phpunit.xml` (env: `pgsql_test`, `SESSION_DRIVER=array`, `CACHE_DRIVER=array`, `QUEUE_CONNECTION=sync`, `TRUSTED_PROXIES=0.0.0.0/0,...`), `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `php artisan test --filter Microsoft365` (CI) / `npx vitest run resources/js/m365` (local) |
| Full suite command | `php artisan test --stop-on-failure` (CI, PG matrix) + `npm run test:unit` + `npm run type-check` + `npm run lint` + `npm run format:check` |
| Local PHP gates (portable toolchain) | `php vendor/bin/pint --test`, `composer analyse` (PHPStan level 7), `php -l` on new files |

Base classes: `Tests\TestCaseWithDatabase` (RefreshDatabase) and `Tests\TestCase`; `Http::preventStrayRequests()`, `Mail::fake()`, `LogFake::bind()` are set globally [VERIFIED: tests/TestCase.php]. Socialite's own Guzzle client is **not** the Laravel `Http` facade, so `preventStrayRequests()` does not protect it: tests must never call the real provider's `user()`; use the fake gateway, or the Guzzle `MockHandler`/handler-closure contract test below.

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | `GET /login` exposes `microsoft.enabled` true when configured, false/absent otherwise; consecutive requests both carry it (Octane flush guard) | Feature | `php artisan test --filter MicrosoftLoginPageTest` | no, Wave 0 |
| AUTH-01 | `GET /auth/microsoft/redirect` 302 to `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize` with `client_id`, exact `redirect_uri`, scope string, `code_challenge_method=S256`, `state` (real provider, no network) | Feature | `--filter MicrosoftRedirectTest` | no |
| AUTH-01 | Existing password login still works (existing `AuthenticationTest`, `PasswordResetTest`, `TwoFactorAuthenticationSettingsTest` stay green) | Feature | `php artisan test --filter AuthenticationTest` | yes |
| AUTH-02 | wrong `tid`, `aud` mismatch, `userType=Guest`, `#EXT#` UPN, domain outside allowlist -> redirected to `/login` with flash `message`, guest, no user/account created; case-insensitive domain; `mail` null + UPN fallback passes (F1) | Feature | `--filter MicrosoftSignInRejectionTest` | no |
| AUTH-03 | Provision: `email_verified_at` set, `password` null, Member role `employee` in configured org, `current_team_id` = org, no new personal org, timezone from valid browser param else default, works with `APP_ENABLE_REGISTRATION=off` and `invite-only`; org unset/not found -> refused, no user | Feature | `--filter MicrosoftProvisioningTest` | no |
| AUTH-04 | Link existing verified user (mixed-case email); unverified -> refused, no row; placeholder same email -> not logged into, new user provisioned and placeholder merged; two candidates -> refused; user already linked to another oid -> refused | Feature | `--filter MicrosoftLinkingTest` | no |
| AUTH-05 | Returning identity matched by `(tid, oid)` after email change; unique-index violation test; retry path creates exactly one user; two sequential callbacks for different identities in one process give two distinct users/sessions | Feature/Unit | `--filter MicrosoftIdentityResolverTest` | no |
| AUTH-06 | User with confirmed TOTP logs in via Microsoft with no `two-factor.login` redirect; passwordless user can load `/dashboard` and `/user/profile` (not bounced by `auth.session`); `remember` cookie not queued for passwordless | Feature | `--filter MicrosoftSessionTest` | no |
| AUTH-06 | `url.intended` pointing at `/oauth/authorize?...` is resumed after callback (desktop/extension flow) | Feature | `--filter MicrosoftSessionTest` | no |
| AUTH-07 | Profile props: connected/not, email, no token strings anywhere in the response body; disconnect nulls tokens, sets `disconnected_at`, keeps identity row, time entry count unchanged; login while disconnected does not store tokens; connect (`intent=connect`) clears it; unauthenticated disconnect -> login redirect | Feature | `--filter MicrosoftAccountTest` | no |
| AUTH-07 | `MicrosoftConnectionForm.vue` renders connected/not-connected, confirm dialog, calls delete | Vitest | `npx vitest run resources/js/m365` | no |
| SEC-01 | Raw DB value != plaintext and decrypts; `toArray()/toJson()` hide tokens; model is not `AuditableContract`; audits table contains no token substring after provisioning; `users` has no token columns; session dump has no tokens; `LogFake` contexts contain no token substring; columns are `text` | Feature/Unit | `--filter MicrosoftTokenStorageTest` | no |
| OPS-01 | `MicrosoftConfig`: empty strings = unconfigured, GUID check, allowlist parsing, redirect URI from `APP_URL` (https) incl. override; `microsoft.enabled` middleware 404 when unconfigured; `m365:check` output has no secret values | Unit/Feature | `--filter MicrosoftConfigTest` | no |
| OPS-01 | Docs/compose: `node tests/Tools/m365-spike/validate-docs.mjs runbook` and `secrets` stay OK; compose lists all five variables under `app` | Node + grep | `node tests/Tools/m365-spike/validate-docs.mjs secrets` | yes |
| (contract) | Real `SocialiteMicrosoftGateway` against a Guzzle handler closure serving openid-config, JWKS (generated RSA key, `firebase/php-jwt` already locked), token and Graph `/me`: asserts `code_verifier` sent, `tenant` in URLs, claims mapped, `userType` selected | Unit | `--filter SocialiteMicrosoftGatewayTest` | no |
| (e2e) | Playwright: login page shows no Microsoft button when unconfigured; existing `e2e/auth.spec.ts`, `profile.spec.ts` unaffected | Playwright | `npx playwright test e2e/auth.spec.ts` (CI) | yes (existing) |

### Sampling Rate
- **Per task commit:** local Pint + `php -l` + PHPStan (portable toolchain), `npx vitest run resources/js/m365`, both docs gates; push to run PHPUnit in CI.
- **Per wave merge:** all CI workflows green on the pushed branch (`gh run list --branch feature/m365-integration`).
- **Phase gate:** CI green + manual UAT on `https://time.untangle.es` before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Portable PHP + Composer bootstrap (outside the repo), `composer install --ignore-platform-reqs`, then `composer require ... --no-scripts` to produce `composer.json`/`composer.lock` changes.
- [ ] `tests/Feature/Microsoft365/` and `tests/Unit/Microsoft365/` directories, a `FakeMicrosoftOAuthGateway` + `MicrosoftIdentity` test builder (use `00000000-0000-4000-8000-*` GUIDs and `@example.test` emails; set the allowlist to `example.test` in tests).
- [ ] `database/factories` helper for `MicrosoftAccount` (optional) and `User::factory()->unverified()` already exists [VERIFIED: UserFactory `unverified()`]; `->placeholder()` exists.
- [ ] Vitest component test setup: mock `@inertiajs/vue3` `usePage` (existing tests use `vi.mock`) and stub `route()`.

### Manual UAT checklist (human checkpoint, end of phase per `human_verify_mode: end-of-phase`)
1. Bootstrap sequence (Pitfall 7) on `https://time.untangle.es`; record the date of the first production sign-in in the runbook `## Historial` (D-12), including AADSTS7000215 outcome.
2. Second Untangle account signs in: provisioned as employee, no personal org, lands in the dashboard.
3. Guest or non-allowlisted account: clear message on the login page.
4. Password login, forgot-password, TOTP login unchanged.
5. Desktop app and browser extension: log out, start authorization from the app, sign in with Microsoft on the web login page, authorization screen appears and completes (Assumption A3).
6. Profile: status, Disconnect, Connect.

## Security Domain

`security_enforcement` is enabled in `.planning/config.json` (`"security_enforcement": true`, `"security_asvs_level": 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OIDC code flow + PKCE + state; id_token validated by the driver; tenant/`aud` asserted; Entra MFA via Security Defaults (RUNBOOK:26) |
| V3 Session Management | yes | `Auth::login` regenerates the session id; `SameSite=lax`; `Secure` cookie via `APP_FORCE_HTTPS`; throttle on redirect/callback |
| V4 Access Control | yes | Gate by tenant, user type, domain; lowest role (employee); org id from env, never from claims; disconnect route has no id parameter (acts on `auth()->user()` only) |
| V5 Input Validation | yes | Validate `?timezone` (`TimezoneService`), `?intent` (enum), callback `error`/`code`/`state`; never reflect provider error text |
| V6 Cryptography | yes | Eloquent `encrypted` cast (`APP_KEY`); no hand-rolled crypto; `APP_PREVIOUS_KEYS` if the key ever rotates |
| V7 Error handling & logging | yes | Fixed reasons only; no tokens, emails or exception text in logs |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| nOAuth / email-based account takeover | Spoofing | Key on `(tid, oid)`; email only for a one-time link to a verified non-placeholder user; domain allowlist |
| Pre-registration takeover (attacker registers victim email with a password) | Spoofing | Never link unverified accounts (D-03) |
| Guest/B2B user joins the org | Elevation of privilege | `userType === 'Member'`, `#EXT#` check, allowlist |
| Cross-tenant sign-in | Spoofing | Tenant-pinned authority + `tid` assert + `aud` equality |
| Login CSRF / code injection | Tampering | `state` (`hash_equals`, single-use) + PKCE S256; never `stateless()` |
| Octane identity leak between users | Information disclosure | Fresh provider per request; two-user-per-worker test |
| Token leakage (logs, audits, props, session, cache) | Information disclosure | `text` + `encrypted`, `$hidden`, not Auditable, no logging of provider payloads, props contain booleans/email only |
| Duplicate users on concurrent first sign-in | Tampering/Repudiation | Unique indexes + advisory lock + single retry |
| Open redirect through `intended` | Tampering | `url.intended` is set server-side by the guest redirect, never from a request parameter |
| Callback abuse / enumeration | DoS | `throttle` middleware on both routes; generic failure message |
| Host-header poisoning of the redirect URI | Tampering | Redirect built from `APP_URL`; `TrustHosts` already enforced |

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `app/Providers/FortifyServiceProvider.php`, `app/Actions/Fortify/*`, `app/Service/MemberService.php`, `app/Service/UserService.php`, `app/Service/DeletionService.php`, `app/Models/User.php`, `app/Http/Middleware/*` (Authenticate, ForceHttps, TrustProxies, TrustHosts, HandleInertiaRequests, ShareInertiaData, EnsureEmailIsVerified), `app/Http/Kernel.php`, `routes/web.php`, `config/{app,auth,fortify,octane,session,trustedproxy}.php`, `database/schema/pgsql_test-schema.sql`, `tests/*` base classes, `.github/workflows/*`, `docs/deploy/dokploy-compose.fork.yml`, `docs/m365/RUNBOOK-entra-app.md`, `docker/prod/deployment/start-container`, `resources/js/Pages/Auth/Login.vue`, `Profile/Show.vue` and partials, `tests/Tools/m365-spike/{capture,validate-docs}.mjs`.
- laravel/socialite v5.31.0 `src/Two/AbstractProvider.php`, `src/SocialiteManager.php`, `src/SocialiteServiceProvider.php` (raw.githubusercontent.com).
- SocialiteProviders Manager 4.10.0 (`ServiceProvider`, `SocialiteWasCalled`, `ConfigTrait`, `Config`, `OAuth2/AbstractProvider`, composer.json) and Providers master `src/Microsoft/{Provider,MicrosoftUser,composer.json}`.
- laravel/framework v13.33.0 `Auth/SessionGuard.php`, `Session/Middleware/AuthenticateSession.php`, `Hashing/{BcryptHasher,AbstractHasher}.php`, `Auth/EloquentUserProvider.php`.
- laravel/octane v2.20.0 `Listeners/PrepareSocialiteForNextOperation.php`, `Listeners/PrepareInertiaForNextOperation.php`, `Concerns/ProvidesDefaultConfigurationOptions.php`.
- larastan 3.x `Rules/NoEnvCallsOutsideOfConfigRule.php`.
- Packagist API (`repo.packagist.org/p2/*`, `packagist.org/packages/*.json`), Composer dry-run in a scratch directory.
- learn.microsoft.com: ID token claims reference (updated 2026-06-15), OAuth 2.0 authorization code flow (updated 2026-06-15), Sign in with Microsoft branding guidelines.
- laravel.com/docs/13.x/socialite.

### Secondary (MEDIUM confidence)
- socialiteproviders.com/usage (Laravel 11+ registration; silent on 12/13 and on `dont-discover`).
- docs.dokploy.com/docs/core/docker-compose (Environment tab, `${VAR}` injection).
- Project research (`.planning/research/*.md`), re-checked against sources above; two claims corrected here (shared props in `boot()`, config location).

### Tertiary (LOW confidence)
- Doppler CLI flag syntax (A7); Traefik network CIDR (A2); desktop webview behaviour (A3).

## Appendix A: Touched-core-files ledger (Phase 2)

| File | Edit | Size |
|------|------|------|
| `composer.json`, `composer.lock` | add 2 requires (4 locked packages) | generated; regenerate, never hand-merge on upstream sync |
| `config/app.php` | `use` + `Microsoft365ServiceProvider::class` in `providers` | 2 lines |
| `resources/js/Pages/Auth/Login.vue` | import + `<MicrosoftSignInButton />` after the form | ~3 lines |
| `resources/js/Pages/Profile/Show.vue` | import + `<MicrosoftConnectionForm />` + `<SectionBorder />` | ~4 lines |
| `.env.example` | commented `SOLIDTIME_MICROSOFT_*` block | few lines |
| `docs/deploy/dokploy-compose.fork.yml` | 5 env lines under `app` (fork-owned file) | 5 lines |

Not touched: `FortifyServiceProvider`, `AppServiceProvider`, `RouteServiceProvider`, `routes/web.php`, `Kernel.php`, `HandleInertiaRequests`, `ShareInertiaData`, `CreateNewUser`, `UserService`, `MemberService`, `DeletionService`, `config/services.php`, `config/octane.php`, `openapi.json`.

## Appendix B: Copy proposals (EN default, ES alternative; owner to confirm, Open Question 1)

Microsoft's rules: keep the logo unaltered, use "Sign in with Microsoft" text, call the accounts "work or school account", never "Microsoft 365 ID" [CITED: learn.microsoft.com/entra/identity-platform/howto-add-branding-in-apps]. Provide the four-square logo inline (`#F25022`, `#7FBA00`, `#00A4EF`, `#FFB900` are the standard colours; confirm against the downloadable asset when implementing) so it does not depend on a theme.

| Key | English | Español |
|-----|---------|---------|
| `ui.sign_in` | Sign in with Microsoft | Iniciar sesión con Microsoft |
| `ui.sign_in_hint` | Use your work or school account | Usa tu cuenta profesional o educativa |
| `ui.section_title` | Microsoft 365 | Microsoft 365 |
| `ui.section_description` | Your Microsoft work account linked to solidtime. | Tu cuenta de trabajo de Microsoft vinculada a solidtime. |
| `ui.connected_as` | Connected as :email | Conectado como :email |
| `ui.not_connected` | Not connected | No conectado |
| `ui.connect` / `ui.disconnect` | Connect Microsoft / Disconnect | Conectar con Microsoft / Desconectar |
| `ui.disconnect_title` | Disconnect Microsoft? | ¿Desconectar Microsoft? |
| `ui.disconnect_body` | This removes the Microsoft tokens stored for your account. Your time entries are not affected. You can still sign in with Microsoft. | Se eliminarán los tokens de Microsoft guardados para tu cuenta. Tus registros de tiempo no se ven afectados. Podrás seguir iniciando sesión con Microsoft. |
| `ui.disconnect_body_passwordless` | You have no password, so your Microsoft sign-in link stays and you can still log in. To set a password, use "Forgot your password?" on the login page. | No tienes contraseña, así que el vínculo de inicio de sesión con Microsoft se mantiene y podrás seguir entrando. Para crear una contraseña usa "¿Olvidaste tu contraseña?" en la pantalla de acceso. |
| `error.interrupted` | The Microsoft sign-in expired or was interrupted. Please try again. | El inicio de sesión con Microsoft ha caducado o se ha interrumpido. Inténtalo de nuevo. |
| `error.cancelled` | Microsoft sign-in was cancelled. | Se ha cancelado el inicio de sesión con Microsoft. |
| `error.wrong_tenant` | This Microsoft account does not belong to the Untangle organization. | Esta cuenta de Microsoft no pertenece a la organización de Untangle. |
| `error.guest` | Guest accounts cannot sign in to solidtime. | Las cuentas de invitado no pueden iniciar sesión en solidtime. |
| `error.domain` | The email domain of this Microsoft account is not allowed. | El dominio de correo de esta cuenta de Microsoft no está permitido. |
| `error.unverified_account` | An account with this email already exists but is not verified. Verify it with the email we sent you, or ask an administrator. | Ya existe una cuenta con este correo que aún no está verificada. Verifícala con el correo que te enviamos o pide ayuda a un administrador. |
| `error.already_linked` | This solidtime account is already linked to a different Microsoft account. Ask an administrator. | Esta cuenta de solidtime ya está vinculada a otra cuenta de Microsoft. Pide ayuda a un administrador. |
| `error.provisioning_unavailable` | Your account does not exist yet and automatic account creation is not set up. Ask an administrator. | Tu cuenta aún no existe y la creación automática no está configurada. Pide ayuda a un administrador. |
| `error.generic` | We could not sign you in with Microsoft. Try again or use your email and password. | No hemos podido iniciar sesión con Microsoft. Inténtalo de nuevo o usa tu correo y contraseña. |

## Appendix C: Suggested plan decomposition (planner decides)

- **Wave 0:** portable toolchain + `composer require` + lock; provider skeleton, `config/microsoft365.php`, `MicrosoftConfig`, `EnsureMicrosoftIsEnabled`, migration + model; test scaffolding and fake gateway.
- **Wave 1 (backend):** gateway + DTO + guard, resolver/provisioner, controllers + routes, lang files; Feature/Unit tests; push and read CI.
- **Wave 2 (frontend):** `ShareMicrosoftInertiaData`, `MicrosoftSignInButton.vue`, `MicrosoftConnectionForm.vue`, `Login.vue`/`Show.vue` seams, Vitest tests, Playwright guard.
- **Wave 3 (ops):** `.env.example`, compose edits, bootstrap/deployment doc (placeholders only), `m365:check`, docs gates, touched-files ledger.
- **Checkpoint:** human UAT on the Dokploy URL (first use of the production secret, desktop authorize).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Packagist metadata, Composer dry-run against the real lock, driver source read.
- Architecture: HIGH - every seam (Fortify view, middleware group, profile page, Member/User services, Octane listeners) read in the repo or vendor source at the locked versions.
- Pitfalls: HIGH for code-level items (Octane/Inertia flush, remember-me, config location, docs gates); MEDIUM for Dokploy/Entra operational items (CIDR, mail, webview).

**Research date:** 2026-10-22
**Valid until:** 2026-11-21 (stable; re-check Socialite/SocialiteProviders versions and Octane listeners if the lock is bumped)
