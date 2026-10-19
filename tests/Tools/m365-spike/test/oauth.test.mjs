import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, runAuth, runCapture, runStatus } from '../capture.mjs';
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
const B_HINT = 'person-2@example.test';

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
    buildEnv(fake, { M365_SPIKE_B_LOGIN_HINT: B_HINT, ...extra });

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
    const summary = summarizeTokenResponse({
        scope: 'openid profile email User.Read Calendars.Read',
    });

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
            loginHint: B_HINT,
        })
    );

    assert.equal(url.pathname, `/${tenantGuid}/oauth2/v2.0/authorize`);
    assert.equal(url.searchParams.get('scope'), SCOPES);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('prompt'), 'select_account');
    assert.equal(url.searchParams.get('response_mode'), 'query');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('login_hint'), B_HINT);
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

// ---- auth --as B ------------------------------------------------------------------------

const userB = {
    id: 'ignored',
    displayName: 'Test Person 2',
    mail: B_HINT,
    userPrincipalName: B_HINT,
    userType: 'Member',
};

function authAsB(fake, rawDir, overrides = {}) {
    return runAuth({
        env: env(fake),
        as: 'B',
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 'n',
        rawDir,
        timeoutMs: TIMEOUT_MS,
        ...overrides,
    });
}

test('runAuth --as B: a non-assigned non-admin Member gets the six scopes, no consent prompt: exit 0', async (t) => {
    const { fake, rawDir } = await setup(t, { user: userB });

    const result = await authAsB(fake, rawDir);

    assert.equal(result.exitCode, 0);
    assert.equal(fake.authorizeRequests[0].loginHint, B_HINT);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-check-b.json'), 'utf8'));
    assert.equal(file.scopeMatches, true);
    assert.equal(file.refreshTokenIssued, true);
    assert.equal(file.tidMatches, true);
    assert.equal(file.userType, 'Member');
    assert.equal(file.signedInMatchesLoginHint, true);
    assert.equal(file.consentPromptShown, false);
    // B never overwrites what A's run recorded.
    assert.equal(existsSync(path.join(rawDir, 'auth-check.json')), false);
    assert.equal(existsSync(path.join(rawDir, 'me.json')), false);
    const text = readFileSync(path.join(rawDir, 'auth-check-b.json'), 'utf8');
    assert.equal(text.includes('example.test'), false);
});

test('runAuth --as B: without the B hint nothing is contacted and the variable is named', async (t) => {
    const { fake, rawDir } = await setup(t, { user: userB });

    await assert.rejects(
        authAsB(fake, rawDir, { env: buildEnv(fake) }),
        /M365_SPIKE_B_LOGIN_HINT/
    );

    assert.equal(fake.authorizeRequests.length, 0);
});

test('runAuth --as B: the account that signs in must be the B hint, not A', async (t) => {
    const { fake, rawDir } = await setup(t);

    const result = await authAsB(fake, rawDir);

    assert.equal(result.exitCode, 1);
    assert.equal(result.signedInMatchesLoginHint, false);
    assert.ok(result.failures.some((failure) => failure.includes('M365_SPIKE_B_LOGIN_HINT')));
});

test('runAuth --as B: a consent prompt, extra scopes and no refresh token fail and are named', async (t) => {
    const { fake, rawDir } = await setup(t, {
        user: userB,
        grantedScope: 'openid profile email User.Read Calendars.ReadWrite',
        issueRefreshToken: false,
    });

    const result = await authAsB(fake, rawDir, { ask: async () => 's' });

    assert.equal(result.exitCode, 1);
    const file = JSON.parse(readFileSync(path.join(rawDir, 'auth-check-b.json'), 'utf8'));
    assert.equal(file.consentPromptShown, true);
    assert.ok(result.failures.some((failure) => failure.includes('scopes')));
    assert.ok(result.failures.some((failure) => failure.includes('consent')));
});

test('runAuth --as B: a Guest fails even when the address matches the hint', async (t) => {
    const { fake, rawDir } = await setup(t, { user: { ...userB, userType: 'Guest' } });

    const result = await authAsB(fake, rawDir);

    assert.equal(result.exitCode, 1);
    assert.ok(result.failures.some((failure) => failure.includes('Member')));
});

test('runAuth --as B: a Microsoft refusal (assignment turned on by mistake) is named, nothing redeemed', async (t) => {
    const { fake, rawDir } = await setup(t, { user: userB, mode: 'blocked' });

    await assert.rejects(authAsB(fake, rawDir), /AADSTS50105/);

    assert.equal(fake.tokenRequests, 0);
    assert.equal(existsSync(path.join(rawDir, 'auth-check-b.json')), false);
});

test('runAuth --as B: SOLIDTIME_M365_SPIKE_B_LOGIN_HINT and the deprecated alias supply the hint', async (t) => {
    const { fake, rawDir } = await setup(t, { user: userB });
    const base = buildEnv(fake);

    const doppler = await authAsB(fake, rawDir, {
        env: { ...base, SOLIDTIME_M365_SPIKE_B_LOGIN_HINT: B_HINT },
    });
    assert.equal(doppler.exitCode, 0);

    const alias = await authAsB(fake, rawDir, {
        env: { ...base, M365_SPIKE_BLOCKED_LOGIN_HINT: B_HINT },
    });
    assert.equal(alias.exitCode, 0);
    assert.deepEqual(
        fake.authorizeRequests.map((entry) => entry.loginHint),
        [B_HINT, B_HINT]
    );
});

