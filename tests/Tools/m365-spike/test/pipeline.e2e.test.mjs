import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCapture } from '../capture.mjs';
import { buildLeakSet, findLeaks } from '../lib/sanitize.mjs';
import { REQUIRED_SCENARIOS, findUntaggedEvents } from '../lib/scenarios.mjs';
import { run } from '../sanitize.mjs';
import { buildEnv, followRedirects, makeEvent, startFakeMicrosoft } from './fake-microsoft.mjs';

const SPIKE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANITIZE_CLI = path.join(SPIKE_DIR, 'sanitize.mjs');

// Real-looking identities, assembled at runtime so no committed file contains an address.
const mail = (local, domain) => `${local}@${domain}`;
const OWNER = mail('ana.garcia', 'contoso.com');
const BLOCKED = mail('luis.perez', 'contoso.com');
const THIRD = mail('marta.ruiz', 'fabrikam.org');
const FOURTH = mail('pedro.gil', 'fabrikam.org');
const ICAL_PREFIX = '040000008200E00074C5B7101A82E008';

const person = (name, address) => ({ emailAddress: { name, address } });
const attendee = (name, address) => ({
    type: 'required',
    status: { response: 'accepted', time: '2026-10-01T08:00:00Z' },
    emailAddress: { name, address },
});
const eventId = (n) => Buffer.alloc(74, 0xe0 + n).toString('base64');
const at = (day, hour) => ({
    dateTime: `2026-${day}T${String(hour).padStart(2, '0')}:00:00.0000000`,
    timeZone: 'UTC',
});

const organizerIsA = {
    isOrganizer: true,
    organizer: person('Ana García', OWNER),
    responseStatus: { response: 'organizer', time: '0001-01-01T00:00:00Z' },
};
const organizerIsB = {
    isOrganizer: false,
    organizer: person('Luis Pérez', BLOCKED),
    responseStatus: { response: 'accepted', time: '2026-10-01T08:00:00Z' },
};

function eventOf(n, subject, overrides) {
    const hex = n.toString(16).padStart(2, '0').toUpperCase();
    return makeEvent(n, {
        id: eventId(n),
        iCalUId: `${ICAL_PREFIX}${hex.repeat(16)}`,
        subject,
        originalStartTimeZone: 'Romance Standard Time',
        ...overrides,
    });
}

const MASTER_2 = eventId(40);
const MASTER_X = eventId(41);
const WEEKLY = {
    recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 5 },
    },
};

const S1 = eventOf(1, '[M365-TEST S1] single', {
    ...organizerIsB,
    attendees: [attendee('Ana García', OWNER)],
    start: at('10-20', 9),
    end: at('10-20', 10),
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_planted' },
    location: { displayName: 'Sala Picasso Madrid' },
    body: { contentType: 'html', content: '<p>confidential agenda text</p>' },
    newFieldX: 'planted unknown field value',
});
const S1B = eventOf(2, '[M365-TEST S1b] organizer', {
    ...organizerIsA,
    attendees: [attendee('Luis Pérez', BLOCKED)],
    start: at('10-21', 9),
    end: at('10-21', 10),
});
const occurrence = (n, day, hour) =>
    eventOf(n, '[M365-TEST S2] series', {
        ...organizerIsB,
        type: 'occurrence',
        seriesMasterId: MASTER_2,
        attendees: [attendee('Ana García', OWNER)],
        start: at(day, hour),
        end: at(day, hour + 1),
    });
