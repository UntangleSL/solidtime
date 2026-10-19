// Offline doc gates for the Microsoft 365 setup phase. Zero dependencies (node: built-ins only).
//
//   node tests/Tools/m365-spike/validate-docs.mjs <guide|runbook|secrets|gitignore>
//        [--final] [--file <path>]
//
// Success prints "<sub>: OK (<n> checks)" and exits 0. Failure prints one
// "FAIL <sub>: <reason>" line per failed check and exits 1. An unknown subcommand or flag prints
// the usage on stderr and exits 2. New subcommands are added with one entry in COMMANDS.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUIDE_PATH = 'docs/m365/GUIA-ADMIN-ENTRA.md';
const RUNBOOK_PATH = 'docs/m365/RUNBOOK-entra-app.md';
const SPIKE_DIR = 'tests/Tools/m365-spike';

export const SCOPES = 'openid profile email offline_access User.Read Calendars.Read';

export const REDIRECT_URIS = {
    dokploy: 'https://<DOMINIO-DOKPLOY>/auth/microsoft/callback',
    local: 'https://solidtime.test/auth/microsoft/callback',
    localhost: 'http://localhost/auth/microsoft/callback',
    spike: 'http://localhost/m365-spike/callback',
};

// Shapes that must never be committed: a JWT, an Entra client-secret value and an assignment of
// a token or secret. The regex literals do not match their own source text.
export const SECRET_PATTERNS = [
    /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/,
    /[A-Za-z0-9_.~-]{3}8Q~[A-Za-z0-9_.~-]{20,}/,
    /\b(?:access_token|refresh_token|client_secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~-]{16,}/i,
];

