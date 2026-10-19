// OAuth 2.0 authorization code + PKCE helpers for the Microsoft 365 spike harness.
// Zero dependencies (node: built-ins only). Tokens live in process memory only: nothing in this
// module writes them anywhere, and no error message carries a token, a secret or a response body.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export const SCOPES = 'openid profile email offline_access User.Read Calendars.Read';
export const REDIRECT_PATH = '/m365-spike/callback';
export const MICROSOFT_ENDPOINTS = Object.freeze({
    authorityBase: 'https://login.microsoftonline.com',
    graphBase: 'https://graph.microsoft.com/v1.0',
});

const MICROSOFT_HOSTS = new Set(['login.microsoftonline.com', 'graph.microsoft.com']);
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MULTI_TENANT_ALIASES = ['common', 'organizations', 'consumers'];
const AADSTS = /AADSTS\d+/gi;

// The CLI always passes MICROSOFT_ENDPOINTS. Tests may pass a 127.0.0.1 fake over plain http.
export function assertEndpoints(endpoints) {
    for (const key of ['authorityBase', 'graphBase']) {
        let url;
        try {
            url = new URL(endpoints?.[key]);
        } catch {
            throw new Error(`endpoints.${key} is not a valid URL`);
        }
        const microsoft = url.protocol === 'https:' && MICROSOFT_HOSTS.has(url.hostname);
        const loopbackFake = url.protocol === 'http:' && url.hostname === '127.0.0.1';
        if (!microsoft && !loopbackFake) {
            throw new Error(`endpoints.${key} must point at Microsoft (or 127.0.0.1 in tests)`);
        }
    }
}

// D-07: one tenant only. The multi-tenant aliases would let any Microsoft account sign in.
export function assertTenantId(id) {
    const value = String(id ?? '');
    if (MULTI_TENANT_ALIASES.includes(value.toLowerCase())) {
        throw new Error(
            `M365_TENANT_ID must be the tenant GUID, never ${MULTI_TENANT_ALIASES.join('/')}`
        );
    }
    if (!TENANT_GUID.test(value)) {
        throw new Error('M365_TENANT_ID must be a tenant GUID');
    }
}

