# Phase 1: Tenant Setup & Outlook Spike - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Get Untangle's Entra ID app registration created and consented, and record real Outlook `calendarView` responses from an Untangle mailbox as sanitized fixtures, so Phases 2–6 are built on verified tenant facts. Covers SETUP-01, SETUP-02, SETUP-03. No product feature code (no login button, no calendar UI) — only docs, a minimal spike harness to capture fixtures, the fixtures themselves, and a decision document.

</domain>

<decisions>
## Implementation Decisions

### Admin guide (explicit user request)
- **D-01:** Deliver a step-by-step guide **in Spanish** for Untangle's M365 admin (who is not a developer) to register the app in the Entra admin center. It must cover: Web platform (not SPA), single tenant, redirect URIs for local dev and the Dokploy HTTPS URL, delegated permissions `openid profile email offline_access User.Read Calendars.Read`, granting tenant-wide admin consent, enabling "Assignment required" + assigning the staff group, creating the client secret and recording its expiry date (+ renewal reminder ≥30 days before), reviewing Conditional Access policies that affect the app, and preparing the test mailbox with the 8 scenarios. It must end with a checklist of exactly what to hand back (tenant ID, client ID, secret via secure channel, secret expiry date, group name, CA findings, test mailbox address) and how to hand it back securely (never via repo/chat in plain text).
- **D-02:** The guide lives in the repo (e.g. `docs/m365/`), is written so the admin can follow it without asking questions (exact menu paths in the Entra admin center, what to click, what values to paste, screenshots-not-required wording), and includes a short "why" per step so the admin understands the security intent.
- **D-03:** A separate runbook (can be Spanish too) records the resulting registration values that are not secret (tenant ID, client ID, redirect URIs, scopes, group, secret expiry date) and the secret renewal procedure. Secrets never committed.

### Test mailbox scenarios
- **D-04:** The 8 scenarios: single meeting; recurring series with one edited occurrence (exception); cancelled meeting; declined meeting; moved meeting (time changed after creation); private meeting; all-day event; personal block without attendees. The guide must explain to the admin how to create each in Outlook (some require a second account as organizer: cancelled/declined/moved-by-organizer).

### Spike harness and fixtures
- **D-05:** Fixtures are captured with a minimal, throwaway-but-committed spike harness (e.g. an Artisan command or script outside the product module) using the delegated flow with the scopes above, `Prefer: outlook.timezone="UTC"` and `Prefer: IdType="ImmutableId"`, following `@odata.nextLink`. Fixtures are sanitized (no real names, emails, subjects, bodies, join URLs, tokens) before commit and stored under `tests/Fixtures/M365/` (or similar) for `Http::fake` in later phases.
- **D-06:** The decision document (e.g. `docs/m365/DECISIONS-graph.md` or under `.planning/`) fixes: occurrence key, series key (`seriesMasterId` vs alternatives), how cancelled/declined/moved/private/all-day appear, ImmutableId behaviour across nextLink, whether `Calendars.ReadBasic` would suffice (informational only — PROJECT.md keeps `Calendars.Read`).

### Locked from PROJECT.md
- **D-07:** Single tenant Untangle only; never `common`/`organizations`.
- **D-08:** Deployment target is Untangle's own Dokploy (HTTPS behind proxy); redirect URI must be explicit and https.

### Claude's Discretion
- Exact file names/locations for guide, runbook, decision doc, fixtures and harness.
- Whether the spike harness uses Socialite or a raw OAuth code flow (it is throwaway; Phase 2 builds the real login).
- How the plan models waiting on the admin (human-action checkpoints are expected; tasks that need tenant credentials must be gated behind them).

</decisions>

<specifics>
## Specific Ideas

- The user (Untangle, non-technical product owner) asked explicitly: "planifica la fase 1 e incluye la guía paso a paso del registro en Entra para nuestro admin".
- The guide is the first deliverable — it should be producible immediately without any tenant access, so the admin can start while the rest waits.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md` — locked decisions (single tenant, scopes, Dokploy, security constraints)
- `.planning/REQUIREMENTS.md` — SETUP-01..03
- `.planning/ROADMAP.md` §Phase 1 — admin actions list and success criteria
- `.planning/research/SUMMARY.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` — Entra/Graph facts (Web platform, ImmutableId, UTC Prefer, secret ≤24 months, Traefik redirect URI pitfalls, guests, assignment required)
- `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/CONCERNS.md` — current auth stack and proxy config (`config/trustedproxy.php`, `APP_FORCE_HTTPS`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/` directory exists at repo root — natural home for the admin guide.
- `.env.example` — will later receive `MICROSOFT_*` variables (Phase 2), not in this phase.

### Integration Points
- None for product code in this phase.

</code_context>

<deferred>
## Deferred Ideas

- Real Microsoft login, token storage, Graph client — Phase 2/3.

</deferred>

---

*Phase: 01-tenant-setup-outlook-spike*
*Context gathered: 2026-10-19 from user request + project decisions*
