# Domain Pitfalls

**Domain:** Entra ID (single-tenant) SSO + Microsoft Graph calendar import added to an existing Laravel 13 / Octane (FrankenPHP) / Inertia time tracker (solidtime fork), deployed behind Dokploy (Traefik)
**Researched:** 2026-10-19
**Overall confidence:** MEDIUM-HIGH. Codebase-specific findings are HIGH (read from source). Entra/Graph behaviour is mostly MEDIUM (from established documented behaviour plus the sources listed at the bottom; items marked "VERIFY" must be tested against a real Untangle mailbox before the phase is closed).

## Phase vocabulary used below

Suggested phase names (the roadmapper may rename them; the mapping is what matters):

| Tag | Phase |
|-----|-------|
| P1 | Entra app registration, config, and infra (redirect URIs, proxy, secrets) |
| P2 | SSO login, account linking, provisioning |
| P3 | Token storage and Graph client (refresh, throttling, timeouts) |
| P4 | Calendar ingestion and ghost-block rendering |
| P5 | Assign / convert suggestions to time entries (single + bulk), dismiss |
| P6 | Recurring-series rules |
| P7 | Out-of-sync flagging |
| P8 | Hardening, deletion/disconnect, merge hygiene |

---

## Critical Pitfalls

Mistakes that cause account takeover, data loss, or rewrites.

