# Touched core files (Phase 2: Sign in with Microsoft, Phase 3: Outlook meetings)

Ledger for upstream merges. The Phase 7 merge rehearsal (and every later `git merge upstream/main`)
checks these files first. Everything else the fork adds lives in fork-owned paths (second table).

## Core files edited

| File | Change | Plan | Merge note |
| --- | --- | --- | --- |
| `composer.json` | Adds the `laravel/socialite` and `socialiteproviders/microsoft` requirements. | 02-04 | On a conflict take upstream's file, re-add the requirement, then regenerate the lock file. |
| `composer.lock` | Lock entries for the added packages. | 02-04 | Never hand-merge: take upstream's file and run `composer update` for the added packages to regenerate it. |
| `config/app.php` | One `use` line and one entry in the `providers` array for `Microsoft365ServiceProvider`. | 02-01 | Re-apply the two lines after the merge. |
| `resources/js/Pages/Auth/Login.vue` | One import and one element after the login form (the Microsoft button). | 02-03 | Re-apply the import and the element; keep the rest of upstream's template. |
| `app/Providers/FortifyServiceProvider.php` | `loginView` passes `canRegister` (true only when APP_ENABLE_REGISTRATION=on) so the login page hides "Register here!" when registration is off/invite-only. | post-02 (2026-11-04) | Re-apply the `canRegister` line and the `RegistrationMode` import. |
| `tests/Feature/AuthenticationTest.php` | Two tests for the `canRegister` login prop (register link hidden unless registration is on). | post-02 (2026-11-04) | Keep upstream's file and re-add the two test methods. |
| `resources/js/Pages/Profile/Show.vue` | One import and one element after the two-factor section (the Microsoft account card). | 02-10 | Re-apply the import and the element after upstream's two-factor section. |
| `.env.example` | Appended block with the seven `SOLIDTIME_MICROSOFT_*` names. | 02-09 | Keep the block at the end of the file. |
| `resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue` | A named `overlay` slot rendered as the first child of the column root and an optional `overlayLaneWidth` prop that, only when set, insets the events container on the right by the lane width plus 4px (layout decision D-23). Days without overlay content render exactly as upstream. | 03-05 | Re-apply the slot, the optional prop and the conditional right inset after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | An optional `dayOverlayLane(dayStr, isDayView)` prop forwarded to each day column as `overlayLaneWidth`, and a `day-overlay` slot forwarded as the column's `overlay` slot (with `minutesToPixels` and `settings`). `CalendarToolbar` became an open tag that forwards an optional `toolbar-extra` slot into the toolbar `extra` slot (`<template v-if="$slots['toolbar-extra']" #extra>`). | 03-05, 03-07 | Re-apply the prop, the `overlay-lane-width` binding, the forwarded slot template and the `toolbar-extra` forwarding after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue` | One `<slot name="extra" />` as the first child of the right-hand cluster (before the week/day tabs). With no slot content the toolbar renders exactly as upstream. | 03-07 | Re-apply the one-line slot after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useSlotSelection.ts` | One selector extended in `onSlotPointerDown` (`.fc-event, [data-calendar-overlay]`) so a pointerdown on an overlay block never starts a selection. | 03-05 | Re-apply the extended selector after taking upstream's file. |
| `resources/js/Pages/Calendar.vue` | Two imports, one `useOutlookMeetings(calendarStart, calendarEnd)` call, the `:day-overlay-lane` binding and a `#day-overlay` slot template with `OutlookGhostLayer` (the self-closing `TimeEntryCalendar` became an open tag). `:loading` stays bound to the time-entry query only. 03-07 adds the `OutlookCalendarControls` import and a `#toolbar-extra` slot template (rendered only when the calendar prop exists). | 03-06, 03-07 | Re-apply the imports, the composable call, the binding and both slot templates after taking upstream's file; keep upstream's props and handlers. |

## New files inside core directories

| File | Purpose |
| --- | --- |
| `config/microsoft365.php` | Environment-driven configuration of the integration. |
| `lang/en/microsoft365.php` | English strings. |
| `lang/es/microsoft365.php` | Spanish strings. |

## Fork-owned paths

These paths do not exist upstream, so they never conflict.

| Path | Content |
| --- | --- |
| `app/Microsoft365/` | Service provider, routes, migrations, models, auth classes, console command. |
| `resources/js/m365/` | Vue components for the sign-in button and the profile card. |
| `resources/js/m365/calendar/` | Outlook calendar integration: ghost layer, layout and label helpers, meetings API helpers, the `useOutlookMeetings` composable and their tests. |
| `tests/Feature/Microsoft365/` | Feature tests. |
| `tests/Unit/Microsoft365/` | Unit tests. |
| `e2e/microsoft-signin.spec.ts` | Browser test of the sign-in page. |
| `e2e/outlook-ghosts.spec.ts` | Browser test of the Outlook ghosts (reachability beside entries, totals, no create flow). |
| `docs/deploy/dokploy-compose.fork.yml` | Compose for Dokploy. |
| `.github/workflows/fork-image.yml` | Fork image build. |

## Hot files deliberately not touched (D-15)

Phase 2 does not edit these upstream hot spots, so they cannot conflict because of this phase
(`app/Providers/FortifyServiceProvider.php` was later touched by the register-link fix; see the first table):

- `app/Providers/AppServiceProvider.php`
- `app/Providers/RouteServiceProvider.php`
- `routes/web.php`
- `app/Http/Kernel.php`
- `app/Http/Middleware/HandleInertiaRequests.php`
- `app/Http/Middleware/ShareInertiaData.php`
- `app/Actions/Fortify/CreateNewUser.php`
- `app/Service/UserService.php`
- `app/Service/MemberService.php`
- `app/Service/DeletionService.php`
- `config/services.php`
- `config/octane.php`
- `openapi.json`
- `app/Models/User.php`
