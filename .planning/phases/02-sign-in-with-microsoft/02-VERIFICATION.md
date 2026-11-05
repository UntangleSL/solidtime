---
phase: 02-sign-in-with-microsoft
verified: 2026-11-05T12:43:00Z
status: passed
score: 11/11 must-haves verified
covered_files: [".planning/phases/02-sign-in-with-microsoft/02-01-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-01-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-02-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-02-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-03-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-03-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-04-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-04-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-05-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-05-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-06-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-06-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-07-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-07-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-08-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-08-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-09-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-09-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-10-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-10-SUMMARY.md", ".planning/phases/02-sign-in-with-microsoft/02-11-PLAN.md", ".planning/phases/02-sign-in-with-microsoft/02-11-SUMMARY.md", "app/Microsoft365/Auth/MicrosoftIdentity.php", "app/Microsoft365/Auth/MicrosoftIdentityGuard.php", "app/Microsoft365/Auth/MicrosoftIdentityResolver.php", "app/Microsoft365/Auth/MicrosoftOAuthGateway.php", "app/Microsoft365/Auth/MicrosoftSignInException.php", "app/Microsoft365/Auth/MicrosoftSignInFailure.php", "app/Microsoft365/Auth/MicrosoftUserProvisioner.php", "app/Microsoft365/Auth/SocialiteMicrosoftGateway.php", "app/Microsoft365/Console/MicrosoftCheckCommand.php", "app/Microsoft365/Http/Controllers/MicrosoftAccountController.php", "app/Microsoft365/Http/Controllers/MicrosoftAuthController.php", "app/Microsoft365/Http/Middleware/EnsureMicrosoftIsEnabled.php", "app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php", "app/Microsoft365/Microsoft365ServiceProvider.php", "app/Microsoft365/MicrosoftConfig.php", "app/Microsoft365/Models/MicrosoftAccount.php", "app/Microsoft365/database/migrations/2026_10_22_000001_create_microsoft_accounts_table.php", "app/Microsoft365/routes/microsoft365.php", "app/Providers/FortifyServiceProvider.php", "composer.json", "config/app.php", "config/microsoft365.php", "docs/deploy/MICROSOFT-SIGNIN.md", "docs/deploy/dokploy-compose.fork.yml", "docs/m365/RUNBOOK-entra-app.md", "docs/m365/TOUCHED-CORE-FILES.md", "e2e/microsoft-signin.spec.ts", "lang/en/microsoft365.php", "lang/es/microsoft365.php", "resources/js/Pages/Auth/Login.vue", "resources/js/Pages/Profile/Show.vue", "resources/js/m365/components/MicrosoftConnectionForm.test.ts", "resources/js/m365/components/MicrosoftConnectionForm.vue", "resources/js/m365/components/MicrosoftSignInButton.test.ts", "resources/js/m365/components/MicrosoftSignInButton.vue", "resources/js/m365/navigation.ts", "resources/js/m365/types.ts", "tests/Feature/AuthenticationTest.php", "tests/Feature/Microsoft365/MicrosoftAccountTest.php", "tests/Feature/Microsoft365/MicrosoftCheckCommandTest.php", "tests/Feature/Microsoft365/MicrosoftIdentityResolverTest.php", "tests/Feature/Microsoft365/MicrosoftLinkingTest.php", "tests/Feature/Microsoft365/MicrosoftLoginPageTest.php", "tests/Feature/Microsoft365/MicrosoftProvisioningTest.php", "tests/Feature/Microsoft365/MicrosoftRedirectTest.php", "tests/Feature/Microsoft365/MicrosoftSessionTest.php", "tests/Feature/Microsoft365/MicrosoftSignInFlowTest.php", "tests/Feature/Microsoft365/MicrosoftSignInRejectionTest.php", "tests/Feature/Microsoft365/MicrosoftTokenStorageTest.php", "tests/Feature/Microsoft365/Support/FakeMicrosoftOAuthGateway.php", "tests/Feature/Microsoft365/Support/InteractsWithMicrosoft365.php", "tests/Unit/Microsoft365/MicrosoftConfigTest.php", "tests/Unit/Microsoft365/MicrosoftIdentityGuardTest.php", "tests/Unit/Microsoft365/MicrosoftLangTest.php", "tests/Unit/Microsoft365/SocialiteMicrosoftGatewayTest.php"]
covered_digest: "v3:sha256:178486a0c5854de851845c0a88b9bd2d7c3049e52b02f178c3ac54482ebbb8b9"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 11/11
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  human_items_resolved:
    - item: "Browser extension authorization via Microsoft web login"
      result: passed
      confirmed_by: "owner (chat, relayed by the orchestrator)"
      confirmed_at: "2026-11-05"
      evidence: "docs/deploy/MICROSOFT-SIGNIN.md section 'Clientes OAuth de la app de escritorio y la extensión' (lines 175-208, including the instance's extension settings table at lines 183-188: endpoint and public Client ID); docs/m365/RUNBOOK-entra-app.md Verificación line 63 and Historial line 146"
