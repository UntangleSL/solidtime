---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-10-19T14:02:26.604Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 1 | stub | docs/m365/RUNBOOK-entra-app.md |  | Runbook values table holds PENDIENTE until the admin hands back the registration data; 01-05 fills it and 'validate-docs.mjs runbook --final' enforces it | open |  | 2026-10-19T14:02:25.994Z |  |
| 2 | 1 | stub | docs/m365/GUIA-ADMIN-ENTRA.md |  | Guide uses the marked token <DOMINIO-DOKPLOY> until the product owner decides the Dokploy public domain (replaced in 01-05) | open |  | 2026-10-19T14:02:26.604Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "1",
    "file": "docs/m365/RUNBOOK-entra-app.md",
    "line": null,
    "description": "Runbook values table holds PENDIENTE until the admin hands back the registration data; 01-05 fills it and 'validate-docs.mjs runbook --final' enforces it",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-19T14:02:25.994Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "1",
    "file": "docs/m365/GUIA-ADMIN-ENTRA.md",
    "line": null,
    "description": "Guide uses the marked token <DOMINIO-DOKPLOY> until the product owner decides the Dokploy public domain (replaced in 01-05)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-10-19T14:02:26.604Z",
    "resolved_at": null,
    "milestone": null
  }
]
````
