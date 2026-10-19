import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { REQUIRED_SCENARIOS } from '../lib/scenarios.mjs';
import {
    checkLeaks,
    checkReplay,
    checkSchema,
    checkSemantic,
    main,
    replayReport,
} from '../validate-fixtures.mjs';

// Planted values are assembled at runtime so this file matches none of the repo-wide patterns.
const mail = (local, domain) => `${local}@${domain}`;
const guidOf = (...parts) => parts.join('-');
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FAKE_GUID = guidOf('00000000', '0000', '4000', '8000', '0123456789ab');
const link = (page) => `${GRAPH}/me/calendarView?$top=3&$skiptoken=SANITIZED-PAGE-${page}`;
const fakeId = (label) => `FAKE${label}`.padEnd(40, 'x');
const instant = (day, time) => ({ dateTime: `2026-${day}T${time}.0000000`, timeZone: 'UTC' });
const accepted = { response: 'accepted', time: '2026-10-01T08:00:00Z' };
const organizer = { response: 'organizer', time: '0001-01-01T00:00:00Z' };
const person = {
    type: 'required',
    emailAddress: { name: 'Test User A', address: 'person-a@example.test' },
};

function event(sid, overrides = {}) {
    return {
        id: fakeId(sid),
        subject: `[M365-TEST ${sid}] sample`,
        type: 'singleInstance',
        seriesMasterId: null,
        isCancelled: false,
        isAllDay: false,
        isOrganizer: false,
        showAs: 'busy',
        sensitivity: 'normal',
        start: instant('10-20', '09:00:00'),
        end: instant('10-20', '10:00:00'),
        responseStatus: accepted,
        attendees: [person],
        ...overrides,
    };
}

const occurrence = (label, day, time) =>
    event('S2', {
        id: fakeId(label),
        type: 'occurrence',
        seriesMasterId: fakeId('master'),
        start: instant(day, time),
    });

const ROUND_A = {
    S1: [event('S1')],
    S1b: [event('S1b', { isOrganizer: true, responseStatus: organizer })],
    S2: [
        occurrence('S2a', '10-20', '08:00:00'),
        occurrence('S2b', '10-27', '09:00:00'),
        occurrence('S2c', '11-03', '09:00:00'),
    ],
    S3: [event('S3')],
    S4: [event('S4')],
    S5: [event('S5')],
    S5b: [event('S5b')],
    S6: [event('S6', { isOrganizer: true, sensitivity: 'private' })],
    S6b: [event('S6b', { sensitivity: 'private' })],
    S7: [event('S7', { isAllDay: true, attendees: [] })],
    S8: [event('S8', { isOrganizer: true, attendees: [] })],
};
const EDITED = {
    ...ROUND_A.S2[1],
    type: 'exception',
    originalStart: '2026-10-27T09:00:00Z',
    start: instant('10-27', '10:00:00'),
};
const DECLINED = { response: 'declined', time: '2026-10-05T08:00:00Z' };
const ROUND_B = {
    ...ROUND_A,
    S2: [ROUND_A.S2[0], EDITED, ROUND_A.S2[2]],
    S4: [{ ...ROUND_A.S4[0], responseStatus: DECLINED }],
    S3: [],
    S5b: [],
};

const pagePath = (round, pass, n) => `calendarview/round${round}.${pass}.page-${n}.json`;
const scenarioFile = (sid, round) => `scenarios/${sid}.round${round}.json`;

