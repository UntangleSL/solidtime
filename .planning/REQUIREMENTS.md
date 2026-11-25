# Requirements: solidtime × Microsoft 365 (Untangle fork)

**Defined:** 2026-10-19
**Core Value:** A user opens the solidtime calendar and their Outlook meetings are already there, so logging meeting time to the right project takes one click instead of re-typing it from Outlook.

## v1 Requirements

### Setup & Verification (SETUP)

- [x] **SETUP-01**: An Entra ID app registration exists for the Untangle tenant (Web platform, single tenant, tenant-wide access ("assignment required" = No; decision 2026-10-19: no Entra P1, Business Standard licences), redirect URIs for local + Dokploy, delegated scopes `openid profile email offline_access User.Read Calendars.Read`, admin consent granted) and its setup is documented in a runbook including client-secret expiry date
- [x] **SETUP-02**: Real Graph `calendarView` responses from an Untangle mailbox are recorded as test fixtures covering: single meeting, recurring series occurrences + exception, cancelled meeting, declined meeting, moved meeting, private meeting, all-day event, personal block without attendees
- [x] **SETUP-03**: A written decision documents the occurrence key, series key (`seriesMasterId` vs alternatives) and how cancelled/moved meetings appear, based on the fixtures

### Sign-in with Microsoft (AUTH)

