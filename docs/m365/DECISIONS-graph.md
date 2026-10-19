# Microsoft Graph calendar decisions (Phase 1 spike)

Written for the developers and planners of Phases 3 to 6 (decision D-06, requirement SETUP-03).

This document says how Outlook meetings look in Microsoft Graph `calendarView` and which keys and
rules the sync should use. Every decision cites the sanitized fixtures recorded in Phase 1.

## How to read this document

- Capture: Round A on 2026-10-19 (16:27 UTC) and Round B on 2026-10-19 (17:04 UTC), roughly 37 minutes
  apart, with the scenario events changed in Outlook in between. Window: 2026-10-19 to 2026-11-16.
  Outlook client: web. Mailbox time zone: Romance Standard Time (Europe/Madrid).
- Test users: user A is the mailbox read by the harness; user B organizes the meetings that A attends.
  Both are Members of the Untangle tenant.
- Every request sent `Authorization` and `Prefer: outlook.timezone="UTC", IdType="ImmutableId"` unless
  the experiment says otherwise. All times below are UTC unless marked local.
- Every `Claim:` line is machine-checked against the fixture manifest by
  `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace`. A claim that stops matching, a cited
  path that does not exist and a captured scenario that nobody cites each fail the gate.
- Facts that the manifest cannot check (for example the exact `start` of an edited occurrence) are quoted
  from the sanitized fixture files named in the `Evidence:` line.
- `SYN-*` fixtures are synthetic: derived copies with a changed field, never captured from Outlook.
- Optional scenarios E1 (single occurrence cancelled), E2 ("this and following" edit), E3 (tentative),
  E4 (no response), E5 (overnight event), E6 (second decline) and S7b (two-day all-day event) were not
  captured. Each section says where that leaves a gap. Missing means untested, not "works".
- Anything that is only documentation or only reported by the project owner is labelled as such and is not
  a gated claim.

## Occurrence key

Observed. With `Prefer: IdType="ImmutableId"` every occurrence of the weekly series S2 has its own `id`
(four different ids). The id of each occurrence was identical in Round A and Round B, including the
occurrence that user B edited in between (it changed from `type=occurrence` to `type=exception`, its title
and its start; its `originalStart` stayed `2026-11-03T09:00:00Z`). The moved single meeting S5 also kept its
id. Immutable ids are 68 to 84 characters; default ids are 152 to 168 characters; none of the 14 compared
events had the same value in both formats.

`iCalUId` is not an occurrence key here: the four S2 occurrences carry four different `iCalUId` values, and
the series master carries a fifth. It is stable per event across the two rounds. In `full-shape` captures
(no `$select`) occurrences also carry `occurrenceId` of the form `OID.<seriesMasterId>.<original date>`, and
the exception kept the original date (2026-11-03) after it moved.

Decision: the occurrence key is the immutable Graph `id` (always request `Prefer: IdType="ImmutableId"`),
unique per user mailbox. Store it in a `varchar(255)` column (observed maximum 84, default-format maximum
168) and `rawurlencode` it in URL paths, because the charset includes `=`. For recurring events also store
`series_master_id` and `original_start` as a secondary natural key `(series_master_id, original_start)`;
that pair survived the edit of S2 and is the fallback if an id ever stops being stable.

Limits of this evidence: stability was observed across edits and moves inside one calendar for about 37
minutes. Survival across a "this and following" edit (E2) and across moves between mailbox folders was not
tested; Phase 5 re-checks the former, and the latter relies on Microsoft's documented ImmutableId guarantee.

Evidence: `tests/Fixtures/M365/scenarios/S2.roundA.json`, `tests/Fixtures/M365/scenarios/S2.roundB.json`, `tests/Fixtures/M365/calendarview/roundB.prod-select.page-14.json`, `tests/Fixtures/M365/scenarios/S5.roundB.json`, `tests/Fixtures/M365/calendarview/roundA.id-format.json`, `tests/Fixtures/M365/calendarview/roundB.id-format.json`

