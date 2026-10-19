# Phase 1: Tenant Setup & Outlook Spike - Research

**Researched:** 2026-10-19
**Domain:** Microsoft Entra ID app registration (single tenant, Web platform, delegated Graph scopes) + Outlook calendar fixture capture via Microsoft Graph `calendarView`
**Confidence:** MEDIUM-HIGH (HIGH on Entra portal paths, consent/assignment semantics and Graph property definitions, all read from Microsoft Learn this session; MEDIUM on Spanish UI labels, which Learn machine-translates inconsistently; the actual Outlook behaviour for cancelled/declined/moved/split events is deliberately UNKNOWN and is the point of the spike)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Admin guide (explicit user request)**
- **D-01:** Deliver a step-by-step guide **in Spanish** for Untangle's M365 admin (who is not a developer) to register the app in the Entra admin center. It must cover: Web platform (not SPA), single tenant, redirect URIs for local dev and the Dokploy HTTPS URL, delegated permissions `openid profile email offline_access User.Read Calendars.Read`, granting tenant-wide admin consent, enabling "Assignment required" + assigning the staff group, creating the client secret and recording its expiry date (+ renewal reminder ≥30 days before), reviewing Conditional Access policies that affect the app, and preparing the test mailbox with the 8 scenarios. It must end with a checklist of exactly what to hand back (tenant ID, client ID, secret via secure channel, secret expiry date, group name, CA findings, test mailbox address) and how to hand it back securely (never via repo/chat in plain text).
- **D-02:** The guide lives in the repo (e.g. `docs/m365/`), is written so the admin can follow it without asking questions (exact menu paths in the Entra admin center, what to click, what values to paste, screenshots-not-required wording), and includes a short "why" per step so the admin understands the security intent.
- **D-03:** A separate runbook (can be Spanish too) records the resulting registration values that are not secret (tenant ID, client ID, redirect URIs, scopes, group, secret expiry date) and the secret renewal procedure. Secrets never committed.

**Test mailbox scenarios**
- **D-04:** The 8 scenarios: single meeting; recurring series with one edited occurrence (exception); cancelled meeting; declined meeting; moved meeting (time changed after creation); private meeting; all-day event; personal block without attendees. The guide must explain to the admin how to create each in Outlook (some require a second account as organizer: cancelled/declined/moved-by-organizer).

**Spike harness and fixtures**
- **D-05:** Fixtures are captured with a minimal, throwaway-but-committed spike harness (e.g. an Artisan command or script outside the product module) using the delegated flow with the scopes above, `Prefer: outlook.timezone="UTC"` and `Prefer: IdType="ImmutableId"`, following `@odata.nextLink`. Fixtures are sanitized (no real names, emails, subjects, bodies, join URLs, tokens) before commit and stored under `tests/Fixtures/M365/` (or similar) for `Http::fake` in later phases.
- **D-06:** The decision document (e.g. `docs/m365/DECISIONS-graph.md` or under `.planning/`) fixes: occurrence key, series key (`seriesMasterId` vs alternatives), how cancelled/declined/moved/private/all-day appear, ImmutableId behaviour across nextLink, whether `Calendars.ReadBasic` would suffice (informational only — PROJECT.md keeps `Calendars.Read`).

**Locked from PROJECT.md**
- **D-07:** Single tenant Untangle only; never `common`/`organizations`.
- **D-08:** Deployment target is Untangle's own Dokploy (HTTPS behind proxy); redirect URI must be explicit and https.

### Claude's Discretion
- Exact file names/locations for guide, runbook, decision doc, fixtures and harness.
- Whether the spike harness uses Socialite or a raw OAuth code flow (it is throwaway; Phase 2 builds the real login).
- How the plan models waiting on the admin (human-action checkpoints are expected; tasks that need tenant credentials must be gated behind them).

### Deferred Ideas (OUT OF SCOPE)
- Real Microsoft login, token storage, Graph client — Phase 2/3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SETUP-01 | Entra ID app registration exists (Web platform, single tenant, "assignment required" with an Untangle group, redirect URIs local + Dokploy, delegated scopes, admin consent granted) and is documented in a runbook incl. client-secret expiry date | Section "Entra Admin Center Reference" (exact paths + EN/ES labels), "Admin Guide Content Spec", Global-Admin-bypass and P1/P2 pitfalls, secret lifetime facts, harness `auth` command as the machine check that the registration works and returns exactly the configured scopes |
| SETUP-02 | Real `calendarView` responses recorded as fixtures for the 8 scenarios | Section "Outlook Scenario Playbook" (how to create each, who organizes, expected Graph shape as hypotheses), two-round capture protocol, harness design, sanitization approach, fixture layout |
| SETUP-03 | Written decision on occurrence key, series key, cancelled/moved appearance | Section "Decision Document Inputs" (the exact questions the fixtures must answer, with the experiments that answer them), documented Graph property semantics |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `./.claude/CLAUDE.md` (read this session):
- Laravel 13 / PHP 8.3, Vue 3 + Inertia, PostgreSQL 15; follow `.planning/codebase/CONVENTIONS.md`. Every PHP file starts with `declare(strict_types=1);`; Pint preset `laravel`; test methods `test_snake_case` with `// Arrange / Act / Assert`; `Http::preventStrayRequests()` is active globally in `tests/TestCase.php`.
- Prettier: 4 spaces, single quotes, `printWidth: 100`, `trailingComma: "es5"`; `.editorconfig` LF, UTF-8, final newline. `npm run format:check` runs prettier over `./**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts,vue}` (so any committed `.mjs` harness is format-checked).
- PHPStan level 7 over `app/` only; `env()` forbidden outside `config/` (irrelevant for a Node harness; relevant if a PHP harness were chosen).
- Security constraints: tokens never in logs/audits/repo; state + PKCE validated; Graph scopes minimal (`openid profile email offline_access User.Read Calendars.Read`); Data safety: Outlook changes never alter time entries.
- Mergeability: avoid editing upstream hot spots (`routes/web.php`, `AppServiceProvider.php`, `.dockerignore`, root `.gitignore`...). New files only in this phase.
- GSD workflow enforcement: file edits happen through GSD commands (this research is produced inside `/gsd-plan-phase`).
- No project skills found (`.claude/skills/` etc. absent per CLAUDE.md "Project Skills").

## Summary

Phase 1 produces no product code. It produces four artifacts: (1) a Spanish admin guide, (2) a non-secret runbook, (3) sanitized Graph fixtures plus a throwaway capture harness, and (4) a decision document. The only part Claude can finish without tenant access is the guide, the harness code, the sanitizer, the validators, and empty skeletons of the runbook/decision doc. Everything else is gated behind human checkpoints (admin registers the app, admin creates the mailbox scenarios, admin applies a second round of mutations).

Three findings change how the plan should be structured. **First**, the capture needs *two rounds*: a baseline (everything created and accepted) and a post-mutation round (edit one occurrence, cancel, decline, move, split a series). The decision document needs before/after pairs with the *same immutable id* to prove id stability, to see whether an edited occurrence keeps its id, and to learn whether a cancelled/declined event vanishes from `calendarView` or stays with a flag. Microsoft documents none of the cancelled-for-attendee behaviour, and no source found says what an attendee's `calendarView` returns after a cancellation [CITED: web searches this session found only organizer-side docs]. **Second**, the recommended harness is a zero-dependency Node ESM script (authorization code + PKCE + client secret, loopback redirect `http://localhost`, tokens in memory only), not an Artisan command or route: PHP, Composer and Docker are not on PATH on this Windows host, Node 24 is [VERIFIED: bash `which php composer docker` returned "no ... in PATH"; `node --version` → v24.13.1], and a Node script touches no core file and does not ship in the production image. **Third**, the Entra tenant has two sharp edges the guide must call out: *Global Administrators bypass "Assignment required"* (so the "outsider is blocked" test must use a non-admin test user), and *group-based assignment needs Entra ID P1/P2* with no nested-group support [CITED: learn.microsoft.com/entra/identity/enterprise-apps/assign-user-or-group-access-portal].

Two assumptions in earlier project research need correcting before Phase 3 relies on them. `STACK.md` selects `lastModifiedDateTime` in `$select`, but the Graph docs say `createdDateTime` and `lastModifiedDateTime` "don't support `$select`" on calendarView [CITED: learn.microsoft.com/graph/api/calendar-list-calendarview]. `PITFALLS.md` suggests `attendees(count only)`; Graph `$select` has no such projection [ASSUMED]. The spike must run the exact production `$select` string and record what the service does.

