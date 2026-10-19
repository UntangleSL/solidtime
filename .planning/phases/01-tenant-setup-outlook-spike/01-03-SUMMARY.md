---
phase: 01-tenant-setup-outlook-spike
plan: 03
subsystem: testing
tags: [microsoft-graph, calendarview, fixtures, sanitizer, hmac-pseudonyms, node-test, replay]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-01 validate-docs.mjs (SECRET_PATTERNS, secrets gate) and 01-02 raw layout, fake Entra/Graph server and runCapture"
provides:
  - "Allow-list sanitizer with keyed, length-preserving pseudonyms and a raw-value leak guard (tests/Tools/m365-spike/lib/sanitize.mjs)"
  - "Scenario extraction, manifest builder with a files index and experiment summaries (lib/scenarios.mjs)"
  - "sanitize CLI: raw/ to tests/Fixtures/M365/ in one offline command (sanitize.mjs)"
  - "validate-fixtures.mjs: --schema --semantic --leaks --replay fixture gate with a Node replay of the paged fixtures"
  - "Fixture README (tests/Fixtures/M365/README.md) and 64 new node:test cases, including a fake-capture to sanitized-fixtures end-to-end run"
affects: [01-04, 01-05, 01-06, 01-07, 01-08, phase-03, phase-04, phase-05]

actuals:
  tokens: 44100
  tasks: 3
  commits: 5
plan_head_before: 2bac7fb482ebb3628f426dc5454c8704e6d1aff7
plan_head_after: afd32bf13a2bd40239a7d0fc6a09fe4e0121f350

tech-stack:
  added: []
  patterns:
    - "Counter-mode HMAC-SHA256 (node:crypto only) for length-preserving pseudonyms keyed by field kind"
    - "Everything is built in memory, guarded, and only then written; a guard hit removes all generated outputs"
    - "The manifest files index is the only source of file lists for the orphan check and the replay"
    - "Reports name a file and a kind of problem, never a leaked value"

key-files:
  created:
    - tests/Tools/m365-spike/lib/sanitize.mjs
    - tests/Tools/m365-spike/lib/scenarios.mjs
    - tests/Tools/m365-spike/sanitize.mjs
    - tests/Tools/m365-spike/validate-fixtures.mjs
    - tests/Tools/m365-spike/test/sanitize.test.mjs
    - tests/Tools/m365-spike/test/pipeline.e2e.test.mjs
    - tests/Tools/m365-spike/test/validate-fixtures.test.mjs
    - tests/Fixtures/M365/README.md
  modified:
    - .planning/WINDOWS.md

key-decisions:
  - "An event without a [M365-TEST <ID>] subject tag is dropped from every output (pages, series masters and instances, Round B lookups) and never pseudonymized; three independent layers enforce it (sanitizer, CLI guard, validate-fixtures --leaks)"
  - "next link and request URLs are rewritten onto the graph.microsoft.com origin, and a missing page token is added as SANITIZED-PAGE-<n>, so a fake host never leaks and every link is replayable"
  - "The sanitize CLI refuses --raw equal to --out and any --raw inside a generated output directory, because it deletes generated outputs before writing"
  - "Series master files are { scenario, round, value: [masters] } and instances files { scenario, round, pages }, so a scenario with two masters (E2) needs no special case"
  - "The identity map and salt live in raw/ and are loaded back; numbering of people continues across runs, which is what keeps Round A outputs byte-identical when Round B is added"

patterns-established:
  - "Test planted values (addresses, GUIDs, JWT shapes) are assembled at runtime so the secrets gate scans the tests"
  - "Multi-line statements that fit in 100 columns are kept on one line and arrays of arrays are broken one per line, to match Prettier by hand"

requirements-completed: []

