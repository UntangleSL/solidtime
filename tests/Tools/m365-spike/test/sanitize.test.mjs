import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    buildLeakSet,
    createSanitizer,
    findLeaks,
    loadOrCreateSalt,
} from '../lib/sanitize.mjs';

// Every identifying value below is assembled at runtime, so this file never matches the repo-wide
// e-mail, GUID or secret patterns.
const mail = (local, domain) => `${local}@${domain}`;
const guidOf = (...parts) => parts.join('-');
const longId = (byte, bytes = 74) => Buffer.alloc(bytes, byte).toString('base64');
const ICAL_PREFIX = '040000008200E00074C5B7101A82E008';
const SALT = Buffer.alloc(32, 7);

const OWNER = mail('ana.garcia', 'contoso.com');
const BLOCKED = mail('luis.perez', 'contoso.com');
const THIRD = mail('marta.ruiz', 'fabrikam.org');
const FOURTH = mail('pedro.gil', 'fabrikam.org');

function rawEvent(overrides = {}) {
    return {
        id: longId(0xfb),
        iCalUId: `${ICAL_PREFIX}${'AB12CD34'.repeat(6)}`,
        subject: '[M365-TEST S1] single',
        type: 'singleInstance',
        seriesMasterId: null,
        isCancelled: false,
        isOrganizer: false,
        start: { dateTime: '2026-10-20T09:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-20T10:00:00.0000000', timeZone: 'UTC' },
        responseStatus: { response: 'accepted', time: '2026-10-01T08:00:00Z' },
        organizer: { emailAddress: { name: 'Ana García', address: OWNER } },
        attendees: [
            {
                type: 'required',
                status: { response: 'accepted', time: '2026-10-01T08:00:00Z' },
                emailAddress: { name: 'Luis Pérez', address: BLOCKED },
            },
        ],
        ...overrides,
    };
}

const make = (options = {}) =>
    createSanitizer({ salt: SALT, loginHint: OWNER, blockedHint: BLOCKED, ...options });

const trailingEquals = (value) => /=*$/.exec(value)[0].length;

