# Upstream merge procedure (solidtime-io/solidtime into the Untangle fork)

## Purpose

The fork keeps taking solidtime updates. This is the procedure to merge upstream `main` into
`feature/m365-integration`, release the result and roll it back if needed. It was first followed for
the 2026-11-26 merge (plan 07-01) and is written so a maintainer can repeat it without the plan.

The rule that keeps merges small: every fork change to an upstream file is a row of the ledger
`docs/m365/TOUCHED-CORE-FILES.md`, everything else lives in fork-owned paths, and a conflict outside
the ledger is fixed before merging, not improvised during the merge (D-04).

## Prerequisites

- The `upstream` remote, added once:
  `git remote add upstream https://github.com/solidtime-io/solidtime.git`
- The portable PHP toolchain with `composer.phar` (no system PHP on the maintainer's machine):

  ```bash
  export PHP_TOOLCHAIN_DIR="${PHP_TOOLCHAIN_DIR:-C:/Users/<you>/.local/solidtime-php-toolchain}"
  export PHP_BIN="$PHP_TOOLCHAIN_DIR/phprun/php.exe"
  export COMPOSER_PHAR="$PHP_TOOLCHAIN_DIR/composer.phar"
  export COMPOSER_HOME="$PHP_TOOLCHAIN_DIR/composer-home"
  export MSYS_NO_PATHCONV=1   # Git Bash: keeps <sha>:<path> arguments intact
  ```

- Node and the repository's `node_modules` for the frontend checks.
- `gh` is used read-only and always with `-R UntangleSL/solidtime`. Once the `upstream` remote
  exists, a bare `gh run list` or `gh workflow list` resolves to solidtime-io/solidtime and shows
  the wrong repository.
- A clean working tree on `feature/m365-integration` (`git status --porcelain` prints nothing tracked).

## 1. Preview

```bash
git fetch upstream --no-tags
UPSTREAM_SHA=$(git rev-parse upstream/main)   # pin it: every later command uses this sha
UPSTREAM_REF="$UPSTREAM_SHA" sh tests/Tools/m365-merge/ledger-check.sh
git diff --name-only --diff-filter=A "$(git merge-base HEAD "$UPSTREAM_SHA")" "$UPSTREAM_SHA" -- .github/workflows
```

`ledger-check.sh` prints `ledger-check: OK (modified <n>, added <m>, conflicts <k>)` when the ledger
explains the fork. Its findings:

| Finding | Meaning | Fix before merging |
| --- | --- | --- |
| `NOT IN LEDGER: <path>` | The fork modified, deleted or renamed an upstream file that has no ledger row. | Add the row (change and merge note), or move the change behind a fork seam. |
| `NOT COVERED: <path>` | The fork added a file that no ledger row or ledgered directory names. | Add the path or its directory to a "Fork-owned paths" table. |
| `CONFLICT OUTSIDE LEDGER: <path>` | The merge preview conflicts in a file the ledger does not name. | Stop. Ledger it with a merge note, or move the fork change behind a seam, then preview again (D-04). |

The workflow diff must print nothing: a new upstream workflow file would run on the fork
automatically with access to the fork's secrets. If it lists a file, disable that workflow on the
fork right after the merge (`gh workflow disable <name> -R UntangleSL/solidtime`) and say so in
the merge commit body.

`git merge-tree --write-tree --name-only --no-messages HEAD "$UPSTREAM_SHA"` alone shows the
conflicting files (exit 1, first line is the tree id) without touching the working tree.

## 2. Merge

```bash
git checkout feature/m365-integration
git merge --no-ff --no-commit "$UPSTREAM_SHA"
```

Merge the pinned sha, never the moving `upstream/main` ref, and never rebase the fork onto upstream.
The merge commit must reach `feature/m365-integration` with both parents: never squash or rebase it
when integrating it from a work branch (fast-forward or a regular merge only). A flattened merge
makes every later upstream merge conflict again on every file upstream changed.

Every upstream change arrives already staged by git. Edit only the conflicted files, stage them by
path (`git add <file> ...`, never `git add -A` or `git add .`) and conclude with `git commit`; the
subject names the upstream sha, the body lists each conflict and its resolution.

## 3. Conflicts

Follow the ledger row's merge note for each conflicted file: take upstream's file and re-apply the
fork seam it describes. The 2026-11-26 recipe for the four files that conflicted:

| File | Recipe |
| --- | --- |
| `composer.json` | Keep upstream's requirement lines and re-add the fork's two (`laravel/socialite`, `socialiteproviders/microsoft`) in alphabetical place. |
| `composer.lock` | Never hand-merge: section 4. |
| `resources/js/Pages/Auth/Login.vue` | `git checkout --theirs` the file, then re-add the `MicrosoftSignInButton` import, `canRegister?: boolean` with default `false` in the typed props, `v-if="canRegister"` on the register link and `<MicrosoftSignInButton />` right after `<slot name="alternatives" />`. Without the `canRegister` prop the "Register here!" link shows for everyone. |
| `resources/js/Pages/Profile/Show.vue` | `git checkout --theirs` the file, then re-add the `MicrosoftConnectionForm` import and `<MicrosoftConnectionForm />` right before `<LogoutOtherBrowserSessionsForm`. |

Then `npx prettier --write` on the Vue files you resolved, and confirm no conflict marker is left:
`git grep -n -e '^<<<<<<< ' -e '^>>>>>>> ' -- composer.json composer.lock resources/js`.

## 4. Lock

```bash
git checkout --theirs composer.lock
"$PHP_BIN" "$COMPOSER_PHAR" update laravel/socialite socialiteproviders/microsoft \
    --no-scripts --no-install --ignore-platform-reqs --no-interaction
```

Name only the fork packages: never list laravel/passport (or any other upstream package) in that
command, because composer would move it past upstream's pin. Expected on 2026-11-26: "4 installs,
0 updates" (laravel/socialite, league/oauth1-client, socialiteproviders/manager,
socialiteproviders/microsoft). If the lock shows any version change of an upstream package, start
the lock step again.

