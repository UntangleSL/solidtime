---
phase: 08-project-hour-budgets-profitability
plan: 03
subsystem: profitability-access
tags: [profitability, access-scope, assignments, project-manager, account-manager, settings]
requires:
  - "08-01: AccessScope, ProfitabilityAccess::forUser, provider that globs app/Profitability/routes, summary endpoint"
provides:
  - "Tables project_managers (unique project_id+member_id) and client_account_managers (unique client_id+member_id), index on member_id, 6 cascading FKs (organization, project/client, member)"
  - "Models App\\Profitability\\Models\\ProjectManager and ClientAccountManager (fillable project_id/client_id + member_id; member() and project()/client() relations)"
  - "ProfitabilityAccess::forUser is assignment-aware: placeholder/no member none, Owner/Admin full, any other role gets its project_managers and client_account_managers rows inside the organization (interface unchanged)"
  - "GET profitability/organizations/{organization}/settings/managers (profitability.settings.managers): {data: {clients[{id,name,account_managers[{member_id,name}]}], projects[{id,name,client_id,client_name,project_managers[...]}], members[{member_id,name,role}]}}"
  - "POST/DELETE .../settings/projects/{project}/managers[/{member}] (profitability.settings.project-managers.store|destroy) and .../settings/clients/{client}/account-managers[/{member}] (profitability.settings.account-managers.store|destroy), 204, idempotent"
  - "AssignmentRequest (member_id required uuid, memberId())"
  - "AccessScope decision table documented and pinned by a DB-free unit test"
affects: [08-02, 08-06, 08-09, 08-10, 08-12, 08-14]
requirements-completed: [BUDG-07, BUDG-06]
tech-stack:
  added: []
  patterns:
    - "Assignment rows, not roles: access comes only from Owner/Admin or fork rows; core PermissionStore and Role untouched"
    - "Scope check before body validation: the FormRequest is resolved from the container after the 404 gate so a non-admin never sees a 422"
    - "Idempotent writes: insertOrIgnore on a unique pair, delete-if-present"
key-files:
  created:
    - app/Profitability/database/migrations/2026_11_27_000002_create_profitability_assignment_tables.php
    - app/Profitability/Models/ProjectManager.php
    - app/Profitability/Models/ClientAccountManager.php
    - app/Profitability/Http/Controllers/AssignmentController.php
    - app/Profitability/Http/Requests/AssignmentRequest.php
    - app/Profitability/routes/assignments.php
    - tests/Feature/Profitability/ScopedSummaryAccessTest.php
    - tests/Feature/Profitability/AssignmentsTest.php
    - tests/Unit/Profitability/AccessScopeTest.php
  modified:
    - app/Profitability/Access/ProfitabilityAccess.php
    - app/Profitability/Access/AccessScope.php
decisions:
  - "The resolver ignores assignment rows whose project or client is not in the route organization (whereHas on the relation), on top of the row's own organization_id"
  - "A placeholder never gets access, even with a stale assignment row (role checked before the assignment reads)"
  - "AssignmentController resolves AssignmentRequest from the container after the full-scope check, so every non-admin gets a 404 even with an empty or invalid body (strict reading of D-16/T-08-06 over the plan's FormRequest-injection default)"
  - "Removal endpoints also 404 for a route member that is not a member of the organization; an existing member without the assignment is a 204"
  - "index lists project_managers/account_managers sorted by name (strnatcasecmp); assignments of members that no longer resolve are skipped"
  - "Member 422 message is core validation.exists; project_not_billable uses profitability.validation.project_not_billable (lang key owned by 08-02)"
metrics:
  duration: "about 35 min"
  completed: 2026-11-27
status: complete
completed: 2026-11-27
estimate:
  tokens: 95000
  tasks: 3
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: 5fe90595dbfcf519549f1608b6c9e77540fdad6d
plan_head_after: bf90265c
---

# Phase 8 Plan 03: Project and account manager assignments Summary

Project managers and account managers are rows in two fork tables, never solidtime roles. `ProfitabilityAccess` turns a member's rows into an `AccessScope`. A project manager, whatever their core role, reads the hours of the projects they manage and never sees money. An account manager reads every project of their clients and may edit the terms. A core Manager, Employee or placeholder with no assignment reaches nothing. Owner and Admin manage the assignments through five settings endpoints; every other caller gets a 404.

## What was built

- **Migration `2026_11_27_000002`**: `project_managers` and `client_account_managers`, each with `organization_id`, `project_id`/`client_id` and `member_id`. Every FK has `cascadeOnDelete()->cascadeOnUpdate()` (6 in total), with the 08-01 comment explaining why the cascade lives in the database. Unique pairs, an index on `member_id`, and a `down()` that drops both tables.
- **Models** `ProjectManager` and `ClientAccountManager`: `HasUuids`, fillable limited to the target id and `member_id`, `member()` plus `project()`/`client()` relations, not audited and not in Filament.
- **Resolver** `ProfitabilityAccess::forUser`:
  - no member or a placeholder gets `none()`
  - Owner/Admin get `full()`
  - every other role gets `new AccessScope(false, projectIds, clientIds)`, built from two queries. Each query reads the member's rows with the organization's `organization_id`, keeps only those whose project or client also belongs to that organization, and orders by id. There is no static cache.
