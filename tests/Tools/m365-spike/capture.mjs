// Capture harness for the Microsoft 365 spike (phase 01). Zero dependencies (node: built-ins).
//
//   node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs \
//        <auth [--expect-blocked] | capture --round A|B | status>
//
// Sign-in is authorization code + PKCE + client secret on a loopback redirect. Tokens stay in
// process memory; nothing printed or written by this file contains a token, the secret or an
// address. The CLI always talks to Microsoft: only tests can inject different `endpoints`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countEvents, graphGet, runCapturePasses } from './lib/graph.mjs';
import {
    MICROSOFT_ENDPOINTS,
    assertEndpoints,
    assertTenantId,
    buildAuthorizeUrl,
    createPkcePair,
    createState,
    redeemCode,
    startCallbackServer,
} from './lib/oauth.mjs';

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..', '..');
const DEFAULT_RAW_DIR = path.join(SPIKE_DIR, 'raw');
const RAW_PROBE = 'tests/Tools/m365-spike/raw/probe.json';
const DEFAULT_PORT = 8765;
const DEFAULT_CALLBACK_TIMEOUT_MS = 300_000;
const MAX_WINDOW_DAYS = 62;
const ME_SELECT =
    'id,displayName,givenName,surname,mail,userPrincipalName,userType,preferredLanguage';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const ENV_NAMES = [
    'M365_TENANT_ID',
    'M365_CLIENT_ID',
    'M365_CLIENT_SECRET',
    'M365_SPIKE_LOGIN_HINT',
    'M365_SPIKE_BLOCKED_LOGIN_HINT',
    'M365_SPIKE_WINDOW_START',
    'M365_SPIKE_WINDOW_END',
    'M365_SPIKE_OUTLOOK_CLIENT',
    'M365_SPIKE_PORT',
];

// ---- configuration ----------------------------------------------------------------------

