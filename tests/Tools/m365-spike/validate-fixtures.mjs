// Offline gate for tests/Fixtures/M365. Zero dependencies (node: built-ins only).
//
//   node tests/Tools/m365-spike/validate-fixtures.mjs [--schema] [--semantic] [--leaks] [--replay]
//        [--round A|B|both] [--dir <fixturesDir>] [--raw <rawDir>]
//
// With no check flag all four checks run. Success prints "validate-fixtures: OK (<n> checks)" and
// exits 0. Failure prints one "FAIL <check>: <reason>" line per problem and exits 1. A usage error
// exits 2 and never echoes the offending argument. Reports name a file and a kind of problem,
// never a leaked value.
//
// Every file list comes from manifest.json (page lists in page order); the only directory listings
// are the orphan check and the leak scan, which must see every file on disk.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    FAKE_GUID_PREFIX,
    PAGE_TOKEN_PREFIX,
    buildLeakSet,
    collectRawDocuments,
    findLeaks,
} from './lib/sanitize.mjs';
import {
    EXPERIMENT_KEYS,
    REQUIRED_SCENARIOS,
    attendeesOtherThanOrganizer,
    findUntaggedEvents,
} from './lib/scenarios.mjs';
import { SECRET_PATTERNS } from './validate-docs.mjs';

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..', '..');
const DEFAULT_DIR = path.join(REPO_ROOT, 'tests', 'Fixtures', 'M365');
const DEFAULT_RAW_DIR = path.join(SPIKE_DIR, 'raw');

const ALLOWED_HOSTS = ['graph.microsoft.com', 'outlook.example.test', 'teams.example.test'];
const SECRET_NAMES = ['JWT-shaped string', 'client-secret value shape', 'token assignment'];
const GUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const FOREIGN_EMAIL = /[A-Za-z0-9._%+-]+@(?!example\.test\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_HOST = /https?:\/\/([^/\s"'<>)\]?#:@\\]+)/gi;
const CHECK_NAMES = ['schema', 'semantic', 'leaks', 'replay'];
const TOP_LEVEL_KEYS = [
    'captured_at',
    'window',
    'outlook_client',
    'mailbox_timezone',
    'files',
    'scenarios',
    'experiments',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);
const toPosix = (value) => value.split(path.sep).join('/');
const roundsOf = (round) => (round === 'A' || round === 'B' ? [round] : ['A', 'B']);
const sideOf = (round) => `round_${round.toLowerCase()}`;

function createChecker() {
    const reasons = [];
    let total = 0;
    return {
        check(ok, reason) {
            total += 1;
            if (!ok) {
                reasons.push(reason);
            }
        },
        result() {
            return { reasons, total };
        },
    };
}

// ---- reading ----------------------------------------------------------------------------

function loadManifest(dir) {
    const file = path.join(dir, 'manifest.json');
    if (!existsSync(file)) {
        return { error: `manifest.json not found in ${dir}` };
    }
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return { error: 'manifest.json is not valid JSON' };
    }
    return isObject(manifest) ? { manifest } : { error: 'manifest.json is not a JSON object' };
}

function readJsonFile(dir, relPath) {
    if (typeof relPath !== 'string' || relPath === '') {
        return { unsafe: true };
    }
    const base = path.resolve(dir);
    const target = path.resolve(base, relPath);
    if (!target.startsWith(base + path.sep)) {
        return { unsafe: true };
    }
    if (!existsSync(target)) {
        return { exists: false };
    }
    try {
        return { exists: true, ok: true, data: JSON.parse(readFileSync(target, 'utf8')) };
    } catch {
        return { exists: true, ok: false };
    }
}

function listFiles(dir, base = dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...listFiles(full, base));
        } else {
            found.push(toPosix(path.relative(base, full)));
        }
    }
    return found.sort();
}

function stringLeaves(node, into = []) {
    if (typeof node === 'string') {
        into.push(node);
    } else if (node !== null && typeof node === 'object') {
        Object.values(node).forEach((child) => stringLeaves(child, into));
    }
    return into;
}

function sectionFiles(entry) {
    const lists = [entry?.round_a?.files, entry?.round_b?.files];
    return lists.flatMap((list) => (Array.isArray(list) ? list : []));
}

// The events of one scenario section (every file's `value` array), in file order.
function loadEvents(dir, section) {
    const events = [];
    for (const file of Array.isArray(section?.files) ? section.files : []) {
        const loaded = readJsonFile(dir, file);
        if (loaded.ok && Array.isArray(loaded.data?.value)) {
            events.push(...loaded.data.value.filter(isObject));
        }
    }
    return events;
}

