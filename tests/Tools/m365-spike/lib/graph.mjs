// Paged Microsoft Graph GETs for the spike harness. Zero dependencies.
// Every request re-sends Authorization and the Prefer headers (they only apply to the request
// that carries them), `@odata.nextLink` is followed verbatim, and a failed response is recorded as
// status + error.code only: a body is never printed.
import http from 'node:http';
import https from 'node:https';

export const PROD_SELECT =
    'id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,' +
    'seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting';
export const EXPERIMENT_SELECT = `${PROD_SELECT},lastModifiedDateTime,attendees`;
export const PREFER_COMBINED = 'outlook.timezone="UTC", IdType="ImmutableId"';
export const PREFER_TZ_ONLY = 'outlook.timezone="UTC"';
export const PREFER_ID_ONLY = 'IdType="ImmutableId"';

const SERIES_MASTER_SELECT =
    'id,type,subject,recurrence,cancelledOccurrences,seriesMasterId,iCalUId,start,end';
const LOOKUP_SELECT = 'id,isCancelled,start,end,responseStatus,type,seriesMasterId';
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,80}$/;

export function buildCalendarViewUrl({ graphBase, start, end, select, top }) {
    const query = [
        `startDateTime=${encodeURIComponent(start)}`,
        `endDateTime=${encodeURIComponent(end)}`,
    ];
    if (select) {
        query.push(`$select=${select}`);
    }
    query.push('$orderby=start/dateTime');
    if (top) {
        query.push(`$top=${top}`);
    }
    return `${graphBase}/me/calendarView?${query.join('&')}`;
}

// Event ids contain characters (/ + =) that must be percent-encoded inside a path segment.
const eventUrl = (graphBase, id, suffix = '', query = '') =>
    `${graphBase}/me/events/${encodeURIComponent(id)}${suffix}${query ? `?${query}` : ''}`;

// Header list as [name, value] pairs. 'separate' sends the two preferences as two Prefer lines.
function buildHeaders(accessToken, preferMode) {
    const headers = [
        ['Authorization', `Bearer ${accessToken}`],
        ['Accept', 'application/json'],
    ];
    if (preferMode === 'combined') {
        headers.push(['Prefer', PREFER_COMBINED]);
    } else if (preferMode === 'separate') {
        headers.push(['Prefer', PREFER_TZ_ONLY], ['Prefer', PREFER_ID_ONLY]);
    } else if (preferMode === 'tz-only') {
        headers.push(['Prefer', PREFER_TZ_ONLY]);
    } else if (preferMode !== 'none') {
        throw new Error('Unknown preferMode');
    }
    return headers;
}

function errorCodeOf(json) {
    const code = json?.error?.code;
    return typeof code === 'string' && ERROR_CODE.test(code) ? code : 'unknown_error';
}

async function sendWithFetch(url, headers) {
    const response = await fetch(url, { headers: Object.fromEntries(headers) });
    let json = null;
    try {
        json = await response.json();
    } catch {
        // an empty or non-JSON body is treated as "no body"
    }
    return { status: response.status, json };
}

// undici folds repeated headers into one line. node:http keeps a raw header array as sent, which
// is the only way to test "two separate Prefer lines". With a raw header array Node adds no
// Host header on its own, so it is sent explicitly.
function sendWithRawHeaders(url, headers) {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.request(
            target,
            { method: 'GET', headers: ['Host', target.host, ...headers.flat()] },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    let json = null;
                    try {
                        json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch {
                        // an empty or non-JSON body is treated as "no body"
                    }
                    resolve({ status: response.statusCode, json });
                });
            }
        );
        request.on('error', reject);
        request.end();
    });
}

export async function graphGet(url, { accessToken, preferMode }) {
    const headers = buildHeaders(accessToken, preferMode);
    let sent;
    try {
        sent =
            preferMode === 'separate'
                ? await sendWithRawHeaders(url, headers)
                : await sendWithFetch(url, headers);
    } catch {
        throw new Error('Graph request failed (network error)');
    }
    const headerNames = headers.map(([name]) => name);
    if (sent.status < 200 || sent.status > 299) {
        return {
            status: sent.status,
            headerNames,
            body: null,
            errorCode: errorCodeOf(sent.json),
        };
    }
    return { status: sent.status, headerNames, body: sent.json, errorCode: null };
}

const requestRecord = (url, result, preferMode) => ({
    url,
    headerNames: result.headerNames,
    preferMode,
    status: result.status,
});

function failedPage(url, preferMode, errorCode) {
    return {
        request: { url, headerNames: [], preferMode, status: 0 },
        body: null,
        errorCode,
    };
}

