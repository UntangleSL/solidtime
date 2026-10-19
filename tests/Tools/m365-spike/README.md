# Microsoft 365 spike harness

Throwaway-but-committed tooling for phase 01 (tenant setup and Outlook spike). It proves that
Untangle's Entra app registration works (the owner and a non-admin colleague, neither individually
assigned, sign in with exactly the planned scopes and no consent prompt) and records real
`calendarView` responses from a test mailbox. Phase 2 builds the real Microsoft login in Laravel;
nothing here is used by the app.

It is never shipped: `tests` is in `.dockerignore`, so the harness stays out of the image. It has
no dependencies (Node 20.6 or newer, built-in modules only).

Access model (decided 2026-10-19): the enterprise app has "Assignment required?" = No, so any
Member of the tenant (`untanglegrowth.com` primary, `untangle.es`) can sign in; guests are rejected
later, in code. There is no blocked-outsider check any more: the check that matters is that a
non-admin, non-assigned person (user B) gets in without a consent prompt.

## Commands

Run them from the repository root, in your own terminal (never through a shared session). The
secrets come from Doppler (project `vps`, config `dev`):

```sh
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs auth
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs auth --as B
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs capture --round A
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs capture --round B
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs status
```

Without Doppler, copy `.env.local.example` to `.env.local`, fill in the values (the file is
git-ignored) and replace the `doppler run ... --` prefix with
`node --env-file=tests/Tools/m365-spike/.env.local`.

| Command | What it does | Signs in as |
|---------|--------------|-------------|
| `auth` | checks granted scopes, refresh token, tenant, `userType` and that no consent prompt appeared; writes `raw/auth-check.json` | test user A (the owner) |
| `auth --as B` | the same assertions with `M365_SPIKE_B_LOGIN_HINT`: B is a non-admin, non-assigned Member and must get in with the six scopes and no consent prompt; writes `raw/auth-check-b.json` (never `me.json`) | test user B (Alejandro Cava) |
| `capture --round A` or `B` | records the calendarView experiments (see below) under `raw/roundA/` or `raw/roundB/`; Round B also looks up every Round A id | test user A |
| `status` | prints SET/MISSING per setting and which variable supplied it, git-ignore status, booleans, status codes and counts; no network | nobody |

Resumen en español: `auth` comprueba el inicio de sesión de la usuaria A (la propietaria) y
`auth --as B` el de Alejandro Cava (sin rol de administrador y no asignada): ambas deben entrar con
los seis permisos y sin pantalla de consentimiento. Cada persona inicia sesión ella misma, con su
MFA. Los secretos salen de Doppler (`doppler run -p vps -c dev -- node ...`); nunca se pasan como
argumento.

Each sign-in prints a URL. Open it in an InPrivate/private window and sign in as the named person
(the developer's own browser session must not be used; nobody shares a password: each person signs
in themselves, with their MFA). The loopback listener binds `127.0.0.1` and `::1` only; Entra
ignores the port for `http://localhost`, so the registered `http://localhost/m365-spike/callback`
matches `http://localhost:8765/m365-spike/callback`.

A capture run records, per round: `prod-select`, `prefer-separate` (two `Prefer` header lines),
`page2-no-prefer`, `no-immutableid`, `experiment-select` (adds `lastModifiedDateTime` and
`attendees`), `full-shape` (no `$select`), `series` (master plus instances) and, in Round B,
`lookups` (`GET /me/events/{id}` for every Round A id, with the id URL-encoded). A failing request
is recorded as its status and error code, never as a crash.

## Settings and Doppler names

Every setting has an `M365_*` name. When it is unset, the harness reads the Doppler name instead
(names only below; values are never printed):

| Setting | Doppler name |
|---------|--------------|
| `M365_TENANT_ID` | `SOLIDTIME_MICROSOFT_TENANT_ID` |
| `M365_CLIENT_ID` | `SOLIDTIME_MICROSOFT_CLIENT_ID` |
| `M365_CLIENT_SECRET` | `SOLIDTIME_M365_SPIKE_CLIENT_SECRET` |
| `M365_SPIKE_*` (login hints, window, Outlook client, port) | `SOLIDTIME_M365_SPIKE_*` (same suffix) |

`M365_SPIKE_B_LOGIN_HINT` also accepts the deprecated `M365_SPIKE_BLOCKED_LOGIN_HINT` from the old
`auth --expect-blocked` design; `status` marks it as a deprecated alias.

The production secret `SOLIDTIME_MICROSOFT_CLIENT_SECRET` (Doppler `prd`) is **never** read. If it
is present in the environment (for example copied into `dev` by mistake), `status` prints a
warning line with the name only, and `auth` and `capture` refuse to run with exit code 2 and a
Spanish plus English message. Resumen: el secreto de producción no debe estar en la configuración
dev; la herramienta se niega a ejecutarse mientras esté.

## Safety rules

- `raw/` holds real test-mailbox data. It is git-ignored, must never be pasted into chats or AI
  assistants, and is deleted at the end of the phase together with `.env.local`.
- The client secret is read only from the environment (Doppler or `--env-file`); the CLI refuses
  every unknown argument, so a secret can never be passed on the command line. Use the temporary
  `spike-*` secret (`SOLIDTIME_M365_SPIKE_CLIENT_SECRET`), never the production one.
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

## Troubleshooting

- `AADSTS7000215` (invalid client secret): the value is not the secret's **Value** (for example the
  Secret ID was copied).
- `AADSTS7000222` (secret expired): ask the admin for a new `spike-*` secret, see
  `docs/m365/RUNBOOK-entra-app.md` section "Renovación del secreto". Captures already in `raw/`, the
  immutable ids and `raw/salt` stay valid.
- `auth --as B` fails with `AADSTS50105`: someone turned "Assignment required?" on for the
  enterprise app. Set it back to No (guide, Parte 5); B is deliberately not assigned.
- `auth --as B` reports a consent prompt: the admin consent from guide Parte 3 is missing or
  incomplete (A, as Global Administrator, would not have seen it).
