# Touched core files (Phase 2: Sign in with Microsoft, Phase 3: Outlook meetings, Phase 3.1: calendar UX polish)

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
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | An optional `dayOverlayLane(dayStr, isDayView)` prop forwarded to each day column as `overlayLaneWidth`, and a `day-overlay` slot forwarded as the column's `overlay` slot (with `minutesToPixels` and `settings`). `CalendarToolbar` became an open tag that forwards an optional `toolbar-extra` slot into the toolbar `extra` slot (`<template v-if="$slots['toolbar-extra']" #extra>`). 03-10 adds the matching `settings-extra` forwarding (`<template v-if="$slots['settings-extra']" #settings-extra>`) inside that same open tag. 03.1-01: the settings `useLocalStorage` uses `{ ...DEFAULT_CALENDAR_SETTINGS }` as defaults and the function form of `mergeDefaults` calling `sanitizeCalendarSettings`, and `useCalendarNavigation` receives a `showWeekends` getter. 03.1-04: `contextMenuOverlayElement` taken from `useContextMenu`; a `context-menu-overlay` scoped slot (`{ element }`) as the first `ContextMenuContent` branch, rendered only when the element is set and the slot is provided (the entry branch became `v-else-if`, items unchanged); `contextMenuOpen` and `interacting` (`isDragging \|\| isResizing \|\| isSelecting`) added to the `day-overlay` slot props; an optional `day-header-extra` scoped slot (`{ dayStr, isDayView }`) after `FullCalendarDayHeader` in each header cell. 03.1-06: `useWheelZoom({ rootRef, scrollerRef, calendarSettings, isInteracting, pixelsToMinutesFromMidnight })` called after the selection composable with the `isDragging \|\| isResizing \|\| isSelecting` guard; `CalendarZoomControls` rendered in the (formerly empty) header corner cell above the time axis; `relative` on the `.fc` root plus a `headerRef` on `.fc-header-scroll` (`useElementSize`, border-box) positioning the persistent zoom pill (`role="status"`, `data-testid="calendar-zoom-indicator"`) under the sticky header; the deep `watch(calendarSettings, ...)` narrowed to `watch(() => datesAffectingSettingsKey(calendarSettings.value), ...)` so a zoom step (slotMinutes only) never emits dates-change. | 03-05, 03-07, 03-10, 03.1-01, 03.1-04, 03.1-06 | Re-apply the prop, the `overlay-lane-width` binding, the forwarded slot template and the `toolbar-extra` and `settings-extra` forwardings after taking upstream's file; re-apply the settings import, the sanitised `mergeDefaults` and the `showWeekends` getter; re-add the `context-menu-overlay` branch before upstream's menu branches, the two extra `day-overlay` slot props and the `day-header-extra` slot in the header cell; re-add the `useWheelZoom` call, the corner `CalendarZoomControls`, the `headerRef`/`useElementSize` pill and the narrowed settings watch (if upstream adds its own zoom, prefer theirs and drop the 03.1-06 files). |
| `resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue` | One `<slot name="extra" />` as the first child of the right-hand cluster (before the week/day tabs). 03-10: `CalendarSettingsPopover` became an open tag that forwards an optional `settings-extra` slot (`<template v-if="$slots['settings-extra']" #settings-extra>`). With no slot content the toolbar renders exactly as upstream. | 03-07, 03-10 | Re-apply the one-line slot and the settings-extra forwarding after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/CalendarSettingsPopover.vue` | A named `settings-extra` slot rendered at the bottom of the popover content after a `Separator` (`<template v-if="$slots['settings-extra']">`), plus the `Separator` import. Without slot content the popover renders exactly as upstream (no extra Separator). 03.1-01: a first "Show weekends" row (`Field` with `FieldLabel`, the package-local `Switch` `data-testid="calendar-weekends-switch"` and a `FieldDescription`), a `showWeekends` ref synced in the props watch, `onShowWeekendsChange`, and the `Switch`/`FieldDescription` imports. | 03-10, 03.1-01 | Re-apply the import and the conditional `Separator` plus slot after taking upstream's file; re-add the weekend row, its ref, handler and imports. |
| `resources/js/packages/ui/src/FullCalendar/calendarSettings.ts` | Optional `showWeekends` field on `CalendarSettings`, the exported `SNAP_MINUTE_OPTIONS`, `SLOT_MINUTE_OPTIONS`, `DEFAULT_CALENDAR_SETTINGS` and the pure `sanitizeCalendarSettings` (validates stored settings on read). | 03.1-01 | Re-add the field and the exports after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useCalendarNavigation.ts` | Optional `showWeekends` getter in the callbacks; the day list split into `weekDays` (full week, drives the emitted range) and `viewDays` (week without Saturday and Sunday when the getter returns false); a deep link to a hidden weekend day opens in day view. | 03.1-01 | Re-apply the getter, the `weekDays`/`viewDays` split, the `weekDays`-based `emitDatesChange` and the initial-view rule after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useSlotSelection.ts` | One selector extended in `onSlotPointerDown` (`.fc-event, [data-calendar-overlay]`) so a pointerdown on an overlay block never starts a selection. | 03-05 | Re-apply the extended selector after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useContextMenu.ts` | A `contextMenuOverlayElement` ref (returned): in `handleCalendarContextMenu`, when the target has no `[data-event-id]` ancestor but a `[data-calendar-overlay]` one, the element is stored (the click time is still computed as the fallback for the default items); the entry branch and the empty-slot branch reset it to null. A keyboard-opened menu on a focused block takes the same branch. | 03.1-04 | Re-add the ref, the overlay lookup before the empty-slot path, the reset in the entry branch and the returned ref after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useContextMenu.test.ts` | A second `describe` with the overlay-branch cases appended (overlay target, entry and empty-slot branches clear it, keyboard-opened menu); upstream's break tests unchanged. | 03.1-04 | Keep upstream's file and re-append the overlay `describe` block. |
| `resources/js/Pages/Calendar.vue` | Two imports, one `useOutlookMeetings(calendarStart, calendarEnd)` call, the `:day-overlay-lane` binding and a `#day-overlay` slot template with `OutlookGhostLayer` (the self-closing `TimeEntryCalendar` became an open tag). `:loading` stays bound to the time-entry query only. 03-07 adds the `OutlookCalendarControls` import and a `#toolbar-extra` slot template (rendered only when the calendar prop exists). 03-10 adds the `OutlookDismissedSetting` import and a `#settings-extra` slot template (rendered only for the connected and reconnect states). 03.1-04 adds the `OutlookMeetingContextItems` and `OutlookLaneCaption` imports and the `#context-menu-overlay` (`{ element }`) and `#day-header-extra` slot templates (both only when the Outlook labels exist). | 03-06, 03-07, 03-10, 03.1-04 | Re-apply the imports, the composable call, the binding and the five slot templates after taking upstream's file; keep upstream's props and handlers. |