function requireEnv(env, name) {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name} is missing (see tests/Tools/m365-spike/.env.local.example)`);
    }
    return value.trim();
}

function parsePort(value) {
    if (value === undefined || String(value).trim() === '') {
        return DEFAULT_PORT;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('M365_SPIKE_PORT must be an integer between 0 and 65535');
    }
    return port;
}

function readConfig(env, { needSecret = true } = {}) {
    const tenantId = requireEnv(env, 'M365_TENANT_ID');
    assertTenantId(tenantId);
    return {
        tenantId,
        clientId: requireEnv(env, 'M365_CLIENT_ID'),
        clientSecret: needSecret ? requireEnv(env, 'M365_CLIENT_SECRET') : null,
        port: parsePort(env.M365_SPIKE_PORT),
    };
}

export function parseWindow(env) {
    const read = (name) => {
        const value = requireEnv(env, name);
        if (!ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) {
            throw new Error(`${name} must be an ISO-8601 UTC timestamp ending in Z`);
        }
        return value;
    };
    const start = read('M365_SPIKE_WINDOW_START');
    const end = read('M365_SPIKE_WINDOW_END');
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (days <= 0) {
        throw new Error('M365_SPIKE_WINDOW_START must be before M365_SPIKE_WINDOW_END');
    }
    if (days > MAX_WINDOW_DAYS) {
        throw new Error(
            `M365_SPIKE_WINDOW_END is more than ${MAX_WINDOW_DAYS} days after the start`
        );
    }
    return { start, end };
}

// ---- sign-in ----------------------------------------------------------------------------

function printAuthorizeUrl(userLabel) {
    return (url) => {
        console.log(
            `\nÁbrala en una ventana InPrivate/privada e inicie sesión con ${userLabel}:\n`
        );
        console.log(url);
        console.log('');
    };
}

async function beginAuthorization({ env, endpoints, loginHint, openUrl, timeoutMs, needSecret }) {
    const config = readConfig(env, { needSecret });
    const { verifier, challenge } = createPkcePair();
    const state = createState();
    const server = await startCallbackServer({ port: config.port, state, timeoutMs });
    const url = buildAuthorizeUrl({
        authorityBase: endpoints.authorityBase,
        tenantId: config.tenantId,
        clientId: config.clientId,
        redirectUri: server.redirectUri,
        state,
        challenge,
        loginHint,
    });
    // A failing opener is not fatal: the callback timeout reports the missing sign-in.
    Promise.resolve()
        .then(() => openUrl(url))
        .catch(() => {});
    return { config, server, verifier };
}

function describeRefusal(outcome) {
    const parts = [];
    if (/^[a-z_]{1,64}$/.test(outcome.error ?? '')) {
        parts.push(outcome.error);
    }
    parts.push(...outcome.aadstsCodes);
    return parts.join(' ') || 'no error code';
}

async function signIn({ env, endpoints, loginHint, openUrl, timeoutMs }) {
    const { config, server, verifier } = await beginAuthorization({
        env,
        endpoints,
        loginHint,
        openUrl,
        timeoutMs,
        needSecret: true,
    });
    try {
        const outcome = await server.result;
        if (outcome.error !== undefined) {
            throw new Error(`Microsoft refused the sign-in: ${describeRefusal(outcome)}`);
        }
        const redeemed = await redeemCode({
            authorityBase: endpoints.authorityBase,
            tenantId: config.tenantId,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            code: outcome.code,
            redirectUri: server.redirectUri,
            verifier,
        });
        return { config, ...redeemed };
    } finally {
        server.close();
    }
}

async function fetchMe(accessToken, graphBase) {
    const result = await graphGet(`${graphBase}/me?$select=${ME_SELECT}`, {
        accessToken,
        preferMode: 'none',
    });
    if (result.status !== 200) {
        throw new Error(`GET /me failed (HTTP ${result.status} ${result.errorCode ?? ''})`.trim());
    }
    return result.body;
}

// Booleans and the userType only: no address, id or name leaves this function.
function evaluateIdentity({ me, claims, tenantId, loginHint }) {
    const addresses = [me?.mail, me?.userPrincipalName]
        .filter((value) => typeof value === 'string')
        .map((value) => value.toLowerCase());
    return {
        signedInMatchesLoginHint: addresses.includes(loginHint.toLowerCase()),
        userType: typeof me?.userType === 'string' ? me.userType : null,
        tidMatches:
            typeof claims?.tid === 'string' && claims.tid.toLowerCase() === tenantId.toLowerCase(),
    };
}

function identityFailures(identity) {
    const failures = [];
    if (!identity.signedInMatchesLoginHint) {
        failures.push('the signed-in account is not the one in M365_SPIKE_LOGIN_HINT');
    }
    if (identity.userType !== 'Member') {
        failures.push('the signed-in account is not a Member (a Guest cannot be test user A)');
    }
    if (!identity.tidMatches) {
        failures.push('the token tenant is not M365_TENANT_ID');
    }
    return failures;
}

// ---- raw files --------------------------------------------------------------------------

function writeJson(dir, name, data) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function summarizeDocument(doc) {
    const pages = doc.pages ?? [];
    const failed = pages.find((page) => page.request.status < 200 || page.request.status > 299);
    const last = pages.at(-1);
    return {
        status: failed ? failed.request.status : (last?.request.status ?? null),
        pages: pages.length,
        events: countEvents(pages),
    };
}

// ---- commands ---------------------------------------------------------------------------

export async function runCapture({
    env,
    round,
    endpoints = MICROSOFT_ENDPOINTS,
    openUrl = printAuthorizeUrl('la usuaria de prueba A'),
    rawDir = DEFAULT_RAW_DIR,
    timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS,
}) {
    if (round !== 'A' && round !== 'B') {
        throw new Error('--round must be A or B');
    }
    assertEndpoints(endpoints);
    const window = parseWindow(env);
    const loginHint = requireEnv(env, 'M365_SPIKE_LOGIN_HINT');

    const session = await signIn({ env, endpoints, loginHint, openUrl, timeoutMs });
    const me = await fetchMe(session.accessToken, endpoints.graphBase);

    // Pitfall 5: never capture a mailbox other than test user A's. Nothing is written, and no
    // calendar endpoint is called, unless the signed-in identity is exactly that user.
    const failures = identityFailures(
        evaluateIdentity({
            me,
            claims: session.idTokenClaims,
            tenantId: session.config.tenantId,
            loginHint,
        })
    );
    if (failures.length > 0) {
        throw new Error(`Identity check failed, nothing captured: ${failures.join('; ')}`);
    }

    const roundDir = path.join(rawDir, `round${round}`);
    const documents = await runCapturePasses({
        accessToken: session.accessToken,
        graphBase: endpoints.graphBase,
        window,
        round,
    });
    const capturedAt = new Date().toISOString();
    writeJson(roundDir, 'me.json', me);
    writeJson(roundDir, 'token-shape.json', {
        keys: session.summary.keys,
        tokenType: session.summary.tokenType,
        scope: session.summary.grantedScopes.join(' '),
        expiresIn: session.summary.expiresIn,
        refreshTokenIssued: session.summary.refreshTokenIssued,
        idTokenIssued: session.summary.idTokenIssued,
    });
    const passes = {};
    for (const [name, doc] of Object.entries(documents)) {
        writeJson(roundDir, `${name}.json`, doc);
        passes[name] = summarizeDocument(doc);
    }
    const meta = { round, capturedAt, window, passes };
    writeJson(roundDir, 'meta.json', meta);
    for (const [name, entry] of Object.entries(passes)) {
        console.log(
            `${name}: status ${entry.status}, ${entry.pages} pages, ${entry.events} events`
        );
    }
    return meta;
}

// ---- operator prompts -------------------------------------------------------------------

// Reads one line from the terminal. Resolves null when stdin ends or `signal` aborts.
async function askOnStdin(question, { signal } = {}) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const closed = new Promise((resolve) => rl.once('close', () => resolve(null)));
    const answer = rl.question(question, { signal }).catch(() => null);
    try {
        return await Promise.race([answer, closed]);
    } finally {
        rl.close();
    }
}

async function askYesNo(ask, question) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const answer = await ask(question, {});
        if (answer === null || answer === undefined) {
            break;
        }
        const normalized = answer.trim().toLowerCase();
        if (['s', 'si', 'sí', 'y', 'yes'].includes(normalized)) {
            return true;
        }
        if (['n', 'no'].includes(normalized)) {
            return false;
        }
    }
    throw new Error('No valid answer to the consent question (expected s or n)');
}

// ---- auth -------------------------------------------------------------------------------

const CONSENT_QUESTION = '¿Se mostró una pantalla de consentimiento de permisos? (s/n) ';
const BLOCKED_QUESTION =
    'Si Microsoft muestra una página de error, escriba aquí el código AADSTS ' +
    '(o pulse Intro para seguir esperando): ';
const BLOCKED_CODE = 'AADSTS50105';

function authFailures(check) {
    const failures = [];
    if (check.missingScopes.length > 0 || check.extraScopes.length > 0) {
        failures.push(
            'the granted scopes differ from the configured ones ' +
                `(missing: ${check.missingScopes.join(', ') || 'none'}; ` +
                `extra: ${check.extraScopes.join(', ') || 'none'})`
        );
    }
    if (!check.refreshTokenIssued) {
        failures.push('no refresh token was issued (offline_access was not granted)');
    }
    if (!check.tidMatches) {
        failures.push('the token tenant is not M365_TENANT_ID');
    }
    if (check.userType !== 'Member') {
        failures.push('the signed-in account is not a Member');
    }
    if (!check.signedInMatchesLoginHint) {
        failures.push('the signed-in account is not the one in M365_SPIKE_LOGIN_HINT');
    }
    if (check.consentPromptShown) {
        failures.push('a consent prompt was shown (admin consent is missing or incomplete)');
    }
    return failures;
}

export async function runAuth({
    env,
    endpoints = MICROSOFT_ENDPOINTS,
    openUrl = printAuthorizeUrl('la usuaria de prueba A'),
    ask = askOnStdin,
    rawDir = DEFAULT_RAW_DIR,
    timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS,
}) {
    assertEndpoints(endpoints);
    const loginHint = requireEnv(env, 'M365_SPIKE_LOGIN_HINT');
    const session = await signIn({ env, endpoints, loginHint, openUrl, timeoutMs });
    const me = await fetchMe(session.accessToken, endpoints.graphBase);
    const identity = evaluateIdentity({
        me,
        claims: session.idTokenClaims,
        tenantId: session.config.tenantId,
        loginHint,
    });
    const consentPromptShown = await askYesNo(ask, CONSENT_QUESTION);
    const { summary } = session;
    const check = {
        checkedAt: new Date().toISOString(),
        grantedScopes: summary.grantedScopes,
        scopeMatches: summary.scopeMatches,
        missingScopes: summary.missingScopes,
        extraScopes: summary.extraScopes,
        refreshTokenIssued: summary.refreshTokenIssued,
        idTokenIssued: summary.idTokenIssued,
        tidMatches: identity.tidMatches,
        userType: identity.userType,
        signedInMatchesLoginHint: identity.signedInMatchesLoginHint,
        consentPromptShown,
    };
    writeJson(rawDir, 'auth-check.json', check);
    writeJson(rawDir, 'me.json', me);

    const failures = authFailures(check);
    const rows = [
        ['scopeMatches', check.scopeMatches],
        ['refreshTokenIssued', check.refreshTokenIssued],
        ['tidMatches', check.tidMatches],
        ['userType', check.userType],
        ['signedInMatchesLoginHint', check.signedInMatchesLoginHint],
        ['consentPromptShown', check.consentPromptShown],
    ];
    for (const [name, value] of rows) {
        console.log(`${name.padEnd(26)}${value}`);
    }
    console.log(`${'grantedScopes'.padEnd(26)}${check.grantedScopes.join(' ')}`);
    for (const failure of failures) {
        console.log(`FAIL: ${failure}`);
    }
    return { ...check, failures, exitCode: failures.length === 0 ? 0 : 1 };
}

// The outcome of the callback, or of the code the operator typed, whichever comes first.
function fromCallback(outcome) {
    if (outcome.code !== undefined) {
        // A code means Microsoft let the user in. It is never redeemed.
        return { source: 'callback', errorCode: null, blocked: false };
    }
    const safeName = /^[a-z_]{1,64}$/.test(outcome.error ?? '') ? outcome.error : null;
    return {
        source: 'callback',
        errorCode: outcome.aadstsCodes[0] ?? safeName,
        blocked: outcome.aadstsCodes.includes(BLOCKED_CODE),
    };
}

async function watchOperator(ask, signal) {
    try {
        for (;;) {
            const answer = await ask(BLOCKED_QUESTION, { signal });
            if (answer === null || answer === undefined) {
                break; // stdin ended or the prompt was aborted: only the callback can decide
            }
            const code = /AADSTS\d+/i.exec(answer)?.[0].toUpperCase();
            if (code) {
                return { source: 'operator', errorCode: code, blocked: code === BLOCKED_CODE };
            }
        }
    } catch {
        // an unusable prompt behaves like a closed stdin
    }
    return new Promise(() => {});
}

export async function runExpectBlocked({
    env,
    endpoints = MICROSOFT_ENDPOINTS,
    openUrl = printAuthorizeUrl('la usuaria de prueba B'),
    ask = askOnStdin,
    rawDir = DEFAULT_RAW_DIR,
    timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS,
}) {
    assertEndpoints(endpoints);
    const loginHint = requireEnv(env, 'M365_SPIKE_BLOCKED_LOGIN_HINT');
    const { server } = await beginAuthorization({
        env,
        endpoints,
        loginHint,
        openUrl,
        timeoutMs,
        needSecret: false,
    });
    const prompt = new AbortController();
    let outcome;
    try {
        outcome = await Promise.race([
            server.result.then(fromCallback),
            watchOperator(ask, prompt.signal),
        ]);
    } finally {
        prompt.abort();
        server.close();
    }
    const doc = {
        checkedAt: new Date().toISOString(),
        blocked: outcome.blocked,
        errorCode: outcome.errorCode,
        source: outcome.source,
    };
    writeJson(rawDir, 'auth-blocked.json', doc);
    if (outcome.blocked) {
        console.log(`La usuaria B fue bloqueada como se esperaba (${BLOCKED_CODE}).`);
    } else if (outcome.errorCode) {
        console.log(
            `Se recibió ${outcome.errorCode} y no ${BLOCKED_CODE}. Compruebe que la usuaria B no ` +
                'está asignada a la aplicación y que no tiene ningún rol de administrador.'
        );
    } else {
        console.log(
            'La usuaria B NO fue bloqueada: Microsoft la dejó entrar (código sin canjear).'
        );
    }
    return { ...doc, exitCode: doc.blocked ? 0 : 1 };
}

// ---- status -----------------------------------------------------------------------------

const SAFE = {
    name: /^[A-Za-z0-9_-]{1,40}$/,
    userType: /^(?:Member|Guest)$/,
    timestamp: /^\d{4}-\d{2}-\d{2}T[\d:.]{8,16}Z$/,
};

function readJsonIfPresent(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function gitIgnoreStatus(repoRoot, relativePath) {
    try {
        execFileSync('git', ['check-ignore', '-q', relativePath], {
            cwd: repoRoot,
            stdio: 'ignore',
        });
        return 'yes';
    } catch (error) {
        return error?.status === 1 ? 'NO' : 'unknown (git unavailable)';
    }
}

// Only booleans, whitelisted shapes, status codes and counts are printed. Anything else in the
// raw files (addresses, ids, names) is ignored on purpose.
const show = {
    flag: (value) => (value === true ? 'true' : value === false ? 'false' : 'unknown'),
    count: (value) => (Number.isInteger(value) ? String(value) : '?'),
    match: (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : '?'),
};

function describeRound(label, meta) {
    const start = show.match(meta.window?.start, SAFE.timestamp);
    const end = show.match(meta.window?.end, SAFE.timestamp);
    const lines = [
        `  ${label}: captured ${show.match(meta.capturedAt, SAFE.timestamp)}`,
        `    window ${start} to ${end}`,
    ];
    for (const [name, entry] of Object.entries(meta.passes ?? {})) {
        if (SAFE.name.test(name)) {
            lines.push(
                `    ${name}: status ${show.count(entry?.status)}, ` +
                    `${show.count(entry?.pages)} pages, ${show.count(entry?.events)} events`
            );
        }
    }
    return lines;
}

function describeAuthCheck(check) {
    if (!check) {
        return '  auth: not run yet';
    }
    return (
        `  auth: scopeMatches=${show.flag(check.scopeMatches)} ` +
        `refreshTokenIssued=${show.flag(check.refreshTokenIssued)} ` +
        `tidMatches=${show.flag(check.tidMatches)} ` +
        `userType=${show.match(check.userType, SAFE.userType)} ` +
        `signedInMatchesLoginHint=${show.flag(check.signedInMatchesLoginHint)} ` +
        `consentPromptShown=${show.flag(check.consentPromptShown)}`
    );
}

function describeBlocked(blocked) {
    if (!blocked) {
        return '  auth --expect-blocked: not run yet';
    }
    const code = blocked.errorCode === null ? 'none' : show.match(blocked.errorCode, SAFE.name);
    return `  auth --expect-blocked: blocked=${show.flag(blocked.blocked)} errorCode=${code}`;
}

export function runStatus({ env, rawDir = DEFAULT_RAW_DIR, repoRoot = REPO_ROOT }) {
    const lines = ['Environment (values are never printed)'];
    for (const name of ENV_NAMES) {
        const set = typeof env[name] === 'string' && env[name].trim() !== '';
        lines.push(`  ${name}: ${set ? 'SET' : 'MISSING'}`);
    }
    const envFile = 'tests/Tools/m365-spike/.env.local';
    lines.push(
        '',
        'Git',
        `  tests/Tools/m365-spike/raw/ is git-ignored: ${gitIgnoreStatus(repoRoot, RAW_PROBE)}`,
        `  ${envFile} is git-ignored: ${gitIgnoreStatus(repoRoot, envFile)}`,
        '',
        'Registration checks',
        describeAuthCheck(readJsonIfPresent(path.join(rawDir, 'auth-check.json'))),
        describeBlocked(readJsonIfPresent(path.join(rawDir, 'auth-blocked.json'))),
        '',
        'Captures'
    );
    for (const round of ['A', 'B']) {
        const meta = readJsonIfPresent(path.join(rawDir, `round${round}`, 'meta.json'));
        const described = meta
            ? describeRound(`round${round}`, meta)
            : [`  round${round}: not captured yet`];
        lines.push(...described);
    }
    return `${lines.join('\n')}\n`;
}

// ---- CLI --------------------------------------------------------------------------------

const USAGE = `Usage: node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/capture.mjs <command>

  auth                   sign in as test user A and verify the registration
  auth --expect-blocked  sign in as test user B and expect AADSTS50105
  capture --round A|B    record the calendarView experiments for a round
  status                 print what is configured and captured (never a value)