const S2A = occurrence(3, '10-20', 8);
const S2B = occurrence(4, '10-27', 9);
const S2C = occurrence(5, '11-03', 9);
const S3 = eventOf(6, '[M365-TEST S3] cancelled', {
    ...organizerIsB,
    start: at('10-22', 9),
    end: at('10-22', 10),
});
const S4 = eventOf(7, '[M365-TEST S4] declined', {
    ...organizerIsB,
    start: at('10-22', 11),
    end: at('10-22', 12),
});
const S5 = eventOf(8, '[M365-TEST S5] moved', {
    ...organizerIsB,
    start: at('10-23', 10),
    end: at('10-23', 11),
});
const S5B = eventOf(9, '[M365-TEST S5b] moved week', {
    ...organizerIsB,
    start: at('10-23', 14),
    end: at('10-23', 15),
});
const S6 = eventOf(10, '[M365-TEST S6] private', {
    ...organizerIsA,
    sensitivity: 'private',
    attendees: [attendee('Luis Pérez', BLOCKED)],
    start: at('10-24', 9),
    end: at('10-24', 10),
});
const S6B = eventOf(11, '[M365-TEST S6b] private attendee', {
    ...organizerIsB,
    sensitivity: 'private',
    start: at('10-24', 11),
    end: at('10-24', 12),
});
const S7 = eventOf(12, '[M365-TEST S7] all day', {
    ...organizerIsA,
    isAllDay: true,
    attendees: [],
    start: at('10-26', 0),
    end: at('10-27', 0),
});
const S8 = eventOf(13, '[M365-TEST S8] block', {
    ...organizerIsA,
    attendees: [],
    start: at('10-26', 14),
    end: at('10-26', 15),
});
// Real meetings of the capture mailbox: they must never reach a fixture in any form.
const BOARD = eventOf(14, 'Board offsite with Contoso', {
    ...organizerIsB,
    organizer: person('Marta Ruiz', THIRD),
    attendees: [attendee('Ana García', OWNER), attendee('Pedro Gil', FOURTH)],
    location: { displayName: 'Hotel Orfila' },
    body: { contentType: 'text', content: 'Budget figures for the offsite' },
    start: at('10-28', 9),
    end: at('10-28', 10),
});
const syncOf = (n, day) =>
    eventOf(n, 'Weekly sync with Fabrikam', {
        ...organizerIsB,
        organizer: person('Marta Ruiz', THIRD),
        type: 'occurrence',
        seriesMasterId: MASTER_X,
        start: at(day, 15),
        end: at(day, 16),
    });
const SYNC_1 = syncOf(15, '10-21');
const SYNC_2 = syncOf(16, '10-28');

const ROUND_A = [S1, S1B, S2A, S2B, S2C, S3, S4, S5, S5B, S6, S6B, S7, S8, BOARD, SYNC_1, SYNC_2];
const S2B_EDITED = {
    ...S2B,
    type: 'exception',
    subject: '[M365-TEST S2] series (edited)',
    originalStart: '2026-10-27T09:00:00Z',
    start: at('10-27', 10),
    end: at('10-27', 11),
};
const DECLINED = { response: 'declined', time: '2026-10-05T08:00:00Z' };
const S4_DECLINED = { ...S4, responseStatus: DECLINED };
const S5_MOVED = { ...S5, start: at('10-23', 11), end: at('10-23', 12) };
const ROUND_B = [
    S1,
    S1B,
    S2A,
    S2B_EDITED,
    S2C,
    S4_DECLINED,
    S5_MOVED,
    S6,
    S6B,
    S7,
    S8,
    BOARD,
    SYNC_1,
    SYNC_2,
];
const MASTERS = {
    [MASTER_2]: eventOf(40, '[M365-TEST S2] series', {
        id: MASTER_2,
        type: 'seriesMaster',
        ...WEEKLY,
        cancelledOccurrences: [],
    }),
    [MASTER_X]: eventOf(41, 'Weekly sync with Fabrikam', {
        id: MASTER_X,
        type: 'seriesMaster',
        ...WEEKLY,
    }),
    // Moved to another week: gone from the window, still found by a direct lookup.
    [S5B.id]: { ...S5B, start: at('11-06', 14), end: at('11-06', 15) },
};

// Strings that identify the capture mailbox and must not survive anywhere.
const PLANTED = [
    OWNER,
    BLOCKED,
    THIRD,
    FOURTH,
    'Ana García',
    'Luis Pérez',
    'Marta Ruiz',
    'Pedro Gil',
    'Board offsite with Contoso',
    'Weekly sync with Fabrikam',
    'confidential agenda text',
    'Budget figures for the offsite',
    'planted unknown field value',
    'Sala Picasso Madrid',
    'Hotel Orfila',
    'meeting_planted',
    eventId(1),
    eventId(14),
    MASTER_X,
];

const SANITIZE_ENV = {
    M365_SPIKE_LOGIN_HINT: OWNER,
    M365_SPIKE_BLOCKED_LOGIN_HINT: BLOCKED,
    M365_SPIKE_OUTLOOK_CLIENT: 'web',
};

// ---- helpers ----------------------------------------------------------------------------

