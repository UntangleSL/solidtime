# API Coverage — Microsoft Graph (calendar)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Phase 5 changes one external call: the Phase 3 `calendarView` read gains `attendees` in its `$select` (plan 05-03). The scope stays `Calendars.Read`. Everything else in this phase is internal: fork routes, the app's own time-entry create action and in-process scoring. Nothing is sent to an outside service (RULE-03).

| capability | decision | reason |
|---|---|---|
| calendarView read of the user's events in a window | INTEGRATE | |
| event attendees (address, name, type) | INTEGRATE | |
| event organizer address | INTEGRATE | |
| event body / bodyPreview | OPT-OUT | not needed: suggestions use people, domains and subject words only, and storing meeting bodies goes against D-09 data minimisation |
| event lastModifiedDateTime | OPT-OUT | not needed: the Graph docs say $select does not support it on calendarView, and DECISIONS-graph.md forbids depending on it |
| event location / rooms | OPT-OUT | not needed: rooms say nothing about the client (RESEARCH A2); resource attendees are skipped |
| event categories | OPT-OUT | not needed yet: could become a suggestion signal after the owner reviews the hit rate (D-16) |
| create, update or delete events; accept or decline | OPT-OUT | explicitly out of scope: least privilege, Calendars.Read only (PROJECT constraint) |
| calendarView delta queries | OPT-OUT | not needed yet: the Phase 3 window re-fetch design is unchanged |
| findMeetingTimes / getSchedule | OPT-OUT | explicitly out of scope |
| Claude API "propose my day/week" | OPT-OUT | deferred by the owner (D-01, PROD-05) until the history engine's hit rate is known |