// ---- Doppler names and the production secret --------------------------------------------

const PROD_SECRET_NAME = 'SOLIDTIME_MICROSOFT_CLIENT_SECRET';
const PROD_CANARY = ['prod', 'canary', 'value', 'must', 'never', 'show'].join('-');

function dopplerEnv(fake, extra = {}) {
    return {
        SOLIDTIME_MICROSOFT_TENANT_ID: fake.credentials.tenantId,
        SOLIDTIME_MICROSOFT_CLIENT_ID: fake.credentials.clientId,
        SOLIDTIME_M365_SPIKE_CLIENT_SECRET: fake.credentials.clientSecret,
        SOLIDTIME_M365_SPIKE_LOGIN_HINT: 'person-1@example.test',
        SOLIDTIME_M365_SPIKE_PORT: '0',
        ...extra,
    };
}

test('runAuth: the Doppler names supply the configuration when no M365_* name is set', async (t) => {
    const { fake, rawDir } = await setup(t);

    const result = await runAuth({
        env: dopplerEnv(fake),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 'n',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.exitCode, 0);
});

test('runAuth: an M365_* name wins over its Doppler name', async (t) => {
    const { fake, rawDir } = await setup(t);

    const result = await runAuth({
        env: dopplerEnv(fake, {
            M365_CLIENT_SECRET: fake.credentials.clientSecret,
            SOLIDTIME_M365_SPIKE_CLIENT_SECRET: 'a-different-and-wrong-secret',
        }),
        endpoints: endpointsOf(fake),
        openUrl: followRedirects,
        ask: async () => 'n',
        rawDir,
        timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.exitCode, 0);
});

test('the production secret is never used as the client secret and its presence stops auth and capture', async (t) => {
    const { fake, rawDir } = await setup(t);
    const present = { ...buildEnv(fake), [PROD_SECRET_NAME]: PROD_CANARY };
    const common = { endpoints: endpointsOf(fake), openUrl: followRedirects, rawDir };

    for (const attempt of [
        () => runAuth({ ...common, env: present, ask: async () => 'n', timeoutMs: TIMEOUT_MS }),
        () => runAuth({ ...common, env: present, as: 'B', ask: async () => 'n' }),
        () => runCapture({ ...common, env: present, round: 'A', timeoutMs: TIMEOUT_MS }),
    ]) {
        await assert.rejects(attempt(), (error) => {
            assert.equal(error.exitCode, 2);
            assert.ok(error.message.includes(PROD_SECRET_NAME));
            assert.match(error.message, /producción/);
            assert.match(error.message, /production/);
            assert.equal(error.message.includes(PROD_CANARY), false);
            return true;
        });
    }
    assert.equal(fake.authorizeRequests.length, 0);
    assert.equal(fake.tokenRequests, 0);
});

test('main: auth and capture exit 2 when the production secret is in the environment', async (t) => {
    const { fake } = await setup(t);
    const logged = [];
    t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
    const present = { ...buildEnv(fake), [PROD_SECRET_NAME]: PROD_CANARY };

    for (const argv of [['auth'], ['auth', '--as', 'B'], ['capture', '--round', 'A']]) {
        assert.equal(await main(argv, { env: present, repoRoot: REPO_ROOT }), 2);
    }

    assert.ok(logged.join('\n').includes(PROD_SECRET_NAME));
    assert.equal(logged.join('\n').includes(PROD_CANARY), false);
    assert.equal(fake.authorizeRequests.length, 0);
});

// ---- status -----------------------------------------------------------------------------

function writeAuthCheck(rawDir, name, extra = {}) {
    writeFileSync(
        path.join(rawDir, name),
        JSON.stringify({
            scopeMatches: true,
            refreshTokenIssued: true,
            tidMatches: true,
            userType: 'Member',
            signedInMatchesLoginHint: true,
            consentPromptShown: false,
            ...extra,
        })
    );
}

test('runStatus prints SET/MISSING with the source name and booleans but never a value', () => {
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-spike-'));
    try {
        const canary = ['canary', 'value', 'that', 'must', 'not', 'print'].join('-');
        writeAuthCheck(rawDir, 'auth-check.json', { canary });
        writeAuthCheck(rawDir, 'auth-check-b.json', { consentPromptShown: true, canary });
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
                SOLIDTIME_M365_SPIKE_CLIENT_SECRET: secret,
                M365_TENANT_ID: tenant,
                M365_SPIKE_LOGIN_HINT: hint,
            },
            rawDir,
            repoRoot: REPO_ROOT,
        });

        assert.match(report, /M365_CLIENT_SECRET: SET \(from SOLIDTIME_M365_SPIKE_CLIENT_SECRET\)/);
        assert.match(report, /M365_TENANT_ID: SET \(from M365_TENANT_ID\)/);
        assert.match(report, /M365_SPIKE_LOGIN_HINT: SET \(from M365_SPIKE_LOGIN_HINT\)/);
        assert.match(report, /M365_CLIENT_ID: MISSING/);
        assert.match(report, /M365_SPIKE_B_LOGIN_HINT: MISSING/);
        assert.doesNotMatch(report, /M365_SPIKE_BLOCKED_LOGIN_HINT/);
        assert.match(report, /\.env\.local is git-ignored: yes/);
        assert.match(report, /raw\/ is git-ignored: yes/);
        assert.match(report, /auth \(A\): scopeMatches=true/);
        assert.match(report, /auth --as B: scopeMatches=true .*consentPromptShown=true/);
        assert.doesNotMatch(report, /expect-blocked|AADSTS50105/);
        assert.match(report, /prod-select/);
        assert.doesNotMatch(report, /WARNING/);
        for (const value of [secret, tenant, hint, canary]) {
            assert.equal(report.includes(value), false);
        }
    } finally {
        rmSync(rawDir, { recursive: true, force: true });
    }
});

