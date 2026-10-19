---
phase: 01-tenant-setup-outlook-spike
plan: 02
subsystem: infra
tags: [entra-id, oauth-pkce, microsoft-graph, calendarview, node-test, spike-harness]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-01 doc gates (validate-docs.mjs secrets and gitignore) that scan this plan's files"
provides:
  - "Zero-dependency capture CLI: auth, auth --expect-blocked, capture --round A|B, status (tests/Tools/m365-spike/capture.mjs)"
  - "lib/oauth.mjs: PKCE S256, state, loopback callback on 127.0.0.1 and ::1, code redemption, scope comparison, endpoint and tenant guards"
  - "lib/graph.mjs: paged Graph GETs with Prefer re-sent on every page, seven recorded passes, series and Round B lookups"
  - "Local fake Entra + Graph server and 36 offline node:test cases"
  - "Nested .gitignore (raw/, .env.local), .env.local.example and README"
affects: [01-03, 01-05, 01-06, 01-07, phase-02, phase-03]

actuals:
  tokens: 25200
  tasks: 3
  commits: 4
plan_head_before: c7bcd686add3d1c1bbda7f656436e849e51a982a
plan_head_after: 9ea37c6d451b04fa76b565ff1587f9c2e9bb88a8

tech-stack:
  added: []
  patterns:
    - "Injectable endpoints/openUrl/ask/rawDir/timeoutMs on every command, so the same code runs against a local fake and against Microsoft"
    - "Raw files hold bodies only for successful responses; a failed response is recorded as status + error.code"
    - "Test credentials, tokens and GUIDs are generated at runtime so no committed file matches the secrets gate"

key-files:
  created:
    - tests/Tools/m365-spike/.gitignore
    - tests/Tools/m365-spike/.env.local.example
    - tests/Tools/m365-spike/README.md
    - tests/Tools/m365-spike/capture.mjs
    - tests/Tools/m365-spike/lib/oauth.mjs
    - tests/Tools/m365-spike/lib/graph.mjs
    - tests/Tools/m365-spike/test/fake-microsoft.mjs
    - tests/Tools/m365-spike/test/capture.e2e.test.mjs
    - tests/Tools/m365-spike/test/oauth.test.mjs
  modified:
    - .planning/WINDOWS.md

key-decisions:
  - "The loopback listener closes only after the browser response was flushed, and an occupied ::1 port is a hard error (only EADDRNOTAVAIL/EAFNOSUPPORT are ignored), so no other process can receive the redirect that localhost may resolve to"
  - "fetchAllPages refuses a nextLink whose origin differs from the first URL and records next_link_origin_mismatch, so the bearer token can never follow a link to another host"
  - "CLI argument errors report only the position of the unknown token, never the token, so a secret typed by mistake is not echoed"
  - "The page2-no-prefer pass stops after page 2 (stopAfter option) instead of walking every page without Prefer"
  - "meta.json passes.lookups uses status 200 when every lookup answered 2xx or 404 (404 is data), pages 0 and events = number of ids looked up"

patterns-established:
  - "Command functions return the raw-file document plus exitCode (and failures for auth); the CLI only maps that to a process exit code"
  - "status prints booleans, whitelisted shapes, status codes and counts only; every other field in raw/ is ignored by construction"

requirements-completed: []

