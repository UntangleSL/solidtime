import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAuth, runExpectBlocked, runStatus } from '../capture.mjs';
import {
    SCOPES,
    buildAuthorizeUrl,
    createPkcePair,
    createState,
    summarizeTokenResponse,
} from '../lib/oauth.mjs';
import { buildEnv, followRedirects, startFakeMicrosoft, threePages } from './fake-microsoft.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const CAPTURE = path.join(HERE, '..', 'capture.mjs');
const TIMEOUT_MS = 10_000;
const BLOCKED_HINT = 'person-2@example.test';
const NEVER = () => new Promise(() => {});

const tenantGuid = ['aaaaaaaa', 'bbbb', '4ccc', '8ddd', 'eeeeeeeeeeee'].join('-');

async function setup(t, options = {}) {
    const fake = await startFakeMicrosoft({ pagesByRound: { A: threePages() }, ...options });
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-spike-'));
    t.after(async () => {
        await fake.close();
        rmSync(rawDir, { recursive: true, force: true });
    });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    return { fake, rawDir };
}

const endpointsOf = (fake) => ({ authorityBase: fake.authorityBase, graphBase: fake.graphBase });
const env = (fake, extra = {}) =>
    buildEnv(fake, { M365_SPIKE_BLOCKED_LOGIN_HINT: BLOCKED_HINT, ...extra });

// ---- pure helpers -----------------------------------------------------------------------

test('summarizeTokenResponse: scope without offline_access plus a refresh token matches', () => {
    const summary = summarizeTokenResponse({
        scope: 'openid profile email User.Read Calendars.Read',
        refresh_token: 'present',
        id_token: 'present',
        token_type: 'Bearer',
        expires_in: 3599,
    });

    assert.equal(summary.scopeMatches, true);
    assert.equal(summary.refreshTokenIssued, true);
    assert.deepEqual(summary.missingScopes, []);
    assert.deepEqual(summary.extraScopes, []);
    assert.equal(summary.tokenType, 'Bearer');
});

test('summarizeTokenResponse: an extra Calendars.ReadWrite scope does not match', () => {
    const summary = summarizeTokenResponse({
        scope: 'openid profile email User.Read Calendars.Read Calendars.ReadWrite',
        refresh_token: 'present',
    });

    assert.equal(summary.scopeMatches, false);
    assert.deepEqual(summary.extraScopes, ['Calendars.ReadWrite']);
});

test('summarizeTokenResponse: without a refresh token offline_access is not proven', () => {
    const summary = summarizeTokenResponse({ scope: 'openid profile email User.Read Calendars.Read' });

    assert.equal(summary.scopeMatches, false);
    assert.equal(summary.refreshTokenIssued, false);
});

test('summarizeTokenResponse: a missing scope is listed and the key names carry no values', () => {
    const summary = summarizeTokenResponse({
        scope: 'openid profile email User.Read',
        refresh_token: 'present',
    });

    assert.equal(summary.scopeMatches, false);
    assert.deepEqual(summary.missingScopes, ['Calendars.Read']);
    assert.deepEqual(summary.keys, ['scope', 'refresh_token']);
});

test('createPkcePair: a 43-128 char verifier and its S256 challenge', () => {
    const { verifier, challenge } = createPkcePair();

    assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
    assert.notEqual(createPkcePair().verifier, verifier);
});

test('createState: 32 base64url characters and never repeated', () => {
    const first = createState();

    assert.match(first, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(createState(), first);
});

test('buildAuthorizeUrl: tenant-specific endpoint, exact scopes, S256, select_account', () => {
    const url = new URL(
        buildAuthorizeUrl({
            authorityBase: 'https://login.microsoftonline.com',
            tenantId: tenantGuid,
            clientId: 'client',
            redirectUri: 'http://localhost:8765/m365-spike/callback',
            state: 'state',
            challenge: 'challenge',
            loginHint: BLOCKED_HINT,
        })
    );

    assert.equal(url.pathname, `/${tenantGuid}/oauth2/v2.0/authorize`);
    assert.equal(url.searchParams.get('scope'), SCOPES);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('prompt'), 'select_account');
    assert.equal(url.searchParams.get('response_mode'), 'query');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('login_hint'), BLOCKED_HINT);
});