## 5. Checks

Local, before committing the merge:

```bash
"$PHP_BIN" "$COMPOSER_PHAR" validate --no-check-publish   # also fails on an outdated lock
npx vitest run && npm run type-check
npx eslint resources/js/Pages/Auth/Login.vue resources/js/Pages/Profile/Show.vue
npx prettier --check resources/js/Pages/Auth/Login.vue resources/js/Pages/Profile/Show.vue
UPSTREAM_REF="$UPSTREAM_SHA" sh tests/Tools/m365-merge/ledger-check.sh   # conflicts 0 after the merge
```

The PHP gates run in CI: the local `vendor/` still holds the pre-merge packages until
`composer install` runs against the merged lock.

In CI, after the merge is pushed to `feature/m365-integration`, the ten active workflows must be
green on the pushed sha (Gate W):

```bash
SHA=$(git rev-parse origin/feature/m365-integration) && gh run list -R UntangleSL/solidtime --commit "$SHA" --limit 40 --json workflowName,conclusion --jq '[.[] | select(.workflowName=="PHPUnit Tests" or .workflowName=="PHP Linting" or .workflowName=="Static code analysis (PHPStan)" or .workflowName=="NPM Test Unit" or .workflowName=="NPM Lint" or .workflowName=="NPM Typecheck" or .workflowName=="NPM Format Check" or .workflowName=="NPM Build" or .workflowName=="Playwright Tests" or .workflowName=="Fork - Build image") | .workflowName+"="+.conclusion] | unique | sort | join(";")'
```

Expected output, exactly:
`Fork - Build image=success;NPM Build=success;NPM Format Check=success;NPM Lint=success;NPM Test Unit=success;NPM Typecheck=success;PHP Linting=success;PHPUnit Tests=success;Playwright Tests=success;Static code analysis (PHPStan)=success`

