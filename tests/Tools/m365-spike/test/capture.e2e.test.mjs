import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENV_NAMES, parseWindow, runCapture } from '../capture.mjs';
import { fetchAllPages } from '../lib/graph.mjs';
import { assertEndpoints, assertTenantId } from '../lib/oauth.mjs';
import {
    buildEnv,
    followRedirects,
    headerValues,
    makeEvent,
    readAllFiles,
    startFakeMicrosoft,
    threePages,
} from './fake-microsoft.mjs';

const TIMEOUT_MS = 10_000;
const SPIKE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function setup(t, options = {}) {
    const fake = await startFakeMicrosoft({ pagesByRound: { A: threePages() }, ...options });
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-spike-'));
    t.after(async () => {
        await fake.close();
        rmSync(rawDir, { recursive: true, force: true });
    });
    const logged = [];
    for (const method of ['log', 'error', 'warn', 'info']) {
        t.mock.method(console, method, (...args) => logged.push(args.join(' ')));
    }
    return { fake, rawDir, logged };
}

function capture(fake, rawDir, overrides = {}) {
    return runCapture({
        env: buildEnv(fake, overrides.env),
        round: overrides.round ?? 'A',
        endpoints: { authorityBase: fake.authorityBase, graphBase: fake.graphBase },
        openUrl: overrides.openUrl ?? followRedirects,
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });
}

const calendarViewRequests = (fake) =>
    fake.requests.filter((request) => request.path.endsWith('/me/calendarView'));

test('happy path writes the raw files and walks every page with the headers re-sent', async (t) => {
    const { fake, rawDir } = await setup(t);

    const meta = await capture(fake, rawDir);

    const roundDir = path.join(rawDir, 'roundA');
    for (const name of ['me.json', 'token-shape.json', 'prod-select.json', 'meta.json']) {
        assert.ok(existsSync(path.join(roundDir, name)), `${name} was not written`);
    }
    // prod-select is the first pass: its three pages are the first three calendarView requests.
    const prodSelect = calendarViewRequests(fake).slice(0, 3);
    assert.equal(prodSelect.length, 3);
    for (const request of prodSelect) {
        const prefer = headerValues(request.rawHeaders, 'prefer');
        assert.equal(prefer.length, 1);
        assert.ok(prefer[0].includes('outlook.timezone="UTC"'));
        assert.ok(prefer[0].includes('IdType="ImmutableId"'));
        assert.equal(headerValues(request.rawHeaders, 'authorization').length, 1);
    }
    assert.equal(meta.passes['prod-select'].pages, 3);
    assert.equal(meta.passes['prod-select'].events, 7);
    const shape = JSON.parse(readFileSync(path.join(roundDir, 'token-shape.json'), 'utf8'));
    assert.equal(shape.refreshTokenIssued, true);
    assert.equal(shape.idTokenIssued, true);
    assert.deepEqual(
        fake.authorizeRequests.map((entry) => entry.problems),
        [[]]
    );
});

test('no token or secret reaches a raw file or the console', async (t) => {
    const { fake, rawDir, logged } = await setup(t);

    await capture(fake, rawDir);

    const secrets = [
        fake.credentials.clientSecret,
        ...fake.issued.accessTokens,
        ...fake.issued.refreshTokens,
    ];
    assert.ok(secrets.length >= 3);
    const surfaces = [...readAllFiles(rawDir), logged.join('\n')];
    for (const surface of surfaces) {
        for (const secret of secrets) {
            assert.equal(surface.includes(secret), false);
        }
    }
});

test('a tampered state is rejected before any token request', async (t) => {
    const { fake, rawDir } = await setup(t);
    const tamper = async (url) => {
        const changed = new URL(url);
        changed.searchParams.set('state', 'not-the-state-that-was-issued');
        await followRedirects(changed.toString());
    };

    await assert.rejects(capture(fake, rawDir, { openUrl: tamper }), /state/);

    assert.equal(fake.tokenRequests, 0);
    assert.equal(existsSync(path.join(rawDir, 'roundA')), false);
});

test('an identity that differs from the login hint aborts before any calendar request', async (t) => {
    const { fake, rawDir } = await setup(t, {
        user: {
            id: 'ignored',
            displayName: 'Test Person 9',
            mail: 'person-9@example.test',
            userPrincipalName: 'person-9@example.test',
            userType: 'Member',
        },
    });

    await assert.rejects(capture(fake, rawDir), /Identity check failed/);

    assert.equal(calendarViewRequests(fake).length, 0);
    assert.equal(existsSync(path.join(rawDir, 'roundA')), false);
});

