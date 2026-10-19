// Local fake of Entra (authorize + token) and Microsoft Graph for the offline harness tests.
// It listens on 127.0.0.1 only. Every token, secret and identifier is generated at runtime, so no
// committed file contains a value that looks like one.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { REDIRECT_PATH, SCOPES } from '../lib/oauth.mjs';

const GRAPH_PATH = '/graph/v1.0';
// Entra returns the scope without offline_access, and the harness must cope with that.
const FAKE_SCOPE = 'openid profile email User.Read Calendars.Read';
const BLOCKED_DESCRIPTION = 'AADSTS50105: The signed in user is not assigned to a role for the app.';

const b64url = (value) => Buffer.from(value).toString('base64url');
const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

// Header values (not names) sent under `name`, from a request's raw header array.
export function headerValues(rawHeaders, name) {
    const values = [];
    for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === name.toLowerCase()) {
            values.push(rawHeaders[i + 1]);
        }
    }
    return values;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function project(object, select) {
    if (!select) {
        return object;
    }
    const wanted = new Set(['id', ...select.split(',')]);
    return Object.fromEntries(Object.entries(object).filter(([key]) => wanted.has(key)));
}

function defaultUser() {
    return {
        id: randomUUID(),
        displayName: 'Test Person 1',
        givenName: 'Test',
        surname: 'Person',
        mail: 'person-1@example.test',
        userPrincipalName: 'person-1@example.test',
        userType: 'Member',
        preferredLanguage: 'es-ES',
    };
}

// pagesByRound: { A: [[event, ...], [event, ...]], B: [...] } — one inner array per Graph page.
// mode: 'ok' | 'not-blocked' (authorize issues a code) | 'blocked' (AADSTS50105 on the redirect).
export async function startFakeMicrosoft({
    pagesByRound = { A: [] },
    user = defaultUser(),
    mode = 'ok',
    grantedScope = FAKE_SCOPE,
    issueRefreshToken = true,
    idTokenTid,
} = {}) {
    const tenantId = randomUUID();
    const clientId = randomUUID();
    const clientSecret = randomToken();
    const codes = new Map();
    const fake = {
        round: 'A',
        credentials: { tenantId, clientId, clientSecret },
        requests: [],
        authorizeRequests: [],
        tokenRequests: 0,
        issued: { accessTokens: [], refreshTokens: [] },
    };

    const authorize = (url, res) => {
        const params = url.searchParams;
        const redirectUri = params.get('redirect_uri') ?? '';
        const problems = [];
        if (params.get('client_id') !== clientId) problems.push('client_id');
        if (params.get('response_type') !== 'code') problems.push('response_type');
        if (params.get('code_challenge_method') !== 'S256') problems.push('code_challenge_method');
        if (params.get('scope') !== SCOPES) problems.push('scope');
        if (!params.get('state')) problems.push('state');
        if (!params.get('code_challenge')) problems.push('code_challenge');
        if (!params.get('login_hint')) problems.push('login_hint');
        if (params.get('prompt') !== 'select_account') problems.push('prompt');
        const target = /^http:\/\/localhost:\d+(\/.*)$/.exec(redirectUri);
        if (!target || target[1] !== REDIRECT_PATH) problems.push('redirect_uri');
        fake.authorizeRequests.push({ problems, loginHint: params.get('login_hint') });
        if (problems.length > 0) {
            res.writeHead(400, { 'content-type': 'text/plain' });
            res.end(`invalid authorize request: ${problems.join(', ')}`);
            return;
        }
        const redirect = new URL(redirectUri);
        if (mode === 'blocked') {
            redirect.searchParams.set('error', 'access_denied');
            redirect.searchParams.set('error_description', BLOCKED_DESCRIPTION);
        } else {
            const code = randomToken(18);
            codes.set(code, { challenge: params.get('code_challenge'), redirectUri, clientId });
            redirect.searchParams.set('code', code);
        }
        redirect.searchParams.set('state', params.get('state'));
        res.writeHead(302, { location: redirect.toString() });
        res.end();
    };

    const token = async (req, res) => {
        fake.tokenRequests += 1;
        const form = new URLSearchParams(await readBody(req));
        if (form.get('client_secret') !== clientSecret || form.get('client_id') !== clientId) {
            sendJson(res, 401, {
                error: 'invalid_client',
                error_description: 'AADSTS7000215: Invalid client secret provided.',
                error_codes: [7000215],
            });
            return;
        }
        const grant = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        const verifierHash = createHash('sha256')
            .update(form.get('code_verifier') ?? '')
            .digest('base64url');
        if (
            form.get('grant_type') !== 'authorization_code' ||
            !grant ||
            grant.challenge !== verifierHash ||
            grant.redirectUri !== form.get('redirect_uri')
        ) {
            sendJson(res, 400, {
                error: 'invalid_grant',
                error_description: 'AADSTS70008: The provided authorization code is not valid.',
            });
            return;
        }
        const accessToken = randomToken(32);
        fake.issued.accessTokens.push(accessToken);
        const body = {
            token_type: 'Bearer',
            scope: grantedScope,
            expires_in: 3599,
            access_token: accessToken,
            id_token: [
                b64url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
                b64url(JSON.stringify({ tid: idTokenTid ?? tenantId, oid: user.id })),
                randomToken(12),
            ].join('.'),
        };
        if (issueRefreshToken) {
            body.refresh_token = randomToken(32);
            fake.issued.refreshTokens.push(body.refresh_token);
        }
        sendJson(res, 200, body);
    };

    const graph = (req, url, res) => {
        const bearer = headerValues(req.rawHeaders, 'authorization')[0] ?? '';
        if (!fake.issued.accessTokens.some((issued) => bearer === `Bearer ${issued}`)) {
            sendJson(res, 401, { error: { code: 'InvalidAuthenticationToken' } });
            return;
        }
        const route = url.pathname.slice(GRAPH_PATH.length);
        const select = url.searchParams.get('$select');
        if (route === '/me') {
            sendJson(res, 200, project(user, select));
            return;
        }
        if (route === '/me/calendarView') {
            calendarView(req, url, select, res);
            return;
        }
        sendJson(res, 404, { error: { code: 'ErrorInvalidRequest' } });
    };

    const calendarView = (req, url, select, res) => {
        const prefer = headerValues(req.rawHeaders, 'prefer').join(', ');
        const immutable = prefer.includes('IdType="ImmutableId"');
        const utc = prefer.includes('outlook.timezone="UTC"');
        const pages = pagesByRound[fake.round] ?? [];
        const index = Number(url.searchParams.get('$skiptoken') ?? 0);
        const events = (pages[index] ?? []).map((event) => {
            const shaped = { ...event, id: immutable ? event.id : `mutable-${event.id}` };
            for (const key of ['start', 'end']) {
                if (shaped[key]) {
                    shaped[key] = {
                        ...shaped[key],
                        timeZone: utc ? 'UTC' : 'Romance Standard Time',
                    };
                }
            }
            return project(shaped, select);
        });
        const body = { '@odata.context': 'fake', value: events };
        if (index + 1 < pages.length) {
            const next = new URL(url);
            next.searchParams.set('$skiptoken', String(index + 1));
            body['@odata.nextLink'] = next.toString();
        }
        sendJson(res, 200, body);
    };

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, fake.origin);
        fake.requests.push({
            method: req.method,
            path: url.pathname,
            rawPath: req.url.split('?')[0],
            query: Object.fromEntries(url.searchParams),
            rawHeaders: [...req.rawHeaders],
        });
        try {
            if (url.pathname === `/${tenantId}/oauth2/v2.0/authorize` && req.method === 'GET') {
                authorize(url, res);
            } else if (url.pathname === `/${tenantId}/oauth2/v2.0/token` && req.method === 'POST') {
                await token(req, res);
            } else if (url.pathname.startsWith(`${GRAPH_PATH}/`) && req.method === 'GET') {
                graph(req, url, res);
            } else {
                sendJson(res, 404, { error: 'not_found' });
            }
        } catch {
            sendJson(res, 500, { error: 'fake_failure' });
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    fake.origin = origin;
    fake.authorityBase = origin;
    fake.graphBase = `${origin}${GRAPH_PATH}`;
    fake.close = () => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    };
    return fake;
}

