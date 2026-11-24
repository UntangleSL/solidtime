# Touched core files (Phase 2: Sign in with Microsoft, Phase 3: Outlook meetings, Phase 3.1: calendar UX polish, Phase 3.2: appearance)

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
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | An optional `dayOverlayLane(dayStr, isDayView)` prop forwarded to each day column as `overlayLaneWidth`, and a `day-overlay` slot forwarded as the column's `overlay` slot (with `minutesToPixels` and `settings`). `CalendarToolbar` became an open tag that forwards an optional `toolbar-extra` slot into the toolbar `extra` slot (`<template v-if="$slots['toolbar-extra']" #extra>`). 03-10 adds the matching `settings-extra` forwarding (`<template v-if="$slots['settings-extra']" #settings-extra>`) inside that same open tag. 03.1-01: the settings `useLocalStorage` uses `{ ...DEFAULT_CALENDAR_SETTINGS }` as defaults and the function form of `mergeDefaults` calling `sanitizeCalendarSettings`, and `useCalendarNavigation` receives a `showWeekends` getter (owner UAT 2026-11-17: `=== true`, so weekends are hidden unless chosen; `migrateWeekendsHiddenDefault(() => window.localStorage)` runs once before the `useLocalStorage` read, which now uses `CALENDAR_SETTINGS_STORAGE_KEY`). 03.1-04: `contextMenuOverlayElement` taken from `useContextMenu`; a `context-menu-overlay` scoped slot (`{ element }`) as the first `ContextMenuContent` branch, rendered only when the element is set and the slot is provided (the entry branch became `v-else-if`, items unchanged); `contextMenuOpen` and `interacting` (`isDragging \|\| isResizing \|\| isSelecting`) added to the `day-overlay` slot props; an optional `day-header-extra` scoped slot (`{ dayStr, isDayView }`) after `FullCalendarDayHeader` in each header cell. 03.1-06: `useWheelZoom({ rootRef, scrollerRef, calendarSettings, isInteracting, pixelsToMinutesFromMidnight })` called after the selection composable with the `isDragging \|\| isResizing \|\| isSelecting` guard; `CalendarZoomControls` rendered in the (formerly empty) header corner cell above the time axis; `relative` on the `.fc` root plus a `headerRef` on `.fc-header-scroll` (`useElementSize`, border-box) positioning the persistent zoom pill (`role="status"`, `data-testid="calendar-zoom-indicator"`) under the sticky header; the deep `watch(calendarSettings, ...)` narrowed to `watch(() => datesAffectingSettingsKey(calendarSettings.value), ...)` so a zoom step (slotMinutes only) never emits dates-change. | 03-05, 03-07, 03-10, 03.1-01, 03.1-04, 03.1-06 | Re-apply the prop, the `overlay-lane-width` binding, the forwarded slot template and the `toolbar-extra` and `settings-extra` forwardings after taking upstream's file; re-apply the settings import, the sanitised `mergeDefaults`, the weekends migration call and the `showWeekends` getter; re-add the `context-menu-overlay` branch before upstream's menu branches, the two extra `day-overlay` slot props and the `day-header-extra` slot in the header cell; re-add the `useWheelZoom` call, the corner `CalendarZoomControls`, the `headerRef`/`useElementSize` pill and the narrowed settings watch (if upstream adds its own zoom, prefer theirs and drop the 03.1-06 files). |
| `resources/js/packages/ui/src/FullCalendar/CalendarToolbar.vue` | One `<slot name="extra" />` as the first child of the right-hand cluster (before the week/day tabs). 03-10: `CalendarSettingsPopover` became an open tag that forwards an optional `settings-extra` slot (`<template v-if="$slots['settings-extra']" #settings-extra>`). With no slot content the toolbar renders exactly as upstream. | 03-07, 03-10 | Re-apply the one-line slot and the settings-extra forwarding after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/CalendarSettingsPopover.vue` | A named `settings-extra` slot rendered at the bottom of the popover content after a `Separator` (`<template v-if="$slots['settings-extra']">`), plus the `Separator` import. Without slot content the popover renders exactly as upstream (no extra Separator). 03.1-01: a first "Show weekends" row (`Field` with `FieldLabel`, the package-local `Switch` `data-testid="calendar-weekends-switch"` and a `FieldDescription`), a `showWeekends` ref synced in the props watch, `onShowWeekendsChange`, and the `Switch`/`FieldDescription` imports. | 03-10, 03.1-01 | Re-apply the import and the conditional `Separator` plus slot after taking upstream's file; re-add the weekend row, its ref, handler and imports. |
| `resources/js/packages/ui/src/FullCalendar/calendarSettings.ts` | Optional `showWeekends` field on `CalendarSettings`, the exported `SNAP_MINUTE_OPTIONS`, `SLOT_MINUTE_OPTIONS`, `DEFAULT_CALENDAR_SETTINGS` (weekends hidden by default since the owner UAT of 2026-11-17) and the pure `sanitizeCalendarSettings` (validates stored settings on read); `CALENDAR_SETTINGS_STORAGE_KEY`, `WEEKENDS_HIDDEN_DEFAULT_MIGRATION_KEY` and the one-time `migrateWeekendsHiddenDefault` (resets the stored pre-change `showWeekends: true`). | 03.1-01 | Re-add the field and the exports after taking upstream's file. |
| `resources/js/packages/ui/src/FullCalendar/useCalendarNavigation.ts` | Optional `showWeekends` getter in the callbacks; the day list split into `weekDays` (full week, drives the emitted range) and `viewDays` (week without Saturday and Sunday unless the getter returns true; a missing getter hides them); a deep link to a hidden weekend day opens in day view. | 03.1-01 | Re-apply the getter, the `weekDays`/`viewDays` split, the `weekDays`-based `emitDatesChange` and the initial-view rule after taking upstream's file. |
| `e2e/calendar.spec.ts`, `e2e/calendar-settings.spec.ts`, `e2e/breaks.spec.ts` | Weekends hidden by default (owner UAT, 2026-11-17): an import of `showCalendarWeekends` from `e2e/utils/calendar.ts`; a file-level `test.beforeEach` calling it in `calendar.spec.ts` and `calendar-settings.spec.ts` (plus one call for `employee.page` in the employee isolation test), and one call before the calendar visit in the breaks-disabled test, so tests on "today" keep passing when CI runs on a weekend. | quick 2026-11-17 | Re-add the import and the calls after taking upstream's files (drop them if upstream shows weekends by default). |
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
| `e2e/utils/calendar.ts` | `showCalendarWeekends(page)`: init script that seeds the calendar settings with weekends shown (only when nothing is stored) and marks the weekends migration done; used by the calendar specs that work on "today". |
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
| `e2e/outlook-ghosts.spec.ts` | Browser test of the Outlook ghosts (reachability beside entries, totals, no create flow); 03.1-07 appends the hover card, touch, panel layering and meeting-menu-on-top proofs. |
| `e2e/outlook-meeting-look.spec.ts` | 03.1-03: browser test of the meeting look (sky-blue project entry fixture beside a meeting, six-overlap reachability). |
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

## Phase 3.2 (Appearance & Untangle branding)

Built from `git log --grep="(03.2-" --name-only b4e003e6..HEAD`; re-checked by 03.2-09 against the full diff
(including the unnumbered `(03.2)` fix commits). Owner decision D-10 (no Syne) means no
font files were added; Inter stays the only typeface.

### Core files edited

| File | Change | Plan | Merge note |
| --- | --- | --- | --- |
| `resources/css/app.css` | Two `@import` lines after the core imports: `./untangle-theme.css` and `./accent-presets.css`. | 03.2-01 | Re-add the two imports after taking upstream's file; keep them after `styles.css` so the fork tokens win. |
| `config/app.php` | `use App\Appearance\AppearanceServiceProvider;` and the provider added to the providers list. | 03.2-02 | Re-add the import and the one provider line. |
| `resources/views/app.blade.php` | `@include('branding.early-theme')` at the top of `<head>` (before any stylesheet or bundle); the single `theme-color` meta replaced by two `media`-scoped metas (`#1C1C1C` dark, `#F9FCFD` light). | 03.2-04 | Re-add the include first in `<head>` and the two metas after taking upstream's file. |
| `resources/views/auth/oauth/authorize.blade.php` | Upstream's inline theme script removed and replaced by `@include('branding.early-theme')` before `@vite`. | 03.2-04 | Take upstream's file, delete its inline theme script and re-add the include. |
| `resources/js/Layouts/AppLayout.vue` | Import of `useAppearance` and one `useAppearance()` call (accent class and debounced server sync). | 03.2-06 | Re-add the import and the call. |
| `resources/js/Pages/Profile/Partials/ThemeForm.vue` | `AccentPicker` after the Theme select; the "System default: …" helper replaced by the localized `theme_helper` text (computed from `theme` and the `appearance` labels); `usePreferredColorScheme` import dropped. | 03.2-06 | Re-apply the imports, the computed helper, the description binding and the `<AccentPicker />` line. |
| `resources/js/utils/theme.ts` | One leftover `console.log(preferredColor.value)` removed. | 03.2-06 | Drop the line again if upstream still has it. |
| `resources/js/utils/commandPaletteCommands.ts` | `'accent'` added to the command group union (reformatted one member per line) and `accent: 150` to `GROUP_PRIORITIES`. | 03.2-06 | Re-add the union member and the priority. |
| `resources/js/utils/useCommandPalette.ts` | Imports of `createAccentCommands` and `setAccent`, the `{ id: 'accent', heading: 'Accent color' }` group, an `accentCommands` computed and its spread into the command list. | 03.2-06 | Re-add the two imports, the group, the computed and the spread. |
| `resources/js/Components/OrganizationSwitcher.vue` | The `bg-blue-900` letter tile in the trigger replaced by `<OrganizationIcon size="sm">`; an `<OrganizationIcon>` added to each "Switch Organizations" row; `useOrganizationIcons()` for the URLs. `data-testid` and texts unchanged. | 03.2-07 | Re-apply the two imports, the composable call and the two `OrganizationIcon` usages. |
| `resources/js/Pages/Teams/Partials/UpdateTeamNameForm.vue` | `OrganizationIconField` before the Organization Name field; Save awaits `iconField.commit()` after the organization update; the reload also asks for the `appearance` prop. | 03.2-07 | Re-add the import, the ref, the `commit()` call, `'appearance'` in `only` and the field component. |
| `resources/js/packages/ui/src/TimeTrackerStartStop.vue` | Stopped (and active default) button uses the solid accent fill (`--theme-color-accent-solid` / `-hover`) with `--color-on-accent` text; `text-white` moved from the shared classes to the red running state; the break state uses `text-[#1C1C1C]`. | 03.2-03 | Re-apply the class strings after taking upstream's file (contrast gate, BRAND-04). |
| `resources/js/Pages/Teams/Partials/ExportData.vue` | Export link `text-accent-500 hover:text-accent-600 dark:text-accent-200 dark:hover:text-accent-300`. | 03.2-03 | Re-apply the light-safe class pair. |
| `resources/js/packages/ui/src/Client/ClientDropdownItem.vue` | Check icon `text-accent-500 dark:text-accent-200`. | 03.2-03 | Re-apply the class. |
| `resources/js/Components/Common/Goal/GoalProgressBar.vue` | Progress fill `bg-accent-400 dark:bg-accent-200`. | 03.2-03 | Re-apply the class. |
| `resources/js/packages/ui/src/EstimatedTimeProgress.vue` | Progress fill `bg-accent-400 dark:bg-accent-200` (when not over the estimate). | 03.2-03 | Re-apply the class. |
| `e2e/profile.spec.ts` | Theme test expects `Follows your device setting.` instead of `System default:`. | 03.2-06 | Re-apply the one expectation. |
| `e2e/command-palette.spec.ts` | Stopped-timer class assertion matches `bg-[color:var(--theme-color-accent-solid)]` instead of `bg-accent-300/70`; the organization-switch test keeps only the last (name) line of the switcher row, because the row now also renders the icon tile. | 03.2-03, 03.2 fix | Re-apply the regex and the name-line split. |
| `e2e/utils/currentTimeEntry.ts` | Same stopped-timer class assertion change. | 03.2-03 | Re-apply the regex. |