Claim: S2.round_a.count = 4
Claim: S2.round_b.count = 4
Claim: S2.round_b.id_equal = true
Claim: S5.round_b.id_equal = true
Claim: experiments.id_format.immutable.min_length = 68
Claim: experiments.id_format.immutable.max_length = 84
Claim: experiments.id_format.default.min_length = 152
Claim: experiments.id_format.default.max_length = 168
Claim: experiments.id_format.immutable.charset = A-Za-z0-9-=_
Claim: experiments.id_format.same_value_count = 0
Claim: experiments.id_format.different_value_count = 14

## Series key

Observed. All four occurrences of S2 (Round A) and all four in Round B, including the edited exception, carry
the same `seriesMasterId`, and that value equals the `id` of the series master fetched with
`GET /me/events/{id}`. The master has `type=seriesMaster`, a weekly Tuesday `recurrence` with
`recurrenceTimeZone` Romance Standard Time, and an empty `cancelledOccurrences` list in both rounds
(E1 was not captured, so no cancelled occurrence has been seen there). Single meetings return
`seriesMasterId` and `originalStart` as `null`. Occurrences return `recurrence` as `null`, so the pattern
is only available from the master.

Alternatives considered:

- `iCalUId` of the occurrence: different for every occurrence (see Occurrence key), so it cannot group a
  series.
- `iCalUId` of the master: the master's value is not returned on occurrences, so using it would need an
  extra Graph call per series.
- Subject: users edit it (S2 round B added "(edited)").

Decision: the series key is `seriesMasterId` (immutable-id format). Phase 5 keys series rules on it, stores
nothing else about the series, and treats `type in {occurrence, exception}` as "belongs to a series". If a
series master is later gone (`GET` returns 404) or a "this and following" split creates a new master (E2
not captured, behaviour unknown), the rule becomes orphaned: keep it visible to the user, do not delete it
and do not auto-apply it to another series.

Evidence: `tests/Fixtures/M365/series/S2.master.roundA.json`, `tests/Fixtures/M365/series/S2.master.roundB.json`, `tests/Fixtures/M365/series/S2.instances.roundA.json`, `tests/Fixtures/M365/series/S2.instances.roundB.json`, `tests/Fixtures/M365/scenarios/S2.roundA.json`, `tests/Fixtures/M365/scenarios/S2.roundB.json`

Claim: S2.round_a.present = true
Claim: S2.round_b.present = true
Claim: S2.round_b.lookup.status = 200
Claim: S2.round_b.lookup.isCancelled = false

## Cancelled meetings

Observed. S3 was cancelled by its organizer (B) and the cancellation message was not processed by A. In
Round B the event is still in the calendarView with the same id, `isCancelled=true`, `responseStatus`
still `accepted`, and its subject now starts with `Canceled: `. A direct lookup also returns 200 with
`isCancelled=true`. So an unprocessed cancellation does not remove the meeting from the attendee's calendar.
What happens once the attendee processes the cancellation (the event is deleted from the calendar) was not
captured; the closest captured case is S4, where the event is removed and the lookup is 404.

Decision: SYNC-03 excludes every event with `isCancelled=true`; never detect cancellation from the
subject prefix. For Phase 6, "cancelled" means either `isCancelled=true` in a window or lookup 200 with
`isCancelled=true`; "removed" means lookup 404 `ErrorItemNotFound`; do not assume that an absent event was
cancelled (see Moved meetings).

Evidence: `tests/Fixtures/M365/scenarios/S3.roundA.json`, `tests/Fixtures/M365/scenarios/S3.roundB.json`, `tests/Fixtures/M365/lookups/S3.roundB.json`

