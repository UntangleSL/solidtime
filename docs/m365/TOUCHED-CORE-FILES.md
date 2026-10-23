# Touched core files (Phase 2: Sign in with Microsoft)

Ledger for upstream merges. The Phase 7 merge rehearsal (and every later `git merge upstream/main`)
checks these files first. Everything else the fork adds lives in fork-owned paths (second table).

## Core files edited

| File | Change | Plan | Merge note |
| --- | --- | --- | --- |
| `composer.json` | Adds the `laravel/socialite` and `socialiteproviders/microsoft` requirements. | 02-04 | On a conflict take upstream's file, re-add the requirement, then regenerate the lock file. |
| `composer.lock` | Lock entries for the added packages. | 02-04 | Never hand-merge: take upstream's file and run `composer update` for the added packages to regenerate it. |
| `config/app.php` | One `use` line and one entry in the `providers` array for `Microsoft365ServiceProvider`. | 02-01 | Re-apply the two lines after the merge. |
| `resources/js/Pages/Auth/Login.vue` | One import and one element after the login form (the Microsoft button). | 02-03 | Re-apply the import and the element; keep the rest of upstream's template. |
| `resources/js/Pages/Profile/Show.vue` | One import and one element after the two-factor section (the Microsoft account card). | 02-10 | Re-apply the import and the element after upstream's two-factor section. |
| `.env.example` | Appended block with the seven `SOLIDTIME_MICROSOFT_*` names. | 02-09 | Keep the block at the end of the file. |

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
| `tests/Feature/Microsoft365/` | Feature tests. |
| `tests/Unit/Microsoft365/` | Unit tests. |
| `e2e/microsoft-signin.spec.ts` | Browser test of the sign-in page. |
| `docs/deploy/dokploy-compose.fork.yml` | Compose for Dokploy. |
| `.github/workflows/fork-image.yml` | Fork image build. |

## Hot files deliberately not touched (D-15)

Phase 2 does not edit these upstream hot spots, so they cannot conflict because of this phase:

- `app/Providers/FortifyServiceProvider.php`
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