### New files inside core directories

| File | Purpose |
| --- | --- |
| `resources/css/untangle-theme.css` | Untangle token stylesheet: default palette (`html:root.light` / `html:root.dark`), accent steps, solid accent, chart and Outlook meeting tokens. |
| `resources/css/accent-presets.css` | The five non-default accent presets as `html:root.<mode>.accent-<id>` blocks. |
| `resources/views/branding/early-theme.blade.php` | Pre-paint partial: server payload plus the inline script that sets `light`/`dark` and `accent-<id>` on `<html>` before the first paint. |
| `lang/en/branding.php`, `lang/es/branding.php` | Appearance and organization icon copy shared through the `appearance` prop. |

### Fork-owned paths

| Path | Content |
| --- | --- |
| `app/Appearance/` | Service provider, routes (`PUT /user/appearance`, organization icon `POST`/`DELETE`), controllers, requests, models, the middleware sharing the `appearance` prop, listener and migrations. |
| `resources/js/branding/` | Accent state and presets, `useAppearance` sync, `AccentPicker`, organization icon components, contrast helpers and their tests. |
| `tests/Feature/Appearance/` | Feature tests (appearance persistence, pre-paint partial, organization icon). |
| `tests/Unit/Appearance/` | Unit tests (branding copy parity). |
| `e2e/appearance.spec.ts` | Browser tests of the default palette, pre-paint with bundles blocked, accent switch, picker and organization icon. |
| `docs/deploy/APPEARANCE.md` | Operator notes for the appearance features (added by 03.2-09). |

