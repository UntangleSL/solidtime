// Paged Microsoft Graph GETs for the spike harness. Zero dependencies.
// Every request re-sends Authorization and the Prefer headers (they only apply to the request
// that carries them), `@odata.nextLink` is followed verbatim, and a failed response is recorded as
// status + error.code only: a body is never printed.

export const PROD_SELECT =
    'id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,' +
    'seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting';
export const EXPERIMENT_SELECT = `${PROD_SELECT},lastModifiedDateTime,attendees`;
export const PREFER_COMBINED = 'outlook.timezone="UTC", IdType="ImmutableId"';
export const PREFER_TZ_ONLY = 'outlook.timezone="UTC"';

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

function buildHeaders(accessToken, preferMode) {
    const headers = [
        ['Authorization', `Bearer ${accessToken}`],
        ['Accept', 'application/json'],
    ];
    if (preferMode === 'combined') {
        headers.push(['Prefer', PREFER_COMBINED]);
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

export async function graphGet(url, { accessToken, preferMode }) {
    const headers = buildHeaders(accessToken, preferMode);
    let response;
    try {
        response = await fetch(url, { headers: Object.fromEntries(headers) });
    } catch {
        throw new Error('Graph request failed (network error)');
    }
    const headerNames = headers.map(([name]) => name);
    let json = null;
    try {
        json = await response.json();
    } catch {
        // an empty or non-JSON body is treated as "no body"
    }
    if (!response.ok) {
        return { status: response.status, headerNames, body: null, errorCode: errorCodeOf(json) };
    }
    return { status: response.status, headerNames, body: json, errorCode: null };
}

export async function fetchAllPages(
    firstUrl,
    { accessToken, preferMode, page2PreferMode, maxPages = 50 }
) {
    const origin = new URL(firstUrl).origin;
    const pages = [];
    let url = firstUrl;
    while (url) {
        if (pages.length >= maxPages) {
            pages.push({
                request: { url, headerNames: [], preferMode, status: 0 },
                body: null,
                errorCode: 'max_pages_exceeded',
            });
            break;
        }
        // The bearer token must never follow a nextLink to another host.
        if (new URL(url).origin !== origin) {
            pages.push({
                request: { url, headerNames: [], preferMode, status: 0 },
                body: null,
                errorCode: 'next_link_origin_mismatch',
            });
            break;
        }
        const mode = pages.length === 0 ? preferMode : (page2PreferMode ?? preferMode);
        const result = await graphGet(url, { accessToken, preferMode: mode });
        pages.push({
            request: {
                url,
                headerNames: result.headerNames,
                preferMode: mode,
                status: result.status,
            },
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

// Tracer subset: the `prod-select` pass. The remaining experiments are added in Task 3.
export async function runCapturePasses({ accessToken, graphBase, window, round }) {
    const url = buildCalendarViewUrl({
        graphBase,
        start: window.start,
        end: window.end,
        select: PROD_SELECT,
        top: 3,
    });
    const pages = await fetchAllPages(url, { accessToken, preferMode: 'combined' });
    return { 'prod-select': pageDocument('prod-select', round, pages) };
}