const toPosix = (value) => value.split(path.sep).join('/');
const temp = (label) => mkdtempSync(path.join(os.tmpdir(), `m365-${label}-`));

function listFiles(dir, base = dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...listFiles(full, base));
        } else {
            found.push(toPosix(path.relative(base, full)));
        }
    }
    return found.sort();
}

const readText = (dir, file) => readFileSync(path.join(dir, ...file.split('/')), 'utf8');
const readJson = (dir, file) => JSON.parse(readText(dir, file));

function snapshot(dir) {
    return new Map(listFiles(dir).map((file) => [file, readText(dir, file)]));
}

function collectStrings(node, into = []) {
    if (typeof node === 'string') {
        into.push(node);
    } else if (node !== null && typeof node === 'object') {
        Object.values(node).forEach((child) => collectStrings(child, into));
    }
    return into;
}

function rawDocuments(rawDir) {
    return listFiles(rawDir)
        .filter((file) => file.endsWith('.json') && !file.endsWith('identity-map.json'))
        .map((file) => readJson(rawDir, file));
}

function io() {
    const out = { stdout: '', stderr: '' };
    return {
        out,
        streams: {
            stdout: { write: (text) => (out.stdout += text) },
            stderr: { write: (text) => (out.stderr += text) },
        },
    };
}

function sanitize(rawDir, outDir, hooks) {
    const streams = io();
    const result = run({ rawDir, outDir, env: SANITIZE_ENV, hooks, ...streams.streams });
    return { ...result, ...streams.out };
}

async function capture(fake, rawDir, round) {
    return runCapture({
        env: buildEnv(fake, { M365_SPIKE_LOGIN_HINT: OWNER }),
        round,
        endpoints: { authorityBase: fake.authorityBase, graphBase: fake.graphBase },
        openUrl: followRedirects,
        rawDir,
        timeoutMs: 10_000,
    });
}

// ---- one fake mailbox, captured in two rounds and sanitized ---------------------------

let ctx;

before(async () => {
    const quiet = mock.method(console, 'log', () => {});
    const user = {
        id: randomUUID(),
        displayName: 'Ana García',
        givenName: 'Ana',
        surname: 'García',
        mail: OWNER,
        userPrincipalName: OWNER,
        userType: 'Member',
        preferredLanguage: 'es-ES',
    };
    const onePerPage = (events) => events.map((event) => [event]);
    const fake = await startFakeMicrosoft({
        pagesByRound: { A: onePerPage(ROUND_A), B: onePerPage(ROUND_B) },
        user,
        masters: MASTERS,
    });
    const dirs = { raw: temp('raw'), out: temp('out'), outA: temp('outA') };
    // Registered first, so a failing setup still closes the server and removes the directories.
    ctx = { fake, dirs };
    try {
        await capture(fake, dirs.raw, 'A');
        const onlyA = sanitize(dirs.raw, dirs.outA);
        fake.round = 'B';
        await capture(fake, dirs.raw, 'B');
        const both = sanitize(dirs.raw, dirs.out);
        const manifest = readJson(dirs.out, 'manifest.json');
        Object.assign(ctx, { onlyA, both, manifest, snapshotA: snapshot(dirs.outA) });
    } finally {
        quiet.mock.restore();
    }
});

