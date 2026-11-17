---
phase: 05-smart-meeting-suggestions
plan: 02
subsystem: microsoft365-suggestions
tags: [suggestions, scoring, hashing, tokenizer, pure-php, unit-tests]
status: complete
requires: []
provides:
  - "App\\Microsoft365\\Suggestions\\SubjectTokenizer::tokens(?string): list<string>"
  - "App\\Microsoft365\\Suggestions\\MeetingSignals::features() / hashed() / hash() / labels()"
  - "App\\Microsoft365\\Suggestions\\ProjectSuggestionEngine::rank(): list<Suggestion>"
  - "App\\Microsoft365\\Suggestions\\Suggestion, Reason value objects"
  - "Stored payload shape for outlook_meeting_links.signals: {v, o, oi, a, i, d, t, n}"
affects: [05-03, 05-05, 05-09]
requirements-completed: [RULE-03]
key-files:
  created:
    - app/Microsoft365/Suggestions/SubjectTokenizer.php
    - app/Microsoft365/Suggestions/MeetingSignals.php
    - app/Microsoft365/Suggestions/ProjectSuggestionEngine.php
    - app/Microsoft365/Suggestions/Suggestion.php
    - app/Microsoft365/Suggestions/Reason.php
    - tests/Unit/Microsoft365/SubjectTokenizerTest.php
    - tests/Unit/Microsoft365/MeetingSignalsTest.php
    - tests/Unit/Microsoft365/ProjectSuggestionEngineTest.php
  modified: []
decisions:
  - "Two-character letter+digit codes (q3, v2, 3d) survive the 3-character minimum, so 'Reunión semanal ACME – Q3' gives [acme, q3] as the plan requires"
  - "Broadcast guard is per pair: if the target or the link has more than 25 attendees, only the target organizer and subject words count, and a broadcast link offers only its own organizer as a person"
  - "Reason fallback: a person without a display name reports the project's strongest shared domain; a label that is itself an address is never shown"
  - "Added MeetingSignals::labels() so 05-09 can build the target's hash => readable map with the same hashing"
completed: 2026-11-17
duration: ~45min
plan_head_before: 1468222e0d2dc3d85d93c43b0785c199037fc33c
plan_head_after: 7b7f18d27d23e462b44228498c2488286e93bab2
actuals:
  tokens: 16900
  tasks: 3
  commits: 3
---

# Phase 5 Plan 02: Learned suggestion engine (pure PHP) Summary

This plan adds the pure-PHP core of RULE-03. It has three parts:
- an ES/EN subject tokenizer;
- a meeting feature extractor that stores signals as keyed HMAC-SHA256 hashes (16 hex characters, prefixed by kind);
- an explainable scorer: weight x IDF (capped at 3) x decay with a 90-day half-life, plus a confidence rule (score >= 3.0, at least 1.5x the second, and backed by two links or by a person, organizer or domain match), top three results and a readable reason.

None of it uses the database or the framework, and 49 local unit tests cover it.

## What was built

- **SubjectTokenizer::tokens()**: lowercases and accent-folds the subject, then splits it on anything that is not a letter or digit. It drops:
  - tokens shorter than 3 characters (two-character letter+digit codes like q3 or v2 are kept);
  - tokens made only of digits;
  - 318 stop words: English and Spanish function words, meeting noise, reply prefixes, and English and Spanish weekday and month names.

  It then removes duplicates and keeps the first 12.