---

# Phase 2: Sign in with Microsoft Verification Report

**Phase Goal:** As a member of the Untangle team, I want to sign in to solidtime with my Microsoft 365 account, so that I get in with my work identity and Entra MFA while email/password login keeps working for everyone else.
**Mode:** mvp (the user-story format check passed: `user-story.validate` returned `valid=true`)
**Verified:** 2026-11-05T12:43:00Z (re-verification; first pass 10:35Z, production re-sampled 10:36Z after the sha-d24a04b deploy finished at 10:31:04Z, and again at 12:42Z)
**Status:** passed
**Re-verification:** Yes. The previous status was `human_needed` (11/11) with one open human item, the browser-extension authorization. The owner has now confirmed it (see "Resolved since the first pass"). No gaps were open. A regression check of the verified findings found no change.

## User Flow Coverage (MVP)

| Step | Expected | Evidence in codebase / production | Status |
| --- | --- | --- | --- |
| Member opens the login page | A "Sign in with Microsoft" button sits next to the password form, only when the integration is configured | `resources/js/Pages/Auth/Login.vue:109` `<MicrosoftSignInButton />`. The component renders on `props.microsoft.enabled`, which comes from `ShareMicrosoftInertiaData`. On production at 10:36Z, /login props include `"microsoft":{"enabled":true,...}` and `"canRegister":false` | VERIFIED |
| Clicks the button | 302 to the tenant-pinned Entra authorize URL with state and PKCE | Production `Location` at 10:36Z: `https://login.microsoftonline.com/fad1cfee-…/oauth2/v2.0/authorize?…redirect_uri=https%3A%2F%2Ftime.untangle.es%2Fauth%2Fmicrosoft%2Fcallback&scope=openid+profile+email+offline_access+User.Read+Calendars.Read…&code_challenge_method=S256` | VERIFIED |
| Authenticates with the work identity and Entra MFA | Tenant enforces MFA. Callback validates tenant, guest and domain, then signs in | Runbook line 60 dates Security Defaults ON on 2026-11-04. Runbook line 61 records the first production sign-in with `amr_mfa=yes`. `MicrosoftAuthController::callback` calls the guard and the resolver, then `Auth::login($user, false)` | VERIFIED |
| Lands in solidtime | Dashboard (or the intended /oauth/authorize URL) | `redirect()->intended(route('dashboard'))`. Tests: `MicrosoftSessionTest::test_callback_resumes_intended_oauth_authorize_url`. Desktop app UAT approved 2026-11-05. Browser extension connected through the Microsoft web login on 2026-11-05 (owner-confirmed; runbook line 63) | VERIFIED |
| Email/password login keeps working for everyone else | Fortify login, reset and TOTP unchanged | Fortify core is untouched apart from the `canRegister` prop. `MicrosoftSessionTest::test_password_login_for_totp_user_still_requires_the_code`. Upstream `AuthenticationTest`, PasswordReset and TwoFactor tests pass in CI (PHPUnit success on d24a04b3). Owner UAT confirms password login works | VERIFIED |