// ---- schema -----------------------------------------------------------------------------

function sectionIsValid(section) {
    return (
        isObject(section) &&
        Array.isArray(section.files) &&
        typeof section.present === 'boolean' &&
        Number.isInteger(section.count)
    );
}

function checkCalendarView(checker, files, manifest, round) {
    const passes = files.calendarview?.[round];
    checker.check(isObject(passes), `manifest.json lacks files.calendarview.${round}`);
    const prod = passes?.['prod-select'];
    checker.check(isObject(prod), `manifest.json lacks files.calendarview.${round}.prod-select`);
    for (const [pass, entry] of Object.entries(isObject(passes) ? passes : {})) {
        const valid =
            isObject(entry) &&
            Array.isArray(entry.pages) &&
            entry.pages.every((page) => typeof page === 'string') &&
            typeof entry.requests === 'string' &&
            typeof entry.complete === 'boolean';
        checker.check(valid, `files.calendarview.${round}.${pass} needs pages, requests, complete`);
    }
    const idFormat = files.id_format?.[round];
    checker.check(typeof idFormat === 'string', `manifest.json lacks files.id_format.${round}`);
    const capturedAt = manifest.captured_at?.[round];
    checker.check(typeof capturedAt === 'string', `manifest.json lacks captured_at.${round}`);
}

const objectEntries = (scenarios) =>
    Object.entries(scenarios).filter(([, entry]) => isObject(entry));
const isUnderSyn = (file) => file.startsWith('scenarios/SYN-');

function checkScenarioEntries(checker, scenarios, rounds) {
    for (const sid of REQUIRED_SCENARIOS) {
        const entry = scenarios[sid];
        checker.check(isObject(entry), `scenario ${sid} is missing`);
        if (!isObject(entry)) {
            continue;
        }
        for (const round of rounds) {
            const side = sideOf(round);
            checker.check(sectionIsValid(entry[side]), `scenario ${sid} has no valid ${side}`);
        }
    }
    for (const [sid, entry] of objectEntries(scenarios)) {
        const files = sectionFiles(entry);
        const flagged = typeof entry.extra === 'boolean' && typeof entry.synthetic === 'boolean';
        checker.check(flagged, `scenario ${sid} needs boolean extra and synthetic flags`);
        checker.check(typeof entry.observed === 'string', `scenario ${sid} lacks observed`);
        if (sid.startsWith('SYN-')) {
            checker.check(entry.synthetic === true, `scenario ${sid} must be synthetic: true`);
        }
        if (entry.synthetic === true) {
            const message = `synthetic scenario ${sid} must keep its files under scenarios/SYN-`;
            checker.check(files.every(isUnderSyn), message);
        } else {
            const message = `scenario ${sid} is not synthetic but lists files under scenarios/SYN-`;
            checker.check(!files.some(isUnderSyn), message);
        }
    }
}

function checkIndexAndOrphans(checker, dir, manifest) {
    const listed = new Set(stringLeaves(manifest.files));
    for (const entry of Object.values(isObject(manifest.scenarios) ? manifest.scenarios : {})) {
        sectionFiles(entry).forEach((file) => listed.add(file));
    }
    for (const file of [...listed].sort()) {
        const loaded = readJsonFile(dir, file);
        checker.check(!loaded.unsafe, `listed path ${file} leaves the fixtures directory`);
        if (!loaded.unsafe) {
            const readable = loaded.exists === false || loaded.ok;
            checker.check(loaded.exists, `listed file does not exist: ${file}`);
            checker.check(readable, `listed file is not valid JSON: ${file}`);
        }
    }
    for (const file of listFiles(dir).filter((name) => name.endsWith('.json'))) {
        const known = file === 'manifest.json' || listed.has(file);
        checker.check(known, `orphan file ${file} is not listed in the manifest`);
    }
}

function checkCounts(checker, dir, scenarios, rounds) {
    for (const [sid, entry] of objectEntries(scenarios)) {
        for (const round of rounds) {
            const side = sideOf(round);
            if (sectionIsValid(entry[side])) {
                const found = loadEvents(dir, entry[side]).length;
                const { count } = entry[side];
                const message = `scenario ${sid} ${side}: count ${count}, files hold ${found}`;
                checker.check(found === count, message);
            }
        }
    }
}

