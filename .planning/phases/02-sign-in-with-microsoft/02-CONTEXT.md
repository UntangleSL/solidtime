# Phase 2: Sign in with Microsoft - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Untangle members can sign in to solidtime (time.untangle.es and local) with "Sign in with Microsoft" (Entra ID, Untangle tenant), alongside the unchanged email/password login. First sign-in provisions or safely links the account; Microsoft tokens are stored encrypted in a dedicated table; the profile shows connection status with a disconnect action; configuration is env-only and documented for Dokploy. Covers AUTH-01..07, SEC-01, OPS-01. No Graph calendar calls yet (Phase 3) beyond what sign-in itself needs (User.Read profile is optional).

</domain>

<decisions>
## Implementation Decisions

### Identity and access (locked, owner decisions)
- **D-01:** Single tenant: only the Untangle tenant (`tid` from env `SOLIDTIME_MICROSOFT_TENANT_ID` / app config). Never `common`/`organizations`.
- **D-02:** Tenant-wide access: Entra "Assignment required" = No. The app itself must reject: other tenants (tid mismatch), guest users (userType Guest / `#EXT#` UPN / `acct`=1 claim), and accounts whose email domain is not in the allowlist. Default allowlist: `untanglegrowth.com` (primary), `untangle.es` — configurable list via env.
- **D-03:** Identity is matched on Entra `tid` + `oid`, stored in a dedicated table (e.g. `microsoft_accounts`), never by email after the first link. Email (case-insensitive) is used only for the one-time first link to an existing **verified, non-placeholder** solidtime user; unverified password accounts are never silently linked (show a clear message instead).
- **D-04:** Auto-provision on first sign-in when no account exists: verified, passwordless user, joined to the configured Untangle organization with the lowest role (employee). Works even with `APP_ENABLE_REGISTRATION=off`/invite-only. Microsoft-provisioned users do NOT get a personal organization.
- **D-05:** Target organization is configured by env (e.g. `MICROSOFT_ORGANIZATION_ID`). If not configured or not found, Microsoft sign-in still links existing users but refuses to provision new ones with a clear message (so the owner can bootstrap: register once with email/password, which creates the Untangle org, then set the env var in Dokploy).
- **D-06:** Entra MFA is the second factor for Microsoft sign-ins (Fortify TOTP challenge not applied to Microsoft logins); email/password + TOTP unchanged for password logins.
- **D-07:** Concurrent first sign-ins must produce exactly one user (unique index on (tid, oid) + transactional provisioning).
- **D-08:** F1 (freelance) users have no mailbox: they can sign in normally; nothing in this phase may require a mailbox.