Claim: S3.round_a.present = true
Claim: S3.round_b.present = true
Claim: S3.round_b.id_equal = true
Claim: S3.round_b.lookup.status = 200
Claim: S3.round_b.lookup.isCancelled = true
Claim: S3.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, isCancelled=true, sensitivity=normal); direct lookup 200 (isCancelled=true).

## Declined meetings

Observed. S4 was declined by A with the response sent to the organizer. In Round B the event is gone from
the calendarView and a direct lookup by the Round A id returns 404 `ErrorItemNotFound`. No
`responseStatus.response=declined` was ever seen in a calendarView in this capture. A decline that is kept
in the calendar without sending a response (E6) was not captured.

Decision: SYNC-03 (revised 2026-10-19) excludes declined meetings, and Graph already does that for Phase 3: a
normal decline simply makes the meeting disappear from the calendarView. Phase 3 may still skip
`responseStatus.response=declined` defensively in case Outlook ever returns that value, but it must not
rely on that filter. For Phase 6 a declined meeting is
indistinguishable from a deleted one (both are 404), so a linked time entry is flagged as "removed in
Outlook", not as "declined".

Evidence: `tests/Fixtures/M365/scenarios/S4.roundA.json`, `tests/Fixtures/M365/lookups/S4.roundB.json`

Claim: S4.round_a.present = true
Claim: S4.round_b.present = false
Claim: S4.round_b.count = 0
Claim: S4.round_b.id_equal = null
Claim: S4.round_b.lookup.status = 404
Claim: S4.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: absent from calendarView; direct lookup 404 (ErrorItemNotFound).

## Moved meetings

Observed. S5 was moved by its organizer by one hour the same day (start 09:00 to 10:00 UTC on 2026-10-30,
10:00 to 11:00 local). It kept its id and its `iCalUId`, appears in the same window with the new times, and
its `responseStatus` changed from `accepted` to `notResponded`: an organizer update resets the attendee's
response. The edited S2 occurrence behaved the same way (its response went from `accepted` to
`notResponded`).

S5b was moved out of the capture window. In Round B it is absent from the calendarView, but a direct
lookup by the Round A id returns 200 with `isCancelled=false`, so the id is still valid. The lookup fixture
stores only the status, not the new start.

Decision: a meeting that is missing from a window is not cancelled. Phase 6 must confirm every missing id
with `GET /me/events/{id}` (same `Prefer` header) before flagging anything: 200 with `isCancelled=false`
means moved (compare `start`/`end` with the stored values; outside the window is still "moved"); 200 with
`isCancelled=true` means cancelled; 404 means removed; any other status (401, 429, 5xx) means unknown and
never flags (OSYNC-02). Because a move resets `responseStatus` to `notResponded`, the pre-2026-10-19
SYNC-03 (accepted or organizer only) would have dropped every rescheduled meeting from the import list and
made it look like a removal. The owner revised SYNC-03 so that `notResponded` meetings are shown as
suggestions (see Eligibility signals), which closes that gap: a rescheduled meeting stays visible. A
meeting linked to a time entry is still matched by id, not by the eligibility rules, so that a linked
meeting that later becomes private or cancelled is detected as a change instead of silently disappearing.

Evidence: `tests/Fixtures/M365/scenarios/S5.roundA.json`, `tests/Fixtures/M365/scenarios/S5.roundB.json`, `tests/Fixtures/M365/lookups/S5.roundB.json`, `tests/Fixtures/M365/scenarios/S5b.roundA.json`, `tests/Fixtures/M365/lookups/S5b.roundB.json`

Claim: S5.round_b.present = true
Claim: S5.round_b.lookup.status = 200
Claim: S5.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: present (type=singleInstance, isOrganizer=false, responseStatus=notResponded, sensitivity=normal); direct lookup 200 (isCancelled=false).
Claim: S5b.round_a.present = true
Claim: S5b.round_b.present = false
Claim: S5b.round_b.lookup.status = 200
Claim: S5b.round_b.lookup.isCancelled = false
Claim: S5b.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: absent from calendarView; direct lookup 200 (isCancelled=false).

