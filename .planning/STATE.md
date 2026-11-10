---
gsd_state_version: "1.0"
current_phase: 3
current_phase_name: Outlook Meetings in the Calendar
status: executing
stopped_at: Wave 9 (03-10, 03-11 parallel) merged; combined CI gate pending
last_updated: "2026-11-10T10:37:46.407Z"
last_activity: 2026-11-05
last_activity_desc: Phase 3 execution started
state_head: dd48a39bebfc1205b9eac83cc476be118e800527
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 31
  completed_plans: 30
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** A user opens the solidtime calendar and their Outlook meetings are already there, so logging meeting time to the right project takes one click instead of re-typing it from Outlook.
**Current focus:** Phase 3 — Outlook Meetings in the Calendar

## Current Position

Phase: 3 (Outlook Meetings in the Calendar) — EXECUTING
Plan: 12 of 12
Status: Ready to execute
Last activity: 2026-11-05 — Phase 3 execution started

Progress: [███░░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 19
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 2 | 11 | - | - |
| 1 | 8 | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 1 P01 | 25min | 3 tasks | 4 files |
| Phase 1 P02 | 12min | 3 tasks | 9 files |
| Phase 1 P03 | 31min | 3 tasks | 8 files |
| Phase 1 P04 | 4min | 2 tasks | 2 files |
| Phase 1 P05 | 25min | 2 tasks | 3 files |
| Phase 01 P06 | 25min | 2 tasks | 6 files |
| Phase 1 P07 | 20min | 3 tasks | 143 files |
| Phase 1 P08 | 2 sessions | 3 tasks | 11 files |
| Phase 02 P01 | 30min | 2 tasks | 14 files |
| Phase 02 P02 | 15min | 2 tasks | 12 files |
| Phase 02 P03 | 70min | 2 tasks | 5 files |
| Phase 2 P04 | 35min | 2 tasks | 6 files |
| Phase 02 P05 | 25min | 2 tasks | 3 files |
| Phase 02 P06 | 35min | 2 tasks | 5 files |
| Phase 02 P07 | 50min | 2 tasks | 4 files |
| Phase 02 P08 | 45min | 2 tasks | 10 files |
| Phase 02 P09 | 40min | 2 tasks | 10 files |
| Phase 2 P10 | 75min | 2 tasks | 6 files |
| Phase 3 P01 | 45min | 2 tasks | 13 files |
| Phase 03 P05 | 55 min | 2 tasks | 10 files |
| Phase 3 P02 | 50min | 3 tasks | 7 files |
| Phase 3 P03 | 75min | 2 tasks | 10 files |
| Phase 03 P04 | 95min | 3 tasks | 12 files |
| Phase 3 P06 | 75 min | 3 tasks | 11 files |
| Phase 03 P07 | 70min | 2 tasks | 9 files |
| Phase 3 P08 | 45min | 2 tasks | 10 files |
| Phase 03 P09 | 3h | 3 tasks | 14 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Graph sync backend and calendar ghost UI merged into one vertical phase (Phase 3), compressing research's 8 suggested phases to 7
- [Roadmap]: Phase 5 (recurring rules) and Phase 6 (out-of-sync) depend only on Phase 4 and can run in parallel
- [Roadmap]: Deletion cleanup (SEC-03) and the off switch (OPS-02) are verified end-to-end in Phase 7; each earlier phase adds cascading FKs and the "integration configured" gate as it goes
- [Roadmap]: Dokploy env config and docs (OPS-01) land in Phase 2 so the HTTPS redirect URI behind Traefik is proven early
- [Roadmap]: All phases run in MVP mode (goals written as user stories)
- [Phase 1]: [01-01] checkGuide requires the scope string to end at a token boundary, so Calendars.ReadWrite never satisfies it
- [Phase 1]: [01-01] validate-docs flags are declared per command so 01-04 adds decisions with one COMMANDS entry
- [Phase 1]: [01-01] Guide spike URI and spike secret lines carry TEMPORAL (RETIRADO after the 01-08 cleanup), enforced by checkGuide
- [Phase 1]: 01-02: loopback listener closes only after the response is flushed; an occupied ::1 port is a hard error so no other process can receive the redirect
- [Phase 1]: 01-02: fetchAllPages refuses a nextLink on another origin (bearer token never follows a link to another host)
- [Phase 1]: 01-02: CLI reports only the position of an unknown argument, never its value, so a mistyped secret is not echoed
- [Phase 1]: 01-02: Prettier check unrun (no node_modules); .mjs files hand-formatted, watch npm-format-check CI on push
- [Phase 1]: 01-03: events without a [M365-TEST <ID>] subject tag are dropped from every committed fixture (pages, series, lookups), enforced in the sanitizer, the sanitize CLI guard and validate-fixtures --leaks
- [Phase 1]: 01-03: next link and request URLs are rewritten onto the graph.microsoft.com origin with SANITIZED-PAGE-<n> tokens, so fixtures replay as Http::sequence pages and a fake host never leaks
- [Phase 1]: 01-03: series master files are { scenario, round, value } and instances files { scenario, round, pages }; the manifest files index is the only source of fixture file lists
- [Phase 1]: 01-04: A line starting with Claim: that breaks the syntax fails; unknown scenarios and paths fail instead of being skipped
- [Phase 1]: [01-05] Tenant-wide access (2026-10-19): enterprise app Assignment required = No (Business Standard has no Entra P1, guests rejected in code, AUTH-02); the B check is now auth --as B (non-admin Alejandro Cava signs in without consent prompt, six scopes) replacing auth --expect-blocked; harness reads Doppler vps/dev SOLIDTIME_* names, never SOLIDTIME_MICROSOFT_CLIENT_SECRET (auth/capture exit 2, status warns); runbook rows Modo de acceso/Dominios replace Grupo asignado/Modo de asignación
- [Phase 1]: 01-05: Production secret expires in 24 months (2028-10-19), deviating from the 180-day guide recommendation; single admin, secret only in Doppler vps/prd; reminder 2028-09-04
- [Phase 1]: 01-05: Access mode tenant (Assignment required = No); Security Defaults MFA is the Conditional Access state; admin consent on behalf of the organisation avoids consent prompts for ordinary users
- [Phase 01]: 01-06: Graph/Outlook web lists the organizer as sole attendee of an event created without invitees (S7, S8); the S8 gate accepts [] or [organizer only] and rejects any other attendee; evidence: personal blocks, organizer appears as sole attendee
- [Phase 01]: 01-06: S8 created Tue 2026-10-27 instead of Wed 2026-10-28 accepted; optional scenarios S7b and E1-E6 not created
- [Phase 1]: 01-07: S2 round B gate takes originalStart from prod-select pages (Graph omits it in the default shape)
- [Phase 1]: 01-07: Outlook reports a declined meeting (response sent) as absent from calendarView with lookup 404, and a cancelled-unprocessed meeting as present with isCancelled=true
- [Phase 1]: 01-08: occurrence key is the immutable Graph id; series key is seriesMasterId
- [Phase 1]: 01-08: SYNC-03 revised by owner - all timed meetings are suggestions regardless of responseStatus; Graph removes declined
- [Phase 1]: 01-08: Entra spike cleanup (redirect URI and secret spike-2026-10) deferred by owner until production, tracked in ROADMAP Phase 7
- [Phase 02]: [02-01] Provisioned Microsoft users join via MemberService::addMember default (non-superadmin) path; MicrosoftAccount is not Auditable; callback logs only fixed reason plus exception class
- [Phase 02]: 02-02: Microsoft Inertia prop shared from a web-group middleware (Octane-safe); callback logs only fixed reason + AADSTS code
- [Phase 02]: 02-03: Microsoft button wraps existing SecondaryButton; navigation via mockable navigateTo (window.location.assign), never Inertia
- [Phase 2]: [02-04] Gateway catches Guzzle 8 ResponseException for AADSTS extraction; all Socialite InvalidStateException map to Interrupted; no previous-exception chaining
- [Phase 02]: 02-05: guard rule order tenant/aud, oid, guest, domain; accountType compared as string '1'; domain exact match after last @
- [Phase 02]: 02-06: provisioning joins via MemberService default path (Role::Employee), identity resolution retries once on unique violation under pg_advisory_xact_lock
- [Phase 02]: 02-07: Microsoft sign-ins are never refused for missing mfa evidence; amr_mfa is logged as evidence for the 02-11 release gate
- [Phase 02]: 02-07: Intended URL after Microsoft sign-in comes only from the server-written url.intended key; remember-me is never set
- [Phase 02]: 02-08: Disconnect keeps the microsoft_accounts row so passwordless users are never locked out; connect intent lives only in session state written by redirect()
- [Phase 02]: 02-09: m365:check and MicrosoftConfig::missingKeys report misconfiguration by variable name only; blank or non-GUID tenant/client id = integration off
- [Phase 2]: 02-10: Microsoft 365 profile section renders only the server payload labels; Connect uses navigateTo (full-page), Disconnect uses router.delete with preserveScroll behind a DialogModal
- [Phase 3]: 03-01: a Graph failure mid-traversal keeps the eligible rows fetched so far but records no sync window and returns the failure status
- [Phase 3]: 03-01: GraphCalendarClient catches GraphException from the token closure and reports it as the failure status; nextLink followed only for https graph.microsoft.com without userinfo or port
- [Phase 03]: 03-05: ghost overlap decided on drawn pixel extent (min 16px), back-to-back share a lane; CAL-01/CAL-02 stay open until 03-06 wires data
- [Phase 3]: 03-02: GET /m365/meetings keeps whereNull(dismissed_at) until 03-09 adds include_dismissed; 03-01 client/eligibility/parser needed no changes; CAL-03 left pending until 03-11/03-12
- [Phase 3]: 03-03: Unconfigured Microsoft integration sends no token request (authority only from GUID tenant); SEC-02 stays pending until 03-07/08 deliver the Reconnect prompt
- [Phase 03]: Reads and syncs use separate throttle counters (m365-read:, m365-sync:); unnamed throttle middleware shares one counter per user
- [Phase 03]: gone_at is set only after a complete traversal without failure; ineligible sightings scrub subject, organizer and link at any time; rows are never deleted
- [Phase 3]: 03-06: a sync answer of reconnect/not_connected switches the composable connectionState and stops syncs; transport, 5xx, 401, 419, 429 only map to unavailable
- [Phase 3]: 03-06: meetings read is a separate non-blocking query; TimeEntryCalendar loading stays bound to time entries only
- [Phase 03]: 03-07: only forced (manual) Sync honours the client cooldown; reconnect/not_connected answers are sticky for the page life; empty-range status counts non-dismissed meetings overlapping the visible range
- [Phase 3]: 03-08: connect return target is a one-value allow-list (calendar) in session microsoft.return, pulled on every callback exit; calendar notice level reduced to success/error server-side
- [Phase 03]: 03-09: dismiss and restore take the meeting id as a plain string and look it up inside the session user's non-gone rows, so foreign, unknown, invalid and gone ids are one 404 (no 403 oracle)
- [Phase 03]: 03-09: safeHttpsUrl lives in a plain TS module; plain tsc (run by the vite build checker) cannot resolve named exports of an SFC, so Gate F must also run npx tsc --noEmit
- [Phase 03]: 03-09: visibleCount still excludes dismissed meetings; 03-10 must revisit it together with the show-dismissed toggle; CAL-04 stays Pending until 03-10

### Roadmap Evolution

- Phase 8 added (2026-11-05): Project Hour Budgets & Profitability — scheduled renewing hour budgets on projects/contracts, time counts against them, profitability per month and contract

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Blocked on the Untangle M365 admin: app registration, admin consent, tenant-wide access (Assignment required = No), client-secret handover, Conditional Access check, and real mailboxes (A and B) with sample meetings
- [Phase 1]: Series identity, cancelled/moved representation and immutable-id stability stay unknown until real fixtures exist; the findings may change the Phase 3-6 schema
- [Phase 2]: SocialiteProviders on Laravel 13 and Socialite under Octane need a smoke test before building on them

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-11-10T10:37:46.131Z
Stopped at: Wave 9 (03-10, 03-11 parallel) merged; combined CI gate pending
Resume file: .planning/phases/03-outlook-meetings-in-the-calendar/03-12-PLAN.md
