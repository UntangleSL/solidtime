---
phase: 03-outlook-meetings-in-the-calendar
plan: 09
subsystem: calendar-ui
tags: [outlook, dismiss, popover, optimistic-update, a11y, vue, laravel, reka-ui]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: outlook_meetings.dismissed_at excluded from the sync upsert (03-01), scoped OutlookMeetingController::index and OutlookMeetingResource (03-04), ghost layer (03-06), useOutlookMeetings with the toolbar controls and live region (03-07), connect_url and notice on the calendar prop (03-08)
provides:
  - POST /m365/meetings/{meeting}/dismiss (microsoft.meetings.dismiss) and DELETE /m365/meetings/{meeting}/dismiss (microsoft.meetings.restore), uuid-constrained, scoped to the session user, idempotent, 404 for foreign, unknown, invalid or gone ids
  - GET /m365/meetings include_dismissed (boolean, 422 otherwise); gone meetings never returned
  - OutlookGhostDetail.vue extendable detail popover (slots meta, actions, footer-note; emits dismiss and restore; no network code)
  - safeHttpsUrl (https-only link allow-list), dismissMeeting (meetingsApi)
  - composable dismiss (optimistic, rollback with the documented error notification), canAct, announcement
affects: [03-10, 03-11, 04-assign-to-project, 05-series-actions]

actuals:
  tokens: 13100
  tasks: 3
  commits: 6
  plan_head_before: 8062bde251552c65a4b2b28f8cea72c3e33e3dbc
  plan_head_after: cffb0d323e4d443bdf1d54d6bf9aef079161f896

tech-stack:
  added: []
  patterns:
    - "Plain string route value plus an explicit user-scoped query for ownership: a foreign id is a 404, never a 403 existence oracle"
    - "Synchronous optimistic cache removal (cancelQueries not awaited) so focus can move after one tick; rollback re-inserts only the removed meeting"
    - "Live-region text cleared then set on nextTick so the same announcement is read twice in a row"
    - "Untrusted URL allow-list in a plain TS module (not an SFC export, which plain tsc cannot resolve)"

key-files:
  created:
    - resources/js/m365/calendar/OutlookGhostDetail.vue
    - resources/js/m365/calendar/OutlookGhostDetail.test.ts
    - resources/js/m365/calendar/safeUrl.ts
    - tests/Feature/Microsoft365/OutlookMeetingDismissTest.php
  modified:
    - app/Microsoft365/routes/microsoft365.php
    - app/Microsoft365/Http/Controllers/OutlookMeetingController.php
    - app/Microsoft365/Http/Requests/MeetingRangeRequest.php
    - resources/js/m365/calendar/meetingsApi.ts
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - resources/js/m365/calendar/OutlookGhostLayer.vue
    - resources/js/m365/calendar/OutlookGhostLayer.test.ts
    - resources/js/m365/calendar/OutlookCalendarControls.vue
    - resources/js/m365/calendar/OutlookCalendarControls.test.ts
    - e2e/outlook-ghosts.spec.ts
    - tests/Feature/Microsoft365/MicrosoftCalendarConnectTest.php

key-decisions:
  - "Dismiss and restore take the meeting id as a plain string (no implicit model binding) and look it up inside the session user's non-gone rows, so every foreign, unknown, invalid or gone id is the same 404"
  - "Dismiss sets dismissed_at only when null (the first timestamp is kept) and restore clears it only when set; neither deletes a row nor touches a time entry"
  - "The ghost is the PopoverTrigger (as-child), so Reka supplies aria-haspopup, aria-expanded and data-state; the accent ring is data-[state=open]; Enter and Space call click() on the ghost div"
  - "Only one panel is open at a time (openId in the layer); dismissing closes it, then focus moves to the next ghost of the day (the previous one for the last), else to the Sync button"
  - "canAct is false in test-hook mode (injected meetings are not server rows), so the panel shows no action there"
  - "visibleCount keeps excluding dismissed meetings; the show-dismissed toggle (03-10) must revisit it together with include_dismissed"