The outcome clause ("get in with my work identity and Entra MFA while email/password login keeps working") holds on the codebase and on production.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC1: "Sign in with Microsoft" works locally and on the Dokploy HTTPS URL, even with registration disabled. Password login, reset and TOTP unchanged | VERIFIED | Production checks above. Health check returns 200. `MicrosoftUserProvisioner` never calls Fortify `CreateNewUser` or `UserService`, so registration mode is irrelevant (`MicrosoftProvisioningTest::test_provisioning_works_with_registration_off_and_invite_only`). The owner confirmed a second, non-admin user was auto-provisioned with registration off |
| 2 | SC2: a first-time user gets a verified, passwordless employee of the Untangle org. An existing verified user with the same email (any case) is linked. An unverified account is never silently linked | VERIFIED | `MicrosoftUserProvisioner.php` sets `password=null`, `email_verified_at=now`, and calls `addMember(..., Role::Employee)` without creating a personal org. `MicrosoftIdentityResolver::findLinkCandidate` uses `lower(email)` and excludes placeholders. Unverified users get `UnverifiedAccount`. Tests: `test_provisioned_user_is_verified_passwordless_employee_of_configured_org` (asserts 0 owned orgs), `test_links_existing_verified_user_by_email_case_insensitively`, `test_unverified_account_is_never_linked`, `test_placeholder_with_same_email_is_not_logged_into` |
| 3 | SC3: other tenants, #EXT# guests and outside domains are rejected with a clear message. Returning users are matched on tid+oid. Concurrent first sign-ins produce exactly one user | VERIFIED | `MicrosoftIdentityGuard.php`: tenant and audience equality, `userType === 'Member'` (fails closed), the `#EXT#` marker, `acct=1`, and an exact last-@ domain match. Messages are in `lang/en/microsoft365.php` (`error.wrong_tenant`, `guest`, `domain`) and flash through `message` into `Banner`. Matching uses the unique `(tenant_id, microsoft_oid)` index (migration) plus `pg_advisory_xact_lock` and a single retry on `UniqueConstraintViolationException`. Tests: `MicrosoftSignInRejectionTest` (3 cases), `MicrosoftIdentityGuardTest` (24 cases), `test_returning_identity_resolves_by_tid_oid_after_email_changes`, and `MicrosoftIdentityResolverTest::test_unique_violation_is_retried_once_and_yields_one_user`, which simulates a race committed between lookup and insert and ends with one user and one row. Owner UAT: a guest or outside account was rejected |
| 4 | SC4: the profile shows connection status and offers Disconnect. Disconnect deletes the tokens and leaves time entries untouched | VERIFIED | `resources/js/Pages/Profile/Show.vue:61` renders `<MicrosoftConnectionForm />` (status, Connect, confirmed Disconnect, passwordless warning). `DELETE /user/microsoft` goes to `MicrosoftAccountController::destroy`, which nulls access and refresh tokens, expiry and scopes and sets `disconnected_at`. The identity is kept, so a passwordless user is never locked out. `MicrosoftAccountTest::test_disconnect_nulls_tokens_keeps_identity_and_time_entries` takes a time-entry snapshot before and after. Owner UAT: Disconnect and Connect work |
| 5 | SC5: tokens exist only encrypted in the dedicated table (never in users, session, cache, logs, audits, API or Inertia props). Env-only config is documented for Dokploy (HTTPS redirect, trusted proxies) | VERIFIED | `MicrosoftAccount` uses `encrypted` casts and `$hidden`, and is not `Auditable`. No `Cache::` use exists in `app/Microsoft365`. Logs carry only reason and AADSTS code. `MicrosoftIdentity` has `#[SensitiveParameter]` and `__debugInfo` redaction. Leak matrix in `MicrosoftTokenStorageTest` (ciphertext at rest, serialisation, audits, users columns, session and logs, Inertia, `/api/v1/users/me`, rejected callback). Config: `config/microsoft365.php` is env-only (7 `SOLIDTIME_MICROSOFT_*` variables), with `.env.example` lines 96-102, compose lines 27-36, and `docs/deploy/MICROSOFT-SIGNIN.md` lines 29-39 (APP_FORCE_HTTPS, TRUSTED_PROXIES, SESSION_LIFETIME). The redirect URI is built from APP_URL (`MicrosoftConfig::redirectUri`), and production shows the https callback |
| 6 | 02-11: every CI workflow is green for the release commit, and every Microsoft365 PHPUnit class passes on Postgres 15/16/17 | VERIFIED | `gh run list -R UntangleSL/solidtime --commit d24a04b3d6ab…` shows 10/10 `success` (NPM Build, Lint, Format, Unit, Typecheck, PHP Linting, PHPStan, PHPUnit, Fork - Build image, Playwright). 15 Microsoft365 classes x 3 PG versions = 45 PASS lines (CI evidence provided by the orchestrator). Local `npx vitest run resources/js/m365`: 15/15 pass |
| 7 | 02-11: release gate D-06. The owner confirmed tenant MFA enforcement before the deploy | VERIFIED | Runbook line 60 ("MFA del tenant comprobada (puerta de publicación, Fase 2): 2026-11-04, Security Defaults activados") and history line 143. The owner confirmed this fact |
| 8 | 02-11: on production, `props.microsoft.enabled` is true and the redirect returns 302 to the tenant-pinned authorize URL with the https callback | VERIFIED | Curl at 10:30Z and again at 10:36Z (see the User Flow table). `cf-cache-status: DYNAMIC` |
| 9 | 02-11: m365:check in production reports configured, https URI, organization found, registration off, session 720 | VERIFIED | Runbook line 61 records the m365:check result. Independent public evidence: the session cookie has `Max-Age=43200` (720 min), and `canRegister:false` on /login is consistent with registration off. The container output itself cannot be checked from here |
| 10 | 02-11: the owner signed in on production and was linked to her bootstrap account, not duplicated. The first use of the secret, the AADSTS outcome, the MFA check and amr_mfa are recorded (D-12) | VERIFIED | Runbook line 59 records the first production token on 2026-11-04 with no error. Line 61 records the link to the bootstrap account and `amr_mfa=yes`. Lines 143-144 hold the history rows |
| 11 | 02-11: registration is off again after the bootstrap, and email/password login still works on production | VERIFIED | Owner-confirmed (registration off, password-login UAT on 2026-11-05). `CreateNewUser.php:37` rejects registration when the mode is Off. Production /login carries `"canRegister":false` (10:36Z) |