// A minimal valid fixture set: every required scenario in both rounds, a complete three-page
// prod-select pass per round and a page2-no-prefer pass that stops by design.
function makeFixtures() {
    const files = {};
    const index = {
        me: 'me.json',
        token_shape: 'token-response.shape.json',
        calendarview: {},
        id_format: {},
        lookups: { B: {} },
    };
    files['me.json'] = { id: FAKE_GUID, displayName: 'Test User A', mail: 'person-a@example.test' };
    files['token-response.shape.json'] = { tokenType: 'Bearer', keys: ['token_type'] };

    const scenarios = {};
    for (const sid of REQUIRED_SCENARIOS) {
        const entry = { extra: false, synthetic: false, observed: `Observed ${sid}.` };
        const sides = [
            ['a', 'A', ROUND_A],
            ['b', 'B', ROUND_B],
        ];
        for (const [key, round, data] of sides) {
            const value = structuredClone(data[sid]);
            const list = [];
            if (value.length > 0) {
                files[scenarioFile(sid, round)] = { scenario: sid, round, value };
                list.push(scenarioFile(sid, round));
            }
            entry[`round_${key}`] = { files: list, present: value.length > 0, count: value.length };
        }
        entry.round_b.id_equal = ROUND_B[sid].length > 0 ? true : null;
        entry.round_b.lookup = null;
        scenarios[sid] = entry;
    }
    const lookups = {
        S3: { status: 404, errorCode: 'ErrorItemNotFound', body: null },
        S5b: { status: 200, errorCode: null, body: { id: fakeId('S5b'), isCancelled: false } },
    };
    for (const [sid, item] of Object.entries(lookups)) {
        const file = `lookups/${sid}.roundB.json`;
        files[file] = [item];
        index.lookups.B[sid] = file;
        const isCancelled = item.body ? item.body.isCancelled : null;
        scenarios[sid].round_b.lookup = { file, status: item.status, isCancelled };
    }

    for (const round of ['A', 'B']) {
        const events = structuredClone(Object.values(round === 'A' ? ROUND_A : ROUND_B).flat());
        const chunks = [events.slice(0, 4), events.slice(4, 8), events.slice(8)];
        const bodies = chunks.map((value, i) => {
            const context = `${GRAPH}/$metadata#users('${FAKE_GUID}')/calendarView`;
            const body = { '@odata.context': context };
            if (i + 1 < chunks.length) {
                body['@odata.nextLink'] = link(i + 2);
            }
            return { ...body, value };
        });
        const requestsOf = (count) =>
            Array.from({ length: count }, (_, i) => ({
                page: i + 1,
                url: i === 0 ? `${GRAPH}/me/calendarView?$top=3` : link(i + 1),
                headerNames: ['Authorization', 'Accept', 'Prefer'],
                preferMode: 'combined',
                status: 200,
                errorCode: null,
            }));
        const prod = bodies.map((_, i) => pagePath(round, 'prod-select', i + 1));
        bodies.forEach((body, i) => (files[prod[i]] = body));
        const prodRequests = `calendarview/round${round}.prod-select.requests.json`;
        files[prodRequests] = requestsOf(3);
        const early = [0, 1].map((i) => pagePath(round, 'page2-no-prefer', i + 1));
        const stopped = [bodies[0], { ...bodies[1], '@odata.nextLink': link(3) }];
        early.forEach((file, i) => (files[file] = stopped[i]));
        const earlyRequests = `calendarview/round${round}.page2-no-prefer.requests.json`;
        files[earlyRequests] = requestsOf(2);
        index.calendarview[round] = {
            'prod-select': { pages: prod, requests: prodRequests, complete: true },
            'page2-no-prefer': { pages: early, requests: earlyRequests, complete: false },
        };
        index.id_format[round] = `calendarview/round${round}.id-format.json`;
        files[index.id_format[round]] = { round, same_value_count: 0, different_value_count: 3 };
    }

    const experiments = {};
    for (const key of [
        'prefer_combined',
        'prefer_separate',
        'page2_without_prefer',
        'id_format',
        'select_prod',
        'select_experiment',
        'full_shape_properties',
        'series_master',
        'round_b_lookups',
    ]) {
        experiments[key] = null;
    }
    const manifest = {
        captured_at: { A: '2026-10-19T15:00:00Z', B: '2026-10-26T15:00:00Z' },
        window: { start: '2026-10-19T00:00:00Z', end: '2026-11-16T00:00:00Z' },
        outlook_client: 'web',
        mailbox_timezone: 'Romance Standard Time',
        files: index,
        scenarios,
        experiments,
    };
    return { files, manifest };
}