### Hot files deliberately not touched

No 03.2 commit edits these, so they cannot conflict because of this phase:

- `resources/js/packages/ui/styles.css`
- `resources/js/packages/ui/tailwind.theme.js`
- `tailwind.config.js`
- `app/Models/User.php`
- `app/Models/Organization.php`
- `app/Http/Middleware/ShareInertiaData.php`
- `routes/web.php`
- `openapi.json`
- `app/Http/Controllers/Api/V1/UserController.php`
- `app/Http/Requests/V1/User/UserUpdateRequest.php`
- `app/Http/Controllers/Web/OrganizationController.php`
- `resources/js/m365/calendar/`
- `resources/js/packages/ui/src/FullCalendar/`

## Phase 4 (Assign meetings to projects)

Built from `git log --grep="(04-" --name-only 10e21212~1..HEAD` and `git diff --name-status` over the
same range (merge commits included); 04-09 reconciles it against the final phase diff. Every core edit
is additive: optional slots and slot fills, no props, no logic, nothing rendered without fork content.

### Core files edited

| File | Change | Plan | Merge note |
| --- | --- | --- | --- |
| `resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.vue` | One `<slot name="title-prefix" />` in the title row, after the break icon and before the title span. | 04-07 | Re-add the one slot line after taking upstream's file; it renders nothing without content (guarded by `FullCalendarEventContent.test.ts`). |
| `resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue` | The self-closing `FullCalendarEventContent` element opened up to fill `#title-prefix` with `<slot name="event-extra" :time-entry="dayEvent.event.timeEntry" />`, behind `v-if="$slots['event-extra']"`. | 04-07 | Re-apply the open tag, the template and the closing tag around upstream's props. |
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | `CalendarDayColumn` forwards `event-extra` (`<template v-if="$slots['event-extra']" #event-extra="slotProps"><slot name="event-extra" v-bind="slotProps" /></template>`) beside the `day-overlay` forwarding. | 04-07 | Re-add the template next to the `day-overlay` forwarding. |
| `resources/js/Pages/Calendar.vue` | Import of `OutlookSelectionBar` and `<OutlookSelectionBar v-if="outlook.labels.value" />` after `TimeEntryCalendar` (2 lines). | 04-05 | Re-add the import and the element after the calendar. |
| `resources/js/Pages/Calendar.vue` | Import of `OutlookEntryBadge` and the `#event-extra="{ timeEntry }"` fill rendering `<OutlookEntryBadge :time-entry-id="timeEntry.id" />`, gated by `outlook.labels.value`, among the other fork slot fills. | 04-07 | Re-add the import and the slot fill. |