export function createPkcePair() {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

export function createState() {
    return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl({
    authorityBase,
    tenantId,
    clientId,
    redirectUri,
    state,
    challenge,
    loginHint,
}) {
    const url = new URL(`${authorityBase}/${tenantId}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams([
        ['client_id', clientId],
        ['response_type', 'code'],
        ['redirect_uri', redirectUri],
        ['response_mode', 'query'],
        ['scope', SCOPES],
        ['state', state],
        ['code_challenge', challenge],
        ['code_challenge_method', 'S256'],
        ['prompt', 'select_account'],
        ['login_hint', loginHint],
    ]).toString();
    return url.toString();
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a ?? ''));
    const right = Buffer.from(String(b ?? ''));
    return left.length === right.length && timingSafeEqual(left, right);
}

function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host }, () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });
}

// Loopback listener for the redirect. Binds 127.0.0.1 and (when the host has it) ::1, never all
// interfaces. Accepts one request on REDIRECT_PATH and answers 404 everywhere else.
export async function startCallbackServer({ port, state, timeoutMs = 300_000 }) {
    let settle;
    let fail;
    const result = new Promise((resolve, reject) => {
        settle = resolve;
        fail = reject;
    });
    result.catch(() => {}); // the caller awaits it; this only prevents an unhandled rejection

    const servers = [];
    let timer = null;
    let closed = false;
    let handled = false;

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        clearTimeout(timer);
        for (const server of servers) {
            server.close();
            server.closeAllConnections?.();
        }
    };

    // The listeners close only after the response was flushed to the browser.
    const respond = (res, status, text, last = true) => {
        if (last) {
            res.once('close', close);
        }
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
        res.end(text);
    };

    const handler = (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (req.method !== 'GET' || url.pathname !== REDIRECT_PATH || handled) {
            respond(res, 404, 'Not found', false);
            return;
        }
        handled = true;
        const params = url.searchParams;
        if (!safeEqual(params.get('state'), state)) {
            respond(res, 400, 'Rechazado');
            fail(new Error('The state returned to the callback does not match: request rejected'));
            return;
        }
        if (params.has('error')) {
            const description = params.get('error_description') ?? '';
            respond(res, 400, 'Rechazado');
            settle({
                error: params.get('error'),
                errorDescription: description,
                aadstsCodes: [...new Set(description.match(AADSTS) ?? [])].map((c) =>
                    c.toUpperCase()
                ),
            });
            return;
        }
        if (!params.get('code')) {
            respond(res, 400, 'Rechazado');
            fail(new Error('The callback carried neither a code nor an error'));
            return;
        }
        respond(res, 200, 'OK, puede cerrar esta pestaña');
        settle({ code: params.get('code') });
    };

    const primary = createServer(handler);
    servers.push(primary);
    const actualPort = await listen(primary, port, '127.0.0.1');

    const ipv6 = createServer(handler);
    try {
        await listen(ipv6, actualPort, '::1');
        servers.push(ipv6);
    } catch (error) {
        // ::1 may be unavailable (no IPv6). An occupied ::1 port is NOT ignored: another process
        // could then receive the browser redirect that "localhost" resolves to.
        if (error?.code !== 'EADDRNOTAVAIL' && error?.code !== 'EAFNOSUPPORT') {
            close();
            throw new Error(`Could not bind the loopback listener on ::1 (${error?.code})`);
        }
    }

    timer = setTimeout(() => {
        fail(new Error('Timed out waiting for the browser sign-in to return to the callback'));
        close();
    }, timeoutMs);

    return { redirectUri: `http://localhost:${actualPort}${REDIRECT_PATH}`, result, close };
}

function normalizeScope(scope) {
    return scope.replace(/^https:\/\/graph\.microsoft\.com\//i, '');
}

export function summarizeTokenResponse(json) {
    const granted = String(json?.scope ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map(normalizeScope);
    // Entra omits offline_access from the returned scope, so it is compared through the refresh
    // token it produces instead.
    const configured = SCOPES.split(' ').filter((scope) => scope !== 'offline_access');
    const grantedKeys = new Set(granted.map((scope) => scope.toLowerCase()));
    const configuredKeys = new Set(configured.map((scope) => scope.toLowerCase()));
    const missingScopes = configured.filter((scope) => !grantedKeys.has(scope.toLowerCase()));
    const extraScopes = granted.filter(
        (scope) => scope !== 'offline_access' && !configuredKeys.has(scope.toLowerCase())
    );
    const refreshTokenIssued = typeof json?.refresh_token === 'string' && json.refresh_token !== '';
    return {
        grantedScopes: granted,
        scopeMatches: missingScopes.length === 0 && extraScopes.length === 0 && refreshTokenIssued,
        missingScopes,
        extraScopes,
        refreshTokenIssued,
        idTokenIssued: typeof json?.id_token === 'string' && json.id_token !== '',
        tokenType: typeof json?.token_type === 'string' ? json.token_type : '',
        expiresIn: Number.isFinite(json?.expires_in) ? json.expires_in : 0,
        keys: Object.keys(json ?? {}),
    };
}

// Debug only: the claims are read to cross-check the tenant, never trusted for security.
function decodeIdTokenClaims(idToken) {
    try {
        const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url'));
        return { tid: payload.tid ?? null, oid: payload.oid ?? null };
    } catch {
        return { tid: null, oid: null };
    }
}

async function describeTokenFailure(response) {
    let detail = '';
    try {
        const json = await response.json();
        const parts = [];
        if (typeof json?.error === 'string' && /^[a-z_]{1,64}$/.test(json.error)) {
            parts.push(json.error);
        }
        const codes = String(json?.error_description ?? '').match(AADSTS) ?? [];
        parts.push(...new Set(codes.map((code) => code.toUpperCase())));
        detail = parts.length > 0 ? `: ${parts.join(' ')}` : '';
    } catch {
        // an unreadable body adds nothing: only the status is reported
    }
    return `Token endpoint rejected the request (HTTP ${response.status})${detail}`;
}

export async function redeemCode({
    authorityBase,
    tenantId,
    clientId,
    clientSecret,
    code,
    redirectUri,
    verifier,
}) {
    let response;
    try {
        response = await fetch(`${authorityBase}/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams([
                ['client_id', clientId],
                ['client_secret', clientSecret],
                ['grant_type', 'authorization_code'],
                ['code', code],
                ['redirect_uri', redirectUri],
                ['code_verifier', verifier],
            ]),
        });
    } catch {
        throw new Error('Token endpoint unreachable (network error)');
    }
    if (!response.ok) {
        throw new Error(await describeTokenFailure(response));
    }
    const json = await response.json();
    const summary = summarizeTokenResponse(json);
    // json.refresh_token is dropped here on purpose: only the boolean above survives.
    return {
        accessToken: json.access_token,
        idTokenClaims: decodeIdTokenClaims(json.id_token),
        summary,
    };
}