### Pitfall 1: Linking / matching Microsoft identities by email (nOAuth and pre-registration takeover)
**What goes wrong:** The callback does `User::where('email', $msUser->email)->first()` and logs that user in. Variants: using `mail`, `email` claim, `preferred_username`, or `userPrincipalName` (UPN) as the identity key.
**Why it happens:** It is the "obvious" Socialite recipe and the project requirement ("existing users with the same email are linked") literally reads like email matching. But in Entra the `email` claim is optional, mutable, and not guaranteed verified; `mail` can be null (no Exchange mailbox); UPN is a login name, not necessarily a deliverable address (alias domains, `#EXT#` guest UPNs). This class of bug is publicly known as nOAuth and still affects shipping SaaS apps.
**Consequences:**
- Cross-tenant takeover if the authority is ever multi-tenant (`common`/`organizations`) - an attacker tenant can set any email.
- Pre-registration takeover even in single-tenant: if email/password registration is open (or invite-only with a guessable invite), an attacker registers `victim@untangle.es` with a password BEFORE the victim's first SSO login. The "link by email" then merges the victim's Microsoft identity into an account the attacker still has the password (and possibly 2FA secret) for.
- Duplicate accounts from case differences: the Postgres unique index on `users.email` is a plain `uniqueIndex('email') WHERE is_placeholder = false` (case-sensitive), so `Juan.Herrero@untangle.es` vs `juan.herrero@untangle.es` both pass.
- Linking to an `is_placeholder = true` user (imported Toggl/Clockify/Harvest members share real emails and are NOT covered by the unique index), producing a login bound to a login-less shadow user.
**Prevention:**
1. Key the identity on `(tid, oid)` stored in a dedicated `microsoft_identities` table (unique index on `tid, oid`). Email is only a one-time *bootstrap hint* for first link, never a login key afterwards. (`sub` is pairwise per app and also works if you only ever use this one app registration; `oid`+`tid` is Microsoft's recommended stable pair.)
2. Hard-require `tid === config('m365.tenant_id')` (and `iss` containing it) on every callback. Reject otherwise, even though single-tenant authority should already prevent it (defence in depth).
3. First-link rule: only auto-link to an existing account when the account's email is case-insensitively equal AND the account is `is_placeholder = false` AND (`email_verified_at` is not null OR the user proves control - e.g. is already logged in and is performing "Connect Microsoft" from settings). For a never-verified password account matching the email, do NOT link silently: either require the logged-in "Connect Microsoft" path, or on link rotate the password (random), clear `two_factor_*` secrets and invalidate sessions so a pre-registrant loses access.
4. Normalise with `lower(email)` on both sides in the lookup (`whereRaw('lower(email) = ?')`), and store lower-cased. Do not rely on the DB index for case-insensitivity.
5. Restrict allowed email domain(s) via env (e.g. `M365_ALLOWED_DOMAINS=untangle.es`) as a second gate for auto-provisioning.
6. Never copy the id-token `email_verified` claim into `email_verified_at` (Entra does not reliably emit it). Set `email_verified_at = now()` only because the `tid` check passed.
7. Use the existing `MemberService::addMember()` for org join: it already calls `mergePlaceholderMembersIntoExistingMember`, which is exactly what you want for imported placeholder history.
**Detection:** Test that (a) a pre-registered unverified password user with the matching email does not result in a shared account, (b) mixed-case email links to the existing user rather than creating a second, (c) a placeholder user with the same email is merged via `MemberService`, not logged into.
**Phase:** P2 (design in P1 ADR; tests in P2).

### Pitfall 2: Guests, wrong-tenant users, and "anyone in the tenant can sign in"
**What goes wrong:** A single-tenant app registration still lets *every* user object in the Untangle tenant sign in by default, including B2B guest users (contractors, partners, `user_ext#EXT#@untangle.onmicrosoft.com`) whose `tid` equals Untangle's tenant. With auto-provisioning ("first sign-in joins the Untangle organization"), every guest becomes an organization member who can see projects and clients.
**Why it happens:** `tid` check passes for guests; auto-provision has no second gate. "Assignment required" on the Enterprise Application is off by default.
**Consequences:** External people land in the org (visibility of clients, projects, rates), and their calendars get pulled.
**Prevention:**
- In Entra: Enterprise Application -> Properties -> "Assignment required = Yes", assign an Untangle security group. This is the strongest gate and costs nothing in code.
- In code: reject when `userType` is Guest (the `idtyp`/UPN contains `#EXT#`), and enforce the domain allowlist from Pitfall 1.
- Provision as the lowest role (Employee), never Admin/Owner; org id comes from env `M365_ORGANIZATION_ID`, never inferred from claims.
- Registration mode `APP_ENABLE_REGISTRATION=off|invite-only` governs password registration only; make it explicit (documented + tested) that SSO provisioning is a separate path with its own gates so a future change to registration modes does not accidentally open or close it.
**Detection:** Sign in with a guest test account; expect a clean rejection page, not a new member row.
**Phase:** P1 (Entra config), P2 (code gate).

### Pitfall 3: Wrong authority / app-registration platform type (works on localhost, fails in prod)
**What goes wrong:**
- Using `common` or `organizations` authority with a single-tenant registration yields `AADSTS50194`; using `common` with a multi-tenant registration reopens Pitfall 1.
- Registering the redirect URI under the "Single-page application" platform instead of "Web" produces `AADSTS9002327`-style errors on the server-side code exchange and issues short-lived (24h) refresh tokens.
- Confusing client-secret *Secret ID* with the secret *Value* (`AADSTS7000215`). The Value is shown only once at creation.
- Client secret expiry (Entra default/maximum is short - commonly 6-24 months): after expiry BOTH login and calendar sync fail with `invalid_client`, in production, with no code change.
- Off-the-shelf `SocialiteProviders/Microsoft` defaults to `common`; the Azure variant needs the tenant set explicitly.
**Prevention:** Authority is always `https://login.microsoftonline.com/{M365_TENANT_ID}/v2.0`; platform = Web; document secret creation date + expiry in the runbook and put a calendar reminder 30 days before; add a boot-time config validation that fails loudly when `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_REDIRECT_URI` are missing (and make the Microsoft button hidden when the integration is unconfigured, so upstream-style self-hosters are unaffected). Surface `invalid_client` distinctly in logs ("client secret expired?").
**Detection:** First end-to-end test on the real Dokploy URL, not just `localhost`.
**Phase:** P1.

### Pitfall 4: Redirect URI mismatch behind Dokploy/Traefik (http vs https, TRUSTED_PROXIES unset)
**What goes wrong:** Socialite builds `redirect_uri` from `route()`/`url()`. Behind Traefik the app sees plain HTTP unless forwarded headers are trusted. Entra rejects with `AADSTS50011` (redirect URI mismatch) - and Entra only allows `http://` for `localhost`.
**Why it happens (specific to this repo):** `config/trustedproxy.php` returns `proxies = []` unless `TRUSTED_PROXIES` is set, and `app/Http/Middleware/TrustProxies.php` has `$proxies = null`. So `X-Forwarded-Proto` is ignored by default (only `phpunit.xml` sets `TRUSTED_PROXIES=0.0.0.0/0,...`). The repo's escape hatch is `APP_FORCE_HTTPS=true` (`ForceHttps` middleware + `URL::forceScheme('https')`; `.env.production` sets it, `.env.example`/`.env.ci` do not). Also `SESSION_SECURE_COOKIE` defaults from `APP_FORCE_HTTPS`.
**Consequences:** Redirect URI mismatch, or worse, a working login that sets non-secure cookies.
**Prevention:**
- Do not derive the redirect URI from the request. Use an explicit `M365_REDIRECT_URI` env (full https URL) and register exactly that string in Entra (scheme, host, path, no trailing-slash drift; the comparison is exact apart from case).
- Set `APP_URL` to the public https URL, `APP_FORCE_HTTPS=true`, and `TRUSTED_PROXIES` to the Traefik network CIDR in Dokploy env. Add a startup/`/health`-style self-check or an artisan command `m365:check` that prints the effective redirect URI and warns if scheme != https.
- Keep `response_mode=query` (default). `form_post` is a cross-site POST and will NOT carry `SameSite=lax` session cookies, producing `InvalidStateException`.
- Register a second redirect URI for local dev (`http://localhost/...`) in the same app registration rather than a second app.
- Dokploy specifics: env vars are runtime for the container but `config:cache`d values and Octane worker memory persist - restart/redeploy after changing any `M365_*` var.
**Detection:** Login works on the public URL in a private window; inspect the `redirect_uri` query param on the Microsoft authorize URL.
**Phase:** P1 (config) with a smoke test in P2.

### Pitfall 5: Refresh-token handling - rotation races, `invalid_grant`, and silent expiry
**What goes wrong:**
- Entra returns a NEW refresh token on every refresh. If the code only stores the first token, the stored one eventually goes stale.
- The calendar page issues several parallel requests; two PHP workers refresh simultaneously with the same refresh token and one overwrites the other with an older value, or one gets `invalid_grant`.
- Access tokens (about 1h) are cached in a `static`/singleton property and survive past expiry or leak between users under Octane (see Pitfall 12).
- `invalid_grant`/`interaction_required` is treated as a generic 500. Real causes: password reset, user disabled, Conditional Access/MFA re-prompt (`AADSTS50076`, `AADSTS70043`), refresh token inactive too long (`AADSTS700082`), consent revoked.
- Conditional Access can allow a browser sign-in yet block the refresh from the server IP (e.g. location/compliant-device policies). VERIFY with Untangle's CA policies.
**Prevention:**
- Refresh inside a lock: `Cache::lock("m365:refresh:{$connection->id}", 10)` (needs a shared cache driver, not `array`) or `DB::transaction` + `lockForUpdate()` on the connection row; re-read the row after acquiring the lock and skip refresh if another worker already did it.
- Persist the rotated refresh token + `expires_at` + granted `scope` atomically.
- Refresh proactively when `expires_at - 120s` has passed; do not wait for a 401.
- Map failures to states: `needs_reauth` (invalid_grant/interaction_required) -> calendar shows a non-blocking "Reconnect Microsoft" banner and cached/empty suggestions; `revoked`/deleted. NEVER let a Graph auth failure break the time-entry calendar itself.
- Request `offline_access` (already in the scope list) - without it there is no refresh token and sync dies after an hour.
**Detection:** Unit tests with `Http::fake` for rotated token, `invalid_grant`, and two concurrent refreshes; manual test after resetting a test user's password.
**Phase:** P3.

### Pitfall 6: Graph event identity - mutable IDs and the series-master/occurrence/exception model
**What goes wrong:** Time-entry links, dismissals, and recurring rules are keyed on Graph `event.id`. Event IDs are NOT immutable by default (they change when the item moves between folders, e.g. into Archive or Deleted Items) and each occurrence has its own ID distinct from the series master's. Links silently break: dismissed meetings reappear, out-of-sync detection returns 404 and wrongly reports "cancelled", rules stop matching.
**Why it happens:** The Graph docs show `id` in every sample; the `Prefer: IdType="ImmutableId"` header is easy to miss.
**Prevention:**
- Send `Prefer: IdType="ImmutableId"` on EVERY Graph event request (including paged follow-ups and `$batch` sub-requests) and store ids obtained that way only.
- Use a composite *occurrence key* that survives edits: `seriesMasterId` + `originalStart` (UTC) for recurring occurrences/exceptions; plain immutable `id` for `singleInstance`. `originalStart` is the occurrence's start as originally generated (not returned for single instances), so a moved exception keeps its identity. Also store `iCalUId` as a fallback correlator. VERIFY the exact fields on a real recurring-meeting exception.
- Store a `key_type` column so single and recurring keys cannot collide, and unique-index `(user_id, occurrence_key)`.
**Detection:** Move a linked meeting between folders / edit one occurrence in Outlook and confirm the link still resolves.
**Phase:** P4 (data model), P5-P7 depend on it. Decide before any migration is written.

### Pitfall 7: Recurring series rules match on a NULL key, break on "this and following" edits, or expand wrongly
**What goes wrong:**
- `seriesMasterId` is null for single-instance events. A rule `where series_master_id = ?` evaluated as `null == null` assigns a project to every one-off meeting.
- In Outlook, "edit this and following events" SPLITS a series: the new tail gets a new master id (and new `iCalUId`). Existing rules go orphaned; users believe the rule "stopped working".
- Calling `/me/events` (non-expanded) and trying to compute occurrences yourself from `recurrence` (patterns, `index`, `firstDayOfWeek`, `exceptions`, DST) is a project in itself, and cancelled/modified occurrences are not discoverable from the list endpoint (`$expand` is ignored on the list call; `cancelledOccurrences` / `exceptionOccurrences` only come back on a GET of a single series master).
- Using `calendarView` but with a window that excludes the master's original start, then looking up the master separately and failing.
**Prevention:**
- Use `calendarView` (server-side expansion, bounded window) as the ONLY source of occurrences. Never implement RRULE expansion.
- Rules apply only when `seriesMasterId` is non-null, enforced in code AND with a DB check/unique constraint `(user_id, series_master_id)` where not null.
- Treat a rule as keyed to a series *plus* human-recoverable metadata (subject at creation, organizer, recurrence summary). When a rule has matched nothing for N weeks while a similar-titled new series exists, show "orphaned rule - re-link?" in the rule management UI instead of silently doing nothing.
- Rules pre-assign only; the user still confirms each occurrence (already a project decision). "Pre-assign current unassigned occurrences" must be a read-time computation over the already-fetched window, never a bulk insert of time entries.
- Rule resolution precedence: dismissed > already linked > rule > none. Test with an exception occurrence (`type=exception`): it keeps `seriesMasterId` so the rule should still apply.
**Detection:** Tests with fixtures covering `singleInstance`, `occurrence`, `exception`, `seriesMaster` (should not appear in calendarView at all - assert it is ignored if it does), and a split series.
**Phase:** P6.

### Pitfall 8: Timezone and DST errors - the most common source of "meeting appears an hour off"
**What goes wrong:**
- Graph returns `start`/`end` as `{ dateTime: "2026-10-26T09:00:00.0000000", timeZone: "..." }` with NO offset. Parsing `dateTime` with Carbon's default tz or `new Date(...)` in JS treats it as server/browser-local time. Ignoring the `timeZone` field shifts every event.
- Without a `Prefer: outlook.timezone="..."` header, times come back in UTC; with it, only `start`/`end` change (not `originalStartTimeZone`). The header is NOT preserved by `@odata.nextLink` - page 2+ can come back in another zone if not re-sent. VERIFY.
- Graph defaults to Windows zone names (`Romance Standard Time`) and sometimes legacy IANA aliases. Mapping tables are needed if you ever read the series master's `start.timeZone`.
- `calendarView` takes `startDateTime`/`endDateTime`; values without an offset are interpreted as UTC. Building a "this week" window in UTC for a user in Europe/Madrid misses the first/last hours of the user's week, and DST-change weeks are 167/169 hours long.
- Recurring meetings at 09:00 local keep 09:00 local across DST; the UTC instant moves. Computing future occurrences from a UTC master (or storing a rule as "every Tuesday 08:00 UTC") breaks after the change.
- The user's solidtime `timezone` (`users.timezone`, defaulted from IP lookup in `CreateNewUser`) is not the mailbox timezone, and reading mailbox tz needs `MailboxSettings.Read` which is outside the least-privilege scope list.
**Prevention:**
- Always send `Prefer: outlook.timezone="UTC"`; on every page; parse with `CarbonImmutable::parse($dateTime, 'UTC')` and verify `timeZone === 'UTC'` (throw/log otherwise); emit ISO-8601 with `Z` to the front end. Store only UTC instants (matches `time_entries.start/end`).
- Compute the query window in the USER's solidtime timezone (start-of-week/day -> UTC) then pad by 1 day each side and filter after expansion. Because `calendarView` returns events that merely OVERLAP the window, dedupe by occurrence key.
- Render in the user's solidtime timezone with the existing dayjs helpers (`getLocalizedDayJs`) - do not introduce a second tz library.
- Do not request `MailboxSettings.Read`. For a first-login timezone, reuse `CreateNewUser`-style behaviour (browser tz from the client, else IP lookup) and let the user change it.
- Add DST tests: week of last Sunday of March and October (Europe/Madrid), a 09:00 weekly recurring meeting crossing the change, and a meeting crossing midnight.
**Detection:** Fixtures with offsets; a meeting at 23:30 local near DST; compare ghost block vs Outlook visually.
**Phase:** P4 (ingestion), P5 (conversion to entry uses the same UTC instants).

### Pitfall 9: Duplicate time entries from races, retries, and bulk actions
**What goes wrong:** A meeting becomes two (or N) time entries: double-click, retry after a timeout, two browser tabs, bulk-assign overlapping a rule confirmation, or "Sync" button + calendar-open sync racing on upsert.
**Why it happens:** Conversion implemented as `TimeEntryService::create` + a separate link insert with no uniqueness guarantee.
**Prevention:**
- DB-level guarantee: link table `time_entry_meeting_links` with `UNIQUE (user_id, occurrence_key)` and `UNIQUE (time_entry_id)`. Create entry and link in ONE `DB::transaction`; on unique violation return the existing entry (idempotent 200/409), never 500.
- Accept an idempotency key / occurrence key in the assign endpoint; bulk assign processes each key in its own savepoint and returns per-item results (partial success is fine).
- Serialise sync per user with `Cache::lock("m365:sync:{$userId}", ...)`; if locked, return the cached result.
- Do not add columns to `time_entries` (see Pitfall 17); use the link table.
- Also dedupe the same meeting appearing twice for one user (organizer copy + attendee copy via distribution list or shared mailbox): correlate by `iCalUId + originalStart` before showing.
- Hide (or visibly mark) a ghost block when the user already has a manual/timer entry overlapping the same period - otherwise the user double-logs the same hour by hand and by conversion. At minimum show an overlap indicator.
**Detection:** Concurrency test (two parallel assign requests) asserting exactly one entry; Playwright double-click test.
**Phase:** P5.

### Pitfall 10: Out-of-sync detection that false-positives, false-negatives, or mutates data
**What goes wrong:**
- Comparing the time entry's start/end to the event: users routinely trim a 60-minute meeting to 45 minutes after conversion, so everything looks "out of sync" forever.
- Only checking events inside the viewed window: an event moved to another week or deleted is simply absent, indistinguishable from "not fetched".
- Treating absence as cancellation, or treating a 404 from a non-immutable id as deletion (Pitfall 6).
- Accidentally "fixing" the entry (touching `start/end/description`) - violates the hard data-safety rule.
**Prevention:**
- At conversion time store a SNAPSHOT on the link row: `event_start_utc`, `event_end_utc`, `event_subject_hash`, `response`, `is_cancelled`. Out-of-sync = current event snapshot differs from stored snapshot (compare instants at minute precision in UTC), NOT entry vs event.
- For linked entries inside the viewed window, do a targeted lookup of those events (Graph `$batch` of GET `/me/events/{id}`, max 20 per batch, per-item 429 handling). 404/`ErrorItemNotFound` or `isCancelled=true` -> `cancelled`; time changed -> `moved`; response became `declined` -> `declined`.
- Persist the flag on the link row (`sync_status`, `detected_at`, `acknowledged_at`), expose it through a SEPARATE endpoint/resource (Pitfall 17), and make the only user actions "Acknowledge" / "Re-link" / "Dismiss flag". No code path in the sync service may import `TimeEntryService` update/delete methods; enforce with an architecture test (`pest-arch`/phpstan rule or a simple grep test).
- Treat a failed Graph call as "unknown", never as "cancelled".
**Detection:** Test matrix: trim entry then no flag; move event then flag; delete event then flag; Graph 500 then no flag change; assert `time_entries` rows are byte-identical after sync.
**Phase:** P7.

### Pitfall 11: Graph throttling (429), pagination, and synchronous latency amplified by the "sync on open" design
**What goes wrong:**
- TanStack Query's default `refetchOnWindowFocus`/`refetchOnMount`/week navigation triggers a Graph fetch on every focus and every prev/next click. Outlook is throttled per app per mailbox (documented Outlook service limits are on the order of 10,000 requests/10 min and 4 concurrent requests per app per mailbox) and returns `429` with `Retry-After`; the "sync on open" model means each tab, each user, each navigation can contribute.
- `Http::retry(...)`/`sleep($retryAfter)` inside the web request holds a FrankenPHP worker for the whole `Retry-After` (often tens of seconds). A handful of users can starve all workers.
- Forgetting pagination: `calendarView` pages (default page size is small, tens at most); events beyond page 1 silently vanish on busy weeks. Following `@odata.nextLink` without re-sending headers (Pitfall 8) changes tz/ID type.
- Large `$select`-less payloads including `body` (HTML meeting bodies, privacy-sensitive and heavy).
- The default queue is `sync`, so queued fallbacks also run inline.
**Prevention:**
- Decouple the Graph fetch from the time-entries query: a dedicated endpoint `GET /api/v1/.../m365/meetings?start&end` with its own query key, `staleTime` of several minutes, `refetchOnWindowFocus: false`; the "Sync" button forces refresh with a server-side cooldown (e.g. 15-30 s).
- Server-side cache per `(user, window)` for 2-5 minutes (shared cache store) and serve stale on error with a `stale: true` flag.
- Never sleep on 429: on 429/503 read `Retry-After`, store `throttled_until` on the connection, return cached data immediately, and let the UI show "Outlook is busy, showing last sync".
- Strict HTTP timeouts on the Graph client (`connectTimeout(3)`, `timeout(10)`), the same discipline CONCERNS.md asks for (Gotenberg lacks it today).
- Cap window size (e.g. <= 42 days) and page count (e.g. 10 pages of 100 via `Prefer: odata.maxpagesize=100`); always `$select` only `id,iCalUId,seriesMasterId,type,subject,start,end,originalStart,isAllDay,isCancelled,isOrganizer,responseStatus,showAs,sensitivity,attendees(count only)`; never request `body`.

> Correction (Phase 1 spike, 2026-10-19): see docs/m365/DECISIONS-graph.md § Corrections to earlier research. Graph has no `attendees(count only)` projection; the production `$select` does not need `attendees`.
- Use `$batch` only for the linked-event lookups, and handle per-sub-request 429.
**Detection:** Load test with a stubbed Graph returning 429; watch for focus-refetch storms in the browser network tab.
**Phase:** P3 (client policy), P4 (endpoint + frontend query design).

### Pitfall 12: Octane / FrankenPHP state leakage with per-user OAuth state
**What goes wrong:** Any service that stores a user's access token, `GraphClient`, request, or selected organization in a singleton or `static` property serves user A's calendar to user B on the next request in that worker. The same applies to Socialite: `Socialite::driver('microsoft')` is resolved through a manager that caches driver instances; `scopes()`, `with()`, `stateless()`, `redirectUrl()` mutate the cached instance and the driver holds a request reference captured at construction. (Exact leak behaviour per Socialite version is not confirmed here - VERIFY.)
**Why it matters here specifically:** The repo already has this class of debt (`PermissionStore::$customRolePermissions`, `UserAgentDto` static arrays in CONCERNS.md) and `phpstan.neon` enables `checkOctaneCompatibility`. A new integration is the easiest place to add a new leak.
**Prevention:**
- Bind Graph-related services with `scoped()` (not `singleton()`), take the connection/user as a method argument, never as a constructor-captured property of a long-lived object.
- No `static` caches, no `private array $cache` on singletons keyed without user id; cache keys must include `user_id` + `tenant`.
- Build the Socialite/OAuth provider per request (resolve inside the controller action, call `setRequest($request)` or use a thin own OIDC client with Guzzle/`league/oauth2-client`) and never call `->stateless()` to "fix" a session problem (it disables the `state` CSRF check).
- Keep the Octane `max-requests` recycle as a safety net; add a test that logs in as two users in one process (`refreshApplication` is NOT called between requests in a worker, so use two requests in one test) and asserts no cross-over.
- Config changes (secrets/redirect) need a worker reload.
**Detection:** phpstan Octane check passes on new code; manual test with two browsers against one worker (`OCTANE` with 1 worker).
**Phase:** P2 (login driver), P3 (Graph client); re-checked in P8.

### Pitfall 13: Token storage mistakes (varchar overflow, audits, APP_KEY rotation, fake revocation)
**What goes wrong:**
- `encrypted` cast ciphertext is base64 JSON with MAC; a Microsoft refresh token (often >1,000 chars, can grow) encrypted exceeds `varchar(255)`. Column must be `text`.
- `owen-it/laravel-auditing` records old/new attribute values: token columns get written to the audit log in plaintext (the model's `$hidden` does not stop auditing). Use `$auditExclude`, or do not make the model `Auditable` at all.
- Tokens leak through `Http` exception messages, Telescope, Sentry/log context, and `dd`/`Log::debug($response->json())` of the token endpoint response.
- `APP_KEY` rotation makes every stored refresh token undecryptable. Laravel supports `APP_PREVIOUS_KEYS`, but the column can only be re-encrypted by touching every row.
- Expecting RFC 7009-style revocation: Entra v2 does not provide a per-refresh-token revoke endpoint. "Revoke on disconnect/deletion" realistically means: delete the local ciphertext and (optionally, needs admin) remove the user's `oauth2PermissionGrant`. Do NOT call `revokeSignInSessions` - it signs the person out of everything in Microsoft 365.
- The refresh token stored on `users` or in the session (session `encrypt` is false in `config/session.php`).
**Prevention:** Separate `microsoft_connections` table (`user_id` unique FK, `refresh_token` text + `encrypted` cast, `access_token` either not stored or encrypted with short TTL, `scope`, `expires_at`, `status`, `tid`, `oid`); `$hidden` + `$auditExclude`; scrub in the app's exception reporter; document backup + key separation; `DeletionService` gets an explicit step to delete the connection and identity rows (it already deletes Passport tokens explicitly - mirror that); a disconnect button deletes locally and documents that consent remains in the user's "My Apps"/tenant until removed there.
**Detection:** A test that updates a connection and asserts the audit table contains no token substring; a test that deleting a user removes connection rows.
**Phase:** P3 (storage), P8 (deletion/disconnect).

---

## Moderate Pitfalls

### Pitfall 14: Consent: `Calendars.Read` needing admin approval, and coupling login to calendar consent
**What goes wrong:** Delegated `Calendars.Read` normally does not require admin consent, but hardened tenants disable user consent or restrict it to verified publishers; users then hit `AADSTS65001`/`AADSTS90094` ("Need admin approval") at login. Because the project asks for `Calendars.Read` in the same authorization as login, a consent failure also blocks login.
**Prevention:** Have an Untangle Global/Application Admin click "Grant admin consent for Untangle" on the app registration during P1 (pre-consent for all users) and verify with a non-admin test user. Consider requesting only `openid profile email offline_access User.Read` at login and a second "Connect Outlook calendar" step for `Calendars.Read` so a consent problem degrades the feature, not sign-in. Never request application permissions (tenant-wide mailbox read) and never `Calendars.ReadWrite`. Store granted `scope` from the token response and re-check on each refresh to detect drift. (`Calendars.ReadBasic` omits properties such as recurrence/attendees - do not use it for series detection. VERIFY.)
**Phase:** P1 (consent), P2/P3 (flow split decision).

### Pitfall 15: Event filtering rules that don't mean what they say
**What goes wrong:**
- "Organized by the user" (`isOrganizer`/`responseStatus.response = organizer`) includes personal calendar blocks with no attendees (focus time, lunch, reminders, travel blocks), which are the bulk of noise for many people.
- `responseStatus.response` values: `none` (appointment with no invitation), `organizer`, `accepted`, `tentativelyAccepted`, `declined`, `notResponded`. `none` and `notResponded` are different and easy to conflate. Users who attended a Teams meeting without responding are `notResponded` and are silently dropped.
- Declined events: Outlook may remove them from the calendar or keep them; either way they must be filtered client-side, and a decline AFTER conversion is an out-of-sync case (Pitfall 10).
- Cancelled meetings: a cancelled single-instance meeting may remain with `isCancelled=true` until the cancellation message is processed; cancelled occurrences of a series are typically absent from `calendarView`. How each appears depends on mailbox settings - VERIFY with a test mailbox before encoding the rule.
- `showAs`: `free`, `workingElsewhere`, `oof` are usually not billable meetings.
- All-day events: `isAllDay=true` with midnight-to-midnight (end exclusive, in the event's own timezone, can span several days). Filter on `isAllDay`, but ALSO guard against timed multi-day events (a 2-day conference that is not all-day) by capping suggested duration or clipping to a max.
- `sensitivity` private/confidential: copying the subject into the time entry description exposes a "Doctor"/"Interview" title to org admins and reports.
**Prevention:** Encode the filter as one pure, unit-tested `MeetingRelevance` class with an explicit decision table (input: type, isOrganizer, attendee count, response, isCancelled, isAllDay, showAs, sensitivity, duration). Keep `attendees` server-side only (count), never persist or send names. Default-redact titles for `sensitivity != normal` ("Private meeting") and exclude by default. Only the default calendar for v1 (`/me/calendarView`); other calendars (`/me/calendars/{id}/calendarView`) explicitly deferred. Test with real Untangle mailbox exports.
**Phase:** P4.

### Pitfall 16: Conversion semantics - ghost blocks must never leak into tracked time
**What goes wrong:** Ghost blocks reuse the calendar event type and get included in totals, drag/resize handlers, "running timer" logic, or `GET time-entries`-based reports; drag on a ghost mutates nothing but looks editable; the ghost and its converted entry both render.
**Prevention:** Separate data source and separate event class in the FullCalendar layer (distinct `editable:false`, `classNames`, `extendedProps.kind='suggestion'`), excluded from every aggregation by construction (they never touch `time_entries`). Remove the ghost as soon as a link exists (match by occurrence key, not by time overlap). Converted entry copies title as description only after the sensitivity rule. Respect org time rounding settings only at reporting time (do not pre-round meeting durations).
**Phase:** P4/P5.

### Pitfall 17: Fork mergeability - editing hot spots and generated artifacts
**What goes wrong:** Adding `microsoft_*` columns to `users`/`time_entries`, a field to `TimeEntryResource`, routes in `routes/api.php`, bindings in `AppServiceProvider`, edits to `FortifyServiceProvider` and `TimeEntryController` (985 lines), plus a hand-merged `openapi.json`/`openapi.json.client.ts`/`composer.lock`/`package-lock.json`: every upstream sync conflicts.
**Prevention:**
- New code under a dedicated namespace/directory not used by upstream or the `extensions/` modules (e.g. `app/Fork/Microsoft365/` or `app/Integrations/Microsoft365/`), with its own `Microsoft365ServiceProvider` (routes via `loadRoutesFrom`, config via `mergeConfigFrom`, migrations via `loadMigrationsFrom`) registered by ONE line in `bootstrap/providers.php` (or the existing provider list).
- Config in `config/m365.php`, not `config/services.php`. New tables only (`microsoft_identities`, `microsoft_connections`, `meeting_links`, `meeting_dismissals`, `meeting_series_rules`), prefixed to avoid collision with upstream modules (e.g. `Invoicing`); no columns on upstream tables.
- Expose sync flags through a separate resource/endpoint and join client-side, so `TimeEntryResource`/`openapi.json` stay untouched; if the API surface must change, regenerate with `npm run zod:generate` rather than hand-editing.
- Frontend: unavoidable touchpoints are `Calendar.vue`, `TimeEntryCalendar.vue`, and the login page. Keep each change to a few lines that mount a fork-owned component/composable (`useMeetingSuggestions.ts`, `MeetingGhostLayer.vue`), not inline logic.
- Rebase/merge `main` (upstream) into the feature branch regularly (e.g. after each phase), and keep `.planning/` commits separable (`gsd-pr-branch`).
- Do not touch the CI workflows (`build-*.yml`, extension checks) - keep fork edits out of them as CONCERNS.md advises.
**Phase:** Constraint on all phases; audit in P8.

### Pitfall 18: SSO session handling vs Fortify (2FA, session, current organization)
**What goes wrong:**
- SSO login via `Auth::login()` skips Fortify's 2FA challenge (acceptable because Entra enforces MFA, but must be a conscious decision; and for LINKED accounts that already had TOTP, document it).
- Forgetting `$request->session()->regenerate()` after login (session fixation).
- New user without `current_team_id` / org -> every page 403s or redirects in a loop. Creating a user directly with `User::create` skips `UserService::createUser` defaults (timezone, week start, personal organization via `makeSureUserHasAtLeastOneOrganization`); `createUser` requires a password, so generate a random one.
- Filament admin `impersonate` (production dependency `stechstudio/filament-impersonate`, `canBeImpersonated` on `User`): an admin impersonating a user opens `/calendar`, which triggers a Graph sync with THAT user's token and shows the admin the user's private calendar.
- The calendar endpoint is also reachable with Passport bearer tokens/PATs from other clients; it must be authorized on the token's user and not exposed cross-member (a manager must never see another member's meetings through an "all members" time-entries style filter).
**Prevention:** Route SSO user creation through `UserService`/`MemberService` (Pitfall 1); regenerate session; set current organization via `UserService::makeSureUserHasCurrentOrganization`/`switchCurrentOrganization`; deny Graph endpoints (return empty + no token use) while impersonating (check the impersonation session marker) ; scope all meeting endpoints strictly to `auth()->user()` with no member-id parameter.
**Phase:** P2, P3.

### Pitfall 19: Callback robustness and CSRF/state
**What goes wrong:** `InvalidStateException` 500s when users open the login in two tabs, hit Back, or the Dokploy container restarts mid-flow (session driver/cache not shared); code reuse (`AADSTS54005`) after a double-submit; missing PKCE; `->stateless()` used as a shortcut; open redirect via a `redirect` query param captured into the state.
**Prevention:** Validate `state` (default Socialite behaviour - do not disable), enable PKCE (`enablePKCE()` where available; verify for the chosen provider package), catch `InvalidStateException`/`ClientException`/`AADSTS*` errors and redirect to `/login` with a human message, never a stack trace; store only a relative "intended" path server-side in session. Confirm `SESSION_DRIVER` is shared across replicas.
**Phase:** P2.

---

## Minor Pitfalls

### Pitfall 20: Display-name and email drift
**What goes wrong:** Overwriting `name`/`email` from Graph on every login clobbers user edits or collides with the partial unique index when an email alias changes.
**Prevention:** Set name once at provisioning; never auto-update email; log mismatches. Keep `(tid, oid)` as truth.

### Pitfall 21: Dismissals keyed on mutable data
**What goes wrong:** Dismiss stored by title/time reappears when the meeting is edited.
**Prevention:** Key dismissals on the occurrence key (Pitfall 6). Offer "dismiss this occurrence" vs "dismiss whole series" explicitly (series dismiss = rule with project NULL).

### Pitfall 22: Persisting events as rows and drifting from Outlook
**What goes wrong:** A `meetings` table caching events needs deletion/staleness logic; cancelled meetings linger as ghosts because nothing removes them.
**Prevention:** Prefer an ephemeral model: do not persist events; persist only decisions (links with snapshot, dismissals, rules). Cache raw responses with short TTL only.

### Pitfall 23: Observability gap on outbound calls
**What goes wrong:** CONCERNS.md notes there is no outbound-integration audit trail. A failing Graph integration looks like "calendar empty".
**Prevention:** Log every Graph/token call outcome with correlation id, HTTP status, duration, `request-id`/`client-request-id` headers (Microsoft support asks for these), never tokens/subjects. Show last sync time + status in the UI.

### Pitfall 24: Test strategy relies on live Microsoft
**What goes wrong:** Tests call real Graph, are flaky, or never cover 429/410/404/invalid_grant paths.
**Prevention:** Put Graph behind an interface (`CalendarProvider`) with a fake implementation + `Http::fake` fixtures captured from a real mailbox (single, series, exception, cancelled, all-day, DST week). Use `Http::preventStrayRequests()` in the test suite for this namespace.

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| P1 Entra + infra | Wrong authority / SPA vs Web platform / secret expiry (3); redirect URI over http behind Traefik (4); no admin consent (14); guests allowed (2) | Single-tenant authority, Web platform, explicit `M365_REDIRECT_URI`, `TRUSTED_PROXIES` + `APP_FORCE_HTTPS=true`, admin-consent click, "Assignment required" + group, secret-expiry reminder |
| P2 SSO login | Email-based linking / pre-registration takeover (1); guest provisioning (2); Fortify/2FA/session/org setup (18); state/PKCE (19); Octane driver leak (12) | `(tid,oid)` identity table, tid + domain gate, verified-only linking, `MemberService::addMember`, per-request driver, no `stateless()` |
| P3 Tokens + Graph client | Rotation race / `invalid_grant` (5); varchar/audit/revocation (13); throttling + timeouts (11); Octane singleton (12) | Locked refresh, `needs_reauth` state, text + encrypted + `$auditExclude`, 3s/10s timeouts, never sleep on 429, scoped bindings |
| P4 Ingestion + ghost UI | Mutable IDs (6); timezone/DST/overlap windows (8); filter semantics (15); focus-refetch storms (11); ghost leaking to totals (16) | ImmutableId header, UTC everywhere, user-tz window with padding, `MeetingRelevance` decision table, dedicated query w/ staleTime, separate event class |
| P5 Assign/dismiss | Duplicate entries (9); private titles (15) | Unique link constraints in the same transaction, idempotent bulk, redaction |
| P6 Recurring rules | NULL series key, split series, self-made expansion (7) | `calendarView` only, non-null guard + constraint, orphaned-rule UI, read-time application |
| P7 Out-of-sync | False positives/negatives, 404 vs deleted, auto-mutation (10) | Snapshot-vs-snapshot, batch lookups for linked events, "unknown on error", arch test forbidding writes |
| P8 Hardening | Deletion/disconnect and false revocation (13); admin impersonation reading calendars (18); fork merge hygiene (17); observability (23) | `DeletionService` step, impersonation guard, merge-test of upstream, outbound logging |

## Research Flags for Roadmap

- **P4 needs targeted verification** against a real Untangle mailbox: how cancelled single meetings, cancelled occurrences, declined events, exceptions, and `originalStart`/`seriesMasterId` appear in `calendarView`; whether `Prefer` headers survive `nextLink`; exact `IdType="ImmutableId"` behaviour on `calendarView`. Budget a short spike (use `gsd-spike`) with captured JSON fixtures.
- **P2/P3 need a quick decision spike** on library choice (Socialite + `socialiteproviders/microsoft-azure` vs a thin custom OIDC/`league/oauth2-client` client) judged by: tenant-pinning, PKCE, id_token `tid`/`oid` access, Octane safety.
- **P1 needs an Untangle-admin action** (admin consent, assignment required, redirect URIs, secret creation) - schedule it early; it is outside the code and blocks everything.
- Standard patterns, unlikely to need deeper research: P5 conversion/dismiss (mostly internal), P8 deletion wiring.

## Sources

- [nOAuth: abuse of unverified Entra email claim - Cyber Security News](https://cybersecuritynews.com/noauth-abuse-leads-to-full-account-takeover/amp/) - MEDIUM
- [Semperis research on nOAuth](https://www.semperis.com/press-release/research-risk-noauth-vulnerability-microsoft-entra-id-enterprise-saas-applications/) - MEDIUM
- [The nOAuth Fix: How to Stop Entra ID Account Takeovers - Cayosoft](https://www.cayosoft.com/?p=71186) - MEDIUM
- [How to sync Microsoft Outlook calendar events using the Graph API (the parts Microsoft doesn't tell you) - nocal](https://nocal.app/blog/2026/07/microsoft-graph-calendar-sync-guide) - MEDIUM (third-party; recurring exceptions/cancellations, `Prefer` headers, delta, tz mapping)
- [Microsoft Graph calendarView guide - Nylas CLI](https://cli.nylas.com/guides/microsoft-graph-calendar-view) - MEDIUM (event `type` values, expansion behaviour, `Prefer: outlook.timezone`)
- [Microsoft Q&A threads on calendarView / recurring events](https://learn.microsoft.com/en-us/answers/questions/1079692/microsoft-graph-)-how-to-get-all-events-of-a-day-(also-recurring-events)) - MEDIUM
- Codebase (HIGH): `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `app/Http/Middleware/TrustProxies.php`, `app/Http/Middleware/ForceHttps.php`, `config/trustedproxy.php`, `config/session.php`, `database/migrations/2014_10_12_000000_create_users_table.php`, `app/Actions/Fortify/CreateNewUser.php`, `app/Service/MemberService.php`, `app/Service/UserService.php`, `app/Models/User.php`
- From established Microsoft identity/Graph documentation knowledge, not re-fetched this session (MEDIUM, flagged VERIFY where uncertain): Outlook throttling limits and `Retry-After`, `Prefer: IdType="ImmutableId"`, Entra refresh-token rotation and absent revocation endpoint, `AADSTS` error meanings, `responseStatus.response` enum, `sensitivity` values, `Calendars.ReadBasic` scope content.
