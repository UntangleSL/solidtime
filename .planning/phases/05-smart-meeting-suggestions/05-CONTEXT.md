# Phase 5: Smart Meeting Suggestions - Context

**Gathered:** 2026-11-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Make converting Outlook meetings mostly a matter of confirming: recurring meetings come pre-assigned from the series' own history, and other meetings get a project (and client) suggested from the user's past conversions. Covers RULE-01..05 as revised on 2026-11-17. Builds on the Phase 4 conversion path (mini form, multi-assign, `outlook_meeting_links`). Out-of-sync detection is Phase 6. An AI "propose my week" button is v2 (PROD-05), not this phase.

</domain>

<decisions>
## Implementation Decisions

### Direction (owner, 2026-11-17)
- **D-01:** Owner asked that recurring meetings open the mini form "already filled", and for an engine that suggests client → project from names, emails and so on. Offered three layers (series history, learned engine, AI button); owner had no strong preference and delegated. Chosen: series history + learned engine now; AI button deferred (PROD-05) until the engine's hit rate is known. Reason: most meeting time is recurring or with known people; history is instant, free, private and needs no setup.

### Series pre-assignment (RULE-01, RULE-02)
- **D-02:** No manual "assign this series" rule is required. Once the user converts any occurrence of a series (same `seriesMasterId`, Phase 1 series key), every other unassigned occurrence of that series in view (past and future) shows pre-assigned with the most recent conversion's project, task, tags and billable.
- **D-03:** Pre-assigned meetings are never converted automatically. The lane shows them distinctly (e.g. the project colour/name on the block and a "Confirm" affordance); confirming one is one click (no form) and goes through the Phase 4 convert endpoint; "Edit" opens the mini form prefilled with the pre-assignment.
- **D-04:** Bulk confirm: one action confirms all pre-assigned meetings visible in the current day/week, reusing the Phase 4 per-meeting results UI (created / existing / failed + retry).
- **D-05:** If the user converts an occurrence to a different project than the series' pre-assignment, the series follows the newest choice from then on (latest wins). Existing entries are never changed.

### Learned suggestions (RULE-03)
- **D-06:** For meetings without series history, the server ranks projects from the user's own links only (never other users' data), using signals: organizer, attendee email addresses and domains (external domains weigh more than the user's own tenant domains), and subject words. Simple, explainable scoring (counts/weights with recency), no ML library, no external service.
- **D-07:** The mini form opens prefilled with the top suggestion when it is confident enough; otherwise it keeps the Phase 4 behaviour (last-used project). Up to two alternatives are shown as quick picks. The form says briefly why ("Same series", "Like 4 meetings with @client.com", "Last used").
- **D-08:** Suggestions do not pre-assign meetings in the lane (only series history does, D-02); they prefill the form and the multi-assign form. Bulk "confirm" applies only to series pre-assignments.
- **D-09:** Attendee emails/names become part of the cached meeting data (Graph `$select` adds `attendees`, still within `Calendars.Read`). Stored only for the meeting owner, never shown to other users, purged with the meeting cache on disconnect (Phase 3 D-21) and with the user. Signals learned from links keep only what scoring needs (e.g. domains/addresses and normalised subject tokens), no meeting bodies.

### Ignore and control (RULE-04, RULE-05)
- **D-10:** "Always ignore this series" from the meeting menu/panel hides all its occurrences; undo is available from the "Show dismissed" view (consistent with Phase 3 dismiss).
- **D-11:** User can see why a meeting is pre-assigned/suggested, change a series' assignment (by converting/editing with another project, D-05) and "Forget this series" (removes the pre-assignment until the next conversion). No separate rules manager page in this phase unless research shows it is cheap; orphaned series need no UI.
- **D-12:** Nothing in this phase modifies or deletes existing time entries.

### Carried forward
- **D-13:** Fork isolation, ledgered core touches, fork endpoints outside `/api/v1` OpenAPI (Phase 3 D-17, Phase 4 D-12). English + Spanish lang keys.
- **D-14:** Privacy and impersonation rules unchanged (Phase 3 D-15/D-16/D-22): impersonation returns no suggestions and cannot confirm.
- **D-15:** Release ends with an owner-free deploy: the system is not in production yet, so the orchestrator deploys as soon as CI is green unless the owner must act first (owner, 2026-11-17).

### Claude's Discretion
- Storage shape for series assignments and learned signals (derive from `outlook_meeting_links` + stored meeting fields vs separate tables), confidence threshold, weights, tokenisation (Spanish + English stop words), how the reason text is built.
- Exact lane visuals for pre-assigned meetings, confirm/edit affordances, bulk-confirm placement (selection bar or toolbar), wording.
- Whether "Forget this series" lives in the menu, the panel or both.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — RULE-01..05 (revised 2026-11-17), PROD-05 (deferred AI button)
- `.planning/ROADMAP.md` — Phase 5 success criteria 1-5

### Prior decisions and code contracts
- `.planning/phases/04-assign-meetings-to-projects/04-CONTEXT.md` — conversion path, link table, per-meeting results, D-15 links survive disconnect
- `.planning/phases/04-assign-meetings-to-projects/04-UI-SPEC.md` — mini form, selection bar, batch results
- `.planning/phases/03-outlook-meetings-in-the-calendar/03-CONTEXT.md` — dismiss, privacy, impersonation, lane layout
- `docs/m365/DECISIONS-graph.md` — occurrence key, series key (`seriesMasterId`), binding `$select`
- `docs/m365/TOUCHED-CORE-FILES.md` — core-file ledger

</canonical_refs>

<code_context>
## Existing Code Insights

- `app/Microsoft365/Models/OutlookMeeting.php`, `Graph/GraphCalendarClient.php` (SELECT), `Graph/OutlookMeetingSyncService.php`: meeting cache and sync; `series_master_id` already stored.
- `app/Microsoft365/Http/Controllers/MeetingConversionController.php`, `OutlookMeetingLink` model: Phase 4 conversion and links.
- `resources/js/m365/calendar/OutlookConvertForm.vue`, `lastProject.ts`, `OutlookSelectionBar.vue`, `OutlookAssignResults.vue`, `useOutlookMeetings.ts`, `OutlookGhostLayer.vue`: Phase 4 UI to extend.

</code_context>

<specifics>
## Specific Ideas

- Owner wording: "el mini formulario debería en las reuniones periódicas ya automáticamente" and "un motor por detrás que según los nombres, emails implicados, etc... sugiera cliente -> proyecto".

</specifics>

<deferred>
## Deferred Ideas

- PROD-05: "Propose my day/week" AI agent button (Claude API) reviewing unassigned meetings against clients/projects, results shown in the multi-assign review. Revisit once the history engine's hit rate is known.

</deferred>