**Score:** 11/11 truths verified (0 present but behavior-unverified)

### Prohibitions

| Plan | Prohibition | Tier | Disposition |
| --- | --- | --- | --- |
| 02-01/02/07 | No tokens, ids or provider text in session, logs, Inertia prop, cache, audits or API | test | Enforced: `MicrosoftTokenStorageTest`, `MicrosoftLoginPageTest::test_microsoft_prop_has_only_public_keys`, `MicrosoftSessionTest::test_successful_sign_in_logs_mfa_evidence_without_pii`. Cache: no cache writes in fork code |
| 02-01/06 | No personal org and no role above employee for provisioned users | test | Enforced: `MicrosoftProvisioningTest` asserts `Role::Employee` and 0 owned orgs |
| 02-04 | No Socialite facade, no stateless driver, no cached provider | test | Enforced: `test_container_resolves_a_new_gateway_each_time` and `test_two_sequential_authentications_do_not_share_state`. A grep finds no `Socialite::` and no `stateless(` call |
| 02-05 | Never admit guests, other tenants or outside domains | test | Enforced: `MicrosoftIdentityGuardTest`, `MicrosoftSignInRejectionTest` |
| 02-06 | Never link to an unverified or placeholder account | test | Enforced: `MicrosoftLinkingTest` |
| 02-07 | Never refuse a sign-in because amr lacks mfa | test | Enforced: the `mfaEvidence()` value is only logged. `MicrosoftSessionTest` cases cover `'no'` and `'absent'` |
| 02-08 | Disconnect never touches time entries and never locks out a passwordless user | test | Enforced: `MicrosoftAccountTest::test_disconnect_nulls_tokens_keeps_identity_and_time_entries` and `test_sign_in_after_disconnect_works_without_storing_tokens` |
| 02-09 | No secrets committed | test | Enforced: `MicrosoftCheckCommandTest::test_output_never_contains_the_secret_or_token_markers`. `validate-docs.mjs secrets` returns OK (1892 checks, re-run 10:36Z), and a git grep for secret-shaped strings finds 0 hits |
| 02-09 | No dependency on Cloudflare Access or an outer gateway | judgment | HOLDS (deterministic grep: no `cf-access` or `cloudflare` reference in `app/`). Docs note the Access bypass for `/api/*`, `/oauth/token`, `/health-check/up` (MICROSOFT-SIGNIN.md:187) |
| 02-11 | Production secret never passed through executor, plans, commits, CI logs or runbook | judgment | HOLDS, resolved by the owner. Evidence: the 02-11 handoff (`.planning/phases/02-sign-in-with-microsoft/.continue-here.md` line 14) records that the owner set the `SOLIDTIME_MICROSOFT_*` values in the Dokploy Environment tab from Doppler `vps/prd`. Line 35 records that the Dokploy env is never edited through MCP (it is redacted there). Repo scans are clean. Owner confirmation relayed by the orchestrator on 2026-11-05 |
| 02-11 | No deploy while the tenant MFA check is unconfirmed | judgment | HOLDS: the owner resolved it, and runbook line 60 is dated 2026-11-04 before the first deploy (02-11-SUMMARY steps 1 and 2) |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `app/Microsoft365/Http/Controllers/MicrosoftAuthController.php` | Redirect and callback, connect intent, typed failures | VERIFIED | Substantive and wired through `routes/microsoft365.php` |
| `app/Microsoft365/Auth/SocialiteMicrosoftGateway.php` | Per-call tenant-pinned driver with PKCE and the D-09 scopes | VERIFIED | Bound in `Microsoft365ServiceProvider::register` |
| `app/Microsoft365/Auth/MicrosoftIdentityGuard.php` | Tenant, guest and domain gate | VERIFIED | Called in both callback paths |
| `app/Microsoft365/Auth/MicrosoftIdentityResolver.php` + `MicrosoftUserProvisioner.php` | tid+oid resolution, safe linking, provisioning | VERIFIED | `verify.artifacts` for 02-01 flags "Missing pattern: Role::Employee" in the resolver. The 02-06 refactor moved that pattern to `MicrosoftUserProvisioner.php` line 63, so the 02-01 check is superseded and this is not a stub |
| `app/Microsoft365/Models/MicrosoftAccount.php` + migration | Dedicated table with encrypted casts, unique (tid,oid) and user_id, cascading FK | VERIFIED | |
| `app/Microsoft365/Http/Controllers/MicrosoftAccountController.php` | Disconnect | VERIFIED | Route `DELETE /user/microsoft` under auth, auth.session and verified |
| `app/Microsoft365/Http/Middleware/{EnsureMicrosoftIsEnabled,ShareMicrosoftInertiaData}.php` | Off switch (404) and a token-free prop | VERIFIED | Pushed to the `web` group in provider boot |
| `app/Microsoft365/Console/MicrosoftCheckCommand.php` | Diagnostic | VERIFIED | Registered for console use |
| `resources/js/m365/components/*.vue` | Button and profile section | VERIFIED | Imported by `Login.vue` and `Show.vue`. Vitest 15/15 pass |
| `config/microsoft365.php`, `.env.example`, `docs/deploy/dokploy-compose.fork.yml`, `docs/deploy/MICROSOFT-SIGNIN.md` | Env-only config and the Dokploy guide | VERIFIED | The guide now also documents the Passport public clients for the desktop app and the browser extension (lines 175-208) |
| `docs/m365/RUNBOOK-entra-app.md` | Dated MFA gate and first production sign-in | VERIFIED | Lines 59-63, 143-146 (line 63 and row 146 record the browser extension connection on 2026-11-05) |
| `docs/m365/TOUCHED-CORE-FILES.md` | Ledger | VERIFIED | Line 14 lists `FortifyServiceProvider.php` and line 15 lists `tests/Feature/AuthenticationTest.php`. The "not touched" list now points back to the first table for Fortify (line 44) |