## New files inside core directories

| File | Purpose |
| --- | --- |
| `config/microsoft365.php` | Environment-driven configuration of the integration. |
| `lang/en/microsoft365.php` | English strings. |
| `lang/es/microsoft365.php` | Spanish strings. |
| `resources/js/packages/ui/src/switch/Switch.vue`, `resources/js/packages/ui/src/switch/index.ts` | Package-local reka Switch (same classes as `resources/js/Components/ui/switch`, `cn` from `../utils/cn`), so the published `@solidtime/ui` imports no app code. Not in the package barrel. |
| `resources/js/packages/ui/src/FullCalendar/calendarSettings.test.ts` | Vitest for `sanitizeCalendarSettings`. |
| `resources/js/packages/ui/src/FullCalendar/useCalendarNavigation.test.ts` | Vitest for weekend hiding in the navigation composable. |
| `resources/js/packages/ui/src/FullCalendar/CalendarSettingsPopover.test.ts` | Vitest for the weekend switch row of the settings popover. |
| `resources/js/packages/ui/src/FullCalendar/calendarZoom.ts`, `resources/js/packages/ui/src/FullCalendar/calendarZoom.test.ts` | 03.1-06: pure calendar zoom helpers (Grid Scale ladder 60/30/15/10/5, zoom percent, wheel delta normalisation, wheel accumulator, anchored scrollTop, `datesAffectingSettingsKey`) and their Vitest. Generic calendar zoom; merge note: keep beside upstream's FullCalendar files. |
| `resources/js/packages/ui/src/FullCalendar/useWheelZoom.ts`, `resources/js/packages/ui/src/FullCalendar/useWheelZoom.test.ts` | 03.1-06: non-passive Ctrl/Cmd + wheel and Safari gesture listeners on the calendar root, anchored zoom steps, zoom pill state and the button API, plus their Vitest. Merge note: keep beside upstream's FullCalendar composables. |
| `resources/js/packages/ui/src/FullCalendar/CalendarZoomControls.vue`, `resources/js/packages/ui/src/FullCalendar/CalendarZoomControls.test.ts` | 03.1-06: the two stacked zoom buttons of the header corner cell (tooltips "Zoom in (Ctrl + scroll)", aria-disabled at the ends) and their Vitest. Merge note: keep beside upstream's FullCalendar files. |

## Fork-owned paths

These paths do not exist upstream, so they never conflict.

| Path | Content |
| --- | --- |
| `app/Microsoft365/` | Service provider, routes, migrations, models, auth classes, console command. |
| `resources/js/m365/` | Vue components for the sign-in button and the profile card. |
| `resources/js/m365/calendar/` | Outlook calendar integration: ghost layer, meeting context-menu items, lane caption, layout and label helpers, meetings API helpers, the `useOutlookMeetings` composable and their tests. |
| `tests/Feature/Microsoft365/` | Feature tests. |
| `tests/Unit/Microsoft365/` | Unit tests. |
| `e2e/microsoft-signin.spec.ts` | Browser test of the sign-in page. |
| `e2e/outlook-ghosts.spec.ts` | Browser test of the Outlook ghosts (reachability beside entries, totals, no create flow). |
| `e2e/calendar-view-options.spec.ts` | Browser tests of the calendar view options (weekends; zoom added by 03.1-06). |
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