test('the same raw event and salt give identical output, another salt gives other pseudonyms', () => {
    const first = make().event(rawEvent());
    const second = make().event(rawEvent());
    const other = make({ salt: Buffer.alloc(32, 9) }).event(rawEvent());

    assert.deepEqual(first, second);
    assert.notEqual(first.id, other.id);
    assert.notEqual(first.iCalUId, other.iCalUId);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('ids, series master ids, etags and change keys keep length and padding and start with FAKE', () => {
    const sanitizer = make();
    const masterId = longId(0xfa, 73);
    const inner = longId(0xf9, 40);
    const raw = rawEvent({
        seriesMasterId: masterId,
        '@odata.etag': inner,
        changeKey: inner,
    });

    const out = sanitizer.event(raw);

    for (const field of ['id', 'seriesMasterId', '@odata.etag', 'changeKey']) {
        assert.ok(out[field].startsWith('FAKE'), `${field} must start with FAKE`);
        assert.equal(out[field].length, raw[field].length, `${field} length`);
        assert.equal(trailingEquals(out[field]), trailingEquals(raw[field]), `${field} padding`);
        assert.match(out[field].replace(/=+$/, ''), /^[A-Za-z0-9_-]+$/);
    }
    assert.ok(raw.id.includes('+') || raw.id.includes('/'), 'the raw id needs standard base64');
    assert.equal(out['@odata.etag'], out.changeKey, 'equal raw values stay equal');
    assert.equal(make().event(raw).id, out.id, 'same input, same output');
    assert.notEqual(out.id, out.seriesMasterId);
});

test('an etag wrapped in W/"..." keeps its wrapper and its length', () => {
    const inner = longId(0xf8, 40);
    const out = make().event(rawEvent({ '@odata.etag': `W/"${inner}"`, changeKey: inner }));

    const wrapped = /^W\/"(.*)"$/.exec(out['@odata.etag']);
    assert.ok(wrapped, 'wrapper kept');
    assert.ok(wrapped[1].startsWith('FAKE'));
    assert.equal(wrapped[1].length, inner.length);
    assert.equal(wrapped[1], out.changeKey);
});

test('an occurrence points at the sanitized id of its master', () => {
    const sanitizer = make();
    const master = rawEvent({ id: longId(0xf0), type: 'seriesMaster', subject: '[M365-TEST S2] series' });
    const occurrence = rawEvent({
        id: longId(0xf1),
        type: 'occurrence',
        seriesMasterId: master.id,
        subject: '[M365-TEST S2] series',
    });

    assert.equal(sanitizer.event(occurrence).seriesMasterId, sanitizer.event(master).id);
    assert.equal(sanitizer.id(master.id), sanitizer.event(master).id);
});

test('iCalUId keeps the constant prefix and becomes upper-case hex of the same length', () => {
    const out = make().event(rawEvent());
    const raw = rawEvent().iCalUId;

    assert.ok(out.iCalUId.startsWith(ICAL_PREFIX));
    assert.equal(out.iCalUId.length, raw.length);
    assert.match(out.iCalUId.slice(ICAL_PREFIX.length), /^[0-9A-F]+$/);
    assert.notEqual(out.iCalUId, raw);

    const plain = make().event(rawEvent({ iCalUId: 'abc123def456abc123def456' }));
    assert.match(plain.iCalUId, /^[0-9A-F]{24}$/);
});

test('test users A and B and every other person get fixed pseudonymous identities', () => {
    const sanitizer = make();
    const out = sanitizer.event(
        rawEvent({
            organizer: { emailAddress: { name: 'Ana García', address: OWNER.toUpperCase() } },
            attendees: [
                { type: 'required', emailAddress: { name: 'Luis Pérez', address: BLOCKED } },
                { type: 'optional', emailAddress: { name: 'Marta Ruiz', address: THIRD } },
                { type: 'required', emailAddress: { name: 'Pedro Gil', address: FOURTH } },
                { type: 'required', emailAddress: { name: 'M. Ruiz', address: THIRD.toUpperCase() } },
            ],
        })
    );

    assert.deepEqual(out.organizer, {
        emailAddress: { name: 'Test User A', address: 'person-a@example.test' },
    });
    assert.deepEqual(
        out.attendees.map((attendee) => attendee.emailAddress),
        [
            { name: 'Test User B', address: 'person-b@example.test' },
            { name: 'Test Person 1', address: 'person-1@example.test' },
            { name: 'Test Person 2', address: 'person-2@example.test' },
            { name: 'Test Person 1', address: 'person-1@example.test' },
        ]
    );
    assert.deepEqual(
        out.attendees.map((attendee) => attendee.type),
        ['required', 'optional', 'required', 'required']
    );
});

test('the identity map is persisted and numbering continues after a reload', (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'm365-sanitize-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const identityMapPath = path.join(dir, 'identity-map.json');
    const attendee = (address) => ({ type: 'required', emailAddress: { name: 'X Y', address } });

    const first = make({ identityMapPath });
    first.event(rawEvent({ attendees: [attendee(THIRD)] }));
    first.persistIdentityMap();
    assert.ok(existsSync(identityMapPath));

    const second = make({ identityMapPath });
    const out = second.event(rawEvent({ attendees: [attendee(FOURTH), attendee(THIRD)] }));

    assert.deepEqual(
        out.attendees.map((entry) => entry.emailAddress.address),
        ['person-2@example.test', 'person-1@example.test']
    );
});

test('only the scenario tag survives in a subject, plus allow-listed Exchange prefixes', () => {
    const sanitizer = make();
    const subjectOf = (subject) => sanitizer.event(rawEvent({ subject })).subject;

    assert.equal(subjectOf('Canceled: [M365-TEST S3] cancelled'), 'Canceled: [M365-TEST S3] cancelled');
    assert.equal(subjectOf('Cancelado: [M365-TEST S3] cancelled'), 'Cancelado: [M365-TEST S3] cancelled');
    assert.equal(subjectOf('[M365-TEST S2] series (edited)'), '[M365-TEST S2] series (edited)');
    assert.equal(subjectOf('[M365-TEST S1] Reunión con Contoso'), '[M365-TEST S1]');
    assert.equal(subjectOf('[M365-TEST S1] ' + 'x'.repeat(41)), '[M365-TEST S1]');
    assert.equal(subjectOf('Quarterly review: [M365-TEST S4] declined'), '[M365-TEST S4] declined');
    assert.equal(subjectOf('Canceled: Board [M365-TEST S4]'), 'Canceled: [M365-TEST S4]');

    const first = subjectOf('Board offsite with Contoso');
    assert.match(first, /^Event \d+$/);
    assert.equal(subjectOf('Board offsite with Contoso'), first);
    assert.notEqual(subjectOf('Another private meeting'), first);
});

test('body, previews, categories, attachments, extensions and unknown fields are dropped', () => {
    const out = make().event(
        rawEvent({
            body: { contentType: 'html', content: '<p>secret agenda</p>' },
            bodyPreview: 'secret agenda',
            categories: ['Red category'],
            attachments: [{ name: 'plan.docx' }],
            extensions: [{ id: 'x' }],
            newFieldX: 'something new from Graph',
            transactionId: 'abc',
        })
    );

    for (const key of [
        'body',
        'bodyPreview',
        'categories',
        'attachments',
        'extensions',
        'newFieldX',
        'transactionId',
    ]) {
        assert.equal(key in out, false, `${key} must be dropped`);
    }
    assert.ok(!JSON.stringify(out).includes('secret agenda'));
    assert.equal(out.subject, '[M365-TEST S1] single', 'allow-listed fields survive');
    assert.equal(out.type, 'singleInstance');
});

test('verbatim fields are guarded: nested extras and non-scalar values do not pass', () => {
    const out = make().event(
        rawEvent({
            start: { dateTime: '2026-10-20T09:00:00.0000000', timeZone: 'UTC', extra: 'leak' },
            showAs: { nested: 'object' },
            sensitivity: 'private',
            importance: 'x'.repeat(200),
            responseStatus: { response: 'accepted', time: '2026-10-01T08:00:00Z', who: 'someone' },
            recurrence: {
                pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], secret: 'x' },
                range: { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 5 },
                note: 'drop me',
            },
        })
    );

    assert.deepEqual(out.start, { dateTime: '2026-10-20T09:00:00.0000000', timeZone: 'UTC' });
    assert.equal('showAs' in out, false);
    assert.equal(out.sensitivity, 'private');
    assert.equal('importance' in out, false);
    assert.deepEqual(out.responseStatus, { response: 'accepted', time: '2026-10-01T08:00:00Z' });
    assert.deepEqual(out.recurrence, {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 5 },
    });
});

