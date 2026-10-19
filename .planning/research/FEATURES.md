# Feature Research

**Domain:** Calendar-to-timesheet integration (Outlook / Microsoft 365 meetings -> time entries) in a time tracker (solidtime fork)
**Researched:** 2026-10-19
**Confidence:** MEDIUM (competitor behavior from vendor help pages, HIGH for what they document; Graph field semantics from training knowledge plus the official calendarView doc, MEDIUM; competitors' handling of recurring/cancelled events is mostly undocumented, so conclusions there are LOW-MEDIUM)

PROJECT.md decisions are treated as fixed. This file informs requirement detail only.

## What competitors actually do (evidence base)

| Product | Calendars | Model | Assign to project | Recurring | Changed/cancelled | Notes |
|---------|-----------|-------|-------------------|-----------|-------------------|-------|
| Clockify | Google, cloud Outlook/O365, multiple calendars | Events appear as read-only blocks in Calendar page; hover -> "Copy as time entry" or "start timer" | Project/tags/billable chosen in the pop-up dialog on copy | No documented series support | External changes reflect automatically in the calendar; a copied entry is an independent copy (never changes the original, and vice versa) | All-day events hidden. Events are private to the user (admins cannot see) until converted to a normal entry. |
| Toggl Track | Google, Outlook | Events in a second column beside entries in Calendar view; click -> copy as entry / start timer. Optional "Auto-track calendar events" | Description copied; project/tags NOT assigned, user does it manually | No documented series support | Auto-tracked entries are not updated/deleted if the event later changes | Only timed events; window ~60 days back / 30 forward; auto-track creates entries within 5 min of start; skips past-created events, locked/approved periods. Per-event privacy. |
| Harvest | Google OR Outlook.com (one, not both); multiple calendars within it | "Pull in a calendar event" drawer in Day view; click event fills notes + duration/start-end | Chosen in normal new-entry form | Stores calendar event id and recurring event id with the entry (data hook for future series features, no rules documented) | Not documented | Not supported on desktop apps; entries stay after disconnect. |
| Everhour | Google, Outlook, iCloud via ICS/link, admin-configured | Auto-creates entry (no task) from each event, before or after the event | Later moved to a task manually | Reportedly not synced / limited (marketing copy, LOW confidence) | Not documented | All-day skipped; start/end required. Link-based, not OAuth. |
| Timely | O365/Outlook, Google | Events imported into a "Memory" timeline, 28d back / 14d forward; user converts to entries | Project tagged in Timely | Not documented | Outlook edits OVERWRITE Timely-side edits (title/time/project tag) for the event: the cautionary tale | Private events never imported. |
| Tempo (Jira) | O365/Exchange, Google | Events show in My Work; one-click to log | Issue key in event title preselects the issue (also for other attendees); description pre-filled from title | No documented series support | Not documented | Convention-based assignment (key in title) is the only "rule"-like behavior found. |

Cross-cutting pattern: the dominant model is "calendar events are a read-only overlay that the user copies into entries one at a time". Nobody documents bulk assignment, ignore lists, or recurring-series rules, and nobody documents out-of-sync flagging. The PROJECT.md scope (suggestions + bulk + ignore + series rules + out-of-sync flag) is therefore well beyond the market baseline; the table-stakes below are drawn from what every competitor does plus what Graph forces on you.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Sign in with Microsoft (Entra, single tenant, OAuth code + PKCE + state) alongside password login | Standard SSO expectation for an M365 shop; PROJECT.md decision | MEDIUM | Socialite + Microsoft provider or hand-rolled OIDC. Use `tid` and `oid` claims to enforce tenant and as the stable identity key (not email). Hook into Fortify without touching its routes in place. |
| Auto-provision on first Microsoft sign-in and join Untangle org; link by email to existing users | Zero-touch onboarding; avoids duplicate accounts | MEDIUM | Link only on verified email AND matching tenant; store `oid`/`sub` on the first link and match on that afterwards. Mark email verified. Assign default role (employee, never owner/admin). Idempotent under concurrent first logins (unique index). |
| Connect/disconnect Microsoft calendar; disconnect revokes and deletes tokens | Every competitor has connect/disconnect; Harvest keeps already created entries after disconnect | LOW | Entries created from meetings must survive disconnect and user-deletion cleanup (keep entry, null the link or keep the stored event id). |
| Calendar events shown as read-only overlay in the existing calendar week/day view | Core of every competitor | MEDIUM | Ghost blocks must be visually distinct (dashed/striped/low-opacity), excluded from totals, reports, running-timer logic and exports. Overlap with real entries must stay usable (side-by-side columns like Toggl, or narrow lane). |
| Only timed, relevant events (no all-day, no declined, no cancelled) | Clockify/Toggl/Everhour all drop all-day; PROJECT.md adds declined/cancelled | LOW | Graph `calendarView` expands recurring series into occurrences. Filter on `isAllDay`, `isCancelled`, `responseStatus.response` (declined), keep organizer/accepted/tentative. Consider also dropping `showAs=free`; see Differentiators. |
| Convert one meeting to a time entry in one click with prefilled fields | Universal: description from title, start/end from meeting | MEDIUM | Prefill description=subject, start/end=meeting times. Project picker in the same popover (Clockify) is better than Toggl's "assign later". Entry must be created through `TimeEntryService` so rates, rounding, billable defaults and validation apply. |
| Link between time entry and source meeting (event id, series id, iCalUId) | Needed for dedupe, "already logged" state, ignore, rules, out-of-sync. Harvest already stores event + recurring id | MEDIUM | Separate link table (fork isolation) rather than new columns on `time_entries`. Unique constraint (user, event occurrence id) so double-click / double-sync cannot create two entries. |
| Suggestion disappears (or shows as "logged") once converted | Prevents double counting, the main user fear | LOW | Show a subtle "logged" state or hide; never render both a ghost and its entry at full prominence. |
| Time zones correct (user TZ vs meeting TZ, DST) | A wrong hour is the fastest way to lose trust | MEDIUM | Request with `Prefer: outlook.timezone="UTC"`, store UTC, render in user TZ. Query windows must carry explicit offsets. Test across DST boundary and for meetings organized in another TZ. |
| Respect locked/past-period rules | Toggl skips locked/approved periods; same validation any entry gets | LOW | Falls out of using `TimeEntryService`. Surface the error instead of failing silently. |
| Graph failure handling: timeout, token expiry/revocation, throttling (429), consent revoked | Sync-on-open means Graph slowness hits the page | MEDIUM | Calendar must still render real entries if Graph fails; show a non-blocking "could not sync, retry / reconnect" state. Use refresh token flow; on `invalid_grant` mark connection as needing reauth. Honor `Retry-After`. |
| Privacy: meetings visible only to their owner until converted | Clockify and Toggl both state this explicitly | LOW | Suggestions fetched per-user, never stored for others, never in org reports. Consider skipping `sensitivity=private` meetings or showing as "Private event" with no title. |
| Manual "Sync" button and on-open fetch (PROJECT.md) | Toggl needs a refresh; users want control | LOW | Debounce (e.g. no more than one fetch per N seconds per user), per-range fetch (visible week only), not whole history. |
| Dismiss/ignore a meeting | Standing complaint where calendars are noisy; implied by PROJECT.md | LOW | Persist ignore per (user, occurrence). Provide "show ignored" toggle and un-ignore so it is reversible. |

### Differentiators (Competitive Advantage)

These align with the Core Value ("one click instead of retyping") and are mostly absent from the competitor set.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Assign project directly on the suggestion (project/task/tags/description in a popover) | Toggl does not assign projects at all; Clockify needs a dialog. Faster = core value | MEDIUM | Reuse the existing time entry create/edit form component. |
| Bulk select and assign multiple suggestions to one project | No competitor documents it; a week of meetings in one action | MEDIUM | Multi-select in FullCalendar (shift/ctrl click, or checkbox mode) plus "Assign N meetings". Do creation in one API call, one DB transaction, per-item result reporting (partial failure shown, not all-or-nothing surprises). |
| Recurring-series rules ("this series -> project X") with pre-assignment, still one-click confirm | Not documented in any competitor (Harvest only stores the recurring id; Tempo uses key-in-title) | HIGH | Rule key = user + series master id (`seriesMasterId` from Graph occurrences, fallback iCalUId). Applies to future and currently unassigned occurrences. Pre-assigned ghosts show the project color and a "Confirm" action; bulk "confirm all pre-assigned this week" is the natural companion (still user-initiated, so consistent with the no-auto-create decision). Handle series being re-created in Outlook (new master id): rule orphaned; offer matching by subject as a fallback suggestion only. |
| Manage rules screen (list, edit project/task/tags, delete, see matched series name) | Rules users cannot see become distrusted magic | MEDIUM | Delete rule must not touch already created entries. Editing a rule changes pre-assignment of unconfirmed occurrences only. |
| "Always ignore this series" rule | Ignoring a weekly stand-up 52 times is the real pain | LOW | Same rule table with `action = ignore`. Strong value for tiny cost; recommended for v1. |
| Out-of-sync flag on entries whose meeting moved or was cancelled (never auto-modify) | Only Timely addresses change and it overwrites silently; Toggl simply ignores later changes. Flagging fits the "never lose hours" decision | HIGH | Compare stored snapshot (start, end, changeKey/lastModified, cancelled) with fresh fetch for linked events in the fetched range. Cancelled detection: organizer's cancelled events return `isCancelled=true`, but for attendees a cancelled/deleted occurrence may simply vanish from `calendarView`, so "linked event absent from a range that should contain it" must be treated as cancelled/removed (verify against Graph behavior in phase research). Provide user actions: "Update entry to new times", "Keep as is (dismiss flag)", "Delete entry" (all manual). Only evaluate within the fetched window, and never flag when the Graph call failed. |
| Visual states on ghosts: unassigned / pre-assigned by rule / logged / ignored / conflicting with an existing entry | Makes the one-click workflow scannable | MEDIUM | Overlap with a manually tracked entry for the same slot gets a hint ("you already tracked time here") to avoid double counting. |
| Smart default project hint without a rule (last project used for same series/title) | Reduces clicks before a rule exists | LOW-MEDIUM | Suggestion-only prefill, based on the user's own history. Defer if time is tight. |
| Include meeting metadata on the entry (attendee count, online meeting) | Cheap context in the description or a tag | LOW | Optional, v1.x. Keep Graph payload minimal (`$select`). |
| Week "review" summary: N unassigned meetings, total hours pending | Gets the whole team to the "calendar fully logged" state | LOW-MEDIUM | Banner above calendar with a bulk "assign all unassigned" entry point. Nice companion to bulk assign. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-create time entries for meetings (Toggl "auto-track", Everhour default) | "Zero clicks" | Scheduled is not worked; entries for skipped meetings pollute billable hours and invoices. Explicitly out of scope in PROJECT.md | Rules pre-assign; one-click confirm; "confirm all pre-assigned this week" |
| Auto-update or auto-delete entries when Outlook changes (Timely behavior) | Keep timesheet equal to calendar | Silently alters or loses approved/billed hours; Timely's overwrite is a known complaint | Out-of-sync flag with explicit user resolution |
| Background periodic sync / Graph webhooks | "Always fresh" | Needs public endpoint, subscription renewal, queue worker, token handling when user is offline. Out of scope | Sync on open + manual button; short per-range cache |
| Storing the full calendar in the DB / mirroring Outlook | Offline, history, reporting on meetings | Privacy exposure, stale data, GDPR surface, sync-conflict complexity | Fetch live per visible range; persist only link/ignore/rule records and a minimal snapshot for linked events |
| Importing every calendar and shared/delegated calendars | Complete picture | Noise, privacy leakage of other people's meetings, extra consent scope | Default calendar only in v1 (Harvest/Clockify allow multi, but not needed here) |
| Writing back to Outlook (create/move events, mark as logged) | Two-way convenience | Needs `Calendars.ReadWrite`, violates least privilege, conflict handling. Out of scope | Read-only |
| Rule matching by subject/keyword/attendee ("anything with 'Acme' -> Acme project") | Powerful automation | Fuzzy rules misassign silently; hard to explain; wrong billing | Series-based rules only (exact series id); offer subject match only as a non-binding hint |
| Admin/manager view of employees' unassigned meetings | Compliance nagging | Breaks the privacy norm competitors state; needs org-level consent | Keep suggestions private; only converted entries are visible |
| Disabling password login or forcing SSO-only | Security hygiene | Out of scope; breaks existing users and API/mobile flows | Coexist |
| Multi-tenant or multi-provider (Google, ICS) | Reusability | Out of scope; enlarges config, consent and testing surface | Keep tenant single, isolate provider code behind a small interface so a future provider is possible |
| Resizing/dragging a ghost block to adjust duration before converting | Looks natural in a calendar UI | Two edit surfaces, ambiguity about whether ghost moves in Outlook; competitors avoid it | Edit start/end in the assign popover after conversion |
| Pulling past history on first connect (months of meetings) | "Catch up" | Bulk noise, rate limits, hundreds of ghosts | Window around the visible range; user navigates back as needed |

## Feature Dependencies

```
Microsoft sign-in (OIDC, tenant check)
    └──requires──> Token storage (encrypted, hidden from audit, revoke on delete)
                       └──requires──> Graph fetch of calendarView (timeout, refresh, error states)
                                          └──requires──> Event filtering (all-day/declined/cancelled/organizer/tentative)
                                                             └──requires──> Ghost overlay in calendar (not counted as tracked time)
                                                                                └──requires──> Assign one meeting -> time entry
                                                                                                   └──requires──> Meeting<->entry link table (event id, series id, snapshot)

Meeting<->entry link table ──enables──> "logged" state, dedupe
                           ──enables──> Out-of-sync flag (snapshot compare)
                           ──enables──> Series rules (series id)

Ignore (per occurrence) ──requires──> link/ignore table
Series rule (assign)    ──requires──> Assign one meeting + link table + seriesMasterId
Series rule (ignore)    ──requires──> Ignore + series id
Rules management UI     ──requires──> Series rules
Bulk assign             ──requires──> Assign one meeting + multi-select in calendar UI
Confirm-all pre-assigned ──enhances──> Series rules + Bulk assign

Auto-create entries ──conflicts──> Confirm-each-occurrence decision
Auto-modify entries on change ──conflicts──> Out-of-sync flag (never auto-modify)
```

### Dependency Notes

- **Ghost overlay requires Graph fetch and filtering:** overlay is meaningless until relevant events arrive normalized (UTC, expanded occurrences, stable ids). Define the normalized event DTO first; everything else consumes it.
- **Everything after the overlay requires the link table:** schema decisions (unique occurrence key, series id, snapshot of start/end/changeKey/cancelled state) must be made in the same phase as "assign one meeting", or rules and out-of-sync will force a migration and backfill.
- **Series rules require assignment first:** the rule is only "pre-assign the project on matching ghosts"; confirmation reuses the single-assign path.
- **Out-of-sync requires snapshot and a refetch path:** only possible once entries carry the link; evaluate it inside the same sync that feeds the overlay, but never when the fetch failed.
- **Bulk assign requires multi-select UI:** FullCalendar selection currently targets time entries; ghost events need their own selectable state. UI effort sits here, not in the backend.
- **Sign-in is independent of calendar features** in code, but the Graph token comes from the same OAuth flow, so scopes (`offline_access Calendars.Read`) must be requested at first login or the user needs a second consent step. Decide in the auth phase: request everything at first sign-in (simplest for a single-tenant, admin-consented app).

## MVP Definition

### Launch With (v1)

Matches the PROJECT.md Active list; order within is by dependency.

- [ ] Microsoft sign-in, tenant-restricted, auto-provision and link by verified email / oid — gateway to everything
- [ ] Encrypted token storage, disconnect, revoke on delete, audit exclusion — security gate
- [ ] Graph calendarView fetch (visible range, on open + Sync button), filtered, with error/reauth states — data source
- [ ] Ghost overlay in calendar, excluded from totals — Core Value
- [ ] One-click assign meeting -> project/task/tags/description -> linked time entry; dedupe via link table — Core Value
- [ ] Dismiss/ignore single occurrence (with un-ignore) — noise control
- [ ] Bulk select + assign — in PROJECT.md Active
- [ ] Series rules (assign) with pre-assigned ghosts and one-click confirm; rules list/edit/delete — in PROJECT.md Active
- [ ] Out-of-sync flag on linked entries, with manual resolution actions — in PROJECT.md Active

### Add After Validation (v1.x)

- [ ] "Always ignore this series" rule — cheap; promote to v1 if the rules table already exists (recommended)
- [ ] "Confirm all pre-assigned this week" button — add once users report friction confirming rule matches one by one
- [ ] Last-used-project hint for meetings without a rule
- [ ] Weekly "unassigned meetings" summary banner
- [ ] Overlap-with-existing-entry hint
- [ ] Skip `showAs=free` / private-sensitivity handling toggle, if noise reports come in

### Future Consideration (v2+)

- [ ] Additional calendars (non-default, shared) — only if the team asks
- [ ] Background sync / webhooks — only if sync-on-open proves too slow or stale
- [ ] Additional providers (Google/ICS) — fork-only; out of scope
- [ ] Keyword-based assignment hints — only as non-binding suggestions

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Microsoft sign-in + auto-provision/link | HIGH | MEDIUM | P1 |
| Token security (encrypted, hidden, revoke) | HIGH | LOW | P1 |
| Graph fetch + filtering + error states | HIGH | MEDIUM | P1 |
| Ghost overlay (not counted) | HIGH | MEDIUM | P1 |
| Single assign with link table | HIGH | MEDIUM | P1 |
| Ignore occurrence | MEDIUM | LOW | P1 |
| Bulk assign | HIGH | MEDIUM | P1 |
| Series rules (assign) + manage UI | HIGH | HIGH | P1 |
| Out-of-sync flag + resolution actions | MEDIUM-HIGH | HIGH | P1 |
| Ignore-series rule | MEDIUM | LOW | P2 (promote if cheap) |
| Confirm-all pre-assigned | MEDIUM | LOW | P2 |
| Last-used project hint | LOW-MEDIUM | LOW-MEDIUM | P3 |
| Weekly unassigned summary | LOW-MEDIUM | LOW | P3 |
| Overlap hint | LOW | MEDIUM | P3 |

**Priority key:** P1 must have for launch (already decided in PROJECT.md); P2 should have when possible; P3 nice to have.

## Edge Cases That Should Become Requirement Acceptance Criteria

| Area | Behavior to specify |
|------|---------------------|
| Recurring: single occurrence moved/edited in Outlook | Graph returns it as an exception occurrence with the same `seriesMasterId`; the rule still applies; the existing link points at the occurrence id, so a moved occurrence of an already converted entry gets the out-of-sync flag. |
| Recurring: entire series re-timed or recreated | Occurrence ids may change; rule keyed on series master id may stop matching; show orphaned rules in the rules list with last-matched date. |
| Recurring: occurrence deleted from the series | Linked entry flagged as cancelled in Outlook; unlinked ghost simply disappears. |
| Meeting declined after conversion | Treat like cancelled for the user: flag, do not delete. |
| Meeting converted, then ignored state | Ignore applies only to unlinked suggestions; a linked meeting is never "ignored". |
| Time entry deleted by the user | Link freed; the ghost reappears as unassigned (and pre-assigned if rule matches). |
| Two entries for one meeting | Prevented by unique occurrence key; bulk assign skips already linked ones and reports them. |
| Meeting shorter/longer than actually worked | Editing entry times after conversion is normal; out-of-sync compares against the meeting snapshot, so a user-edited entry must not be flagged merely because its times differ from the meeting. Flag only when the Outlook side changed since the snapshot. |
| Overlapping meetings (double-booked) | Both shown; user decides; no auto-resolution. |
| Entry in locked/approved period | Assignment fails with clear message; flag still raised on out-of-sync. |
| First sign-in race / email case differences | Normalize email case; unique index on Microsoft `oid`; link idempotent. |
| User leaves Untangle (disabled in Entra) | Refresh fails with `invalid_grant`/disabled; mark connection broken; do not delete entries; sign-in blocked by Entra. |

## Competitor Feature Analysis

| Feature | Clockify | Toggl Track | Harvest | Our Approach |
|---------|----------|-------------|---------|--------------|
| Overlay of calendar events | Yes, read-only | Yes, second column | Only inside the new-entry drawer | Ghost blocks in the existing calendar |
| Convert to entry | Hover -> Copy as time entry (dialog) | Click -> copy; project manual | Click event in drawer, fills notes + duration | One-click with project/task/tags in popover |
| Bulk convert | No | No | No | Yes, multi-select |
| Ignore events | No documented | No documented | No | Yes, per occurrence and per series |
| Recurring rules | No | No | Stores recurring id only | Series -> project rule, confirm each |
| Auto-create | No | Optional auto-track | No | Never (decision) |
| Handling change/cancel | Overlay refreshes; copies independent | Entries not updated | Not documented | Out-of-sync flag, manual resolution |
| Privacy | Private until converted | Private to owner | Per user connection | Private until converted |
| SSO | Separate concern | Separate | Separate | Entra sign-in with auto-provision |

## Sources

- Clockify help: calendar integration (https://clockify.me/help/integrations-and-add-ons/calendar, https://clockify.me/help/getting-started/integrate-google-outlook-with-your-clockify-account) — HIGH for documented behavior
- Toggl Track support: calendar view with Google and Outlook (https://support.toggl.com/en-us/article/integrating-calendar-view-with-google-and-outlook-calendars-fl0obg); auto-track details fetched directly — HIGH
- Harvest support: add calendar events to your timesheet (https://support.getharvest.com/hc/en-us/articles/360048180932) — HIGH
- Everhour support/blog: calendar integrations (https://support.everhour.com/article/603-calendar-integrations, https://everhour.com/blog/calendar-integrations-google-outlook-icloud/) — MEDIUM; recurring claim from marketing copy, LOW
- Timely handbook: Office 365 calendar (https://www.timely.com/help/handbook/integrations/office-365-calendar/) — MEDIUM
- Tempo blog: Microsoft 365 calendar integration (https://www.tempo.io/blog/track-time-faster-in-jira-with-the-microsoft-365-calendar-integration) — MEDIUM (vendor marketing)
- Microsoft Graph calendarView reference (https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0) — HIGH for the endpoint, timezone and permission behavior. Event field semantics (`seriesMasterId`, `type`, `isCancelled`, `responseStatus`, `isAllDay`, `changeKey`, `iCalUId`) and attendee-side cancellation behavior are from training knowledge, MEDIUM; confirm with a spike against the Untangle tenant before locking the out-of-sync design.
- Not verified: whether `Calendars.ReadBasic` would suffice (less privilege, but it omits fields that this feature may need); PROJECT.md already decided `Calendars.Read`.

---
*Feature research for: calendar-to-timesheet integration (Outlook -> solidtime)*
*Researched: 2026-10-19*
