---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 5
total_count: 7
last_updated: 2026-10-19T17:37:31.551Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 1 | stub | docs/m365/RUNBOOK-entra-app.md |  | Runbook values table holds PENDIENTE until the admin hands back the registration data; 01-05 fills it and 'validate-docs.mjs runbook --final' enforces it | fixed |  | 2026-10-19T14:02:25.994Z | 2026-10-19T17:37:31.008Z |
| 2 | 1 | stub | docs/m365/GUIA-ADMIN-ENTRA.md |  | Guide uses the marked token <DOMINIO-DOKPLOY> until the product owner decides the Dokploy public domain (replaced in 01-05) | fixed |  | 2026-10-19T14:02:26.604Z | 2026-10-19T17:37:31.551Z |
| 3 | 1 | unrun-verify | tests/Tools/m365-spike/capture.mjs |  | 01-02: npx --no-install prettier --check on tests/Tools/m365-spike/**/*.mjs not run (no node_modules on this host); files formatted by hand to .prettierrc.json, watch CI npm-format-check | fixed |  | 2026-10-19T14:17:44.637Z | 2026-10-19T17:36:37.906Z |
| 4 | 1 | unrun-verify | tests/Tools/m365-spike/validate-fixtures.mjs |  | 01-03: npx --no-install prettier --check on the seven new .mjs files not run (no node_modules on this host); formatted by hand to .prettierrc.json, watch CI npm-format-check | fixed |  | 2026-10-19T15:13:36.278Z | 2026-10-19T17:36:38.440Z |
| 5 | 1 | unrun-verify | tests/Tools/m365-spike/validate-docs.mjs |  | 01-04: npx --no-install prettier --check on validate-docs.mjs and its test not run (no node_modules on this host); formatted by hand to .prettierrc.json, watch CI npm-format-check | fixed |  | 2026-10-19T15:21:50.752Z | 2026-10-19T17:36:38.994Z |
| 6 | 1 | unrun-verify | tests/Unit/M365/CalendarViewFixturesTest.php |  | 01-08: vendor/bin/phpunit --filter CalendarViewFixturesTest not run (no PHP or Docker on the host); run in CI (phpunit.yml) or Sail. Node replay of every page sequence is green | open |  | 2026-10-19T17:36:39.537Z |  |
| 7 | 1 | deviation | docs/m365/RUNBOOK-entra-app.md |  | 01-08: Entra cleanup deferred by the owner (2026-10-19): redirect URI http://localhost/m365-spike/callback and secret spike-2026-10 remain registered; guide lines stay TEMPORAL; tracked as ROADMAP Phase 7 criterion 5 | open |  | 2026-10-19T17:36:40.089Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "1",
    "file": "docs/m365/RUNBOOK-entra-app.md",
    "line": null,
    "description": "Runbook values table holds PENDIENTE until the admin hands back the registration data; 01-05 fills it and 'validate-docs.mjs runbook --final' enforces it",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-19T14:02:25.994Z",
    "resolved_at": "2026-10-19T17:37:31.008Z",
    "milestone": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "1",
    "file": "docs/m365/GUIA-ADMIN-ENTRA.md",
    "line": null,
    "description": "Guide uses the marked token <DOMINIO-DOKPLOY> until the product owner decides the Dokploy public domain (replaced in 01-05)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-19T14:02:26.604Z",
    "resolved_at": "2026-10-19T17:37:31.551Z",
    "milestone": null
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "1",
    "file": "tests/Tools/m365-spike/capture.mjs",
    "line": null,
    "description": "01-02: npx --no-install prettier --check on tests/Tools/m365-spike/**/*.mjs not run (no node_modules on this host); files formatted by hand to .prettierrc.json, watch CI npm-format-check",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-19T14:17:44.637Z",
    "resolved_at": "2026-10-19T17:36:37.906Z",
    "milestone": null
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "1",
    "file": "tests/Tools/m365-spike/validate-fixtures.mjs",
    "line": null,
    "description": "01-03: npx --no-install prettier --check on the seven new .mjs files not run (no node_modules on this host); formatted by hand to .prettierrc.json, watch CI npm-format-check",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-19T15:13:36.278Z",
    "resolved_at": "2026-10-19T17:36:38.440Z",
    "milestone": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "1",
    "file": "tests/Tools/m365-spike/validate-docs.mjs",
    "line": null,
    "description": "01-04: npx --no-install prettier --check on validate-docs.mjs and its test not run (no node_modules on this host); formatted by hand to .prettierrc.json, watch CI npm-format-check",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-10-19T15:21:50.752Z",
    "resolved_at": "2026-10-19T17:36:38.994Z",
    "milestone": null
  },
  {
    "id": 6,
    "kind": "unrun-verify",
    "phase": "1",
    "file": "tests/Unit/M365/CalendarViewFixturesTest.php",
    "line": null,
    "description": "01-08: vendor/bin/phpunit --filter CalendarViewFixturesTest not run (no PHP or Docker on the host); run in CI (phpunit.yml) or Sail. Node replay of every page sequence is green",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-19T17:36:39.537Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "1",
    "file": "docs/m365/RUNBOOK-entra-app.md",
    "line": null,
    "description": "01-08: Entra cleanup deferred by the owner (2026-10-19): redirect URI http://localhost/m365-spike/callback and secret spike-2026-10 remain registered; guide lines stay TEMPORAL; tracked as ROADMAP Phase 7 criterion 5",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-19T17:36:40.089Z",
    "resolved_at": null,
    "milestone": null
  }
]
````