## Private meetings

Observed. On the organizer's own copy of S6 (user A organizes and marks it Private) Graph returns
`sensitivity=private`, and the subject is not masked. `sensitivity` is returned as long as it is in the
`$select`. S6b was meant to cover the attendee's copy of a private meeting, but the owner did not mark it
Private by mistake, so its `sensitivity=normal` says nothing about the attendee side (see the owner-reported
notes at the end). The values `confidential` and `personal` cannot be created in this Outlook client, so
`SYN-confidential` and `SYN-personal` are synthetic copies of S6 that only exist to test the filter.

Decision: import only meetings whose `sensitivity` is `normal`. SYNC-03 names private and confidential;
`personal` is also excluded until the product owner says otherwise (fail closed). `sensitivity` must be in
the production `$select`, and the filter runs before anything is stored, so a private meeting's subject is
never persisted.

Evidence: `tests/Fixtures/M365/scenarios/S6.roundA.json`, `tests/Fixtures/M365/scenarios/S6.roundB.json`, `tests/Fixtures/M365/scenarios/S6b.roundA.json`, `tests/Fixtures/M365/scenarios/S6b.roundB.json`, `tests/Fixtures/M365/scenarios/SYN-confidential.json`, `tests/Fixtures/M365/scenarios/SYN-personal.json`

Claim: S6.round_a.present = true
Claim: S6.round_b.present = true
Claim: S6.observed = Round A: present (type=singleInstance, isOrganizer=true, responseStatus=organizer, sensitivity=private, attendeesOtherThanOrganizer=1). Round B: present (type=singleInstance, isOrganizer=true, responseStatus=organizer, sensitivity=private, attendeesOtherThanOrganizer=1); direct lookup 200 (isCancelled=false).
Claim: S6b.round_a.present = true
Claim: S6b.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal); direct lookup 200 (isCancelled=false).

## All-day events

Observed. S7 (created by user A with "All day") has `isAllDay=true`. Under
`Prefer: outlook.timezone="UTC"` it comes back as `start` 2026-11-04T00:00:00 and `end`
2026-11-05T00:00:00, both with `timeZone` UTC, so it spans exactly 24 hours from UTC midnight. The Round B
copy is identical. A timed event can also last 24 hours, so the duration alone does not identify an all-day
event. The two-day all-day event (S7b) and the overnight timed event (E5) were not captured.

Decision: exclude on `isAllDay=true` (SYNC-03). Do not infer all-day from midnight-to-midnight times or from
the duration. `isAllDay` must be in the production `$select`.

Evidence: `tests/Fixtures/M365/scenarios/S7.roundA.json`, `tests/Fixtures/M365/scenarios/S7.roundB.json`

Claim: S7.round_a.present = true
Claim: S7.round_b.present = true
Claim: S7.observed = Round A: present (type=singleInstance, isOrganizer=true, responseStatus=none, isAllDay=true, sensitivity=normal, attendeesOtherThanOrganizer=0). Round B: present (type=singleInstance, isOrganizer=true, responseStatus=none, isAllDay=true, sensitivity=normal, attendeesOtherThanOrganizer=0); direct lookup 200 (isCancelled=false).

## Eligibility signals

Observed `isOrganizer` and `responseStatus.response` pairs:

- Attendee who accepted (S1, S2 occurrences, S6b): `isOrganizer=false`, `accepted`.
- Organizer of a meeting with another attendee (S1b, S6): `isOrganizer=true`, `organizer`.
- Organizer of an event with no other attendee (S7 all-day, S8 personal block): `isOrganizer=true`,
  `none`, and `attendees` has one entry (the organizer himself, `attendeesOtherThanOrganizer=0`). The
  playbook hypothesis (`attendees=[]` and `responseStatus=organizer`) was wrong on both counts.
