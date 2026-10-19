---
phase: 01-tenant-setup-outlook-spike
plan: 04
subsystem: testing
tags: [decision-document, traceability, doc-gates, node-test, manifest, claims]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-01 validate-docs.mjs table-driven dispatcher; 01-03 manifest.json shape (files index, scenarios, experiments), consumed as a documented contract with in-memory manifests only"
provides:
  - "validate-docs.mjs decisions [--trace] [--file <doc>] [--manifest <manifest>]: structure and traceability gate for docs/m365/DECISIONS-graph.md"
  - "Exports DECISION_HEADINGS (twelve required headings) and checkDecisions(text, { trace, manifest, exists })"
  - "44 new node:test cases (structure, trace, CLI); the spike test directory now runs 175 tests, 0 failures"
affects: [01-05, 01-08, phase-03, phase-04, phase-05]

actuals:
  tokens: 7300
  tasks: 2
  commits: 4
plan_head_before: 0c15770c45c067d04fa5acf7a10b5074fd9a8447
plan_head_after: 0aac5571b6dee9c991109041991922cbd5dd3f0e

tech-stack:
  added: []
  patterns:
    - "A Claim line is a machine-checked sentence: the decision document states a fact and the gate compares it with manifest.json"
    - "Unknown scenario, unknown path and malformed Claim lines fail instead of being skipped"
    - "Structure checks and trace checks share one checker, so the OK line counts both"

key-files:
  created: []
  modified:
    - tests/Tools/m365-spike/validate-docs.mjs
    - tests/Tools/m365-spike/test/validate-docs.test.mjs
    - .planning/WINDOWS.md

key-decisions:
  - "A line that starts with `Claim:` but does not match the syntax fails (a typo can never silently disable a claim)"
  - "A section needs a `Decision:` line with text after the colon, not just the label"
  - "Required headings must appear exactly once; a second copy fails"
  - "`decisions --trace` with a manifest that is missing, not JSON or not an object fails naming the manifest path, and the structure checks still run"
  - "The manifest file itself is not a citable path (only the files index, scenario files and lookup files are); claims about manifest values go through Claim lines"
  - "Scenario IDs in a Claim are alphanumeric as the plan's regex specifies, so a Claim cannot name a SYN-* scenario (those are synthetic and need no citation)"

patterns-established:
  - "Reasons of the doc gates are in Spanish like the other validate-docs checks; the decision document and its headings are English"

requirements-completed: []

coverage:
  - id: D1
    description: "decisions checks the twelve required headings, each with a Decision line and an Evidence line citing a backticked tests/Fixtures/M365/ path (ReadBasic may cite a learn.microsoft.com URL)"
    requirement: SETUP-03
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/validate-docs.test.mjs (15 structure cases, 0 fail)"
        status: pass
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-docs.mjs decisions: exit 1, FAIL decisions: no se encuentra docs/m365/DECISIONS-graph.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "decisions --trace fails on cited paths that do not exist or are not in the manifest, on uncited non-synthetic scenarios, and on Claims that do not resolve or disagree with the manifest"
    requirement: SETUP-03
    verification:
      - kind: unit
        ref: "validate-docs.test.mjs (20 trace cases and 5 CLI trace cases, 0 fail)"
        status: pass
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-docs.mjs decisions --trace on the current tree: exit 1, names the document and the manifest"
        status: pass
    human_judgment: false
  - id: D3
    description: "guide, runbook [--final], secrets and gitignore behave exactly as before"
    requirement: SETUP-03
    verification:
      - kind: unit
        ref: "the 31 cases of 01-01 are untouched and pass; guide: OK (114 checks), runbook: OK (23 checks), secrets: OK (1532 checks), gitignore: OK (6 checks)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The gate matches what Phase 1's real manifest looks like once 01-06 sanitizes real data"
    requirement: SETUP-03
    verification:
      - kind: other
        ref: "Proven only against in-memory manifests written from 01-03's documented shape; the first real run is 01-08 (decisions --trace against the real manifest)"
        status: not-run
    human_judgment: false

duration: 4min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 04: Decision-document gate Summary

