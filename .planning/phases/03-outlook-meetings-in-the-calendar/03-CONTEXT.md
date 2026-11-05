# Phase 3: Outlook Meetings in the Calendar - Context

**Gathered:** 2026-11-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The solidtime calendar (week/day views) shows the signed-in user's own Outlook meetings for the visible range as read-only "ghost" suggestion blocks next to their time entries. Meetings are fetched from Microsoft Graph when the calendar opens or the range changes, and again on a manual "Sync" button. The user can dismiss a suggestion and show dismissed ones again. Graph failures and token problems degrade gracefully (status message, silent refresh, "Reconnect Microsoft" prompt).

Requirements: SYNC-01..05, CAL-01..04, SEC-02.

Not in this phase: turning a meeting into a time entry (Phase 4), series rules and "always ignore this series" (Phase 5), out-of-sync flags on converted entries (Phase 6), deletion cleanup and impersonation guard (Phase 7), background/periodic sync or webhooks (v2 SYNC2-01), shared calendars (v2 SYNC2-02), skipping `showAs=free` (v2 PROD-04).

</domain>

<decisions>
## Implementation Decisions

### Which meetings appear (product, decided this session)
- **D-01:** Meetings that overlap a time entry the user already logged are shown anyway, with the same ghost style. Nothing is hidden or dimmed automatically; the user decides by dismissing. (Phase 4 linking may later change how a converted meeting is shown; that is Phase 4's call.)
- **D-02:** All eligible meetings in the visible range are shown, past and future, same style. There is no "only until now" cut-off.
- **D-03:** Eligibility follows SYNC-03 exactly, as fixed in `docs/m365/DECISIONS-graph.md`: every timed meeting regardless of response status (organizer, accepted, tentative, not responded, personal blocks without attendees); exclude `isCancelled=true`, `isAllDay=true`, and `sensitivity` other than `normal`. Declined ones are already removed by Graph; skipping a residual `responseStatus=declined` defensively is allowed. `showAs=free` meetings ARE shown (skipping them is v2 PROD-04).

### Ghost block interaction (product, decided this session)
- **D-04:** Clicking a ghost block opens a small detail panel (popover) with: subject, start-end time, organizer, location / online-meeting indicator (Teams), and a "Dismiss" action. Phase 4 will add "Assign to project" in the same panel, so the panel must be built as an extendable component.
- **D-05:** Ghost blocks are not draggable or resizable and must not block slot selection, drag or resize of real time entries (CAL-02). Clicking a ghost opens the panel; it never starts creating a time entry.
- **D-06:** Ghost blocks are visually distinct from time entries (e.g. outlined / hatched / translucent, not the project colour) and are never counted in tracked time, day/week totals, reports or exports (CAL-01). Exact visual is Claude's discretion following existing theme tokens.

### Dismiss (product)
- **D-07:** Dismiss is per occurrence (one meeting instance, keyed by the immutable occurrence id). "Always ignore this series" is Phase 5. Dismissals persist server-side per user.
- **D-08:** A "Show dismissed" toggle lets the user see dismissed suggestions again (rendered distinctly) and un-dismiss them. Placement is Claude's discretion; the existing calendar settings popover (`CalendarSettingsPopover.vue`) is the natural place.

### Connection state in the calendar (product, decided this session)
- **D-09:** Users without a connected Microsoft account (password-only users, or after Disconnect) see a small, non-blocking "Connect Microsoft 365" button next to the Sync control, which starts the existing Phase 2 connect flow (`?intent=connect`) and returns to the calendar. The calendar otherwise works exactly as today. Only shown when the integration is enabled (D-14 of Phase 2).
- **D-10:** When the token cannot be refreshed (revoked, expired, Conditional Access, `invalid_grant`), the same spot shows "Reconnect Microsoft" instead of an error (SEC-02). Silent refresh when the access token is merely expired.

### Sync and status
- **D-11:** Meetings load after (and never block) time entries. Fetch on calendar open and on range navigation, plus a manual "Sync" button; repeated presses and fast navigation are debounced/coalesced so Graph is not hammered (SYNC-02). A short server-side reuse window for the same user+range is allowed to avoid repeat Graph calls.
- **D-12:** A non-blocking status near the Sync button shows "last synced <time>" and, on Graph failure/slowness/429, "Outlook unavailable, retry later" while the calendar keeps showing time entries (and the last known meetings if cached). Honour `Retry-After` on 429.

### Carried forward (locked by earlier phases)
- **D-13:** Graph details fixed in Phase 1 (`docs/m365/DECISIONS-graph.md`): `calendarView` on the primary calendar; combined header `Prefer: outlook.timezone="UTC", IdType="ImmutableId"` on every request including every `@odata.nextLink`; `$top=100` with a page cap; the production `$select` string from that document; occurrence key = immutable `id`; series key = `seriesMasterId` (stored now so Phase 5 can use it).
- **D-14:** Times arrive in UTC and are displayed in the user's solidtime timezone, correct across DST (SYNC-04).
- **D-15:** Tokens live only encrypted in `microsoft_accounts` (Phase 2 D-09/SEC-01). No token, Graph payload or meeting subject goes to logs, audits, session, cache keys visible to others, Inertia shared props or the public `/api/v1` OpenAPI spec.
- **D-16:** Privacy: meetings are visible only to their owner; no manager/admin view; endpoints return only the authenticated user's own meetings (CAL-03).
- **D-17:** Fork isolation (Phase 2 D-15): backend in `app/Microsoft365/`, frontend in `resources/js/m365/`; minimal, ledgered touches to core calendar files (`docs/m365/TOUCHED-CORE-FILES.md`). Fork endpoints stay out of the public `/api/v1` OpenAPI spec.
- **D-18:** UI strings in English (Phase 2 D-18).
- **D-19:** F1/freelance users without a mailbox must not see errors: a Graph "no mailbox" answer is treated as "no meetings" with a quiet status.

### Claude's Discretion
- Whether meetings are cached in the database or fetched live per range (must support dismissals now and Phase 4/6 linking later; research recommends).
- Debounce timing, server reuse window, page cap, Graph timeouts.
- Exact ghost visual, panel layout, toggle placement, status wording.
- How the ghost layer is wired into `TimeEntryCalendar.vue` / `useCalendarEvents.ts` (a separate layer like the existing activity boxes vs mixed events), as long as D-05 holds.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Graph behaviour and eligibility (Phase 1)
- `docs/m365/DECISIONS-graph.md` — occurrence/series keys, cancelled/declined/moved/private/all-day rules, eligibility signals, time zone, ImmutableId + nextLink, production `$select`
- `tests/Fixtures/M365/` (and its `README.md`) — sanitized real `calendarView` responses for every scenario; Phase 3 tests replay these
- `tests/Unit/M365/CalendarViewFixturesTest.php` — existing PHP fixture replay via `Http::fake`

### Requirements and scope
- `.planning/REQUIREMENTS.md` — SYNC-01..05, CAL-01..04, SEC-02; Out of Scope table
- `.planning/ROADMAP.md` §Phase 3 — success criteria and research focus
- `.planning/PROJECT.md` — constraints (scopes, security, mergeability)

### Phase 2 foundation
- `.planning/phases/02-sign-in-with-microsoft/02-CONTEXT.md` — D-09 scopes, D-10/D-19 disconnect/connect, D-14 off switch, D-15 isolation, D-18 language
- `app/Microsoft365/Models/MicrosoftAccount.php` — encrypted token storage
- `app/Microsoft365/` (service provider, routes, `MicrosoftConfig.php`, `Auth/`) — where Phase 3 backend lives
- `docs/deploy/MICROSOFT-SIGNIN.md` — deployment, disconnect semantics, Cloudflare Access note (`/api/*` bypass)
- `docs/m365/TOUCHED-CORE-FILES.md` — ledger every core-file touch must be added to

### Research pointers
- `.planning/research/PITFALLS.md` (pitfall 11 pointer), `.planning/research/STACK.md` §6 — superseded `$select`, use DECISIONS-graph instead

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resources/js/packages/ui/src/FullCalendar/` — custom calendar: `TimeEntryCalendar.vue`, `CalendarDayColumn.vue`, `useCalendarEvents.ts`, `useSlotSelection.ts`, `useEventDrag.ts`, `useEventResize.ts`, `CalendarToolbar.vue`, `CalendarSettingsPopover.vue` / `calendarSettings.ts`
- `useActivityBoxes.ts` + `activityTypes.ts` — an existing non-time-entry overlay layer (desktop activity periods) rendered in day columns; closest analog for a read-only ghost layer
- `resources/js/utils/useTimeEntriesCalendarQuery.ts` — TanStack Query pattern for the calendar range; meetings query should mirror it and load independently
- Phase 2 profile "Microsoft 365" section and connect flow (`?intent=connect`) — reuse for the calendar Connect/Reconnect button

### Established Patterns
- TanStack Query for calendar data; Inertia page `resources/js/Pages/Calendar.vue`
- Fork code isolated in `app/Microsoft365/` and `resources/js/m365/`; core touches ledgered

### Integration Points
- Calendar page / toolbar (Sync button, status, Connect/Reconnect, show-dismissed toggle)
- Day column rendering (ghost layer) without breaking pointer handling of slot selection/drag/resize
- New fork-only web/JSON routes under `app/Microsoft365/routes/` (session-authenticated, not `/api/v1`)

</code_context>

<specifics>
## Specific Ideas

- The detail panel is the future home of "Assign to project" (Phase 4) and series actions (Phase 5): build it once, extendable.
- Owner wants to see everything and decide; prefer showing over hiding.

</specifics>

<deferred>
## Deferred Ideas

- Hiding or dimming meetings already covered by logged time — rejected for now (D-01); revisit only if the calendar feels noisy.
- Skip `showAs=free` meetings — v2 PROD-04.
- Background sync / webhooks — v2 SYNC2-01.

</deferred>

---

*Phase: 03-outlook-meetings-in-the-calendar*
*Context gathered: 2026-11-05*
