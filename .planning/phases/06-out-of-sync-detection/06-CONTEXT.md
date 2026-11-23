# Phase 6: Out-of-Sync Detection - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Keep time entries created from Outlook meetings (Phase 4 links) consistent with later Outlook changes, while showing as few warnings as possible:
- Entries of meetings that already happened are never touched.
- Entries of future meetings follow a moved meeting automatically when that is safe.
- Anything that needs a decision is flagged on the entry, with a counter in the calendar toolbar.

Covers OSYNC-01..03 as revised on 2026-11-23. Cleanup on user/org deletion, impersonation and the off switch stay in Phase 7.

</domain>

<decisions>
## Implementation Decisions

### The rule: "started" vs "not started" (owner, 2026-11-23)
- **D-01:** The reference is the meeting time recorded at conversion (a snapshot of start and end on the link), not the entry's own times. A meeting counts as **started** when its recorded start is at or before "now" at the moment the change is detected (it happened, or is happening).
- **D-02:** **Started meeting, any Outlook change** (moved, shortened, cancelled, removed): the entry is never modified and never flagged. An Outlook clean-up of old meetings therefore produces no warnings.
- **D-03:** **Started meeting moved to a new slot.** This is the owner's "second session" case: the organiser drags the existing meeting to another day instead of creating a new one.
  - The meeting shows again as a normal suggestion at its new slot.
  - From there the user can "Create time entry" (the default: a second entry for the new session).
  - Or the user can "Move my entry here": the existing linked entry takes the new times. This covers a meeting rescheduled at the last minute.
  - The original entry and link stay as they are until the user chooses.
- **D-04:** **Not-started meeting moved** (start, end or duration changed):
  - If the entry's start and end still equal the recorded meeting times, the entry is adjusted automatically to the new Outlook times and the snapshot is updated. The adjustment goes through the core update path (permissions, rounding, recalculation jobs).
  - If the user had changed the entry's times by hand, the entry is flagged instead ("Moved in Outlook: old → new"), with **Adjust to Outlook** / **Keep as is**.
- **D-05:** **Not-started meeting cancelled or removed:** the entry is flagged ("Meeting cancelled in Outlook" / "Meeting removed from Outlook"), with **Delete entry** / **Keep as is**. It is never deleted automatically.
- **D-06:** Only time changes and cancellation/removal matter. Changes to the subject, attendees, location or body never flag or modify anything.
- **D-07:** What never flags anything:
  - Editing an entry's times in solidtime never flags it on its own. It only turns off the automatic adjust of D-04.
  - Graph errors, throttling, and partial or failed syncs never flag, adjust or resurface anything.
  - A meeting counts as "removed" only when a successful sync of a window covering its recorded slot no longer returns it, or a direct lookup answers 404 (per the Phase 1 decision document).

### Visibility (owner, 2026-11-23)
- **D-08:** A flagged entry carries a visible marker on its calendar block, next to the Outlook icon, plus the reason with the old and new time. The choice is offered from the entry (click or menu).
- **D-09:** When there are flagged entries, the calendar toolbar shows "N out of sync". Clicking it jumps to the first one.
- **D-10:** Flags, the counter and the checks cover only entries whose recorded meeting start is in the future or within the last 60 days. Older entries are never checked or flagged.
- **D-11:** Besides the sync that runs when a week is opened, a daily background job checks linked meetings in that window (future plus the last 60 days) for every connected user. This keeps the counter right even for weeks the user has not opened. The job follows the Phase 3 throttling/backoff rules and never runs for users without a valid connection.

### Carried forward
- **D-12:** The auto adjust in D-04 is an explicit owner exception to the original rule that Outlook changes never modify entries. It is limited to entries of not-started meetings that the user has not edited. The PROJECT constraint and OSYNC-02 are revised accordingly. Deletion is never automatic.
- **D-13:** Fork isolation as before:
  - Core touches (the entry marker on calendar blocks) are kept minimal and ledgered.
  - Fork endpoints stay outside the `/api/v1` OpenAPI spec.
  - Strings are in English and Spanish.
- **D-14:** Privacy and impersonation rules are unchanged (Phase 3 D-15/D-16/D-22). An impersonating admin sees no flags and cannot act on them.
- **D-15:** The release ends with an owner-free deploy as soon as CI is green, because the system is not in production.

### Claude's Discretion
- Where the snapshot and flag are stored (columns on `outlook_meeting_links` or a new table).
- How the snapshot is backfilled for links created before this phase: from the cached meeting when available, otherwise from the entry times.
- How the daily job fetches (calendarView windows or per-event lookups), when it runs, and how it batches.
- The marker icon, the wording, where the toolbar counter sits, how "jump to first" navigates, and where "Move my entry here" lives (form, panel or menu).
- If the linked entry was deleted, there is nothing to do: the link already cascades away.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md`: OSYNC-01..03 (revised 2026-11-23)
- `.planning/ROADMAP.md`: Phase 6 success criteria
- `.planning/phases/04-assign-meetings-to-projects/04-CONTEXT.md`: links, conversion path, D-05/D-06/D-15
- `.planning/phases/05-smart-meeting-suggestions/05-CONTEXT.md`: series pre-assignment (a moved meeting that shows again may appear pre-assigned)
- `.planning/phases/03-outlook-meetings-in-the-calendar/03-CONTEXT.md`: sync windows, throttling, dismiss, privacy
- `docs/m365/DECISIONS-graph.md`: occurrence key, and how cancelled and removed meetings appear in calendarView
- `docs/m365/TOUCHED-CORE-FILES.md`: core-file ledger

</canonical_refs>

<code_context>
## Existing Code Insights

- `app/Microsoft365/Graph/OutlookMeetingSyncService.php` and `GraphCalendarClient.php`: the window sync, where moved and removed occurrences become visible.
- `app/Microsoft365/Models/OutlookMeetingLink.php`, `MeetingConversionController.php` and `CoreTimeEntryCreator`: links and the in-process core call. D-03 and D-04 need an update counterpart to the create call.
- `resources/js/m365/calendar/OutlookEntryBadge.vue` (the `#event-extra` slot in `Calendar.vue`) is where the marker goes; `useOutlookMeetings.ts` is where the counter and actions go.

</code_context>

<specifics>
## Specific Ideas

- Owner: "si la reunión ya ha ocurrido y el registro está hecho, se mantiene el registro; en el nuevo slot de la reunión en futuro se pregunta si se quiere mover la entrada del pasado o crear una nueva. Si la reunión no ha ocurrido todavía se ajusta automáticamente."
- Owner: limit checks to the last 60 days, so an Outlook clean-up of years-old meetings never produces warnings.

</specifics>

<deferred>
## Deferred Ideas

- Updating an entry's description when the meeting is renamed. The owner chose time and cancellation only.

</deferred>
