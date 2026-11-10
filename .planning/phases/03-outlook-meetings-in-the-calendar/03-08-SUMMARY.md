---
phase: 03-outlook-meetings-in-the-calendar
plan: 08
subsystem: auth-ui
tags: [oauth, connect-flow, open-redirect, vue, calendar, outlook, inertia]

requires:
  - phase: 03-outlook-meetings-in-the-calendar
    provides: calendarAccessState() and reconnect_required_at (03-03), shared microsoft.calendar prop and labels (03-06), OutlookCalendarControls in the toolbar extra slot with sticky connection state (03-07)
  - phase: 02-microsoft-sign-in
    provides: authenticated ?intent=connect flow, completeConnect, connectFailureResponse, navigateTo
provides:
  - Connect Microsoft 365 (not connected) and Reconnect Microsoft (amber TriangleAlert, Sync position) buttons in the calendar toolbar
  - allow-listed server-side return target (session microsoft.return = calendar) for the authenticated connect flow
  - calendar prop additions connect_url and notice {level, message}, shown once through the notification store
affects: [03-09, 03-11, 03-12]

actuals:
  tokens: 8900
  tasks: 2
  commits: 2
  plan_head_before: ac853a580418e9530c6070e5c8123639254b7a71
  plan_head_after: fd5862a52b64f13185fc96b4bd67d276d117be27

tech-stack:
  added: []
  patterns:
    - "Redirect target as an allow-list of one server-written session value, pulled with the other connect keys on every exit path"
    - "Flash notice plus level key reduced server-side to the two levels the notification store accepts"

key-files:
  created:
    - tests/Feature/Microsoft365/MicrosoftCalendarConnectTest.php
  modified:
    - app/Microsoft365/Http/Controllers/MicrosoftAuthController.php
    - app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php
    - resources/js/m365/types.ts
    - resources/js/m365/calendar/OutlookCalendarControls.vue
    - resources/js/m365/calendar/OutlookCalendarControls.test.ts
    - resources/js/m365/calendar/syncStatus.ts
    - resources/js/m365/calendar/useOutlookMeetings.ts
    - resources/js/m365/calendar/useOutlookMeetings.test.ts
    - tests/Feature/Microsoft365/OutlookCalendarPropTest.php

key-decisions:
  - "Success and failure both flash microsoft365.notice and microsoft365.notice_level only for the calendar destination; the profile destination is byte-identical to Phase 2 (notice only)"
  - "A connect without return=calendar actively forgets a microsoft.return left by an abandoned earlier connect, so a stale target can never steer a later flow"
  - "calendar.notice reduces any level other than error to success on the server, so the client never sees an unknown level"
  - "Reconnect shows the last-synced text (describeLastSynced) when known; not_connected shows nothing but the Connect button"

patterns-established:
  - "describeLastSynced: standalone last-synced line for states that have no sync status"

requirements-completed: []

duration: ~45min
completed: 2026-11-06
status: complete
---

# Phase 3 Plan 08: Connect and Reconnect in the calendar Summary

**Users without a usable Microsoft connection get "Connect Microsoft 365" or "Reconnect Microsoft" in the calendar toolbar; the Phase 2 connect flow returns to /calendar through a one-value allow-listed server-side target and the outcome shows as a notification.**

## Accomplishments

- `MicrosoftAuthController`: constants `RETURN_SESSION_KEY = 'microsoft.return'` and `RETURN_CALENDAR`. `redirect()` stores the key only in the authenticated connect branch and only when `?return` is exactly the string `calendar` (anything else, including URLs, `//host`, arrays and other casing, forgets it); no other branch writes it. `callback()` pulls it with the intent keys before any branch, so it is gone on every exit path. `completeConnect()` and `connectFailureResponse()` go through one `connectNoticeRedirect()`: calendar destination with `microsoft365.notice` plus `microsoft365.notice_level` (`success` / `error`), otherwise the profile exactly as before. A guest still goes to login.
- `ShareMicrosoftInertiaData`: calendar block gains `connect_url = route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'])` and `notice` (`{level, message}` from the flash keys, or null; level reduced to `error` or `success`).
- `OutlookCalendarControls.vue`: not_connected renders only the outline `sm` "Connect Microsoft 365" button with the `Link` icon; reconnect renders "Reconnect Microsoft" with the amber `TriangleAlert` in the Sync position plus the last-synced text when known. Both use the Sync button's responsive pattern (icon-only below md with `aria-label`), a Tooltip with the hint, and `navigateTo(calendar.connect_url)` (never the Inertia router). No error banner or alert role.
- `useOutlookMeetings`: shows `calendar.notice` once on mount via `useNotificationsStore().addNotification(level, message)`; the store is only touched when a notice exists.
- Tests: `MicrosoftCalendarConnectTest` (11 tests: stored target, success to calendar, refusal to calendar, cancelled to calendar, five rejected values in a loop incl. `https://evil.example.test` and `//evil.example.test`, array value, abandoned-connect stale key, guest sign-in keeping `url.intended`, guest connect to login, stale key without intent, keys cleared after success / refusal / interruption); `OutlookCalendarPropTest` (+4: connect_url, one-time notice with level, success notice, unknown level reads as success; `hasAll` updated); Vitest +9 (6 Connect/Reconnect cases, the reconnect-answer test now also asserts the button, 3 notice cases). m365 Vitest is 98/98.