Accessibility note (04-07 assumption): the core event block carries its own `aria-label` (the entry
title), so the badge's `sr-only` text is not part of the entry's accessible name; the visible icon and
its `title` tooltip ("Created from an Outlook meeting") carry the origin. Changing the core `aria-label`
would add a second core touch, so the UI-SPEC's "accessible name ends with it" is accepted as not met.

### New files inside core directories

| File | Purpose |
| --- | --- |
| `resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.test.ts` | Seam guard: without `title-prefix` content the title row renders exactly as upstream; with content it comes first. |

`lang/en/microsoft365.php` and `lang/es/microsoft365.php` (fork files from earlier phases, inside the
core `lang/` directory) gained 44 calendar keys each (conversion form, multi-select, selection bar, batch
results, `from_meeting`).

### Fork-owned paths

| Path | Content |
| --- | --- |
| `app/Microsoft365/database/migrations/2026_11_17_000001_create_outlook_meeting_links_table.php` | `outlook_meeting_links` table (meeting to time entry link). |
| `app/Microsoft365/Models/OutlookMeetingLink.php` | Link model. |
| `app/Microsoft365/TimeEntries/CoreTimeEntryCreator.php` | Adapter that creates entries through the core time-entry path (contract-guarded). |
| `app/Microsoft365/Http/Requests/MeetingConversionRequest.php`, `app/Microsoft365/Http/Controllers/MeetingConversionController.php` | Single and batch conversion endpoint. |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php`, `app/Microsoft365/Http/Middleware/ShareMicrosoftInertiaData.php`, `app/Microsoft365/routes/microsoft365.php` | Edited fork files: converted meetings leave the read and it returns `linked_time_entry_ids`; the shared `urls.convert`; the `microsoft.meetings.convert` route (web group, so `openapi.json` stays untouched). |
| `resources/js/m365/calendar/` | New: `OutlookConvertForm`, `OutlookAssignResults`, `OutlookSelectionBar`, `OutlookEntryBadge`, `useOutlookSelection`, `conversionApi`, `lastProject` (with tests); edited: ghost layer, ghost detail, hover card, context items, `meetingsApi`, `useOutlookMeetings` and `resources/js/m365/types.ts`. |
| `tests/Feature/Microsoft365/` | New `OutlookMeetingConversionTest`, `OutlookMeetingLinkLifecycleTest`; extended `OutlookCalendarPropTest`, `OutlookMeetingEndpointTest`, `OutlookMeetingPrivacyTest`. |
| `tests/Unit/Microsoft365/CoreTimeEntryCreatorContractTest.php` | Guard on the core time-entry contract the adapter relies on. |
| `e2e/outlook-convert.spec.ts` | Browser tests of single and batch conversion and the entry marker (04-08). |

### Hot files deliberately not touched

No Phase 4 commit edits these, so they cannot conflict because of this phase:

- `app/Http/Controllers/Api/V1/TimeEntryController.php`
- `app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php`
- `app/Models/TimeEntry.php`
- `app/Service/DeletionService.php`
- `app/Service/MemberService.php`
- `routes/api.php`
- `routes/web.php`
- `openapi.json`
- `resources/js/utils/useTimeEntriesMutations.ts`
- `resources/js/packages/ui/src/TimeEntry/TimeEntryCreateModal.vue`
- `resources/js/packages/ui/src/TimeTracker/TimeTrackerProjectTaskDropdown.vue`
- `resources/js/packages/ui/src/Tag/TagDropdown.vue`

### Reconciliation (04-09)

Checked against the real phase diff before the release:
`git diff --name-only 4678af6e HEAD -- . ':!resources/js/m365' ':!app/Microsoft365' ':!tests/Feature/Microsoft365' ':!tests/Unit/Microsoft365' ':!docs' ':!.planning' ':!lang/en/microsoft365.php' ':!lang/es/microsoft365.php'`
(base `4678af6e`, the commit that added the Phase 4 plans) lists six paths, and each one has a row
above: `Calendar.vue`, `CalendarDayColumn.vue`, `FullCalendarEventContent.vue`,
`FullCalendarEventContent.test.ts`, `TimeEntryCalendar.vue` and `e2e/outlook-convert.spec.ts`. None
of the hot files listed above appears in the diff. No core path is left unexplained by a Phase 4 plan.

After the plans merged, four test-only fixes under `tests/Feature/Microsoft365/` (fork-owned) aligned
exact assertions with the shipped behaviour: `linked_time_entry_ids` in the meetings response
(`OutlookMeetingEndpointTest`, `OutlookMeetingPrivacyTest`) and the resolved `:attribute` in one
validation message (`OutlookMeetingConversionTest`). No core file changed.

## Phase 5 (Smart meeting suggestions)

Built from the Phase 5 plan summaries and reconciled by 05-14 against the real phase diff. Phase 5
was designed to edit no core file; one orchestrator follow-up to 05-11 widened an existing fork slot
condition in `Calendar.vue`. Everything else lives in fork-owned paths.

### Core files edited

| File | Change | Plan | Merge note |
| --- | --- | --- | --- |
| `resources/js/Pages/Calendar.vue` | The existing `#toolbar-extra` fill condition (line 174) widened from `outlook.calendar.value` to `outlook.calendar.value \|\| outlook.canAct.value`, so `OutlookCalendarControls` (and its Confirm-all button) mounts whenever meetings can be acted on, test-hook mode included. One line, no new import or element. | 05-11 follow-up (`b0412651`, "fix(05-11)") | Re-apply the widened condition on the `#toolbar-extra` template when taking upstream's file. |

