// Allow-list sanitizer for captured Microsoft Graph responses (raw/ -> committed fixtures).
// Zero dependencies (node: built-ins only).
//
// Rules this module enforces by construction:
//  - Output objects are built field by field from an allow-list. Anything else (body, bodyPreview,
//    categories, attachments, extensions, fields Graph adds tomorrow) is never copied.
//  - Identifying values (ids, e-mails, names, GUIDs, links, locations) become keyed pseudonyms:
//    HMAC-SHA256 with a random salt that lives only in the git-ignored raw/ directory.
//  - Collections (calendarView pages) keep only events whose subject carries a scenario tag
//    "[M365-TEST <ID>]". An event without the tag never reaches an output, not even pseudonymized.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCENARIO_TAG, scenarioIdOf } from './scenarios.mjs';

export const FAKE_GUID_PREFIX = '00000000-0000-4000-8000-';
export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
export const PAGE_TOKEN_PREFIX = 'SANITIZED-PAGE-';

const ICAL_PREFIX = '040000008200E00074C5B7101A82E008';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_ANYWHERE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,80}$/;
const OCCURRENCE_ID = /^OID\.(.+)\.(\d{4}-\d{2}-\d{2})$/;
const SUBJECT_PREFIXES = [
    'Canceled',
    'Cancelled',
    'Cancelado',
    'Cancelada',
    'Declined',
    'Rechazado',
    'Rechazada',
    'Accepted',
    'Aceptado',
    'Aceptada',
    'Tentative',
    'Provisional',
    'Updated',
    'Actualizado',
    'Actualizada',
];
const SAFE_SUBJECT_REST = /^[a-z0-9 ()-]{0,40}$/;
const SAFE_STRING_MAX = 128;
const MIN_LEAK_LENGTH = 6;
// Values the sanitizer itself writes. A raw value that happens to equal one is not a leak.
const PSEUDONYM_LITERAL = /^(?:Test (?:User [AB]|Person \d+)|Event \d+|Location \d+)$/;

// Output field order is fixed, so the same input always serializes to the same bytes.
const EVENT_FIELD_ORDER = [
    '@odata.etag',
    'id',
    'changeKey',
    'iCalUId',
    'subject',
    'type',
    'seriesMasterId',
    'occurrenceId',
    'start',
    'end',
    'originalStart',
    'originalStartTimeZone',
    'originalEndTimeZone',
    'isAllDay',
    'isCancelled',
    'isOrganizer',
    'isOnlineMeeting',
    'isDraft',
    'showAs',
    'sensitivity',
    'importance',
    'responseRequested',
    'allowNewTimeProposals',
    'hideAttendees',
    'responseStatus',
    'recurrence',
    'cancelledOccurrences',
    'organizer',
    'attendees',
    'location',
    'locations',
    'onlineMeeting',
    'onlineMeetingUrl',
    'webLink',
    'createdDateTime',
    'lastModifiedDateTime',
];
const EVENT_KEYS = new Set(EVENT_FIELD_ORDER);
const PATTERN_KEYS = ['type', 'interval', 'month', 'dayOfMonth', 'firstDayOfWeek', 'index'];
const RANGE_KEYS = ['type', 'startDate', 'endDate', 'recurrenceTimeZone', 'numberOfOccurrences'];

// Keys whose string values identify somebody or something, wherever they occur in a raw document.
const SENSITIVE_KEYS = new Map([
    ['address', 'e-mail'],
    ['mail', 'e-mail'],
    ['userprincipalname', 'e-mail'],
    ['displayname', 'name'],
    ['givenname', 'name'],
    ['surname', 'name'],
    ['name', 'name'],
    ['id', 'id'],
    ['seriesmasterid', 'id'],
    ['masterid', 'id'],
    ['occurrenceid', 'id'],
    ['icaluid', 'iCalUId'],
    ['@odata.etag', 'etag'],
    ['changekey', 'etag'],
    ['weblink', 'url'],
    ['joinurl', 'url'],
    ['onlinemeetingurl', 'url'],
    ['content', 'body'],
    ['bodypreview', 'body'],
]);