coverage:
  - id: D1
    description: "capture signs in with code + PKCE S256 + state + client secret on a loopback redirect, holds tokens in memory, walks every nextLink page with Authorization and Prefer re-sent"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/capture.e2e.test.mjs (happy path, no-secret-in-files-or-console, tampered state, wrong secret)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Identity guard: state mismatch, signed-in account differing from the login hint, Guest and foreign tid abort before any calendar request"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "capture.e2e.test.mjs (tampered state, identity differs, Guest and foreign tenant: zero calendarView requests, no round directory)"
        status: pass
    human_judgment: false
  - id: D3
    description: "auth records scopeMatches, refreshTokenIssued, tidMatches, userType, signedInMatchesLoginHint, consentPromptShown; auth --expect-blocked records AADSTS50105 from callback or operator and never redeems a code"
    requirement: SETUP-01
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/oauth.test.mjs (18 tests, 0 fail)"
        status: pass
    human_judgment: true
    rationale: "Proven against a fake; the real tenant behaviour (what Entra returns for scope, the AADSTS50105 page) is only confirmed when 01-05 runs these commands against the real registration"
  - id: D4
    description: "capture --round A|B records the experiments the decision document needs and the Round B lookups; status prints no value"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "capture.e2e.test.mjs (seven pass files, two Prefer lines, page 2 without Prefer, no ImmutableId, 400 recorded, series once per master, Round B encoded lookups with a 404, Round B without Round A stops before authorize)"
        status: pass
      - kind: other
        ref: "node tests/Tools/m365-spike/capture.mjs status (exit 0, every variable MISSING, ignore lines present)"
        status: pass
    human_judgment: true
    rationale: "Real Graph may answer differently from the fake (for example how Prefer on separate lines is treated); that difference is exactly what the spike records"

duration: 12min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 02: Capture harness against a local fake Entra and Graph Summary

**Zero-dependency Node harness (`auth`, `auth --expect-blocked`, `capture --round A|B`, `status`) doing authorization code + PKCE + state + secret on a loopback redirect, recording seven calendarView experiments plus Round B lookups, proven end-to-end offline against a fake Entra/Graph server.**

## Note for the product owner

Nothing here needs a decision from you or the admin. The harness is ready: the moment the admin hands back the tenant ID, client ID and the temporary `spike-*` secret and the test users exist, the registration can be verified (`auth`, `auth --expect-blocked`) and both capture rounds can be run without writing more code. Everything was tested only against a local fake, so the first real run (plan 01-05) is the first time real Microsoft answers; differences found there are the spike's findings, not harness bugs by default.

## Performance

- **Duration:** about 12 min
- **Tasks:** 3 (Task 2 as RED and GREEN commits)
- **Files created:** 9 (plus `.planning/WINDOWS.md` updated)

## Accomplishments

- `.gitignore` for `raw/` and `.env.local` was the first file created; `git check-ignore` confirms both, `.env.local.example` stays committed, and `validate-docs.mjs gitignore` and `secrets` pass.
- Sign-in path: tenant GUID only (D-07), PKCE S256 (48 random bytes), 32-char state compared with `timingSafeEqual`, one request on `/m365-spike/callback`, listeners on `127.0.0.1` and `::1`, token redemption whose errors carry only the HTTP status and `error`/AADSTS codes. The refresh token value is dropped on receipt.
- Identity guard (Pitfall 5) runs before any calendar request: mail/UPN equals the login hint, `userType` is Member, `tid` equals the tenant. Tests prove zero calendarView calls and no round directory on a mismatch, a Guest and a foreign tenant.
- `auth`, `auth --expect-blocked` and `status` as one command each; `status` was verified to print nothing from a raw file beyond whitelisted booleans, shapes, codes and counts (a canary field in the test files never appears).
- Capture protocol: `prod-select`, `prefer-separate` (two real `Prefer` lines through `node:http`), `page2-no-prefer`, `no-immutableid`, `experiment-select` (a 400 is recorded, run still succeeds), `full-shape`, `series` (master plus paged instances, once per master) and, in Round B, `lookups` with `encodeURIComponent` ids and 404 recorded as data.
- 67 tests pass for the whole directory (36 from this plan, 31 from 01-01), all offline.

## CLI as implemented

```text
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs
    auth                     exit 0 only if scopes match, refresh token issued, tid matches,
                             userType Member, signed in as the hint, no consent prompt
    auth --expect-blocked    exit 0 only when AADSTS50105 was seen (callback or typed)
    capture --round A|B      exit 0 when the run completed (failed requests are recorded)
    status                   no network; exit 0
```

Any other token exits 2 with "unknown argument at position N" (the token is never echoed). `auth`/`capture` abort unless `git check-ignore` confirms `raw/` is ignored. The CLI always uses `MICROSOFT_ENDPOINTS`; only tests inject `endpoints`. Environment variables: the nine names in `.env.local.example`.

## Raw layout as implemented (local only, git-ignored; contract for 01-03)