- After an organizer update (S5, S2 exception in Round B): `isOrganizer=false`, `notResponded`.
- `tentativelyAccepted`, `none` for invited attendees and `declined` were not captured (E3, E4 and E6 are
  missing). The `tentativelyAccepted` spelling comes from the Microsoft Graph documentation, not from a
  fixture.

Decision: SYNC-03 was revised by the product owner on 2026-10-19 (REQUIREMENTS.md and PROJECT.md, commit
6ecb6da0): every timed meeting is a suggestion regardless of `responseStatus.response` (`organizer`,
`accepted`, `tentativelyAccepted`, `notResponded`, `none`). The response is therefore not an eligibility
signal at all. The only exclusions, each backed by a fixture, are: declined (Graph removes the event, S4),
cancelled (`isCancelled=true`, S3), all-day (`isAllDay=true`, S7) and private or confidential
(`sensitivity` other than `normal`, S6). Eligible means `isCancelled=false`, `isAllDay=false` and
`sensitivity=normal`. This is also what keeps a meeting visible after an organizer reschedule, which resets
the response to `notResponded` (S5). Organizer-only blocks (S8) are timed events and need no special case;
`isOrganizer` stays available as a display or labelling signal, never as a filter, and nothing may rely on
`responseStatus.response == organizer`, which Graph does not return for personal blocks. `attendees` is not
needed to detect any of these cases.

Evidence: `tests/Fixtures/M365/scenarios/S1.roundA.json`, `tests/Fixtures/M365/scenarios/S1b.roundA.json`, `tests/Fixtures/M365/scenarios/S5.roundB.json`, `tests/Fixtures/M365/scenarios/S8.roundA.json`, `tests/Fixtures/M365/scenarios/S8.roundB.json`, `tests/Fixtures/M365/scenarios/S6b.roundA.json`

Claim: S1.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal); direct lookup 200 (isCancelled=false).
Claim: S5.round_b.present = true
Claim: S5.observed = Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, sensitivity=normal). Round B: present (type=singleInstance, isOrganizer=false, responseStatus=notResponded, sensitivity=normal); direct lookup 200 (isCancelled=false).
Claim: S1b.observed = Round A: present (type=singleInstance, isOrganizer=true, responseStatus=organizer, sensitivity=normal, attendeesOtherThanOrganizer=1). Round B: present (type=singleInstance, isOrganizer=true, responseStatus=organizer, sensitivity=normal, attendeesOtherThanOrganizer=1); direct lookup 200 (isCancelled=false).
Claim: S8.round_a.present = true
Claim: S8.round_b.present = true
Claim: S8.observed = Round A: present (type=singleInstance, isOrganizer=true, responseStatus=none, sensitivity=normal, attendeesOtherThanOrganizer=0). Round B: present (type=singleInstance, isOrganizer=true, responseStatus=none, sensitivity=normal, attendeesOtherThanOrganizer=0); direct lookup 200 (isCancelled=false).

## Time zone and DST

Observed. The weekly series S2 is at 10:00 local time every Tuesday. Europe/Madrid left summer time on
2026-10-25, and the UTC start of the occurrences moved with it: 08:00 UTC on 2026-10-20 (UTC+2), then
09:00 UTC on 2026-10-27, 2026-11-03 and 2026-11-10 (UTC+1). The master's `recurrence` carries
`recurrenceTimeZone` Romance Standard Time and the events carry `originalStartTimeZone` Romance Standard
Time. The edited occurrence on 2026-11-03 starts at 10:00 UTC, which is 11:00 local.

Both header forms were accepted: one `Prefer` header with both preferences, and two separate `Prefer`
headers (the harness sent the two lines as two headers). Every page of both passes returned `start` and
`end` with `timeZone` UTC.

Decision: Phase 3 sends one combined header, `Prefer: outlook.timezone="UTC", IdType="ImmutableId"`, which is
also what a Laravel `Http::withHeaders` call produces. Store instants as UTC, convert to the user's
time zone only when displaying (SYNC-04), and never derive an occurrence time from the previous occurrence
or from the master's `start`: the UTC offset of a series changes across DST while its local time does not.
Let Graph expand recurrences; do not evaluate recurrence rules in PHP.