### New files inside core directories

None.

`lang/en/microsoft365.php` and `lang/es/microsoft365.php` (fork files from earlier phases, inside the
core `lang/` directory) gained 46 calendar keys each (pre-assignment, suggestion reasons, series
actions, Confirm-all), and `show_dismissed_help` was reworded in both to mention ignored series. In
the Spanish file `create_entry` was also shortened to "Crear registro" so the panel footer fits
(`3077bdb3`, "fix(05-10)").

### Fork-owned paths

| Path | Content |
| --- | --- |
| `app/Microsoft365/Suggestions/` | New: `ProjectSuggestionEngine`, `MeetingSuggester`, `MeetingSignals`, `MeetingSignalInput`, `SeriesAssignmentResolver`, `SeriesKey`, `SubjectTokenizer`, `SuggestionHistory`, `BookableProjects`, `Assignment`, `Suggestion`, `Reason`, `MeetingHints`. |
| `app/Microsoft365/database/migrations/2026_11_18_000001_add_series_and_signals_to_outlook_meeting_links.php`, `..._000002_add_attendees_to_outlook_meetings.php`, `..._000003_create_outlook_series_settings_table.php` | Additive migrations with `down()`: series, signal and prefill columns on `outlook_meeting_links` (with backfill), attendee columns on `outlook_meetings`, the `outlook_series_settings` table. |
| `app/Microsoft365/Models/OutlookSeriesSetting.php`, `app/Microsoft365/Http/Controllers/OutlookSeriesController.php` | New: per-user series settings (ignore, forget) and their endpoints. |
| `app/Microsoft365/Http/Controllers/OutlookMeetingController.php`, `MeetingConversionController.php`, `app/Microsoft365/Http/Requests/MeetingConversionRequest.php`, `app/Microsoft365/Http/Resources/OutlookMeetingResource.php`, `app/Microsoft365/Graph/OutlookMeetingSyncService.php`, `app/Microsoft365/Graph/GraphCalendarClient.php`, `app/Microsoft365/Models/OutlookMeeting.php`, `app/Microsoft365/Models/OutlookMeetingLink.php`, `app/Microsoft365/routes/microsoft365.php` | Edited fork files: suggestions and pre-assignment in the meetings read, series-aware conversion and Confirm-all, attendee sync (Graph `$select` gains `attendees`, same `Calendars.Read` scope), series routes (web group, `openapi.json` untouched). |
| `resources/js/m365/calendar/` | New: `OutlookPreassignment`, `OutlookProjectDot`, `OutlookSuggestionPicks`, `OutlookConfirmAll`, `suggestions.ts`, `suggestionReason.ts` (with tests); edited: ghost layer, ghost detail, meeting summary, hover card, context items, convert form, calendar controls, assign results, selection bar test, `useOutlookMeetings`, `conversionApi` and `resources/js/m365/types.ts`. |
| `resources/js/branding/contrast.test.ts` | Fork test file (Phase 3.2): new `projectDotRingCases` rows for the project dot ring against the meeting fill, hover fill and popover surface. |
| `tests/Feature/Microsoft365/` | New `OutlookMeetingSuggestionTest`, `OutlookSeriesAssignmentTest`, `OutlookSeriesSettingsTest`; extended `OutlookCalendarPropTest`, `OutlookMeetingConversionTest`, `OutlookMeetingEndpointTest`, `OutlookMeetingPrivacyTest`, `OutlookMeetingSyncTest`. |
| `tests/Unit/Microsoft365/` | New `MeetingSignalsTest`, `ProjectSuggestionEngineTest`, `SubjectTokenizerTest`; extended `GraphCalendarClientTest`. |
| `docs/m365/DECISIONS-graph.md` | Phase 5 Graph decision D-09: `attendees` added to the production `$select` (same `Calendars.Read` scope) and its storage rules. |
| `e2e/outlook-suggestions.spec.ts` | Browser proofs of one-click confirm, bulk confirm, the learned prefill and the series actions (05-13). |

