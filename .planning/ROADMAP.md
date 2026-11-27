# Roadmap: solidtime × Microsoft 365 (Untangle fork)

## Overview

This milestone extends Untangle's fork of solidtime so the team signs in with Microsoft 365 and finds their Outlook meetings already waiting as suggestions in the calendar, ready to become time entries in one click. The work moves from facts to features. First the Untangle M365 admin registers and consents the app, and real Outlook responses are recorded (Phase 1). Then come Microsoft sign-in with secure token storage (Phase 2), the read-only meeting overlay in the calendar (Phase 3), and turning meetings into time entries (Phase 4). Smart suggestions learned from history (Phase 5) and out-of-sync detection (Phase 6) both build on the meeting-to-entry link and can run in parallel. Phase 7 finishes deletion cleanup, impersonation safety, the off switch and an upstream merge rehearsal before the whole team relies on the integration. Phase 8 gives each project its contract terms (hours and money, renewing), so reported time measures profitability per project, client and month, plus team chargeability. Phase 9 adds people assignment and occupancy.

## Cross-Phase Constraints

These apply to every phase (from PROJECT.md and research/SUMMARY.md):

- Fork code lives in `app/Microsoft365/` and `resources/js/m365/`. Core files are touched only through thin seams (named slots, one provider line in `config/app.php`), and each touched core file is added to the touched-files list when it is touched (verified in Phase 7).
- Fork endpoints live under `/m365/...` on the `web` guard, never in the public `/api/v1` or `openapi.json`.
- Every new fork table has cascading foreign keys to its user/organization (verified end-to-end in Phase 7).
- Every new route and UI surface is gated on the integration being configured (verified end-to-end in Phase 7).
- Sync code never writes to time entries. Only explicit user actions create, change or delete entries.
- Graph requests use immutable ids and UTC times on every call (confirmed against real data in Phase 1).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Tenant Setup & Outlook Spike** - Untangle M365 admin registers and consents the app; real Outlook responses recorded as fixtures; series and cancellation decisions written down (completed 2026-11-05)
- [x] **Phase 2: Sign in with Microsoft** - "Sign in with Microsoft" next to password login, safe auto-provision and linking, encrypted tokens, connect/disconnect, env-only config for Dokploy (completed 2026-11-05)
- [x] **Phase 3: Outlook Meetings in the Calendar** - Eligible meetings appear as ghost suggestions on calendar open and via Sync, with dismiss, privacy and graceful Graph failures (completed 2026-11-10)
- [x] **Phase 3.1: Calendar UX Polish** (INSERTED) - View options (weekends, hour range), readable high-contrast meeting blocks, hover tooltip, context-menu layering, wheel zoom/scroll, visible Sync cooldown
- [x] **Phase 3.2: Appearance & Untangle Branding** (INSERTED) - Untangle colours by default, light/dark theme and accent colour per user, organization icon in workspace settings
- [x] **Phase 4: Assign Meetings to Projects** - Single and bulk conversion of meeting suggestions into real time entries using core rules, with no duplicates (completed 2026-11-24, owner UAT)
- [x] **Phase 5: Smart Meeting Suggestions** - Recurring meetings come pre-assigned from series history, other meetings get a project suggested from past conversions (organizer, attendees, subject), one-click or bulk confirm, "always ignore this series" (completed 2026-11-24, owner UAT)
- [x] **Phase 6: Out-of-Sync Detection** - Entries of meetings not yet started follow Outlook moves unless edited; edited or cancelled ones are flagged (keep, adjust or delete); started meetings are never changed (completed 2026-11-25, owner UAT)
- [x] **Phase 7: Hardening & Release** - Complete deletion cleanup, impersonation guard, clean off switch, documented fork seams and upstream merge rehearsal
- [ ] **Phase 8: Project Hour Budgets & Profitability** - Each project carries its contract terms (hours and EUR, renewing); billable time consumes them; profitability by project, client and month with projection to close; team chargeability
- [ ] **Phase 9: People Assignment & Occupancy** - People assigned to projects with planned hours per month, occupancy, holiday calendars and days off; employees see their assignment

## Phase Details

### Phase 1: Tenant Setup & Outlook Spike