// ---- auth -------------------------------------------------------------------------------

test('runAuth: an assigned Member gets exactly the scopes, no consent prompt: exit 0', async (t) => {
    const { fake, rawDir } = await setup(t);

    const result = await runAuth({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 'n',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.exitCode, 0);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-check.json'), 'utf8'));
    assert.equal(file.scopeMatches, true);
    assert.equal(file.refreshTokenIssued, true);
    assert.equal(file.tidMatches, true);
    assert.equal(file.userType, 'Member');
    assert.equal(file.signedInMatchesLoginHint, true);
    assert.equal(file.consentPromptShown, false);
    assert.equal(JSON.parse(readFileSync(path.join(rawDir, 'me.json'), 'utf8')).userType, 'Member');
});

test('runAuth: a consent prompt, extra scopes and no refresh token fail and are named', async (t) => {
    const { fake, rawDir } = await setup(t, {
        grantedScope: 'openid profile email User.Read Calendars.ReadWrite',
        issueRefreshToken: false,
    });

    const result = await runAuth({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 's',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.exitCode, 1);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-check.json'), 'utf8'));
    assert.equal(file.scopeMatches, false);
    assert.equal(file.refreshTokenIssued, false);
    assert.equal(file.consentPromptShown, true);
    assert.ok(result.failures.some((failure) => failure.includes('scopes')));
    assert.ok(result.failures.some((failure) => failure.includes('consent')));
});

test('runAuth: a Guest signed in as another account fails without leaking either address', async (t) => {
    const { fake, rawDir } = await setup(t, {
        user: {
            id: 'ignored',
            mail: 'person-7@example.test',
            userPrincipalName: 'person-7@example.test',
            userType: 'Guest',
        },
    });

    const result = await runAuth({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 'n',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.exitCode, 1);
    const text = readFileSync(path.join(rawDir, 'auth-check.json'), 'utf8');
    const file = JSON.parse(text);
    assert.equal(file.signedInMatchesLoginHint, false);
    assert.equal(file.userType, 'Guest');
    assert.equal(text.includes('example.test'), false);
});

// ---- auth --expect-blocked --------------------------------------------------------------

test('runExpectBlocked: AADSTS50105 on the callback means blocked (source callback)', async (t) => {
    const { fake, rawDir } = await setup(t, { mode: 'blocked' });

    const result = await runExpectBlocked({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: NEVER,
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.blocked, true);
    assert.equal(result.errorCode, 'AADSTS50105');
    assert.equal(result.source, 'callback');
    assert.equal(result.exitCode, 0);
    assert.equal(fake.authorizeRequests[0].loginHint, BLOCKED_HINT);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-blocked.json'), 'utf8'));
    assert.equal(file.blocked, true);
    assert.equal(file.source, 'callback');
});

test('runExpectBlocked: the code typed by the operator also counts (source operator)', async (t) => {
    const { fake, rawDir } = await setup(t, { mode: 'blocked' });

    const result = await runExpectBlocked({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: () => {},
        ask: async () => 'AADSTS50105',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.blocked, true);
    assert.equal(result.errorCode, 'AADSTS50105');
    assert.equal(result.source, 'operator');
    assert.equal(result.exitCode, 0);
});

test('runExpectBlocked: another AADSTS code is not a block and Intro keeps waiting', async (t) => {
    const { fake, rawDir } = await setup(t);
    const answers = ['', 'AADSTS65001'];

    const result = await runExpectBlocked({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: () => {},
        ask: async () => answers.shift() ?? NEVER(),
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.errorCode, 'AADSTS65001');
    assert.equal(result.source, 'operator');
    assert.equal(result.exitCode, 1);
});

test('runExpectBlocked: a code that arrives is never redeemed and the run exits 1', async (t) => {
    const { fake, rawDir } = await setup(t, { mode: 'not-blocked' });

    const result = await runExpectBlocked({
        env: env(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: NEVER,
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.exitCode, 1);
    assert.equal(fake.tokenRequests, 0);
    assert.equal(fake.issued.accessTokens.length, 0);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-blocked.json'), 'utf8'));
    assert.equal(file.blocked, false);
});

// ---- status -----------------------------------------------------------------------------

test('runStatus prints SET/MISSING and booleans but never a value', () => {
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-spike-'));
    try {
        const canary = ['canary', 'value', 'that', 'must', 'not', 'print'].join('-');
        writeFileSync(
            path.join(rawDir, 'auth-check.json'),
            JSON.stringify({
                scopeMatches: true,
                refreshTokenIssued: true,
                tidMatches: true,
                userType: 'Member',
                signedInMatchesLoginHint: true,
                consentPromptShown: false,
                canary,
            })
        );
        writeFileSync(
            path.join(rawDir, 'auth-blocked.json'),
            JSON.stringify({ blocked: true, errorCode: 'AADSTS50105', source: 'callback', canary })
        );
        mkdirSync(path.join(rawDir, 'roundA'));
        writeFileSync(
            path.join(rawDir, 'roundA', 'meta.json'),
            JSON.stringify({
                round: 'A',
                capturedAt: '2026-10-20T08:00:00.000Z',
                window: { start: '2026-10-19T00:00:00Z', end: '2026-11-16T00:00:00Z' },
                passes: { 'prod-select': { status: 200, pages: 3, events: 7 } },
                canary,
            })
        );
        const secret = ['distinctive', 'secret', 'value', '123456'].join('-');
        const tenant = ['distinctive', 'tenant', 'value', '123456'].join('-');
        const hint = ['distinctive', 'person'].join('-') + '@example.test';

        const report = runStatus({
            env: {
                M365_CLIENT_SECRET: secret,
                M365_TENANT_ID: tenant,
                M365_SPIKE_LOGIN_HINT: hint,
            },
            rawDir,
            repoRoot: REPO_ROOT,
        });

        assert.match(report, /M365_CLIENT_SECRET\s*:?\s*SET/);
        assert.match(report, /M365_CLIENT_ID\s*:?\s*MISSING/);
        assert.match(report, /\.env\.local\b.*\bignored\b/i);
        assert.match(report, /raw\/.*\bignored\b/i);
        assert.match(report, /scopeMatches\W+true/);
        assert.match(report, /AADSTS50105/);
        assert.match(report, /prod-select/);
        for (const value of [secret, tenant, hint, canary]) {
            assert.equal(report.includes(value), false);
        }
    } finally {
        rmSync(rawDir, { recursive: true, force: true });
    }
});

// ---- CLI --------------------------------------------------------------------------------

function cli(args) {
    return spawnSync(process.execPath, [CAPTURE, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
}

test('CLI: status exits 0 and shows MISSING for the secret when no env file is loaded', () => {
    const result = cli(['status']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /M365_CLIENT_SECRET\s*:?\s*MISSING/);
    assert.match(result.stdout, /\.env\.local/);
});

test('CLI: a secret passed as an argument is refused and never echoed', () => {
    const planted = ['planted', 'secret', 'argument', 'value'].join('-');

    const result = cli(['auth', '--client-secret', planted]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown argument/i);
    assert.equal((result.stdout + result.stderr).includes(planted), false);
});

test('CLI: unknown commands and a missing round are refused', () => {
    assert.notEqual(cli(['sign-in']).status, 0);
    assert.notEqual(cli(['capture']).status, 0);
    assert.notEqual(cli(['capture', '--round', 'C']).status, 0);
});