function write(dir, relPath, data) {
    const target = path.join(dir, ...relPath.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    const text = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
    writeFileSync(target, text);
}

// Writes a fixture set into a fresh temp directory; `change` may edit it first.
function fixtureDir(t, change = () => {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'm365-fixtures-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fixtures = makeFixtures();
    change(fixtures);
    write(dir, 'README.md', 'Synthetic note for the fixtures.\n');
    write(dir, 'manifest.json', fixtures.manifest);
    for (const [relPath, data] of Object.entries(fixtures.files)) {
        write(dir, relPath, data);
    }
    return dir;
}

const dropFile = (fixtures, relPath) => delete fixtures.files[relPath];
const hasReason = (reasons, pattern) => reasons.some((reason) => pattern.test(reason));
const capture = () => {
    const out = { stdout: '', stderr: '' };
    return {
        out,
        io: {
            stdout: { write: (text) => (out.stdout += text) },
            stderr: { write: (text) => (out.stderr += text) },
        },
    };
};

// ---- schema -----------------------------------------------------------------------------

test('a minimal valid fixture set passes all four checks', (t) => {
    const dir = fixtureDir(t);

    assert.deepEqual(checkSchema(dir), []);
    assert.deepEqual(checkSemantic(dir), []);
    assert.deepEqual(checkLeaks(dir), []);
    assert.deepEqual(checkReplay(dir), []);
    const { io, out } = capture();
    assert.equal(main(['--dir', dir, '--raw', path.join(dir, 'no-raw')], io), 0, out.stderr);
    assert.match(out.stdout, /validate-fixtures: OK \(\d+ checks\)/);
});

test('schema: a JSON file that no manifest entry lists is an orphan', (t) => {
    const dir = fixtureDir(t);
    write(dir, 'calendarview/roundA.prod-select.page-9.json', { value: [] });
    write(dir, 'series/S2.master.roundA.json', { value: [] });

    const reasons = checkSchema(dir);

    assert.ok(hasReason(reasons, /orphan.*calendarview\/roundA\.prod-select\.page-9\.json/));
    assert.ok(hasReason(reasons, /orphan.*series\/S2\.master\.roundA\.json/));
});

test('schema: a listed path that does not exist fails, in the index and in a scenario list', (t) => {
    const fromIndex = fixtureDir(t, (fixtures) => dropFile(fixtures, 'me.json'));
    const fromScenario = fixtureDir(t, (fixtures) => dropFile(fixtures, scenarioFile('S1', 'A')));

    assert.ok(hasReason(checkSchema(fromIndex), /does not exist.*me\.json/));
    assert.ok(hasReason(checkSchema(fromScenario), /does not exist.*scenarios\/S1\.roundA\.json/));
});

test('schema: a manifest without files.me or a prod-select pass fails', (t) => {
    const noMe = fixtureDir(t, (fixtures) => delete fixtures.manifest.files.me);
    const noProd = fixtureDir(t, (fixtures) => {
        delete fixtures.manifest.files.calendarview.A['prod-select'];
    });

    assert.ok(hasReason(checkSchema(noMe), /files\.me/));
    assert.ok(hasReason(checkSchema(noProd), /files\.calendarview\.A\.prod-select/));
});

test('schema: a missing required scenario fails', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        delete fixtures.manifest.scenarios.S8;
        dropFile(fixtures, scenarioFile('S8', 'A'));
        dropFile(fixtures, scenarioFile('S8', 'B'));
    });

    assert.ok(hasReason(checkSchema(dir), /scenario S8 is missing/));
});

test('schema: with --round A a missing round_b and files.calendarview.B do not fail', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        for (const entry of Object.values(fixtures.manifest.scenarios)) {
            delete entry.round_b;
        }
        for (const relPath of Object.keys(fixtures.files)) {
            if (/round[B]|roundB/.test(relPath) || relPath.startsWith('lookups/')) {
                dropFile(fixtures, relPath);
            }
        }
        const { files, captured_at: captured } = fixtures.manifest;
        delete files.calendarview.B;
        delete files.id_format.B;
        delete files.lookups;
        delete captured.B;
    });

    assert.deepEqual(checkSchema(dir, { round: 'A' }), []);
    assert.deepEqual(checkSemantic(dir, { round: 'A' }), []);
    assert.deepEqual(checkReplay(dir, { round: 'A' }), []);
    assert.ok(hasReason(checkSchema(dir, { round: 'both' }), /round_b|calendarview\.B/));
});