test('links and locations become example.test values', () => {
    const joinUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc';
    const raw = rawEvent({
        webLink: 'https://outlook.office365.com/owa/?itemid=ABC&exvsurl=1',
        onlineMeeting: { joinUrl, conferenceId: '123' },
        onlineMeetingUrl: joinUrl,
        location: { displayName: 'Sala Picasso, Madrid', locationType: 'default' },
        locations: [{ displayName: 'Sala Picasso, Madrid' }, { displayName: '' }],
    });

    const out = make().event(raw);

    assert.equal(out.webLink, `https://outlook.example.test/calendar/item/${make().id(raw.id)}`);
    assert.match(out.onlineMeeting.joinUrl, /^https:\/\/teams\.example\.test\/l\/meetup-join\/\d+$/);
    assert.deepEqual(Object.keys(out.onlineMeeting), ['joinUrl']);
    assert.equal(out.onlineMeetingUrl, out.onlineMeeting.joinUrl);
    assert.match(out.location.displayName, /^Location \d+$/);
    assert.deepEqual(Object.keys(out.location), ['displayName']);
    assert.equal(out.locations[0].displayName, out.location.displayName);
    assert.equal(out.locations[1].displayName, null);
    const text = JSON.stringify(out);
    assert.ok(!text.includes('Picasso') && !text.includes('office365') && !text.includes('teams.microsoft'));
});