function runSchema(dir, round) {
    const checker = createChecker();
    const { manifest, error } = loadManifest(dir);
    checker.check(manifest !== undefined, error);
    if (manifest === undefined) {
        return checker.result();
    }
    const rounds = roundsOf(round);
    for (const key of TOP_LEVEL_KEYS) {
        checker.check(has(manifest, key), `manifest.json lacks the key "${key}"`);
    }
    const files = isObject(manifest.files) ? manifest.files : {};
    for (const key of ['me', 'token_shape', 'calendarview', 'id_format']) {
        checker.check(has(files, key), `manifest.json lacks files.${key}`);
    }
    rounds.forEach((name) => checkCalendarView(checker, files, manifest, name));
    const scenarios = isObject(manifest.scenarios) ? manifest.scenarios : {};
    checkScenarioEntries(checker, scenarios, rounds);
    for (const key of EXPERIMENT_KEYS) {
        checker.check(has(manifest.experiments, key), `experiments lacks "${key}"`);
    }
    checkIndexAndOrphans(checker, dir, manifest);
    checkCounts(checker, dir, scenarios, rounds);
    return checker.result();
}

// ---- semantic ---------------------------------------------------------------------------

const toMs = (value) => {
    const text = String(value ?? '');
    return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
};
const timeOfDay = (event) => String(event.start?.dateTime ?? '').slice(11, 19);
const isSeriesMember = (event) =>
    ['occurrence', 'exception'].includes(event.type) && typeof event.seriesMasterId === 'string';
const hasAttendees = (event) => Array.isArray(event.attendees) && event.attendees.length > 0;
const isAccepted = (event) =>
    event.isOrganizer === false && event.responseStatus?.response === 'accepted';
const isHostWithGuests = (event) => event.isOrganizer === true && hasAttendees(event);
const isPrivateHost = (event) => event.isOrganizer === true && event.sensitivity === 'private';
const hasSensitivity = (event) =>
    event.isOrganizer === false && /^\w+$/.test(event.sensitivity ?? '');
const isAllDay = (event) => event.isAllDay === true;
// Graph lists the organizer as an attendee of an event created without invitees, so "alone" means
// no attendee other than the organizer; an empty list passes too.
const isAlone = (event) => event.isOrganizer === true && attendeesOtherThanOrganizer(event) === 0;
const wasChanged = (event) =>
    event.isCancelled === true || event.responseStatus?.response === 'declined';

// Graph omits `originalStart` from the default (no `$select`) shape that the scenario files are
// built from, and returns it only when selected. So the edited-occurrence evidence is the
// event's own `originalStart` or, failing that, the one the same event carries in the
// `prod-select` page (which selects it); `originalOf` supplies that lookup.
function isMovedException(event, originalOf = () => undefined) {
    const originalStart = event.originalStart ?? originalOf(event.id);
    if (event.type !== 'exception' || [null, undefined].includes(originalStart)) {
        return false;
    }
    const original = toMs(originalStart);
    const current = toMs(event.start?.dateTime);
    return Number.isFinite(original) && Number.isFinite(current) && original !== current;
}

function seriesGroups(events) {
    const groups = new Map();
    for (const event of events.filter(isSeriesMember)) {
        groups.set(event.seriesMasterId, [...(groups.get(event.seriesMasterId) ?? []), event]);
    }
    return [...groups.values()];
}

const ROUND_A_RULES = [
    ['S1', isAccepted, 'an accepted event with isOrganizer false'],
    ['S1b', isHostWithGuests, 'an organized event with attendees'],
    ['S6', isPrivateHost, 'an organized private event'],
    ['S6b', hasSensitivity, 'an attendee event with a sensitivity'],
    ['S7', isAllDay, 'an all-day event'],
    ['S8', isAlone, 'an organized event without attendees other than the organizer'],
];

function checkRoundA(checker, events, scenarios) {
    for (const sid of REQUIRED_SCENARIOS) {
        const present = scenarios[sid]?.round_a?.present === true;
        checker.check(present, `${sid} round A: the scenario is absent from the capture`);
    }
    for (const [sid, test, wanted] of ROUND_A_RULES) {
        checker.check(events(sid, 'round_a').some(test), `${sid} round A: expected ${wanted}`);
    }
    const shared = seriesGroups(events('S2', 'round_a')).filter((group) => group.length >= 2);
    checker.check(shared.length > 0, 'S2 round A: expected occurrences sharing a seriesMasterId');
    const shifts = shared.some((group) => new Set(group.map(timeOfDay)).size > 1);
    checker.check(shifts, 'S2 round A: one UTC time of day only, so there is no DST evidence');
}