patterns-established:
  - "Detail panel as an extension point: Phases 4 and 5 fill meta, actions and footer-note without touching the panel"

requirements-completed: []

duration: ~3h including four CI cycles
completed: 2026-11-10
status: complete
---

# Phase 3 Plan 09: Ghost detail panel and dismiss Summary

Every ghost opens a non-modal detail popover (eyebrow, subject, time row, organizer, online flag, https-only "Open in Outlook", empty extension slots) and can be dismissed per occurrence: optimistic removal with a documented rollback, persisted server-side, preserved by every re-sync, with the restore endpoint and the opt-in `include_dismissed` read ready for 03-10.

## What was built

- **Backend (Task 1 and 2):** `dismiss` and `restore` on `OutlookMeetingController`, routes with `whereUuid('meeting')` and `throttle:60,1,m365-dismiss:` inside the existing `/m365` web group (session plus CSRF, never under `api/`). `MeetingRangeRequest` gained `include_dismissed`; `index` drops its `whereNull('dismissed_at')` only when it is true. The sync upsert still never lists `dismissed_at`.
- **Panel (Task 1 and 3):** `OutlookGhostDetail.vue` (`w-80`, side right, align start, side offset 8), labelled by its subject, `line-clamp-3 break-words`, time row with both dates across midnight, organizer row ("You are the organizer" or "Organized by :name"), online row, link row through `safeHttpsUrl` with `target="_blank"`, `rel="noopener noreferrer"` and a visually hidden "(opens in a new tab)", Separator, footer with Dismiss or Restore when `canAct`. No location, address, attendees or body.
- **Layer and composable (Task 1 and 3):** each ghost wraps in the panel; Enter and Space open it; dismiss is optimistic, rolls back with `addNotification('error', dismiss_failed, retry_body)`, announces "Meeting dismissed" in the controls' polite live region, and moves focus as described above. No success toast and no confirmation dialog.
- **Browser proof:** the 03-06 "opens no create-time-entry dialog" test became "clicking a ghost opens the Outlook detail panel and never the create dialog" (dialog contains the subject, no "No Project" button, Esc closes it, the drag path never opens the create dialog).

## Verification

- Local: Gate F (Vitest 131 tests, vue-tsc, plain tsc, eslint, prettier), Pint, full-app PHPStan, `playwright test --list` (5 tests).
- CI (combined gate for 03-08 + 03-09, pushed HEAD `cffb0d32`): nine workflows printed exactly `NPM Build=success;NPM Format Check=success;NPM Lint=success;NPM Test Unit=success;NPM Typecheck=success;PHP Linting=success;PHPUnit Tests=success;Playwright Tests=success;Static code analysis (PHPStan)=success`.
- Gate B (PHPUnit log, 3 Postgres jobs): OutlookMeetingDismissTest 3, OutlookMeetingEndpointTest 3, MicrosoftCalendarConnectTest 3, OutlookCalendarPropTest 3, MicrosoftAccountTest 3, MicrosoftSessionTest 3 = 18.
- Acceptance greps: dismiss route 1, restore route 1, `whereUuid('meeting')` present, no `->delete()` or `::destroy(` in the controller, 8 test methods in OutlookMeetingDismissTest, slot names and `rel` 1 each, `javascript:` in the panel test 2, no `v-html` in `resources/js/m365`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reka overrides `aria-labelledby` on the popover content**
- **Found during:** Task 1 (Vitest)
- **Issue:** `PopoverContentImpl` merges its own `aria-labelledby` (the trigger id) after the passed attributes, so the dialog was labelled by the ghost instead of the subject.
- **Fix:** a function ref on the subject heading sets `aria-labelledby` on the closest `[role="dialog"]` once mounted; covered by a test.
- **Files modified:** OutlookGhostDetail.vue, OutlookGhostDetail.test.ts
- **Commit:** e3df3c75