### Hot files deliberately not touched

No Phase 5 commit edits these: `app/Http/Controllers/Api/V1/TimeEntryController.php`,
`app/Http/Requests/V1/TimeEntry/TimeEntryStoreRequest.php`, `app/Models/TimeEntry.php`,
`app/Models/Project.php`, `app/Service/DeletionService.php`, `app/Service/MemberService.php`,
`routes/api.php`, `routes/web.php`, `openapi.json`, `resources/js/utils/useTimeEntriesMutations.ts`,
`resources/js/packages/ui/src/TimeEntry/TimeEntryCreateModal.vue`,
`resources/js/packages/ui/src/TimeTracker/TimeTrackerProjectTaskDropdown.vue`,
`resources/js/packages/ui/src/Tag/TagDropdown.vue`. `Calendar.vue` appears only with the one-line
05-11 follow-up above.

### Reconciliation (05-14)

Checked against the real phase diff before the release:
`git diff --name-only d71c5311 HEAD -- . ':!resources/js/m365' ':!app/Microsoft365' ':!tests/Feature/Microsoft365' ':!tests/Unit/Microsoft365' ':!docs' ':!.planning' ':!lang/en/microsoft365.php' ':!lang/es/microsoft365.php'`
(base `d71c5311`, the commit that added the Phase 5 plans) lists three paths, and each one has a row
above: `resources/js/Pages/Calendar.vue`, `resources/js/branding/contrast.test.ts` and
`e2e/outlook-suggestions.spec.ts`. None of the hot files listed above appears in the diff. No core
path is left unexplained by a Phase 5 plan.

