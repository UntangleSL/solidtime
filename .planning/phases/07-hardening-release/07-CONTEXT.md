# Phase 7: Hardening & Release - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the integration safe to hand to the whole Untangle team and keep the fork mergeable:
complete deletion cleanup (SEC-03), the impersonation guard verified end to end (SEC-04), a clean
off switch (OPS-02), fork isolation with a documented core-file ledger plus a real upstream merge
(OPS-03), the Entra spike cleanup deferred from Phase 1, and the scheduler/queue container
healthchecks carried over from Phase 6. No new user-facing features.

</domain>

<decisions>
## Implementation Decisions

### Upstream solidtime merge (OPS-03)
- **D-01:** The upstream merge is applied for real, not only rehearsed: merge current
  `solidtime-io/solidtime` main (HEAD `d0f5e745` on 2026-11-26) into `feature/m365-integration`,
  resolve conflicts only within `docs/m365/TOUCHED-CORE-FILES.md`, get all ten CI workflows green,
  then deploy to time.untangle.es (owner, 2026-11-26). — **Reversibility:** costly — upstream
  migrations run on the production database via AUTO_DB_MIGRATE; undoing means restoring the pre-merge
  image and a database backup.
- **D-02:** Before deploying the merge, the orchestrator shows the owner, in short Spanish, what the
  upstream changes bring (user-visible features and fixes, new migrations, new env vars). The deploy
  goes ahead after that unless the owner objects or a new env var needs the owner in the Dokploy UI.
- **D-03:** Take a Dokploy database backup (manual Postgres backup of the compose database) right
  before deploying the merged image, and record how to roll back (previous image tag sha-d379903 plus
  the backup) in the runbook.
- **D-04:** If upstream changed a ledgered core file, re-apply the fork's seam per the ledger's merge
  note; any conflict outside the ledger is a finding to fix (move the fork change behind a seam or add
  it to the ledger with a merge note). The ledger is updated to the merged state.

### Entra spike cleanup (roadmap criterion 5)
- **D-05:** The owner does the Entra portal steps himself, from an exact step-by-step guide in Spanish
  written by the orchestrator: remove the redirect URI `http://localhost/m365-spike/callback` and delete
  the client secret `spike-2026-10` (owner, 2026-11-26). The production secret and redirect URI stay.
- **D-06:** After the owner confirms, the orchestrator checks that Microsoft sign-in and Outlook Sync
  still work in production, marks the spike lines RETIRADO in `docs/m365/GUIA-ADMIN-ENTRA.md`, and adds
  a Historial row to `docs/m365/RUNBOOK-entra-app.md`. This is a human checkpoint in the plan.

### Impersonation (SEC-04)
- **D-07:** Keep the current behaviour: while an admin impersonates a user, the calendar shows no
  Outlook lane, no Sync/Connect controls and no note — it looks like plain solidtime (owner is the only
  admin and has no preference, 2026-11-26). Time entries stay visible as in core.
- **D-08:** `GraphAccessGuard` (Phase 3 D-22) already gates the token service, sync, meeting endpoints,
  conversions, series, out-of-sync and the shared calendar prop. Phase 7 audits every Outlook entry
  point against it (including the daily `m365:check-out-of-sync` job and queued jobs, which run with no
  session and must never be triggered by an impersonated request) and adds a test matrix proving no
  Graph call and no meeting data leaves while impersonating.

### Deletion scope (SEC-03)
- **D-09:** Microsoft data belongs to the user, not to an organization. Deleting a user removes all of it
  (identity, tokens, cached meetings, sync windows, links, series settings) through FK cascades.
  Deleting an organization or removing a member removes the meeting links of that organization (their
  time entries go with core), while the user's own Microsoft account, cached meetings, sync windows and
  series settings stay as long as the user exists, because the user can still sign in with Microsoft and
  belongs to the Untangle tenant (orchestrator decision under the owner's standing autonomy, 2026-11-27;
  Untangle runs a single organization, so this case does not arise in practice). ROADMAP criterion 1's
  "their" reads as the deleted user's data and the deleted organization's links.