`;

// Returns the command, or the 1-based position of the first token it does not know. The token
// itself is never echoed: a secret typed as an argument must not reach the terminal output.
export function parseArgs(argv) {
    const [command, ...rest] = argv;
    if (command === 'status' && rest.length === 0) {
        return { command };
    }
    if (command === 'auth') {
        if (rest.length === 0) {
            return { command };
        }
        if (rest.length === 1 && rest[0] === '--expect-blocked') {
            return { command, expectBlocked: true };
        }
        return { badPosition: rest[0] === '--expect-blocked' ? 3 : 2 };
    }
    if (command === 'capture') {
        if (rest[0] !== '--round') {
            return { badPosition: 2 };
        }
        if (rest[1] !== 'A' && rest[1] !== 'B') {
            return { badPosition: 3 };
        }
        return rest.length === 2 ? { command, round: rest[1] } : { badPosition: 4 };
    }
    return { badPosition: 1 };
}

function assertRawDirIgnored(repoRoot) {
    try {
        execFileSync('git', ['check-ignore', '-q', RAW_PROBE], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
        throw new Error(
            'tests/Tools/m365-spike/raw/ is not git-ignored (or git is unavailable): refusing to write captures'
        );
    }
}

function assertNodeVersion() {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 20 || (major === 20 && minor < 6)) {
        throw new Error('Node 20.6 or newer is required (--env-file)');
    }
}

export async function main(argv, { env = process.env, repoRoot = REPO_ROOT } = {}) {
    const parsed = parseArgs(argv);
    if (parsed.badPosition !== undefined) {
        console.error(
            `Error: unknown argument at position ${parsed.badPosition}. ` +
                'Secrets and other values are never accepted as arguments.'
        );
        console.error(USAGE);
        return 2;
    }
    try {
        assertNodeVersion();
        if (parsed.command === 'status') {
            process.stdout.write(runStatus({ env, repoRoot }));
            return 0;
        }
        assertRawDirIgnored(repoRoot);
        if (parsed.command === 'capture') {
            await runCapture({ env, round: parsed.round });
            return 0;
        }
        const run = parsed.expectBlocked ? runExpectBlocked : runAuth;
        return (await run({ env })).exitCode;
    } catch (error) {
        // Messages are built from statuses, error codes and variable names only.
        console.error(`Error: ${error.message}`);
        return 1;
    }
}

const isEntryPoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
    process.exitCode = await main(process.argv.slice(2));
}