test('schema: a missing manifest or experiments key and a wrong count fail', (t) => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'm365-fixtures-'));
    t.after(() => rmSync(empty, { recursive: true, force: true }));
    write(empty, 'README.md', 'only a readme\n');
    const noKey = fixtureDir(t, (fixtures) => delete fixtures.manifest.experiments.series_master);
    const badCount = fixtureDir(t, (fixtures) => {
        fixtures.manifest.scenarios.S2.round_a.count = 9;
    });

    assert.ok(hasReason(checkSchema(empty), /manifest\.json not found/));
    assert.ok(hasReason(checkSchema(noKey), /experiments.*series_master/));
    assert.ok(hasReason(checkSchema(badCount), /S2.*count/));
});

test('schema: synthetic scenarios must say so and live under scenarios/SYN-', (t) => {
    const addSynthetic = (fixtures, entry, file) => {
        fixtures.files[file] = { scenario: 'SYN-personal', value: [] };
        fixtures.manifest.scenarios['SYN-personal'] = {
            extra: true,
            observed: 'Synthetic: derived from S6 round A.',
            round_a: { files: [file], present: false, count: 0 },
            ...entry,
        };
    };
    const good = fixtureDir(t, (fixtures) => {
        addSynthetic(fixtures, { synthetic: true }, 'scenarios/SYN-personal.json');
    });
    const notFlagged = fixtureDir(t, (fixtures) => {
        addSynthetic(fixtures, { synthetic: false }, 'scenarios/SYN-personal.json');
    });
    const wrongPlace = fixtureDir(t, (fixtures) => {
        addSynthetic(fixtures, { synthetic: true }, 'scenarios/personal-copy.json');
    });

    assert.deepEqual(checkSchema(good), []);
    assert.ok(hasReason(checkSchema(notFlagged), /SYN-personal.*synthetic/));
    assert.ok(hasReason(checkSchema(wrongPlace), /SYN-personal.*scenarios\/SYN-/));
});

// ---- semantic ---------------------------------------------------------------------------

const setRoundB = (fixtures, sid, events, extra = {}) => {
    const file = scenarioFile(sid, 'B');
    const entry = fixtures.manifest.scenarios[sid].round_b;
    if (events.length > 0) {
        fixtures.files[file] = { scenario: sid, round: 'B', value: events };
        Object.assign(entry, { files: [file], present: true, count: events.length });
    } else {
        dropFile(fixtures, file);
        Object.assign(entry, { files: [], present: false, count: 0 });
    }
    Object.assign(entry, extra);
};

test('semantic: an absent cancelled event needs a recorded lookup, a present one needs the change', (t) => {
    const lookup = { file: 'lookups/S3.roundB.json', status: 404, isCancelled: null };
    const absentWithLookup = fixtureDir(t);
    const absentNoLookup = fixtureDir(t, (fixtures) => {
        fixtures.manifest.scenarios.S3.round_b.lookup = null;
        delete fixtures.manifest.files.lookups.B.S3;
        dropFile(fixtures, 'lookups/S3.roundB.json');
    });
    const presentCancelled = fixtureDir(t, (fixtures) => {
        const cancelled = { ...ROUND_A.S3[0], isCancelled: true };
        setRoundB(fixtures, 'S3', [cancelled], { id_equal: true, lookup });
    });
    const presentUnchanged = fixtureDir(t, (fixtures) => {
        setRoundB(fixtures, 'S3', ROUND_A.S3, { id_equal: true, lookup });
    });

    assert.deepEqual(checkSemantic(absentWithLookup), []);
    assert.ok(hasReason(checkSemantic(absentNoLookup), /S3 round B.*lookup/));
    assert.ok(!hasReason(checkSemantic(presentCancelled), /S3/));
    assert.ok(hasReason(checkSemantic(presentUnchanged), /S3 round B/));
});