coverage:
  - id: D1
    description: "sanitize.mjs turns raw/ into tests/Fixtures/M365/ with a field allow-list and keyed HMAC-SHA256 pseudonyms; unknown fields, bodies, categories, attachments and extensions are dropped"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/sanitize.test.mjs (21 tests, 0 fail)"
        status: pass
      - kind: unit
        ref: "pipeline.e2e.test.mjs (no raw identifying value, body or unknown field reaches any output)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deterministic output: same raw and salt give byte-identical files, Round A outputs do not change when Round B is added, ids keep length, padding and the FAKE prefix, and equality across rounds is preserved"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "sanitize.test.mjs (ids keep length and padding), pipeline.e2e.test.mjs (Round A outputs byte-identical with and without Round B, rerun changes nothing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Manifest with scenarios, observed sentences, experiment summaries and a files index that reaches every non-scenario fixture file; the orphan rule holds on real sanitizer output"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "pipeline.e2e.test.mjs (manifest lists every scenario, every JSON file except the manifest is listed, page lists keep page order beyond ten pages)"
        status: pass
    human_judgment: false
  - id: D4
    description: "validate-fixtures.mjs fails on orphans, missing files or scenarios, foreign e-mails, hosts, GUIDs, tokens, raw values and untagged events, and on any complete page sequence that does not replay by following its sanitized next links in manifest order"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "node --test tests/Tools/m365-spike/test/validate-fixtures.test.mjs (27 tests, 0 fail)"
        status: pass
      - kind: other
        ref: "node tests/Tools/m365-spike/validate-fixtures.mjs and --replay on the tree with only README.md: exit 1, FAIL ... manifest.json not found"
        status: pass
    human_judgment: false
  - id: D5
    description: "Events without a scenario tag never reach a committed fixture in any form"
    requirement: SETUP-02
    verification:
      - kind: unit
        ref: "pipeline.e2e.test.mjs (events without a scenario tag never reach a fixture, series and lookups included; an event without a scenario tag in any output fails the run)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The allow-list covers every field Graph actually returns for the capture mailbox (backstop)"
    requirement: SETUP-02
    verification:
      - kind: other
        ref: "Proven only against the fake; the real answer is known after 01-06 sanitizes real data and the product owner or developer reads one sanitized event next to its raw original"
        status: not-run
    human_judgment: true
    rationale: "Graph may return fields the fake does not. They are dropped by construction, but only a person can judge whether a dropped field was decision data the later phases need."

duration: 31min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 03: Sanitizer, manifest and fixture gate Summary

**Offline pipeline from raw Graph captures to committable fixtures: an allow-list sanitizer with keyed length-preserving pseudonyms, an indexed manifest with observed facts and experiment summaries, and a fixture gate (`--schema --semantic --leaks --replay`) that also replays every paged calendarView sequence in Node. Events without a `[M365-TEST <ID>]` subject tag never reach a fixture.**

## Note for the product owner

You said the capture account A may be your own mailbox, with real meetings in the window. That is handled: **only events whose subject carries a `[M365-TEST ...]` tag are ever written to the committed fixtures, and nothing else, not even in pseudonymized form.** Your other meetings are dropped together with their recurring-series data and their Round B lookups. Three separate layers enforce it (the sanitizer itself, a check inside the `sanitize` command that stops and deletes its outputs, and the fixture gate), and the tests plant a real-looking meeting with a body, attendees and a recurring series to prove it.

Two things to know:

- The committed `manifest.json` contains a few aggregate numbers computed while sanitizing, for example how many events had equal ids with and without the immutable-id header. Those counts only cover tagged events. A handful of yes/no facts and time-zone names (for example "page 2 without headers came back in a non-UTC time zone") are computed over every event in the window, because dropping the others would hide the very evidence the decision document needs. They contain no names, subjects or ids.
- You still need to look once at real output when 01-06 runs: open one sanitized file next to its raw original and confirm nothing meaningful was lost or kept. That is the backstop truth of this plan and it cannot be tested before real data exists.

No decision is needed from you or the admin for this plan.

## Performance

- **Duration:** about 31 min
- **Tasks:** 3 (Tasks 1 and 3 as RED and GREEN commits)
- **Files created:** 8 (plus `.planning/WINDOWS.md` updated)
- **Tests:** 64 new (21 sanitizer, 16 pipeline end-to-end, 27 fixture gate); the whole directory runs 131 tests, 0 failures

