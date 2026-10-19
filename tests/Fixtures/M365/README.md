# Microsoft 365 fixtures

Sanitized Microsoft Graph responses recorded for the Outlook calendar integration. Phases 2 to 6
load them in tests instead of calling Microsoft.

## What these files are

- Real Graph responses from Untangle's own tenant, recorded by `tests/Tools/m365-spike` in two
  rounds: **round A** is the baseline and **round B** is the same window after the scenario events
  were changed (cancelled, declined, moved, edited).
- Only events that carry a scenario tag (`[M365-TEST S3]`, `[M365-TEST E1]`, and so on) are kept.
  The capture account can hold other, real meetings. The sanitizer drops every event without the
  tag, including its series master, its occurrences and its Round B lookup. Such an event never
  appears in these files in any form, not even pseudonymized.
- Everything identifying is replaced, see "Sanitization rules". Nothing here is a real name,
  address, subject, location, link, tenant or user ID, event ID or token.
- Files marked `synthetic: true` in the manifest were **not captured**. They are derived copies
  (for example `sensitivity` set to `confidential`, which Outlook cannot create). They live under
  `scenarios/SYN-*` and must never be presented as observed behaviour.

Do not edit these files by hand. They are regenerated with
`node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/sanitize.mjs` while the
git-ignored `tests/Tools/m365-spike/raw/` directory still exists. Always sanitize both rounds
together: the pseudonyms come from a secret salt kept only in `raw/`, so a later run with another
salt would break every before/after comparison.

## The manifest is the index

`manifest.json` lists every other JSON file under `files` and in each scenario's `files` lists.
Take page lists from `files.calendarview.<round>.<pass>.pages` **in array order**, never from a
directory listing: `page-10` sorts before `page-2`. A pass with `complete: true` was fetched until
the last page had no `@odata.nextLink`. Rounds, passes and scenarios that were not captured are
absent, never `null`.

| Key | Meaning |
|-----|---------|
| `captured_at`, `window` | when each round was captured and the calendar window |
| `outlook_client`, `mailbox_timezone` | the Outlook client used and the most frequent `originalStartTimeZone` |
| `files` | the index: `me`, `token_shape`, `calendarview`, `id_format`, `series`, `lookups` |
| `scenarios.<ID>` | `extra`, `synthetic`, `round_a` and `round_b` (`files`, `present`, `count`, and for round B `id_equal` and `lookup`), `observed` |
| `experiments` | summaries of the capture experiments: `Prefer` header handling, page 2 without headers, ID format, `$select` behaviour, series masters, Round B lookups |

`observed` is generated from the data, never written by hand. It states what was seen, for example
that an event was absent from `calendarView` and a direct lookup answered 404. Tests must accept
either representation and read the manifest; they must not encode an expected Outlook behaviour.

## Layout

```text
manifest.json
me.json, token-response.shape.json
calendarview/round{A|B}.<pass>.page-<n>.json     sanitized page bodies, one file per page
calendarview/round{A|B}.<pass>.requests.json     [{ page, url, headerNames, preferMode, status, errorCode }]
calendarview/round{A|B}.id-format.json           ID length and charset summaries, equal/different counts
scenarios/<ID>.round{A|B}.json                   { scenario, round, source_pass, value: [events] }
scenarios/SYN-confidential.json, SYN-personal.json   synthetic, derived from S6 round A
series/<ID>.master.round{A|B}.json               { scenario, round, value: [series master] }
series/<ID>.instances.round{A|B}.json            { scenario, round, pages: [instances pages] }
lookups/<ID>.roundB.json                         [{ status, errorCode, body }] per Round A event ID
```

The passes are `prod-select`, `prefer-separate`, `page2-no-prefer`, `no-immutableid`,
`experiment-select` and `full-shape`. The scenario files come from `full-shape` (the richest
shape), or from `prod-select` when that pass failed; `source_pass` says which.

## Sanitization rules

- **Allow-list.** An event is rebuilt field by field. `body`, `bodyPreview`, `categories`,
  `attachments`, `extensions` and every field the sanitizer does not know are dropped.
- **IDs** (`id`, `seriesMasterId`, `@odata.etag`, `changeKey`, `iCalUId`) become keyed pseudonyms
  (HMAC-SHA256) that keep the original length and trailing `=` padding and start with `FAKE`. The
  same real value always maps to the same fake value, so a round A ID equals a round B ID in these
  files exactly when it did in reality.
- **People** are `person-a@example.test` / `Test User A` (the capture mailbox),
  `person-b@example.test` / `Test User B` (the second test user), and `person-<n>@example.test` /
  `Test Person <n>` for everyone else, numbered in the order they were first seen.
- **Subjects** keep only the scenario tag, a short lowercase remark after it and the Exchange
  prefixes such as `Canceled:`. Locations become `Location <n>`.
- **Links** become `https://outlook.example.test/calendar/item/<fakeId>` and
  `https://teams.example.test/l/meetup-join/<n>`. GUIDs become `00000000-0000-4000-8000-` plus
  twelve hex characters.
- **Next links** keep the path, the window, `$top` and `$select`; the page token becomes
  `SANITIZED-PAGE-<n>` where `<n>` is the number of the page the link leads to. Their host is always
  `graph.microsoft.com`.
- Dates, time zones, flags and response statuses are kept verbatim: they are the decision data.

## Checking the fixtures

`node tests/Tools/m365-spike/validate-fixtures.mjs` runs four offline checks: `--schema` (files and
the manifest index, including an orphan check), `--semantic` (scenario facts that must hold, without
assuming how Outlook represents cancelled or declined meetings), `--leaks` (no foreign e-mail
address, link host, GUID, token or untagged event) and `--replay` (every complete `calendarView`
page sequence is walked by following its sanitized next links in manifest order).

## Loading in PHPUnit

```php
$manifest = json_decode(
    file_get_contents(base_path('tests/Fixtures/M365/manifest.json')),
    true,
    flags: JSON_THROW_ON_ERROR
);
$pages = collect($manifest['files']['calendarview']['A']['prod-select']['pages'])
    ->map(fn (string $file): array => json_decode(
        file_get_contents(base_path('tests/Fixtures/M365/'.$file)),
        true,
        flags: JSON_THROW_ON_ERROR
    ));

Http::fake([
    'graph.microsoft.com/v1.0/me/calendarView*' => Http::sequence()->push($pages[0])->push($pages[1]),
]);
```

Follow each page's `@odata.nextLink` for the next request, and send the `Authorization` and
`Prefer` headers again on every request: they apply only to the request that carries them.