```text
raw/auth-check.json    { checkedAt, grantedScopes, scopeMatches, missingScopes, extraScopes,
                         refreshTokenIssued, idTokenIssued, tidMatches, userType,
                         signedInMatchesLoginHint, consentPromptShown }
raw/auth-blocked.json  { checkedAt, blocked, errorCode, source: 'callback' | 'operator' }
raw/me.json            GET /me?$select=id,displayName,givenName,surname,mail,userPrincipalName,userType,preferredLanguage
raw/round{A|B}/me.json, token-shape.json, meta.json
raw/round{A|B}/{prod-select,prefer-separate,page2-no-prefer,no-immutableid,experiment-select,full-shape}.json
                       { pass, round, capturedAt, pages: [{ request: { url, headerNames, preferMode, status }, errorCode, body }] }
raw/round{A|B}/series.json   { masters: [{ masterId, request, errorCode, body }], instances: [{ masterId, pages }] }
raw/roundB/lookups.json      { lookups: [{ id, request: { url, status }, errorCode, body }] }
```

`body` is null for any non-2xx response (the status and `errorCode` carry the result). `meta.json` is `{ round, capturedAt, window, passes: { <name>: { status, pages, events } } }` with seven entries (eight in Round B, adding `lookups`). `request.url` holds the real window and ids, so the sanitizer in 01-03 must treat it as sensitive. `request.preferMode` is one of `combined`, `separate`, `tz-only`, `none`.

## Task Commits

1. **Task 1 (tracer): end-to-end slice against a fake Entra + Graph** - `4d5cc5a6` (feat)
2. **Task 2: auth, auth --expect-blocked, status** - `32c0accb` (test, RED: 9 of 18 tests fail on assertions against vacuous stubs) and `0cb47d5a` (feat, GREEN: 18/18)
3. **Task 3: full capture protocol, env template, README** - `9ea37c6d` (feat)

**Plan metadata:** recorded in the final docs commit.

Tracer gate for Task 1 (interactive, `end-of-phase`, automated-only verify): re-ran both verify commands after the commit. 7/7 tests, both paths ignored. Passed, so expansion continued.

## Files Created/Modified

