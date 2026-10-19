import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runCapture } from '../capture.mjs';
import { assertEndpoints, assertTenantId } from '../lib/oauth.mjs';
import {
    buildEnv,
    followRedirects,
    headerValues,
    readAllFiles,
    startFakeMicrosoft,
    threePages,
} from './fake-microsoft.mjs';

const TIMEOUT_MS = 10_000;

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
        round: 'A',
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
    const requests = calendarViewRequests(fake);
    assert.equal(requests.length, 3);
    for (const request of requests) {
        const prefer = headerValues(request.rawHeaders, 'prefer').join(', ');
        assert.ok(prefer.includes('outlook.timezone="UTC"'));
        assert.ok(prefer.includes('IdType="ImmutableId"'));
        assert.equal(headerValues(request.rawHeaders, 'authorization').length, 1);
    }
    assert.equal(meta.passes['prod-select'].pages, 3);
    assert.equal(meta.passes['prod-select'].events, 7);
    const shape = JSON.parse(readFileSync(path.join(roundDir, 'token-shape.json'), 'utf8'));
    assert.equal(shape.refreshTokenIssued, true);
    assert.equal(shape.idTokenIssued, true);
    assert.deepEqual(fake.authorizeRequests.map((entry) => entry.problems), [[]]);
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