test('semantic: declined events pass in either representation', (t) => {
    const lookup = { file: 'lookups/S3.roundB.json', status: 404, isCancelled: null };
    const absent = fixtureDir(t, (fixtures) => {
        setRoundB(fixtures, 'S4', [], { id_equal: null, lookup });
    });
    const unchanged = fixtureDir(t, (fixtures) => {
        setRoundB(fixtures, 'S4', ROUND_A.S4, { id_equal: true });
    });

    assert.ok(!hasReason(checkSemantic(absent), /S4/), 'absent with a lookup is accepted');
    assert.ok(hasReason(checkSemantic(unchanged), /S4 round B/), 'present and unchanged is not');
});

test('semantic: an S2 series needs DST evidence and an edited occurrence in round B', (t) => {
    const sameTime = fixtureDir(t, (fixtures) => {
        const flat = ROUND_A.S2.map((item) => ({ ...item, start: instant('10-20', '09:00:00') }));
        fixtures.files[scenarioFile('S2', 'A')].value = flat;
    });
    const noException = fixtureDir(t, (fixtures) => {
        setRoundB(fixtures, 'S2', ROUND_A.S2, { id_equal: true });
    });
    const moved = fixtureDir(t, (fixtures) => {
        const same = { ...EDITED, originalStart: '2026-10-27T09:00:00.0000000Z' };
        const events = [ROUND_A.S2[0], { ...same, start: instant('10-27', '09:00:00') }];
        setRoundB(fixtures, 'S2', events, { id_equal: true });
    });

    assert.ok(hasReason(checkSemantic(sameTime), /S2 round A.*DST|time of day/));
    assert.ok(hasReason(checkSemantic(noException), /S2 round B.*originalStart/));
    assert.ok(hasReason(checkSemantic(moved), /S2 round B.*originalStart/));
});

test('semantic: the single-scenario facts are checked', (t) => {
    const replaceA = (sid, overrides) => (fixtures) => {
        fixtures.files[scenarioFile(sid, 'A')].value = [event(sid, overrides)];
    };
    const cases = [
        ['S1', replaceA('S1', { isOrganizer: true })],
        ['S1b', replaceA('S1b', { attendees: [] })],
        ['S6', replaceA('S6', { isOrganizer: true })],
        ['S6b', replaceA('S6b', { sensitivity: '' })],
        ['S7', replaceA('S7', { attendees: [] })],
        ['S8', replaceA('S8', { isOrganizer: true })],
        ['S5', (fixtures) => setRoundB(fixtures, 'S5', ROUND_A.S5, { id_equal: null })],
        ['S5b', (fixtures) => (fixtures.manifest.scenarios.S5b.round_b.lookup = null)],
    ];

    for (const [sid, change] of cases) {
        const reasons = checkSemantic(fixtureDir(t, change));
        const pattern = new RegExp(`^${sid} round [AB]`);
        assert.ok(hasReason(reasons, pattern), `${sid}: ${reasons.join(' | ')}`);
    }
});

test('semantic: an optional scenario is checked only when listed', (t) => {
    const addE2 = (fixtures, masters) => {
        const make = (id, i) => event('E2', { id: fakeId(`E2${i}`), seriesMasterId: id });
        const events = masters.map(make);
        fixtures.files[scenarioFile('E2', 'B')] = { scenario: 'E2', round: 'B', value: events };
        fixtures.manifest.scenarios.E2 = {
            extra: true,
            synthetic: false,
            observed: 'Observed E2.',
            round_a: { files: [], present: false, count: 0 },
            round_b: {
                files: [scenarioFile('E2', 'B')],
                present: true,
                count: events.length,
                id_equal: null,
                lookup: null,
            },
        };
    };
    const split = fixtureDir(t, (fixtures) => addE2(fixtures, [fakeId('m1'), fakeId('m2')]));
    const single = fixtureDir(t, (fixtures) => addE2(fixtures, [fakeId('m1'), fakeId('m1')]));

    assert.deepEqual(checkSemantic(split), []);
    assert.ok(hasReason(checkSemantic(single), /E2 round B.*seriesMasterId/));
});

// ---- leaks ------------------------------------------------------------------------------

const withS1 = (fixtures, change) => {
    const document = fixtures.files[scenarioFile('S1', 'A')];
    change(document.value[0], document);
};

