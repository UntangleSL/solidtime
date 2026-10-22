# Roadmap: solidtime × Microsoft 365 (Untangle fork)

## Overview

This milestone extends Untangle's fork of solidtime so the team signs in with Microsoft 365 and finds their Outlook meetings already waiting as suggestions in the calendar, ready to become time entries in one click. The work moves from facts to features. First the Untangle M365 admin registers and consents the app, and real Outlook responses are recorded (Phase 1). Then come Microsoft sign-in with secure token storage (Phase 2), the read-only meeting overlay in the calendar (Phase 3), and turning meetings into time entries (Phase 4). Recurring-series rules (Phase 5) and out-of-sync detection (Phase 6) both build on the meeting-to-entry link and can run in parallel. Phase 7 finishes deletion cleanup, impersonation safety, the off switch and an upstream merge rehearsal before the whole team relies on the integration.

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

- [ ] **Phase 1: Tenant Setup & Outlook Spike** - Untangle M365 admin registers and consents the app; real Outlook responses recorded as fixtures; series and cancellation decisions written down
- [ ] **Phase 2: Sign in with Microsoft** - "Sign in with Microsoft" next to password login, safe auto-provision and linking, encrypted tokens, connect/disconnect, env-only config for Dokploy
- [ ] **Phase 3: Outlook Meetings in the Calendar** - Eligible meetings appear as ghost suggestions on calendar open and via Sync, with dismiss, privacy and graceful Graph failures
- [ ] **Phase 4: Assign Meetings to Projects** - Single and bulk conversion of meeting suggestions into real time entries using core rules, with no duplicates
- [ ] **Phase 5: Recurring Meeting Rules** - "This series goes to project X" and "always ignore this series" rules with one-click confirmation and a rules manager
- [ ] **Phase 6: Out-of-Sync Detection** - Logged meetings moved or cancelled in Outlook are flagged, never changed automatically; user chooses keep, adjust or delete
- [ ] **Phase 7: Hardening & Release** - Complete deletion cleanup, impersonation guard, clean off switch, documented fork seams and upstream merge rehearsal

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

**Plans**: 8/8 plans executed

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