**2. [Rule 1 - Bug] `safeHttpsUrl` exported from the SFC broke the build type check**
- **Found during:** CI of the first push (92f62f1d): NPM Build, PHPUnit (its frontend build step) and Playwright failed with TS2614.
- **Issue:** `vite-plugin-checker` runs plain `tsc` next to `vue-tsc`; plain tsc only sees the `*.vue` shim and cannot resolve a named export of an SFC. `npm run type-check` (vue-tsc only) had passed locally.
- **Fix:** moved the function to `safeUrl.ts`; reproduced and cleared with `npx tsc --noEmit` locally. Gate F should include `npx tsc --noEmit` from now on.
- **Files modified:** safeUrl.ts (new), OutlookGhostDetail.vue, OutlookGhostDetail.test.ts
- **Commit:** a728eb68

**3. [Rule 1 - Bug, 03-08 code] MicrosoftCalendarConnectTest asserted session state after the callback consumed it**
- **Found during:** combined CI gate (first CI run of 03-08 code, which deferred its CI to this plan).
- **Issue:** `test_return_values_other_than_calendar_are_ignored...` read `microsoft.intent` from the redirect response after the callback had pulled it (Postgres 16 failure). Three sibling tests asserted `assertSessionMissing` after the callback, which made them vacuous.
- **Fix:** all four tests now assert the redirect response before the callback runs. Test-only change; 03-08 production code is unchanged.
- **Files modified:** tests/Feature/Microsoft365/MicrosoftCalendarConnectTest.php
- **Commit:** 2cc96cb3

**4. [Rule 1 - Bug] The resync test scripted Graph with a second `Http::fake`**
- **Found during:** combined CI gate (Postgres 17): `test_dismissal_survives_a_resync` got a 500.
- **Issue:** a second `Http::fake` does not override the first, so the exhausted first response sequence answered the re-sync with an exception.
- **Fix:** both rounds are one sequence, scripted up front, as OutlookSyncResilienceTest does; the time jump uses `travel(61)->seconds()`.
- **Files modified:** tests/Feature/Microsoft365/OutlookMeetingDismissTest.php
- **Commit:** cffb0d32

**5. [Rule 3 - Blocking] Test fixtures outside the plan's file list**
- `OutlookCalendarControls.test.ts` (the hand-made context needed `announcement`, plus a new announcement test) and `MicrosoftCalendarConnectTest.php` (deviation 3) were touched although `files_modified` does not list them.

### Notes

- The plan's local PHPStan command (`app/Microsoft365` only) reports the known "Ignored error pattern ... Relation was not matched" scoping artifact (see 03-01-SUMMARY); the full-app run, which is what CI runs, was the local gate and is clean.
- PHPUnit stops at the first failure, so each CI cycle revealed only one failing test; the four cycles above were the cost of the deferred 03-08 CI.

## Auth gates

None.

## Known limitations

- After dismissing the last ghost of a day, focus goes to the Sync button as specified; while that button is disabled (cooldown after a sync) the browser cannot focus it and focus is not moved. Revisit with the show-dismissed work in 03-10.
- `visibleCount` still excludes dismissed meetings, consistent for now; 03-10 must revisit it with the show-dismissed toggle.

## Known Stubs

None.

## Threat Flags

None. T-03-22 (IDOR) mitigated: explicit session-user scope, uuid constraint, 404 for foreign, unknown, invalid and gone ids, tested with a second user's row. T-03-23 (XSS) mitigated: https-only allow-list, `rel="noopener noreferrer"`, text interpolation only, tests with `javascript:`, `http:`, malformed links and HTML subjects and organizer names. T-03-24 (CSRF) mitigated: routes sit in the web group and the existing route-middleware assertion covers them. No new endpoints beyond the two planned.

## Requirements

`CAL-04` is left Pending in REQUIREMENTS.md: it also requires showing dismissed suggestions again to undo a dismissal, and that toggle and the calendar restore are delivered in 03-10 (this plan ships the backend for it and the panel's Restore state).

## Self-Check: PASSED

All created and modified files exist; commits e3df3c75, 44ebd696, 92f62f1d, a728eb68, 2cc96cb3 and cffb0d32 are ancestors of HEAD and origin matches local.