## Task Commits

1. **Task 1 (tracer):** `17d7eb92` - return target, calendar prop additions, Connect/Reconnect buttons, first PHP and Vitest tests
2. **Task 2:** `fd5862a5` - notice on mount, full allow-list and clearing coverage, prop tests

## Verification

- **Local (Gate F):** vitest `resources/js/m365` 98/98; `vue-tsc` clean; eslint clean on `resources/js/m365`, `Pages/Calendar.vue`, `FullCalendar`; prettier clean on the same.
- **Local PHP:** Pint `--test` on `app/Microsoft365` and `tests/Feature/Microsoft365` passed; full-app PHPStan `[OK] No errors`; `php -l` clean on both test files. PHPUnit does not run on this host (no Postgres): it runs in CI only. (PHPStan on the single path `app/Microsoft365` reports only the pre-existing "ignored error pattern not matched" artefact of a partial scan; the full-app run is the gate.)
- **CI: deferred to 03-09 combined gate (owner batching decision).** Not run for this plan: the eight-workflow gate and Gate B (MicrosoftCalendarConnectTest, OutlookCalendarPropTest, MicrosoftAccountTest, MicrosoftSessionTest, expected 12) are covered by the one gate 03-09 runs for both plans. The PHP tests in this plan have therefore not executed yet.
- Acceptance greps: `microsoft.return` in the controller 1 (baseline 0); `'return' => 'calendar'` in the middleware 1; `navigateTo` in the controls 2; `public function test_` in the connect test 11; `evil.example.test` 2; `addNotification` in the composable 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing fixtures and assertions needed the new props**
- **Found during:** Task 1
- **Issue:** `OutlookCalendarPropTest` used `hasAll(['state', 'urls', 'labels'])` and the Vitest fixtures built `OutlookCalendarProps` without `connect_url` / `notice`, which fail the PHP assertion and `vue-tsc`.
- **Fix:** `hasAll` now lists `connect_url` and `notice`; the Vitest fixtures carry both fields; the old "no Sync control for reconnect and not_connected" test was kept and extended rather than replaced.
- **Commit:** 17d7eb92

### Notes

- Extra tests beyond the plan list (cancelled connect, array value, stale-key cases, success prop notice) were added because they close the same threat (T-03-19) from other entry points.
- `requirements-completed` is intentionally empty: SEC-02 is also owned by 03-03 (backend, delivered) and 03-12 (manual check with a real token revocation, `why_human`), so it stays Pending in REQUIREMENTS.md until that check passes.

## Known Stubs

None.

## Threat Flags

None. T-03-19 (open redirect) mitigated: a single allow-listed value, written server-side on the authenticated connect leg only, pulled on every exit path, no URL ever accepted; covered by tests with a URL, a protocol-relative URL, an array and other strings. No new endpoints or trust boundaries.

## Self-Check: PASSED

Created and modified files exist; commits 17d7eb92 and fd5862a5 are ancestors of HEAD.

## CI result (from 03-09 combined gate)

Green on HEAD cffb0d32: nine workflows success, Gate B 3 per class for MicrosoftCalendarConnectTest, OutlookCalendarPropTest, MicrosoftAccountTest and MicrosoftSessionTest. This was the first CI run of 03-08 code. It exposed one 03-08 test bug (MicrosoftCalendarConnectTest asserted the redirect session after the callback had consumed it; production code unaffected), fixed in 2cc96cb3 and described in 03-09-SUMMARY.md.
