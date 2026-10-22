---
phase: 02-sign-in-with-microsoft
plan: 03
subsystem: ui
tags: [vue, inertia, vitest, playwright, microsoft-entra]

requires:
  - phase: 02-sign-in-with-microsoft
    provides: "02-02 shared Inertia prop `microsoft` ({enabled} | {enabled, login_url, labels}) and lang/en/microsoft365.php copy"
provides:
  - "resources/js/m365/navigation.ts: navigateTo(url) full-page navigation helper"
  - "MicrosoftSignInButton.vue: Sign in with Microsoft button on SecondaryButton, driven by props.microsoft"
  - "Login.vue seam: one import plus one element after the form"
  - "e2e/microsoft-signin.spec.ts: CI off-switch guard (no button when env is absent)"
affects: [02-04, 02-09, 02-10, 02-11]

actuals:
  tokens: 2100
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Frontend fork layer lives under resources/js/m365/ and is imported into core pages by a single import + element seam"
    - "Cross-origin redirects go through a mockable navigateTo() (window.location.assign), never Inertia router/Link"

key-files:
  created:
    - resources/js/m365/navigation.ts
    - resources/js/m365/components/MicrosoftSignInButton.vue
    - resources/js/m365/components/MicrosoftSignInButton.test.ts
    - e2e/microsoft-signin.spec.ts
  modified:
    - resources/js/Pages/Auth/Login.vue

key-decisions:
  - "Button wraps the existing SecondaryButton (no copied class strings); only w-full justify-center added"
  - "href is login_url plus an encoded browser IANA timezone; query omitted when Intl reports none"
  - "The only raw colours are the four official Microsoft logo fills"

patterns-established:
  - "Component tests mock @inertiajs/vue3 usePage with a hoisted mutable props object and spy on Intl.DateTimeFormat"

requirements-completed: [AUTH-01]

coverage:
  - id: D1
    description: "Login page shows a full-width 'Sign in with Microsoft' button (logo, server labels) below the form when props.microsoft.enabled; clicking does a full-page navigation to login_url carrying the browser timezone"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "resources/js/m365/components/MicrosoftSignInButton.test.ts (6 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "With the integration unconfigured (CI Playwright env) the login page has no Microsoft button and 'Log in' stays visible"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "e2e/microsoft-signin.spec.ts (Playwright shard 4/8 passed in CI run 39854402712)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visual appearance of the button in light/dark themes on the real login page"
    verification: []
    human_judgment: true
    rationale: "Layout and theme fit are visual judgments; covered by the end-of-phase human verify"

duration: 70min
completed: 2026-10-23
status: complete
plan_head_before: f92508f0867d30de78e7fc478bc3c4a3d8029d19
plan_head_after: b336826f897b8fc23f076fe155174be18670a93e
---

# Phase 2 Plan 03: Sign in with Microsoft button and Login.vue seam Summary

**The login page now shows a full-width "Sign in with Microsoft" button (four-square logo, copy from the server `microsoft` prop) built on SecondaryButton that performs a full-page navigation with the browser timezone, and renders nothing when the integration is off; Login.vue changed by exactly two added lines.**

## Accomplishments

- `navigateTo()` wraps `window.location.assign` so the cross-origin OAuth redirect never goes through Inertia XHR and Vitest can mock it.
- `MicrosoftSignInButton.vue` reads `usePage().props.microsoft`, renders only when `enabled`, uses `labels.sign_in` / `labels.sign_in_hint` (no hard-coded copy, D-18) and builds `login_url?timezone=<encoded IANA zone>`.
- `Login.vue` seam: one import, `<MicrosoftSignInButton />` after `</form>` (`git diff --numstat d866733b` = 2 added, 0 deleted).
- Playwright guard asserts no `microsoft-sign-in` element and a visible "Log in" button when no `SOLIDTIME_MICROSOFT_*` env is set.

## Task Commits

1. **Task 1 RED: failing spec** - `42580637` (test)
2. **Task 1 GREEN: button + navigation helper** - `172b9a1c` (feat)
3. **Task 1 fix: noUncheckedIndexedAccess in spec** - `219c6e8a` (fix)
4. **Task 2: Login.vue seam + e2e guard** - `b336826f` (feat)

## Verification Evidence

- Local: `vitest run resources/js/m365` 6 passed; eslint (0 errors; one pre-existing `vue/require-default-prop` warning on Login.vue `status`, not introduced here); `prettier --check` and `npm run format:check` clean; `npm run type-check` clean; `playwright test --list` lists 1 test (shard 4/8).
- Acceptance greps: SecondaryButton = 3, `bg-button-secondary-background` = 0, `<Link|router.get|router.visit` = 0, literal "Sign in with Microsoft" = 0, `MicrosoftSignInButton` in Login.vue = 2.
- Gate A for `b336826f`: `NPM Test Unit=success;PHP Linting=success;PHPUnit Tests=success;Static code analysis (PHPStan)=success`. All other workflows (NPM Typecheck, Format Check, Lint, Build, Fork - Build image) also success.
- Gate B (`MicrosoftLoginPageTest`): 3.
- Playwright Tests workflow (not one of the plan gates): 6/8 shards passed including shard 4 which holds `microsoft-signin.spec.ts`. Shards 1 and 3 hung in the "Install Playwright Browsers" step (runner/infra, 40+ min, also on the previous commit's run and again on a rerun); I cancelled the run. None of those shards run this plan's spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spec failed `npm run type-check` (TS2532 on `mock.calls[0][0]`)**
- **Found during:** Task 2 verification
- **Fix:** `String(navigateTo.mock.calls[0]?.[0])`
- **Files modified:** resources/js/m365/components/MicrosoftSignInButton.test.ts
- **Commit:** `219c6e8a`

### Notes

- TDD RED was committed separately (`42580637`) as a test-only commit that fails on the missing component; GREEN followed in `172b9a1c`.
- Used `-R UntangleSL/solidtime` for `gh` calls (per dispatch) instead of relying on cwd inference.

## Authentication Gates

None.

## Requirements

AUTH-01 is marked complete: the user-visible entry point exists end to end on the frontend (prop -> button -> full-page navigation to the 02-01/02-02 redirect route).

## Known Gaps (not stubs)

- `MicrosoftOAuthGateway` still has no production binding until 02-04, so with the Microsoft env configured the redirect route fails with a container error (HTTP 500). Do not set the Microsoft env vars in Dokploy before 02-04 lands (same caveat as 02-02).
- Visual check of the button on the real page is left to the end-of-phase human verification.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-02-41, T-02-42, T-02-SC). No packages installed.

## Self-Check: PASSED

- FOUND: all 5 files from `files_modified`
- FOUND: commits `42580637`, `172b9a1c`, `219c6e8a`, `b336826f` are ancestors of HEAD