- [x] **AUTH-01**: User can click "Sign in with Microsoft" on the login page and authenticate with their Untangle M365 account; email/password login keeps working unchanged
- [x] **AUTH-02**: Sign-in rejects accounts from other tenants, guest (B2B/#EXT#) users, and email domains outside the configured allowlist (default: `untanglegrowth.com` (primary) and `untangle.es`), with a clear error message
- [x] **AUTH-03**: On first Microsoft sign-in with no existing account, a solidtime user is created automatically (email verified, no password) and joined to the configured Untangle organization with the lowest (employee) role
- [x] **AUTH-04**: On first Microsoft sign-in where a verified non-placeholder solidtime user with the same email (case-insensitive) exists, the Microsoft identity is linked to that user instead of creating a duplicate; unverified password accounts are never silently linked
- [x] **AUTH-05**: Subsequent sign-ins match the user by Microsoft identity (`tid` + `oid`), not by email; concurrent first sign-ins never produce duplicate users
- [x] **AUTH-06**: Microsoft sign-in works even when public registration is disabled (`APP_ENABLE_REGISTRATION=off`/invite-only); Entra MFA is the second factor for Microsoft sign-ins
- [x] **AUTH-07**: User can see their Microsoft connection status in their profile and disconnect it; disconnecting deletes stored Microsoft tokens but keeps all time entries already created

### Token Security (SEC)

- [x] **SEC-01**: Microsoft access and refresh tokens are stored encrypted at rest in a dedicated table, never in `users`, the session, cache, logs, audits, API responses or Inertia props
- [x] **SEC-02**: Tokens are refreshed automatically before expiry; if refresh fails (revoked, expired, conditional access), the user sees a "reconnect Microsoft" prompt instead of an error
- [ ] **SEC-03**: Deleting a user (or organization) removes their Microsoft identity, tokens, cached meetings, links and rules
- [ ] **SEC-04**: An admin impersonating a user cannot trigger Graph calls with that user's Microsoft token

### Outlook Sync (SYNC)

- [x] **SYNC-01**: When the user opens the calendar, their Outlook meetings for the visible range are fetched from Microsoft Graph (read-only) without blocking the display of existing time entries
- [x] **SYNC-02**: User can press a "Sync" button to refresh meetings for the visible range; repeated presses/navigation are debounced and do not trigger Graph throttling
- [x] **SYNC-03**: Every timed meeting in the user's calendar is shown as a suggestion regardless of response status (organized, accepted, tentative, not responded); excluded: declined (Graph removes them), cancelled (`isCancelled`), all-day, and meetings marked private/confidential in Outlook. (Revised 2026-10-19: owner wants all meetings, not only accepted.)
- [x] **SYNC-04**: Meeting times are correct in the user's timezone, including across DST changes
- [x] **SYNC-05**: If Graph is unavailable, slow or throttled, the calendar still works and shows a non-blocking status message (last synced time / retry later)

### Meeting Suggestions in Calendar (CAL)

- [x] **CAL-01**: Eligible meetings render in the calendar week/day views as visually distinct "ghost" suggestion blocks that are not counted in tracked time, totals, reports or exports
- [x] **CAL-02**: Ghost blocks cannot be dragged/resized and do not interfere with creating or editing normal time entries in the calendar
- [x] **CAL-03**: Meetings are visible only to their owner (never to other members or managers) until converted to a time entry
- [x] **CAL-04**: User can dismiss a meeting suggestion so it stops appearing, and can show dismissed suggestions again to undo it

### Assign Meetings to Projects (ASGN)

- [x] **ASGN-01**: User can select a meeting suggestion and assign it to a project (from the hover tooltip or detail panel) (optionally task, tags, billable, description prefilled from the meeting subject), which creates a real time entry with the meeting's start/end
- [x] **ASGN-02**: Time entries created from meetings follow the same rules as manual entries (permissions, billable rates, rounding, overlap checks, project totals recalculation)
- [x] **ASGN-03**: A meeting occurrence can only be converted once; after conversion it no longer shows as a suggestion, and double clicks/concurrent requests never create duplicate entries
- [x] **ASGN-04**: User can multi-select several meeting suggestions and assign them all to a project in one action, seeing which succeeded and which failed
- [x] **ASGN-05**: Time entries created from meetings remain normal, fully editable/deletable time entries (deleting one makes the meeting a suggestion again)

### Smart Meeting Suggestions (RULE)

Revised 2026-11-17 (owner): instead of rules the user must create, assignments are learned from the user's own conversions. An AI "propose my week" button is deferred to v2 (PROD-05).

- [x] **RULE-01**: An occurrence of a recurring series in which the user already converted another occurrence shows pre-assigned with that series' last project, task, tags and billable, with no rule setup; the mini form opens prefilled with it
- [x] **RULE-02**: A pre-assigned meeting becomes a time entry only when the user confirms it: one click per meeting, or several at once (e.g. all pre-assigned meetings visible in the day/week)
- [x] **RULE-03**: For meetings without series history, the system suggests a project (and its client) learned from the user's own past conversions, using the organizer, attendee emails/domains and subject words; the mini form opens prefilled with the best suggestion and offers the next alternatives; suggestions never leave the server
- [x] **RULE-04**: From an occurrence of a recurring meeting, user can choose "always ignore this series" so its occurrences stop appearing as suggestions, and can undo it
- [x] **RULE-05**: User can see why a meeting is pre-assigned/suggested, change a series' assignment or make the system forget it; none of this ever changes time entries already created

### Out-of-Sync Detection (OSYNC)

- [x] **OSYNC-01**: For entries created from meetings whose recorded start is in the future or within the last 60 days, Outlook changes are checked on calendar sync and by a daily background job. A meeting that had already started is never flagged and its entry is never changed. If such a meeting was moved, it shows again at its new slot, where the user can create a second entry or move the existing one there.
- [x] **OSYNC-02**: For a meeting that had not started:
  - If it is moved and the entry still has the meeting's original times, the entry follows the new Outlook time automatically.
  - If the user had edited the entry's times, or the meeting was cancelled or removed, the entry is flagged "out of sync" with what changed, and a toolbar counter shows the number of flagged entries.
  - Entries are never deleted automatically. Subject or attendee changes, the user's own edits, and Graph errors never flag or change anything.

  (Revised 2026-11-23, owner.)
- [x] **OSYNC-03**: For a flagged entry, user can choose: keep as is (clears flag), adjust to the new Outlook time, or delete the entry

### Operations (OPS)

- [x] **OPS-01**: The M365 integration is configured entirely via environment variables (tenant, client id/secret, redirect URI, allowed domains list, target organization) and documented for the Dokploy deployment (HTTPS redirect URI behind proxy, trusted proxies)
- [ ] **OPS-02**: The integration is disabled cleanly (no login button, no calendar overlay) when M365 env vars are not set
- [ ] **OPS-03**: Fork code is isolated in its own module with a documented list of touched core files, and an upstream solidtime merge can be performed without conflicts beyond that list

### Calendar UX (UX)

Added by the owner after the Phase 3 UAT (2026-11-10); refined in Phase 3.1 discuss-phase.

- [x] **UX-01**: User can set persistent calendar view options: show/hide weekends and the visible start/end hour
- [x] **UX-02**: Meeting blocks are high-contrast and show more of the subject and time (reference: Clockify)
- [x] **UX-03**: On desktop, hovering a meeting shows its details in a tooltip (click still opens the panel; touch stays click-only)
- [x] **UX-04**: The right-click context menu is never hidden behind a tooltip/panel (it closes them or renders above)
- [x] **UX-05**: Mouse wheel / trackpad scroll and zoom navigate the calendar predictably
- [x] **UX-06**: After a manual Sync the remaining cooldown is visible, and automatic navigation syncs do not keep the Sync button disabled

### Appearance & Branding (BRAND)

Added by the owner 2026-11-10; refined in Phase 3.2 discuss-phase.

- [x] **BRAND-01**: Untangle brand colours are the default theme
- [x] **BRAND-02**: User can switch light/dark theme and choose a highlight (accent) colour, persisted per user
- [x] **BRAND-03**: Organization admin can upload/change the organization icon in workspace settings
- [x] **BRAND-04**: Theme/colour choices keep text and calendar blocks readable (contrast in light and dark)

### Project Hour Budgets (BUDG)

High level, added by the owner 2026-11-05; details to be refined in Phase 8 discuss-phase.

- [ ] **BUDG-01**: A manager can assign an hour budget to a project or contract
- [ ] **BUDG-02**: Budgets can renew on a schedule (e.g. start of month, start of week)
- [ ] **BUDG-03**: Time entries reported by the team count against the active budget period
- [ ] **BUDG-04**: Managers can see budgeted vs consumed hours per month and per contract, as the basis for profitability

## v2 Requirements

### Productivity

- **PROD-01**: "Confirm all pre-assigned this week" from a weekly summary
- **PROD-02**: ~~Last-used project hint for meetings with the same subject~~ (folded into RULE-03, 2026-11-17)
- **PROD-03**: Weekly email/notification of unassigned meetings
- **PROD-04**: Option to skip meetings with `showAs=free`
- **PROD-05**: "Propose my day/week" button where an AI agent (Claude API) reads unassigned meetings plus clients/projects and proposes assignments for review in the multi-assign screen (owner idea 2026-11-17; deferred until the history engine's hit rate is known)

### Sync

- **SYNC2-01**: Background periodic sync or Graph webhooks for near-real-time updates
- **SYNC2-02**: Additional/shared calendars beyond the primary calendar

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-tenant M365 (customers connecting their own tenant) | Only Untangle's tenant needed |
| Writing back to Outlook | Read-only integration |
| Auto-creating time entries without confirmation (meetings or rules) | User wants to confirm each occurrence |
| Auto-modifying/deleting entries when Outlook changes | Never lose or silently change logged hours |
| Showing private Outlook meetings | User decision: hide them entirely to avoid leaking titles |
| Disabling email/password login (SSO-only) | Both methods coexist |
| Google Calendar / CalDAV / ICS | Only Microsoft 365 needed |
| Subject/keyword-based auto-rules | Fragile; series rules cover the need |
| Manager view of other users' unassigned meetings | Privacy |
| Exposing M365 endpoints in public `/api/v1` | Keep fork out of the upstream OpenAPI spec |
| Upstreaming to solidtime-io | Fork-only feature |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETUP-01 | Phase 1 | Complete |
| SETUP-02 | Phase 1 | Complete |
| SETUP-03 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| AUTH-07 | Phase 2 | Complete |
| SEC-01 | Phase 2 | Complete |
| SEC-02 | Phase 3 | Complete |
| SEC-03 | Phase 7 | Pending |
| SEC-04 | Phase 7 | Pending |
| SYNC-01 | Phase 3 | Complete |
| SYNC-02 | Phase 3 | Complete |
| SYNC-03 | Phase 3 | Complete |
| SYNC-04 | Phase 3 | Complete |
| SYNC-05 | Phase 3 | Complete |
| CAL-01 | Phase 3 | Complete |
| CAL-02 | Phase 3 | Complete |
| CAL-03 | Phase 3 | Complete |
| CAL-04 | Phase 3 | Complete |
| ASGN-01 | Phase 4 | Complete |
| ASGN-02 | Phase 4 | Complete |
| ASGN-03 | Phase 4 | Complete |
| ASGN-04 | Phase 4 | Complete |
| ASGN-05 | Phase 4 | Complete |
| RULE-01 | Phase 5 | Complete |
| RULE-02 | Phase 5 | Complete |
| RULE-03 | Phase 5 | Complete |
| RULE-04 | Phase 5 | Complete |
| RULE-05 | Phase 5 | Complete |
| OSYNC-01 | Phase 6 | Complete |
| OSYNC-02 | Phase 6 | Complete |
| OSYNC-03 | Phase 6 | Complete |
| OPS-01 | Phase 2 | Complete |
| OPS-02 | Phase 7 | Pending |
| OPS-03 | Phase 7 | Pending |
| UX-01 | Phase 3.1 | Complete |
| UX-02 | Phase 3.1 | Complete |
| UX-03 | Phase 3.1 | Complete |
| UX-04 | Phase 3.1 | Complete |
| UX-05 | Phase 3.1 | Complete |
| UX-06 | Phase 3.1 | Complete |
| BRAND-01 | Phase 3.2 | Complete |
| BRAND-02 | Phase 3.2 | Complete |
| BRAND-03 | Phase 3.2 | Complete |
| BRAND-04 | Phase 3.2 | Complete |
| BUDG-01 | Phase 8 | Pending |
| BUDG-02 | Phase 8 | Pending |
| BUDG-03 | Phase 8 | Pending |
| BUDG-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-19*
*Last updated: 2026-10-19 after roadmap creation (traceability filled)*
