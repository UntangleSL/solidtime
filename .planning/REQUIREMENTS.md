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
- [ ] **SEC-02**: Tokens are refreshed automatically before expiry; if refresh fails (revoked, expired, conditional access), the user sees a "reconnect Microsoft" prompt instead of an error
- [ ] **SEC-03**: Deleting a user (or organization) removes their Microsoft identity, tokens, cached meetings, links and rules
- [ ] **SEC-04**: An admin impersonating a user cannot trigger Graph calls with that user's Microsoft token

### Outlook Sync (SYNC)

- [ ] **SYNC-01**: When the user opens the calendar, their Outlook meetings for the visible range are fetched from Microsoft Graph (read-only) without blocking the display of existing time entries
- [ ] **SYNC-02**: User can press a "Sync" button to refresh meetings for the visible range; repeated presses/navigation are debounced and do not trigger Graph throttling
- [ ] **SYNC-03**: Every timed meeting in the user's calendar is shown as a suggestion regardless of response status (organized, accepted, tentative, not responded); excluded: declined (Graph removes them), cancelled (`isCancelled`), all-day, and meetings marked private/confidential in Outlook. (Revised 2026-10-19: owner wants all meetings, not only accepted.)
- [ ] **SYNC-04**: Meeting times are correct in the user's timezone, including across DST changes
- [ ] **SYNC-05**: If Graph is unavailable, slow or throttled, the calendar still works and shows a non-blocking status message (last synced time / retry later)

### Meeting Suggestions in Calendar (CAL)

- [ ] **CAL-01**: Eligible meetings render in the calendar week/day views as visually distinct "ghost" suggestion blocks that are not counted in tracked time, totals, reports or exports
- [ ] **CAL-02**: Ghost blocks cannot be dragged/resized and do not interfere with creating or editing normal time entries in the calendar
- [ ] **CAL-03**: Meetings are visible only to their owner (never to other members or managers) until converted to a time entry
- [ ] **CAL-04**: User can dismiss a meeting suggestion so it stops appearing, and can show dismissed suggestions again to undo it

### Assign Meetings to Projects (ASGN)

- [ ] **ASGN-01**: User can select a meeting suggestion and assign it to a project (optionally task, tags, billable, description prefilled from the meeting subject), which creates a real time entry with the meeting's start/end
- [ ] **ASGN-02**: Time entries created from meetings follow the same rules as manual entries (permissions, billable rates, rounding, overlap checks, project totals recalculation)
- [ ] **ASGN-03**: A meeting occurrence can only be converted once; after conversion it no longer shows as a suggestion, and double clicks/concurrent requests never create duplicate entries
- [ ] **ASGN-04**: User can multi-select several meeting suggestions and assign them all to a project in one action, seeing which succeeded and which failed
- [ ] **ASGN-05**: Time entries created from meetings remain normal, fully editable/deletable time entries (deleting one makes the meeting a suggestion again)

### Recurring Meeting Rules (RULE)

- [ ] **RULE-01**: From an occurrence of a recurring meeting, user can create a rule "assign this series to project X" (optionally task/tags/billable)
- [ ] **RULE-02**: All current unassigned and future occurrences of a ruled series appear pre-assigned to the rule's project; each occurrence becomes a time entry only after the user confirms it with one click
- [ ] **RULE-03**: User can confirm several pre-assigned occurrences at once (e.g. all visible in the week)
- [ ] **RULE-04**: From an occurrence of a recurring meeting, user can create a rule "always ignore this series" so its occurrences stop appearing as suggestions
- [ ] **RULE-05**: User can list, edit and delete their rules; editing/deleting a rule never changes time entries already created; rules whose series no longer exists in Outlook are shown as orphaned

### Out-of-Sync Detection (OSYNC)

- [ ] **OSYNC-01**: If a meeting already converted to a time entry is moved, cancelled or removed in Outlook, the time entry is flagged as "out of sync" in the calendar, showing what changed
- [ ] **OSYNC-02**: Time entries are never modified or deleted automatically because of Outlook changes; user edits to entry times alone never trigger the flag; Graph errors never trigger the flag
- [ ] **OSYNC-03**: For a flagged entry, user can choose: keep as is (clears flag), adjust to the new Outlook time, or delete the entry

### Operations (OPS)

- [x] **OPS-01**: The M365 integration is configured entirely via environment variables (tenant, client id/secret, redirect URI, allowed domains list, target organization) and documented for the Dokploy deployment (HTTPS redirect URI behind proxy, trusted proxies)
- [ ] **OPS-02**: The integration is disabled cleanly (no login button, no calendar overlay) when M365 env vars are not set
- [ ] **OPS-03**: Fork code is isolated in its own module with a documented list of touched core files, and an upstream solidtime merge can be performed without conflicts beyond that list

## v2 Requirements

### Productivity

- **PROD-01**: "Confirm all pre-assigned this week" from a weekly summary
- **PROD-02**: Last-used project hint for meetings with the same subject
- **PROD-03**: Weekly email/notification of unassigned meetings
- **PROD-04**: Option to skip meetings with `showAs=free`

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
| SEC-02 | Phase 3 | Pending |
| SEC-03 | Phase 7 | Pending |
| SEC-04 | Phase 7 | Pending |
| SYNC-01 | Phase 3 | Pending |
| SYNC-02 | Phase 3 | Pending |
| SYNC-03 | Phase 3 | Pending |
| SYNC-04 | Phase 3 | Pending |
| SYNC-05 | Phase 3 | Pending |
| CAL-01 | Phase 3 | Pending |
| CAL-02 | Phase 3 | Pending |
| CAL-03 | Phase 3 | Pending |
| CAL-04 | Phase 3 | Pending |
| ASGN-01 | Phase 4 | Pending |
| ASGN-02 | Phase 4 | Pending |
| ASGN-03 | Phase 4 | Pending |
| ASGN-04 | Phase 4 | Pending |
| ASGN-05 | Phase 4 | Pending |
| RULE-01 | Phase 5 | Pending |
| RULE-02 | Phase 5 | Pending |
| RULE-03 | Phase 5 | Pending |
| RULE-04 | Phase 5 | Pending |
| RULE-05 | Phase 5 | Pending |
| OSYNC-01 | Phase 6 | Pending |
| OSYNC-02 | Phase 6 | Pending |
| OSYNC-03 | Phase 6 | Pending |
| OPS-01 | Phase 2 | Complete |
| OPS-02 | Phase 7 | Pending |
| OPS-03 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-19*
*Last updated: 2026-10-19 after roadmap creation (traceability filled)*