**Primary recommendation:** Plan five plans in this order: (1) tenant-free deliverables (guide, skeletons, harness, sanitizer, validators), (2) admin checkpoint + registration verification via `capture.mjs auth`, (3) Round A capture, (4) admin mutation checkpoint + Round B capture + sanitize + commit fixtures, (5) decision document derived from the fixtures + final validation. Never let a task that needs tenant credentials run before its checkpoint.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App registration, consent, assignment, secret | Entra admin center (tenant config; human admin) | — | Not code. Only a tenant admin role can do it; repo holds docs only |
| Who may sign in (assignment required, groups) | Entra ID (enforced by IdP) | App code (Phase 2 `tid`/guest checks) | Entra rejects unassigned users with AADSTS50105 before the app sees a code |
| Token acquisition for the spike | Local CLI harness (Node) | Entra authorize/token endpoints | Delegated auth-code + PKCE; tokens live only in process memory |
| Calendar data source | Microsoft Graph `calendarView` | — | Server-side recurrence expansion; never reimplement |
| Fixture sanitization | Local CLI (offline step, deterministic) | PHPUnit/Node validators | Raw data never leaves the developer machine; only allow-listed fields are written |
| Fixture consumption | Test layer (`tests/Fixtures/M365/` + `Http::fake`) | — | Later phases (3-6) replay fixtures; no live Graph in CI |
| Decision record | Repo docs (`docs/m365/DECISIONS-graph.md`) | `.planning/` | Must cite fixture files so claims are checkable |
| Secret hand-over and renewal reminder | Humans / password manager / calendar | Runbook (dates only) | Secrets never in repo; runbook stores expiry date and procedure |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (`node:http`, `node:crypto`, global `fetch`) | Node >= 20.6 (host has v24.13.1) | Spike harness: loopback listener, PKCE, HTTPS to Entra + Graph | Zero dependencies, nothing added to `composer.lock`/`package-lock.json`, works on this Windows host; repo CI already uses Node 20 [VERIFIED: `.planning/codebase/STACK.md` "Node.js 20.x in CI"]; `--env-file` needs Node >= 20.6 [ASSUMED] |
| Microsoft Graph v1.0 REST | `https://graph.microsoft.com/v1.0` | `GET /me/calendarView`, `GET /me/events/{id}`, `GET /me/events/{id}/instances`, `GET /me` | Same endpoints Phases 3-6 will call [CITED: learn.microsoft.com/graph/api/calendar-list-calendarview] |
| Microsoft identity platform v2.0 | tenant-specific `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{authorize,token}` | Authorization code + PKCE + `client_secret` (Web platform) | Exactly the flow Phase 2 implements via Socialite [CITED: learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow] |
| PHPUnit 12 + Laravel `Http::fake` | repo-locked | Fixture loader test (`tests/Unit/M365/`) | Existing test stack [VERIFIED: `.planning/codebase/TESTING.md`; `phpunit.xml:8-10` `<testsuite name="Unit"><directory>tests/Unit</directory>`] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node --test` (built-in test runner) | Node >= 20 | Offline validators for sanitizer + fixtures when PHP is unavailable | Wave 0 gate that runs on this host today |
| Prettier (already a devDependency) | repo-locked | Format the `.mjs` harness so `npm run format:check` stays green | Always: `package.json:20` formats `./**/*.{...mjs...}` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node script (recommended) | Artisan command with raw `Http` | PHP not available on this host; command would live under `app/Console/Commands` and ship in the prod image; needs a running app + `.env` |
| Node script | Artisan + Socialite | Adds `laravel/socialite`, `socialiteproviders/*` to `composer.lock` before Phase 2's Laravel 13 smoke test; touches `config/app.php`; rejected |
| Node script | Temporary route in `routes/web.php` | Edits an upstream hot spot, needs the whole app + DB + HTTPS callback; highest risk; rejected |
| Node script | Graph Explorer | Uses Microsoft's own multi-tenant app, which needs its own consent in Untangle's tenant and does not prove *our* registration; no scripted nextLink loop, sanitizer or lookups. Fine for ad-hoc `$select` experiments only [ASSUMED] |
| Auth code + PKCE | Device code flow | Requires **Allow public client flows = Yes** on the registration; widens attack surface (see Security Domain). Do not enable on the production registration |

**Installation:** none. No external packages are installed in this phase.

**Version verification:** no registry packages recommended. Runtime check: `node --version` on the capturing machine (>= 20.6).

## Package Legitimacy Audit

No external packages are installed in this phase (Node built-ins only; no `composer require`, no `npm install`). `gsd_run query package-legitimacy check` was not run because there is nothing to check.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Untangle M365 admin (human)                          Developer machine (Windows, Node 24)
 ───────────────────────────                          ────────────────────────────────────
 docs/m365/GUIA-ADMIN-ENTRA.md ──steps──► Entra admin center
   1 register app (Web, single tenant)                       │ hands back (secure channel):
   2 redirect URIs + API permissions + admin consent         │ tenant ID, client ID, secret,
   3 secret (expiry noted)                                   │ expiry date, group, CA findings,
   4 enterprise app: Assignment required + group             ▼ test user A address
   5 CA review (sign-in log "Conditional Access" tab)    tests/Tools/m365-spike/.env.local  (gitignored)
   6 create test users A (in group) and B (NOT in group)         │
   7 build 8 scenarios (+extras) in Outlook ── Round A ready ───┘
                                                                 ▼
            ┌───────────────────── capture.mjs auth ──────────────────────────┐
            │ browser (InPrivate, login_hint=A) ◄─ authorize (PKCE S256,state)│
            │ loopback http://localhost:8765/m365-spike/callback ─ code ─►    │
            │ POST /token (client_secret + code_verifier) → tokens IN MEMORY  │
            │ checks: scope set == configured, id_token tid, GET /me userType │
            └──────────────────────────────┬──────────────────────────────────┘
                                           ▼
            capture.mjs capture --round A|B  (one interactive login per round)
               GET /me/calendarView  (Prefer: outlook.timezone="UTC", IdType="ImmutableId")
                 ├─ production-shaped $select, $top=3  → follow @odata.nextLink (headers re-sent)
                 ├─ experiment: page 2 WITHOUT Prefer headers
                 ├─ experiment: same window WITHOUT IdType header (id format comparison)
                 ├─ no-$select full-shape pass (allow-listed fields only survive)
                 ├─ GET /me/events/{seriesMasterId}  (+ /instances)
                 └─ Round B only: GET /me/events/{id} for every Round A id (200/404/isCancelled)
                                           ▼
            tests/Tools/m365-spike/raw/            (gitignored: real data, salt, identity map)
                                           ▼  sanitize.mjs  (allow-list + HMAC pseudonyms, offline, deterministic)
            tests/Fixtures/M365/…                  (committed: sanitized JSON + manifest.json)
                                           ▼
            validate-fixtures.mjs  /  tests/Unit/M365/CalendarViewFixturesTest.php  (Http::fake replay)
                                           ▼
            docs/m365/DECISIONS-graph.md  (every claim cites a fixture path)   docs/m365/RUNBOOK-entra-app.md
```

### Recommended Project Structure

All new files; no upstream file edited.

```
docs/m365/
├── GUIA-ADMIN-ENTRA.md            # Spanish step-by-step admin guide (D-01, D-02)
├── RUNBOOK-entra-app.md           # non-secret registration values + secret renewal (D-03)
└── DECISIONS-graph.md             # fixture-backed decisions (D-06)
tests/Tools/m365-spike/            # harness; `tests` is already in .dockerignore
├── README.md
├── capture.mjs                    # commands: auth | capture --round A|B | sanitize
├── lib/{pkce,oauth,graph,sanitize,scenarios}.mjs
├── validate-fixtures.mjs          # offline gate (runs without PHP)
├── .env.local.example             # names only, no values
└── .gitignore                     # `.env.local` and `raw/`   (nested file, root .gitignore untouched)
tests/Fixtures/M365/
├── README.md                      # provenance, sanitization rules, "synthetic" markers
├── manifest.json                  # scenario → files → predicates + observed behaviour
├── me.json                        # GET /me?$select=… (sanitized) for Phase 2 Http::fake
├── token-response.shape.json      # key names + scope string + booleans only, no values
├── calendarview/                  # paged windows (prod $select), id-format and no-Prefer experiments
├── scenarios/                     # per-scenario extracts S1..S8 (+E*) round A and round B
├── series/                        # master + instances
└── lookups/                       # GET /me/events/{id} results from Round A ids (status + body/error code)
tests/Unit/M365/CalendarViewFixturesTest.php
```

Why `tests/Tools/`: `tests` is in `.dockerignore` (so the harness never enters the image) [VERIFIED: `.dockerignore:16` "tests"; `.dockerignore:14` "docs"], PHPUnit's Unit suite only scans `tests/Unit` [VERIFIED: `phpunit.xml:9`], and PSR-4 `Tests\\` → `tests/` ignores `.mjs`/`.json` [VERIFIED: `composer.json:67-71`]. A nested `.gitignore` is required because the root one only has bare `.env` [VERIFIED: `.gitignore:14` ".env", `.gitignore:15` ".env.backup"], which does not match `.env.local`.

### Pattern 1: Authorization code + PKCE + client secret on a loopback redirect
**What:** Build the authorize URL, listen once on loopback, verify `state`, redeem the code with `code_verifier` and `client_secret`, hold tokens in memory.
**When to use:** Every harness command that needs a token. No token is ever written to disk.
**Example:**
```js
// Source: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const b64url = (buf) => buf.toString('base64url');
const verifier = b64url(randomBytes(48)); // 64 chars, within the 43-128 range
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(24));

const redirectUri = 'http://localhost:8765/m365-spike/callback'; // registered as http://localhost/m365-spike/callback (port ignored)
const authorize = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email offline_access User.Read Calendars.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: loginHint, // avoid silently reusing the developer's own corporate session
    prompt: 'select_account',
}).toString();

// Bind loopback only. Port 0 is not allowed: the portal-registered URI has no port but any port matches for localhost.
const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
        const u = new URL(req.url, 'http://localhost');
        if (u.pathname !== '/m365-spike/callback') return res.writeHead(404).end();
        const ok = u.searchParams.get('state') === state && u.searchParams.has('code');
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' }).end(ok ? 'OK, close this tab.' : 'Rejected.');
        server.close();
        ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') ?? 'state mismatch'));
    });
    server.listen(8765, '127.0.0.1');
});

const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret, // required for confidential web apps
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri, // must equal the authorize request value
        code_verifier: verifier,
    }),
});
```
Use `state` comparison with `crypto.timingSafeEqual` in the real file. Never `console.log` the token response; print only `scope`, `expires_in`, `has_refresh_token`, `has_id_token`.

### Pattern 2: Graph calendarView paging with headers re-sent on every request
**What:** First request sets the window and `$select`; every follow-up request uses the opaque `@odata.nextLink` verbatim and re-sends `Authorization` and `Prefer`.
**When to use:** All capture passes. Microsoft states the immutable-id header "only applies to the request it is included with" [CITED: learn.microsoft.com/graph/outlook-immutable-id], and the paging doc says nextLink carries other query parameters but custom headers are not automatically repeated for directory resources [CITED: learn.microsoft.com/graph/paging]. Whether Outlook's `calendarView` repeats `Prefer` on page 2 is NOT documented, so the harness also runs a deliberate page-2-without-headers experiment.
**Example:**
```js
const headers = {
    authorization: `Bearer ${accessToken}`,
    prefer: 'outlook.timezone="UTC", IdType="ImmutableId"',
    accept: 'application/json',
};
let url =
    'https://graph.microsoft.com/v1.0/me/calendarView' +
    `?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
    `&$select=${SELECT}&$orderby=start/dateTime&$top=3`;
const pages = [];
while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Graph ${res.status}`); // body may contain ids: do not print it
    const json = await res.json();
    pages.push(json);
    url = json['@odata.nextLink'] ?? null; // verbatim, never rebuilt
}
```
Also try the combined header both as one comma-separated `Prefer` value and as two separate `Prefer` headers; record which Graph accepts [ASSUMED: RFC 7240 allows both; confirm with a real response].

### Pattern 3: Allow-list + keyed deterministic pseudonyms (sanitizer)
**What:** Build the output object field by field from an allow-list; map every identifying value through `HMAC-SHA256(salt, value)`; keep the same length class as the original.
**Why deterministic:** Round A and Round B must map the same real id to the same fake id, otherwise before/after comparisons in the fixtures are impossible. The salt and identity map live in `raw/` (gitignored) so re-sanitizing both rounds together always reproduces identical output.
**Field policy** (event object; anything not listed is dropped):

| Field | Policy |
|-------|--------|
| `id`, `seriesMasterId` | keyed pseudonym, **length-preserving** base64url (so later column-length decisions use realistic lengths); same real value → same fake value, `seriesMasterId` equals the master's fake `id` |
| `iCalUId` | keyed pseudonym, length-preserving uppercase hex |
| `@odata.etag`, `changeKey` | keyed pseudonym, length-preserving |
| `type`, `isCancelled`, `isAllDay`, `isOrganizer`, `isOnlineMeeting`, `isDraft`, `showAs`, `sensitivity`, `importance`, `responseRequested`, `allowNewTimeProposals`, `hideAttendees` | keep verbatim (these are the decision data) |
| `responseStatus.{response,time}` | keep verbatim |
| `start`, `end`, `originalStart`, `originalStartTimeZone`, `originalEndTimeZone`, `createdDateTime`, `lastModifiedDateTime` | keep verbatim (synthetic test data; needed for DST assertions) |
| `subject` | keep only if it matches `^\[M365-TEST (S\d+[a-z]?\|E\d+)[^\]]*\]`; otherwise `Event <n>`. Scenario tags are authored by us, never real |
| `organizer`, `attendees[]` | `emailAddress.address` → `person-<n>@example.test`, `name` → `Test Person <n>` (n from first-seen order in `raw/identity-map.json`); keep `type`, `status.response`, `status.time` |
| `webLink`, `onlineMeeting.joinUrl`, `onlineMeetingUrl` | `https://outlook.example.test/calendar/item/<fakeId>` / `https://teams.example.test/l/meetup-join/<n>` |
| `location`, `locations[]` | `displayName` → `Location <n>` or null |
| `body`, `bodyPreview`, `categories`, `attachments`, `extensions` | **dropped** |
| `@odata.context` | user GUID inside `users('…')` → `00000000-0000-4000-8000-000000000001` |
| `@odata.nextLink` | keep scheme/host/path, `startDateTime`, `endDateTime`, `$top`, `$select`; replace `$skiptoken`/`$skip` value with `SANITIZED-PAGE-<n>` |
| GUIDs anywhere (tenant id, user/object ids) | `00000000-0000-4000-8000-<12 hex of HMAC>` |

Leak guard (runs inside `sanitize.mjs` and again in the validator): build the set of every email, display name, GUID, id, URL host and subject seen in `raw/`; fail if any appears in any output file, and fail on the generic patterns in "Validation Architecture".

### Pattern 4: Fixture replay with `Http::fake`
```php
<?php

declare(strict_types=1);

namespace Tests\Unit\M365;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CalendarViewFixturesTest extends TestCase
{
    protected bool $mockBillingContract = false; // no billing involved

    private function fixture(string $path): array
    {
        $json = file_get_contents(base_path('tests/Fixtures/M365/'.$path));
        $this->assertNotFalse($json);

        return json_decode($json, true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_calendarview_fixture_pages_replay_through_http_fake_following_next_link(): void
    {
        // Arrange (file names are examples; the manifest lists the real ones)
        $page1 = $this->fixture('calendarview/window-prod-select.page-1.json');
        $page2 = $this->fixture('calendarview/window-prod-select.page-2.json');
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => Http::sequence()
                ->push($page1)
                ->push($page2),
        ]);

        // Act
        $first = Http::get('https://graph.microsoft.com/v1.0/me/calendarView')->json();
        $second = Http::get($first['@odata.nextLink'])->json();

        // Assert
        $this->assertSame($page2['value'][0]['id'], $second['value'][0]['id']);
    }
}
```
Pattern syntax (`'host/*'` wildcards, `Http::sequence()->push(...)`, `Http::preventStrayRequests()`) [CITED: laravel.com/docs/13.x/http-client#testing].

### Anti-Patterns to Avoid
- **Enabling "Allow public client flows" on the production registration** just to use device code: opens device-code phishing against the app and conflicts with Microsoft's own advice to block that flow [CITED: learn.microsoft.com/entra/identity/conditional-access/policy-block-authentication-flows].
- **Storing tokens (even refresh tokens) on disk in the harness:** re-login per round instead (2-3 logins total).
- **Hard-coding the cancelled/declined hypothesis in tests:** the manifest records `observed: present|absent` per scenario; tests must accept either, otherwise a correct capture fails the gate.
- **Committing raw captures "temporarily":** `raw/` is gitignored from the first commit (create the nested `.gitignore` in the very first task, before any capture code runs).
- **Using `127.0.0.1` for the redirect URI:** the portal cannot add `http://127.0.0.1` URIs (manifest-only) [CITED: learn.microsoft.com/entra/identity-platform/reply-url]; register `http://localhost/...` and bind the listener to `127.0.0.1`.
- **Letting the developer's own browser session sign in:** the capture must run as test user A (InPrivate window + `login_hint`).
- **Using a Global Administrator as a test user:** they bypass "Assignment required" and invalidate the blocked-user check.

## Entra Admin Center Reference (verified against Microsoft Learn, updated 2026)

Portal entry: **Microsoft Entra admin center** `https://entra.microsoft.com` (ES: *Centro de administración de Microsoft Entra*). The navigation root is now **Entra ID** (older docs say "Identity > Applications"). [CITED: learn.microsoft.com/entra/identity-platform/quickstart-register-app, page `ms.date 2026-05-14`]

**Learn's Spanish pages are machine-translated (`ms.translationtype: MT`/`HT`) and internally inconsistent** (the same page says *inquilino* and *arrendatario* for "tenant"). Therefore the guide must show the **English label in parentheses next to every Spanish label** and tell the admin they may switch the portal language to English (gear icon *Configuración* → language). The ES column below is what Learn prints; "[unverified]" means it was not found on a fetched page.

| Step | English label (Learn) | Spanish label | Source |
|------|----------------------|---------------|--------|
| Role needed to register | at least *Application Developer*; to consent/assign: *Cloud Application Administrator* or *Application Administrator* (consent for Graph delegated: Cloud App Admin is enough; *Privileged Role Administrator* only for app roles) | *desarrollador de aplicaciones*; *Administrador de aplicaciones en la nube*; *Administrador de aplicaciones*; *Administrador de roles con privilegios* | quickstart-register-app; grant-admin-consent (+es-es) |
| Open registrations | **Entra ID > App registrations** → **New registration** | **Entra ID > Registros de aplicaciones** → **Nuevo registro** | quickstart-register-app (+es-es) |
| Name | **Name** (e.g. `solidtime-m365`) | **Nombre** | idem |
| Account type | **Supported account types** → **Single tenant only - <tenant>** | **Tipos de cuenta admitidos** → **Solo para un inquilino: <su inquilino>** (step text elsewhere says "solo arrendatario único") | idem |
| Initial redirect URI | On this screen optional; add via Authentication blade instead | — | idem |
| Create | **Register** | **Registrar** | idem |
| IDs | **Overview** → **Application (client) ID**; **Directory (tenant) ID** | **Información general** → **identificador de aplicación (cliente)**; identificador de directorio (inquilino) [unverified] | idem |
| Redirect URIs | **Manage > Authentication** → tab **Redirect URI configuration** → **Add Redirect URI** → pane **Select a platform to add redirect URI** → tile **Web** → field **Redirect URI** → **Configure** | **Administrar > Autenticación** → pestaña **Configuración del URI de redirección** → **Agregar URI de redirección** → **Seleccionar una plataforma para agregar URI de redirección** → **Web** → **URI de redirección** → **Configurar** | how-to-add-redirect-uri (+es-es) |
| Implicit grant must be OFF | **Implicit grant and hybrid flows**: **Access tokens (used for implicit flows)** and **ID tokens (used for implicit and hybrid flows)** both unchecked | *Concesión implícita y flujos híbridos* [unverified] | search summary of Learn pages; tab placement may differ in the live portal |
| Public client flows must stay OFF | **Advanced settings** → **Allow public client flows** = **No** (default off) | *Permitir flujos de cliente público* [unverified] | idem |
| Permissions | **Manage > API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → **Select permissions** → **Add permissions** | **Permisos de API** → **Agregar un permiso** → **Microsoft Graph** → **Permisos delegados** → **Seleccionar permisos** → **Agregar permisos** | quickstart-configure-app-access-web-apis (+es-es) |
| Which to tick | OpenID group: `email`, `offline_access`, `openid`, `profile`; `User.Read` is added automatically at registration; **Calendars** group: `Calendars.Read` (NOT `Calendars.ReadWrite`, NOT `ReadBasic`) | idem; grupo de calendarios | idem |
| Admin consent | **Grant admin consent for <tenant>** → confirm → **Refresh** → column **Status** shows **Granted for <tenant>** | **Conceder consentimiento de administrador para <inquilino>** → **Sí** → **Actualizar** → columna **Estado**: *Concedido a …* | quickstart-register-app; quickstart-configure-app-access-web-apis |
| Secret | **Certificates & secrets > Client secrets > New client secret** → **Description** → expiry → **Add** → copy **Value** (not Secret ID); "never displayed again" | **Certificados y secretos > Secretos de cliente > Nuevo secreto de cliente** → **Descripción** → expiración → **Agregar** → copiar **Valor** | how-to-add-credentials (+es-es) |
| Enterprise app | **Entra ID > Enterprise apps > All applications** → open the app → **Manage > Properties** | **Entra ID > Aplicaciones empresariales > Todas las aplicaciones** → **Propiedades** | add-application-portal-configure; application-properties (+es-es) |
| Assignment | **Assignment required?** = **Yes** → **Save** | doc heading *Asignación necesaria*; live label likely *¿Asignación requerida?* [unverified] → **Guardar** | application-properties (+es-es) |
| Sign-in enabled | **Enabled for users to sign-in?** must remain **Yes** | **¿Habilitado para que los usuarios inicien sesión?** | application-properties es-es |
| Assign group | **Users and groups** → **Add user/group** → pane **Add Assignment** → **Users and groups: None Selected** → pick group → **Select** → **Select a role** (**Default Access**) → **Assign** | **Usuarios y grupos** → **Agregar usuario o grupo** → **Agregar asignación** → **Ninguno seleccionado** → **Seleccionar** → **Acceso predeterminado** → **Asignar** | assign-user-or-group-access-portal (+es-es) |
| CA policy list | **Entra ID > Conditional Access > Policies** | **Entra ID > Acceso condicional > Directivas** | what-if-tool (+es-es) |
| CA simulation | **… > Policies > What If** (inputs: identity, target resource, device platform, client app; for the app give the **App ID**, app groups such as *Office 365* do not match) | botón **¿Qué Pasaría Si?** | what-if-tool (+es-es) |
| CA evidence from a real sign-in | **Entra ID > Monitoring & health > Sign-in logs** → open the test user's sign-in → tab **Conditional Access**; **Audience** shows every resource requested | *Registros de inicio de sesión* [unverified] | troubleshoot-conditional-access |

**Facts the guide's "why" boxes can rely on [all CITED unless marked]:**
- **Single tenant** = "users (or guests) in your tenant" (guests are still allowed by the account type alone; the real gate is assignment + code checks). Recommended by Microsoft for most apps.
- **Web platform, not SPA:** a SPA redirect type issues refresh tokens that expire after 24 hours and blocks client secrets; Web apps' refresh tokens have no specified lifetime [CITED: v2-oauth2-auth-code-flow].
- **Redirect URIs:** must start with `https` except localhost; are case-sensitive; no special characters `! $ ' ( ) , ;`; max 256 URIs of 256 chars each; for `localhost` the port is ignored when matching; `http://127.0.0.1` can only be added through the manifest, not the portal; avoid wildcards; Microsoft suggests separate registrations for dev and prod [CITED: reply-url]. `AADSTS50011` is the mismatch error.
- **Permission consent:** `Calendars.Read` delegated has AdminConsentRequired = **No** [CITED: learn.microsoft.com/graph/permissions-reference, entry read this session]. It is still **mandatory** to grant admin consent here, because "applications that require users to be assigned ... must have their permissions consented by an administrator" [CITED: assign-user-or-group-access-portal]. Granting consent can revoke earlier tenant-wide grants for that app [CITED: grant-admin-consent].
- **Secret:** lifetime limited to 24 months, Microsoft recommends less than 12; Microsoft recommends certificates over secrets for production [CITED: how-to-add-credentials]. D-01 keeps a secret; note certificate credentials as future hardening in the runbook, not in this phase. **Recommendation (Claude's discretion):** pick the portal's preset closest to 6 months, record the exact expiry date, and set the reminder 45 days before (>= the 30 days required). Renewal is zero-downtime because Entra allows two secrets at once: create new → update Dokploy env → redeploy → verify login → delete old [ASSUMED: standard Entra behaviour].
- **Assignment required:** blocks unassigned users with `AADSTS50105` ("The signed in user is not assigned to a role for the application"); group assignment needs **Entra ID P1/P2**, only **direct** members count (no nested groups); **Global Administrators bypass the check**, so verify with a normal user [CITED: troubleshoot AADSTS50105 page, `ms.date 2026-08-20`]. Setting it to Yes also blocks guest users who would otherwise sign in [CITED: application-properties es-es: "No ... permite que los usuarios externos ... inicien sesión"].
- **Conditional Access:** policies are evaluated per resource, and one sign-in can request several resources (Teams example: Outlook calendar, SharePoint ...), so the **Audience** column of the sign-in log is the authoritative evidence of which policies touched the app's Graph/Exchange access; the What If tool ignores service dependencies [CITED: troubleshoot-conditional-access; what-if-tool]. Device-code-flow block policies exist (Conditional Access > Authentication flows) [CITED: policy-block-authentication-flows]. Policies to ask about: MFA required, sign-in frequency, compliant/hybrid-joined device, named locations, sign-in/user risk, token protection, block legacy auth, block device code flow.

### Admin Guide Content Spec (planner input for the Spanish document)

1. **Preparación** (roles, 45 min estimate, a password manager entry for the secret; test users A and B need a license with an Exchange Online mailbox; A in the staff group, **B outside it and not an admin**; both non-Global-Admin).
2. **Parte 1 – Registro** (name, single tenant, Register, copy IDs) → **Parte 2 – URIs de redirección** → **Parte 3 – Permisos y consentimiento** → **Parte 4 – Secreto** → **Parte 5 – Aplicación empresarial** (assignment, group, sign-in enabled) → **Parte 6 – Acceso condicional** → **Parte 7 – Usuarios de prueba y buzón** → **Parte 8 – Escenarios de Outlook (Ronda A)** → **Parte 9 – Modificaciones (Ronda B)** → **Parte 10 – Entrega** (checklist of the 7 items from D-01 plus "client secret expiry date", "which Outlook client used (web/new/classic)", "mailbox time zone").
3. Each step: *Qué hacer* (exact path + exact values to paste), *Por qué* (one sentence), *Cómo comprobarlo* (what the screen shows afterwards).
4. **Redirect URIs to paste** (path from the Phase 2 route design `/auth/microsoft/callback` [VERIFIED: `.planning/research/ARCHITECTURE.md:231-234` "GET ──► /auth/microsoft/redirect ... /auth/microsoft/callback?code&state"]):
   - `https://<dominio-dokploy>/auth/microsoft/callback` (production, placeholder replaced by the real domain before the guide is handed over)
   - `https://solidtime.test/auth/microsoft/callback` (local dev: `APP_URL=https://solidtime.test` [VERIFIED: `.env.example:6`])
   - `http://localhost/auth/microsoft/callback` (local without proxy)
   - `http://localhost/m365-spike/callback` (**temporary**, for the capture harness; the runbook must schedule its removal after Round B)
   Type all as **Web**; no trailing-slash variants; no wildcards.
5. **Hand-back channel:** the guide must say "never paste the secret in chat, e-mail, tickets or the repo": use the company password manager share, or a one-time secret link with expiry; send the other six items by normal channel (they are not secret). The tenant ID, client ID, redirect URIs, scopes and expiry date are non-secret and go in the runbook (D-03).
6. **Terminology risk:** the Spanish Outlook steps in Part 8/9 need a dry-run proofreading by a person who sees the Spanish Outlook UI (human-verify checkpoint, see Open Questions).

## Outlook Scenario Playbook (Parts 8-9 of the guide + fixture matrix)

**Actors:** **A** = capture mailbox (the harness signs in as A; A is in the staff group). **B** = second account used as organizer and as the "outside the group" account.
**Subject convention (mandatory, drives sanitizer and scenario extraction):** `[M365-TEST S3] cancelled`, `[M365-TEST E1] ...`. Keep the tag inside square brackets at the start.
**Preconditions:** set both mailboxes' Outlook time zone to *(UTC+01:00) Brussels, Copenhagen, Madrid, Paris* so `originalStartTimeZone` is realistic [ASSUMED: expected Windows id `Romance Standard Time`]; A signs in to Outlook on the web in a private window; A answers invitations through Outlook (not through mail rules). Use **Outlook on the web** (`https://outlook.office.com/calendar`) for every step; the UI differs between *new* and *classic* Outlook, so record which client was used.
**DST window:** today is 2026-10-19 and Europe/Madrid leaves DST on **Sunday 2026-10-25** [computed: 2026-10-19 is a Monday]. Capture window recommendation: `2026-10-19T00:00:00Z` → `2026-11-16T00:00:00Z`. If the capture slips past 25 Oct, use the March change (Sunday **2027-03-28**) instead: the rule is "the series must have at least one occurrence before and one after the last Sunday of October/March". Outlook accepts a series whose first occurrence is in the past.

**Two-round protocol** (everything in Round A must exist and be accepted before capture A; every mutation happens between captures):

| # | Scenario | Create (Round A) | Mutate (Round B) | Why a pair is needed |
|---|----------|------------------|------------------|----------------------|
| S1 | Single meeting | B organizes `[M365-TEST S1] single` with A as required attendee, tick **Teams meeting** (exercises join-URL scrubbing), A **accepts** | none | baseline eligibility: `isOrganizer=false`, `responseStatus=accepted` |
| S1b | Single, A organizes | A organizes `[M365-TEST S1b] organizer` inviting B | none | `isOrganizer=true`, `responseStatus=organizer`, attendees present |
| S2 | Recurring series + edited occurrence | B organizes weekly Tuesday 10:00-10:30, starting Tue 2026-10-13, 5 occurrences, A accepts the series | B edits **one** occurrence ("This event" / *Este evento*): moves it +1 h and changes the title tag to `[M365-TEST S2] series (edited)` | proves `type` flips occurrence→exception, whether the edited occurrence keeps its `id`, `originalStart` vs new `start`, `seriesMasterId` constancy across DST |
| S3 | Cancelled | B organizes `[M365-TEST S3] cancelled`, A accepts | B cancels the meeting and sends the cancellation. **A must not open or process the cancellation** (record whether Outlook auto-removed it) | attendee-side representation: absent vs `isCancelled=true`; lookup `GET /me/events/{id}` → 200/404 |
| S4 | Declined | B organizes `[M365-TEST S4] declined`, A accepts first (so Round A has the baseline id) | A **declines** (*Rechazar*) and sends the response | absent vs `responseStatus.response=declined`; lookup by id |
| S5 | Moved | B organizes `[M365-TEST S5] moved` 10:00, A accepts | B changes the time to 11:00 same day and sends the update | same id? `start` changes, `originalStart` absent for single instance, `lastModifiedDateTime` changes |
| S5b | Moved to another week | B organizes `[M365-TEST S5b] moved week` , A accepts | B moves it to the following week | absence from the original window is NOT cancellation; lookup by id still 200 |
| S6 | Private | A organizes `[M365-TEST S6] private` with B invited, marks **Private** (*Privado*) | none | `sensitivity=private` on the organizer copy |
| S6b | Private, A attendee | B organizes private meeting, A accepts | none | `sensitivity` as seen by an attendee, and whether subject is masked [ASSUMED: unmasked for attendees; Microsoft says attendees can see details of private meetings] |
| S7 | All-day | A creates `[M365-TEST S7] all day` with **All day** (*Todo el día*), no attendees; optional S7b two-day all-day | none | `isAllDay=true`, how midnight boundaries look with `Prefer: outlook.timezone="UTC"` |
| S8 | Personal block, no attendees | A creates `[M365-TEST S8] block` 14:00-15:00, no attendees, show-as Busy | none | `isOrganizer=true`, `attendees=[]`, `responseStatus.response=organizer` |

**Recommended extras (optional, flagged in the manifest as `extra: true`; each answers a question later phases will hit):**

| # | Scenario | How | Question answered |
|---|----------|-----|-------------------|
| E1 | Cancelled single occurrence of a series | Round B: B deletes one occurrence of an S2-like series ("This event") | does the occurrence vanish from `calendarView`; does `cancelledOccurrences` on the master list it (only returned on a GET of the master with `$select`) [CITED: event resource] |
| E2 | Series split | Round B: B edits "This and all following events" and changes the time | two masters? new `seriesMasterId`/`iCalUId`? (PnP report: two masters, no linking field [CITED: pnp.github.io/blog/post/one-outlook-edit-became-two-microsoft-graph-events]) → Phase 5 orphan-rule behaviour |
| E3 | Tentative | A answers *Tentative* to a B meeting | `responseStatus.response=tentativelyAccepted` |
| E4 | No response | A leaves a B invite unanswered | `notResponded` (SYNC-03 excludes it unless organizer; confirm representation) |
| E5 | Timed event crossing midnight / multi-day not all-day | A creates 22:00-02:00 | eligibility guard for multi-day timed events |
| E6 | Declined single occurrence of a series | Round B: A declines one occurrence only | occurrence-level response vs whole-series |

`confidential` and `personal` sensitivity cannot be created from the Outlook UI [ASSUMED]; if Phase 3 tests need them, create **synthetic** fixtures by editing `sensitivity` in a sanitized copy and mark them `"synthetic": true` in `manifest.json` (never present synthetic data as captured).

**Hypotheses to test, not facts** (record the observed value in `manifest.json`; the decision doc quotes the observation):

| Topic | Documented | Not documented (must be observed) |
|-------|------------|-----------------------------------|
| What `calendarView` returns | "occurrences, exceptions and single instances" [CITED: calendar-list-calendarview]; series masters are not in the list (the list API returns "single instance meetings and series masters", calendarView expands) | whether a master ever appears |
| `type` | `singleInstance`, `occurrence`, `exception`, `seriesMaster` [CITED: event resource] | the value on an attendee copy of an edited occurrence |
| `seriesMasterId` | "The ID for the recurring series master item, if this event is part of a recurring series" [CITED] | null vs absent for single instances; stability after edit |
| `originalStart` | initial start as occurrence/exception, UTC, "not returned for events that are single instances" [CITED] | on moved single instances (expected absent) |
| `iCalUId` | "different for each occurrence in a recurring series" [CITED] | across attendee/organizer copies |
| `id` | changes on move between containers unless `IdType="ImmutableId"`; immutable id survives folder moves, changes on archive-mailbox move or export/re-import [CITED: outlook-immutable-id] | whether an edited occurrence keeps its `id` |
| `isCancelled` | "Set to true if the event has been canceled" [CITED] | whether an attendee still receives such an event in `calendarView` |
| organizer cancel | moves organizer's event to Deleted Items [CITED: event-cancel] | the attendee copy |
| `responseStatus` values | `none`, `organizer`, `tentativelyAccepted`, `accepted`, `declined`, `notResponded` [ASSUMED: from PITFALLS.md; response resource page not fetched] | what decline looks like on the attendee copy |
| all-day | start/end "must be set to midnight and be in the same time zone" [CITED: event resource] | the instant returned under `Prefer: outlook.timezone="UTC"` |
| `Calendars.ReadBasic` | "read events ... except for properties such as body, attachments, and extensions"; delegated, no admin consent; listed as least privileged for calendarView [CITED: permissions-reference; calendar-list-calendarview] | whether `attendees`, `responseStatus`, `seriesMasterId` survive; testing it needs a token with that scope, i.e. extra consent → **informational only**, answer from documentation unless the admin volunteers an optional second consent (do not add it to the registration) |

## Harness Specification

**Recommendation:** `tests/Tools/m365-spike/capture.mjs`, zero dependencies, ESM (`package.json:4` has `"type": "module"` [VERIFIED]), formatted with the repo's Prettier config.

| Command | Does | Interactive login | Output |
|---------|------|-------------------|--------|
| `auth` | sign in as A; verify `scope` set equals configured (compare ignoring `offline_access`, because Microsoft's own examples list scope without it [CITED: v2-oauth2-device-code response example "User.Read profile openid email"]; assert a refresh token **was** issued instead); read `tid`/`amr` claim names from the id_token (debug only: Microsoft says never depend on parsing tokens you don't own [CITED]); `GET /me?$select=userType,...` | yes | console table + `raw/auth-check.json` (no token values) |
| `auth --expect-blocked` | repeat as B (not in group); success = authorize returns `AADSTS50105` | yes | console + `raw/auth-blocked.json` |
| `capture --round A|B` | window passes, experiments, series master/instances, Round B id lookups | yes (once) | `raw/roundX/*.json` |
| `sanitize` | offline: raw → `tests/Fixtures/M365/**` + `manifest.json` + leak guard | no | fixtures |

Config via `node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs ...` with `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_SPIKE_LOGIN_HINT`, `M365_SPIKE_WINDOW_START/END` (names listed in `.env.local.example` without values). Read the secret only from the environment; never accept it as a CLI argument (shell history); never print it.

**Why not device code (option b), explicitly:** it needs **Allow public client flows = Yes** on the app registration. For a confidential web app that setting lets anyone who knows the client ID start a device-code login against it, which is the classic device-code phishing pattern; Microsoft recommends blocking the flow tenant-wide wherever possible [CITED: policy-block-authentication-flows], so a tenant CA policy may block it anyway. If it were ever required, do it on a separate throwaway registration, not on the production one. Not needed here because the loopback redirect works on a developer workstation.

**Why not an Artisan command (option a):** a PHP harness is feasible later (raw `Http`, no Socialite) but is blocked today by the environment (no `php`/`composer`/`docker` found on PATH), would live under `app/` (shipped in the image) or need a new autoload entry (core-file touch), and Octane/FrankenPHP are irrelevant for a CLI (a plain PHP process, no worker state). Octane matters again in Phase 2 for the real Socialite flow.

**Why not a route (option c):** edits `routes/web.php`, needs the full app, database and an HTTPS callback; rejected.

**Capture-window parameters:** `$top=3` forces several pages from a ~15-event window; the prod-shaped `$select` is `id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting` (taken from STACK.md minus `lastModifiedDateTime`, plus `originalStart`, which PITFALLS.md needs) with a second pass that deliberately **includes** `lastModifiedDateTime` and `attendees` to record Graph's behaviour; a third pass has no `$select` (full shape; `createdDateTime`/`lastModifiedDateTime` only come back this way [CITED: calendar-list-calendarview note]). Each pass stores `request` metadata (URL with window, header names, HTTP status) beside the body.

**Experiments the harness must run and record** (each becomes one row of the decision document):
1. Combined `Prefer` header (single comma-separated vs two header lines): accepted? tz = UTC and ids immutable?
2. Page 2 with headers re-sent vs without: `start.timeZone` value and id format identical?
3. Same window with and without `IdType="ImmutableId"`: id length/charset/prefix differ? (record `{length, charset}` only, not values).
4. `ImmutableId` ids of Round A vs Round B for the same event: equal? (via the deterministic pseudonym: equal fake id ⇔ equal real id).
5. `GET /me/events/{id}` for each Round A id in Round B: HTTP status, `isCancelled`, new `start`.
6. `GET /me/events/{seriesMasterId}?$select=recurrence,cancelledOccurrences,...` and `/instances?startDateTime=&endDateTime=` for S2/E1.
7. Exact production `$select` string accepted? `lastModifiedDateTime` in `$select` errors or is ignored?

## Fixture Storage and Sanitization Plan

- **Where:** `tests/Fixtures/M365/` (D-05). `tests/` has no fixtures directory today; existing static test data sits beside tests (e.g. `tests/Unit/Service/Import/Importers/*.csv`) [VERIFIED by `ls`: `clockify_projects_import_test_1.csv` etc. in that folder]; `TESTING.md` says frontend keeps builders next to tests, so a top-level `Fixtures/` is a new but self-contained convention for large JSON.
- **Loading:** `base_path('tests/Fixtures/M365/…')` + `json_decode(..., JSON_THROW_ON_ERROR)`, `Http::fake([...'graph.microsoft.com/v1.0/me/calendarView*' => Http::sequence()...])`.
- **manifest.json (schema the validator enforces):**
  ```json
  {
    "captured_at": "2026-..", "window": {"start": "...Z", "end": "...Z"},
    "outlook_client": "web|new|classic", "mailbox_timezone": "Romance Standard Time",
    "scenarios": {
      "S3": {
        "extra": false, "synthetic": false,
        "round_a": {"files": ["scenarios/S3.roundA.json"], "present": true},
        "round_b": {"files": ["scenarios/S3.roundB.json"], "present": true|false,
                    "lookup": {"file": "lookups/S3.json", "status": 200|404, "isCancelled": true|false|null}},
        "observed": "free text, one sentence, written from the files"
      }
    }
  }
  ```
- **Raw handling:** `tests/Tools/m365-spike/raw/` (gitignored), contains real JSON, `salt`, `identity-map.json`. Delete `raw/` after the decision document is merged (the plan should include that as the last task and note that Round B cannot be re-sanitized without it).
- **Committed README** in `tests/Fixtures/M365/` states: captured from test accounts (no real employees), scrub rules, which fixtures are synthetic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recurrence expansion / DST | RRULE-style occurrence generator | `calendarView` (server-side expansion) | Expansion handles DST, exceptions, cancelled occurrences |
| PKCE/state primitives | Custom random/hash code | `node:crypto` `randomBytes`, `createHash('sha256')`, `timingSafeEqual` | Standard library; do not invent encodings (use `base64url`) |
| Sanitization guarantees | Regex blocklist of "sensitive-looking" strings | Allow-list of fields + keyed pseudonyms + diff against the raw value set | A blocklist silently misses new fields Graph adds |
| Reading tokens | Parsing/validating Graph access tokens | Treat as opaque; use id_token claims only for debug output | Microsoft: access tokens for APIs you don't own may not be JWTs [CITED] |
| Secret storage/hand-over | A repo file, `.env` committed, chat message | Company password manager / one-time secret link; env var for the harness | D-01 requires non-plaintext hand-over |
| Reminder system | Custom cron/notification | Calendar reminders owned by the admin and the PO, dates written in the runbook | Out of code scope; D-01 only needs "reminder set" |
| Graph client for the spike | `microsoft/microsoft-graph` SDK | `fetch` | 4 GET endpoints; SDK adds the Kiota tree [VERIFIED: STACK.md decision] |

**Key insight:** this phase's deliverable is evidence. Anything that could alter or hide the real shape of Graph's response (SDK models, `$select` guesses, hand-edited fixtures) defeats the purpose.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted per instructions.

## Common Pitfalls

### Pitfall 1: Testing "blocked outsider" with an admin account
**What goes wrong:** the outsider signs in successfully and the team concludes Assignment required is broken. **Why:** Global Administrators bypass the check [CITED: AADSTS50105 troubleshoot page]. **Avoid:** test user B is a plain user with no directory roles, not in the group. **Warning sign:** sign-in log shows success without AADSTS50105.

### Pitfall 2: Group assignment silently unavailable or ineffective
**What goes wrong:** the *Add user/group* pane only lets you pick users, or a user in a *nested* group is still rejected. **Why:** group-based assignment needs Entra ID P1/P2; nested groups are unsupported [CITED]. **Avoid:** confirm licensing first (Open Question 1); put users **directly** into the assigned group; fallback is assigning users individually.

### Pitfall 3: Redirect URI typos and platform mix-ups
**What goes wrong:** `AADSTS50011`, or `AADSTS9002327`-style errors. **Why:** exact case-sensitive match; the URI added under *Single-page application* instead of *Web* [CITED: reply-url; STACK/PITFALLS]. **Avoid:** paste the exact list from the guide, all under **Web**, no trailing slash, `http` only for localhost.

### Pitfall 4: Copying the secret **Secret ID** instead of **Value**
**What goes wrong:** `invalid_client` at token redemption. **Why:** Value is shown once ("never displayed again") [CITED: how-to-add-credentials]. **Avoid:** guide step "copy the column *Valor* now, before leaving the page" + hand-over checklist wording.

### Pitfall 5: The developer's own browser session logs in instead of test user A
**What goes wrong:** capture contains a real employee's calendar. **Avoid:** InPrivate window, `login_hint`, `prompt=select_account`, and the harness prints the `preferred_username`-domain-agnostic check "signed in user matches M365_SPIKE_LOGIN_HINT" before capturing anything (compare locally; do not print the address).

### Pitfall 6: Conditional Access blocks test user A from the developer machine
**What goes wrong:** `AADSTS53000`/`53003`-type errors (device not compliant, blocked) on the developer laptop, or forced MFA enrolment [CITED: troubleshoot-conditional-access error table]. **Why:** policies target "all users/all resources". **Avoid:** the CA review (Part 6) comes **before** test-user sign-in; the admin runs What If for A with the app's App ID and reports the result; any exclusion is the admin's decision, not something the guide recommends. **Warning sign:** the sign-in log's *Conditional Access* tab shows *Failure*.

### Pitfall 7: Capturing the wrong time window (or after DST has passed)
**What goes wrong:** no DST evidence for Phase 3 SYNC-04. **Avoid:** window rule above; S2 must straddle the change.

### Pitfall 8: Assuming cancelled/declined events behave like the organizer's copy
**What goes wrong:** the manifest or tests encode "isCancelled=true appears". **Why:** the cancel action moves the *organizer's* copy to Deleted Items [CITED: event-cancel] and attendee behaviour is undocumented. **Avoid:** record `present|absent` and lookup status; write tests against the manifest.

### Pitfall 9: `$select` assumptions from earlier research
**What goes wrong:** Phase 3 builds on `lastModifiedDateTime` or `attendees(count only)` in `$select`. **Avoid:** experiment 7; amend STACK/PITFALLS in the decision document if wrong.

### Pitfall 10: Prefer headers lost on `@odata.nextLink`
**What goes wrong:** page 2+ returns non-UTC times or mutable ids. **Why:** headers apply per request [CITED: outlook-immutable-id]. **Avoid:** re-send on every request (Pattern 2); experiment 2 documents the truth for the decision doc.

### Pitfall 11: Sanitized fixtures that can't be re-created
**What goes wrong:** Round B sanitized with a different salt, so before/after ids no longer match. **Avoid:** persist `raw/salt` and `raw/identity-map.json`; always re-run `sanitize` over *both* rounds; delete `raw/` only after the decision doc is final.

### Pitfall 12: Localhost listener not reachable from the browser
**What goes wrong:** the browser shows "connection refused" on the redirect. **Why:** `localhost` may resolve to `::1` while the listener is on `127.0.0.1` (Windows). **Avoid:** try again in the browser (modern browsers fall back across both addresses [ASSUMED]); if it persists, start a second listener on `::1`; never bind to all interfaces.

### Pitfall 13: Leaving the temporary localhost URI and the harness secret around
**What goes wrong:** a dev-only redirect URI stays on the production registration; the same secret is reused later. **Avoid:** runbook task "remove `http://localhost/m365-spike/callback` after Round B" and "create the harness a **separate** secret (description `spike`, short expiry 30 days) and delete it afterwards" — the production secret then never touches a laptop.

## Code Examples

### Secret/token leak patterns for the offline validator
```js
// Patterns that must match nothing in committed files (docs may contain GUIDs: see allow-list below)
const FORBIDDEN = [
    /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/, // JWT (access/id token)
    /[A-Za-z0-9_.~-]{3}8Q~[A-Za-z0-9_.~-]{20,}/, // Entra client secret *Value* shape [ASSUMED: observed format]
    /\b(access_token|refresh_token|client_secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~-]{16,}/i,
    /[A-Za-z0-9._%+-]+@(?!example\.test\b)[A-Za-z0-9.-]+\.[a-z]{2,}/i, // any e-mail not @example.test
    /https:\/\/(?!(graph\.microsoft\.com|outlook\.example\.test|teams\.example\.test)\b)[^\s"')]+/, // fixtures only
];
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// Fixtures: only GUIDs starting 00000000-0000-4000-8000- are allowed. docs/m365/RUNBOOK*: tenant/client IDs allowed (D-03).
```

### Round B lookup (the call OSYNC will depend on)
```js
// Source: https://learn.microsoft.com/en-us/graph/api/event-get (endpoint shape); record status, never the raw id.
const r = await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}` +
    '?$select=isCancelled,start,end,responseStatus,type', { headers });
record({ scenario, status: r.status, isCancelled: r.ok ? (await r.json()).isCancelled : null });
```
(Event ids contain characters that need URL-encoding; `encodeURIComponent` is required [ASSUMED: ids are base64url-like with `=`/`-`].)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Portal path "Identity > Applications > App registrations" | **Entra ID > App registrations** | docs updated 2026 | guide must use the new root; label drift possible |
| Authentication blade with a single list of platform configs | **Redirect URI configuration** tab + **Add Redirect URI** pane with platform tiles | current docs (`ms.date 2026-05-14`) | guide uses tile flow |
| "Cloud app" wording in CA | **Resources (formerly cloud apps)** | current CA docs | CA instructions use the new term |
| Event ids mutable by default | Opt in with `Prefer: IdType="ImmutableId"` | long-standing | header on every request |
| `Calendars.Read` listed as least privileged | **`Calendars.ReadBasic`** listed as least privileged for calendarView | current Graph docs | informational question D-06 |
| Secrets up to 24 months | still max 24 months, Microsoft recommends < 12 months and certificates for production | current | documented trade-off in the runbook |

**Deprecated/outdated:** Azure AD v1 endpoints and ADAL (not used); `onlineMeetingUrl` "will be deprecated in the future" [CITED: event resource], use `onlineMeeting.joinUrl` when sanitizing/selecting.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `node --env-file` requires Node >= 20.6 | Standard Stack | Harness invocation fails on an older Node; fall back to `dotenv`-less manual env export |
| A2 | Graph accepts `Prefer` as one comma-separated header and as separate headers | Pattern 2 | Wrong header form silently drops UTC or ImmutableId; experiment 1 detects it |
| A3 | Spanish labels marked "[unverified]" (implicit grant, public client flows, Assignment required live label, sign-in logs, tenant ID label) | Entra Reference | Admin cannot find a control; mitigated by EN labels in parentheses and a dry run |
| A4 | Secret presets/expiry choices and zero-downtime renewal with two concurrent secrets | Entra Reference | Runbook procedure wrong; low impact, confirm in the portal |
| A5 | Expected Windows tz id `Romance Standard Time` for the Madrid mailbox | Scenario Playbook | Cosmetic; observed value goes into manifest |
| A6 | Attendee copies of private meetings expose subject/`sensitivity` unmasked | S6b | Decision doc must record observed behaviour; no design impact until Phase 3 |
| A7 | `confidential`/`personal` sensitivity cannot be created in the Outlook UI | Playbook | Could capture real fixtures instead of synthetic; low |
| A8 | `responseStatus.response` value set (`none`, `organizer`, `tentativelyAccepted`, `accepted`, `declined`, `notResponded`) | Hypotheses table | Eligibility table in Phase 3 could miss a value; the spike will show values actually seen |
| A9 | Entra secret *Value* contains `8Q~` | Validator regex | Regex misses real secrets; keep the other patterns and manual review |
| A10 | `Graph $select` has no `attendees` count projection | Summary | If it exists, Phase 3 can avoid fetching attendee e-mails |
| A11 | Graph Explorer needs its own consent and uses a Microsoft multi-tenant app | Alternatives | Might be the cheaper exploration tool; irrelevant to plan |
| A12 | Browsers fall back from `::1` to `127.0.0.1` for `localhost` | Pitfall 12 | Listener unreachable; second listener fallback documented |
| A13 | Event ids need URL-encoding in `GET /me/events/{id}` | Code Examples | 404 caused by bad encoding misread as "deleted"; harness should encode |
| A14 | Test users need an Exchange Online licence and untangle.es-style UPNs are available | Guide spec | Plan blocked waiting for licences (Open Question 2) |

## Open Questions

1. **Does Untangle have Entra ID P1/P2 (e.g. Microsoft 365 Business Premium) for group-based assignment?**
   - What we know: group assignment requires P1/P2; nested groups unsupported [CITED].
   - Unclear: the Untangle licence mix.
   - Recommendation: first line of the guide's Preparación asks the admin to check; fallback is assigning individual users (note this changes D-01's "assign the staff group" wording; escalate to the PO if needed).
2. **Can the admin create two licensed test users (A in the group, B outside, both non-admin)?** Needs Exchange Online mailboxes. Recommendation: make this checkpoint 0; if licences are scarce, B can reuse an existing non-admin colleague's account only for organizer duties and the blocked test, never as a data source.
3. **Will Conditional Access let test user A sign in from the developer machine?** Unknown until the admin runs What If / the sign-in log. Recommendation: Round A is blocked on this; if blocked, the admin decides (device registration, named-location exception) outside this repo.
4. **Which Outlook client will the admin use (web / new Outlook / classic)?** Affects attendee-side cancel/decline representation and Spanish menu names. Recommendation: standardize on Outlook on the web; record the client in the manifest.
5. **Do the Spanish Outlook steps read correctly?** The guide's Outlook labels (*Repetir*, *Este evento*, *Todos los eventos de la serie*, *Todo el día*, *Privado*, *Rechazar*) come from Spanish support pages via search summaries [CITED: support.microsoft.com es-es pages], not from a live UI. Recommendation: human-verify checkpoint where the admin dry-runs Parts 8-9 and corrects labels.
6. **Which production domain goes into the redirect URI?** Needs the Dokploy public domain before the guide is handed over (placeholder `<dominio-dokploy>` otherwise). Recommendation: first plan task asks the PO; the admin can add the URI later without blocking the rest.
7. **Is `Calendars.ReadBasic` worth an optional second consent to test?** Decision is informational (D-06). Recommendation: answer from documentation; skip the live test unless free.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | harness, offline validators, Prettier | yes | v24.13.1 | — |
| npm | `npm run format:check` | yes (with Node) | not probed | — |
| PHP 8.3 | PHPUnit fixture test (`CalendarViewFixturesTest`) | **no** (`which php` → not found on this host) | — | Node validator (`validate-fixtures.mjs`) is the Wave-0 gate here; the PHPUnit test is written and run wherever PHP exists (Sail/CI) |
| Composer | PHP deps | **no** | — | not needed for this phase |
| Docker | Sail/local app | **no** | — | not needed (harness is standalone) |
| `az` CLI / Graph PowerShell | optional tenant inspection | **no** (`which az` not found) | — | admin uses the portal; guide is portal-only |
| Git | commits | repo is **not a git repository** in this environment (environment banner "Is a git repository: false") | — | commit step is skipped/deferred; `git check-ignore` verification of the nested `.gitignore` must run where git exists |
| Entra tenant admin access | everything SETUP-01 | human-only | — | **blocking** until the admin acts |
| Internet to `login.microsoftonline.com`, `graph.microsoft.com` | capture | not probed (no tenant creds yet) | — | none |

**Missing dependencies with no fallback:** the tenant admin actions.
**Missing dependencies with fallback:** PHP/Composer/Docker (Node validator substitutes; PHPUnit test authored now, executed elsewhere).

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` (read this session), so this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in test runner (`node --test`) for the offline gate that runs on this host; PHPUnit 12 for the CI/Sail-level test |
| Config file | none for Node tests; `phpunit.xml` (Unit suite = `tests/Unit`) |
| Quick run command | `node --test tests/Tools/m365-spike/` |
| Full suite command | `node tests/Tools/m365-spike/validate-fixtures.mjs && npm run format:check && vendor/bin/phpunit --filter CalendarViewFixturesTest` (last command only where PHP exists) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SETUP-01 | Admin guide exists, in Spanish, contains every mandatory section (the 10 Partes), the exact permission string, the 4 redirect URIs, the 7 hand-back items, "Assignment required"/"Asignación" + English labels in parentheses, and no secret/GUID-looking value | doc-structure check | `node tests/Tools/m365-spike/validate-docs.mjs guide` | Wave 0 |
| SETUP-01 | Runbook has tenant ID, client ID, redirect URIs, scopes, group, secret **expiry date in ISO format** and a **reminder date >= 30 days before expiry** (script parses both dates), renewal procedure, removal task for the spike URI | doc-structure + date arithmetic | `node tests/Tools/m365-spike/validate-docs.mjs runbook` | Wave 0 |
| SETUP-01 | No secrets committed: JWT, secret-value, `client_secret=` patterns absent repo-wide (excluding `node_modules`, `vendor`) | grep-style scan | `node tests/Tools/m365-spike/validate-docs.mjs secrets` | Wave 0 |
| SETUP-01 (criterion 2) | Registration returns exactly the configured scopes; assigned user gets no consent prompt; outsider blocked with AADSTS50105 | manual-only (needs tenant) + machine evidence | `capture.mjs auth` / `auth --expect-blocked`; evidence summarized in runbook "Verificación" with date | human-verify checkpoint |
| SETUP-02 | Manifest lists S1-S8; each scenario has Round A and Round B entries with `present`/`absent` and, where absent, a lookup status; every referenced file exists; every fixture file is referenced | schema check | `node tests/Tools/m365-spike/validate-fixtures.mjs --schema` | Wave 0 |
| SETUP-02 | Scenario predicates hold on the observed data: S2 has >=2 events with one `seriesMasterId`, at least one `exception` after Round B; S7 has `isAllDay=true`; S8 has `attendees=[]` and `isOrganizer=true`; S6 has `sensitivity="private"`; S3/S4 satisfy "absent + lookup recorded" OR "present + flag" | semantic check | `node tests/Tools/m365-spike/validate-fixtures.mjs --semantic` | Wave 0 |
| SETUP-02 | Sanitization: no e-mail except `@example.test`, no URLs except allowed hosts, no GUID except `00000000-0000-4000-8000-*`, no JWT, no value from `raw/` (when `raw/` present) | leak scan | `node tests/Tools/m365-spike/validate-fixtures.mjs --leaks` | Wave 0 |
| SETUP-02 | Fixtures load and replay through `Http::fake`, nextLink followed | PHPUnit | `vendor/bin/phpunit --filter CalendarViewFixturesTest` | Wave 0 (needs PHP) |
| SETUP-02 | Gitignore protects `raw/` and `.env.local` | file check + `git check-ignore` | `node validate-docs.mjs gitignore` (and `git check-ignore -v tests/Tools/m365-spike/raw/x tests/Tools/m365-spike/.env.local` where git exists) | Wave 0 |
| SETUP-03 | Decision doc has the required headings (Occurrence key, Series key, Cancelled, Declined, Moved, Private, All-day, ImmutableId + nextLink, ReadBasic, Corrections to earlier research), each decision line carries an `Evidence:` pointer | doc-structure | `node validate-docs.mjs decisions` | Wave 0 |
| SETUP-03 | Every fixture path cited in the decision doc exists; every scenario in the manifest is cited at least once; observed values quoted in the doc match the manifest (script compares `type`/`present` fields mentioned in `observed` tags) | traceability | `node validate-docs.mjs decisions --trace` | Wave 0 |
| All | Harness formatting stays green | lint | `npm run format:check` | existing |

### Sampling Rate
- **Per task commit:** `node --test tests/Tools/m365-spike/` plus the single validator subcommand for the artifact touched.
- **Per wave merge:** all `validate-*` subcommands + `npm run format:check`.
- **Phase gate:** all validators green, PHPUnit fixture test green where PHP exists, human-verify checkpoints signed off (registration verified, Round A and B captured), before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/Tools/m365-spike/.gitignore` (first file created, before any capture code) — covers SETUP-02/secrets
- [ ] `tests/Tools/m365-spike/validate-docs.mjs`, `validate-fixtures.mjs` and `*.test.mjs` unit tests for the sanitizer (determinism: same input twice → identical output; length preservation; allow-list drops `body`; email/GUID mapping; leak guard fails on a planted email)
- [ ] `tests/Unit/M365/CalendarViewFixturesTest.php` (written now, executed where PHP exists)
- [ ] Framework install: none (built-ins only)

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` (read from config this session). Scope: the spike and the tenant configuration; product-code controls start in Phase 2.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (harness + tenant) | Entra-hosted login with MFA/CA; auth code + PKCE + `state`; Assignment required; no password handling in the harness |
| V3 Session Management | limited | harness holds tokens in memory only, process exit ends the "session"; no cookies |
| V4 Access Control | yes | "Assignment required" + direct group membership; least-privilege scopes; non-admin test users; temporary admin roles only for the setup session |
| V5 Input Validation | yes (callback) | verify `state` (constant time), accept one callback on one path, reject extra params; sanitizer allow-list |
| V6 Cryptography | yes | `node:crypto` for PKCE; HMAC-SHA256 for pseudonyms; no hand-rolled primitives |
| V7 Error Handling and Logging | yes | never log tokens/response bodies/secret; print scope names, statuses and counts only |
| V8 Data Protection | yes | fixtures contain no personal data; `raw/` gitignored then deleted; secret hand-over via password manager; short-lived harness secret |
| V14 Configuration | yes | secrets via env/`.env.local` (gitignored), expiry tracked, redirect URIs minimal and temporary ones removed |

### Known Threat Patterns for Entra single-tenant + local OAuth harness

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client secret committed or pasted in chat | Information Disclosure | Password manager hand-over; secret scan in the validator; separate short-lived spike secret; rotate on any doubt |
| Authorization code intercepted by another local process on the loopback port | Spoofing / EoP | PKCE S256 + `state`; bind to `127.0.0.1`; single use; short-lived server |
| Device-code phishing against the app | Spoofing | Do not enable **Allow public client flows** on the production registration; consider CA block of device code flow [CITED: policy-block-authentication-flows] |
| Over-broad redirect URIs left registered (localhost) | Tampering | Remove the temporary URI after Round B; Microsoft advises separate registrations for dev vs prod [CITED: reply-url] |
| Guests / unassigned users sign in | Elevation of Privilege | Assignment required = Yes + group; guests blocked by it; app-side checks in Phase 2 |
| Assignment check bypassed by privileged roles (Global Admin) | Elevation of Privilege | Know it, do not use GA for tests; Phase 2 keeps its own `tid`/domain/guest checks |
| Consent phishing / unreviewed admin consent | Spoofing | Admin consents only the six listed delegated scopes after reviewing the list; never `Calendars.ReadWrite`/application permissions |
| Real PII in fixtures | Information Disclosure | Dedicated test users, subject-tag convention, allow-list sanitizer, leak guard, `raw/` deleted |
| Access/refresh tokens on disk | Information Disclosure | Re-login per round; nothing persisted |
| Secret expiry causing production outage | Denial of Service | Expiry date in runbook, reminder >= 30 days (recommend 45), dual-secret rotation procedure |

## Sources

### Primary (HIGH confidence, fetched this session)
- https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app (EN + es-es) — register app, account types, hidden by default, admin consent
- https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri (EN + es-es) — Authentication blade, Redirect URI configuration tab, platform tiles
- https://learn.microsoft.com/en-us/entra/identity-platform/reply-url — redirect URI restrictions, localhost rules, limits
- https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials (EN + es-es) — client secret steps, 24-month cap, <12-month recommendation, certificate recommendation
- https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-access-web-apis (EN + es-es) — delegated Graph permissions, admin consent button
- https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent (EN + es-es) — consent paths, roles
- https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal (EN + es-es) — assignment steps, P1/P2, no nested groups, consent requirement
- https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/application-properties (es-es) and add-application-portal-configure (EN) — Properties labels, Assignment required semantics
- https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50105-user-not-assigned-role — AADSTS50105, Global Admin bypass
- https://learn.microsoft.com/en-us/entra/identity/conditional-access/what-if-tool (EN + es-es), troubleshoot-conditional-access, policy-block-authentication-flows — CA review procedure, sign-in logs, audience reporting, device code flow
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow — authorize/token parameters, PKCE recommended for all clients, `client_secret` for web apps, refresh token lifetimes
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code — device flow endpoints and response example
- https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview — query/header behaviour, `$top` 1-1000, `createdDateTime`/`lastModifiedDateTime` not in `$select`, permissions table
- https://learn.microsoft.com/en-us/graph/api/resources/event — property definitions (`type`, `seriesMasterId`, `originalStart`, `iCalUId`, `isCancelled`, `sensitivity`, `cancelledOccurrences`...)
- https://learn.microsoft.com/en-us/graph/outlook-immutable-id — header scope per request, immutable id lifetime
- https://learn.microsoft.com/en-us/graph/paging — nextLink semantics
- https://learn.microsoft.com/en-us/graph/api/event-cancel, event-decline — organizer-only cancel, Deleted Items
- https://learn.microsoft.com/en-us/graph/permissions-reference — `Calendars.Read` / `Calendars.ReadBasic` delegated entries (first 100k chars read)
- https://laravel.com/docs/13.x/http-client — `Http::fake`, `Http::sequence`, `preventStrayRequests`
- Repo files read this session: `.planning/phases/01-.../01-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md`, `ROADMAP.md`, `research/{SUMMARY,STACK,PITFALLS}.md`, `research/ARCHITECTURE.md:225-249`, `codebase/TESTING.md`, `.claude/CLAUDE.md`, `.planning/config.json`, `.dockerignore:1-30`, `.gitignore:1-40`, `package.json:1-30`, `phpunit.xml:1-20`, `.env.example:1-12`, `composer.json:67-71` (via grep), `eslint.config.mjs`

### Secondary (MEDIUM confidence)
- https://nocal.app/blog/2026/07/microsoft-graph-calendar-sync-guide — vendor write-up: cancelledOccurrences on master, originalStart as recurrence id, Prefer header/nextLink not covered
- https://pnp.github.io/blog/post/one-outlook-edit-became-two-microsoft-graph-events/ — series split produces two masters, no linking field
- support.microsoft.com es-es pages surfaced by WebSearch (create/modify meeting in Outlook on the web; make appointment private): Spanish Outlook labels; summarized by the search tool, not read in full

### Tertiary (LOW confidence, validate in the spike)
- Attendee-side cancelled/declined/moved representation in `calendarView` (no source found; web search explicitly returned nothing authoritative)
- Spanish live-portal labels marked [unverified]
- `Prefer` combined-header acceptance; `$select` behaviour for `lastModifiedDateTime`/`attendees`

## Metadata

**Confidence breakdown:**
- Standard stack (harness choice): HIGH — decided by verified environment facts and repo constraints
- Entra portal paths/behaviour: HIGH for English; MEDIUM for Spanish labels (Learn MT inconsistency)
- Outlook scenario creation steps: MEDIUM (labels from search summaries; behaviour of attendee copies unknown by design)
- Architecture/validation approach: HIGH
- Pitfalls: HIGH for Entra items (cited), MEDIUM for Windows loopback and Outlook-client variance

**Research date:** 2026-10-19
**Valid until:** 2026-11-18 for Entra portal labels (fast-moving UI); Graph property semantics stable (~90 days). The DST window advice expires on 2026-10-25.