**Plans**: 3/11 plans executed

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Backend tracer: redirect -> callback -> provisioned employee on /dashboard, (tid, oid) table, fake gateway in tests (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02-PLAN.md — Failures, off switch and login prop: typed failure messages, tenant/audience guard, 404 when unconfigured, Octane-safe `microsoft` prop, lang/en (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-03-PLAN.md — Login page button: SecondaryButton-based "Sign in with Microsoft", Login.vue seam, Playwright off-switch guard (wave 3)
- [ ] 02-04-PLAN.md — Production adapter: laravel/socialite + socialiteproviders/microsoft, per-call provider, PKCE/state, amr evidence mapping, AADSTS-only errors (wave 3)
- [ ] 02-05-PLAN.md — Rejection gates: other tenants, guests (#EXT#, userType), domain allowlist with mail/UPN source (wave 3)
- [ ] 02-06-PLAN.md — Identity resolution: (tid, oid) matching, safe email linking, provisioning as employee via the default join path, exactly-once under concurrency (wave 3)
- [ ] 02-07-PLAN.md — Sessions and token safety: intended-URL resume, no remember-me, TOTP bypass by design with per-sign-in amr_mfa evidence log, SEC-01 leak matrix (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 02-08-PLAN.md — Profile backend: Disconnect (tokens nulled, identity kept), Connect, token-free profile payload, lang/en + lang/es (wave 4)
- [ ] 02-09-PLAN.md — Ops: fail-safe env config, m365:check, compose/.env.example, Dokploy deployment + bootstrap guide incl. Entra MFA section, touched-core-files ledger (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 02-10-PLAN.md — Profile "Microsoft 365" section UI: status, Connect, confirmed Disconnect, Show.vue seam, Playwright guard (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 02-11-PLAN.md — Release: full CI gate, tenant-MFA release gate, owner-approved Dokploy deploy, D-22 bootstrap, first production Microsoft sign-in recorded in the runbook (wave 6, owner checkpoint)

**Research focus**: SocialiteProviders registration on Laravel 13; Socialite under Octane (no driver state leaking between users); consent at login with admin consent pre-granted
**UI hint**: yes

### Phase 3: Outlook Meetings in the Calendar

**Goal**: As a team member tracking time, I want to see my Outlook meetings as suggestions in the solidtime calendar, so that I can see which meetings still need logging without switching to Outlook.
**Mode:** mvp
**Depends on**: Phase 2 (and the fixtures and decision document from Phase 1)
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, CAL-01, CAL-02, CAL-03, CAL-04, SEC-02
**Success Criteria** (what must be TRUE):
  1. Opening the calendar shows time entries immediately, then the user's Outlook meetings for the visible week or day appear as visually distinct ghost blocks at the correct local times, including across DST changes; a "Sync" button refreshes them, and repeated presses or fast navigation cause no errors or Graph throttling.
  2. Only meetings the user organized (including personal blocks without attendees) or accepted/tentatively accepted appear; declined, cancelled, all-day and private/confidential meetings never appear.
  3. Ghost blocks cannot be dragged or resized, do not get in the way of creating or editing time entries, and are not counted in tracked time, totals, reports or exports; other members and managers never see another user's meetings.
  4. User can dismiss a meeting suggestion so it stops appearing, and can show dismissed suggestions again to undo it.
  5. When Graph is slow, down or throttled, the calendar keeps working and shows a non-blocking status (last synced time, retry later); expired access tokens refresh silently, and when refresh is impossible (revoked, expired, Conditional Access) the user sees a "Reconnect Microsoft" prompt instead of an error.

**Plans**: TBD
**Research focus**: real `calendarView` response shapes vs the Phase 1 fixtures; `Retry-After` behaviour on Outlook 429s; pointer handling in `useSlotSelection.ts` / `useEventDrag.ts` so ghost blocks stay non-interactive
**UI hint**: yes

### Phase 4: Assign Meetings to Projects

**Goal**: As a team member tracking time, I want to turn one or several meeting suggestions into time entries on a project in a single action, so that logging meeting time takes one click instead of re-typing it from Outlook.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ASGN-01, ASGN-02, ASGN-03, ASGN-04, ASGN-05
**Success Criteria** (what must be TRUE):
  1. User selects a meeting suggestion, picks a project (optionally task, tags and billable, with the description prefilled from the meeting subject) and gets a real time entry with the meeting's start and end; the suggestion no longer shows.
  2. User multi-selects several suggestions, assigns them to a project in one action, and sees for each meeting whether it succeeded or failed and why.
  3. Entries created from meetings obey the same permissions, billable rates, rounding, overlap checks and project-total recalculation as entries created manually.
  4. Double clicks or concurrent requests on the same meeting occurrence never create more than one time entry.
  5. Entries created from meetings stay normal time entries the user can edit or delete; deleting one brings the meeting back as a suggestion.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Recurring Meeting Rules

**Goal**: As a team member with recurring meetings, I want to decide once which project a meeting series belongs to or that it should be ignored, so that each new occurrence needs only a one-click confirmation or nothing at all.
**Mode:** mvp
**Depends on**: Phase 4 (can run in parallel with Phase 6)
**Requirements**: RULE-01, RULE-02, RULE-03, RULE-04, RULE-05
**Success Criteria** (what must be TRUE):
  1. From an occurrence of a recurring meeting, user creates a rule "assign this series to project X" (optionally task, tags, billable), and all current unassigned and future occurrences then show pre-assigned to that project without becoming time entries on their own.
  2. User confirms a pre-assigned occurrence with one click, or confirms several at once (for example all visible in the week), and each confirmed occurrence becomes a time entry.
  3. From an occurrence of a recurring meeting, user creates "always ignore this series" and its occurrences stop appearing as suggestions.
  4. User can list, edit and delete their rules; editing or deleting a rule never changes time entries already created, and rules whose series no longer exists in Outlook are shown as orphaned.

**Plans**: TBD
**Research focus**: series identity in practice (series splits, edited occurrences) checked against the Phase 1 decision document
**UI hint**: yes

### Phase 6: Out-of-Sync Detection

**Goal**: As a team member who already logged a meeting, I want to be told when Outlook moves or cancels it and choose what happens to my entry, so that my logged hours are never changed behind my back.
**Mode:** mvp
**Depends on**: Phase 4 (can run in parallel with Phase 5)
**Requirements**: OSYNC-01, OSYNC-02, OSYNC-03
**Success Criteria** (what must be TRUE):
  1. After a converted meeting is moved, cancelled or removed in Outlook and the calendar syncs, its time entry shows an "out of sync" marker describing what changed (old vs new time, or cancelled/removed).
  2. For a flagged entry, user can keep it as is (the flag clears), adjust it to the new Outlook time, or delete it.
  3. No sync ever modifies or deletes a time entry; editing an entry's time in solidtime alone never flags it, and Graph errors or outages never flag it.

**Plans**: TBD
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

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 and 6 (parallel, both depend only on Phase 4) → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Tenant Setup & Outlook Spike | 8/8 | In Progress | - |
| 2. Sign in with Microsoft | 3/11 | In Progress | - |
| 3. Outlook Meetings in the Calendar | 0/TBD | Not started | - |
| 4. Assign Meetings to Projects | 0/TBD | Not started | - |
| 5. Recurring Meeting Rules | 0/TBD | Not started | - |
| 6. Out-of-Sync Detection | 0/TBD | Not started | - |
| 7. Hardening & Release | 0/TBD | Not started | - |