// ---- helpers shared by the test suites --------------------------------------------------

export function makeEvent(n, overrides = {}) {
    const day = String(10 + n).padStart(2, '0');
    return {
        id: `AAMk/event+${n}=`,
        iCalUId: `ICAL${n}`.padEnd(16, '0'),
        subject: `[M365-TEST S${n}] Reunión ${n}`,
        start: { dateTime: `2026-10-${day}T09:00:00.0000000`, timeZone: 'UTC' },
        end: { dateTime: `2026-10-${day}T10:00:00.0000000`, timeZone: 'UTC' },
        isAllDay: false,
        isCancelled: false,
        isOrganizer: true,
        responseStatus: { response: 'organizer', time: '0001-01-01T00:00:00Z' },
        type: 'singleInstance',
        seriesMasterId: null,
        originalStart: null,
        organizer: { emailAddress: { name: 'Test Person 1', address: 'person-1@example.test' } },
        showAs: 'busy',
        sensitivity: 'normal',
        webLink: `https://outlook.example.test/calendar/item/${n}`,
        isOnlineMeeting: false,
        lastModifiedDateTime: '2026-10-01T08:00:00Z',
        attendees: [
            {
                emailAddress: { name: 'Test Person 2', address: 'person-2@example.test' },
                type: 'required',
                status: { response: 'accepted', time: '2026-10-01T08:00:00Z' },
            },
        ],
        ...overrides,
    };
}

// Three pages of events (3 + 3 + 1), enough to prove that every page is requested.
export function threePages() {
    return [
        [makeEvent(1), makeEvent(2), makeEvent(3)],
        [makeEvent(4), makeEvent(5), makeEvent(6)],
        [makeEvent(7)],
    ];
}

export function buildEnv(fake, overrides = {}) {
    return {
        M365_TENANT_ID: fake.credentials.tenantId,
        M365_CLIENT_ID: fake.credentials.clientId,
        M365_CLIENT_SECRET: fake.credentials.clientSecret,
        M365_SPIKE_LOGIN_HINT: 'person-1@example.test',
        M365_SPIKE_WINDOW_START: '2026-10-19T00:00:00Z',
        M365_SPIKE_WINDOW_END: '2026-11-16T00:00:00Z',
        M365_SPIKE_PORT: '0',
        ...overrides,
    };
}

// Stands in for the operator's browser: follows the 302 to the loopback callback.
export async function followRedirects(url) {
    const response = await fetch(url);
    await response.text();
}

export function readAllFiles(dir) {
    const texts = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            texts.push(...readAllFiles(full));
        } else {
            texts.push(readFileSync(full, 'utf8'));
        }
    }
    return texts;
}