// `originalStart` by event id over one round's prod-select pages, in manifest page order.
function selectedOriginals(dir, manifest, round) {
    const originals = new Map();
    const pages = manifest.files?.calendarview?.[round]?.['prod-select']?.pages;
    for (const file of Array.isArray(pages) ? pages : []) {
        const loaded = readJsonFile(dir, file);
        for (const entry of Array.isArray(loaded.data?.value) ? loaded.data.value : []) {
            if (isObject(entry) && typeof entry.id === 'string' && 'originalStart' in entry) {
                originals.set(entry.id, entry.originalStart);
            }
        }
    }
    return originals;
}

function checkRoundB(checker, events, scenarios, originals = new Map()) {
    const lookupRecorded = (sid) => Number.isInteger(scenarios[sid]?.round_b?.lookup?.status);
    const isPresent = (sid) => scenarios[sid]?.round_b?.present === true;
    const edited = events('S2', 'round_b').some((event) =>
        isMovedException(event, (id) => originals.get(id))
    );
    checker.check(edited, 'S2 round B: no exception whose originalStart differs from start');
    for (const sid of ['S3', 'S4']) {
        if (isPresent(sid)) {
            const text = `${sid} round B: still present, neither cancelled nor declined`;
            checker.check(events(sid, 'round_b').some(wasChanged), text);
        } else {
            const text = `${sid} round B: absent and no direct lookup is recorded`;
            checker.check(lookupRecorded(sid), text);
        }
    }
    for (const sid of ['S5', 'S5b']) {
        const text = `${sid} round B: absent and no direct lookup is recorded`;
        checker.check(isPresent(sid) || lookupRecorded(sid), text);
    }
    if (isPresent('S5')) {
        const equal = scenarios.S5.round_b.id_equal;
        checker.check(typeof equal === 'boolean', 'S5 round B: id_equal must be a boolean');
    }
    if (isObject(scenarios.E2) && scenarios.E2.round_b) {
        const masters = new Set(events('E2', 'round_b').map((event) => event.seriesMasterId));
        masters.delete(null);
        masters.delete(undefined);
        const text = 'E2 round B: fewer than two distinct seriesMasterId values';
        checker.check(masters.size >= 2, text);
    }
}

function runSemantic(dir, round) {
    const checker = createChecker();
    const { manifest, error } = loadManifest(dir);
    checker.check(manifest !== undefined, error);
    if (manifest === undefined) {
        return checker.result();
    }
    const scenarios = isObject(manifest.scenarios) ? manifest.scenarios : {};
    const events = (sid, side) => loadEvents(dir, scenarios[sid]?.[side]);
    const rounds = roundsOf(round);
    if (rounds.includes('A')) {
        checkRoundA(checker, events, scenarios);
    }
    if (rounds.includes('B')) {
        checkRoundB(checker, events, scenarios, selectedOriginals(dir, manifest, 'B'));
    }
    for (const [sid, entry] of Object.entries(scenarios)) {
        const sensitivity = /^SYN-(\w+)$/.exec(sid)?.[1];
        if (isObject(entry) && sensitivity) {
            const isRight = (event) => event.sensitivity === sensitivity;
            const text = `${sid}: every event must have sensitivity ${sensitivity}`;
            checker.check(events(sid, 'round_a').every(isRight), text);
        }
    }
    return checker.result();
}

// ---- leaks ------------------------------------------------------------------------------

// Generic patterns on one file's text. A report names the file and line, never the value.
export function scanText(relPath, text) {
    const reasons = [];
    String(text)
        .split('\n')
        .forEach((line, index) => {
            const where = `${relPath}:${index + 1}`;
            if (FOREIGN_EMAIL.test(line)) {
                reasons.push(`${where}: e-mail address outside @example.test`);
            }
            const hosts = [...line.matchAll(URL_HOST)].map((match) => match[1].toLowerCase());
            if (hosts.some((host) => !ALLOWED_HOSTS.includes(host))) {
                reasons.push(`${where}: URL host outside the allow-list`);
            }
            const guids = [...line.matchAll(GUID_ANYWHERE)].map((match) => match[0].toLowerCase());
            if (guids.some((guid) => !guid.startsWith(FAKE_GUID_PREFIX))) {
                reasons.push(`${where}: GUID without the fixture prefix`);
            }
            SECRET_PATTERNS.forEach((pattern, index2) => {
                if (pattern.test(line)) {
                    reasons.push(`${where}: ${SECRET_NAMES[index2]}`);
                }
            });
        });
    return reasons;
}