## Accomplishments

- `lib/sanitize.mjs`: `loadOrCreateSalt` (created once in `raw/salt`, never rotated, refuses a corrupt file), `createSanitizer` (`event`, `page`, `me`, `nextLink`, `requestUrl`, `context`, `guid`, `id`, `errorBody`, `persistIdentityMap`, `stats`), `buildLeakSet`, `findLeaks`, `keptSubject`, `collectRawDocuments`. Pseudonyms come from counter-mode HMAC-SHA256 only (`createHmac`). Ids, series master ids, etags and change keys keep their length and trailing `=` padding and start with `FAKE`; iCalUId keeps its constant prefix and becomes upper-case hex; GUIDs become `00000000-0000-4000-8000-<12 hex>`; people become `person-a`, `person-b` or `person-<n>@example.test`.
- `lib/scenarios.mjs`: scenario lists and tag parser, `extractRound`, `buildOutputs`, `buildManifest`, `findUntaggedEvents`, file name helpers, and the experiment summaries.
- `sanitize.mjs` CLI: builds everything in memory, runs the leak guard, then cleans and writes. A hit removes every generated output (README.md stays), prints the file and the kind of field only, and exits 1. Success prints counts only.
- `validate-fixtures.mjs`: four checks, a default of all four, `--round A|B|both`, `--dir`, `--raw`; per-pass request and event counts for the replay.
- A fake mailbox with all eleven required scenarios, a series master, a recurring untagged series, and real-looking people runs through `runCapture` for both rounds, the sanitizer and the gate (`pipeline.e2e.test.mjs`): the gate accepts the output, the replay walks 16 pages in Round A and 14 in Round B, and no planted value appears.
- Mutation check: disabling the tag filter in `page()` made the sanitize CLI abort on its own guard, so a regression in the filter cannot silently write an untagged event.

## Final fixture layout (as implemented)

```text
tests/Fixtures/M365/README.md                          hand-written, never overwritten
tests/Fixtures/M365/manifest.json
tests/Fixtures/M365/me.json, token-response.shape.json
tests/Fixtures/M365/calendarview/round{A|B}.<pass>.page-<n>.json     sanitized page bodies (n = raw page number)
tests/Fixtures/M365/calendarview/round{A|B}.<pass>.requests.json     [{ page, url, headerNames, preferMode, status, errorCode }]
tests/Fixtures/M365/calendarview/round{A|B}.id-format.json           { round, immutable, default, same_value_count, different_value_count }
tests/Fixtures/M365/scenarios/<SID>.round{A|B}.json                  { scenario, round, source_pass, value: [events] }
tests/Fixtures/M365/scenarios/SYN-confidential.json, SYN-personal.json   { scenario, round, source_pass, synthetic: true, derived_from: 'S6', value }
tests/Fixtures/M365/series/<SID>.master.round{A|B}.json              { scenario, round, value: [series master] }
tests/Fixtures/M365/series/<SID>.instances.round{A|B}.json           { scenario, round, pages: [instances pages] }
tests/Fixtures/M365/lookups/<SID>.roundB.json                        [{ status, errorCode, body }] per Round A id of the scenario
```

Passes: `prod-select`, `prefer-separate`, `page2-no-prefer`, `no-immutableid`, `experiment-select`, `full-shape` (a pass that was not captured is absent). A failed pass keeps its `requests` file and an empty `pages` list.

## Manifest keys (as implemented)

```text
captured_at { A, B }        window { start, end }        outlook_client        mailbox_timezone
files { me, token_shape,
        calendarview { A|B: { <pass>: { pages: [...in page order], requests, complete } } },
        id_format { A, B },
        series { A|B: { <SID>: { master?, instances? } } },     present only when produced
        lookups { B: { <SID>: "lookups/<SID>.roundB.json" } } } present only when produced
scenarios { <SID>: { extra, synthetic, round_a { files, present, count },
                     round_b { files, present, count, id_equal, lookup { file, status, isCancelled } | null },
                     observed } }
          round_b is absent when Round B was not captured; SYN-* entries have round_a only
experiments { prefer_combined, prefer_separate, page2_without_prefer, id_format, select_prod,
              select_experiment, full_shape_properties, series_master, round_b_lookups }
          every key is always present, null when it could not be computed
```