test('context and next links keep their shape and lose users, ids and page tokens', () => {
    const sanitizer = make();
    const userGuid = guidOf('1b9e7a52', '66c1', '4d3f', 'a0b7', '5c2d9e41f8aa');
    const context = sanitizer.context(
        `https://graph.microsoft.com/v1.0/$metadata#users('${userGuid}')/calendarView(id,subject)`
    );

    assert.match(context, /^https:\/\/graph\.microsoft\.com\/v1\.0\/\$metadata#users\('00000000-0000-4000-8000-[0-9a-f]{12}'\)\/calendarView\(id,subject\)$/);
    assert.ok(!context.includes(userGuid));
    assert.equal(sanitizer.context('not a context'), null);

    const token = 'opaque' + 'Token'.repeat(8);
    const link =
        'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-19T00%3A00%3A00Z' +
        `&endDateTime=2026-11-16T00%3A00%3A00Z&$top=3&$select=id,subject&$skiptoken=${token}`;
    const out = sanitizer.nextLink(link, 2);
    assert.ok(out.startsWith('https://graph.microsoft.com/v1.0/me/calendarView?'));
    assert.ok(out.includes('startDateTime=2026-10-19T00%3A00%3A00Z'));
    assert.ok(out.includes('endDateTime=2026-11-16T00%3A00%3A00Z'));
    assert.ok(out.includes('$top=3'));
    assert.ok(out.includes('$select=id,subject'));
    assert.ok(out.endsWith('$skiptoken=SANITIZED-PAGE-2'));
    assert.ok(!out.includes(token));

    assert.ok(sanitizer.nextLink(link.replace('$skiptoken', '$skip'), 3).endsWith('$skip=SANITIZED-PAGE-3'));
    const local = 'http://127.0.0.1:8080/graph/v1.0/me/calendarView?$skiptoken=1';
    assert.equal(
        sanitizer.nextLink(local, 2),
        'https://graph.microsoft.com/graph/v1.0/me/calendarView?$skiptoken=SANITIZED-PAGE-2'
    );
    assert.equal(sanitizer.nextLink('::not a url::', 2), null);
});

test('request URLs of lookups and series replace the event id and keep the page-1 URL as is', () => {
    const sanitizer = make();
    const id = longId(0xfb);
    const lookup = sanitizer.requestUrl(
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}?$select=id,isCancelled`,
        1
    );

    assert.equal(
        lookup,
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(sanitizer.id(id))}?$select=id,isCancelled`
    );
    assert.ok(!lookup.includes(encodeURIComponent(id)) && !lookup.includes(id));
    const first = 'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-19T00%3A00%3A00Z&$top=3';
    assert.equal(sanitizer.requestUrl(first, 1), first);
    assert.ok(sanitizer.requestUrl(`${first}&$skiptoken=zzzzzzzz`, 4).endsWith('=SANITIZED-PAGE-4'));
});

test('cancelled occurrence ids use the same mapping as event ids', () => {
    const sanitizer = make();
    const master = rawEvent({
        type: 'seriesMaster',
        cancelledOccurrences: [`OID.${rawEvent().id}.2026-11-03`, 'garbage entry'],
    });

    const out = sanitizer.event(master);

    assert.deepEqual(out.cancelledOccurrences, [`OID.${sanitizer.id(master.id)}.2026-11-03`]);
});