// The only query parameters a committed URL keeps, and what each may contain.
const QUERY_VALUE = {
    startDateTime: /^[0-9T:.+Z-]{10,40}$/,
    endDateTime: /^[0-9T:.+Z-]{10,40}$/,
    $top: /^\d{1,4}$/,
    $select: /^[A-Za-z0-9_,./@$()-]{1,600}$/,
    $orderby: /^[A-Za-z0-9_/, ]{1,100}$/,
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => Object.hasOwn(object, key);
const lower = (value) => String(value).trim().toLowerCase();

function encodeQueryValue(key, value) {
    if (key === 'startDateTime' || key === 'endDateTime') {
        return encodeURIComponent(value);
    }
    return value.replaceAll(' ', '%20');
}

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

// Verbatim scalars are still guarded: a short string without an address or link, or a number, a
// boolean or null. Anything else (an object where a string was expected) is dropped.
function safeScalar(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return [true, value];
    }
    if (typeof value === 'string' && value.length <= SAFE_STRING_MAX && !/@|https?:/i.test(value)) {
        return [true, value];
    }
    return [false];
}

function pickScalars(source, keys, arrayKeys = []) {
    if (!isObject(source)) {
        return null;
    }
    const out = {};
    for (const key of keys) {
        if (has(source, key)) {
            const [ok, value] = safeScalar(source[key]);
            if (ok) {
                out[key] = value;
            }
        }
    }
    for (const key of arrayKeys) {
        if (Array.isArray(source[key])) {
            out[key] = source[key].filter(
                (item) => typeof item === 'string' && safeScalar(item)[0]
            );
        }
    }
    return out;
}

function cleanRecurrence(value) {
    if (value === null) {
        return null;
    }
    if (!isObject(value)) {
        return undefined;
    }
    const out = {};
    const pattern = pickScalars(value.pattern, PATTERN_KEYS, ['daysOfWeek']);
    if (pattern !== null) {
        out.pattern = pattern;
    }
    const range = pickScalars(value.range, RANGE_KEYS);
    if (range !== null) {
        out.range = range;
    }
    return out;
}

const onString = (value, map) => {
    if (typeof value === 'string') {
        return map(value);
    }
    return value === null ? null : undefined;
};

// The scenario part of a subject, or null when the subject carries no tag. Only the tag, the
// allow-listed Exchange prefixes and a short lowercase remark survive.
export function keptSubject(raw) {
    const tag = typeof raw === 'string' ? SCENARIO_TAG.exec(raw) : null;
    if (tag === null) {
        return null;
    }
    const prefixOf = (text) => {
        const match = /^\s*([A-Za-z]+)\s*:\s*/.exec(text);
        const word = match?.[1].toLowerCase();
        const known = SUBJECT_PREFIXES.find((entry) => entry.toLowerCase() === word);
        return known ? { known, length: match[0].length } : null;
    };
    let before = raw.slice(0, tag.index);
    let prefix = '';
    for (let found = prefixOf(before); found !== null; found = prefixOf(before)) {
        prefix += `${found.known}: `;
        before = before.slice(found.length);
    }
    const rest = raw.slice(tag.index + tag[0].length);
    return `${prefix}${tag[0]}${SAFE_SUBJECT_REST.test(rest) ? rest : ''}`;
}

// ---- salt and identity map --------------------------------------------------------------

