# Phase 4: Assign Meetings to Projects - Context

**Gathered:** 2026-11-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn Outlook meeting suggestions (the ghost blocks shipped in Phases 3/3.1) into real solidtime time entries on a project: one meeting at a time from the hover card, detail panel and context menu, or several at once. Covers ASGN-01..05. Recurring-series rules (pre-assign / always ignore) are Phase 5; out-of-sync detection after Outlook changes is Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Creating one entry (owner, 2026-11-17)
- **D-01:** A "Create time entry" action is added to the meeting hover card, the click detail panel (`OutlookGhostDetail.vue`) and the meeting context menu (`OutlookMeetingContextItems.vue`), next to "Open in Outlook" and "Dismiss" (roadmap criterion 6).
- **D-02:** The action opens a small inline form (mini form), not a direct create. Prefilled: project = the project the user used last for a meeting conversion (fallback: the user's most recent time entry's project; else empty), description = meeting subject, start/end = meeting start/end, billable = the project's default. Editable: project (required), task, tags, billable, description, start, end. Enter or "Create" confirms, so a repeat conversion to the same project is two clicks.
- **D-03:** Start/end are editable in the form so a user who joined late or left early logs the real time. The entry stays linked to the meeting occurrence regardless of the edited times.

### After conversion (owner, 2026-11-17)
- **D-04:** A converted meeting no longer appears in the Outlook lane (ASGN-03). The time entry renders as a normal entry with a small Outlook icon so its origin is visible. This refines Phase 3 D-01 ("converted meeting display is Phase 4's call").
- **D-05:** The entry is a normal, fully editable/deletable time entry (ASGN-05). Deleting it brings the meeting back as a suggestion. Editing its times does not bring the meeting back.
- **D-06:** One occurrence → at most one time entry, enforced server-side (unique link per user + occurrence), so double clicks and concurrent requests never duplicate (ASGN-03). A repeated request returns the existing entry rather than an error.

### Several at once (owner, 2026-11-17)
- **D-07:** Multi-select with Ctrl/Cmd-click or Shift-click on meetings. While one or more are selected, a floating bar shows "Assign N meetings" and opens the same mini form without start/end fields (each meeting keeps its own times; description = each meeting's own subject). Escape or clicking elsewhere clears the selection.
- **D-08:** After a multi-assign the user sees a per-meeting result: created, or failed with the reason (e.g. no permission on the project, meeting no longer exists, already converted). Successful ones disappear from the lane; failed ones stay selected so the user can retry.

### Future meetings (owner, 2026-11-17)
- **D-09:** Future meetings can be converted, with no time limit, same as manual future entries in solidtime.

### Rules carried forward
- **D-10:** Entries created from meetings go through the same core path as manual entries (permissions, billable rate resolution, rounding, overlap handling, project/task spent-time recalculation jobs), i.e. reuse `TimeEntryService` / the existing create flow rather than inserting rows directly (ASGN-02). Do not add overlap blocking that manual entries don't have.
- **D-11:** Dismissed meetings are not convertible from the lane while hidden; when "Show dismissed" is on, converting a dismissed meeting is allowed and clears its dismissal.
- **D-12:** Fork isolation (Phase 2 D-15 / Phase 3 D-17): backend in `app/Microsoft365/`, frontend in `resources/js/m365/`; any core touch (e.g. the Outlook icon on calendar entries) is minimal and ledgered in `docs/m365/TOUCHED-CORE-FILES.md`. Fork endpoints stay out of the public `/api/v1` OpenAPI spec.
- **D-13:** Privacy and token rules unchanged (Phase 3 D-15, D-16, D-22): meeting subject only goes into the user's own time entry description; impersonation cannot convert meetings.
- **D-14:** Calendar shows weekends hidden by default (owner, 2026-11-17, shipped as a 3.1 follow-up); nothing in this phase depends on weekends being visible.

### Claude's Discretion
- Link storage shape (link table vs column on `outlook_meetings`) and how deleting an entry re-surfaces the suggestion, as long as D-05/D-06 hold and the link survives re-syncs.
- Where "last used project" is remembered (server or local).
- Exact mini-form layout (popover anchored to the meeting vs reusing parts of the existing time-entry create modal), keyboard behaviour, floating bar placement, icon choice and wording (English strings with the existing lang files).
- Whether the multi-assign is one batch endpoint or several single calls, as long as results are per meeting.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — ASGN-01..05
- `.planning/ROADMAP.md` — Phase 4 success criteria 1-6

### Prior phase decisions
- `.planning/phases/03-outlook-meetings-in-the-calendar/03-CONTEXT.md` — ghost lane, dismiss, privacy, impersonation guard, D-23 lane layout
- `.planning/phases/03.1-calendar-ux-polish/03.1-CONTEXT.md` — hover card, context menu, lane, zoom
- `docs/m365/DECISIONS-graph.md` — occurrence key (immutable id), series key (for Phase 5)
- `docs/m365/TOUCHED-CORE-FILES.md` — core-file ledger to extend

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resources/js/m365/calendar/OutlookGhostDetail.vue`, `OutlookMeetingHoverCard.vue`, `OutlookMeetingSummary.vue`, `OutlookMeetingContextItems.vue`: the three surfaces that get the new action.
- `resources/js/m365/calendar/useOutlookMeetings.ts`, `meetingsApi.ts`: meeting query and mutations (dismiss pattern to mirror).
- `app/Microsoft365/Models/OutlookMeeting.php`, `Http/Controllers/OutlookMeetingController.php`, `routes/microsoft365.php`: meeting storage and endpoints.
- `app/Service/TimeEntryService.php` and the core time-entry create flow / time-entry create modal components in `resources/js/packages/ui/src/TimeEntry/`: reuse for D-10 and for project/task/tag pickers.

### Established Patterns
- Ghost lane layout and layering in `OutlookGhostLayer.vue` / `ghostLayout.ts`.
- Server-side per-user dismissals keyed by occurrence id (Phase 3 D-07).

### Integration Points
- Time-entry deletion must re-surface the suggestion (link removal or lookup by existing entry).
- Calendar entry rendering (core `FullCalendarEventContent.vue`) for the Outlook icon — ledgered core touch.

</code_context>

<specifics>
## Specific Ideas

- Owner wording: "one button click para hacer el time entry de la entrada del outlook" — the conversion must be reachable directly from the meeting, without leaving the calendar.

</specifics>

<deferred>
## Deferred Ideas

None raised in this discussion.

</deferred>