test('runStatus says when auth has not run for A or B yet', () => {
    const rawDir = mkdtempSync(path.join(os.tmpdir(), 'm365-spike-'));
    try {
        const report = runStatus({ env: {}, rawDir, repoRoot: REPO_ROOT });

        assert.match(report, /auth \(A\): not run yet/);
        assert.match(report, /auth --as B: not run yet/);
    } finally {
        rmSync(rawDir, { recursive: true, force: true });
    }
});

test('runStatus names the deprecated B alias as such', () => {
    const report = runStatus({
        env: { M365_SPIKE_BLOCKED_LOGIN_HINT: B_HINT },
        rawDir: path.join(os.tmpdir(), 'm365-spike-does-not-exist'),
        repoRoot: REPO_ROOT,
    });

    assert.match(
        report,
        /M365_SPIKE_B_LOGIN_HINT: SET \(from M365_SPIKE_BLOCKED_LOGIN_HINT, deprecated alias\)/
    );
    assert.equal(report.includes(B_HINT), false);
});

test('runStatus warns, by name only, when the production secret is in the environment', () => {
    const report = runStatus({
        env: { [PROD_SECRET_NAME]: PROD_CANARY },
        rawDir: path.join(os.tmpdir(), 'm365-spike-does-not-exist'),
        repoRoot: REPO_ROOT,
    });

    assert.match(report, new RegExp(`WARNING.*${PROD_SECRET_NAME}`));
    assert.equal(report.includes(PROD_CANARY), false);
    // It is reported as a warning, never as a source for the client secret.
    assert.match(report, /M365_CLIENT_SECRET: MISSING/);
});

test('parseArgs: auth defaults to A, --as A|B selects the user, anything else is a bad position', () => {
    assert.deepEqual(parseArgs(['auth']), { command: 'auth', as: 'A' });
    assert.deepEqual(parseArgs(['auth', '--as', 'B']), { command: 'auth', as: 'B' });
    assert.deepEqual(parseArgs(['auth', '--as', 'A']), { command: 'auth', as: 'A' });
    assert.deepEqual(parseArgs(['auth', '--expect-blocked']), { badPosition: 2 });
    assert.deepEqual(parseArgs(['auth', '--as', 'C']), { badPosition: 3 });
    assert.deepEqual(parseArgs(['auth', '--as', 'B', 'x']), { badPosition: 4 });
    assert.deepEqual(parseArgs(['status']), { command: 'status' });
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

test('CLI: the removed --expect-blocked flag and a bad --as are refused', () => {
    for (const args of [
        ['auth', '--expect-blocked'],
        ['auth', '--as'],
        ['auth', '--as', 'C'],
        ['auth', '--as', 'B', 'extra'],
    ]) {
        const result = cli(args);
        assert.equal(result.status, 2, args.join(' '));
        assert.match(result.stderr, /unknown argument/i);
    }
});

test('CLI: the production secret in the environment makes auth exit 2 and status warn', () => {
    const withProd = (args) =>
        spawnSync(process.execPath, [CAPTURE, ...args], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                [PROD_SECRET_NAME]: PROD_CANARY,
            },
        });

    const auth = withProd(['auth', '--as', 'B']);
    assert.equal(auth.status, 2);
    assert.ok(auth.stderr.includes(PROD_SECRET_NAME));
    assert.equal((auth.stdout + auth.stderr).includes(PROD_CANARY), false);

    const status = withProd(['status']);
    assert.equal(status.status, 0);
    assert.match(status.stdout, new RegExp(`WARNING.*${PROD_SECRET_NAME}`));
    assert.equal(status.stdout.includes(PROD_CANARY), false);
});

test('CLI: unknown commands and a missing round are refused', () => {
    assert.notEqual(cli(['sign-in']).status, 0);
    assert.notEqual(cli(['capture']).status, 0);
    assert.notEqual(cli(['capture', '--round', 'C']).status, 0);
});