// Created once, never rotated: a new salt would break every before/after comparison.
export function loadOrCreateSalt(rawDir) {
    const file = path.join(rawDir, 'salt');
    if (existsSync(file)) {
        const text = readFileSync(file, 'utf8').trim();
        if (!/^[0-9a-f]{64}$/.test(text)) {
            throw new Error('raw/salt is not a 32-byte hex value; refusing to replace it');
        }
        return Buffer.from(text, 'hex');
    }
    mkdirSync(rawDir, { recursive: true });
    const salt = randomBytes(32);
    writeFileSync(file, `${salt.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    return salt;
}

const MAP_NAMES = ['people', 'events', 'locations', 'joins'];
const COUNTER_NAMES = ['person', 'event', 'location', 'join'];

function loadIdentityState(file) {
    const state = { counters: {} };
    for (const name of MAP_NAMES) {
        state[name] = new Map();
    }
    for (const name of COUNTER_NAMES) {
        state.counters[name] = 0;
    }
    if (!file || !existsSync(file)) {
        return state;
    }
    let data;
    try {
        data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        throw new Error('the identity map is not valid JSON; refusing to renumber the pseudonyms');
    }
    const valid =
        isObject(data) &&
        isObject(data.counters) &&
        MAP_NAMES.every((name) => isObject(data[name])) &&
        COUNTER_NAMES.every((name) => Number.isInteger(data.counters[name]));
    if (!valid) {
        throw new Error('the identity map has an unexpected shape; refusing to renumber');
    }
    for (const name of MAP_NAMES) {
        for (const [key, value] of Object.entries(data[name])) {
            state[name].set(key, value);
        }
    }
    for (const name of COUNTER_NAMES) {
        state.counters[name] = data.counters[name];
    }
    return state;
}

// ---- sanitizer --------------------------------------------------------------------------

export function createSanitizer({ salt, identityMapPath, loginHint, blockedHint } = {}) {
    if (!Buffer.isBuffer(salt) || salt.length < 16) {
        throw new Error('createSanitizer needs a salt of at least 16 bytes');
    }
    const state = loadIdentityState(identityMapPath);
    const stats = { droppedUntagged: 0 };
    const hints = {
        a: loginHint ? lower(loginHint) : null,
        b: blockedHint ? lower(blockedHint) : null,
    };

    // Counter-mode HMAC: as many keyed bytes as a pseudonym needs, derived only with createHmac.
    const derive = (kind, value, byteCount) => {
        const blocks = [];
        for (let counter = 0, have = 0; have < byteCount; counter += 1) {
            const block = createHmac('sha256', salt)
                .update(`${kind}\0${value}\0${counter}`)
                .digest();
            blocks.push(block);
            have += block.length;
        }
        return Buffer.concat(blocks).subarray(0, byteCount);
    };
    const base64urlOf = (kind, value, length) =>
        derive(kind, value, Math.ceil((length * 3) / 4) + 1)
            .toString('base64url')
            .slice(0, length);
    const hexOf = (kind, value, length) =>
        derive(kind, value, Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);

    // Same length and same trailing '=' padding as the input, so later column-length decisions
    // are made on realistic sizes.
    const fakeToken = (kind, value) => {
        const text = String(value);
        const padding = /=*$/.exec(text)[0].length;
        const bodyLength = Math.max(text.length - padding, 4);
        return `FAKE${base64urlOf(kind, text, bodyLength - 4)}${'='.repeat(padding)}`;
    };
    const fakeEtag = (value) => {
        const wrapped = /^(W\/)?"(.*)"$/.exec(value);
        if (wrapped === null) {
            return fakeToken('etag', value);
        }
        return `${wrapped[1] ?? ''}"${fakeToken('etag', wrapped[2])}"`;
    };
    const fakeIcal = (value) => {
        const text = String(value);
        const keep = text.startsWith(ICAL_PREFIX) ? ICAL_PREFIX : '';
        return keep + hexOf('ical', text, text.length - keep.length).toUpperCase();
    };
    const fakeGuid = (value) => `${FAKE_GUID_PREFIX}${hexOf('guid', lower(value), 12)}`;

    const numberFor = (collection, counter, raw) => {
        if (!state[collection].has(raw)) {
            state.counters[counter] += 1;
            state[collection].set(raw, state.counters[counter]);
        }
        return state[collection].get(raw);
    };

    // People: test user A and B are fixed, everybody else is numbered in first-seen order.
    const personKey = (address, name) => {
        if (typeof address === 'string' && address.trim() !== '') {
            return lower(address);
        }
        if (typeof name === 'string' && name.trim() !== '') {
            return `name:${lower(name)}`;
        }
        return 'unknown';
    };
    const peekPerson = (key) => {
        if (key === hints.a) {
            return 'a';
        }
        if (key === hints.b) {
            return 'b';
        }
        return state.people.get(key);
    };
    const personFor = (address, name) => {
        const key = personKey(address, name);
        if (peekPerson(key) === undefined) {
            state.counters.person += 1;
            state.people.set(key, state.counters.person);
        }
        return peekPerson(key);
    };
    const personLabel = (person) => {
        if (person === 'a' || person === 'b') {
            const letter = person.toUpperCase();
            return { name: `Test User ${letter}`, address: `person-${person}@example.test` };
        }
        return { name: `Test Person ${person}`, address: `person-${person}@example.test` };
    };
    const personOut = (emailAddress) => {
        const source = isObject(emailAddress) ? emailAddress : {};
        const label = personLabel(personFor(source.address, source.name));
        return { name: label.name, address: label.address };
    };

    const subjectOut = (raw) => keptSubject(raw) ?? `Event ${numberFor('events', 'event', raw)}`;
    const locationOut = (name) => {
        if (typeof name !== 'string' || name.trim() === '') {
            return null;
        }
        return `Location ${numberFor('locations', 'location', name.trim())}`;
    };
    const joinUrlOut = (raw) =>
        `https://teams.example.test/l/meetup-join/${numberFor('joins', 'join', raw)}`;
    const occurrenceIdOut = (raw) => {
        const match = OCCURRENCE_ID.exec(raw);
        return match ? `OID.${fakeToken('id', match[1])}.${match[2]}` : undefined;
    };
    const occurrenceIdsOut = (list) => {
        if (!Array.isArray(list)) {
            return undefined;
        }
        const mapped = list.filter((item) => typeof item === 'string').map(occurrenceIdOut);
        return mapped.filter((item) => item !== undefined);
    };
    const webLinkOut = (raw, link) => {
        let fakeId = fakeToken('link', link);
        if (typeof raw.id === 'string') {
            fakeId = fakeToken('id', raw.id);
        }
        return `https://outlook.example.test/calendar/item/${fakeId}`;
    };

    const nullOrUndefined = (value) => (value === null ? null : undefined);
    const objectOr = (value, map) => (isObject(value) ? map(value) : nullOrUndefined(value));
    const objectsOnly = (list, map) =>
        Array.isArray(list) ? list.filter(isObject).map((item) => map(item)) : undefined;
    const asPerson = (value) => (isObject(value) ? personOut(value) : null);
    const organizerOut = (organizer) => ({ emailAddress: asPerson(organizer.emailAddress) });
    const placeOut = (place) => ({ displayName: locationOut(place.displayName) });
    const meetingOut = (meeting) => ({ joinUrl: onString(meeting.joinUrl, joinUrlOut) ?? null });
    const attendeeOut = (attendee) => {
        const out = {};
        if (has(attendee, 'type')) {
            const [ok, value] = safeScalar(attendee.type);
            if (ok) {
                out.type = value;
            }
        }
        const status = pickScalars(attendee.status, ['response', 'time']);
        if (status !== null) {
            out.status = status;
        }
        out.emailAddress = asPerson(attendee.emailAddress);
        return out;
    };

    function eventField(key, raw) {
        const value = raw[key];
        switch (key) {
            case '@odata.etag':
                return onString(value, fakeEtag);
            case 'id':
            case 'seriesMasterId':
                return onString(value, (text) => fakeToken('id', text));
            case 'changeKey':
                return onString(value, (text) => fakeToken('etag', text));
            case 'iCalUId':
                return onString(value, fakeIcal);
            case 'subject':
                return onString(value, subjectOut);
            case 'occurrenceId':
                return onString(value, occurrenceIdOut);
            case 'start':
            case 'end':
            case 'originalStart':
                if (isObject(value)) {
                    return pickScalars(value, ['dateTime', 'timeZone']);
                }
                return safeScalar(value)[0] ? value : undefined;
            case 'responseStatus':
                return objectOr(value, (status) => pickScalars(status, ['response', 'time']));
            case 'recurrence':
                return cleanRecurrence(value);
            case 'cancelledOccurrences':
                return occurrenceIdsOut(value);
            case 'organizer':
                return objectOr(value, organizerOut);
            case 'attendees':
                return objectsOnly(value, attendeeOut);
            case 'location':
                return objectOr(value, placeOut);
            case 'locations':
                return objectsOnly(value, placeOut);
            case 'onlineMeeting':
                return objectOr(value, meetingOut);
            case 'onlineMeetingUrl':
                return onString(value, joinUrlOut);
            case 'webLink':
                return onString(value, (link) => webLinkOut(raw, link));
            default:
                return safeScalar(value)[0] ? value : undefined;
        }
    }

    function event(raw) {
        if (!isObject(raw)) {
            return null;
        }
        const out = {};
        for (const key of EVENT_FIELD_ORDER) {
            if (has(raw, key)) {
                const value = eventField(key, raw);
                if (value !== undefined) {
                    out[key] = value;
                }
            }
        }
        return out;
    }

    // Path ids, GUIDs and unknown segments are replaced; the query keeps only the window, $top,
    // $select, $orderby and a page token that is rewritten to SANITIZED-PAGE-<n>. The origin is
    // always Graph's: this harness only ever talks to it, and a fake host must not leak into a
    // committed fixture.
    function rewriteUrl(rawUrl, pageNo, addToken) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            return null;
        }
        const token = `${PAGE_TOKEN_PREFIX}${pageNo}`;
        let previous = '';
        const segments = url.pathname
            .split('/')
            .filter((segment) => segment !== '')
            .map((segment) => {
                const decoded = safeDecode(segment);
                const before = previous;
                previous = decoded.toLowerCase();
                if (before === 'events') {
                    return encodeURIComponent(fakeToken('id', decoded));
                }
                if (GUID.test(decoded)) {
                    return fakeGuid(decoded);
                }
                return /^[A-Za-z0-9_.$()-]{1,40}$/.test(decoded)
                    ? segment
                    : encodeURIComponent(fakeToken('segment', decoded));
            });
        const query = [];
        let tokenSeen = false;
        for (const [key, value] of url.searchParams) {
            if (key === '$skiptoken' || key === '$skip') {
                query.push(`${key}=${token}`);
                tokenSeen = true;
            } else if (has(QUERY_VALUE, key) && QUERY_VALUE[key].test(value)) {
                query.push(`${key}=${encodeQueryValue(key, value)}`);
            }
        }
        if (!tokenSeen && addToken) {
            query.push(`$skiptoken=${token}`);
        }
        const search = query.length > 0 ? `?${query.join('&')}` : '';
        return `${GRAPH_ORIGIN}/${segments.join('/')}${search}`;
    }

    function context(value) {
        const marker = typeof value === 'string' ? value.indexOf('$metadata#') : -1;
        if (marker < 0) {
            return null;
        }
        const pattern = new RegExp(
            `users\\('([^']*)'\\)|events\\('([^']*)'\\)|${GUID_ANYWHERE.source}`,
            'gi'
        );
        const fragment = value
            .slice(marker + '$metadata#'.length)
            .replace(pattern, (whole, user, eventId) => {
                if (user !== undefined) {
                    return `users('${fakeGuid(user)}')`;
                }
                return eventId !== undefined
                    ? `events('${fakeToken('id', eventId)}')`
                    : fakeGuid(whole);
            });
        return /^[A-Za-z0-9_.,()/$@'=%-]*$/.test(fragment)
            ? `${GRAPH_ORIGIN}/v1.0/$metadata#${fragment}`
            : null;
    }

    // Keeps only events with a scenario tag. `pageNo` is this page's 1-based number, so its next
    // link leads to page pageNo + 1.
    function page(body, pageNo = 1) {
        const out = {};
        if (!isObject(body)) {
            return { value: [] };
        }
        const contextOut = context(body['@odata.context']);
        if (contextOut !== null) {
            out['@odata.context'] = contextOut;
        }
        if (typeof body['@odata.nextLink'] === 'string') {
            const next = rewriteUrl(body['@odata.nextLink'], pageNo + 1, true);
            if (next !== null) {
                out['@odata.nextLink'] = next;
            }
        }
        out.value = [];
        for (const entry of Array.isArray(body.value) ? body.value : []) {
            if (!isObject(entry)) {
                continue;
            }
            if (scenarioIdOf(entry.subject) === null) {
                stats.droppedUntagged += 1;
            } else {
                out.value.push(event(entry));
            }
        }
        return out;
    }

    function me(raw) {
        if (!isObject(raw)) {
            return null;
        }
        const addresses = [raw.mail, raw.userPrincipalName].filter(
            (address) => typeof address === 'string' && address.trim() !== ''
        );
        const known = addresses.map((address) => peekPerson(personKey(address))).find(Boolean);
        const person = known ?? personFor(addresses[0], raw.displayName);
        for (const address of addresses) {
            state.people.set(personKey(address), person);
        }
        const label = personLabel(person);
        const out = {};
        if (typeof raw.id === 'string') {
            out.id = fakeGuid(raw.id);
        }
        const names = {
            displayName: label.name,
            givenName: 'Test',
            surname: label.name.slice('Test '.length),
            mail: label.address,
            userPrincipalName: label.address,
        };
        for (const [key, value] of Object.entries(names)) {
            if (has(raw, key)) {
                out[key] = value;
            }
        }
        for (const key of ['userType', 'preferredLanguage']) {
            if (has(raw, key) && safeScalar(raw[key])[0]) {
                out[key] = raw[key];
            }
        }
        return out;
    }

    function errorBody(raw) {
        const code = raw?.error?.code;
        const valid = typeof code === 'string' && ERROR_CODE.test(code);
        return { error: { code: valid ? code : 'unknown_error' } };
    }

    function persistIdentityMap() {
        if (!identityMapPath) {
            return;
        }
        const data = { counters: state.counters };
        for (const name of MAP_NAMES) {
            data[name] = Object.fromEntries(state[name]);
        }
        mkdirSync(path.dirname(identityMapPath), { recursive: true });
        writeFileSync(identityMapPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    }

    return {
        event,
        page,
        me,
        context,
        errorBody,
        nextLink: (url, pageNo) => rewriteUrl(url, pageNo, true),
        requestUrl: (url, pageNo) => rewriteUrl(url, pageNo, false),
        guid: fakeGuid,
        id: (value) => fakeToken('id', value),
        subject: subjectOut,
        persistIdentityMap,
        stats,
    };
}

// ---- leak guard -------------------------------------------------------------------------

const isEventLike = (node) =>
    typeof node.id === 'string' && ('start' in node || 'subject' in node || 'iCalUId' in node);

// Every value in the raw documents that must not appear in any committed file. The returned Set
// also carries `kinds` (value -> what kind of field it came from), so a report can name the kind
// without printing the value.
export function buildLeakSet(rawDocs) {
    const leakSet = new Set();
    leakSet.kinds = new Map();
    const addForms = (value, kind) => {
        for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
            if (!leakSet.has(form)) {
                leakSet.add(form);
                leakSet.kinds.set(form, kind);
            }
        }
    };
    const add = (value, kind) => {
        const skip =
            typeof value !== 'string' ||
            value.length < MIN_LEAK_LENGTH ||
            PSEUDONYM_LITERAL.test(value) ||
            /@example\.test$/i.test(value);
        if (skip) {
            return;
        }
        addForms(value, kind);
        if (kind === 'id') {
            addForms(encodeURIComponent(value), kind);
        }
    };
    const addPageTokens = (link) => {
        try {
            const url = new URL(link);
            for (const key of ['$skiptoken', '$skip']) {
                add(url.searchParams.get(key), 'page token');
            }
        } catch {
            // an unparseable link carries nothing to look for
        }
    };
    const collectDropped = (node, key) => {
        if (Array.isArray(node)) {
            node.forEach((item) => collectDropped(item, key));
        } else if (isObject(node)) {
            Object.values(node).forEach((item) => collectDropped(item, key));
        } else {
            add(node, `dropped field (${key})`);
        }
    };
    const walk = (node, key) => {
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item, key));
            return;
        }
        if (isObject(node)) {
            if (isEventLike(node)) {
                for (const [field, value] of Object.entries(node)) {
                    if (!EVENT_KEYS.has(field)) {
                        collectDropped(value, field);
                    }
                }
            }
            for (const [childKey, child] of Object.entries(node)) {
                walk(child, childKey);
            }
            return;
        }
        if (typeof node !== 'string') {
            return;
        }
        const kind = SENSITIVE_KEYS.get(key.toLowerCase());
        if (kind) {
            add(node, kind);
        }
        if (key === 'subject' && keptSubject(node) !== node) {
            add(node, 'subject');
        }
        if (key === '@odata.nextLink') {
            addPageTokens(node);
        }
        if (key === 'cancelledOccurrences' || key === 'occurrenceId') {
            add(OCCURRENCE_ID.exec(node)?.[1], 'id');
        }
        for (const match of node.matchAll(EMAIL_ANYWHERE)) {
            add(match[0], 'e-mail');
        }
        for (const match of node.matchAll(GUID_ANYWHERE)) {
            if (!match[0].toLowerCase().startsWith(FAKE_GUID_PREFIX)) {
                add(match[0], 'guid');
            }
        }
    };
    for (const doc of rawDocs) {
        walk(doc, '');
    }
    return leakSet;
}

// A plain substring scan (case-insensitive for e-mails). Returns the leaked values, so a caller
// that reports must look up `leakSet.kinds` and never print the value itself.
export function findLeaks(text, leakSet) {
    const haystack = String(text);
    const lowered = haystack.toLowerCase();
    const hits = [];
    for (const value of leakSet) {
        const found =
            leakSet.kinds?.get(value) === 'e-mail'
                ? lowered.includes(value.toLowerCase())
                : haystack.includes(value);
        if (found) {
            hits.push(value);
        }
    }
    return hits;
}