### Claude's Discretion
- Deletion cleanup details: which tables are removed on user deletion, organization deletion and member
  removal (identity, tokens, cached meetings, sync windows, meeting links, series settings, out-of-sync
  state), and whether through FK cascades or `DeletionService` hooks; time entries themselves follow
  core rules and are never deleted by fork code.
- Off-switch behaviour: with the env vars unset, all fork data stays in the database untouched and
  reappears when re-enabled; nothing Microsoft-related renders or is scheduled (including the 05:30
  daily job and the Outlook icon on entries); routes answer 404 as today.
- Scheduler/queue healthchecks: fix the `unhealthy` status of the scheduler and queue containers (the
  image healthcheck probes HTTP, which those modes do not serve) in the fork compose file, not in core
  Docker files where avoidable.
- Fork-module isolation and any refactor needed to keep core edits to seams.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` §"Phase 7: Hardening & Release" — goal and five success criteria
- `.planning/REQUIREMENTS.md` — SEC-03, SEC-04, OPS-02, OPS-03
- `.planning/PROJECT.md` — constraints (mergeability, data safety, security)
- `.claude/CLAUDE.md` — project constraints, conventions, data-safety rule

### Fork seams and merge
- `docs/m365/TOUCHED-CORE-FILES.md` — ledger of every core file the fork edits, with merge notes
- `docs/deploy/dokploy-compose.fork.yml` — production compose (image pin, scheduler/queue services)
- `docker/prod/deployment/healthcheck`, `docker/prod/deployment/start-container` — container modes and
  the current healthcheck

### Entra and operations
- `docs/m365/GUIA-ADMIN-ENTRA.md` — admin guide; spike lines to mark RETIRADO
- `docs/m365/RUNBOOK-entra-app.md` — runbook and Historial table
- `docs/deploy/MICROSOFT-SIGNIN.md` — env vars and off-switch behaviour as deployed

### Earlier decisions
- `.planning/phases/03-*/03-CONTEXT.md` — D-22 impersonation guard, D-14 404 behaviour
- `.planning/phases/06-out-of-sync-detection/06-CONTEXT.md` — daily job, out-of-sync state that
  deletion must also remove

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/Microsoft365/Graph/GraphAccessGuard.php`: single impersonation check (fails closed), already
  used by controllers, token service and `ShareMicrosoftInertiaData`.
- `app/Microsoft365/MicrosoftConfig.php::isConfigured()` / `missingKeys()`: the off-switch source.
- `app/Service/DeletionService.php`: core user/organization deletion path to hook into.
- `app/Microsoft365/Microsoft365ServiceProvider.php`: registers routes, schedule (callAfterResolving)
  and middleware; the natural place to gate everything on `isConfigured()`.

### Established Patterns
- Fork code lives in `app/Microsoft365/**` and `resources/js/m365/**`; core edits are slots/seams
  listed in the ledger.
- CI is the only place Feature PHPUnit (Postgres) and Playwright run; Gate B counts
  `PASS.*Microsoft365` lines.
- Deploys: compose-update + compose-deploy via the Dokploy MCP; never edit the Dokploy Environment
  (owner does that in the UI).

### Integration Points
- No `upstream` git remote exists yet; add `https://github.com/solidtime-io/solidtime.git`.
- Filament impersonation (`stechstudio/filament-impersonate`) in `app/Filament/Resources/UserResource*`.

</code_context>

<specifics>
## Specific Ideas

- The owner wants to receive solidtime's own improvements, so the merge is a real update (D-01), with a
  short Spanish summary of what changes before it goes live (D-02).

</specifics>

<deferred>
## Deferred Ideas

- Non-series meeting suggestions feedback (owner will send later; Phase 5 tuning, not Phase 7).
- Drag-to-wrong-hour report (12:00 → 4:00) could not be reproduced; reopen only if it happens again.

</deferred>

---

*Phase: 07-hardening-release*
*Context gathered: 2026-11-26*