`experiments` shapes: `prefer_*` `{ status, utc_on_all_pages }`; `page2_without_prefer` `{ status, page2_timezones, page2_ids_equal_to_combined: { equal, different } }`; `id_format` `{ round, immutable: { min_length, max_length, charset }, default: {...}, same_value_count, different_value_count }` (Round A's); `select_*` `{ status, error_code, lastModifiedDateTime_returned, attendees_returned }`; `full_shape_properties` sorted property names; `series_master` `{ status, cancelledOccurrences_present, recurrence_present }`; `round_b_lookups` a status histogram such as `{ "200": 12, "404": 1 }`.

## Task Commits

1. **Task 1: allow-list sanitizer** - `553cb9fc` (test, RED: 20 of 21 fail on assertions against a vacuous stub; the 21st, the dropped-field test, was strengthened to also require allowed fields to survive) and `1a3c1527` (feat, GREEN: 21/21)
2. **Task 2: sanitize CLI, scenarios, manifest, README** - `5b3670ac` (feat)
3. **Task 3: fixture gate** - `818366e8` (test, RED: 27 of 27 fail on assertions against a stub that reports `not implemented`) and `afd32bf1` (feat, GREEN: 27/27 plus the end-to-end gate test)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `tests/Tools/m365-spike/lib/sanitize.mjs`, `lib/scenarios.mjs`, `sanitize.mjs`, `validate-fixtures.mjs` - the pipeline
- `tests/Tools/m365-spike/test/sanitize.test.mjs`, `test/pipeline.e2e.test.mjs`, `test/validate-fixtures.test.mjs` - the suites
- `tests/Fixtures/M365/README.md` - provenance, rules, layout, loading instructions; it passes `validate-fixtures.mjs --leaks`
- `.planning/WINDOWS.md` - one `unrun-verify` entry (Prettier)

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Events without a scenario tag must never reach a fixture**
- **Found during:** start of the plan (context from the product owner: capture account A is likely a real person's mailbox)
- **Issue:** the plan sanitized every event in `calendarview` pages (non-tagged ones as `Event <n>`), every series master and every Round B lookup, so a real meeting would have reached the fixtures in pseudonymized form.
- **Fix:** `page()` keeps only tagged events (and counts the dropped ones); series masters and instances are written only for series a tagged event belongs to, and untagged masters or occurrences are dropped; Round B lookups are written only for Round A ids of tagged events; `findUntaggedEvents` is checked on every output by the sanitize CLI (exit 1, outputs removed) and by `validate-fixtures --leaks`; the identity map and numbering never see an untagged event. Tests: sanitizer unit test, end-to-end test with an untagged meeting (body, attendees, location, recurring series, lookup), two planted-failure tests, and a mutation run.
- **Aggregates:** experiment summaries that carry counts or shapes (`id_format`, `full_shape_properties`, `mailbox_timezone`, `series_master`, `round_b_lookups`) are computed over tagged events only; booleans, status codes, time-zone names and the page 2 counts (bounded by `$top`) use all events so the evidence stays complete.
- **Files modified:** `lib/sanitize.mjs`, `lib/scenarios.mjs`, `sanitize.mjs`, `validate-fixtures.mjs`, the three test files
- **Committed in:** `1a3c1527`, `5b3670ac`, `afd32bf1`

**2. [Rule 2 - Missing critical functionality] Generic leak patterns also run inside the sanitize CLI**
- **Issue:** the raw-value guard cannot catch a value that is not in the raw data (a link to a foreign host produced by a future bug).
- **Fix:** the CLI applies the same generic patterns as `validate-fixtures --leaks` (`scanText`) to every output before writing. Test: a foreign host planted through a test hook fails the run and leaves no files.
- **Committed in:** `afd32bf1`

**3. [Rule 2 - Missing critical functionality] Output hygiene beyond the plan text**
- **Fix:** every verbatim field is guarded (nested allow-list for dates, response status and recurrence; short strings without an address or link; objects where a string is expected are dropped); next link and request URLs keep only the window, `$top`, `$select`, `$orderby` and the page token, on the graph.microsoft.com origin; the sanitize CLI refuses `--raw` equal to `--out` or inside a generated directory; the CLI never prints a leaked value; `outlook_client`, ISO instants and tokens are validated before they enter the manifest; `occurrenceId` was added to the allow-list next to `cancelledOccurrences`, using the same id mapping.
- **Committed in:** `1a3c1527`, `5b3670ac`

**4. [Rule 1 - Bug] Test fixtures shared mutable objects between tests**
- **Found during:** Task 3 GREEN (four tests failed because an earlier test had planted values into shared constants)
- **Fix:** the fixture builder clones every event with `structuredClone`.
- **Committed in:** `afd32bf1`

### Other deviations

- **Prettier not run.** `node_modules/` does not exist on this host and the orchestrator asked to format by hand. All seven `.mjs` files were formatted to `.prettierrc.json` (4 spaces, single quotes, 100 columns, es5 trailing commas) with extra care for the cases Prettier collapses or force-breaks (statements that fit in one line, arrays of arrays). Remaining lines over 100 columns are `test('long title', ...)` headers, which Prettier leaves alone. **Watch the `npm-format-check` CI job on push**; recorded as an `unrun-verify` entry in `.planning/WINDOWS.md`.
- **Manifest rules that go beyond the plan text:** `--schema` also compares every scenario's `count` with the events in its files and rejects listed paths that leave the fixtures directory; `--semantic` also requires every required scenario to be present in Round A and checks that `SYN-*` events carry the matching sensitivity; the synthetic-flag rules live in `--schema` (the plan listed them under `--semantic`).
- **`requirements mark-complete` not run.** SETUP-02 (real fixtures recorded) and SETUP-03 (the written decision) are not satisfied by tooling alone; `requirements-completed` is empty on purpose, as for 01-01 and 01-02.
- **`full_shape_properties` lists property names.** Names are schema, not data, so they are committed in the manifest; the test pins that no other file contains an unknown field's name.
- **Commit trailer.** All commits end with `Co-Authored-By: Claude Sonnet 5.5`, as the session attribution instruction requires.

## Issues Encountered

A background test run hung once because the shared test setup did not register its server before a failing step; fixed so the fake server and temp directories are always closed. Shell heredocs again collapsed backslashes in scripted edits twice; both were redone with the Edit tool before any commit.

## Known Stubs

None. Both RED-phase stubs (`lib/sanitize.mjs`, `validate-fixtures.mjs`) were replaced by their implementations in the GREEN commits. `tests/Fixtures/M365/` holds only the README until 01-06 produces real data; that is intentional and checked by the gate (it fails without a manifest).

## Threat Flags

None beyond the plan's threat model (T-01-12, T-01-13, T-01-14, T-01-31 are mitigated and test-covered; T-01-SC accepted, no package was installed). The untagged-event rule is an extra mitigation for T-01-12, not new surface; the sanitize CLI deletes only its own generated directories and files and refuses unsafe `--raw` and `--out` combinations.

## Next Phase Readiness

- 01-04 (decision-document gate) can code against the manifest shape above and test with in-memory manifests; it shares no file with this plan.
- 01-06 can run `node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/sanitize.mjs` on real raw data, then `node tests/Tools/m365-spike/validate-fixtures.mjs` (use `--round A` after Round A only). Put the `[M365-TEST S<n>]` tag at the start of every scenario subject: an event without it will be dropped.
- 01-08 must run `validate-fixtures.mjs --replay` before the one-way deletion of `raw/`.
- Blocked on people, not code: registration, secret, test users and scenario events (admin), Dokploy domain (product owner).

## Self-Check: PASSED

All eight created files and the SUMMARY exist; commits `553cb9fc`, `1a3c1527`, `5b3670ac`, `818366e8` and `afd32bf1` are ancestors of HEAD.