Evidence: `tests/Fixtures/M365/scenarios/S2.roundA.json`, `tests/Fixtures/M365/scenarios/S2.roundB.json`, `tests/Fixtures/M365/series/S2.master.roundA.json`, `tests/Fixtures/M365/calendarview/roundA.prod-select.requests.json`, `tests/Fixtures/M365/calendarview/roundA.prefer-separate.requests.json`

Claim: experiments.prefer_combined.status = 200
Claim: experiments.prefer_combined.utc_on_all_pages = true
Claim: experiments.prefer_separate.status = 200
Claim: experiments.prefer_separate.utc_on_all_pages = true

## ImmutableId and nextLink

Observed. The capture used `$top=3` to force paging: the window holds 65 events (63 in Round B) over 22 pages
(21 in Round B), and the `@odata.nextLink` of each page continues with `$skip`. A second pass requested page
1 with both preferences and page 2 without any `Prefer` header: page 2 still returned status 200 and
`timeZone` UTC, but all 3 events on it had different ids from the same events fetched with
`IdType="ImmutableId"` (0 equal, 3 different). The UTC result proves nothing about time zones, because UTC is
also Graph's default; the id result proves that the `IdType` preference is not carried by the `nextLink`.
A pass without `IdType` returned the long default ids for all 14 compared events (different in all 14).
For the default ids of the 12 tagged events present in both rounds, Round A and Round B values were also
equal, so within one calendar a move or an edit did not change them either; immutability matters for moves
between folders, which was not tested.

Decision: send `Authorization` and the combined `Prefer` header on every request, including every
`nextLink` request, and use each `nextLink` verbatim without rebuilding or editing it. A page fetched
without `Prefer` can silently return ids in the default format and corrupt the stored keys. In Phase 3 tests,
assert that every page request, not only the first one, carries the header (the PHPUnit replay in
`tests/Unit/M365/CalendarViewFixturesTest.php` already iterates complete page sequences). Set `$top`
explicitly; the capture proved `$top=3` paging works, and Phase 3 should use `$top=100` and stop after a
fixed number of pages.

Evidence: `tests/Fixtures/M365/calendarview/roundA.page2-no-prefer.requests.json`, `tests/Fixtures/M365/calendarview/roundA.page2-no-prefer.page-2.json`, `tests/Fixtures/M365/calendarview/roundA.prod-select.requests.json`, `tests/Fixtures/M365/calendarview/roundA.no-immutableid.requests.json`, `tests/Fixtures/M365/calendarview/roundA.id-format.json`, `tests/Fixtures/M365/calendarview/roundA.no-immutableid.page-11.json`, `tests/Fixtures/M365/calendarview/roundB.no-immutableid.page-11.json`

Claim: experiments.page2_without_prefer.status = 200
Claim: experiments.page2_without_prefer.page2_timezones = ["UTC"]
Claim: experiments.page2_without_prefer.page2_ids_equal_to_combined.equal = 0
Claim: experiments.page2_without_prefer.page2_ids_equal_to_combined.different = 3
Claim: experiments.id_format.same_value_count = 0
Claim: experiments.id_format.different_value_count = 14

## Calendars.ReadBasic (informational)

Documentation-based, not tested live: no token with this scope was requested, because it would need an
extra consent on the registration. Microsoft Learn lists `Calendars.ReadBasic` as a delegated permission that
reads events "except for properties such as body, attachments, and extensions", and as the least privileged
permission for `calendarView`. The production `$select` below contains none of those properties, so
`Calendars.ReadBasic` would probably be enough. That is a guess: nobody has checked that `attendees`,
`responseStatus`, `seriesMasterId` or `originalStart` survive under it, and the project must not depend on it.