`verify.artifacts` gave 29/30 across all plans. The single miss is the superseded 02-01 pattern explained above.

### Key Link Verification

`verify.key-links` gave 23/24 across plans 02-01..02-10. The 24th (from 02-11) is not file-based and is checked manually below.

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `config/app.php:250` | `Microsoft365ServiceProvider` | providers array | WIRED | |
| `Login.vue:109` | `MicrosoftSignInButton.vue` | import and element | WIRED | |
| `Show.vue:61` | `MicrosoftConnectionForm.vue` | import and element | WIRED | |
| `MicrosoftSignInButton` | `/auth/microsoft/redirect` | `props.microsoft.login_url`, then `navigateTo` | WIRED | Production returns 302 to Entra |
| `MicrosoftConnectionForm` | `DELETE /user/microsoft`, `/auth/microsoft/redirect?intent=connect` | `router.delete` / `navigateTo` | WIRED | |
| Callback | Guard, then Resolver, then `Auth::login` | method injection | WIRED | |
| Dokploy compose `untangle-solidtime-tq34sf` (02-11) | `docs/deploy/dokploy-compose.fork.yml` | compose content plus Doppler env | WIRED | The repo pins `sha-d24a04b` (compose lines 10, 81, 129, commit aee760b9). Production now serves d24a04b3 code: `"canRegister":false` in /login props, and the bundle `/build/assets/Login-xTC3UJdQ.js` declares `props:{canResetPassword:Boolean,canRegister:Boolean,status:String}` (sampled 10:36Z) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `MicrosoftConnectionForm.vue` | `account` (linked, connected, email) | `ShareMicrosoftInertiaData::account()` queries `MicrosoftAccount` for the current user | Yes (DB query, profile route only) | FLOWING |
| `MicrosoftSignInButton.vue` | `microsoft.login_url` | `route('microsoft.redirect')` when `MicrosoftConfig::isConfigured()` | Yes (production prop observed) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Production is up | `curl https://time.untangle.es/health-check/up` | 200 (10:30Z, 10:36Z and 12:42Z) | PASS |
| Login prop is on and public-only | `curl /login`, read the Inertia page JSON | `microsoft.enabled=true`, login_url, labels only, no token keys | PASS |
| Tenant-pinned redirect with PKCE and https callback | `curl -D - /auth/microsoft/redirect` | 302 to `login.microsoftonline.com/<tenant GUID>/oauth2/v2.0/authorize`, `code_challenge_method=S256`, https callback (10:36Z) | PASS |
| Session lifetime of 12 h (D-20) | Response `Set-Cookie` | `Max-Age=43200` | PASS |
| Register link hidden in production (d24a04b3) | `curl /login` props, plus the Login chunk from `/build/manifest.json` | 10:30Z: FAIL (the deploy was still queued, and `Login-BFpWrI2-.js` had no `canRegister`). 10:36Z: `"canRegister":false`, and `Login-xTC3UJdQ.js` declares `canRegister:Boolean` | PASS (re-check) |
| Frontend unit tests | `npx vitest run resources/js/m365` | 2 files, 15 tests passed | PASS |
| Docs secret scan | `node tests/Tools/m365-spike/validate-docs.mjs secrets` | `secrets: OK (1892 checks)`, re-run at 12:42Z after the doc edits | PASS |
| Login prop on and register hidden (regression) | `curl /login`, read the Inertia page JSON | 12:42Z: `"microsoft":{"enabled":true`, `"canRegister":false` | PASS |
| CI for the release commit | `gh run list --commit d24a04b3…` | 10/10 success | PASS |

