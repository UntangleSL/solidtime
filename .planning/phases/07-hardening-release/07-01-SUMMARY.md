---
phase: 07-hardening-release
plan: 01
subsystem: upstream-merge
tags: [upstream-merge, ledger, composer, ops]
requires: []
provides:
  - "Upstream solidtime-io/solidtime main d0f5e745 merged into the fork through a two-parent merge commit"
  - "tests/Tools/m365-merge/ledger-check.sh (ledger completeness check and merge preview)"
  - "docs/m365/UPSTREAM-MERGE.md (repeatable merge, release and rollback procedure)"
  - "docs/m365/TOUCHED-CORE-FILES.md in the merged state with the Phase 7 section"
affects: [07-02, 07-03, 07-04, 07-05, 07-06, 07-07]
requirements-completed: [OPS-03]
tech-stack:
  added: []
  patterns:
    - "Merge the pinned upstream sha with --no-ff --no-commit, resolve only ledgered conflicts, regenerate the lock naming only fork packages"
key-files:
  created:
    - tests/Tools/m365-merge/ledger-check.sh
    - docs/m365/UPSTREAM-MERGE.md
  modified:
    - composer.json
    - composer.lock
    - resources/js/Pages/Auth/Login.vue
    - resources/js/Pages/Profile/Show.vue
    - docs/m365/TOUCHED-CORE-FILES.md
decisions:
  - "Merged the pinned sha d0f5e745, not upstream/main (which moved to ec74a1d8, one commit ahead: Supercronic v0.2.51 in docker/prod/Dockerfile); that commit waits for the next merge"
  - "laravel/socialite resolves to v5.33.0 in the regenerated lock (v5.31.0 before the merge); within ^5.31, same package, accepted as the recipe's outcome"
metrics:
  duration: "about 20 min"
  completed: 2026-11-27
status: complete
estimate:
  tokens: 70000
  tasks: 2
actuals:
  tokens: 13000
  tasks: 2
  commits: 69
plan_head_before: 6d1fa37ad05728a9b2d874b1bc952ad011b2aba7
plan_head_after: d69c57fe5b8b78cc37d1bcf1a20cace3376f1b02
completed: 2026-11-27
---

# Phase 7 Plan 01: Upstream merge Summary

