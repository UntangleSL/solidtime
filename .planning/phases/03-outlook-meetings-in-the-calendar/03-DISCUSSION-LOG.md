# Phase 3: Outlook Meetings in the Calendar - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-05
**Phase:** 03-outlook-meetings-in-the-calendar
**Areas discussed:** Overlap with logged time, Future meetings, Ghost block detail, Calendar without Microsoft connection

---

## Overlap with logged time

| Option | Description | Selected |
|--------|-------------|----------|
| Show anyway | Always appears; user dismisses if needed | ✓ |
| Show dimmed | Fainter when the slot already has a time entry | |
| Hide | Not suggested if the slot is covered | |

**User's choice:** Show anyway (recommended)

## Future meetings

| Option | Description | Selected |
|--------|-------------|----------|
| All in range | Past and future, same style | ✓ |
| Only until now | Only meetings that already started | |

**User's choice:** All in range (recommended)

## Ghost block detail

| Option | Description | Selected |
|--------|-------------|----------|
| Detail panel | Subject, time, organizer, location/Teams, Dismiss; Phase 4 adds Assign | ✓ |
| Block only | Title and time; dismiss from context menu | |

**User's choice:** Detail panel (recommended)

## Calendar without Microsoft connection

| Option | Description | Selected |
|--------|-------------|----------|
| Discreet prompt | Small "Connect Microsoft 365" next to Sync | ✓ |
| Nothing | Connect only from the profile | |

**User's choice:** Discreet prompt (recommended)

---

## Claude's Discretion

- DB cache vs live fetch, debounce/reuse window, timeouts, page cap
- Ghost visual, panel layout, show-dismissed toggle placement, status wording
- Wiring of the ghost layer into the calendar components

## Deferred Ideas

- Hide/dim meetings already covered by logged time
- Skip `showAs=free` (v2 PROD-04); background sync (v2 SYNC2-01)