### Probe Execution

None declared. The phase declares no `scripts/*/tests/probe-*.sh`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| AUTH-01 | 02-01, 02-03, 02-04, 02-11 | Microsoft button, sign-in, password login unchanged | SATISFIED | Truths 1, 8 |
| AUTH-02 | 02-02, 02-05 | Reject other tenants, guests and outside domains with a clear message | SATISFIED | Truth 3 |
| AUTH-03 | 02-01, 02-06 | Auto-provision a verified, passwordless employee | SATISFIED | Truth 2. Second production user provisioned as employee |
| AUTH-04 | 02-06 | Case-insensitive link to a verified non-placeholder user. Unverified accounts never linked | SATISFIED | Truth 2 |
| AUTH-05 | 02-01, 02-06 | tid+oid matching, no duplicates under concurrency | SATISFIED | Truth 3 |
| AUTH-06 | 02-06, 02-07 | Works with registration off. Entra MFA is the second factor | SATISFIED | Truths 1, 7, 11. `amr_mfa=yes` in production |
| AUTH-07 | 02-08, 02-10 | Profile status, Disconnect deletes tokens, entries kept | SATISFIED | Truth 4 |
| SEC-01 | 02-01, 02-07 | Tokens encrypted only in the dedicated table, no leaks | SATISFIED | Truth 5 |
| OPS-01 | 02-09, 02-11 | Env-only config documented for Dokploy (HTTPS, trusted proxies) | SATISFIED | Truth 5, production redirect |