test('a Guest account and a foreign tenant abort before any calendar request', async (t) => {
    const guest = await setup(t, {
        user: {
            id: 'ignored',
            mail: 'person-1@example.test',
            userPrincipalName: 'person-1@example.test',
            userType: 'Guest',
        },
    });
    await assert.rejects(capture(guest.fake, guest.rawDir), /not a Member/);
    assert.equal(calendarViewRequests(guest.fake).length, 0);

    const foreignTid = ['99999999', '9999', '4999', '8999', '999999999999'].join('-');
    const foreign = await setup(t, { idTokenTid: foreignTid });
    await assert.rejects(capture(foreign.fake, foreign.rawDir), /tenant/);
    assert.equal(calendarViewRequests(foreign.fake).length, 0);
});

test('a wrong client secret fails with the status and AADSTS code, never the secret', async (t) => {
    const { fake, rawDir, logged } = await setup(t);
    const wrong = 'wrong-secret-value-for-the-test';

    await assert.rejects(
        capture(fake, rawDir, { env: { M365_CLIENT_SECRET: wrong } }),
        (error) => {
            assert.match(error.message, /HTTP 401/);
            assert.match(error.message, /AADSTS7000215/);
            assert.equal(error.message.includes(wrong), false);
            return true;
        }
    );
    assert.equal(logged.join('\n').includes(wrong), false);
});

test('only Microsoft endpoints and a tenant GUID are accepted', () => {
    assert.throws(() => assertTenantId('common'), /common/);
    assert.throws(() => assertTenantId('organizations'), /organizations/);
    assert.throws(() => assertTenantId('contoso.onmicrosoft.com'), /GUID/);
    assert.throws(
        () =>
            assertEndpoints({
                authorityBase: 'https://login.example.test',
                graphBase: 'https://graph.microsoft.com/v1.0',
            }),
        /authorityBase/
    );
    assert.throws(
        () =>
            assertEndpoints({
                authorityBase: 'http://login.microsoftonline.com',
                graphBase: 'https://graph.microsoft.com/v1.0',
            }),
        /authorityBase/
    );
    assert.doesNotThrow(() =>
        assertEndpoints({
            authorityBase: 'https://login.microsoftonline.com',
            graphBase: 'https://graph.microsoft.com/v1.0',
        })
    );
    assert.doesNotThrow(() =>
        assertEndpoints({
            authorityBase: 'http://127.0.0.1:1234',
            graphBase: 'http://127.0.0.1:1234/graph/v1.0',
        })
    );
});

// ---- full capture protocol --------------------------------------------------------------

const MASTER_1 = 'AAMk/master+1=';
const MASTER_2 = 'AAMk/master+2=';
const MASTERS = {
    [MASTER_1]: makeEvent(20, { id: MASTER_1, type: 'seriesMaster', recurrence: { pattern: {} } }),
    [MASTER_2]: makeEvent(21, { id: MASTER_2, type: 'seriesMaster', recurrence: { pattern: {} } }),
};
const occurrence = (n, seriesMasterId) => makeEvent(n, { type: 'occurrence', seriesMasterId });
const SERIES_PAGES = [
    [makeEvent(1), occurrence(2, MASTER_1), occurrence(3, MASTER_1)],
    [occurrence(4, MASTER_1), occurrence(5, MASTER_2), makeEvent(6)],
];
const PASS_NAMES = [
    'prod-select',
    'prefer-separate',
    'page2-no-prefer',
    'no-immutableid',
    'experiment-select',
    'full-shape',
    'series',
];
const readRaw = (rawDir, round, name) =>
    JSON.parse(readFileSync(path.join(rawDir, `round${round}`, `${name}.json`), 'utf8'));
const graphPath = (fake) => new URL(fake.graphBase).pathname;
const eventPath = (fake, id) => `${graphPath(fake)}/me/events/${encodeURIComponent(id)}`;

