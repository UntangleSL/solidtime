---
phase: 07-hardening-release
plan: 07
subsystem: entra
tags: [entra, spike-cleanup, d-05, d-06, criterion-5]
requires: [07-06]
provides:
  - "Entra registration without the spike: 3 redirect URIs (production, solidtime.test, localhost) and 1 secret (produccion-2026-10)"
  - "docs/m365/GUIA-ADMIN-ENTRA.md: the six spike lines marked RETIRADO 2026-11-27"
  - "docs/m365/RUNBOOK-entra-app.md: Redirect URIs and spike-secret rows updated, four cleanup items ticked, Historial row"
affects: []
requirements-completed: []
key-files:
  created: []
  modified:
    - docs/m365/GUIA-ADMIN-ENTRA.md
    - docs/m365/RUNBOOK-entra-app.md
decisions:
  - "Only the spike URI and the spike secret were removed; the dev redirect URIs stay because development continues in parallel (owner, 2026-11-27)"
  - "The owner confirmed 3 URIs and 1 secret; Microsoft sign-in was not re-run after the cleanup because the production secret did not change. The Historial row says so instead of claiming a recheck"
status: complete
completed: 2026-11-27
---

# 07-07 Summary: Entra spike cleanup

The owner removed `http://localhost/m365-spike/callback` and the secret `spike-2026-10` from the
`solidtime-m365` registration in Entra, leaving three redirect URIs and the production secret.

Docs: the guide's six spike lines now read `RETIRADO 2026-11-27` (the URI text stays, as the
validator requires) and the runbook records the removal. Gates: `validate-docs guide` OK (117),
`runbook --final` OK (49), `secrets` OK (2344). Commit 18bb7fe1.

Not rechecked: a fresh Microsoft sign-in and Sync after the cleanup. It is part of the owner UAT
for Phase 7.
