---
phase: 05-smart-meeting-suggestions
plan: 03
subsystem: microsoft365-graph-sync
tags: [graph, attendees, privacy, suggestions, D-09]
requires: []
provides:
  - "outlook_meetings.organizer_address / attendees (jsonb) / attendee_count"
  - "GraphCalendarClient::SELECT with attendees"
  - "App\\Microsoft365\\Suggestions\\MeetingSignalInput::fromMeeting() and identity()"
  - "OutlookMeetingSyncService::MAX_ATTENDEES = 50"
affects: [05-05, 05-09]
requirements-completed: [RULE-03]
status: complete
completed: 2026-11-17
key-files:
  created:
    - app/Microsoft365/database/migrations/2026_11_18_000002_add_attendees_to_outlook_meetings.php
    - app/Microsoft365/Suggestions/MeetingSignalInput.php
  modified:
    - app/Microsoft365/Models/OutlookMeeting.php
    - app/Microsoft365/Graph/GraphCalendarClient.php
    - app/Microsoft365/Graph/OutlookMeetingSyncService.php
    - tests/Unit/Microsoft365/GraphCalendarClientTest.php
    - tests/Feature/Microsoft365/OutlookMeetingSyncTest.php
    - docs/m365/DECISIONS-graph.md
decisions:
  - "Attendee list is written through upsert as json_encode (upsert bypasses model casts); the model casts it back to array"
  - "Attendee type is lower-cased; a missing type counts as 'required'; addresses longer than 320 chars are dropped"
  - "attendee_count counts kept (non-resource, with address) entries before the cap of 50; null when Graph sent no attendee list"
  - "identity() internal domains = allowedDomains() in config order, then the domain of each own address, deduplicated"
actuals:
  tokens: 8200
  tasks: 3
  commits: 3
plan_head_before: 1468222e0d2dc3d85d93c43b0785c199037fc33c
plan_head_after: 757a6f1ae5eeaac5a5d2275f339f5d3b82b5e470
---

# Phase 5 Plan 03: Attendees in the meeting cache Summary

The Graph calendarView `$select` now ends in `,attendees`. The sync stores, for the meeting owner only, the lower-cased organizer address, up to 50 `{address, name, type}` attendee entries (no response status, rooms and equipment skipped) and the real attendee count. A scrub, Disconnect or user deletion removes them, and the meetings read never serves them. `MeetingSignalInput` turns a cached meeting and its owner into the exact input that 05-02's `MeetingSignals::features()` expects.

## What was built

- **Migration `2026_11_18_000002`** adds `organizer_address` (string 320), `attendees` (jsonb) and `attendee_count` (integer) to `outlook_meetings`, all nullable. The docblock records D-09: owner-only data, purged on Disconnect and through the user cascade.
- **`OutlookMeeting`**: `attendees` is cast to `array` and `attendee_count` to `integer`. The `@property` lines are added, and the docblock says the data is personal data of the owner and is never serialized.
- **`GraphCalendarClient::SELECT`**: the Phase 3 string followed by `,attendees`. It still has no `body` and no `lastModifiedDateTime`.
- **`OutlookMeetingSyncService`**:
  - `buildRow()` maps the organizer address and calls the new `attendees()` helper (trim and lower-case, skip non-arrays, entries with no address and `resource` entries, count before the cap, cap at `MAX_ATTENDEES` = 50).
  - The `store()` upsert update list carries the three new columns.
  - `scrubIneligible()` sets the three columns to null in the same statement that clears subject, organizer name and link.
- **`MeetingSignalInput`** (stateless, takes `MicrosoftConfig` through the constructor):
  - `fromMeeting()` returns the 05-02 contract array. It skips stored entries that have no string address.
  - `identity()` returns `own`: `users.email` plus the linked Microsoft address, lower-cased and deduplicated. It also returns `internal`: the allowed domains plus each own address's domain, deduplicated.
- **Tests**:
  - Unit `test_select_adds_attendees_and_nothing_else`.
  - In `OutlookMeetingSyncTest`, the exact first-URL assertion is updated, and 6 new feature tests cover the stored attendees and organizer address, the scrub, the cap and room skipping, the Disconnect purge, the read allow-list (no keys and no `@example.test` in the body) and the adapter. The file now has 15 test methods (baseline 9).
- **`docs/m365/DECISIONS-graph.md`**: the Phase 3 sentence now says that `body` and `lastModifiedDateTime` stay out and that `attendees` was added in Phase 5. A new subsection, "### Phase 5: attendees for suggestions (D-09)", sits inside "## Corrections to earlier research". It covers the new `$select`, the reason, the evidence (the existing experiment-select claim and fixture), the storage rules and the HMAC/APP_KEY note. No new `Claim:` lines were added (66 before, 66 after).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | d9c432b2 | feat(05-03): keep organizer address and minimal attendees in the meeting cache |
| 2 | 6c95be40 | feat(05-03): scrub, purge and hide attendee data; signal input adapter |
| 3 | 757a6f1a | docs(05-03): record the Phase 5 $select and attendee storage rules (D-09) |

## Gates

- **Gate U**: `GraphCalendarClientTest` passes (41 tests). Running all of `tests/Unit/Microsoft365` gives 129 tests with 12 failures, all in `SocialiteMicrosoftGatewayTest` ("a boolean is an instance of OpenSSLAsymmetricKey"). The portable PHP cannot generate an OpenSSL key on this host. This is environmental, the failures are unrelated to this plan's files, and that test file was not touched.
- **Gate P**: Pint `--test` passes on `app/Microsoft365` and both test files. Full-app PHPStan reports `[OK] No errors`. It was run with the worktree-first `--autoload-file` loader.
- **Docs gates**: `decisions: OK (48 checks)` and `secrets: OK (2152 checks)`.
- **Feature tests**: the `OutlookMeetingSyncTest` additions are syntax-checked (`php -l`) but need Postgres, so they run only in CI.

## Deviations from Plan

- **Doc placement.** The new docs section is a `###` subsection placed after the Phase 3 Claim lines, inside "## Corrections to earlier research". It is not a new `##` section, because the decisions gate requires every `##` decision section to have Decision and Evidence lines. The amended sentence points to "the Phase 5 subsection below" rather than repeating the heading text, so the acceptance grep for the heading counts exactly 1.
- **Stronger lower-case test.** `test_sync_stores_attendees_and_the_organizer_address` makes the S1b organizer and one attendee address mixed-case before replay, so the test really proves lower-casing. The recorded fixture is already lower-case.

Otherwise the plan was executed as written.

## Notes for dependent plans

- jsonb does not keep object key order. `OutlookMeeting::$attendees` entries come back with keys in jsonb order. `MeetingSignalInput::fromMeeting()` rebuilds each entry as `address, name, type`, so consumers should use the adapter rather than the raw cast.
- `MeetingSignals` (05-02) is not referenced here. The adapter only produces the input array.

## Threat Flags

None. No new endpoints or log lines; scopes unchanged.

## Self-Check: PASSED

- FOUND: app/Microsoft365/database/migrations/2026_11_18_000002_add_attendees_to_outlook_meetings.php
- FOUND: app/Microsoft365/Suggestions/MeetingSignalInput.php
- FOUND commits: d9c432b2, 6c95be40, 757a6f1a (ancestors of HEAD)
