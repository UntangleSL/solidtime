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
| `resources/js/packages/ui/src/FullCalendar/TimeEntryCalendar.vue` | An optional `dayOverlayLane(dayStr, isDayView)` prop forwarded to each day column as `overlayLaneWidth`, and a `day-overlay` slot forwarded as the column's `overlay` slot (with `minutesToPixels` and `settings`). `CalendarToolbar` became an open tag that forwards an optional `toolbar-extra` slot into the toolbar `extra` slot (`<template v-if="$slots['toolbar-extra']" #extra>`). 03-10 adds the matching `settings-extra` forwarding (`<template v-if="$slots['settings-extra']" #settings-extra>`) inside that same open tag. 03.1-01: the settings `useLocalStorage` uses `{ ...DEFAULT_CALENDAR_SETTINGS }` as defaults and the function form of `mergeDefaults` calling `sanitizeCalendarSettings`, and `useCalendarNavigation` receives a `showWeekends` getter. 03.1-04: `contextMenuOverlayElement` taken from `useContextMenu`; a `context-menu-overlay` scoped slot (`{ element }`) as the first `ContextMenuContent` branch, rendered only when the element is set and the slot is provided (the entry branch became `v-else-if`, items unchanged); `contextMenuOpen` and `interacting` (`isDragging \|\| isResizing \|\| isSelecting`) added to the `day-overlay` slot props; an optional `day-header-extra` scoped slot (`{ dayStr, isDayView }`) after `FullCalendarDayHeader` in each header cell. | 03-05, 03-07, 03-10, 03.1-01, 03.1-04 | Re-apply the prop, the `overlay-lane-width` binding, the forwarded slot template and the `toolbar-extra` and `settings-extra` forwardings after taking upstream's file; re-apply the settings import, the sanitised `mergeDefaults` and the `showWeekends` getter; re-add the `context-menu-overlay` branch before upstream's menu branches, the two extra `day-overlay` slot props and the `day-header-extra` slot in the header cell. |
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

## Phase 3.2 (Appearance & Untangle branding)

Built from `git log --grep="(03.2-" --name-only b4e003e6..HEAD`. Owner decision D-10 (no Syne) means no
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
| `e2e/command-palette.spec.ts` | Stopped-timer class assertion matches `bg-[color:var(--theme-color-accent-solid)]` instead of `bg-accent-300/70`. | 03.2-03 | Re-apply the regex. |
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