No orphaned requirements. REQUIREMENTS.md maps exactly these 9 IDs to Phase 2.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (scan of all fork files and touched core files) | - | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER | - | None found |
| `.planning/ROADMAP.md` | 90, 111, 114, 206 | Stale bookkeeping | Info | Still says "9/11 plans executed" with 02-10 and 02-11 unchecked. The orchestrator updates this at phase completion |

Resolved since the first pass: the 02-11-SUMMARY step 5 claim now holds (deploy finished 10:31 UTC; line 53). The touched-core-files ledger contradiction (Fortify listed as untouched) and the missing `AuthenticationTest.php` entry are both fixed.

### Human Verification Required

None. The one item from the previous pass is resolved (below).

### Resolved since the first pass

- **Browser extension authorization via Microsoft web login** (the last open item): PASSED, owner-confirmed in chat on 2026-11-05 and relayed by the orchestrator.
  - First attempt: the extension showed "Authorization page could not be loaded". The cause was configuration, not a Phase 2 defect. The extension ships with solidtime cloud's Client ID, which does not exist on this instance, so `/oauth/authorize` returned 401 for the unknown client.
  - Fix: the owner created a public Passport client in production (`php artisan passport:client --public --name="Browser Extension"` with the Chrome Web Store extension's `chromiumapp.org` redirect URI) and entered its Client ID in the extension settings. The extension then connected through the Microsoft web login.
  - Evidence: `docs/deploy/MICROSOFT-SIGNIN.md` section "Clientes OAuth de la app de escritorio y la extensión" (lines 175-208). It covers the 401 cause, the one-time command, the instance's extension settings table (endpoint `https://time.untangle.es` plus the public Client ID, lines 183-188), and persistence in `oauth_clients`. `docs/m365/RUNBOOK-entra-app.md` has the Verificación bullet at line 63 and the Historial row at line 146, both dated 2026-11-05.
  - The Client ID is a public client identifier with no secret (the doc says so at line 204), and the docs secret scan still passes. The code path it exercises, the `/oauth/authorize` intended-URL resume, is the one `MicrosoftSessionTest::test_callback_resumes_intended_oauth_authorize_url` covers (`MicrosoftAuthController.php:122`).

- **Production on sha-d24a04b** (was item 1): at 10:30Z the deploy was still queued in the shared Dokploy queue. It finished at 10:31:04Z, as the orchestrator relayed and 02-11-SUMMARY line 53 states. I re-sampled at 10:36Z:
  - /login carries `"canRegister":false` and `microsoft.enabled=true`.
  - The Login chunk `Login-xTC3UJdQ.js` declares `canRegister:Boolean`.
  - Health check returns 200.
  - The redirect is tenant-pinned with the https callback and S256.
- **Secret-handling prohibition** (was item 3): resolved by the owner. Evidence is in the 02-11 handoff, `.continue-here.md` lines 14 and 35, and repo scans are clean.

### Gaps Summary

No gaps and no open human items. All 5 roadmap success criteria and all 9 requirements are implemented, wired, tested in CI and observed on production. Microsoft sign-in is live, tenant-pinned with PKCE, and MFA evidence is recorded. Production runs the release image `sha-d24a04b`. The owner has confirmed both OAuth clients, the desktop app and the browser extension, through the Microsoft web login. Phase 2 is complete.

---

_Verified: 2026-11-05T12:43:00Z_
_Verifier: Claude (gsd-verifier)_