**`validate-docs.mjs decisions [--trace]` checks that `docs/m365/DECISIONS-graph.md` has its twelve sections with Decision and Evidence lines, and with `--trace` that every cited fixture path exists and is in the manifest, every captured scenario is cited, and every `Claim:` line equals the manifest value.**

## Note for the product owner

Nothing for you or the admin to do in this plan. It is a safety net for plan 01-08: when the decision document about Outlook behaviour is written there, it will not pass unless each statement can be matched with a recorded fixture. Until then the gate fails on purpose because the document does not exist yet.

## Contract for 01-08 (as implemented)

The document is `docs/m365/DECISIONS-graph.md`. It must contain exactly these level-2 headings (exact text, each once, extra sections allowed):

```text
## Occurrence key
## Series key
## Cancelled meetings
## Declined meetings
## Moved meetings
## Private meetings
## All-day events
## Eligibility signals
## Time zone and DST
## ImmutableId and nextLink
## Calendars.ReadBasic (informational)
## Corrections to earlier research
```

Every one of those sections needs:

- at least one line that starts with `Decision:` followed by text;
- at least one line that starts with `Evidence:` and contains a path in backticks that starts with `tests/Fixtures/M365/`, for example `Evidence: see `tests/Fixtures/M365/scenarios/S3.roundA.json``. Only `## Calendars.ReadBasic (informational)` may instead have an `Evidence:` line with an `https://learn.microsoft.com/` URL. Paths without backticks do not count.

With `--trace` (use it in 01-08 against the real manifest):