const isFakeId = (value) => value.startsWith('FAKE') || value.startsWith(FAKE_GUID_PREFIX);

function scanJson(relPath, data) {
    const reasons = [];
    const walk = (node, key) => {
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item, key));
            return;
        }
        if (isObject(node)) {
            for (const [childKey, child] of Object.entries(node)) {
                walk(child, childKey);
            }
        }
        if (key === 'bodyPreview') {
            reasons.push(`${relPath}: key "bodyPreview" must not appear in a fixture`);
        }
        const bodyText = isObject(node) && ('content' in node || 'contentType' in node);
        if (key === 'body' && (typeof node === 'string' || bodyText)) {
            reasons.push(`${relPath}: event body content must not appear in a fixture`);
        }
        const isId = key === 'id' || key === 'seriesMasterId';
        if (isId && typeof node === 'string' && !isFakeId(node)) {
            reasons.push(`${relPath}: ${key} value without the FAKE prefix`);
        }
    };
    walk(data, '');
    if (findUntaggedEvents(data) > 0) {
        reasons.push(`${relPath}: event without a scenario tag`);
    }
    return [...new Set(reasons)];
}

function runLeaks(dir, rawDir) {
    const checker = createChecker();
    let leakSet = null;
    if (rawDir && existsSync(rawDir)) {
        try {
            leakSet = buildLeakSet(collectRawDocuments(rawDir));
        } catch (error) {
            checker.check(false, `the raw directory cannot be read: ${error.message}`);
        }
    }
    for (const file of listFiles(dir)) {
        const text = readFileSync(path.join(dir, ...file.split('/')), 'utf8');
        const reasons = scanText(file, text);
        if (file.endsWith('.json')) {
            try {
                reasons.push(...scanJson(file, JSON.parse(text)));
            } catch {
                reasons.push(`${file}: not valid JSON`);
            }
        }
        if (leakSet !== null) {
            const kinds = new Set(findLeaks(text, leakSet).map((hit) => leakSet.kinds.get(hit)));
            for (const kind of [...kinds].sort()) {
                reasons.push(`${file}: a ${kind} value from the raw data is in the file`);
            }
        }
        checker.check(reasons.length === 0, '');
        reasons.forEach((reason) => checker.check(false, reason));
    }
    return checker.result();
}

// ---- replay -----------------------------------------------------------------------------

function nextLinkProblem(link, expectedPage) {
    let url;
    try {
        url = new URL(link);
    } catch {
        return 'the next link is not a URL';
    }
    if (!url.pathname.toLowerCase().endsWith('/me/calendarview')) {
        return 'the next link path does not end in /me/calendarView';
    }
    const token = url.searchParams.get('$skiptoken') ?? url.searchParams.get('$skip');
    const expected = `${PAGE_TOKEN_PREFIX}${expectedPage}`;
    return token === expected ? null : `the next link token is not ${expected}`;
}

const countEvents = (page) => (Array.isArray(page.value) ? page.value.length : 0);

// Emulates one Http::sequence: the manifest's page bodies are queued in array order, the first
// request is issued, and each response's next link pops the next queued page.
function replayPass(dir, round, pass, entry) {
    const reasons = [];
    const fail = (text) => reasons.push(`round ${round} ${pass}: ${text}`);
    const pages = [];
    for (const file of entry.pages ?? []) {
        const loaded = readJsonFile(dir, file);
        if (loaded.ok && isObject(loaded.data)) {
            pages.push(loaded.data);
        } else {
            fail(`page file ${file} cannot be read`);
        }
    }
    const requests = readJsonFile(dir, entry.requests);
    const listed = entry.pages ?? [];
    if (!requests.ok || !Array.isArray(requests.data)) {
        fail('the requests file cannot be read');
    } else if (requests.data.length !== listed.length) {
        const counts = `${listed.length} pages and ${requests.data.length} requests entries`;
        fail(`the manifest lists ${counts}`);
    }
    if (pages.length === 0 || reasons.length > 0) {
        return { reasons, stats: null };
    }
    const queue = [...pages];
    let current = queue.shift();
    let requestCount = 1;
    let eventCount = countEvents(current);
    for (let index = 0; ; index += 1) {
        const next = current['@odata.nextLink'];
        if (next === undefined) {
            if (queue.length > 0) {
                const more = `${queue.length} more pages are listed`;
                fail(`page ${index + 1} has no next link but ${more}`);
            }
            break;
        }
        const problem = nextLinkProblem(next, index + 2);
        if (problem !== null) {
            fail(`page ${index + 1}: ${problem}`);
            break;
        }
        if (queue.length === 0) {
            fail('the last page still carries a next link');
            break;
        }
        current = queue.shift();
        requestCount += 1;
        eventCount += countEvents(current);
    }
    const stats = { round, pass, requests: requestCount, events: eventCount };
    return { reasons, stats: reasons.length === 0 ? stats : null };
}