test('a page keeps only its events with a scenario tag, counts the rest and numbers its next link', () => {
    const sanitizer = make();
    const tagged = rawEvent({ id: longId(0xf2), subject: '[M365-TEST S1] single' });
    const prefixed = rawEvent({ id: longId(0xf3), subject: 'Canceled: [M365-TEST S3] cancelled' });
    const untagged = rawEvent({ id: longId(0xf4), subject: 'Board offsite with Contoso' });
    const untaggedNull = rawEvent({ id: longId(0xf5), subject: null });
    const body = {
        '@odata.context': `https://graph.microsoft.com/v1.0/$metadata#users('${OWNER}')/calendarView`,
        '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-19T00%3A00%3A00Z&$skiptoken=abcdefgh',
        '@odata.count': 99,
        value: [tagged, untagged, prefixed, untaggedNull],
    };

    const out = sanitizer.page(body, 1);

    assert.deepEqual(Object.keys(out).sort(), ['@odata.context', '@odata.nextLink', 'value']);
    assert.deepEqual(
        out.value.map((event) => event.subject),
        ['[M365-TEST S1] single', 'Canceled: [M365-TEST S3] cancelled']
    );
    assert.equal(sanitizer.stats.droppedUntagged, 2);
    assert.ok(out['@odata.nextLink'].endsWith('SANITIZED-PAGE-2'));
    assert.ok(sanitizer.page(body, 4)['@odata.nextLink'].endsWith('SANITIZED-PAGE-5'));
    assert.ok(!out['@odata.context'].includes(OWNER));
    assert.ok(!JSON.stringify(out).includes(untagged.id));
    const last = sanitizer.page({ value: [tagged] }, 3);
    assert.equal('@odata.nextLink' in last, false);
    assert.equal('@odata.context' in last, false);
});