And the Microsoft365 test classes really ran (Gate B), once per Postgres version of the PHPUnit
matrix (15, 16, 17 and 18 since the 2026-11-26 merge):

```bash
RID=$(gh run list -R UntangleSL/solidtime --commit "$SHA" --workflow "PHPUnit Tests" --limit 1 --json databaseId --jq '.[0].databaseId') && gh run view -R UntangleSL/solidtime "$RID" --log > "phpunit-$SHA.log" && grep -c -e "PASS.*Tests.Feature.Microsoft365." -e "PASS.*Tests.Unit.Microsoft365." "phpunit-$SHA.log"
```

On 2026-11-26 the floor was 180 (45 Microsoft365 classes times 4 jobs); raise it when classes are
added. A red test is attributed by name: a fork test broken by an upstream behaviour change is fixed
in fork files; an upstream test failing for an upstream reason is reported, not patched in core.

## 6. Fork image

`docker/prod/Dockerfile` (upstream-owned) declares `ARG MIN_PHP_VERSION=8.3.37` and fails the build
when the base image's PHP is older. If "Fork - Build image" fails on that check because the
FrankenPHP base image lags, the escape hatch is fork-owned: add one line under `build-args` in
`.github/workflows/fork-image.yml`,

```yaml
          build-args: |
            DOCKER_FILES_BASE_PATH=docker/prod/
            MIN_PHP_VERSION=<the base image's PHP version>
```

push, and run Gate W again. Remove the line once the base image catches up. Never edit the
Dockerfile for it. The image is published as `ghcr.io/untanglesl/solidtime:sha-<7-char commit>`.

## 7. Release

1. Write a short summary in Spanish for the owner (D-02): fixes and features users will notice, the
   new migrations and what they change in the data, new environment variables (and whether any is
   required). Get the owner's go-ahead.
2. Take a Dokploy database backup of the compose database right before deploying (D-03), and note
   its name and time. Upstream migrations run on start (`AUTO_DB_MIGRATE`) and some are one-way.
3. Pin the compose `docs/deploy/dokploy-compose.fork.yml` to the green image tag (`app`,
   `scheduler` and `queue`) with a header line for the release, and update the Dokploy compose.
4. Deploy.
5. Public checks: the login page with the Microsoft button, Microsoft sign-in end to end, the
   calendar with Outlook meetings, the profile Microsoft 365 card, the browser-extension login
   (Microsoft sign-in, then back to `/oauth/authorize`), and container health of `app`,
   `scheduler` and `queue`.

## 8. Rollback

Rolling back the image alone is not enough: upstream migrations stay applied. A rollback is both
steps (D-03):

1. Put the previous image tag back in the compose for `app`, `scheduler` and `queue`
   (for the 2026-11-26 merge: `ghcr.io/untanglesl/solidtime:sha-d379903`) and redeploy.
2. Restore the pre-deploy database backup:
   - Dokploy backup: stop `app`, `scheduler` and `queue`; in the compose's database backups,
     restore the backup taken in section 7 step 2 into the compose database; start the services.
   - A `pg_dump -Fc` file: stop `app`, `scheduler` and `queue`, copy the file into the database
     container and run
     `pg_restore --clean --if-exists --no-owner -U "$DB_USERNAME" -d "$DB_DATABASE" /tmp/<backup-file>.dump`
     inside it (the names come from the Dokploy Environment), then start the services.
3. Check the login page and one calendar week, and record the rollback in the history below.

Revert the merge on `feature/m365-integration` with `git revert -m 1 <merge sha>` only if the fork
must stay on the old upstream; reverting a merge makes the next merge of the same upstream commits
require reverting the revert first.

## 9. Merge history

| Date | Upstream sha | Merge base | Conflicts | Release image |
| --- | --- | --- | --- | --- |
| 2026-11-26 | `d0f5e745` | `b46f0157` | `composer.json`, `composer.lock`, `resources/js/Pages/Auth/Login.vue`, `resources/js/Pages/Profile/Show.vue` | filled in by 07-06 |