test('Round A writes the seven pass files and a meta entry per pass', async (t) => {
    const { fake, rawDir } = await setup(t, {
        pagesByRound: { A: SERIES_PAGES },
        masters: MASTERS,
    });

    const meta = await capture(fake, rawDir);

    for (const name of [...PASS_NAMES, 'meta', 'me', 'token-shape']) {
        assert.ok(existsSync(path.join(rawDir, 'roundA', `${name}.json`)), `${name}.json`);
    }
    assert.deepEqual(Object.keys(meta.passes), PASS_NAMES);
    assert.deepEqual(meta.passes['prod-select'], { status: 200, pages: 2, events: 6 });
    assert.equal(meta.passes.series.pages, 3);
    assert.equal(meta.passes.series.events, 4);
    assert.equal(existsSync(path.join(rawDir, 'roundA', 'lookups.json')), false);
    // The experiment $select adds lastModifiedDateTime and attendees; the production one does not.
    const production = readRaw(rawDir, 'A', 'prod-select').pages[0].body.value[0];
    const experiment = readRaw(rawDir, 'A', 'experiment-select').pages[0].body.value[0];
    assert.equal('attendees' in production, false);
    assert.ok('attendees' in experiment && 'lastModifiedDateTime' in experiment);
    // full-shape sends no $select at all and so returns fields outside the allow-list.
    const full = readRaw(rawDir, 'A', 'full-shape');
    assert.equal(new URL(full.pages[0].request.url).searchParams.has('$select'), false);
    assert.ok('attendees' in full.pages[0].body.value[0]);
});

test('prefer-separate sends two distinct Prefer lines on every page', async (t) => {
    const { fake, rawDir } = await setup(t);

    await capture(fake, rawDir);

    const twoLines = calendarViewRequests(fake).filter(
        (request) => headerValues(request.rawHeaders, 'prefer').length === 2
    );
    assert.equal(twoLines.length, 3);
    for (const request of twoLines) {
        assert.deepEqual(headerValues(request.rawHeaders, 'prefer'), [
            'outlook.timezone="UTC"',
            'IdType="ImmutableId"',
        ]);
    }
    const doc = readRaw(rawDir, 'A', 'prefer-separate');
    assert.equal(doc.pages.length, 3);
    for (const page of doc.pages) {
        assert.equal(page.request.headerNames.filter((name) => name === 'Prefer').length, 2);
    }
});

test('page 2 of page2-no-prefer carries Authorization but no Prefer', async (t) => {
    const { fake, rawDir } = await setup(t);

    await capture(fake, rawDir);

    const without = calendarViewRequests(fake).filter(
        (request) => headerValues(request.rawHeaders, 'prefer').length === 0
    );
    assert.equal(without.length, 1);
    assert.ok('$skiptoken' in without[0].query);
    assert.equal(headerValues(without[0].rawHeaders, 'authorization').length, 1);
    const doc = readRaw(rawDir, 'A', 'page2-no-prefer');
    assert.equal(doc.pages.length, 2);
    assert.equal(doc.pages[0].request.preferMode, 'combined');
    assert.equal(doc.pages[1].request.preferMode, 'none');
    assert.equal(doc.pages[1].request.headerNames.includes('Prefer'), false);
    // Recorded exactly as returned: the fake answers in the mailbox time zone without Prefer.
    assert.equal(doc.pages[1].body.value[0].start.timeZone, 'Romance Standard Time');
});

test('no-immutableid asks for UTC only and gets mutable ids back', async (t) => {
    const { fake, rawDir } = await setup(t);

    await capture(fake, rawDir);

    const doc = readRaw(rawDir, 'A', 'no-immutableid');
    assert.equal(doc.pages[0].request.preferMode, 'tz-only');
    assert.ok(doc.pages[0].body.value[0].id.startsWith('mutable-'));
    assert.equal(readRaw(rawDir, 'A', 'prod-select').pages[0].body.value[0].id, makeEvent(1).id);
});

test('a 400 for the experimental $select is recorded as the result and the run succeeds', async (t) => {
    const { fake, rawDir } = await setup(t, { rejectExperimentSelect: true });

    const meta = await capture(fake, rawDir);

    assert.equal(meta.passes['experiment-select'].status, 400);
    const doc = readRaw(rawDir, 'A', 'experiment-select');
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].request.status, 400);
    assert.equal(doc.pages[0].errorCode, 'ErrorInvalidProperty');
    assert.equal(doc.pages[0].body, null);
    assert.equal(meta.passes['full-shape'].status, 200);
});

test('the series master and its instances are requested once per master, ids encoded', async (t) => {
    const { fake, rawDir } = await setup(t, {
        pagesByRound: { A: SERIES_PAGES },
        masters: MASTERS,
    });

    await capture(fake, rawDir);

    for (const masterId of [MASTER_1, MASTER_2]) {
        const masterRequests = fake.requests.filter(
            (request) => request.rawPath === eventPath(fake, masterId)
        );
        assert.equal(masterRequests.length, 1);
        assert.ok(masterRequests[0].query.$select.includes('recurrence'));
        const firstInstancePages = fake.requests.filter(
            (request) =>
                request.rawPath === `${eventPath(fake, masterId)}/instances` &&
                !('$skiptoken' in request.query)
        );
        assert.equal(firstInstancePages.length, 1);
    }
    const series = readRaw(rawDir, 'A', 'series');
    assert.deepEqual(
        series.masters.map((master) => master.request.status),
        [200, 200]
    );
    assert.deepEqual(
        series.instances.map((entry) => entry.pages.length),
        [2, 1]
    );
});