test('leaks: an e-mail, a link host, a GUID, a token or an id that is not allowed fails', (t) => {
    const jwt = ['eyJ', 'hbGciOiJub25lIn0', '.eyJ', 'zdWIiOiIxIn0'].join('');
    const foreign = mail('x', 'contoso.com');
    const stray = guidOf('1b9e7a52', '66c1', '4d3f', 'a0b7', '5c2d9e41f8aa');
    const cases = [
        [/e-mail/, (item) => (item.organizer = { emailAddress: { address: foreign } })],
        [/URL host/, (item) => (item.webLink = 'https://outlook.office365.com/owa/item')],
        [/GUID/, (item) => (item.extra = stray)],
        [/JWT/, (item) => (item.extra = jwt)],
        [/id value/, (item) => (item.id = 'AAMkAGI2NTRealLookingId=')],
    ];

    for (const [pattern, change] of cases) {
        const dir = fixtureDir(t, (fixtures) => withS1(fixtures, change));
        const reasons = checkLeaks(dir);
        assert.ok(hasReason(reasons, pattern), `${pattern}: ${reasons.join(' | ')}`);
        assert.ok(reasons.every((reason) => !reason.includes('contoso')), 'values are not printed');
    }
});

test('leaks: body keys, untagged events and README content are checked too', (t) => {
    const withBody = fixtureDir(t, (fixtures) => {
        withS1(fixtures, (item) => (item.body = { contentType: 'html', content: 'x' }));
    });
    const withPreview = fixtureDir(t, (fixtures) => {
        withS1(fixtures, (item) => (item.bodyPreview = 'text'));
    });
    const untagged = fixtureDir(t, (fixtures) => {
        withS1(fixtures, (_, document) => document.value.push(event('S1', { subject: 'Event 1' })));
    });
    const readme = fixtureDir(t);
    const text = `Contact ${mail('someone', 'contoso.com')} at https://contoso.com/x\n`;
    write(readme, 'README.md', text);
    const goodReadme = fixtureDir(t);
    write(goodReadme, 'README.md', `See ${GRAPH}/me/calendarView and person-1@example.test\n`);

    assert.ok(hasReason(checkLeaks(withBody), /body/));
    assert.ok(hasReason(checkLeaks(withPreview), /bodyPreview/));
    assert.ok(hasReason(checkLeaks(untagged), /event without a scenario tag/));
    assert.ok(hasReason(checkLeaks(readme), /README\.md.*e-mail/));
    assert.ok(hasReason(checkLeaks(readme), /README\.md.*URL host/));
    assert.deepEqual(checkLeaks(goodReadme), []);
});

test('leaks: a value from the raw data found in an output fails, a missing raw dir is skipped', (t) => {
    const secretName = 'Ana Garcia Ruiz';
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-raw-'));
    t.after(() => rmSync(rawDir, { recursive: true, force: true }));
    const doc = { pages: [{ body: { value: [{ displayName: secretName }] } }] };
    write(rawDir, 'roundA/prod-select.json', doc);
    write(rawDir, 'salt', 'ignored\n');
    const clean = fixtureDir(t);
    const dirty = fixtureDir(t, (fixtures) => {
        withS1(fixtures, (item) => (item.location = { displayName: secretName }));
    });

    assert.deepEqual(checkLeaks(clean, { rawDir }), []);
    const reasons = checkLeaks(dirty, { rawDir });
    assert.ok(hasReason(reasons, /scenarios\/S1\.roundA\.json.*name value from the raw data/));
    assert.ok(reasons.every((reason) => !reason.includes(secretName)));
    assert.deepEqual(checkLeaks(dirty, { rawDir: path.join(rawDir, 'missing') }), []);
});

// ---- replay -----------------------------------------------------------------------------

const prodPages = (fixtures, round = 'A') =>
    fixtures.manifest.files.calendarview[round]['prod-select'].pages;

test('replay: a three-page pass replays as three requests and sums its events', (t) => {
    const dir = fixtureDir(t);

    const report = replayReport(dir, 'A');

    assert.deepEqual(report.reasons, []);
    const eventCount = Object.values(ROUND_A).flat().length;
    const expected = { round: 'A', pass: 'prod-select', requests: 3, events: eventCount };
    assert.deepEqual(report.passes, [expected]);
});