export function replayReport(dir, round = 'both') {
    const { manifest, error } = loadManifest(dir);
    if (manifest === undefined) {
        return { reasons: [error], passes: [] };
    }
    const reasons = [];
    const passes = [];
    for (const name of roundsOf(round)) {
        const entries = manifest.files?.calendarview?.[name];
        if (entries?.['prod-select']?.complete !== true) {
            reasons.push(`round ${name}: no complete prod-select pass to replay`);
        }
        for (const [pass, entry] of Object.entries(isObject(entries) ? entries : {})) {
            if (isObject(entry) && entry.complete === true) {
                const result = replayPass(dir, name, pass, entry);
                reasons.push(...result.reasons);
                if (result.stats !== null) {
                    passes.push(result.stats);
                }
            }
        }
    }
    return { reasons, passes };
}

function runReplay(dir, round) {
    const report = replayReport(dir, round);
    const info = report.passes.map((entry) => {
        const counts = `${entry.requests} requests, ${entry.events} events`;
        return `replay: round ${entry.round} ${entry.pass}: ${counts}`;
    });
    const total = report.passes.length + roundsOf(round).length;
    return { reasons: report.reasons, total, info };
}

// ---- public checks ----------------------------------------------------------------------

export function checkSchema(dir, { round = 'both' } = {}) {
    return runSchema(dir, round).reasons;
}

export function checkSemantic(dir, { round = 'both' } = {}) {
    return runSemantic(dir, round).reasons;
}

export function checkLeaks(dir, { rawDir } = {}) {
    return runLeaks(dir, rawDir).reasons;
}

export function checkReplay(dir, { round = 'both' } = {}) {
    return replayReport(dir, round).reasons;
}

// ---- CLI --------------------------------------------------------------------------------

const FLAG_KINDS = {
    schema: 'boolean',
    semantic: 'boolean',
    leaks: 'boolean',
    replay: 'boolean',
    round: 'string',
    dir: 'string',
    raw: 'string',
};
const USAGE =
    'Usage: node tests/Tools/m365-spike/validate-fixtures.mjs [--schema] [--semantic] [--leaks] ' +
    '[--replay] [--round A|B|both] [--dir <fixturesDir>] [--raw <rawDir>]';

function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
        const kind = Object.hasOwn(FLAG_KINDS, name) ? FLAG_KINDS[name] : undefined;
        if (kind === 'boolean') {
            flags[name] = true;
        } else if (kind === 'string' && i + 1 < argv.length) {
            i += 1;
            flags[name] = argv[i];
        } else {
            return null;
        }
    }
    return flags;
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
    const flags = parseFlags(argv);
    if (flags === null || (flags.round && !['A', 'B', 'both'].includes(flags.round))) {
        stderr.write(`${USAGE}\n`);
        return 2;
    }
    const dir = path.resolve(flags.dir ?? DEFAULT_DIR);
    const rawDir = path.resolve(flags.raw ?? DEFAULT_RAW_DIR);
    const round = flags.round ?? 'both';
    const selected = CHECK_NAMES.filter((name) => flags[name]);
    const names = selected.length > 0 ? selected : CHECK_NAMES;

    let total = 0;
    const failures = [];
    const info = [];
    for (const name of names) {
        let result;
        if (name === 'replay') {
            result = runReplay(dir, round);
            info.push(...result.info);
        } else if (name === 'schema') {
            result = runSchema(dir, round);
        } else if (name === 'semantic') {
            result = runSemantic(dir, round);
        } else {
            result = runLeaks(dir, rawDir);
        }
        total += result.total;
        failures.push(...result.reasons.map((reason) => `FAIL ${name}: ${reason}`));
    }
    info.forEach((line) => stdout.write(`${line}\n`));
    if (failures.length > 0) {
        stdout.write(`${failures.join('\n')}\n`);
        return 1;
    }
    stdout.write(`validate-fixtures: OK (${total} checks)\n`);
    return 0;
}

const isEntryPoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
    process.exitCode = main(process.argv.slice(2));
}