**Goal**: As a fork maintainer, I want to have Untangle's Entra app registration consented and real Outlook calendar responses recorded, so that sign-in and meeting sync are built on verified tenant facts instead of assumptions.
**Mode:** mvp
**Depends on**: Nothing (first phase), but blocked on the Untangle M365 admin actions listed below
**Admin actions (Untangle M365 admin, outside Claude's control)**:
- Create the Entra ID app registration: Web platform, single tenant (Untangle), redirect URIs for local development and the Dokploy HTTPS URL
- Add the delegated scopes `openid profile email offline_access User.Read Calendars.Read` and grant tenant-wide admin consent
- Keep "Assignment required" = No (tenant-wide access, decision 2026-10-19: Business Standard has no Entra P1); guests are rejected in code (AUTH-02)
- Create a client secret, record its expiry date, and hand over tenant ID, client ID and secret through a secure channel (never committed to the repo)
- Confirm which Conditional Access policies (MFA, sign-in frequency, device rules) apply to the app, because they affect token refresh
- Provide a test mailbox containing a single meeting, a recurring series with an edited occurrence, a cancelled meeting, a declined meeting, a moved meeting, a private meeting, an all-day event and a personal block without attendees

**Requirements**: SETUP-01, SETUP-02, SETUP-03
**Success Criteria** (what must be TRUE):
  1. A runbook in the repo documents the app registration (tenant ID, client ID, redirect URIs, scopes, tenant-wide access setting, admin consent) and the client-secret expiry date, with a renewal reminder set at least 30 days before expiry.
  2. Two Untangle accounts (the admin and a non-admin member, unassigned) can authorize the app without a per-user consent prompt and receive exactly the configured delegated scopes (tenant-wide access, "assignment required" = No).
  3. Sanitized `calendarView` fixtures recorded from a real Untangle mailbox exist for all eight scenarios: single meeting, recurring occurrences plus an exception, cancelled, declined, moved, private, all-day, and a personal block without attendees.
  4. A decision document backed by those fixtures fixes the occurrence key, the series key (`seriesMasterId` vs alternatives) and exactly how cancelled, declined and moved meetings show up, including with immutable ids and across `@odata.nextLink` continuation requests.

**Plans**: 8/8 plans complete

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Spanish Entra admin guide, runbook skeleton and offline doc gates (wave 1)
- [x] 01-02-PLAN.md — Capture harness: PKCE loopback sign-in, auth checks, paged calendarView passes and experiments, offline fake-Microsoft tests (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-03-PLAN.md — Sanitizer, indexed fixture manifest and fixture gate with Node replay of the paged fixtures (wave 2)
- [x] 01-04-PLAN.md — Decision-document gate: `validate-docs.mjs decisions [--trace]` (wave 2)
- [x] 01-05-PLAN.md — Admin registers the app; assigned/outsider sign-in verification; production-secret Valor check; final runbook values (wave 2, admin checkpoint)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-06-PLAN.md — Ronda A scenarios captured, sanitized and committed (wave 3, admin checkpoint)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-07-PLAN.md — Ronda B mutations captured; full fixture set; PHPUnit replay test (wave 4, admin checkpoint)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-08-PLAN.md — Fixture-backed decision document; replay-gated spike cleanup; full phase gate (wave 5, admin checkpoint)

### Phase 2: Sign in with Microsoft

**Goal**: As a member of the Untangle team, I want to sign in to solidtime with my Microsoft 365 account, so that I get in with my work identity and Entra MFA while email/password login keeps working for everyone else.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, SEC-01, OPS-01
**Success Criteria** (what must be TRUE):
  1. On the login page, both locally and on the Dokploy HTTPS URL, a user clicks "Sign in with Microsoft", authenticates with their Untangle account and lands in solidtime, even with public registration disabled; email/password login, password reset and TOTP 2FA work exactly as before.
  2. A first-time Microsoft user without an account gets a verified, passwordless solidtime user joined to the Untangle organization with the employee role; a user with an existing verified account under the same email (any letter case) is linked to it instead of duplicated, and an unverified password account is never silently linked.
  3. Accounts from another tenant, guest (#EXT#) users and emails outside the allowed domain are rejected with a clear message; returning users are recognized by their Microsoft identity (`tid` + `oid`) rather than by email, and two simultaneous first sign-ins produce exactly one user.
  4. User sees their Microsoft connection status in their profile and can disconnect it; disconnecting deletes the stored Microsoft tokens and leaves all time entries untouched.
  5. Microsoft tokens exist only encrypted in the dedicated table and never appear in the `users` table, session, cache, logs, audits, API responses or Inertia props; the integration is configured purely through documented env vars, including the Dokploy setup for the HTTPS redirect URI and trusted proxies.

**Plans**: 11/11 plans complete

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Backend tracer: redirect -> callback -> provisioned employee on /dashboard, (tid, oid) table, fake gateway in tests (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02-PLAN.md — Failures, off switch and login prop: typed failure messages, tenant/audience guard, 404 when unconfigured, Octane-safe `microsoft` prop, lang/en (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-03-PLAN.md — Login page button: SecondaryButton-based "Sign in with Microsoft", Login.vue seam, Playwright off-switch guard (wave 3)
- [x] 02-04-PLAN.md — Production adapter: laravel/socialite + socialiteproviders/microsoft, per-call provider, PKCE/state, amr evidence mapping, AADSTS-only errors (wave 3)
- [x] 02-05-PLAN.md — Rejection gates: other tenants, guests (#EXT#, userType), domain allowlist with mail/UPN source (wave 3)
- [x] 02-06-PLAN.md — Identity resolution: (tid, oid) matching, safe email linking, provisioning as employee via the default join path, exactly-once under concurrency (wave 3)
- [x] 02-07-PLAN.md — Sessions and token safety: intended-URL resume, no remember-me, TOTP bypass by design with per-sign-in amr_mfa evidence log, SEC-01 leak matrix (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 02-08-PLAN.md — Profile backend: Disconnect (tokens nulled, identity kept), Connect, token-free profile payload, lang/en + lang/es (wave 4)
- [x] 02-09-PLAN.md — Ops: fail-safe env config, m365:check, compose/.env.example, Dokploy deployment + bootstrap guide incl. Entra MFA section, touched-core-files ledger (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 02-10-PLAN.md — Profile "Microsoft 365" section UI: status, Connect, confirmed Disconnect, Show.vue seam, Playwright guard (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 02-11-PLAN.md — Release: full CI gate, tenant-MFA release gate, owner-approved Dokploy deploy, D-22 bootstrap, first production Microsoft sign-in recorded in the runbook (wave 6, owner checkpoint)

**Research focus**: SocialiteProviders registration on Laravel 13; Socialite under Octane (no driver state leaking between users); consent at login with admin consent pre-granted
**UI hint**: yes

### Phase 3: Outlook Meetings in the Calendar

**Goal**: As a team member tracking time, I want to see my Outlook meetings as suggestions in the solidtime calendar, so that I can see which meetings still need logging without switching to Outlook.
**Mode:** mvp
**Depends on**: Phase 2 (and the fixtures and decision document from Phase 1)
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, CAL-01, CAL-02, CAL-03, CAL-04, SEC-02
**Success Criteria** (what must be TRUE):
  1. Opening the calendar shows time entries immediately, then the user's Outlook meetings for the visible week or day appear as visually distinct ghost blocks at the correct local times, including across DST changes; a "Sync" button refreshes them, and repeated presses or fast navigation cause no errors or Graph throttling.
  2. Every timed meeting in the user's calendar appears regardless of response status (organized, including personal blocks without attendees, accepted, tentative or not responded); declined (Graph removes them), cancelled, all-day and private/confidential meetings never appear.
  3. Ghost blocks cannot be dragged or resized, do not get in the way of creating or editing time entries, and are not counted in tracked time, totals, reports or exports; other members and managers never see another user's meetings.
  4. User can dismiss a meeting suggestion so it stops appearing, and can show dismissed suggestions again to undo it.
  5. When Graph is slow, down or throttled, the calendar keeps working and shows a non-blocking status (last synced time, retry later); expired access tokens refresh silently, and when refresh is impossible (revoked, expired, Conditional Access) the user sees a "Reconnect Microsoft" prompt instead of an error.

**Plans**: 12/12 plans complete

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Backend tracer, Graph-to-cache: calendarView (literal URL, Prefer on every page, nextLink host check) -> fail-closed eligibility -> outlook_meetings in UTC; token seam; sync windows (wave 1)
- [x] 03-05-PLAN.md — Ghost layer: overlay slot, reserved right-hand Outlook lane (D-23, keeps D-01 reachable), pointer guard, DST layout and lanes, totals unchanged (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-02-PLAN.md — Read and sync endpoints (cache-only GET /m365/meetings, POST sync), owner scoping, validation, off switch; eligibility and Graph-client contract tests (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-03-PLAN.md — Silent token refresh under row lock; reconnect vs unavailable classification; Graph 401/403 retry; reconnect_required_at / graph_backoff_until columns (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03-04-PLAN.md — Sync resilience: Retry-After back-off, reuse window, forced minimum interval, per-user lock, outages and no-mailbox statuses, reconcile only complete traversals, scrub ineligible rows (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 03-06-PLAN.md — Calendar data wiring: calendar shared prop and full copy, debounced single-flight composable, Calendar.vue slot + lane wiring, test hook, Playwright proof (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 03-07-PLAN.md — Toolbar Sync control: Sync Outlook with cooldown and back-off, quiet status line, responsive collapse (wave 6)

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 03-08-PLAN.md — Connect / Reconnect in the calendar returning through an allow-listed return target, notice on the calendar (wave 7)

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 03-09-PLAN.md — Ghost detail panel (extendable) and per-occurrence Dismiss; dismiss/restore/include_dismissed backend (wave 8)

**Wave 9** *(blocked on Wave 8 completion)*
- [x] 03-10-PLAN.md — "Show dismissed meetings" in calendar settings (ledgered slot chain), dismissed variant, Restore (wave 9)
- [x] 03-11-PLAN.md — Privacy: impersonation guard at the Graph choke point (D-22), disconnect purge (D-21), owner-only role matrix, reports unchanged by sync, leak matrix (wave 9)

**Wave 10** *(blocked on Wave 9 completion)*
- [x] 03-12-PLAN.md — Release: all ten workflows green, operator docs, ledger check, sha-pinned compose, owner-approved Dokploy deploy, production UAT (wave 10, owner checkpoint)

**Research focus**: real `calendarView` response shapes vs the Phase 1 fixtures; `Retry-After` behaviour on Outlook 429s; pointer handling in `useSlotSelection.ts` / `useEventDrag.ts` so ghost blocks stay non-interactive
**UI hint**: yes

### Phase 03.1: Calendar UX Polish (INSERTED)

**Goal**: As a team member, I want a calendar that is easier to read and move around (view options, readable meeting blocks, hover details, smooth zoom and scroll), so that working with time entries and Outlook meetings feels as fluid as in Clockify.
**Depends on**: Phase 3
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06
**Success Criteria** (what must be TRUE):
  1. A user can choose calendar view options that persist: show or hide weekends, and the visible start and end hour of the day.
  2. Meeting blocks have enough contrast and show more of the subject and time, so a week can be read at a glance (reference: Clockify calendar).
  3. On desktop, hovering a meeting shows its details in a tooltip; click still opens the panel, and touch keeps click-only.
  4. The right-click context menu never ends up hidden behind an open tooltip or panel: opening it closes them or it renders above them.
  5. The mouse wheel / trackpad navigates the calendar predictably (scroll through hours, and a zoom gesture to change the hour height).
  6. After pressing Sync Outlook the user can see when it can be pressed again (visible short cooldown), and automatic syncs from week navigation do not keep the manual button disabled.

**Plans**: 3/8 plans executed

Plans:
**Wave 1**
- [x] 03.1-01-PLAN.md — Show weekends option (package-local Switch), sanitised calendar settings, full-week range, hidden-weekend deep link, browser proof (wave 1)
- [x] 03.1-02-PLAN.md — Visible Sync cooldown (manual and back-off only, ring, "Sync in 8s", tooltip) and the phase's fork copy en/es (wave 1)
- [x] 03.1-03-PLAN.md — Solid, readable meeting blocks in a half-width Outlook lane (wash, divider, tiers, measured columns, cascade) with sky-blue and six-overlap browser fixtures (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03.1-04-PLAN.md — Meeting context menu through a core overlay slot, contextMenuOpen/interacting slot props, "My time | Outlook" header captions (wave 2)
- [x] 03.1-05-PLAN.md — Hover card on a shared meeting summary, suppress/close rules, close-before-context-menu (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03.1-06-PLAN.md — Wheel and pinch zoom on the Grid Scale ladder with anchoring, corner buttons, zoom pill, no refetch on zoom (wave 3)
- [x] 03.1-07-PLAN.md — Browser proof of hover card, touch and context-menu layering; Playwright gate (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03.1-08-PLAN.md — Release: ten workflows green, ledger reconciliation, sha-pinned compose, owner-approved Dokploy deploy, public checks, owner UAT (wave 4, owner checkpoint)

**UI hint**: yes

### Phase 03.2: Appearance & Untangle Branding (INSERTED)

**Goal**: As Untangle, I want solidtime to look like our own tool by default and let each user tune it, so that the app feels branded and comfortable to use.
**Depends on**: Phase 3 (independent of Phase 3.1; can run in parallel)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04
**Success Criteria** (what must be TRUE):
  1. Untangle brand colours are the default theme for everyone.
  2. A user can switch between light and dark theme and pick a highlight (accent) colour, and the choice persists.
  3. An organization admin can upload or change the organization icon in the workspace settings, and it shows wherever the organization is displayed.
  4. Theme and colour changes keep text and calendar blocks readable (contrast checked in light and dark).

**Plans**: 3/9 plans executed

Plans:
**Wave 1**
- [x] 03.2-01-PLAN.md — Untangle token stylesheet, six accent presets per mode, contrast gate (no Syne, D-10) over every theme x accent (wave 1)
- [x] 03.2-02-PLAN.md — Fork module app/Appearance: user_appearance_settings, PUT /user/appearance, appearance prop, en/es copy, TS prop contract (wave 1)
- [x] 03.2-03-PLAN.md — Contrast fixes (timer button, pale accent link/check/progress), e2e timer assertions; wave-1 CI gate (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03.2-04-PLAN.md — Pre-paint Blade partial (server > localStorage > default) in app and OAuth layouts, theme-color metas (wave 2)
- [x] 03.2-05-PLAN.md — Organization icon backend: organization_icons, POST/DELETE icon routes (organizations:update), validation, org_icons prop, deletion cleanup (wave 2)
- [x] 03.2-06-PLAN.md — Accent state and server sync, accent picker in Theme, helper copy, command-palette accents, preset parity (wave 2)
- [x] 03.2-07-PLAN.md — Organization icon UI: renderer with letter fallback, switcher trigger and rows, icon field in Organization Settings; wave-2 CI gate (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03.2-08-PLAN.md — Browser proof (pre-paint with bundles blocked, chart recolour, picker, icon flow) and the Phase 3.2 ledger section (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03.2-09-PLAN.md — Release: ten workflows green, operator doc, sha-pinned compose, owner-approved Dokploy deploy, public checks, owner UAT (wave 4, owner checkpoint)

**UI hint**: yes

### Phase 4: Assign Meetings to Projects

**Goal**: As a team member tracking time, I want to turn one or several meeting suggestions into time entries on a project in a single action, so that logging meeting time takes one click instead of re-typing it from Outlook.
**Mode:** mvp
**Depends on**: Phase 3, Phase 3.1 (the hover tooltip and panel host the action)
**Requirements**: ASGN-01, ASGN-02, ASGN-03, ASGN-04, ASGN-05
**Success Criteria** (what must be TRUE):
  1. User selects a meeting suggestion, picks a project (optionally task, tags and billable, with the description prefilled from the meeting subject) and gets a real time entry with the meeting's start and end; the suggestion no longer shows.
  2. User multi-selects several suggestions, assigns them to a project in one action, and sees for each meeting whether it succeeded or failed and why.
  3. Entries created from meetings obey the same permissions, billable rates, rounding, overlap checks and project-total recalculation as entries created manually.
  4. Double clicks or concurrent requests on the same meeting occurrence never create more than one time entry.
  5. Entries created from meetings stay normal time entries the user can edit or delete; deleting one brings the meeting back as a suggestion.
  6. The "create time entry" / assign action is available directly from the meeting hover tooltip and detail panel (owner request after the Phase 3 UAT, 2026-11-10).

**Plans**: 9 plans

Plans:
**Wave 1**
- [ ] 04-01-PLAN.md — Server conversion through the core create action: outlook_meeting_links, convert endpoint with per-meeting results, core-rule matrix, converted meetings hidden, urls.convert, en/es copy (wave 1, CI anchor)
- [ ] 04-03-PLAN.md — Create a time entry from the meeting panel: mini form (prefill, last project, editable times, validation), conversion API, context convert / openForm / selection (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 04-02-PLAN.md — Idempotent repeats and races, stale links, batch results, every delete path re-surfaces the meeting, links survive re-sync and disconnect, linked entry ids, impersonation (wave 2, CI anchor)
- [ ] 04-04-PLAN.md — "Create time entry" from the context menu and hover card; Ctrl/Cmd/Shift and keyboard multi-select with the selected look (wave 2)
- [ ] 04-05-PLAN.md — Selection bar, batch form, per-meeting results with retry (Calendar.vue mount) (wave 2)
- [ ] 04-06-PLAN.md — Meeting comes back after its entry is deleted (debounced refresh), linked ids in the client, test hook with actions (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 04-07-PLAN.md — Outlook icon on entries created from meetings through a ledgered core slot chain; Phase 4 ledger section (wave 3)
- [ ] 04-08-PLAN.md — Browser proof of the whole conversion UI incl. partial failure, retry and layout backstops; Playwright gate (wave 3, CI anchor)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 04-09-PLAN.md — Release: ten workflows green, ledger reconciliation, sha-pinned compose, owner-approved Dokploy deploy with the outlook_meeting_links migration, public checks, owner UAT (wave 4, owner checkpoint)

**UI hint**: yes

### Phase 5: Smart Meeting Suggestions

**Goal**: As a team member, I want recurring meetings to come already assigned to the project I used last time, and other meetings to come with a good project suggestion learned from my history, so that logging meeting time is mostly confirming instead of choosing.
**Mode:** mvp
**Depends on**: Phase 4 (can run in parallel with Phase 6)
**Requirements**: RULE-01, RULE-02, RULE-03, RULE-04, RULE-05 (revised 2026-11-17: learned suggestions instead of manual rules)
**Success Criteria** (what must be TRUE):
  1. After the user converts one occurrence of a recurring series, its other unassigned occurrences (past in view and future) show pre-assigned to that project, task, tags and billable, and the mini form opens prefilled with them, without any rule setup and without becoming time entries on their own.
  2. User confirms a pre-assigned meeting with one click, or all pre-assigned meetings visible in the day/week at once, and each confirmed meeting becomes a time entry through the Phase 4 path.
  3. For a meeting without series history, the mini form opens with a project (and client) suggested from the user's own past conversions using organizer, attendees (emails/domains) and subject words, plus the next alternatives; nothing is sent outside the server.
  4. User can mark a series "always ignore" (and undo it), see why a meeting is pre-assigned or suggested, change a series' assignment or make the system forget it; none of this changes existing time entries.
  5. Attendee data needed for suggestions is stored only for the meeting owner and purged with the other meeting data on disconnect/user deletion.

**Plans**: 15 plans

Plans:
**Wave 1**
- [ ] 05-01-PLAN.md — Series pre-assignment on the server: series key captured on links (+ backfill, signals/prefill columns), resolver from the latest link's live entry with core booking rules, final read shape (series_key, series_ignored, assignment, suggestions) (wave 1, CI anchor)
- [ ] 05-02-PLAN.md — Pure learned engine: ES/EN subject tokenizer, keyed-hash meeting signals, explainable scorer with confidence and reasons (local unit tests) (wave 1)
- [ ] 05-03-PLAN.md — Attendees in the meeting cache: Graph $select + attendees, minimal owner-only storage, scrub/Disconnect purge, never served, DECISIONS-graph update (wave 1)
- [ ] 05-04-PLAN.md — Client foundation: 46 en/es keys (130 labels), types, prefill/quick-pick/series-note helpers, reason labels, confirm and series API calls, project dot (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 05-05-PLAN.md — Confirm mode on the convert endpoint (use_series_assignment, no_assignment), hashed signals and D-16 prefill measurement on every link (wave 2, CI anchor)
- [ ] 05-06-PLAN.md — Always ignore / stop ignoring / forget a series: outlook_series_settings, three routes, read filter, forget filter, privacy invariants (wave 2)
- [ ] 05-07-PLAN.md — Composable confirm (one and bulk) and optimistic series actions; pre-assignment block; hover card Edit + Confirm (wave 2)
- [ ] 05-08-PLAN.md — Mini form prefilled from the series or a confident suggestion, reason line, quick picks, series notes, batch prefill (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 05-09-PLAN.md — Learned suggestions in the read from the user's own history; scoping, privacy, cost; forget/ignore interplay end to end (wave 3, CI anchor)
- [ ] 05-10-PLAN.md — Lane and panel: pre-assigned block, panel Confirm/Edit with why line, More actions series controls, ignored-series variant, dot contrast (wave 3)
- [ ] 05-11-PLAN.md — "Confirm N pre-assigned" toolbar button and bulk-confirm popover over the rendered view (wave 3)
- [ ] 05-12-PLAN.md — Context menu: Confirm, Edit, ignore / stop ignoring, forget (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 05-13-PLAN.md — Browser proof of confirm, bulk confirm, prefilled form, ignore + undo and forget; Playwright gate (wave 4, CI anchor)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 05-14-PLAN.md — Release candidate: ledger reconciled, release sha green in ten workflows, commits listed, compose pinned; then the orchestrator deploys without owner approval (D-15) (wave 5)

**Wave 6** *(blocked on the orchestrator's deploy)*
- [ ] 05-15-PLAN.md — Public checks on production, runbook history row, owner UAT queued (wave 6)

**Research focus**: series identity in practice (series splits, edited occurrences) against docs/m365/DECISIONS-graph.md; adding attendees to the Graph $select within Calendars.Read; a simple, explainable ranking (no ML library) over the user's own links
**UI hint**: yes

### Phase 6: Out-of-Sync Detection

**Goal**: As a team member who already logged a meeting, I want to be told when Outlook moves or cancels it and choose what happens to my entry, so that my logged hours are never changed behind my back.
**Mode:** mvp
**Depends on**: Phase 4 (can run in parallel with Phase 5)
**Requirements**: OSYNC-01, OSYNC-02, OSYNC-03
**Success Criteria** (what must be TRUE):
  1. An entry of a meeting that had already started is never changed or flagged by any Outlook change. If that meeting was moved, it shows again at its new slot with "Create time entry" or "Move my entry here".
  2. When a meeting that has not started yet is moved, its unedited entry follows the new time automatically.
  3. An entry the user edited, or one whose meeting was cancelled or removed, is flagged with what changed and offers Keep / Adjust / Delete.
  4. The calendar toolbar shows "N out of sync", counting only future entries and those from the last 60 days. A daily job keeps it current for weeks the user has not opened.
  5. Nothing is ever deleted automatically. Subject or attendee changes, the user's own edits, and Graph errors or outages never flag or change an entry.

**Plans**: 19 plans

Plans:
**Wave 1**
- [ ] 06-01-PLAN.md — Link state schema (active-only unique index, snapshot backfill), value types, pure rules matrix D-01..D-07/D-10/D-16..D-18, scope query and sighting extraction (local unit tests) (wave 1, CI anchor)
- [ ] 06-02-PLAN.md — Graph lookup of one occurrence (GET /me/events/{id}) with the removed / cancelled / moved mapping and Phase 3 failure rules; out_of_sync config block (local unit tests) (wave 1)
- [ ] 06-03-PLAN.md — Client foundation 1: 47 en/es keys (177 labels), types, defensive parsing, reason / range / counter text helpers (wave 1)
- [ ] 06-04-PLAN.md — Client foundation 2: keep / adjust / move calls with the error mapping, aria-describedby helper, amber contrast rows (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 06-05-PLAN.md — Tracer: a not-started moved meeting moves its unedited entry through core on the next sync (applier, core updater, sync hook); migration proofs; docs aligned with D-12 (wave 2, CI anchor)
- [ ] 06-06-PLAN.md — Read: out_of_sync items of the whole window, auto_adjusted, only active links hide a meeting, moved_from for D-03, empty under impersonation / disconnect (wave 2)
- [ ] 06-07-PLAN.md — Composable: flags, review request, keep / adjust / delete / move with feedback, jump to first, auto-adjust announcement, test-hook options (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 06-08-PLAN.md — Core update path and applier safety: updater contract, job-context auth reset, blocked org, stale observations, refusal -> flag, release moves the cached meeting (wave 3, CI anchor)
- [ ] 06-09-PLAN.md — Interactive sync: absent linked meetings confirmed by lookups (removed), full sync matrix, throttled lookups, auto_adjusted in the sync answer (wave 3)
- [ ] 06-10-PLAN.md — Keep / Adjust / Move my entry here endpoints, second conversion of a released occurrence, route count 11, calendar URLs (wave 3)
- [ ] 06-11-PLAN.md — Out-of-sync marker, auto-adjust note on the origin icon, "Review Outlook change" and "Move my entry here" menu items (wave 3)
- [ ] 06-12-PLAN.md — Review popover: Keep / Adjust / two-step Delete with loading, failure, stale and focus rules (wave 3)
- [ ] 06-13-PLAN.md — D-03 meeting UI: moved block in the panel, hover note, block label and pending state (wave 3)
- [ ] 06-14-PLAN.md — Toolbar counter "N out of sync" with jump to the first flagged entry (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 06-15-PLAN.md — Daily check: m365:check-out-of-sync at 05:30 Europe/Madrid from the fork provider, per-user queued job (≤ 300 lookups, throttle stop), Microsoft variables on queue and scheduler (D-20) (wave 4, CI anchor)
- [ ] 06-16-PLAN.md — Calendar wiring: entry-menu slot and goToDate core seams, Calendar.vue fills, Phase 6 ledger section (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 06-17-PLAN.md — Browser proof of review, adjust, keep, confirmed delete, counter jump, entry menu, move my entry here and a second entry; Playwright gate (wave 5, CI anchor)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 06-18-PLAN.md — Release candidate: ledger reconciled, release sha green in ten workflows, commits listed, compose pinned; then the orchestrator deploys without owner approval (D-15) (wave 6)

**Wave 7** *(blocked on the orchestrator's deploy)*
- [ ] 06-19-PLAN.md — Public checks on production, runbook history row, STATE updated, owner UAT queued (wave 7)

**Research focus**: how cancelled, declined and removed meetings appear in `calendarView` vs direct event lookups, per the Phase 1 decision document
**UI hint**: yes

### Phase 7: Hardening & Release

**Goal**: As a fork maintainer, I want to ship the integration with complete data cleanup, impersonation safety, a clean off switch and a rehearsed upstream merge, so that the whole Untangle team can rely on it and the fork keeps taking solidtime updates.
**Mode:** mvp
**Depends on**: Phase 5, Phase 6
**Requirements**: SEC-03, SEC-04, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. Deleting a user or an organization leaves none of their Microsoft identity, tokens, cached meetings, meeting links or rules behind.
  2. An admin impersonating a user cannot see that user's meetings or trigger any Graph call with that user's Microsoft token.
  3. With the M365 env vars unset, solidtime shows no Microsoft sign-in button, no meeting suggestions, no Sync button and no rules management, and every core feature works as it does upstream.
  4. Fork code sits in its own module with a documented list of touched core files, and a rehearsed merge of current upstream solidtime conflicts only within that list.
  5. Entra spike cleanup (remove http://localhost/m365-spike/callback and secret spike-2026-10) once production sign-in works; then mark the guide lines RETIRADO and update the runbook (deferred from Phase 1 by the owner, 2026-10-19).

**Plans**: 7 plans

Plans:
**Wave 1**
- [x] 07-01-PLAN.md — Real upstream merge of solidtime main d0f5e745 (conflicts only in the ledger), ledger in the merged state, ledger-check.sh and docs/m365/UPSTREAM-MERGE.md (OPS-03; D-01, D-03, D-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 07-02-PLAN.md — Impersonation: Disconnect, Connect, callback and profile card inert; route matrix with canary; fork isolation canaries (SEC-04; D-07, D-08)
- [x] 07-03-PLAN.md — Deletion cleanup proof on every core path, schema cascade guard, no residue when a disconnect races a sync (SEC-03)
- [x] 07-04-PLAN.md — Off switch proof: calendar e2e with nothing Outlook-related, every fork route 404, job filtered, data kept and restored (OPS-02)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 07-05-PLAN.md — Release prep: ledger reconciled, operator doc, scheduler/queue healthchecks, Spanish owner summary (D-02)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 07-06-PLAN.md — Release: pin the green image, owner summary, database backup, Dokploy deploy, health and public checks (D-01, D-02, D-03; checkpoint)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 07-07-PLAN.md — Entra spike cleanup by the owner, sign-in and Sync rechecked, guide RETIRADO and runbook updated (criterion 5; D-05, D-06; owner checkpoint)

### Phase 8: Project Hour Budgets & Profitability

**Goal**: As Untangle management, I want each client project to carry its contract terms (hours and money sold, renewing on a schedule), the team's billable time to consume them, and a view of profitability and team chargeability, so that we see per month, per project, per client and per person whether we are on track to the contract close.
**Depends on**: Phase 7 (independent of the Microsoft 365 work)
**Requirements**: BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07, CHRG-01, CHRG-02, CHRG-03
**Success Criteria** (what must be TRUE):
  1. An account manager sets a project's contract terms (service, amount and hours per period, one-off or renewing monthly, quarterly or annually); a renewing project starts each new period automatically and clean, until an end date or archive.
  2. A project manager distributes a period's hours across its months (uneven allowed) and sees planned vs consumed per month and the projection to the period close.
  3. Time entries on a project count against the period they fall into with no extra step, and entries on a billable project are always billable.
  4. Account managers see money sold, cost (dated hourly cost per person), margin and hours for their clients; Owner/Admin see everything; employees see nothing new; no new core roles.
  5. Each person's chargeability (billable / available hours from a dated working week, minus Vacaciones and Festivo time) is shown against their target on the "Rentabilidad" page, which also has project and client views and a summary on each project page.

**Plans**: 20 plans

Plans:
**Wave 1**
- [ ] 08-01-PLAN.md — Server tracer: fork module, contract tables, access resolver, live consumption, project summary endpoint (BUDG-03, CHRG-03)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 08-02-PLAN.md — Scope-gated shared prop, module config and the complete en/es copy (CHRG-03; D-17)
- [ ] 08-03-PLAN.md — Project and account manager assignments drive access; Owner/Admin assignment endpoints (BUDG-07, BUDG-06; D-10, D-16)
- [ ] 08-04-PLAN.md — Contract terms endpoint, period calendar with stub, lazy idempotent materializer, even monthly plan (BUDG-01, BUDG-02, BUDG-04; D-01..D-04, D-15)
- [ ] 08-05-PLAN.md — Dated hourly costs, dated working week and target, explicit absence projects (BUDG-05, CHRG-01, CHRG-02; D-06, D-08, D-13)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 08-06-PLAN.md — Contract card on the project page, formatters, status pill and budget meter (CHRG-03, BUDG-03)
- [ ] 08-07-PLAN.md — Time on billable projects always billable, legacy entries reported never rewritten, two upstream e2e tests assert D-05 (BUDG-03)
- [ ] 08-08-PLAN.md — Period list and selection, edits of started contracts without touching closed periods, materializer lifecycle (BUDG-01, BUDG-02, BUDG-04; D-03, D-04, D-18)
- [ ] 08-11-PLAN.md — People view endpoint: chargeability vs target, report ranges, available hours (CHRG-02, CHRG-03; D-06, D-13)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 08-09-PLAN.md — Monthly plan editing by project managers, daily renewal safety net, archive pauses / un-archive resumes (BUDG-04, BUDG-02; D-02, D-18)
- [ ] 08-10-PLAN.md — Dated cost and margin by scope, projection to close with status, Projects view endpoint (BUDG-03..BUDG-06; D-07, D-08, D-19)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 08-12-PLAN.md — Profitability page with view discovery, sidebar item, Projects view, range toolbar (CHRG-03, BUDG-04, BUDG-06)
- [ ] 08-13-PLAN.md — Full Contract card: period select, projection, meter, planned-vs-consumed chart, month table, money strip, period states (BUDG-04, CHRG-03, BUDG-06)
- [ ] 08-14-PLAN.md — Clients view endpoint (account manager portfolio) (BUDG-06; D-19)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 08-15-PLAN.md — Settings tab: people costs and working weeks, managers, absence projects (BUDG-05, BUDG-07, CHRG-01)
- [ ] 08-16-PLAN.md — Contract terms editor and monthly plan editor from the card and the Projects view (BUDG-01, BUDG-04)
- [ ] 08-17-PLAN.md — Clients tab with the margin by client chart (CHRG-03, BUDG-06)
- [ ] 08-18-PLAN.md — People tab with the chargeability vs target chart (CHRG-02, CHRG-03)

**Wave 7** *(blocked on Wave 6 completion)*
- [ ] 08-19-PLAN.md — Authorization matrix with route canary, browser proofs, isolation canaries, Phase 8 ledger with ledger-check OK

**Wave 8** *(blocked on Wave 7 completion)*
- [ ] 08-20-PLAN.md — Release: pin the green image, Dokploy deploy, public checks, Spanish owner message and end-of-phase checks (checkpoint)

### Phase 9: People Assignment & Occupancy

**Goal**: As Untangle management, I want to assign people to projects with planned hours per month and see each person's occupancy, using each employee's holiday calendar and days off, so that we plan capacity; each employee sees their own assignment and available hours per project.
**Depends on**: Phase 8
**Requirements**: TBD (to be defined in discuss-phase)
**Success Criteria**: TBD

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 3.1 and 3.2 (parallel, both depend only on Phase 3) → 4 → 5 and 6 (parallel, both depend only on Phase 4) → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Tenant Setup & Outlook Spike | 8/8 | Complete    | 2026-11-05 |
| 2. Sign in with Microsoft | 11/11 | Complete    | 2026-11-05 |
| 3. Outlook Meetings in the Calendar | 12/12 | Complete    | 2026-11-10 |
| 3.1 Calendar UX Polish | 8/8 | Complete | 2026-11-17 |
| 3.2 Appearance & Untangle Branding | 9/9 | Complete | 2026-11-17 |
| 4. Assign Meetings to Projects | 9/9 | Complete | 2026-11-25 |
| 5. Smart Meeting Suggestions | done | Complete | 2026-11-25 |
| 6. Out-of-Sync Detection | done | Complete | 2026-11-25 |
| 7. Hardening & Release | 7/7 | Complete (owner UAT pending) | 2026-11-27 |
| 8. Project Hour Budgets & Profitability | 0/TBD | Context gathered | - |
| 9. People Assignment & Occupancy | 0/TBD | Not started | - |