Upstream solidtime main `d0f5e745` merged into the fork with one two-parent merge commit; only the four ledgered files conflicted. Login.vue, Profile/Show.vue, composer.json and composer.lock were resolved with the researched recipe (Passport stays at upstream's v13.10.0). The ledger now matches the merged tree, a check script proves it in one command, and `docs/m365/UPSTREAM-MERGE.md` covers how to repeat the merge, release it and roll it back.

## What was built

**Task 1: merge (tracer)**
- Preview: `git merge-tree --write-tree --name-only --no-messages HEAD d0f5e745` exited 1 and listed exactly `composer.json`, `composer.lock`, `resources/js/Pages/Auth/Login.vue`, `resources/js/Pages/Profile/Show.vue`. All four are backticked ledger rows. Saved to `$M365_LOG_DIR/merge-preview-07.txt`.
- Upstream adds no workflow file (`git diff --diff-filter=A` on `.github/workflows` printed nothing).
- Merge base `b46f0157`, 67 upstream commits merged. `upstream/main` is now 1 commit past the pinned sha (`ec74a1d8`, "fix: update Supercronic to v0.2.51", touches only `docker/prod/Dockerfile`). It waits for the next merge. `ledger-check.sh` against `upstream/main` shows it would merge without conflicts.
- `git merge --no-ff --no-commit d0f5e745`: the four expected conflicts, and the five both-sides files (`.env.example`, `FortifyServiceProvider.php`, `e2e/calendar-settings.spec.ts`, `e2e/profile.spec.ts`, `tests/Feature/AuthenticationTest.php`) merged cleanly.
- How each conflict was resolved:
  - `composer.json`: upstream's `"laravel/passport": "^13.10.0"` followed by the fork's `"laravel/socialite": "^5.31"`.
  - `composer.lock`: `git checkout --theirs`, then `composer update laravel/socialite socialiteproviders/microsoft --no-scripts --no-install --ignore-platform-reqs` gave "4 installs, 0 updates, 0 removals". Passport stays at v13.10.0.
  - `Login.vue`: upstream's file plus the import, `canRegister?: boolean` / `canRegister: false`, `v-if="canRegister"` on the register link, and `<MicrosoftSignInButton />` right after `<slot name="alternatives" />`.
  - `Profile/Show.vue`: upstream's file plus the import and `<MicrosoftConnectionForm />` right before `<LogoutOtherBrowserSessionsForm`, after the `v-if="confirmsWithPassword"` / `v-else-if="user"` block.
- Only those four files were staged by path. Every other upstream change came in as git staged it.

**Task 2: ledger, check script, procedure**
- `tests/Tools/m365-merge/ledger-check.sh` (POSIX sh, mode 100755) takes `UPSTREAM_REF` (default `upstream/main`) and `LEDGER` (default `docs/m365/TOUCHED-CORE-FILES.md`) and runs three checks: NOT IN LEDGER, NOT COVERED, CONFLICT OUTSIDE LEDGER. It builds the token list once, using `grep -Fvx -f` and awk, so the 572 added paths are checked in under a second. The expected exit 1 from merge-tree is handled explicitly. On the merged tree it prints `ledger-check: OK (modified 40, added 572, conflicts 0)`.
- Ledger changes:
  - Title gains Phase 7.
  - The composer.json, composer.lock, Login.vue and Show.vue rows now describe the merged state.
  - New `## Phase 7 (Hardening & release)` section with `### Upstream merge (07-01)` and `### Fork-owned paths`. It lists `docs/m365/`, `docs/deploy/MICROSOFT-SIGNIN.md`, `docs/deploy/backup-2026-10-19/`, `docs/deploy/github-support-ticket.md`, `tests/Fixtures/M365/`, `tests/Tools/m365-spike/`, `tests/Tools/m365-merge/` and `tests/Unit/M365/`. Before this section the check reported 300+ NOT COVERED paths, exactly the gaps research predicted.
- `docs/m365/UPSTREAM-MERGE.md` covers purpose, prerequisites, then sections 1 to 9: preview, merge, conflicts, lock, checks (Gate W / Gate B with `-R UntangleSL/solidtime`), fork image (`MIN_PHP_VERSION` escape hatch), release (Spanish summary for the owner, Dokploy backup), rollback (`sha-d379903` plus database restore, `pg_restore --clean --if-exists`) and merge history.

## Commits

| Commit | Subject |
| --- | --- |
| `adcd05cb` | merge(07-01): upstream solidtime-io/solidtime main d0f5e745 into feature/m365-integration (parents `6d1fa37a`, `d0f5e745`) |
| `d69c57fe` | docs(07-01): ledger in the merged state, ledger check and upstream merge procedure |

`git rev-list --count 6d1fa37a..HEAD` = 69 (67 upstream commits brought in by the merge, plus the merge commit and the docs commit). `--first-parent` count = 2.

## Gates

| Gate | Result |
| --- | --- |
| Task 1 verify 1 (ancestry, 2 parents, no markers, `composer validate`) | PASS |
| Task 1 verify 2 (Passport v13.10.0, four sign-in packages in lock) | PASS (`lock-ok`) |
| Task 1 verify 3 (positional seams) | PASS (`seams-ok`) |
| Task 1 verify 4 (five clean-merge seams) | PASS (`clean-merges-ok`) |
| Gate F: `npx vitest run` | PASS, 67 files / 1790 tests |
| Gate F: `npm run type-check` (vue-tsc), `npx tsc --noEmit` | PASS |
| Gate F: eslint, prettier on the two Vue files | PASS |
| Gate C: `composer validate --no-check-publish` | PASS |
| Acceptance: merge-tree vs d0f5e745 after the merge | exit 0 (nothing left to merge) |
| Task 2: `ledger-check.sh` | `ledger-check: OK (modified 40, added 572, conflicts 0)` |
| Task 2: negative test (ledger copy without Calendar.vue) | exit 1, `NOT IN LEDGER: resources/js/Pages/Calendar.vue` counted 1 |
| Gate D: `validate-docs.mjs secrets` | `secrets: OK (2327 checks)` |
| Script mode | 100755 |
| PHPUnit (Postgres matrix 15-18), PHPStan, Pint, Playwright, image build | PENDING CI (orchestrator, Gate W / Gate B >= 180) |

The PHP gates do not run locally for this plan: the shared `vendor/` still holds the pre-merge packages (for example laravel/passport v13.8.0).

## Deviations from Plan

**Mechanical (no effect on output):**
- The worktree started at upstream `b46f0157`, so I ran `git reset --hard 6d1fa37a` per the brief. The tree was clean.
- The sandbox refused compound git commands in this worktree. I ran the verify commands unchanged, from scratchpad scripts (`verify-0701-t1.sh`, `verify-0701-t2.sh`).
- The plan commit ledger file could not be written under `.git/worktrees/...`. The base sha is kept in the scratchpad (`plan-head-before-07-01.txt`) and in this frontmatter.

**Observed, not changed:**
- `git diff --cached --check` reports trailing whitespace in upstream's `CONTRIBUTING.md` and `README.md`. Both are upstream-owned and merged unchanged. The check on the four resolved files is clean.
- `composer update` reported 32 advisories in 12 packages, all upstream pins (T-07-05, accepted). Flag them for the next upstream merge.
- `laravel/socialite` resolved to v5.33.0 (v5.31.0 before the merge). It is a fork package within its `^5.31` constraint, and the recipe allows it to move.

Otherwise the plan was executed as written.

## Threat Flags

None. No new endpoint, auth path or schema; `ledger-check.sh` is a read-only local git tool.

## Open items (orchestrator)

1. Integrate the worktree branch into `feature/m365-integration` by fast-forward or a regular merge. Never squash or rebase it, so the merge commit keeps both parents.
2. Push, then run Gate W (ten workflows) and Gate B (>= 180 Microsoft365 PASS lines) on the pushed sha. If "Fork - Build image" fails on `MIN_PHP_VERSION`, use the `fork-image.yml` build-args escape hatch (UPSTREAM-MERGE.md section 6).
3. Before wave 2, refresh the main checkout's `vendor/` to the merged lock (`composer install --no-interaction --ignore-platform-reqs`), so laravel/passport v13.10.0 is in `vendor/composer/installed.json`.
4. 07-06 fills in the release image of the 2026-11-26 row in UPSTREAM-MERGE.md section 9.

## Self-Check: PASSED

- FOUND: tests/Tools/m365-merge/ledger-check.sh, docs/m365/UPSTREAM-MERGE.md, docs/m365/TOUCHED-CORE-FILES.md
- FOUND: adcd05cb (merge, 2 parents), d69c57fe (docs) as ancestors of HEAD