after(async () => {
    await ctx?.fake.close();
    for (const dir of Object.values(ctx?.dirs ?? {})) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ---- tests ------------------------------------------------------------------------------

test('the manifest lists every required scenario with its observed presence per round', () => {
    const { manifest, both } = ctx;

    assert.equal(both.exitCode, 0, both.stderr);
    assert.deepEqual(Object.keys(manifest.captured_at), ['A', 'B']);
    assert.equal(manifest.outlook_client, 'web');
    assert.equal(manifest.mailbox_timezone, 'Romance Standard Time');
    const absentInB = ['S3', 'S5b'];
    for (const sid of REQUIRED_SCENARIOS) {
        const entry = manifest.scenarios[sid];
        assert.equal(entry.synthetic, false, sid);
        assert.equal(entry.extra, false, sid);
        assert.equal(entry.round_a.present, true, `${sid} round A`);
        assert.equal(entry.round_b.present, !absentInB.includes(sid), `${sid} round B`);
        assert.ok(entry.observed.startsWith('Round A: present ('), sid);
    }
    assert.equal(manifest.scenarios.S2.round_a.count, 3);
    assert.equal(manifest.scenarios.S3.round_b.count, 0);
    assert.deepEqual(manifest.scenarios.S3.round_b.files, []);
    assert.equal(manifest.scenarios.S5.round_b.id_equal, true);
});

test('every JSON file except the manifest is listed, and every listed file exists', () => {
    const { manifest, dirs } = ctx;
    const listed = new Set(collectStrings(manifest.files));
    for (const entry of Object.values(manifest.scenarios)) {
        for (const round of [entry.round_a, entry.round_b]) {
            (round?.files ?? []).forEach((file) => listed.add(file));
        }
    }

    const onDisk = listFiles(dirs.out).filter((file) => file !== 'manifest.json');

    assert.deepEqual(onDisk, [...listed].sort());
    for (const file of listed) {
        assert.ok(existsSync(path.join(dirs.out, ...file.split('/'))), file);
    }
});

test('page lists keep page order beyond ten pages and record completeness', () => {
    const { manifest, dirs } = ctx;
    const prod = manifest.files.calendarview.A['prod-select'];
    const expected = Array.from(
        { length: ROUND_A.length },
        (_, index) => `calendarview/roundA.prod-select.page-${index + 1}.json`
    );

    assert.deepEqual(prod.pages, expected);
    assert.notDeepEqual([...prod.pages].sort(), prod.pages, 'page-10 sorts before page-2');
    assert.equal(prod.complete, true);
    assert.equal(manifest.files.calendarview.B['prod-select'].pages.length, ROUND_B.length);
    assert.equal(manifest.files.calendarview.A['page2-no-prefer'].complete, false);
    assert.equal(manifest.files.calendarview.A['page2-no-prefer'].pages.length, 2);
    const requests = readJson(dirs.out, prod.requests);
    assert.equal(requests.length, ROUND_A.length);
    assert.deepEqual(
        requests.map((request) => request.page),
        expected.map((_, index) => index + 1)
    );
    assert.ok(requests.every((request) => request.status === 200));
    const firstPage = readJson(dirs.out, prod.pages[0]);
    assert.ok(firstPage['@odata.nextLink'].includes('SANITIZED-PAGE-2'));
    assert.equal('@odata.nextLink' in readJson(dirs.out, prod.pages.at(-1)), false);
});

test('a vanished event is recorded as absent with its direct lookup, a moved one is found', () => {
    const { manifest, dirs } = ctx;
    const gone = manifest.scenarios.S3.round_b;
    const moved = manifest.scenarios.S5b.round_b;

    assert.equal(gone.present, false);
    assert.equal(gone.lookup.status, 404);
    const lookups = readJson(dirs.out, gone.lookup.file);
    assert.deepEqual(lookups, [{ status: 404, errorCode: 'ErrorItemNotFound', body: null }]);
    assert.equal(moved.present, false);
    assert.equal(moved.lookup.status, 200);
    const expectedGone =
        'Round A: present (type=singleInstance, isOrganizer=false, responseStatus=accepted, ' +
        'sensitivity=normal). Round B: absent from calendarView; ' +
        'direct lookup 404 (ErrorItemNotFound).';
    assert.equal(manifest.scenarios.S3.observed, expectedGone);
    const declined = readJson(dirs.out, manifest.scenarios.S4.round_b.files[0]);
    assert.equal(declined.value[0].responseStatus.response, 'declined');
    const edited = readJson(dirs.out, manifest.scenarios.S2.round_b.files[0]);
    assert.ok(edited.value.some((event) => event.type === 'exception' && event.originalStart));
});

test('no raw identifying value, body or unknown field reaches any output', () => {
    const { dirs } = ctx;
    const leakSet = buildLeakSet(rawDocuments(dirs.raw));

    for (const file of listFiles(dirs.out)) {
        const text = readText(dirs.out, file);
        for (const value of PLANTED) {
            assert.equal(text.includes(value), false, `${file} contains a planted value`);
        }
        assert.deepEqual(findLeaks(text, leakSet), [], `${file} leaks a raw value`);
        // Property names are schema, not data: the manifest lists them, no other file may.
        const keys = file === 'manifest.json' ? [] : ['newFieldX'];
        for (const key of ['contentType', 'bodyPreview', 'categories', ...keys]) {
            assert.equal(text.includes(key), false, `${file} contains ${key}`);
        }
    }
    assert.ok(leakSet.size > 100, 'the guard should know many raw values');
});

test('events without a scenario tag never reach a fixture, series and lookups included', () => {
    const { manifest, dirs, both } = ctx;
    const subjects = [];
    for (const file of listFiles(dirs.out)) {
        const data = readJson(dirs.out, file);
        assert.equal(findUntaggedEvents(data), 0, `${file} holds an untagged event`);
        const walk = (node) => {
            if (Array.isArray(node)) {
                node.forEach(walk);
            } else if (node !== null && typeof node === 'object') {
                if ('subject' in node) {
                    subjects.push(node.subject);
                }
                Object.values(node).forEach(walk);
            }
        };
        walk(data);
    }

    assert.ok(subjects.length > 20);
    assert.ok(subjects.every((subject) => subject.includes('[M365-TEST ')));
    assert.deepEqual(Object.keys(manifest.files.series.A), ['S2']);
    const masters = readJson(dirs.out, manifest.files.series.A.S2.master);
    assert.equal(masters.value.length, 1);
    const instances = readJson(dirs.out, manifest.files.series.A.S2.instances);
    assert.equal(instances.pages.flatMap((page) => page.value).length, 3);
    assert.deepEqual(Object.keys(manifest.files.lookups.B).sort(), [...REQUIRED_SCENARIOS].sort());
    const lookupCount = Object.values(manifest.files.lookups.B)
        .map((file) => readJson(dirs.out, file).length)
        .reduce((sum, length) => sum + length, 0);
    assert.equal(lookupCount, 13, 'one lookup per tagged Round A event, none for the others');
    assert.ok(both.summary.droppedUntagged > 0);
    assert.match(both.stdout, /events without a scenario tag dropped/);
});

test('Round A outputs are byte-identical with and without Round B, and a rerun changes nothing', () => {
    const { dirs, snapshotA, onlyA } = ctx;

    assert.equal(onlyA.exitCode, 0, onlyA.stderr);
    assert.equal(onlyA.summary.scenariosB, null);
    assert.ok(snapshotA.size > 40);
    for (const [file, text] of snapshotA) {
        if (file !== 'manifest.json') {
            assert.equal(readText(dirs.out, file), text, `${file} changed when Round B was added`);
        }
    }
    const again = temp('again');
    try {
        assert.equal(sanitize(dirs.raw, again).exitCode, 0);
        assert.deepEqual(snapshot(again), snapshot(dirs.out));
    } finally {
        rmSync(again, { recursive: true, force: true });
    }
});

test('the experiments are summarized without values', () => {
    const { experiments } = ctx.manifest;

    assert.deepEqual(experiments.prefer_combined, { status: 200, utc_on_all_pages: true });
    assert.deepEqual(experiments.prefer_separate, { status: 200, utc_on_all_pages: true });
    assert.deepEqual(experiments.page2_without_prefer, {
        status: 200,
        page2_timezones: ['Romance Standard Time'],
        page2_ids_equal_to_combined: { equal: 0, different: 1 },
    });
    assert.equal(experiments.id_format.immutable.min_length, 100);
    assert.equal(experiments.id_format.immutable.max_length, 100);
    assert.match(experiments.id_format.immutable.charset, /^A-Za-z0-9[+/=]+$/);
    assert.equal(experiments.id_format.default.max_length, 108);
    assert.equal(experiments.id_format.same_value_count, 0);
    assert.equal(experiments.id_format.different_value_count, 13, 'tagged events only');
    assert.deepEqual(experiments.select_prod, {
        status: 200,
        error_code: null,
        lastModifiedDateTime_returned: false,
        attendees_returned: false,
    });
    assert.deepEqual(experiments.select_experiment, {
        status: 200,
        error_code: null,
        lastModifiedDateTime_returned: true,
        attendees_returned: true,
    });
    assert.ok(experiments.full_shape_properties.includes('subject'));
    assert.ok(experiments.full_shape_properties.includes('newFieldX'));
    assert.deepEqual(experiments.series_master, {
        status: 200,
        cancelledOccurrences_present: false,
        recurrence_present: true,
    });
    assert.deepEqual(experiments.round_b_lookups, { 200: 12, 404: 1 });
});

test('confidential and personal copies are synthetic, derived from S6, and say so', () => {
    const { manifest, dirs } = ctx;

    for (const [id, sensitivity] of [
        ['SYN-confidential', 'confidential'],
        ['SYN-personal', 'personal'],
    ]) {
        const entry = manifest.scenarios[id];
        assert.equal(entry.synthetic, true);
        assert.equal(entry.extra, true);
        assert.deepEqual(entry.round_a.files, [`scenarios/${id}.json`]);
        assert.ok(entry.observed.startsWith('Synthetic: derived from S6 round A'));
        const document = readJson(dirs.out, entry.round_a.files[0]);
        assert.equal(document.synthetic, true);
        assert.ok(document.value.every((event) => event.sensitivity === sensitivity));
    }
    assert.equal(manifest.scenarios.S6.synthetic, false);
});

test('the signed-in user becomes test user A and the token shape keeps names only', () => {
    const { dirs, manifest } = ctx;

    const me = readJson(dirs.out, manifest.files.me);
    assert.equal(me.displayName, 'Test User A');
    assert.equal(me.mail, 'person-a@example.test');
    assert.match(me.id, /^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    const shape = readJson(dirs.out, manifest.files.token_shape);
    assert.equal(shape.tokenType, 'Bearer');
    assert.equal(shape.refreshTokenIssued, true);
    assert.ok(Array.isArray(shape.keys));
});

test('a leak in an allow-listed field fails the run and leaves no outputs behind', () => {
    const outDir = temp('leak');
    try {
        mkdirSync(path.join(outDir, 'calendarview'));
        writeFileSync(path.join(outDir, 'calendarview', 'stale.json'), '{}\n');
        writeFileSync(path.join(outDir, 'README.md'), 'kept\n');
        const plant = (written) => {
            const document = written.get('scenarios/S1.roundA.json');
            document.value[0].subject = `[M365-TEST S1] ${OWNER}`;
        };

        const result = sanitize(ctx.dirs.raw, outDir, { mutateOutputs: plant });

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /scenarios\/S1\.roundA\.json/);
        assert.match(result.stderr, /e-mail/);
        assert.equal(result.stderr.includes(OWNER), false, 'the leaked value is never printed');
        assert.deepEqual(listFiles(outDir), ['README.md']);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});

test('an event without a scenario tag in any output fails the run', () => {
    const outDir = temp('untagged');
    try {
        const plant = (written) => {
            const page = written.get('calendarview/roundA.prod-select.page-1.json');
            page.value.push({ id: 'FAKEplaced', subject: 'Event 1', type: 'singleInstance' });
        };

        const result = sanitize(ctx.dirs.raw, outDir, { mutateOutputs: plant });

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /an event without a scenario tag/);
        assert.deepEqual(listFiles(outDir), []);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});

test('the CLI names a missing Round A file, rejects odd arguments and never echoes them', () => {
    const empty = temp('empty');
    const out = temp('cli-out');
    try {
        const node = process.execPath;
        const missing = spawnSync(node, [SANITIZE_CLI, '--raw', empty, '--out', out]);
        assert.equal(missing.status, 1);
        assert.match(String(missing.stderr), /roundA[\\/]meta\.json/);

        const unknown = spawnSync(node, [SANITIZE_CLI, '--secret-looking-flag']);
        assert.equal(unknown.status, 2);
        assert.equal(String(unknown.stderr).includes('secret-looking-flag'), false);

        const same = spawnSync(node, [SANITIZE_CLI, '--raw', ctx.dirs.raw, '--out', ctx.dirs.raw]);
        assert.equal(same.status, 2);
        assert.deepEqual(listFiles(out), []);
    } finally {
        rmSync(empty, { recursive: true, force: true });
        rmSync(out, { recursive: true, force: true });
    }
});

test('the CLI sanitizes a captured raw directory and prints counts only', () => {
    const out = temp('cli-run');
    try {
        const env = { ...process.env, ...SANITIZE_ENV };
        const args = [SANITIZE_CLI, '--raw', ctx.dirs.raw, '--out', out];

        const result = spawnSync(process.execPath, args, { env });

        assert.equal(result.status, 0, String(result.stderr));
        const stdout = String(result.stdout);
        assert.match(stdout, /^sanitize: wrote \d+ files \(scenarios present in round A: \d+/);
        for (const value of PLANTED) {
            assert.equal(stdout.includes(value), false);
        }
        assert.deepEqual(snapshot(out), snapshot(ctx.dirs.out));
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});
