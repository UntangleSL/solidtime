// Scenario tags, extraction and the fixture manifest for the Outlook spike.
// Zero dependencies (node: built-ins only).
//
// The manifest is the index of every committed fixture: the orphan check and both replay tests take
// their file lists from `files` (page lists in page order), never from a directory listing.
export const REQUIRED_SCENARIOS = [
    'S1',
    'S1b',
    'S2',
    'S3',
    'S4',
    'S5',
    'S5b',
    'S6',
    'S6b',
    'S7',
    'S8',
];
export const OPTIONAL_SCENARIOS = ['S7b', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

// Every test event carries "[M365-TEST <ID>]" in its subject (Exchange may prepend a prefix such
// as "Canceled:", so the tag is searched, not anchored). It is the only thing that lets an event
// reach a committed fixture: an event without the tag is never written, not even pseudonymized.
export const SCENARIO_TAG = /\[M365-TEST (S\d+[a-z]?|E\d+)\]/;

export function scenarioIdOf(subject) {
    if (typeof subject !== 'string') {
        return null;
    }
    const match = SCENARIO_TAG.exec(subject);
    return match ? match[1] : null;
}

export const PASS_ORDER = [
    'prod-select',
    'prefer-separate',
    'page2-no-prefer',
    'no-immutableid',
    'experiment-select',
    'full-shape',
];
export const OUTPUT_DIRS = ['calendarview', 'scenarios', 'series', 'lookups'];
export const OUTPUT_FILES = ['manifest.json', 'me.json', 'token-response.shape.json'];
export const EXPERIMENT_KEYS = [
    'prefer_combined',
    'prefer_separate',
    'page2_without_prefer',
    'id_format',
    'select_prod',
    'select_experiment',
    'full_shape_properties',
    'series_master',
    'round_b_lookups',
];
export const SYNTHETIC_SCENARIOS = [
    { id: 'SYN-confidential', sensitivity: 'confidential' },
    { id: 'SYN-personal', sensitivity: 'personal' },
];

const PREFER_MODES = ['combined', 'separate', 'tz-only', 'none'];
const HEADER_NAME = /^[A-Za-z-]{1,40}$/;
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,80}$/;
const PROPERTY_NAME = /^[A-Za-z@][A-Za-z0-9_.@#-]{0,79}$/;
const SAFE_ZONE = /^[A-Za-z0-9 ._()+,/-]{1,64}$/;
const SAFE_WORD = /^[A-Za-z]{1,40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isKnownScenario = (id) => REQUIRED_SCENARIOS.includes(id) || OPTIONAL_SCENARIOS.includes(id);
const isoOrNull = (value) => (typeof value === 'string' && ISO_INSTANT.test(value) ? value : null);
const codeOrNull = (value) => (typeof value === 'string' && ERROR_CODE.test(value) ? value : null);

// How many event objects in a document have no scenario tag. Events sit in `value` arrays (pages,
// scenario and series files) or are single objects with a subject (series masters). Lookup bodies
// are single objects without a subject and are matched to a scenario by their Round A id instead.
export function findUntaggedEvents(node) {
    let count = 0;
    const walk = (value, isEventSlot) => {
        if (Array.isArray(value)) {
            value.forEach((item) => walk(item, isEventSlot));
            return;
        }
        if (!isObject(value)) {
            return;
        }
        if ('subject' in value) {
            count += scenarioIdOf(value.subject) === null ? 1 : 0;
        } else if (isEventSlot) {
            count += 1;
        }
        for (const [key, child] of Object.entries(value)) {
            walk(child, key === 'value');
        }
    };
    walk(node, false);
    return count;
}

// ---- file names -------------------------------------------------------------------------

export const pagePath = (round, pass, n) => `calendarview/round${round}.${pass}.page-${n}.json`;
export const requestsPath = (round, pass) => `calendarview/round${round}.${pass}.requests.json`;
export const idFormatPath = (round) => `calendarview/round${round}.id-format.json`;
export const scenarioPath = (sid, round) => `scenarios/${sid}.round${round}.json`;
export const seriesMasterPath = (sid, round) => `series/${sid}.master.round${round}.json`;
export const seriesInstancesPath = (sid, round) => `series/${sid}.instances.round${round}.json`;
export const lookupPath = (sid) => `lookups/${sid}.roundB.json`;

// ---- raw document helpers ---------------------------------------------------------------

const passPages = (doc) => (Array.isArray(doc?.pages) ? doc.pages : []);
const statusOf = (page) => (Number.isInteger(page?.request?.status) ? page.request.status : null);
const eventsOf = (pages) =>
    pages.flatMap((page) => (Array.isArray(page?.body?.value) ? page.body.value : []));
const rawEvents = (doc) => eventsOf(passPages(doc)).filter(isObject);
const isTagged = (event) => scenarioIdOf(event.subject) !== null;
const taggedEvents = (doc) => rawEvents(doc).filter(isTagged);
const knownScenarioOf = (event) => {
    const sid = scenarioIdOf(event.subject);
    return isKnownScenario(sid) ? sid : null;
};
const distinctStrings = (events, key) => [
    ...new Set(events.map((event) => event[key]).filter((value) => typeof value === 'string')),
];
const overallStatus = (statuses) =>
    statuses.find((status) => status !== 200) ?? statuses[0] ?? null;

function groupBy(items, keyOf) {
    const groups = {};
    for (const item of items) {
        const key = keyOf(item);
        if (key !== null && key !== undefined) {
            groups[key] ??= [];
            groups[key].push(item);
        }
    }
    return groups;
}

const unique = (values) => [...new Set(values)];

// ---- experiment summaries (computed on real values, emitted as non-identifying facts) ----

function utcOnAllPages(events) {
    const zones = events.flatMap((event) => [event.start?.timeZone, event.end?.timeZone]);
    const present = zones.filter((zone) => zone !== undefined);
    if (present.length === 0) {
        return null;
    }
    return present.every((zone) => typeof zone === 'string' && zone.toUpperCase() === 'UTC');
}

function preferFact(doc) {
    if (!doc) {
        return null;
    }
    const statuses = passPages(doc).map(statusOf);
    return { status: overallStatus(statuses), utc_on_all_pages: utcOnAllPages(rawEvents(doc)) };
}

// Pairs of events that sit at the same position in two passes over the same window and are
// confirmed to be the same event by their iCalUId.
function alignedPairs(first, second) {
    const pairs = [];
    first.forEach((event, index) => {
        const other = second[index];
        const same = other && typeof event.iCalUId === 'string' && event.iCalUId === other.iCalUId;
        if (same) {
            pairs.push([event, other]);
        }
    });
    return pairs;
}

function equalCounts(pairs) {
    const equal = pairs.filter(([first, second]) => first.id === second.id).length;
    return { equal, different: pairs.length - equal };
}

function page2Fact(doc, combinedDoc) {
    const pages = passPages(doc);
    if (pages.length < 2) {
        return null;
    }
    const events = eventsOf([pages[1]]).filter(isObject);
    const zones = events.flatMap((event) => [event.start?.timeZone, event.end?.timeZone]);
    const known = unique(zones).filter((zone) => typeof zone === 'string' && SAFE_ZONE.test(zone));
    const combined = eventsOf(passPages(combinedDoc).slice(1, 2)).filter(isObject);
    return {
        status: statusOf(pages[1]),
        page2_timezones: known.sort(),
        page2_ids_equal_to_combined: equalCounts(alignedPairs(combined, events)),
    };
}

function charsetOf(ids) {
    const chars = [...new Set(ids.join(''))];
    const parts = [];
    if (chars.some((char) => /[A-Z]/.test(char))) {
        parts.push('A-Z');
    }
    if (chars.some((char) => /[a-z]/.test(char))) {
        parts.push('a-z');
    }
    if (chars.some((char) => /[0-9]/.test(char))) {
        parts.push('0-9');
    }
    const symbols = chars.filter((char) => /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(char));
    parts.push(symbols.sort().join(''));
    if (chars.some((char) => !/[\x21-\x7e]/.test(char))) {
        parts.push('other');
    }
    return parts.join('');
}

function idShape(events) {
    const ids = events.map((event) => event.id).filter((id) => typeof id === 'string');
    if (ids.length === 0) {
        return { min_length: null, max_length: null, charset: null };
    }
    const lengths = ids.map((id) => id.length);
    return {
        min_length: Math.min(...lengths),
        max_length: Math.max(...lengths),
        charset: charsetOf(ids),
    };
}

function idFormatDocument(round, immutableDoc, defaultDoc) {
    // Shapes and counts come from tagged events only, so the committed numbers describe committed
    // events and say nothing about how many other meetings the capture mailbox holds.
    const immutable = taggedEvents(immutableDoc);
    const plain = taggedEvents(defaultDoc);
    const both = Boolean(immutableDoc) && Boolean(defaultDoc);
    const aligned = alignedPairs(rawEvents(immutableDoc), rawEvents(defaultDoc));
    const counts = both ? equalCounts(aligned.filter(([event]) => isTagged(event))) : null;
    return {
        round,
        immutable: idShape(immutable),
        default: idShape(plain),
        same_value_count: counts ? counts.equal : null,
        different_value_count: counts ? counts.different : null,
    };
}

function selectFact(doc) {
    if (!doc) {
        return null;
    }
    const pages = passPages(doc);
    const events = rawEvents(doc);
    const failed = pages.find((page) => !isObject(page.body));
    const has = (key) => (events.length === 0 ? null : events.some((event) => key in event));
    return {
        status: overallStatus(pages.map(statusOf)),
        error_code: codeOrNull(failed?.errorCode),
        lastModifiedDateTime_returned: has('lastModifiedDateTime'),
        attendees_returned: has('attendees'),
    };
}

function propertyNames(doc) {
    if (!doc) {
        return null;
    }
    const names = taggedEvents(doc).flatMap((event) => Object.keys(event));
    return unique(names).filter((name) => PROPERTY_NAME.test(name)).sort();
}

function mostFrequentZone(doc) {
    const counts = new Map();
    for (const event of taggedEvents(doc)) {
        const zone = event.originalStartTimeZone;
        if (typeof zone === 'string' && SAFE_ZONE.test(zone)) {
            counts.set(zone, (counts.get(zone) ?? 0) + 1);
        }
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return ranked.length > 0 ? ranked[0][0] : 'unknown';
}

function seriesMasterFact(entries) {
    if (entries.length === 0) {
        return null;
    }
    const bodies = entries.map((entry) => entry.body).filter(isObject);
    const cancelled = bodies.some(
        (body) => Array.isArray(body.cancelledOccurrences) && body.cancelledOccurrences.length > 0
    );
    return {
        status: overallStatus(entries.map(statusOf)),
        cancelledOccurrences_present: cancelled,
        recurrence_present: bodies.some((body) => isObject(body.recurrence)),
    };
}

function statusHistogram(lookups) {
    if (lookups.length === 0) {
        return null;
    }
    const histogram = {};
    for (const lookup of lookups) {
        histogram[lookup.status] = (histogram[lookup.status] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(histogram).sort());
}

// ---- one round: raw documents -> sanitized data -----------------------------------------

function sanitizePass(doc, sanitizer) {
    const rawPages = passPages(doc);
    const pages = [];
    const requests = [];
    rawPages.forEach((rawPage, index) => {
        const page = index + 1;
        const request = isObject(rawPage.request) ? rawPage.request : {};
        const headerNames = Array.isArray(request.headerNames) ? request.headerNames : [];
        requests.push({
            page,
            url: typeof request.url === 'string' ? sanitizer.requestUrl(request.url, page) : null,
            headerNames: headerNames.filter((name) => HEADER_NAME.test(name)),
            preferMode: PREFER_MODES.includes(request.preferMode) ? request.preferMode : null,
            status: statusOf(rawPage),
            errorCode: codeOrNull(rawPage.errorCode),
        });
        if (isObject(rawPage.body)) {
            pages.push({ n: page, body: sanitizer.page(rawPage.body, page) });
        }
    });
    const last = rawPages.at(-1);
    const allOk = rawPages.every((page) => statusOf(page) === 200 && isObject(page.body));
    const complete = rawPages.length > 0 && allOk && !last.body['@odata.nextLink'];
    return { pages, requests, complete };
}

const isKeyName = (key) => typeof key === 'string' && /^[A-Za-z_]{1,40}$/.test(key);

function cleanTokenShape(raw) {
    if (!isObject(raw)) {
        return null;
    }
    const out = {};
    if (Array.isArray(raw.keys)) {
        out.keys = raw.keys.filter(isKeyName);
    }
    if (typeof raw.tokenType === 'string' && SAFE_WORD.test(raw.tokenType)) {
        out.tokenType = raw.tokenType;
    }
    if (typeof raw.scope === 'string' && /^[A-Za-z0-9_. ]{1,300}$/.test(raw.scope)) {
        out.scope = raw.scope;
    }
    if (Number.isInteger(raw.expiresIn)) {
        out.expiresIn = raw.expiresIn;
    }
    for (const key of ['refreshTokenIssued', 'idTokenIssued']) {
        if (typeof raw[key] === 'boolean') {
            out[key] = raw[key];
        }
    }
    return out;
}

// Series masters and instances are kept only for series that a tagged event belongs to, and a
// master or occurrence without a scenario tag is dropped like any other untagged event.
function sanitizeSeries(rawSeries, masterIdsBySid, sanitizer) {
    const rawMasters = Array.isArray(rawSeries?.masters) ? rawSeries.masters : [];
    const rawInstances = Array.isArray(rawSeries?.instances) ? rawSeries.instances : [];
    const series = {};
    const kept = [];
    for (const [sid, masterIds] of Object.entries(masterIdsBySid)) {
        const masters = [];
        const instancePages = [];
        for (const masterId of masterIds) {
            const entry = rawMasters.find((candidate) => candidate.masterId === masterId);
            if (isObject(entry?.body)) {
                if (scenarioIdOf(entry.body.subject) === null) {
                    sanitizer.stats.droppedUntagged += 1;
                } else {
                    masters.push(sanitizer.event(entry.body));
                    kept.push(entry);
                }
            }
            const instances = rawInstances.find((candidate) => candidate.masterId === masterId);
            passPages(instances).forEach((rawPage, index) => {
                if (isObject(rawPage.body)) {
                    instancePages.push(sanitizer.page(rawPage.body, index + 1));
                }
            });
        }
        if (masters.length > 0 || instancePages.length > 0) {
            series[sid] = { masters, instancePages };
        }
    }
    return { series, fact: seriesMasterFact(kept) };
}

function sanitizeLookups(rawLookups, lookupIds, sanitizer) {
    const entries = new Map();
    for (const entry of Array.isArray(rawLookups?.lookups) ? rawLookups.lookups : []) {
        entries.set(entry.id, entry);
    }
    const lookups = {};
    for (const [sid, ids] of Object.entries(lookupIds ?? {})) {
        const list = [];
        for (const id of ids) {
            const entry = entries.get(id);
            if (entry) {
                list.push({
                    status: Number.isInteger(entry.request?.status) ? entry.request.status : null,
                    errorCode: codeOrNull(entry.errorCode),
                    body: isObject(entry.body) ? sanitizer.event(entry.body) : null,
                });
            }
        }
        if (list.length > 0) {
            lookups[sid] = list;
        }
    }
    return lookups;
}

// `raw` holds one round's raw documents: { meta, me, tokenShape, passes: { <name>: doc }, series,
// lookups }. `lookupIds` (Round B only) maps each scenario to the Round A ids to look up.
export function extractRound({ round, raw, sanitizer, lookupIds }) {
    const doc = (name) => raw.passes?.[name];
    const passes = {};
    for (const name of PASS_ORDER) {
        if (doc(name)) {
            passes[name] = sanitizePass(doc(name), sanitizer);
        }
    }
    const sourcePass = passes['full-shape']?.complete ? 'full-shape' : 'prod-select';

    const events = {};
    for (const event of rawEvents(doc(sourcePass))) {
        const sid = knownScenarioOf(event);
        if (sid !== null) {
            events[sid] ??= [];
            events[sid].push(sanitizer.event(event));
        }
    }
    const ownLookupIds = {};
    const masterIdsBySid = {};
    const bySid = groupBy(rawEvents(doc('prod-select') ?? doc(sourcePass)), knownScenarioOf);
    for (const [sid, list] of Object.entries(bySid)) {
        ownLookupIds[sid] = distinctStrings(list, 'id');
        const masterIds = distinctStrings(list, 'seriesMasterId');
        if (masterIds.length > 0) {
            masterIdsBySid[sid] = masterIds;
        }
    }
    const { series, fact: seriesFact } = sanitizeSeries(raw.series, masterIdsBySid, sanitizer);
    const lookups = round === 'B' ? sanitizeLookups(raw.lookups, lookupIds, sanitizer) : {};

    return {
        round,
        meta: {
            capturedAt: isoOrNull(raw.meta?.capturedAt),
            window: {
                start: isoOrNull(raw.meta?.window?.start),
                end: isoOrNull(raw.meta?.window?.end),
            },
        },
        me: raw.me ? sanitizer.me(raw.me) : null,
        tokenShape: cleanTokenShape(raw.tokenShape),
        passes,
        sourcePass: doc(sourcePass) ? sourcePass : null,
        events,
        lookupIds: ownLookupIds,
        series,
        lookups,
        idFormat: idFormatDocument(round, doc('prod-select'), doc('no-immutableid')),
        mailboxTimezone: mostFrequentZone(doc('full-shape')),
        facts: {
            prefer_combined: preferFact(doc('prod-select')),
            prefer_separate: preferFact(doc('prefer-separate')),
            page2_without_prefer: page2Fact(doc('page2-no-prefer'), doc('prod-select')),
            select_prod: selectFact(doc('prod-select')),
            select_experiment: selectFact(doc('experiment-select')),
            full_shape_properties: propertyNames(doc('full-shape')),
            series_master: seriesFact,
            round_b_lookups: statusHistogram(Object.values(lookups).flat()),
        },
    };
}

// ---- layout: sanitized rounds -> files, index and manifest ------------------------------

const ROUND_NAMES = ['A', 'B'];

// Everything that will be written, as relative path -> JSON value (manifest.json excluded), plus
// the `files` index of the manifest and the scenario file lists.
export function buildOutputs(rounds) {
    const written = new Map();
    const files = { calendarview: {}, id_format: {}, series: {}, lookups: {} };
    const scenarioFiles = {};
    const addScenarioFile = (sid, round, file) => {
        scenarioFiles[sid] ??= {};
        scenarioFiles[sid][`round_${round.toLowerCase()}`] = [file];
    };

    const first = rounds.A ?? rounds.B;
    if (first?.me) {
        written.set('me.json', first.me);
        files.me = 'me.json';
    }
    if (first?.tokenShape) {
        written.set('token-response.shape.json', first.tokenShape);
        files.token_shape = 'token-response.shape.json';
    }
    for (const round of ROUND_NAMES.filter((name) => rounds[name])) {
        const data = rounds[round];
        files.calendarview[round] = {};
        for (const [pass, result] of Object.entries(data.passes)) {
            const pagePaths = result.pages.map((page) => pagePath(round, pass, page.n));
            result.pages.forEach((page, index) => written.set(pagePaths[index], page.body));
            written.set(requestsPath(round, pass), result.requests);
            files.calendarview[round][pass] = {
                pages: pagePaths,
                requests: requestsPath(round, pass),
                complete: result.complete,
            };
        }
        written.set(idFormatPath(round), data.idFormat);
        files.id_format[round] = idFormatPath(round);
        for (const [sid, list] of Object.entries(data.events)) {
            const file = scenarioPath(sid, round);
            const document = { scenario: sid, round, source_pass: data.sourcePass, value: list };
            written.set(file, document);
            addScenarioFile(sid, round, file);
        }
        for (const [sid, entry] of Object.entries(data.series)) {
            files.series[round] ??= {};
            files.series[round][sid] = {};
            if (entry.masters.length > 0) {
                const file = seriesMasterPath(sid, round);
                written.set(file, { scenario: sid, round, value: entry.masters });
                files.series[round][sid].master = file;
            }
            if (entry.instancePages.length > 0) {
                const file = seriesInstancesPath(sid, round);
                written.set(file, { scenario: sid, round, pages: entry.instancePages });
                files.series[round][sid].instances = file;
            }
        }
        for (const [sid, list] of Object.entries(data.lookups)) {
            files.lookups[round] ??= {};
            files.lookups[round][sid] = lookupPath(sid);
            written.set(lookupPath(sid), list);
        }
    }

    // Confidential and personal sensitivity cannot be created from the Outlook UI: derived copies
    // of S6 round A, marked synthetic everywhere.
    const synthetic = [];
    const sixA = rounds.A?.events.S6;
    if (sixA) {
        for (const { id, sensitivity } of SYNTHETIC_SCENARIOS) {
            const file = `scenarios/${id}.json`;
            const value = sixA.map((event) => ({ ...event, sensitivity }));
            const sourcePass = rounds.A.sourcePass;
            const document = { scenario: id, round: 'A', source_pass: sourcePass, synthetic: true };
            written.set(file, { ...document, derived_from: 'S6', value });
            synthetic.push({ id, sensitivity, file, count: value.length });
        }
    }
    for (const key of ['series', 'lookups']) {
        if (Object.keys(files[key]).length === 0) {
            delete files[key];
        }
    }
    return { written, files, scenarioFiles, synthetic };
}

const word = (value) => (typeof value === 'string' && SAFE_WORD.test(value) ? value : '?');

function describeEvent(event, count) {
    const parts = [];
    if (count > 1) {
        parts.push(`${count} events, first: `);
    }
    const facts = [];
    if (event.type !== undefined) {
        facts.push(`type=${word(event.type)}`);
    }
    if (typeof event.isOrganizer === 'boolean') {
        facts.push(`isOrganizer=${event.isOrganizer}`);
    }
    if (event.responseStatus?.response !== undefined) {
        facts.push(`responseStatus=${word(event.responseStatus.response)}`);
    }
    if (event.isCancelled === true) {
        facts.push('isCancelled=true');
    }
    if (event.isAllDay === true) {
        facts.push('isAllDay=true');
    }
    if (event.sensitivity !== undefined) {
        facts.push(`sensitivity=${word(event.sensitivity)}`);
    }
    return `${parts.join('')}${facts.join(', ')}`;
}

function describeLookup(lookup) {
    if (!lookup) {
        return 'no direct lookup recorded';
    }
    let detail = '';
    if (lookup.errorCode) {
        detail = ` (${lookup.errorCode})`;
    } else if (typeof lookup.isCancelled === 'boolean') {
        detail = ` (isCancelled=${lookup.isCancelled})`;
    }
    return `direct lookup ${lookup.status}${detail}`;
}

// One deterministic English sentence generated from the data only: never a hypothesis.
function observedSentence({ eventsA, eventsB, hasB, lookup }) {
    const present = (events) => Array.isArray(events) && events.length > 0;
    const round = (label, events) =>
        present(events)
            ? `${label}: present (${describeEvent(events[0], events.length)})`
            : `${label}: absent from calendarView`;
    const a = `${round('Round A', eventsA)}.`;
    if (!hasB) {
        return `${a} Round B: not captured.`;
    }
    return `${a} ${round('Round B', eventsB)}; ${describeLookup(lookup)}.`;
}

const outlookClient = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9 ._-]{1,40}$/.test(value) ? value : 'unknown';

export function buildManifest({ rounds, env = {}, outputs }) {
    const hasB = Boolean(rounds.B);
    const captured = {};
    for (const round of ROUND_NAMES.filter((name) => rounds[name])) {
        captured[round] = rounds[round].meta.capturedAt;
    }
    const first = rounds.A ?? rounds.B;
    const idsOf = (events) => (events ?? []).map((event) => event.id);

    const listed = [...REQUIRED_SCENARIOS];
    for (const sid of OPTIONAL_SCENARIOS) {
        if (rounds.A?.events[sid] || rounds.B?.events[sid]) {
            listed.push(sid);
        }
    }
    const scenarios = {};
    for (const sid of listed) {
        const eventsA = rounds.A?.events[sid];
        const eventsB = rounds.B?.events[sid];
        const filesOf = (round) => outputs.scenarioFiles[sid]?.[`round_${round}`] ?? [];
        const entry = {
            extra: OPTIONAL_SCENARIOS.includes(sid),
            synthetic: false,
            round_a: {
                files: filesOf('a'),
                present: Boolean(eventsA),
                count: eventsA?.length ?? 0,
            },
        };
        let lookup = null;
        if (hasB) {
            const lookups = rounds.B.lookups[sid];
            const file = outputs.files.lookups?.B?.[sid];
            if (lookups && file) {
                const body = lookups[0].body;
                lookup = {
                    file,
                    status: lookups[0].status,
                    isCancelled: typeof body?.isCancelled === 'boolean' ? body.isCancelled : null,
                };
            }
            const comparable = Boolean(eventsA) && Boolean(eventsB);
            const inB = new Set(idsOf(eventsB));
            entry.round_b = {
                files: filesOf('b'),
                present: Boolean(eventsB),
                count: eventsB?.length ?? 0,
                id_equal: comparable ? idsOf(eventsA).every((id) => inB.has(id)) : null,
                lookup,
            };
        }
        const lookupNote = lookup && { ...lookup, errorCode: rounds.B.lookups[sid][0].errorCode };
        entry.observed = observedSentence({ eventsA, eventsB, hasB, lookup: lookupNote });
        scenarios[sid] = entry;
    }
    for (const { id, sensitivity, file, count } of outputs.synthetic) {
        scenarios[id] = {
            extra: true,
            synthetic: true,
            round_a: { files: [file], present: true, count },
            observed:
                `Synthetic: derived from S6 round A with sensitivity set to ${sensitivity}; ` +
                'not captured from Outlook.',
        };
    }

    const factsA = rounds.A?.facts ?? rounds.B.facts;
    const experiments = {};
    for (const key of EXPERIMENT_KEYS) {
        experiments[key] = factsA[key] ?? null;
    }
    experiments.id_format = first.idFormat;
    experiments.round_b_lookups = rounds.B?.facts.round_b_lookups ?? null;

    return {
        captured_at: captured,
        window: first.meta.window,
        outlook_client: outlookClient(env.M365_SPIKE_OUTLOOK_CLIENT),
        mailbox_timezone: first.mailboxTimezone,
        files: outputs.files,
        scenarios,
        experiments,
    };
}