- every backticked `tests/Fixtures/M365/...` path anywhere in the document must exist on disk and be listed in `manifest.json` (the `files` index, a scenario's `round_a.files` / `round_b.files`, or `round_b.lookup.file`). The manifest file itself and the README are not citable;
- every scenario in the manifest whose `synthetic` is not true must be cited at least once: by a cited path that belongs to its own files, or by a `Claim:` line whose first segment is its ID;
- a Claim is one line, exactly `Claim: <SID>.<dotted.path> = <value>` or `Claim: experiments.<dotted.path> = <value>`, with `<SID>` alphanumeric (`S3`, `S5b`) and a single space on each side of `=`. The path is resolved under `manifest.scenarios[<SID>]` or `manifest.experiments` (array positions are numbers, for example `experiments.full_shape_properties.0`). The value is JSON (`true`, `404`, `null`, `"text"`, `["a","b"]`, `{"status": 200}`) compared to the manifest value; text that is not valid JSON is compared as a plain string with a manifest string. Examples: `Claim: S3.round_b.present = false`, `Claim: S3.round_b.lookup.status = 404`, `Claim: experiments.select_experiment.status = 400`;
- an unknown scenario, an unknown path, or any line that starts with `Claim:` but breaks the syntax fails; nothing is skipped.

Write each Claim on its own line, not inside a table cell. A Claim cannot name a `SYN-*` scenario (hyphen is not allowed by the specified syntax); those do not need a citation anyway.

## Performance

- **Duration:** about 4 min by the host clock
- **Tasks:** 2, each as a RED and a GREEN commit
- **Files modified:** 2 (plus `.planning/WINDOWS.md`)
- **Tests:** 44 new (15 structure, 20 trace, 9 CLI); the spike test directory runs 175 tests, 0 failures

## Accomplishments

- `DECISION_HEADINGS` and `checkDecisions(text, { trace, manifest, exists })` exported; `decisions` registered in the dispatcher with `--trace`, `--file` (default `docs/m365/DECISIONS-graph.md`) and `--manifest` (default `tests/Fixtures/M365/manifest.json`). The usage line lists the new flags; no other handler changed.
- Structure gate: heading present and unique, `Decision:` line with text, `Evidence:` line with a fixture path (or the ReadBasic URL exception), CRLF accepted.
- Trace gate: citation existence and manifest membership (including a `..` path that tries to leave the fixtures directory), scenario coverage, Claim parsing, resolution (own properties only, so `__proto__` and `constructor` never resolve), comparison, truncated manifest value in mismatch messages (manifest values are sanitized summaries).
- CLI: an unreadable or invalid manifest adds one FAIL line naming it and the structure checks still run; `exists` is resolved against the repo root.

## Task Commits

1. **Task 1: structure gate** - `66b58efd` (test, RED: 17 of 50 fail on assertions against a stub reporting `no implementado`) and `96272c89` (feat, GREEN: 50/50)
2. **Task 2: traceability** - `56971d76` (test, RED: 15 of 75 fail) and `0aac5571` (feat, GREEN: 75/75)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `tests/Tools/m365-spike/validate-docs.mjs` - decisions subcommand, `DECISION_HEADINGS`, `checkDecisions`, `loadManifest`
- `tests/Tools/m365-spike/test/validate-docs.test.mjs` - 44 new cases appended after 01-01's; the in-memory manifest follows 01-03's documented shape
- `.planning/WINDOWS.md` - one `unrun-verify` entry (Prettier)

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Malformed `Claim:` lines and duplicate headings fail**
- **Found during:** Task 2 design, against the plan's prohibition "never accepts a Claim it cannot resolve"
- **Issue:** the specified Claim regex alone would skip a line such as `Claim: S3.round_b.present=false` (no spaces), which would silently disable that claim. A heading that appears twice would also pass the structure check.
- **Fix:** every line that starts with `Claim:` must match the syntax or it fails; each required heading must appear exactly once; a `Decision:` line needs text after the colon.
- **Files modified:** `tests/Tools/m365-spike/validate-docs.mjs`, `tests/Tools/m365-spike/test/validate-docs.test.mjs`
- **Committed in:** `96272c89`, `0aac5571`

### Other deviations

- **Prettier not run.** `node_modules/` does not exist on this host; the orchestrator asked to format by hand. Both files were formatted to `.prettierrc.json` (4 spaces, single quotes, 100 columns, es5 trailing commas); no new line exceeds 100 columns except `test('long title', ...)` headers. The plan's third verify command (`npx --no-install prettier --check`) was therefore not run; recorded as an `unrun-verify` entry in `.planning/WINDOWS.md`. **Watch the `npm-format-check` CI job on push.**
- **`requirements mark-complete` not run.** SETUP-03 (the written decision, backed by fixtures) is only satisfied by 01-08; this plan delivers its gate. `requirements-completed` is empty on purpose, as for 01-01 to 01-03.
- **Spanish failure reasons.** The plan did not fix the language of reasons; they follow the other `validate-docs.mjs` gates (Spanish). Only the `FAIL decisions:` prefix is specified.
- **Commit trailer.** All commits end with `Co-Authored-By: Claude Sonnet 5.5`, as the session attribution instruction requires.

## Issues Encountered

Shell heredocs collapsed backslashes in one scripted edit again (a `\n` and a regex `\.` were damaged); both were repaired with the Edit tool and the full suite re-run before the commit. Nothing was committed in the damaged state.

## Known Stubs

None. The RED-phase stub of `checkDecisions` was replaced in `96272c89`. `docs/m365/DECISIONS-graph.md` does not exist yet by design (01-08 writes it) and the gate fails loudly until then.

## Threat Flags

None. The gate only reads files under the repo (the decision document and `tests/Fixtures/M365/manifest.json`), never `raw/`, and prints only manifest summaries already covered by `validate-fixtures --leaks`. T-01-15 is mitigated and test-covered (existence, manifest membership, scenario citation, Claim equality, unknown paths fail); T-01-32 and T-01-SC accepted as planned (no package installed).

## Next Phase Readiness

- 01-08 writes the decision document against the contract above and runs `node tests/Tools/m365-spike/validate-docs.mjs decisions --trace` next to `validate-fixtures.mjs --replay` before the one-way deletion of `raw/`.
- 01-05 only uses `guide`, `runbook --final` and `secrets`, which are unchanged.
- Blocked on people, not code: registration, secret, test users and scenario events (admin).

## Self-Check: PASSED

Both modified files and the SUMMARY exist; commits `66b58efd`, `96272c89`, `56971d76` and `0aac5571` are ancestors of HEAD.