- **AccessScope**: behaviour unchanged. The docblock now has the decision table (full / account manager / project manager / none) and references D-11, D-12 and D-16.
- **Settings endpoints** (`app/Profitability/routes/assignments.php`, picked up by the 08-01 provider's glob):
  - `GET /profitability/organizations/{organization}/settings/managers`: read throttle.
  - The `POST`/`DELETE` routes for project managers and account managers: `check-organization-blocked` plus the write throttle, and `whereUuid` on every id.
- **AssignmentController**:
  - Every action first requires `isFull()` and otherwise returns a 404.
  - `index` returns all clients with their account managers, the billable non-archived projects with client name and project managers, and the members without placeholders, each list sorted by name.
  - `add*`: a route project or client outside the organization is a 404. A non-billable project is a 422 on `project_id`. A body member who is a placeholder, belongs to another organization or is unknown is a 422 on `member_id`. Otherwise `insertOrIgnore` writes the row and the response is 204.
  - `remove*`: deletes the row if it exists and returns 204, so it is idempotent. A route project, client or member outside the organization is a 404.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 7f2eea5e | feat(08-03): project and account manager assignments drive profitability access |
| 2 | 2251eb7c | test(08-03): access scope decision table |
| 3 | bf90265c | feat(08-03): Owner and Admin assign project and account managers |

## Gates

- `php -l` on every new file: clean.
- Pint `--test app/Profitability tests/Feature/Profitability tests/Unit/Profitability`: passed.
- PHPStan, full app at level 7 with the worktree-first autoload: `[OK] No errors`. The new test files were also checked at level 7 with a scratch config; the only findings were `missingType.generics` on `TestResponse` helper return types, the same pattern as 08-01's ProjectSummaryTest. Tests are outside the CI PHPStan paths.
- Gate U: `phpunit tests/Unit/Profitability/AccessScopeTest.php` gave `OK (12 tests, 110 assertions)`. AccessScope needed no behaviour fix.
- Route check: `artisan route:list --path=profitability --json` with the node filter prints `5 4`, meaning five manager routes and four writes behind `CheckOrganizationBlocked`.
- Acceptance greps:
  - `cascadeOnDelete` in the migration: 6.
  - `ProjectManager::query()` / `ClientAccountManager::query()` in the resolver: 2.
  - `function test_`: ScopedSummaryAccessTest 7, AccessScopeTest 7 (12 cases with data providers), AssignmentsTest 12.
  - `D-16` in AccessScope: 2.
  - `insertOrIgnore` in the controller: 2.
  - No diff on `app/Service/PermissionStore.php` or `app/Enums/Role.php`.
- `tests/Feature/Profitability/ScopedSummaryAccessTest.php` (7 tests): **PENDING CI (orchestrator)**.
- `tests/Feature/Profitability/AssignmentsTest.php` (12 tests): **PENDING CI (orchestrator)**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Larastan model-property check on joined, table-qualified columns**
- **Found during:** Task 1 (Gate P)
- **Issue:** The first resolver version joined `projects`/`clients` and used qualified column names. `checkModelProperties` rejected those names in `where()`/`pluck()`, and `pluck()->all()` was not a `list`.
- **Fix:** The relation is constrained with `whereHas('project'|'client', whereBelongsTo($organization))`, unqualified columns are used, and the ids go through `array_values()`. It is still one statement per table.
- **Files modified:** app/Profitability/Access/ProfitabilityAccess.php
- **Commit:** 7f2eea5e

**2. [Rule 2 - Security] 404 before body validation on the assignment writes**
- **Found during:** Task 3
- **Issue:** Injecting `AssignmentRequest` into the action signature validates the body before the scope check. A non-admin sending an empty body would then get a 422 instead of the 404 that D-16/T-08-06 require.
- **Fix:** The POST actions take a plain `Request`, run the full-scope gate and the route lookups first, and only then resolve `AssignmentRequest` from the container. `AssignmentsTest` checks that an empty body from a non-admin returns 404.
- **Files modified:** app/Profitability/Http/Controllers/AssignmentController.php
- **Commit:** bf90265c

**3. [Rule 2 - Security] Placeholders never get access from a stale assignment row**
- **Found during:** Task 1
- **Issue:** A member turned into a placeholder after being assigned would still have kept the row's access.
- **Fix:** The role is checked before the assignment reads, and an extra test covers it: `test_placeholder_with_an_assignment_row_gets_nothing`.
- **Commit:** 7f2eea5e

Otherwise the plan was executed as written.

## Cross-plan dependencies (wave 2)

- `test_manager_role_without_assignment_gets_404_and_prop_disabled` checks that the dashboard Inertia prop `profitability` equals `['enabled' => false]`. The `ShareProfitabilityInertiaData` middleware comes from 08-02, which runs in parallel, so this assertion only passes once 08-02 is merged.
- The 422 message `profitability.validation.project_not_billable` uses the lang files owned by 08-02. Until they are merged, the message is the raw key; the status and the `project_id` error key do not depend on it.

## Known Stubs

None.

## Threat Flags

None. The new surface is the five settings routes, all covered by T-08-06 and T-08-09 in the plan's threat model.

## Open items

- ScopedSummaryAccessTest and AssignmentsTest are PENDING CI (orchestrator).

## Self-Check: PASSED

- FOUND: all 9 created files and the 2 modified files
- FOUND: 7f2eea5e, 2251eb7c, bf90265c (ancestors of HEAD)