### Tokens and security (locked)
- **D-09:** Scopes requested at login: `openid profile email offline_access User.Read Calendars.Read` (admin consent already granted tenant-wide, verified in Phase 1 — users see no consent screen). Store access + refresh tokens (for Phase 3) encrypted (`encrypted` cast on `text` columns), `$hidden`, never audited/logged/serialized/shared via Inertia, never in `users`/session/cache.
- **D-10:** Disconnect in profile deletes stored tokens (and the identity link per AUTH-07 wording — planner/researcher decide whether disconnect keeps the identity row for SSO but drops tokens; must not break the user's ability to log in if they have no password: a passwordless user who disconnects must be warned / prevented from locking themselves out). Time entries are never touched.
- **D-11:** Socialite (or equivalent) must be Octane/FrankenPHP-safe: no driver/user state leaking between requests; state + PKCE validated; never `stateless()`.
- **D-12:** Production secret: Doppler `vps/prd` `SOLIDTIME_MICROSOFT_CLIENT_SECRET`; client/tenant IDs `SOLIDTIME_MICROSOFT_CLIENT_ID`/`SOLIDTIME_MICROSOFT_TENANT_ID`. The first production sign-in is the first real use of the production secret (AADSTS7000215 = wrong value → new secret); record the date in docs/m365/RUNBOOK-entra-app.md.

### Deployment (locked)
- **D-13:** Deploy target: Dokploy compose `untangle-solidtime-tq34sf` (composeId `PtyO0frWvgS_QEaN9g1bW`), image `ghcr.io/untanglesl/solidtime:feature-m365-integration` built by `.github/workflows/fork-image.yml` on push. Compose source of truth: `docs/deploy/dokploy-compose.fork.yml` (raw compose; env values live in Dokploy env, secrets copied from Doppler `vps/prd`). Redirect URI `https://time.untangle.es/auth/microsoft/callback` (already registered in Entra; also `https://solidtime.test/auth/microsoft/callback` and `http://localhost/auth/microsoft/callback`). APP_FORCE_HTTPS / TRUSTED_PROXIES must make Laravel build the https callback behind Traefik.
- **D-14:** The integration is fully off (no button, no routes) when the Microsoft env vars are absent (partial OPS-02 groundwork; full verification in Phase 7).
- **D-15:** Fork isolation: new code in `app/Microsoft365/` (own service provider, routes, migrations, config `config/microsoft365.php` or similar) and `resources/js/m365/`; minimal touches to core (provider registration line, login page button slot, profile section). Keep a touched-core-files list.

### UI (no separate UI-SPEC; decided here)
- **D-16:** Login page: a secondary button "Sign in with Microsoft" (Microsoft logo, follows solidtime's existing button components and theme tokens), below or above the email/password form; only visible when the integration is configured. Error messages for rejected accounts shown on the login page in the app's existing flash/notification style. App UI language: follow existing solidtime i18n (lang/) — add strings to lang files rather than hard-coding.
- **D-17:** Profile page: a "Microsoft 365" section showing connected/not connected, the linked account email, and a Disconnect action with confirmation (reuse existing profile section components).

### Claude's Discretion
- Exact package choice and versions (research recommends `laravel/socialite` + `socialiteproviders/microsoft`), table/column names, route names, how disconnect treats passwordless users (must be safe), test structure.

</decisions>

<specifics>
## Specific Ideas

- Desktop app and browser extension (separate solidtime-io repos) connect via the web OAuth login: a Microsoft-only (passwordless) user must be able to authorize the desktop app through the web login page. Include a verification step for this (manual UAT is fine).
- Fresh production DB since 2026-10-22: no users yet. Bootstrap flow per D-05 must be documented for the owner.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (AUTH-01..07, SEC-01, OPS-01), `.planning/ROADMAP.md` §Phase 2
- `.planning/research/SUMMARY.md`, `STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` (corrected in Phase 1)
- `docs/m365/DECISIONS-graph.md` (Phase 1 decisions), `docs/m365/RUNBOOK-entra-app.md` (registration values, Doppler names)
- `docs/deploy/dokploy-compose.fork.yml`, `docs/deploy/backup-2026-10-19/README.md` (deployment)
- `.planning/codebase/*.md` (conventions, testing, integrations, concerns)

</canonical_refs>

<code_context>
## Existing Code Insights

- Fortify session auth (`app/Providers/FortifyServiceProvider.php`, `app/Actions/Fortify/CreateNewUser.php`), Passport for API, `app/Service/MemberService.php` (addMember, placeholder merge), `app/Service/UserService.php` (creates personal org — not to be used for M365 provisioning), `app/Service/DeletionService.php`, `app/Models/User.php` ($hidden), `config/app.php` providers list, `resources/js/Pages/Auth/Login.vue`, `resources/js/Pages/Profile/`.
- Tests: PHPUnit 12 (Feature/Unit), Vitest, Playwright; CI on fork runs PHPUnit/PHPStan/Pint/npm checks/Playwright.
- Host has no PHP/Docker: PHP tests run in CI (push the branch). Node is available.

</code_context>

<deferred>
## Deferred Ideas

- Graph calendar sync, token refresh usage — Phase 3.
- Full OPS-02 off-switch verification, SEC-03/SEC-04 — Phase 7.
- Entra spike cleanup — Phase 7.

</deferred>

---

*Phase: 02-sign-in-with-microsoft*
*Context gathered: 2026-10-22 from owner decisions across the session*