Decision: keep `Calendars.Read`, as PROJECT.md decided. Re-read the permissions reference and test a
`Calendars.ReadBasic` token against these fixtures before ever proposing the change.

Evidence: https://learn.microsoft.com/en-us/graph/permissions-reference and https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview (documentation only), and the fields the sync needs in `tests/Fixtures/M365/calendarview/roundA.prod-select.requests.json`

## Corrections to earlier research

Two assumptions from the earlier research did not hold, and a third playbook hypothesis was wrong.

1. `lastModifiedDateTime` in `$select`. `STACK.md` listed it; the Graph documentation says
   `createdDateTime` and `lastModifiedDateTime` do not support `$select` on calendarView. The experiment
   settled it for this tenant on 2026-10-19: a pass that added `lastModifiedDateTime` and `attendees` to the
   `$select` returned 200 and returned both properties; the production `$select` (without them) returned
   neither. So the service accepts it today, against the documentation. Without `$select`, the full event
   shape also contains `lastModifiedDateTime` and `createdDateTime`.
2. `attendees(count only)`. `PITFALLS.md` proposed it. Graph `$select` has no count projection and the harness
   never sent that syntax (documentation-based). Selecting plain `attendees` returns the full list with every
   attendee, which is personal data the sync does not need.
3. Personal blocks (S8) do not come back with `attendees=[]` and `responseStatus=organizer` (see Eligibility
   signals); `isOrganizer=true` is the reliable signal.

Production `$select` for Phase 3, the exact string used by the successful production-shaped capture:

`id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting`

`originalStart` is required for the secondary occurrence key: it is returned only when selected (the
full-shape pass without `$select` has no `originalStart` on any event). Add no `body`, no `attendees`
and no `lastModifiedDateTime`: eligibility and the keys do not need them, and `lastModifiedDateTime`
works against the documentation, so nothing may depend on it. If Phase 3 ever wants change detection,
compare stored fields with the fetched ones instead.

Request settings: `GET /me/calendarView?startDateTime=...&endDateTime=...&$select=...&$orderby=start/dateTime&$top=100`,
`Prefer: outlook.timezone="UTC", IdType="ImmutableId"` on every request including every `nextLink`.

Decision: replace the `$select` in `STACK.md` section 6 and the `attendees(count only)` suggestion in
`PITFALLS.md` pitfall 11 with the string above when Phase 3 starts. Both files carry a pointer to this section.

Evidence: `tests/Fixtures/M365/calendarview/roundA.prod-select.requests.json`, `tests/Fixtures/M365/calendarview/roundA.experiment-select.requests.json`, `tests/Fixtures/M365/calendarview/roundA.full-shape.requests.json`, `tests/Fixtures/M365/scenarios/S8.roundA.json`, `tests/Fixtures/M365/calendarview/roundB.prod-select.page-14.json`

Claim: experiments.select_prod.status = 200
Claim: experiments.select_prod.lastModifiedDateTime_returned = false
Claim: experiments.select_prod.attendees_returned = false
Claim: experiments.select_experiment.status = 200
Claim: experiments.select_experiment.lastModifiedDateTime_returned = true
Claim: experiments.select_experiment.attendees_returned = true

## Owner-reported observations (not fixture-backed)

These were reported by the project owner while creating the scenarios. They are not covered by any fixture
and are not inputs to the decisions above.

- Private meetings: the owner saw that S6 (organized by A, marked Private) also appears as Private in the
  calendar of attendee B, so sensitivity seems to propagate to attendees. The recorded S6b fixture cannot
  confirm this, because it was not marked Private (an owner mistake). Phase 3 should still apply the
  `sensitivity` filter to attendee copies and test it with a captured fixture if the behaviour matters.
- Personal blocks: for S7 and S8 the owner confirmed what the fixtures show, an organizer-only event
  (`attendeesOtherThanOrganizer=0`).