After the plans merged, five follow-up fixes landed: `7bee5345` (distinct Microsoft object id for a colleague in
`OutlookSeriesAssignmentTest`), `b0412651` (the `Calendar.vue` condition above), `3077bdb3` (shorter Spanish
`create_entry` and the matching `e2e/outlook-suggestions.spec.ts` assertions),
`e535b485` (Confirm-all popover anchored to its toolbar button through `:reference`, working around a
reka-ui nested-trigger issue, fork file `OutlookConfirmAll.vue`) and `2bb51e9c` (More actions menu
test hook rendered inside the menu, fork file `OutlookGhostDetail.vue`). Only `b0412651` touches a core file.

## Phase 6 (Out-of-sync detection)

Phase 6 makes two additive core edits, both in plan 06-16 and both marked in the code with a
"Fork seam (m365, Phase 6)" comment; no other core file changes (D-13). Everything else (the
out-of-sync detection, the daily job, the review endpoints and the calendar components) lives in
fork-owned paths.

### Core files edited

| File | Change | Plan | Re-apply after an upstream merge |
| --- | --- | --- | --- |
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | New optional slot `context-menu-entry-extra` (`{ timeEntry }`) rendered as the first child of the completed-entry context menu branch (`contextMenuTimeEntry.end !== null`), only when the slot is filled, so without it the menu is exactly as before. `currentDate` is now destructured from `useCalendarNavigation`, and a new `goToDate(date)` sets it to that local day (`getLocalizedDayJsFromMinutes(date, 0)`) and calls `emitDatesChange()`, keeping the view mode; exposed through `defineExpose({ goToDate })`. No markup, style or behaviour change otherwise. | 06-16 | Re-add the slot right before upstream's Edit item in the completed-entry branch and re-add `goToDate` with `defineExpose`. If upstream gains its own navigation API (an exposed method or a prop that moves the current date), prefer it and point `Calendar.vue`'s navigator at it. |
| `resources/js/Pages/Calendar.vue` | Three imports (`OutlookSyncFlagMarker`, `OutlookEntryMenuItems`, `OutlookSyncFlagPanel`) and `onUnmounted`; a typed `calendarRef` on `TimeEntryCalendar` with `outlook.setCalendarNavigator((date) => calendarRef.value?.goToDate(date))` on mount and `outlook.setCalendarNavigator(null)` on unmount; `OutlookSyncFlagMarker` after `OutlookEntryBadge` in the existing `#event-extra` fill; a new `#context-menu-entry-extra` fill with `OutlookEntryMenuItems`; `OutlookSyncFlagPanel` right after `OutlookSelectionBar`. Every new fill is gated by `outlook.labels.value` like the existing ones; core props and handlers are unchanged. | 06-16 | Take upstream's file, then re-apply the fork fills and imports of every phase in this ledger, including these. |

### New files inside core directories

None from 06-16. The browser proof `e2e/outlook-out-of-sync.spec.ts` (06-17) gets its row when 06-18
reconciles this section; the new migration lives under the fork-owned
`app/Microsoft365/database/migrations/`.

### Hot files deliberately not touched

No Phase 6 commit is meant to edit these:
`resources/js/packages/ui/src/FullCalendar/CalendarDayColumn.vue`,
`resources/js/packages/ui/src/FullCalendar/FullCalendarEventContent.vue`,
`resources/js/packages/ui/src/FullCalendar/useCalendarNavigation.ts` (only read: `goToDate` lives in
`TimeEntryCalendar.vue`), `app/Http/Controllers/Api/V1/TimeEntryController.php`,
`app/Http/Requests/V1/TimeEntry/TimeEntryUpdateRequest.php`, `app/Console/Kernel.php`,
`routes/api.php` and `openapi.json`. The daily out-of-sync job is scheduled from the fork provider,
not from the core console kernel.

06-18 adds the reconciliation line against the real phase diff.