const SECRET_PATTERN_NAMES = ['JWT-shaped string', 'client-secret value shape', 'token assignment'];
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FOREIGN_EMAIL = /[A-Za-z0-9._%+-]+@(?!example\.test\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHASE_PREFIXES = [
    'docs/m365/',
    'tests/Tools/m365-spike/',
    'tests/Fixtures/M365/',
    'tests/Unit/M365/',
];
const FIXTURE_GUID_PREFIX = '00000000-0000-4000-8000-';
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// ---- helpers ----------------------------------------------------------------------------

const normalize = (text) => String(text).replace(/\r\n?/g, '\n');
const toPosix = (value) => value.split(path.sep).join('/');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function splitSections(text) {
    const sections = [];
    let current = null;
    for (const line of normalize(text).split('\n')) {
        if (/^## /.test(line)) {
            current = { heading: line.slice(3).trim(), lines: [] };
            sections.push(current);
        } else if (current) {
            current.lines.push(line);
        }
    }
    return sections.map((section) => ({
        heading: section.heading,
        body: section.lines.join('\n'),
    }));
}

function findSection(sections, name) {
    const pattern = new RegExp(`^${escapeRegExp(name)}(?!\\d)`);
    return sections.find((section) => pattern.test(section.heading));
}

function stripMarkup(value) {
    return value.replace(/[`*]/g, '').trim();
}

function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(stripMarkup(value ?? ''));
    if (!match) {
        return null;
    }
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(time);
    const valid =
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3]);
    return valid ? time : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function findSecretPatternHits(line) {
    const hits = [];
    SECRET_PATTERNS.forEach((pattern, index) => {
        if (pattern.test(line)) {
            hits.push(SECRET_PATTERN_NAMES[index]);
        }
    });
    return hits;
}

// ---- guide ------------------------------------------------------------------------------

const CORE_PARTES = [1, 2, 3, 4, 5, 10];
const PARTE_SUBLABELS = ['Qué hacer', 'Por qué', 'Cómo comprobarlo'];

const CORE_ENGLISH_LABELS = [
    'App registrations',
    'New registration',
    'Single tenant only',
    'Authentication',
    'Web',
    'API permissions',
    'Delegated permissions',
    'Grant admin consent',
    'Certificates & secrets',
    'New client secret',
    'Enterprise apps',
    'Assignment required?',
    'Users and groups',
    'Enabled for users to sign-in?',
];

const CORE_REQUIRED_TEXT = [
    ['AADSTS50105', /AADSTS50105/],
    ['Administrador global', /Administrador global/],
    ['P1', /\bP1\b/],
    ['P2', /\bP2\b/],
    ['Valor', /\bValor\b/],
    ['Secret ID', /Secret ID/],
    ['tres primeros caracteres', /tres primeros caracteres/],
    ['180 días', /180 días/],
    ['45 días', /45 días/],
    ['gestor de contraseñas', /gestor de contraseñas/],
];

const ALLOWED_SCOPE_TOKENS = new Set(['User.Read', 'Calendars.Read']);
const GRAPH_SCOPE_TOKEN =
    /\b[A-Z][A-Za-z]+\.(?:ReadWrite|ReadBasic|Read|Send|Write|All)(?:\.[A-Za-z]+)?\b/g;
const NEGATION = /\b(?:NO|NOT|NUNCA|nunca|never|ni|no)\b/;

// Lines that name something the guide must only mention to forbid it.
const FORBIDDEN_MENTIONS = [
    [/Application permissions|Permisos de (?:la )?aplicación/, 'Application permissions'],
    [/Single-page application|Aplicación de página única/, 'Single-page application platform'],
    [/Mobile and desktop applications|Aplicaciones móviles y de escritorio/, 'Mobile platform'],
];

function hasEnglishLabel(text, label) {
    return new RegExp(`\\([^()\\n]*${escapeRegExp(label)}[^()\\n]*\\)`).test(text);
}

function hasHeading(text, name) {
    return new RegExp(`^## ${escapeRegExp(name)}(?!\\d)`, 'm').test(text);
}

function checkMarkedLines(checker, lines, needle, label) {
    const unmarked = lines.filter(
        (line) => line.includes(needle) && !/TEMPORAL|RETIRADO/.test(line)
    );
    checker.check(
        unmarked.length === 0,
        `${label}: cada línea que menciona ${needle} debe llevar TEMPORAL o RETIRADO ` +
            `(${unmarked.length} sin marcar)`
    );
}

function coreGuideChecks(checker, text) {
    const lines = normalize(text).split('\n');
    const sections = splitSections(text);

    checker.check(hasHeading(text, 'Preparación'), 'falta el encabezado "## Preparación"');
    for (const n of CORE_PARTES) {
        checker.check(hasHeading(text, `Parte ${n}`), `falta el encabezado "## Parte ${n}"`);
    }
    for (const section of sections.filter((s) => /^Parte \d+\b/.test(s.heading))) {
        for (const sublabel of PARTE_SUBLABELS) {
            checker.check(
                section.body.includes(sublabel),
                `"${section.heading}" no contiene el sub-bloque "${sublabel}"`
            );
        }
    }

    // The string must end at a token boundary: "...Calendars.ReadWrite" is not the scope string.
    checker.check(
        new RegExp(`${escapeRegExp(SCOPES)}(?![A-Za-z0-9.])`).test(text),
        `falta la cadena exacta de permisos: ${SCOPES}`
    );
    for (const uri of [REDIRECT_URIS.local, REDIRECT_URIS.localhost]) {
        checker.check(text.includes(uri), `falta el URI de redirección ${uri}`);
    }
    const callbackHosts = [
        ...text.matchAll(/https:\/\/(<DOMINIO-DOKPLOY>|[A-Za-z0-9.-]+)\/auth\/microsoft\/callback/g),
    ].map((match) => match[1]);
    checker.check(
        callbackHosts.some(
            (host) =>
                host === '<DOMINIO-DOKPLOY>' || (host.includes('.') && host !== 'solidtime.test')
        ),
        'falta el URI de redirección de Dokploy (https://<DOMINIO-DOKPLOY>/auth/microsoft/callback ' +
            'o un dominio concreto)'
    );
    checker.check(
        text.includes(REDIRECT_URIS.spike),
        `falta el URI temporal ${REDIRECT_URIS.spike}`
    );
    checkMarkedLines(checker, lines, 'm365-spike/callback', 'URI temporal del spike');
    checkMarkedLines(checker, lines, 'spike-AAAA-MM', 'secreto spike');

    for (const label of CORE_ENGLISH_LABELS) {
        checker.check(hasEnglishLabel(text, label), `falta la etiqueta en inglés "(${label})"`);
    }

    const publicClientLines = lines.filter((line) => line.includes('Allow public client flows'));
    checker.check(
        publicClientLines.every((line) => /\bNo\b/.test(line) && !/=\s*(?:Yes|Sí)\b/.test(line)),
        'toda línea con "Allow public client flows" debe indicar = No'
    );

    for (const [label, pattern] of CORE_REQUIRED_TEXT) {
        checker.check(pattern.test(text), `falta el texto obligatorio "${label}"`);
    }

    const scopeOffenders = new Set();
    for (const line of lines) {
        for (const token of line.match(GRAPH_SCOPE_TOKEN) ?? []) {
            if (!ALLOWED_SCOPE_TOKENS.has(token) && !NEGATION.test(line)) {
                scopeOffenders.add(token);
            }
        }
    }
    checker.check(
        scopeOffenders.size === 0,
        `permisos de Graph fuera de los seis delegados, sin negar: ${[...scopeOffenders].join(', ')}`
    );
    for (const [pattern, label] of FORBIDDEN_MENTIONS) {
        const offenders = lines.filter((line) => pattern.test(line) && !NEGATION.test(line));
        checker.check(
            offenders.length === 0,
            `la guía menciona "${label}" sin prohibirlo expresamente (${offenders.length} líneas)`
        );
    }
    const implicitOffenders = lines.filter(
        (line) =>
            /Access tokens|ID tokens/.test(line) &&
            !/desmarc|sin marcar|unchecked|sin activar/i.test(line)
    );
    checker.check(
        implicitOffenders.length === 0,
        'las casillas de concesión implícita (Access tokens / ID tokens) deben aparecer desmarcadas'
    );

    checker.check(!new RegExp(GUID.source, 'i').test(text), 'la guía contiene un GUID');
    checker.check(
        !new RegExp(FOREIGN_EMAIL.source).test(text),
        'la guía contiene una dirección de correo que no es @example.test'
    );
    checker.check(
        !lines.some((line) => findSecretPatternHits(line).length > 0),
        'la guía contiene algo con forma de secreto, token o contraseña'
    );
}

const GUIDE_CHECKS = [coreGuideChecks];

function runGuideChecks(text) {
    const checker = createChecker();
    for (const run of GUIDE_CHECKS) {
        run(checker, text);
    }
    return checker.result();
}

export function checkGuide(text) {
    return runGuideChecks(text).reasons;
}

// ---- runbook ----------------------------------------------------------------------------

const RUNBOOK_HEADINGS = [
    'Valores del registro',
    'Verificación',
    'Renovación del secreto',
    'Limpieza tras el spike',
    'Historial',
];

const RUNBOOK_KEYS = [
    'Directory (tenant) ID',
    'Application (client) ID',
    'Redirect URIs',
    'Scopes delegados',
    'Grupo asignado',
    'Modo de asignación',
    'Caducidad del secreto de producción',
    'Recordatorio de renovación',
    'Responsable del recordatorio',
    'Caducidad del secreto spike',
    'Acceso condicional',
    'Dominio Dokploy',
];

const PROD_SECRET_LABEL = 'Secreto de producción';

// Maps a Parte 10 checklist item marked "(runbook)" to the runbook slot(s) that hold it.
const HAND_BACK_SLOTS = [
    { test: /directory \(tenant\) id/i, slots: [{ row: 'Directory (tenant) ID' }] },
    { test: /application \(client\) id/i, slots: [{ row: 'Application (client) ID' }] },
    {
        test: /grupo asignado/i,
        slots: [{ row: 'Grupo asignado' }, { row: 'Modo de asignación' }],
    },
    {
        test: /caducidad del secreto de producción/i,
        slots: [{ row: 'Caducidad del secreto de producción' }],
    },
    {
        test: /recordatorio/i,
        slots: [{ row: 'Recordatorio de renovación' }, { row: 'Responsable del recordatorio' }],
    },
    { test: /comprobación del valor/i, slots: [{ verification: PROD_SECRET_LABEL }] },
    { test: /caducidad del secreto spike/i, slots: [{ row: 'Caducidad del secreto spike' }] },
    { test: /acceso condicional/i, slots: [{ row: 'Acceso condicional' }] },
    { test: /dominio dokploy/i, slots: [{ row: 'Dominio Dokploy' }] },
];

function parseValuesTable(body) {
    const rows = normalize(body)
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .map((line) =>
            line
                .trim()
                .replace(/^\||\|$/g, '')
                .split('|')
                .map((cell) => cell.trim())
        )
        .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
    const values = new Map();
    const duplicates = [];
    for (const cells of rows.slice(1)) {
        const key = stripMarkup(cells[0]);
        if (values.has(key)) {
            duplicates.push(key);
        }
        values.set(key, cells[1] ?? '');
    }
    return { values, duplicates };
}

function finalRunbookChecks(checker, { values, verification, today }) {
    const pending = (text) => /PENDIENTE/.test(text);
    const pendingKeys = [...values].filter(([, value]) => pending(value)).map(([key]) => key);
    checker.check(
        pendingKeys.length === 0,
        `quedan valores PENDIENTE en la tabla: ${pendingKeys.join(', ')}`
    );
    checker.check(!pending(verification), '## Verificación todavía contiene PENDIENTE');

    const guid = new RegExp(`^${GUID.source}$`, 'i');
    for (const key of ['Directory (tenant) ID', 'Application (client) ID']) {
        checker.check(guid.test(stripMarkup(values.get(key) ?? '')), `${key} debe ser un GUID`);
    }

    const dates = {};
    for (const key of [
        'Caducidad del secreto de producción',
        'Recordatorio de renovación',
        'Caducidad del secreto spike',
    ]) {
        dates[key] = parseIsoDate(values.get(key));
        checker.check(dates[key] !== null, `${key} debe empezar por una fecha ISO AAAA-MM-DD`);
    }
    const expiry = dates['Caducidad del secreto de producción'];
    const reminder = dates['Recordatorio de renovación'];
    const todayTime = parseIsoDate(today);
    if (expiry !== null && reminder !== null) {
        checker.check(
            expiry - reminder >= 30 * DAY_MS,
            'el recordatorio debe estar al menos 30 días antes de la caducidad del secreto de producción'
        );
    }
    if (expiry !== null && todayTime !== null) {
        checker.check(expiry > todayTime, 'el secreto de producción ya está caducado');
        checker.check(
            expiry - todayTime <= 730 * DAY_MS,
            'la caducidad del secreto de producción supera los 730 días desde hoy'
        );
    }

    checker.check(
        stripMarkup(values.get('Scopes delegados') ?? '') === SCOPES,
        `Scopes delegados debe ser exactamente: ${SCOPES}`
    );
    const redirects = values.get('Redirect URIs') ?? '';
    checker.check(
        redirects.includes(REDIRECT_URIS.local) && redirects.includes(REDIRECT_URIS.localhost),
        'Redirect URIs debe contener los dos URI locales permanentes'
    );
    const hosts = [...redirects.matchAll(/https:\/\/([A-Za-z0-9.-]+)\/auth\/microsoft\/callback/g)];
    checker.check(
        !redirects.includes('<DOMINIO-DOKPLOY>') &&
            hosts.some((match) => match[1].includes('.') && match[1] !== 'solidtime.test'),
        'Redirect URIs debe contener un dominio Dokploy concreto (sin <DOMINIO-DOKPLOY>)'
    );

    checker.check(parseIsoDate(/\d{4}-\d{2}-\d{2}/.exec(verification)?.[0]) !== null, [
        '## Verificación debe contener una fecha ISO',
    ]);
    checker.check(
        verification.includes('scopeMatches'),
        '## Verificación debe contener scopeMatches'
    );
    checker.check(
        verification.includes('AADSTS50105'),
        '## Verificación debe contener AADSTS50105'
    );
    const prodLine = prodSecretLine(verification) ?? '';
    checker.check(
        /\d{4}-\d{2}-\d{2}/.test(prodLine) &&
            prodLine.includes('Fase 2') &&
            prodLine.includes('AADSTS7000215'),
        `la línea "- ${PROD_SECRET_LABEL}:" debe llevar la fecha ISO de la comprobación del Valor, ` +
            '"Fase 2" y AADSTS7000215'
    );
}

function prodSecretLine(verification) {
    return normalize(verification)
        .split('\n')
        .find((line) => line.startsWith(`- ${PROD_SECRET_LABEL}:`));
}

export function checkRunbook(text, { final = false, today, guideText } = {}) {
    return runRunbookChecks(text, { final, today, guideText }).reasons;
}

function runRunbookChecks(text, { final, today, guideText }) {
    const checker = createChecker();
    const sections = splitSections(text);
    for (const heading of RUNBOOK_HEADINGS) {
        checker.check(
            Boolean(findSection(sections, heading)),
            `falta el encabezado "## ${heading}"`
        );
    }
    const valuesSection = findSection(sections, 'Valores del registro');
    const verification = findSection(sections, 'Verificación')?.body ?? '';
    const renewal = findSection(sections, 'Renovación del secreto')?.body ?? '';

    const { values, duplicates } = parseValuesTable(valuesSection?.body ?? '');
    const missing = RUNBOOK_KEYS.filter((key) => !values.has(key));
    const extra = [...values.keys()].filter((key) => !RUNBOOK_KEYS.includes(key));
    checker.check(
        missing.length === 0,
        `faltan filas en la tabla de valores: ${missing.join(', ')}`
    );
    checker.check(
        extra.length === 0,
        `filas desconocidas en la tabla de valores: ${extra.join(', ')}`
    );
    checker.check(duplicates.length === 0, `filas duplicadas: ${duplicates.join(', ')}`);
    const empty = [...values].filter(([, value]) => value.trim() === '').map(([key]) => key);
    checker.check(empty.length === 0, `filas sin valor (usa PENDIENTE): ${empty.join(', ')}`);

    checker.check(
        prodSecretLine(verification) !== undefined,
        `## Verificación debe contener una línea que empiece por "- ${PROD_SECRET_LABEL}:"`
    );
    checker.check(
        /spike/i.test(renewal) && renewal.includes('AADSTS7000222'),
        '## Renovación del secreto debe cubrir el secreto spike y mencionar AADSTS7000222'
    );

    handBackChecks(checker, { values, verification, guideText });
    if (final) {
        finalRunbookChecks(checker, { values, verification, today });
    }
    return checker.result();
}

function handBackChecks(checker, { values, verification, guideText }) {
    if (!guideText) {
        checker.check(
            false,
            'no se puede leer la guía: no se pueden comprobar los datos de entrega'
        );
        return;
    }
    const parte10 = findSection(splitSections(guideText), 'Parte 10');
    const items = normalize(parte10?.body ?? '')
        .split('\n')
        .map((line) => /^\s*[-*]\s*\[[ xX]\]\s*(.*\(runbook\).*)$/.exec(line)?.[1])
        .filter(Boolean);
    checker.check(
        items.length > 0,
        'la Parte 10 de la guía no tiene ningún elemento "(runbook)"'
    );
    for (const item of items) {
        const mapping = HAND_BACK_SLOTS.find((entry) => entry.test.test(item));
        if (!mapping) {
            checker.check(
                false,
                `el elemento de entrega "${item}" no tiene un hueco en el runbook`
            );
            continue;
        }
        for (const slot of mapping.slots) {
            const present = slot.row
                ? values.has(slot.row)
                : prodSecretLine(verification) !== undefined;
            checker.check(
                present,
                `el elemento de entrega "${item}" no tiene su ${
                    slot.row ? `fila "${slot.row}"` : `línea "${slot.verification}"`
                } en el runbook`
            );
        }
    }
}

// ---- secrets ----------------------------------------------------------------------------

export function isAllowedGuid(filePath, guid, line = '') {
    const posix = toPosix(filePath);
    if (posix.startsWith('tests/Fixtures/M365/')) {
        return guid.toLowerCase().startsWith(FIXTURE_GUID_PREFIX);
    }
    if (posix === RUNBOOK_PATH) {
        return /^\s*\|\s*[`*]*(?:Directory \(tenant\) ID|Application \(client\) ID)\b/.test(line);
    }
    return false;
}

export function scanSecrets(files) {
    const reasons = [];
    for (const file of files) {
        const filePath = toPosix(file.path);
        if (filePath === `${SPIKE_DIR}/.env.local` || filePath.startsWith(`${SPIKE_DIR}/raw/`)) {
            reasons.push(
                `${filePath}: no debería poder commitearse (falta ignorarlo en .gitignore)`
            );
        }
        const phaseOwned = PHASE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
        normalize(file.text)
            .split('\n')
            .forEach((line, index) => {
                const where = `${filePath}:${index + 1}`;
                for (const hit of findSecretPatternHits(line)) {
                    reasons.push(`${where}: ${hit}`);
                }
                if (!phaseOwned) {
                    return;
                }
                if (new RegExp(FOREIGN_EMAIL.source).test(line)) {
                    reasons.push(`${where}: dirección de correo que no es @example.test`);
                }
                for (const match of line.matchAll(GUID)) {
                    if (!isAllowedGuid(filePath, match[0], line)) {
                        reasons.push(`${where}: GUID no permitido en este fichero`);
                    }
                }
            });
    }
    return reasons;
}

function listCommittableFiles(root) {
    const output = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, maxBuffer: 256 * 1024 * 1024 }
    );
    return output.toString('utf8').split('\0').filter(Boolean);
}

function loadFiles(root, relPaths) {
    const files = [];
    for (const rel of relPaths) {
        const absolute = path.join(root, rel);
        const forbidden = rel === `${SPIKE_DIR}/.env.local` || rel.startsWith(`${SPIKE_DIR}/raw/`);
        if (/(^|\/)(?:node_modules|vendor)\//.test(rel) && !forbidden) {
            continue;
        }
        let stats;
        try {
            stats = statSync(absolute);
        } catch {
            continue;
        }
        if (!stats.isFile()) {
            continue;
        }
        if (stats.size > MAX_FILE_BYTES) {
            if (forbidden) {
                files.push({ path: rel, text: '' });
            }
            continue;
        }
        const buffer = readFileSync(absolute);
        if (buffer.includes(0)) {
            if (forbidden) {
                files.push({ path: rel, text: '' });
            }
            continue;
        }
        files.push({ path: rel, text: buffer.toString('utf8') });
    }
    return files;
}

// ---- gitignore --------------------------------------------------------------------------

export function checkGitignore(repoRoot) {
    return runGitignoreChecks(repoRoot).reasons;
}

function runGitignoreChecks(repoRoot) {
    const checker = createChecker();
    const file = path.join(repoRoot, SPIKE_DIR, '.gitignore');
    const exists = existsSync(file);
    checker.check(exists, `no existe ${SPIKE_DIR}/.gitignore`);
    if (!exists) {
        return checker.result();
    }
    const lines = normalize(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line) => line.trim());
    for (const required of ['raw/', '.env.local']) {
        checker.check(
            lines.includes(required),
            `${SPIKE_DIR}/.gitignore debe contener "${required}"`
        );
    }
    const expectations = [
        [`${SPIKE_DIR}/raw/probe.json`, 0, 'debe estar ignorado por git'],
        [`${SPIKE_DIR}/.env.local`, 0, 'debe estar ignorado por git'],
        [`${SPIKE_DIR}/.env.local.example`, 1, 'no debe estar ignorado por git'],
    ];
    for (const [rel, expected, message] of expectations) {
        const result = spawnSync('git', ['check-ignore', '-q', rel], { cwd: repoRoot });
        checker.check(
            result.status === expected,
            `${rel} ${message} (git check-ignore: ${result.status})`
        );
    }
    return checker.result();
}

// ---- CLI --------------------------------------------------------------------------------

function readText(root, rel) {
    const absolute = path.resolve(root, rel);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

function missingFile(rel) {
    return { reasons: [`no se encuentra ${rel}`], total: 1 };
}

const COMMANDS = {
    guide: {
        flags: { file: 'string' },
        run({ root, flags }) {
            const rel = flags.file ?? GUIDE_PATH;
            const text = readText(root, rel);
            return text === null ? missingFile(rel) : runGuideChecks(text);
        },
    },
    runbook: {
        flags: { final: 'boolean', file: 'string' },
        run({ root, flags }) {
            const rel = flags.file ?? RUNBOOK_PATH;
            const text = readText(root, rel);
            if (text === null) {
                return missingFile(rel);
            }
            return runRunbookChecks(text, {
                final: Boolean(flags.final),
                today: new Date().toISOString().slice(0, 10),
                guideText: readText(root, GUIDE_PATH),
            });
        },
    },
    secrets: {
        flags: { file: 'string' },
        run({ root, flags }) {
            const rels = flags.file ? [flags.file] : listCommittableFiles(root);
            const files = loadFiles(root, rels);
            const reasons = scanSecrets(files);
            return { reasons, total: files.length };
        },
    },
    gitignore: {
        flags: {},
        run({ root }) {
            return runGitignoreChecks(root);
        },
    },
};

function usage() {
    return (
        `Usage: node ${SPIKE_DIR}/validate-docs.mjs ` +
        `<${Object.keys(COMMANDS).join('|')}> [--final] [--file <path>]\n`
    );
}

function parseFlags(spec, args) {
    const flags = {};
    for (let i = 0; i < args.length; i += 1) {
        const name = args[i].startsWith('--') ? args[i].slice(2) : null;
        const kind = name === null ? undefined : spec[name];
        if (kind === 'boolean') {
            flags[name] = true;
        } else if (kind === 'string' && i + 1 < args.length) {
            i += 1;
            flags[name] = args[i];
        } else {
            return null;
        }
    }
    return flags;
}

export function main(
    argv,
    { root = REPO_ROOT, stdout = process.stdout, stderr = process.stderr } = {}
) {
    const [sub, ...rest] = argv;
    const command = Object.hasOwn(COMMANDS, sub ?? '') ? COMMANDS[sub] : undefined;
    const flags = command ? parseFlags(command.flags, rest) : null;
    if (!command || flags === null) {
        stderr.write(usage());
        return 2;
    }
    const { reasons, total } = command.run({ root, flags });
    if (reasons.length > 0) {
        stdout.write(reasons.map((reason) => `FAIL ${sub}: ${reason}\n`).join(''));
        return 1;
    }
    stdout.write(`${sub}: OK (${total} checks)\n`);
    return 0;
}

const isEntryPoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
    process.exitCode = main(process.argv.slice(2));
}