- **MeetingSignals**:
  - `features()` returns the organizer only when the user does not organize. It never repeats the organizer among the attendees. It splits people into internal and external, keeps distinct external domains (including an external organizer's domain), skips resources, the user's own addresses and invalid addresses, and takes `count` from `attendee_count` when present, otherwise from the list length.
  - `hashed()` produces the `{v, o, oi, a, i, d, t, n}` payload.
  - `hash()` returns `substr(hash_hmac('sha256', kind|value, secret), 0, 16)`.
  - `labels()` maps a hash to a display name or a bare domain.
- **ProjectSuggestionEngine::rank()**:
  - Weights are public constants: organizer 4 if external, 2 if internal; person 3 if external, 1 if internal; domain 2; token 1.
  - A person matches whether they were organizer or attendee in the past meeting.
  - IDF is computed over the scored rows, and projects are sorted by score, then by project id.
  - Only the first suggestion can be confident.
  - The broadcast guard applies above `BROADCAST_LIMIT` (25).
  - Rows from the forgotten series being excluded are skipped.
  - Signal payloads are read defensively, so old or partial jsonb does not break scoring.
- **Suggestion / Reason**: `toArray()` leaves out the score.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | b61af3f1 | feat(05-02): learned suggestion engine tracer (tokenizer, keyed signals, scorer) |
| 2 | afd8fcc0 | feat(05-02): ES/EN stop words and signal extraction tests |
| 3 | 7b7f18d2 | feat(05-02): scoring matrix with broadcast guard, forgotten series and safe reasons |

## Gates

- **Gate U:** `phpunit SubjectTokenizerTest MeetingSignalsTest ProjectSuggestionEngineTest` gives OK (49 tests, 146 assertions). Because this is a worktree, it ran with a bootstrap that loads `App\` from the worktree first (kept in the scratchpad).
- **Gate P:** `pint --test app/Microsoft365/Suggestions tests/Unit/Microsoft365` passed. Full-app PHPStan (level 7, with the worktree-first `--autoload-file`) reported `[OK] No errors`.
- **Acceptance greps:** `hash_hmac('sha256'` = 1; `IDF_CAP` = 4; no `DB::`, `->query()` or `Http::` in the source; `'seguimiento'` = 1; `'weekly'` = 1; MeetingSignalsTest has 11 `test_` methods; ProjectSuggestionEngineTest has 22 `test_` methods and 449 lines; `BROADCAST_LIMIT` = 4; the tree is clean after the commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's tokenizer rules contradicted its own expected output**
- **Found during:** Task 2
- **Issue:** The plan says to drop tokens under 3 characters, but it also expects `'Reunión semanal ACME – Q3'` to give `['acme', 'q3']`. RESEARCH says "q3 passes because it is not digits-only".
- **Fix:** Two-character tokens made of one letter and one digit (q3, v2, 3d) are kept; other tokens under 3 characters are still dropped. The tokenizer tests cover this.
- **Files modified:** app/Microsoft365/Suggestions/SubjectTokenizer.php, tests/Unit/Microsoft365/SubjectTokenizerTest.php
- **Commit:** afd8fcc0

**2. [Rule 2 - Missing helper] Added `MeetingSignals::labels()`**
- **Why:** The reasons need a hash => readable map built with exactly the same hashing as `hashed()`. The tests use it, and 05-09 can use it too. It only adds a method; no listed contract changed.
- **Commit:** b61af3f1

**3. Interpretation choices (within the plan)**
- **Broadcast guard:** it applies per pair (target or link above 25). In that case only the target organizer and subject words count, and a broadcast link can only match through its own organizer.
- **Nameless person in a reason:** the reason uses the project's strongest shared domain; if there is none, the next readable feature; as a last resort the kind with a null value. The reason never shows a full address.
- **PHPStan:** it inferred `bool` for the large const array, so the `STOP_WORDS` docblock type is `array<string, bool>` instead of `array<string, true>`.

## Known Stubs

None.

## Open items / notes for the orchestrator

- Running the whole `tests/Unit/Microsoft365` folder in this worktree shows 12 failures, all in `SocialiteMicrosoftGatewayTest`. This plan did not touch that file. The failures come from this worktree's local environment and did not block anything here; they were not investigated.
- For 05-05 and 05-09:
  - `rank()` reads the target and stored payloads defensively (`array<string, mixed>`).
  - `age_days` can be an int or a float.
  - Pass `MeetingSignals::labels($targetFeatures, $secret)` as `$labels`.
- Reason `value` can be null for `subject`, and, as a last resort, for a person who has no name and no shared domain. The client labels should handle null.

## Self-Check: PASSED

- All 8 files exist in the worktree.
- Commits b61af3f1, afd8fcc0 and 7b7f18d2 are ancestors of HEAD (3 commits since 1468222e).