test('the signed-in user object maps to test user A, whichever address the hint names', () => {
    const upn = mail('ana.garcia', 'contoso.onmicrosoft.com');
    const sanitizer = make({ loginHint: upn });
    const userId = guidOf('2c7f9b10', '1a2b', '4c3d', '8e4f', '9a0b1c2d3e4f');

    const out = sanitizer.me({
        id: userId,
        displayName: 'Ana García',
        givenName: 'Ana',
        surname: 'García',
        mail: OWNER,
        userPrincipalName: upn,
        userType: 'Member',
        preferredLanguage: 'es-ES',
        jobTitle: 'Director',
    });

    assert.match(out.id, /^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    assert.equal(out.displayName, 'Test User A');
    assert.equal(out.givenName, 'Test');
    assert.equal(out.surname, 'User A');
    assert.equal(out.mail, 'person-a@example.test');
    assert.equal(out.userPrincipalName, 'person-a@example.test');
    assert.equal(out.userType, 'Member');
    assert.equal(out.preferredLanguage, 'es-ES');
    assert.equal('jobTitle' in out, false);
    const organizer = sanitizer.event(rawEvent());
    assert.equal(organizer.organizer.emailAddress.address, 'person-a@example.test');
});

test('an error body keeps only the error code', () => {
    const out = make().errorBody({
        error: { code: 'ErrorItemNotFound', message: 'The id AAMk... was not found', innerError: {} },
    });

    assert.deepEqual(out, { error: { code: 'ErrorItemNotFound' } });
    assert.deepEqual(make().errorBody({ error: { code: 'bad code with spaces' } }), {
        error: { code: 'unknown_error' },
    });
});

test('guid pseudonyms are stable, keyed and carry the fixed prefix', () => {
    const guid = guidOf('3d8e1f20', '4b5c', '4a6d', '9b7e', '0f1a2b3c4d5e');
    const sanitizer = make();

    assert.match(sanitizer.guid(guid), /^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    assert.equal(sanitizer.guid(guid), sanitizer.guid(guid.toUpperCase()));
    assert.notEqual(sanitizer.guid(guid), make({ salt: Buffer.alloc(32, 1) }).guid(guid));
});

test('the salt is created once with owner-only permissions and then reused', (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'm365-salt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const created = loadOrCreateSalt(dir);
    const again = loadOrCreateSalt(dir);

    assert.equal(created.length, 32);
    assert.deepEqual(again, created);
    assert.match(readFileSync(path.join(dir, 'salt'), 'utf8').trim(), /^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') {
        assert.equal(statSync(path.join(dir, 'salt')).mode & 0o077, 0);
    }

    writeFileSync(path.join(dir, 'salt'), 'not a salt');
    assert.throws(() => loadOrCreateSalt(dir), /salt/);
    assert.equal(readFileSync(path.join(dir, 'salt'), 'utf8'), 'not a salt');
});

test('the leak set holds identifying and dropped values and finds them in an output', () => {
    const id = longId(0xfb);
    const untagged = rawEvent({
        id: longId(0xee),
        subject: 'Board offsite with Contoso',
        body: { contentType: 'html', content: '<p>confidential budget figures</p>' },
        newFieldX: 'unexpected free text field',
        webLink: 'https://outlook.office365.com/owa/?itemid=SECRETITEM',
    });
    const tagged = rawEvent({ id, subject: '[M365-TEST S1] single' });
    const noisy = rawEvent({ id: longId(0xed), subject: '[M365-TEST S2] Reunión con Contoso' });
    const docs = [
        { pass: 'full-shape', pages: [{ request: { url: 'https://x.test/y' }, body: { value: [untagged, tagged, noisy] } }] },
        { user: { displayName: 'Test User A', mail: 'person-a@example.test' } },
    ];

    const leakSet = buildLeakSet(docs);

    for (const value of [
        OWNER,
        BLOCKED,
        'Ana García',
        'Luis Pérez',
        id,
        encodeURIComponent(id),
        untagged.iCalUId,
        'Board offsite with Contoso',
        '<p>confidential budget figures</p>',
        'unexpected free text field',
        'https://outlook.office365.com/owa/?itemid=SECRETITEM',
        '[M365-TEST S2] Reunión con Contoso',
    ]) {
        assert.ok(leakSet.has(value), `leak set should hold ${value.slice(0, 12)}`);
    }
    assert.equal(leakSet.has('[M365-TEST S1] single'), false, 'a kept subject is not a leak');
    assert.equal(leakSet.has('Test User A'), false, 'a pseudonym literal is not a leak');
    assert.equal(leakSet.has('person-a@example.test'), false);
    assert.equal(leakSet.has('person'), false);
    assert.equal(leakSet.kinds.get(OWNER), 'e-mail');
    for (const value of leakSet) {
        assert.ok(value.length >= 6, 'short values would match everywhere');
    }

    const clean = JSON.stringify(make().page({ value: [tagged] }));
    assert.deepEqual(findLeaks(clean, leakSet), []);
    const planted = `{"a":"${OWNER.toUpperCase()}","b":"Ana García","c":"${id}"}`;
    const hits = findLeaks(planted, leakSet);
    assert.ok(hits.includes(OWNER), 'e-mails match case-insensitively');
    assert.ok(hits.includes('Ana García'));
    assert.ok(hits.includes(id));
});

test('the leak set also covers page tokens, cancelled occurrence ids and escaped forms', () => {
    const token = 'tokenValue' + 'X'.repeat(30);
    const masterId = longId(0xe1);
    const quoted = 'Sala "Norte" \\ planta';
    const docs = [
        {
            body: {
                '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=${token}`,
                value: [
                    rawEvent({
                        id: masterId,
                        cancelledOccurrences: [`OID.${masterId}.2026-11-03`],
                        location: { displayName: quoted },
                    }),
                ],
            },
        },
    ];

    const leakSet = buildLeakSet(docs);

    assert.ok(leakSet.has(token));
    assert.ok(leakSet.has(masterId));
    assert.ok(leakSet.has(quoted));
    assert.ok(findLeaks(JSON.stringify({ location: quoted }), leakSet).length > 0);
});