// Follows @odata.nextLink verbatim. `page2PreferMode` applies to every page after the first;
// `stopAfter` ends the walk silently after that many pages.
export async function fetchAllPages(
    firstUrl,
    { accessToken, preferMode, page2PreferMode, maxPages = 50, stopAfter = Infinity }
) {
    const origin = new URL(firstUrl).origin;
    const pages = [];
    let url = firstUrl;
    while (url) {
        if (pages.length >= stopAfter) {
            break;
        }
        if (pages.length >= maxPages) {
            pages.push(failedPage(url, preferMode, 'max_pages_exceeded'));
            break;
        }
        // The bearer token must never follow a nextLink to another host.
        if (new URL(url).origin !== origin) {
            pages.push(failedPage(url, preferMode, 'next_link_origin_mismatch'));
            break;
        }
        const mode = pages.length === 0 ? preferMode : (page2PreferMode ?? preferMode);
        const result = await graphGet(url, { accessToken, preferMode: mode });
        pages.push({
            request: requestRecord(url, result, mode),
            body: result.body,
            errorCode: result.errorCode,
        });
        url = result.body?.['@odata.nextLink'] ?? null;
    }
    return pages;
}

export function countEvents(pages) {
    return pages.reduce((sum, page) => sum + (page.body?.value?.length ?? 0), 0);
}

function pageDocument(pass, round, pages) {
    return { pass, round, capturedAt: new Date().toISOString(), pages };
}

function distinctSeriesMasterIds(pages) {
    const ids = new Set();
    for (const page of pages) {
        for (const event of page.body?.value ?? []) {
            if (typeof event.seriesMasterId === 'string' && event.seriesMasterId !== '') {
                ids.add(event.seriesMasterId);
            }
        }
    }
    return [...ids];
}

async function captureSeries({ accessToken, graphBase, window, masterIds }) {
    const masters = [];
    const instances = [];
    for (const masterId of masterIds) {
        const url = eventUrl(graphBase, masterId, '', `$select=${SERIES_MASTER_SELECT}`);
        const result = await graphGet(url, { accessToken, preferMode: 'combined' });
        masters.push({
            masterId,
            request: requestRecord(url, result, 'combined'),
            errorCode: result.errorCode,
            body: result.body,
        });
        const instancesUrl = eventUrl(
            graphBase,
            masterId,
            '/instances',
            `startDateTime=${encodeURIComponent(window.start)}` +
                `&endDateTime=${encodeURIComponent(window.end)}&$select=${PROD_SELECT}`
        );
        instances.push({
            masterId,
            pages: await fetchAllPages(instancesUrl, { accessToken, preferMode: 'combined' }),
        });
    }
    return { masters, instances };
}

// Round B: does a direct lookup still find every event Round A saw? A 404 is data, not an error.
async function captureLookups({ accessToken, graphBase, ids }) {
    const lookups = [];
    for (const id of ids) {
        const url = eventUrl(graphBase, id, '', `$select=${LOOKUP_SELECT}`);
        const result = await graphGet(url, { accessToken, preferMode: 'combined' });
        lookups.push({
            id,
            request: { url, status: result.status },
            errorCode: result.errorCode,
            body: result.body,
        });
    }
    return { lookups };
}

// One run records every experiment the decision document needs. A failing pass (for example a
// 400 for the experimental $select) is recorded as its result and never aborts the run.
export async function runCapturePasses({ accessToken, graphBase, window, round, roundAIds }) {
    const calendarUrl = (select, top) =>
        buildCalendarViewUrl({ graphBase, start: window.start, end: window.end, select, top });
    const passes = [
        ['prod-select', calendarUrl(PROD_SELECT, 3), { preferMode: 'combined' }],
        ['prefer-separate', calendarUrl(PROD_SELECT, 3), { preferMode: 'separate' }],
        [
            'page2-no-prefer',
            calendarUrl(PROD_SELECT, 3),
            { preferMode: 'combined', page2PreferMode: 'none', stopAfter: 2 },
        ],
        ['no-immutableid', calendarUrl(PROD_SELECT, 3), { preferMode: 'tz-only' }],
        ['experiment-select', calendarUrl(EXPERIMENT_SELECT, 3), { preferMode: 'combined' }],
        ['full-shape', calendarUrl(null, 3), { preferMode: 'combined' }],
    ];
    const documents = {};
    for (const [name, url, options] of passes) {
        const pages = await fetchAllPages(url, { accessToken, ...options });
        documents[name] = pageDocument(name, round, pages);
    }
    documents.series = await captureSeries({
        accessToken,
        graphBase,
        window,
        masterIds: distinctSeriesMasterIds(documents['prod-select'].pages),
    });
    if (round === 'B') {
        documents.lookups = await captureLookups({ accessToken, graphBase, ids: roundAIds ?? [] });
    }
    return documents;
}