test('Round B looks up every Round A id with the encoded form and records a 404 as data', async (t) => {
    const removedId = makeEvent(7).id;
    const roundB = threePages().map((page) => page.filter((event) => event.id !== removedId));
    const { fake, rawDir } = await setup(t, { pagesByRound: { A: threePages(), B: roundB } });
    await capture(fake, rawDir);
    fake.round = 'B';

    const meta = await capture(fake, rawDir, { round: 'B' });

    const lookups = readRaw(rawDir, 'B', 'lookups').lookups;
    assert.equal(lookups.length, 7);
    for (const lookup of lookups) {
        const expected = lookup.id === removedId ? 404 : 200;
        assert.equal(lookup.request.status, expected);
        const hits = fake.requests.filter(
            (request) =>
                request.rawPath === eventPath(fake, lookup.id) &&
                request.query.$select?.startsWith('id,isCancelled')
        );
        assert.equal(hits.length, 1);
    }
    const missing = lookups.find((lookup) => lookup.id === removedId);
    assert.equal(missing.errorCode, 'ErrorItemNotFound');
    assert.equal(missing.body, null);
    assert.equal(Object.keys(meta.passes).length, 8);
    assert.deepEqual(meta.passes.lookups, { status: 200, pages: 0, events: 7 });
});

test('Round B without Round A raw stops before any authorize request', async (t) => {
    const { fake, rawDir } = await setup(t);

    await assert.rejects(capture(fake, rawDir, { round: 'B' }), /Round A/);

    assert.equal(fake.requests.length, 0);
    assert.equal(fake.authorizeRequests.length, 0);
});

test('the capture window is validated before any sign-in', async (t) => {
    const { fake, rawDir } = await setup(t);
    const attempt = (env) => capture(fake, rawDir, { env });

    await assert.rejects(
        attempt({ M365_SPIKE_WINDOW_START: '2026-10-19T00:00:00' }),
        /WINDOW_START/
    );
    await assert.rejects(
        attempt({ M365_SPIKE_WINDOW_END: '2026-11-16T00:00:00+01:00' }),
        /WINDOW_END/
    );
    await assert.rejects(attempt({ M365_SPIKE_WINDOW_END: '2026-10-19T00:00:00Z' }), /before/);
    await assert.rejects(attempt({ M365_SPIKE_WINDOW_END: '2026-12-21T00:00:00Z' }), /62 days/);
    assert.equal(fake.authorizeRequests.length, 0);
    assert.deepEqual(
        parseWindow({
            M365_SPIKE_WINDOW_START: '2026-10-19T00:00:00Z',
            M365_SPIKE_WINDOW_END: '2026-12-20T00:00:00Z',
        }),
        { start: '2026-10-19T00:00:00Z', end: '2026-12-20T00:00:00Z' }
    );
});

test('a nextLink to another host is never followed with the bearer token', async (t) => {
    const seen = [];
    const other = http.createServer((req, res) => {
        seen.push(req.url);
        res.end('{}');
    });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    const first = http.createServer((req, res) => {
        const link = `http://127.0.0.1:${other.address().port}/stolen`;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ value: [], '@odata.nextLink': link }));
    });
    await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve));
    t.after(() => {
        first.closeAllConnections();
        other.closeAllConnections();
        first.close();
        other.close();
    });

    const pages = await fetchAllPages(`http://127.0.0.1:${first.address().port}/me/calendarView`, {
        accessToken: 'unused-token',
        preferMode: 'combined',
    });

    assert.deepEqual(seen, []);
    assert.equal(pages.length, 2);
    assert.equal(pages[1].errorCode, 'next_link_origin_mismatch');
});

test('.env.local.example lists exactly the harness variables and no value', () => {
    const template = readFileSync(path.join(SPIKE_DIR, '.env.local.example'), 'utf8');

    const assignments = template
        .split('\n')
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => line.split('=', 2));

    assert.deepEqual(
        assignments.map(([name]) => name),
        ENV_NAMES
    );
    for (const [, value] of assignments) {
        assert.equal(value, '');
    }
});
