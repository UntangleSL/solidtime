# Phase 8: Project Hour Budgets & Profitability - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Each client project carries its contract terms: the service sold, the amount sold (EUR), the hours
estimated for the contract and a renewal schedule (one-off, monthly, quarterly, annual). Inside a
contract period the hours are planned per month (not necessarily evenly) and rebalanced; the team's
billable time on the project consumes them. Managers see, per project, per client and per month,
hours planned vs consumed, money sold vs cost (margin), and a projection to the period close. The
phase also delivers team chargeability: per person, billable hours vs available hours from their
working week, against a target.

Owner decision (2026-11-27): the original Phase 8 (budgets) and the chargeability analysis ship
together as this phase. Assigning people to projects and occupancy per month (with holiday
calendars and days off) is a separate, large phase after this one (new Phase 9 in the roadmap).

</domain>

<decisions>
## Implementation Decisions

### Contract model
- **D-01:** A contract is the project itself. There is no separate contract entity. A project's
  contract terms: service description, amount sold (EUR) per period, hours sold/estimated per
  period, renewal schedule (one-off with start and end date, or renewing monthly, quarterly or
  annually), start date and optional end date. — **Reversibility:** costly — new tables and a
  migration; adding a contract entity later means moving terms off the project.
- **D-02:** Within one contract period the hours are planned per month and may be uneven (the owner
  typically plans more hours in the first months). The plan defaults to an even split and the
  project manager can rebalance it; overrunning one month is fine as long as the period total holds.
  The key output is the projection: within the hours sold, how much has been consumed and how much
  must still be consumed (or is projected to be consumed) by the period close.
- **D-03:** Each renewal starts clean: no hour balance carries from one contract period to the
  next. The finished period stays closed with its own result.
- **D-04:** A renewing project renews automatically at the start of each period with the same hours
  and amount, until someone sets an end date or archives the project. The terms of a future period
  can be changed before it starts.

### What counts
- **D-05:** On a billable client project every time entry is billable; non-billable time cannot be
  logged there. Work that also serves other projects or Untangle itself is split and logged to an
  internal Untangle project (non-billable). All time on the project counts against its contract.
  — **Reversibility:** costly — changes how existing entries on billable projects are treated;
  existing non-billable entries on billable projects need a decision during planning (report them,
  do not silently rewrite).
- **D-06:** Time logged to special projects "Vacaciones" and "Festivo" is absence: it lowers the
  person's available hours for chargeability and is not counted as internal non-billable time.
  Full holiday calendars per employee and marked days off come in the people-assignment phase.

### Money
- **D-07:** Profitability is shown in both hours and money. Hours are for people to regulate
  themselves; account managers and partners also see money, to see how the balance spreads across
  clients.
- **D-08:** Margin uses a cost per hour per person with an effective date: an Admin sets each
  person's hourly cost from a date; a later value applies from its date and past months keep the
  earlier one. — **Reversibility:** costly — dated cost table and migration.
- **D-09:** Currency is EUR (Claude's discretion unless the organization currency setting says
  otherwise; follow the existing organization currency).

### Roles and visibility
- **D-10:** Project manager and account manager are assignments, not new solidtime roles: a project
  has one or more project managers, a client has one or more account managers. solidtime's core
  roles and PermissionStore stay unchanged (mergeability). — **Reversibility:** costly — assignment
  tables; switching to global roles later would touch core permissions.
- **D-11:** Visibility:
  - Employee: nothing new in this phase (they keep seeing their own hours). Their assignment and
    available hours per project arrive with the people-assignment phase.
  - Project manager: the hour balances of the whole project(s) they manage (no money required).
  - Account manager: per client, money sold, project profitability and the global balance of their
    clients.
  - Owner/Admin: everything, plus configuration.
  - Placeholder members (people without an account, from imports or ex-staff) cannot log in and
    have no view; their past hours still count.
- **D-12:** Editing: the account manager sets amount sold, contract hours and renewal; the project
  manager distributes those hours across the months of the period; Owner and Admin can edit
  everything. Hourly costs and working weeks are Admin/Owner only.

### Chargeability
- **D-13:** Chargeability per person = billable hours / available hours. Available hours come from
  the person's working week (for example 40 h) with an effective date, minus absence hours (D-06).
  Each person has a chargeability target (for example 75 %), also dated.

### Where it lives
- **D-14:** A new page "Rentabilidad" with three views: by project (hours, money, projection to
  close), by client (account manager portfolio) and by person (chargeability). Plus a summary on
  each project's page. Labels in Spanish and English like the rest of the fork.

### Claude's Discretion
- Exact page layout, charts and table columns (reuse existing reporting/chart components).
- Where the Vacaciones/Festivo marker lives (a flag on the project is the likely shape).
- How the monthly plan is edited (grid of months is the expected shape).
- Projection method to period close (linear run rate vs remaining plan; show both if cheap).
- How existing upstream `estimated_time` on projects relates to contract hours (reuse or ignore,
  but do not break the upstream field).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` — Phase 8 goal and success criteria (refined 2026-11-27)
- `.planning/REQUIREMENTS.md` — BUDG-01..07 and CHRG-01..03 (refined 2026-11-27)
- `.planning/PROJECT.md` — mergeability constraint (fork code isolated)

### Fork isolation
- `docs/m365/TOUCHED-CORE-FILES.md` — ledger of core files the fork touches; every new core touch goes here
- `docs/m365/UPSTREAM-MERGE.md` — merge procedure; keep core touches minimal
- `tests/Tools/m365-merge/ledger-check.sh` — ledger gate

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/STRUCTURE.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/Models/Project.php`: already has `is_billable`, `billable_rate`, `estimated_time`, `spent_time`, `client_id`.
- `app/Models/Member.php`: per-organization person (includes placeholders), has `billable_rate` (sale rate, not cost).
- `app/Models/Goal.php` + `app/Enums/GoalPeriod.php` (day/week/month): upstream periodic targets with filters; useful pattern for periods and timezone/week start, not a replacement for contracts.
- `app/Service/TimeEntryAggregationService.php`, `app/Service/ReportService.php`, ECharts components under `resources/js`: aggregation and charts for the views.
- `app/Service/PermissionStore.php`: core roles (owner, admin, manager, employee, placeholder) — read, do not change.

### Established Patterns
- Fork code lives in its own module (`app/Microsoft365/`, `resources/js/m365/`) with thin core seams; Phase 8 follows the same shape in its own module.
- Scheduler jobs registered from the fork provider (as `m365:check-out-of-sync`) — the renewal of contract periods can follow that pattern.
- Spanish/English labels via `lang/en`, `lang/es`.

### Integration Points
- Billable enforcement on billable projects (D-05) hooks time entry create/update; prefer a fork-side listener over editing core controllers.
- Project page summary and the new "Rentabilidad" navigation entry are core UI seams to ledger.

</code_context>

<specifics>
## Specific Ideas

- "Lo normal es estimar los primeros meses más horas que los siguientes": the monthly plan must allow front-loading.
- "Lo importante es que dentro de las horas de contrato vendidas veamos y proyectemos a cierre cuánto tenemos que consumir."
- Example of a split task: 50 % for the client, 50 % reusable for other projects → two entries, one on the client project, one on an internal Untangle project.

</specifics>

<deferred>
## Deferred Ideas

- People assignment to projects and occupancy per month or period (employee sees their assignment
  and available hours per project) — new phase after Phase 8.
- Holiday calendar per employee and marked days off — with the assignment phase.

</deferred>

---

*Phase: 08-project-hour-budgets-profitability*
*Context gathered: 2026-11-27*
