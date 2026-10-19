# Microsoft 365 spike harness

Throwaway-but-committed tooling for phase 01 (tenant setup and Outlook spike). It proves that
Untangle's Entra app registration works (assigned user signs in with exactly the planned scopes and
no consent prompt, outsider is blocked) and records real `calendarView` responses from a test
mailbox. Phase 2 builds the real Microsoft login in Laravel; nothing here is used by the app.

It is never shipped: `tests` is in `.dockerignore`, so the harness stays out of the image. It has
no dependencies (Node 20.6 or newer, built-in modules only).

## Commands

Run them from the repository root, in your own terminal (never through a shared session):

```sh
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs auth
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs auth --expect-blocked
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs capture --round A
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs capture --round B
node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs status
```

Copy `.env.local.example` to `.env.local` first and fill in the values (the file is git-ignored).

| Command | What it does | Signs in as |
|---------|--------------|-------------|
| `auth` | checks granted scopes, refresh token, tenant, `userType` and that no consent prompt appeared; writes `raw/auth-check.json` | test user A |
| `auth --expect-blocked` | expects `AADSTS50105` (user not assigned); never redeems a code that arrives; writes `raw/auth-blocked.json` | test user B |
| `capture --round A` or `B` | records the calendarView experiments (see below) under `raw/roundA/` or `raw/roundB/`; Round B also looks up every Round A id | test user A |
| `status` | prints SET/MISSING per variable, git-ignore status, booleans, status codes and counts; no network | nobody |

Each sign-in prints a URL. Open it in an InPrivate/private window and sign in as the named test
user (the developer's own browser session must not be used). The loopback listener binds
`127.0.0.1` and `::1` only; Entra ignores the port for `http://localhost`, so the registered
`http://localhost/m365-spike/callback` matches `http://localhost:8765/m365-spike/callback`.

A capture run records, per round: `prod-select`, `prefer-separate` (two `Prefer` header lines),
`page2-no-prefer`, `no-immutableid`, `experiment-select` (adds `lastModifiedDateTime` and
`attendees`), `full-shape` (no `$select`), `series` (master plus instances) and, in Round B,
`lookups` (`GET /me/events/{id}` for every Round A id, with the id URL-encoded). A failing request
is recorded as its status and error code, never as a crash.

## Safety rules

- `raw/` holds real test-mailbox data. It is git-ignored, must never be pasted into chats or AI
  assistants, and is deleted at the end of the phase together with `.env.local`.
- The client secret is read only from the environment (through `--env-file`); the CLI refuses every
  unknown argument, so a secret can never be passed on the command line. Use the temporary
  `spike-*` secret, never the production one.
- Tokens stay in memory. Nothing printed or written contains a token, the secret or an address.
- The CLI aborts unless `raw/` is git-ignored, and it only talks to `login.microsoftonline.com` and
  `graph.microsoft.com` with the tenant GUID (never `common` or `organizations`).
- `capture` refuses to call any calendar endpoint unless the signed-in account is the one in
  `M365_SPIKE_LOGIN_HINT`, is a Member (not a Guest) and belongs to `M365_TENANT_ID`.

## Data flow

```text
capture.mjs  ->  raw/ (git-ignored)  ->  sanitize.mjs (plan 01-03)  ->  tests/Fixtures/M365
```

## Tests

```sh
node --test "tests/Tools/m365-spike/test/*.test.mjs"
```

The suites run entirely offline against `test/fake-microsoft.mjs`, a fake Entra and Graph server on
`127.0.0.1`. Pass file paths or a quoted glob: `node --test <directory>` fails on Node 24.

## Troubleshooting the token step

- `AADSTS7000215` (invalid client secret): the value in `.env.local` is not the secret's **Value**
  (for example the Secret ID was copied).
- `AADSTS7000222` (secret expired): ask the admin for a new `spike-*` secret, see
  `docs/m365/RUNBOOK-entra-app.md` section "Renovación del secreto". Captures already in `raw/`, the
  immutable ids and `raw/salt` stay valid.