test('replay: a middle page without a next link fails', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        delete fixtures.files[prodPages(fixtures)[1]]['@odata.nextLink'];
    });

    assert.ok(hasReason(checkReplay(dir), /round A prod-select.*page 2.*next link/));
});

test('replay: a last page that still has a next link fails', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        fixtures.files[prodPages(fixtures)[2]]['@odata.nextLink'] = link(4);
    });

    assert.ok(hasReason(checkReplay(dir), /round A prod-select.*last page/));
});

test('replay: two pages swapped in the manifest list fail on the page token', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        const pages = prodPages(fixtures);
        [pages[0], pages[1]] = [pages[1], pages[0]];
    });

    assert.ok(hasReason(checkReplay(dir), /round A prod-select.*SANITIZED-PAGE-2/));
});

test('replay: a next link outside /me/calendarView fails', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        const first = fixtures.files[prodPages(fixtures)[0]];
        first['@odata.nextLink'] = `${GRAPH}/me/events?$skiptoken=SANITIZED-PAGE-2`;
    });

    assert.ok(hasReason(checkReplay(dir), /round A prod-select.*\/me\/calendarView/));
});

test('replay: a pass marked incomplete is skipped, an unlisted page file is ignored', (t) => {
    const dir = fixtureDir(t);
    write(dir, 'calendarview/roundA.prod-select.page-4.json', { value: [{ id: 'x' }] });

    const report = replayReport(dir, 'A');

    assert.deepEqual(report.reasons, []);
    assert.deepEqual(report.passes.map((entry) => entry.pass), ['prod-select']);
});

test('replay: a pages count that differs from the requests file fails', (t) => {
    const dir = fixtureDir(t, (fixtures) => {
        const requests = fixtures.manifest.files.calendarview.A['prod-select'].requests;
        fixtures.files[requests].pop();
    });

    assert.ok(hasReason(checkReplay(dir), /round A prod-select.*requests/));
});

test('replay: every checked round needs a complete prod-select pass', (t) => {
    const incomplete = fixtureDir(t, (fixtures) => {
        fixtures.manifest.files.calendarview.B['prod-select'].complete = false;
    });
    const empty = mkdtempSync(path.join(os.tmpdir(), 'm365-fixtures-'));
    t.after(() => rmSync(empty, { recursive: true, force: true }));

    assert.ok(hasReason(checkReplay(incomplete), /round B.*complete prod-select/));
    assert.deepEqual(checkReplay(incomplete, { round: 'A' }), []);
    assert.ok(hasReason(checkReplay(empty), /manifest\.json not found/));
});

// ---- CLI --------------------------------------------------------------------------------

test('the CLI fails on a tree with only a README, with and without a check flag', (t) => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'm365-fixtures-'));
    t.after(() => rmSync(empty, { recursive: true, force: true }));
    write(empty, 'README.md', 'only a readme\n');
    const noRaw = path.join(empty, 'no-raw');

    for (const flags of [[], ['--replay'], ['--schema'], ['--semantic']]) {
        const { io, out } = capture();
        assert.equal(main(['--dir', empty, '--raw', noRaw, ...flags], io), 1, flags.join(' '));
        assert.match(out.stdout, /FAIL .*manifest\.json not found/);
    }
});

test('the CLI rejects unknown flags and rounds without echoing them', () => {
    const { io, out } = capture();

    assert.equal(main(['--no-such-flag'], io), 2);
    assert.equal(main(['--round', 'Z'], io), 2);
    assert.equal(out.stderr.includes('no-such-flag'), false);
    assert.match(out.stderr, /Usage/);
});

test('the CLI runs one named check and prints the replay counts', (t) => {
    const dir = fixtureDir(t);
    const { io, out } = capture();

    assert.equal(main(['--dir', dir, '--replay'], io), 0, out.stdout);
    assert.match(out.stdout, /replay: round A prod-select: 3 requests, 13 events/);
    assert.match(out.stdout, /validate-fixtures: OK \(\d+ checks\)/);
});