- `tests/Tools/m365-spike/capture.mjs` - CLI plus `runAuth`, `runExpectBlocked`, `runCapture`, `runStatus`, `parseWindow`, `parseArgs`, `main`
- `tests/Tools/m365-spike/lib/oauth.mjs` - exports per the plan interfaces plus `MICROSOFT_ENDPOINTS` and `assertTenantId`
- `tests/Tools/m365-spike/lib/graph.mjs` - `graphGet`, `fetchAllPages`, `runCapturePasses`, `countEvents` and the select/Prefer constants
- `tests/Tools/m365-spike/test/fake-microsoft.mjs` - the fake plus shared test helpers (`makeEvent`, `threePages`, `buildEnv`, `followRedirects`, `readAllFiles`, `headerValues`)
- `tests/Tools/m365-spike/test/capture.e2e.test.mjs`, `test/oauth.test.mjs` - the suites
- `tests/Tools/m365-spike/.gitignore`, `.env.local.example`, `README.md`
- `.planning/WINDOWS.md` - one `unrun-verify` entry (Prettier, below)

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Bearer token could follow a nextLink to another host**
- **Found during:** Task 1 (a bug in the fake's nextLink accidentally exercised it)
- **Issue:** `@odata.nextLink` is followed verbatim, so a link to a different origin would receive the Authorization header.
- **Fix:** `fetchAllPages` compares each URL's origin with the first URL's and records `next_link_origin_mismatch` instead of sending the request; a dedicated test uses a second local server and asserts it receives nothing.
- **Files modified:** `tests/Tools/m365-spike/lib/graph.mjs`, `tests/Tools/m365-spike/test/capture.e2e.test.mjs`
- **Committed in:** `4d5cc5a6`, `9ea37c6d`

**2. [Rule 1 - Bug] The two-Prefer-lines request was rejected by any HTTP/1.1 server**
- **Found during:** Task 3 (the prefer-separate test saw zero requests with two Prefer lines; the server answered 400)
- **Issue:** with a raw header array `node:http` adds no `Host` header, so the `prefer-separate` pass would have recorded a bogus 400 `unknown_error` against real Graph.
- **Fix:** `sendWithRawHeaders` sends `Host` explicitly.
- **Files modified:** `tests/Tools/m365-spike/lib/graph.mjs`
- **Committed in:** `9ea37c6d`

**3. [Rule 1 - Bug] Fake server dropped the port from its own nextLink**
- **Found during:** Task 1
- **Issue:** the fake built request URLs against a portless base, so page 2 pointed at port 80.
- **Fix:** the fake builds URLs from its real origin.
- **Files modified:** `tests/Tools/m365-spike/test/fake-microsoft.mjs`
- **Committed in:** `4d5cc5a6`

**4. [Rule 2 - Missing critical functionality] Loopback hardening beyond the plan text**
- **Issue:** closing the listener right after `res.end()` can cut the browser response, and silently ignoring every `::1` bind error would let another process on that port receive the redirect.
- **Fix:** listeners close on the response `close` event; only EADDRNOTAVAIL/EAFNOSUPPORT are ignored for `::1`.
- **Files modified:** `tests/Tools/m365-spike/lib/oauth.mjs`
- **Committed in:** `4d5cc5a6`

### Other deviations

- **Prettier not run.** `node_modules/` does not exist on this host and the orchestrator named Prettier unavailable, so `npm ci --ignore-scripts` was not attempted and `npx --no-install prettier --check` could not run (it asks to download). All `.mjs` files were formatted by hand to `.prettierrc.json` (4 spaces, single quotes, 100 columns, es5 trailing commas). Remaining lines over 100 columns are unbreakable string/template literals and `test('long name', async (t) => {` headers, which Prettier leaves as they are. **Watch the `npm-format-check` CI job on push**; recorded as an `unrun-verify` entry in `.planning/WINDOWS.md`.
- **`page2-no-prefer` stops after page 2** (`stopAfter` option in `fetchAllPages`), following the plan's "only the next page" wording, rather than walking every page without Prefer.
- **Additions the plan did not list:** `runAuth`/`runExpectBlocked` return `exitCode` (and `failures`) next to the raw-file fields; every command accepts an optional `timeoutMs`; the shared test helpers live in `fake-microsoft.mjs` instead of a separate file; one extra test proves a wrong secret yields only `HTTP 401` + `AADSTS7000215`, never the secret; the unknown-argument message gives the position instead of the token.
- **`requirements mark-complete` not run.** The plan lists SETUP-01 and SETUP-02, but this plan only delivers the tooling; the registration and the fixtures do not exist yet. They should be marked after 01-05 (registration verified) and 01-06/07 (fixtures sanitized), as with 01-01. `requirements-completed` is empty on purpose.
- **Commit trailer.** All four commits end with `Co-Authored-By: Claude Sonnet 5.5`, as the session attribution instruction requires.

## Issues Encountered

A heredoc collapsed `\/` in a scripted regex edit, producing a syntax error that stopped every test file from loading; fixed with the Edit tool before any commit. A debugging detour with `node:http` raw headers led to deviation 2.

## Known Stubs

None. Every command is implemented and exercised by tests; nothing returns placeholder data. The only deliberately incomplete piece is behaviour that cannot exist before a real tenant does (real Entra and Graph answers), which the spike itself records.

## Threat Flags

None beyond the plan's threat model (T-01-06 to T-01-11 are mitigated and test-covered; T-01-SC accepted, no package was installed). The nextLink origin guard (deviation 1) is an extra mitigation, not new surface.

## Next Phase Readiness

- 01-03 (sanitizer) can read the raw layout above; `request.url` fields carry real window and id values.
- 01-05 can run `auth`, `auth --expect-blocked` and `capture --round A|B` as soon as credentials and the two test users exist. Run them from the operator's own terminal, open the printed URL in an InPrivate window.
- Blocked on people, not code: registration, secret, test users and scenario events (admin), Dokploy domain (product owner).

## Self-Check: PASSED

All nine created files exist and the SUMMARY is in place; commits `4d5cc5a6`, `32c0accb`, `0cb47d5a` and `9ea37c6d` are ancestors of HEAD.
