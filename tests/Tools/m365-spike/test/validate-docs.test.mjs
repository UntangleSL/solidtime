import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    SCOPES,
    checkGuide,
    checkRunbook,
    isAllowedGuid,
    scanSecrets,
} from '../validate-docs.mjs';

// Every planted secret, JWT, GUID and foreign e-mail is assembled at runtime so that this
// source never matches the repo-wide patterns the `secrets` gate scans for.
const GUID_A = ['11111111', '2222', '4333', '8444', '555555555555'].join('-');
const GUID_B = ['66666666', '7777', '4888', '8999', 'aaaaaaaaaaaa'].join('-');
const FIXTURE_GUID = ['00000000', '0000', '4000', '8000', '0000000000ab'].join('-');
const FOREIGN_EMAIL = ['jane.doe', 'contoso.com'].join('@');
const TEST_EMAIL = ['person-1', 'example.test'].join('@');
const JWT = ['eyJ', 'hbGciOiJSUzI1NiJ9', '.eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0'].join('');
const SECRET_VALUE = ['abc', '8Q~', 'x'.repeat(30)].join('');
const ASSIGNMENT = ['client', '_secret', '=', 'q'.repeat(24)].join('');

const SPIKE_URI = 'http://localhost/m365-spike/callback';
const TODAY = '2026-10-19';

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

const HAND_BACK_ITEMS = [
    '- [ ] Directory (tenant) ID (runbook)',
    '- [ ] Application (client) ID (runbook)',
    '- [ ] Nombre del grupo asignado o "individual" (runbook)',
    '- [ ] Fecha de caducidad del secreto de producción (runbook)',
    '- [ ] Fecha del recordatorio y rol responsable (runbook)',
    '- [ ] Fecha de la comprobación del Valor del secreto de producción (runbook)',
    '- [ ] Fecha de caducidad del secreto spike (runbook)',
    '- [ ] Hallazgos de acceso condicional (runbook)',
    '- [ ] Dominio Dokploy registrado (runbook)',
    '- [ ] Secreto spike: solo por el gestor de contraseñas',
];

const SCENARIO_IDS = ['S1', 'S1b', 'S2', 'S3', 'S4', 'S5', 'S5b', 'S6', 'S6b', 'S7', 'S8'];
const ROUND_B_IDS = ['S2', 'S3', 'S4', 'S5', 'S5b'];

function parte(n, title, body = '') {
    return [
        `## Parte ${n} – ${title}`,
        '',
        '**Qué hacer**',
        '',
        body,
        '',
        '**Por qué**',
        '',
        'Una o dos frases de intención de seguridad.',
        '',
        '**Cómo comprobarlo**',
        '',
        'Lo que se ve en pantalla después.',
        '',
    ].join('\n');
}

function buildGuide({ handBack = HAND_BACK_ITEMS } = {}) {
    return [
        '# Guía',
        '',
        '## Preparación',
        '',
        'Un Administrador global se salta la asignación (AADSTS50105). Se necesita Entra ID P1 o P2.',
        '',
        parte(
            1,
            'Registro',
            'Registros de aplicaciones (App registrations), Nuevo registro (New registration), ' +
                'Solo este inquilino (Single tenant only).'
        ),
        parte(
            2,
            'URI de redirección',
            [
                'Autenticación (Authentication), plataforma Web (Web).',
                '- `https://<DOMINIO-DOKPLOY>/auth/microsoft/callback`',
                '- `https://solidtime.test/auth/microsoft/callback`',
                '- `http://localhost/auth/microsoft/callback`',
                `- \`${SPIKE_URI}\` TEMPORAL, solo para la herramienta de captura.`,
                'Permitir flujos de cliente público (Allow public client flows) = No.',
            ].join('\n')
        ),
        parte(
            3,
            'Permisos',
            [
                'Permisos de API (API permissions), Permisos delegados (Delegated permissions).',
                `Debe quedar exactamente: \`${SCOPES}\`.`,
                'Conceder consentimiento de administrador (Grant admin consent).',
            ].join('\n')
        ),
        parte(
            4,
            'Secretos',
            [
                'Certificados y secretos (Certificates & secrets), ' +
                    'Nuevo secreto de cliente (New client secret).',
                'Caducidad de 180 días y recordatorio 45 días antes.',
                'Copia el Valor, nunca el Secret ID; compara los tres primeros caracteres.',
                'Descripción `spike-AAAA-MM` (TEMPORAL).',
            ].join('\n')
        ),
        parte(
            5,
            'Aplicación empresarial',
            [
                'Aplicaciones empresariales (Enterprise apps).',
                '¿Asignación requerida? (Assignment required?) = Sí.',
                'Usuarios y grupos (Users and groups).',
                '¿Habilitado para que los usuarios inicien sesión? (Enabled for users to sign-in?)',
            ].join('\n')
        ),
        parte(
            6,
            'Acceso condicional',
            [
                'Acceso condicional (Conditional Access), ¿Qué Pasaría Si? (What If).',
                'Registros de inicio de sesión (Sign-in logs).',
            ].join('\n')
        ),
        parte(7, 'Usuarias de prueba', 'Outlook en la web: `https://outlook.office.com/calendar`.'),
        parte(
            8,
            'Escenarios (Ronda A)',
            [
                ...SCENARIO_IDS.map((id) => `- \`[M365-TEST ${id}] texto\``),
                'Todo el día (All day), Privado (Private).',
                'El cambio de hora es el domingo 2026-10-25.',
                'Ventana: 2026-10-19T00:00:00Z a 2026-11-16T00:00:00Z.',
                'Alternativa de marzo: sumar 22 semanas; el cambio es el domingo 2027-03-28.',
            ].join('\n')
        ),
        parte(
            9,
            'Modificaciones (Ronda B)',
            [
                'Este evento (This event). Este y todos los eventos siguientes',
                '(This and all following events).',
                ...ROUND_B_IDS.map((id) => `- ${id}: cambio.`),
            ].join('\n')
        ),
        parte(
            10,
            'Entrega',
            [
                'Nunca pegues un secreto fuera del gestor de contraseñas.',
                'Avisos: «Registro listo», «Ronda A lista» y «Ronda B lista».',
                ...handBack,
            ].join('\n')
        ),
    ].join('\n');
}

const KEYS = [
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

function skeletonValues() {
    const values = Object.fromEntries(KEYS.map((key) => [key, 'PENDIENTE']));
    values['Scopes delegados'] = `\`${SCOPES}\``;
    values['Redirect URIs'] = [
        '`https://<DOMINIO-DOKPLOY>/auth/microsoft/callback`',
        '`https://solidtime.test/auth/microsoft/callback`',
        '`http://localhost/auth/microsoft/callback`',
        `\`${SPIKE_URI}\` (TEMPORAL)`,
    ].join('<br>');
    return values;
}

function finalValues({ expiry = addDays(TODAY, 180), reminderGap = 45 } = {}) {
    return {
        ...skeletonValues(),
        'Directory (tenant) ID': GUID_A,
        'Application (client) ID': GUID_B,
        'Redirect URIs': [
            '`https://time.example.test/auth/microsoft/callback`',
            '`https://solidtime.test/auth/microsoft/callback`',
            '`http://localhost/auth/microsoft/callback`',
        ].join('<br>'),
        'Grupo asignado': 'staff-solidtime',
        'Modo de asignación': 'grupo',
        'Caducidad del secreto de producción': expiry,
        'Recordatorio de renovación': addDays(expiry, -reminderGap),
        'Responsable del recordatorio': 'Administrador M365',
        'Caducidad del secreto spike': addDays(TODAY, 180),
        'Acceso condicional': 'Sin directivas que afecten a la aplicación',
        'Dominio Dokploy': 'time.example.test',
    };
}

const PENDING_PROD_LINE =
    '- Secreto de producción: Valor comprobado por la admin (tres primeros caracteres): ' +
    'PENDIENTE. El token se obtiene en Fase 2, en el primer inicio de sesión de Microsoft ' +
    'en Dokploy; AADSTS7000215 significa valor incorrecto.';

const FINAL_PROD_LINE =
    '- Secreto de producción: Valor comprobado por la admin el 2026-10-19 ' +
    '(tres primeros caracteres). El token se obtiene en Fase 2, en el primer inicio de ' +
    'sesión de Microsoft en Dokploy; AADSTS7000215 significa valor incorrecto.';

const FINAL_VERIFICATION = [
    '- Fecha: 2026-10-20',
    '- scopeMatches: true',
    '- Usuaria fuera del grupo bloqueada con AADSTS50105.',
    FINAL_PROD_LINE,
].join('\n');

const PENDING_VERIFICATION = [
    '- Fecha: PENDIENTE',
    '- scopeMatches: PENDIENTE (AADSTS50105 para la usuaria B)',
    PENDING_PROD_LINE,
].join('\n');

function buildRunbook({
    values = skeletonValues(),
    verification = PENDING_VERIFICATION,
    renewal = 'Procedimiento. ### Secreto spike: si caduca (AADSTS7000222) se crea otro spike.',
} = {}) {
    const rows = KEYS.map((key) => `| ${key} | ${values[key]} |`);
    return [
        '# Runbook',
        '',
        '## Valores del registro',
        '',
        '| Clave | Valor |',
        '| --- | --- |',
        ...rows,
        '',
        '## Verificación',
        '',
        verification,
        '',
        '## Renovación del secreto',
        '',
        renewal,
        '',
        '## Limpieza tras el spike',
        '',
        '- [ ] Quitar el URI temporal.',
        '',
        '## Historial',
        '',
        '| Fecha | Cambio | Quién |',
        '| --- | --- | --- |',
        '',
    ].join('\n');
}

const GUIDE = buildGuide();

function finalOpts(extra = {}) {
    return { final: true, today: TODAY, guideText: GUIDE, ...extra };
}

function skeletonOpts(extra = {}) {
    return { final: false, today: TODAY, guideText: GUIDE, ...extra };
}

// ---- guide ------------------------------------------------------------------------------

test('guide: a complete minimal guide passes', () => {
    assert.deepEqual(checkGuide(GUIDE), []);
});

test('guide: Calendars.ReadWrite in place of Calendars.Read in the scope string fails', () => {
    const broken = GUIDE.replaceAll(
        SCOPES,
        SCOPES.replace('Calendars.Read', 'Calendars.ReadWrite')
    );
    const reasons = checkGuide(broken);
    assert.ok(reasons.length > 0);
    assert.ok(reasons.some((reason) => reason.includes('openid profile email')));
});

test('guide: a GUID fails', () => {
    const reasons = checkGuide(`${GUIDE}\nIdentificador ${GUID_A}\n`);
    assert.ok(reasons.some((reason) => /GUID/i.test(reason)));
});

test('guide: an e-mail outside example.test fails and an example.test e-mail passes', () => {
    assert.ok(checkGuide(`${GUIDE}\nEscribe a ${FOREIGN_EMAIL}\n`).length > 0);
    assert.deepEqual(checkGuide(`${GUIDE}\nEjemplo ${TEST_EMAIL}\n`), []);
});

test('guide: a Parte without Cómo comprobarlo fails', () => {
    const broken = GUIDE.replace('**Cómo comprobarlo**', '**Otra cosa**');
    const reasons = checkGuide(broken);
    assert.ok(reasons.some((reason) => reason.includes('Cómo comprobarlo')));
});

test('guide: a secret-shaped string fails', () => {
    assert.ok(checkGuide(`${GUIDE}\nSecreto ${SECRET_VALUE}\n`).length > 0);
});

test('guide: public client flows enabled fails', () => {
    const broken = GUIDE.replace(
        'Permitir flujos de cliente público (Allow public client flows) = No.',
        'Permitir flujos de cliente público (Allow public client flows) = Yes.'
    );
    assert.ok(checkGuide(broken).some((reason) => reason.includes('Allow public client flows')));
});

test('guide: spike URI line with TEMPORAL passes and with RETIRADO passes', () => {
    assert.deepEqual(checkGuide(GUIDE), []);
    const retired = GUIDE.replace(`${SPIKE_URI}\` TEMPORAL`, `${SPIKE_URI}\` RETIRADO 2026-11-20`)
        .replace('(TEMPORAL)', '(RETIRADO 2026-11-20)');
    assert.ok(retired.includes('RETIRADO 2026-11-20'));
    assert.deepEqual(checkGuide(retired), []);
});

test('guide: a spike URI line with neither marker fails', () => {
    const broken = GUIDE.replace(`${SPIKE_URI}\` TEMPORAL`, `${SPIKE_URI}\``);
    const reasons = checkGuide(broken);
    assert.ok(reasons.some((reason) => reason.includes('m365-spike/callback')));
});

test('guide: a spike-AAAA-MM line with neither marker fails', () => {
    const broken = GUIDE.replace(
        'Descripción `spike-AAAA-MM` (TEMPORAL).',
        'Descripción `spike-AAAA-MM`.'
    );
    const reasons = checkGuide(broken);
    assert.ok(reasons.some((reason) => reason.includes('spike-AAAA-MM')));
});

test('guide: an unmarked mention of Application permissions fails', () => {
    const reasons = checkGuide(`${GUIDE}\nAñade Application permissions (Calendars.ReadWrite).\n`);
    assert.ok(reasons.length > 0);
});

test('guide: a guide missing scenario S5b fails', () => {
    const broken = GUIDE.replaceAll('[M365-TEST S5b]', '[M365-TEST S5x]');
    assert.ok(checkGuide(broken).some((reason) => reason.includes('S5b')));
});

test('guide: a guide missing the March alternative fails', () => {
    const noDate = GUIDE.replaceAll('2027-03-28', '2027-03-xx');
    assert.ok(checkGuide(noDate).some((reason) => reason.includes('2027-03-28')));
    const noWeeks = GUIDE.replaceAll('22 semanas', 'varias semanas');
    assert.ok(checkGuide(noWeeks).some((reason) => reason.includes('22 semanas')));
});

test('guide: Partes 6 to 9 must exist and stay in order before Parte 10', () => {
    const noParte7 = GUIDE.replace('## Parte 7 –', '## Apartado 7 –');
    assert.ok(checkGuide(noParte7).some((reason) => reason.includes('Parte 7')));
    const swapped = GUIDE.replace('## Parte 6 –', '## Parte 99 –').replace(
        '## Parte 7 –',
        '## Parte 6 –'
    );
    assert.ok(checkGuide(swapped).some((reason) => reason.includes('orden')));
});

test('guide: Parte 9 must cover the Ronda B scenarios and Parte 10 the notifications', () => {
    const noS3 = GUIDE.replace('- S3: cambio.', '- Otro: cambio.');
    assert.ok(checkGuide(noS3).some((reason) => reason.includes('S3')));
    const noNotice = GUIDE.replaceAll('«Ronda B lista»', '«aviso final»');
    assert.ok(checkGuide(noNotice).some((reason) => reason.includes('Ronda B lista')));
});

// ---- runbook ----------------------------------------------------------------------------

test('runbook: the skeleton with PENDIENTE passes', () => {
    assert.deepEqual(checkRunbook(buildRunbook(), skeletonOpts()), []);
});

test('runbook: --final with PENDIENTE fails', () => {
    const reasons = checkRunbook(buildRunbook(), finalOpts());
    assert.ok(reasons.some((reason) => reason.includes('PENDIENTE')));
});

test('runbook: a complete final runbook passes', () => {
    const text = buildRunbook({ values: finalValues(), verification: FINAL_VERIFICATION });
    assert.deepEqual(checkRunbook(text, finalOpts()), []);
});

test('runbook: reminder 29 days before expiry fails and 45 days passes', () => {
    const tooLate = buildRunbook({
        values: finalValues({ reminderGap: 29 }),
        verification: FINAL_VERIFICATION,
    });
    assert.ok(checkRunbook(tooLate, finalOpts()).some((reason) => /30/.test(reason)));
    const fine = buildRunbook({
        values: finalValues({ reminderGap: 45 }),
        verification: FINAL_VERIFICATION,
    });
    assert.deepEqual(checkRunbook(fine, finalOpts()), []);
});

test('runbook: expiry 800 days after today fails', () => {
    const text = buildRunbook({
        values: finalValues({ expiry: addDays(TODAY, 800) }),
        verification: FINAL_VERIFICATION,
    });
    assert.ok(checkRunbook(text, finalOpts()).some((reason) => /730/.test(reason)));
});

test('runbook: --final whose secreto de producción line lacks an ISO date or Fase 2 fails', () => {
    const noDate = FINAL_VERIFICATION.replace('el 2026-10-19 ', '');
    const noPhase = FINAL_VERIFICATION.replace('Fase 2', 'la siguiente fase');
    for (const verification of [noDate, noPhase]) {
        const text = buildRunbook({ values: finalValues(), verification });
        const reasons = checkRunbook(text, finalOpts());
        assert.ok(reasons.some((reason) => reason.includes('Secreto de producción')));
    }
});

test('runbook: a renewal section without AADSTS7000222 fails in both modes', () => {
    const renewal = 'Procedimiento. ### Secreto spike: si caduca se crea otro spike.';
    const skeleton = buildRunbook({ renewal });
    assert.ok(checkRunbook(skeleton, skeletonOpts()).some((r) => r.includes('AADSTS7000222')));
    const final = buildRunbook({
        values: finalValues(),
        verification: FINAL_VERIFICATION,
        renewal,
    });
    assert.ok(checkRunbook(final, finalOpts()).some((r) => r.includes('AADSTS7000222')));
});

test('runbook: a Parte 10 (runbook) item with no runbook row or Verificación line fails', () => {
    const guide = buildGuide({
        handBack: [...HAND_BACK_ITEMS, '- [ ] Un dato inventado (runbook)'],
    });
    const reasons = checkRunbook(buildRunbook(), skeletonOpts({ guideText: guide }));
    assert.ok(reasons.some((reason) => reason.includes('Un dato inventado')));

    const withoutRow = buildRunbook().replace(/^\| Acceso condicional .*\n/m, '');
    const rowReasons = checkRunbook(withoutRow, skeletonOpts());
    assert.ok(rowReasons.some((reason) => reason.includes('Acceso condicional')));
});

test('runbook: a missing Verificación secreto de producción line fails', () => {
    const text = buildRunbook({ verification: '- Fecha: PENDIENTE' });
    assert.ok(
        checkRunbook(text, skeletonOpts()).some((reason) =>
            reason.includes('Secreto de producción')
        )
    );
});

// ---- secrets ----------------------------------------------------------------------------

test('scanSecrets: flags a planted JWT, secret value, assignment and foreign e-mail', () => {
    const files = [
        { path: 'docs/m365/a.md', text: `token ${JWT}` },
        { path: 'docs/m365/b.md', text: `valor ${SECRET_VALUE}` },
        { path: 'docs/other.md', text: ASSIGNMENT },
        { path: 'docs/m365/d.md', text: `correo ${FOREIGN_EMAIL}` },
    ];
    const reasons = scanSecrets(files);
    for (const path of files.map((file) => file.path)) {
        assert.ok(
            reasons.some((reason) => reason.includes(path)),
            `expected a finding for ${path}`
        );
    }
});

test('scanSecrets: a clean file list passes', () => {
    const files = [
        { path: 'docs/m365/a.md', text: `correo ${TEST_EMAIL}` },
        { path: 'app/Models/User.php', text: `contacto ${FOREIGN_EMAIL}` },
        { path: 'tests/Fixtures/M365/me.json', text: `{"id":"${FIXTURE_GUID}"}` },
    ];
    assert.deepEqual(scanSecrets(files), []);
});

test('scanSecrets: GUID rules for the runbook rows and the fixtures', () => {
    const runbookRow = `| Directory (tenant) ID | ${GUID_A} |`;
    const ok = [
        { path: 'docs/m365/RUNBOOK-entra-app.md', text: runbookRow },
        { path: 'tests/Fixtures/M365/me.json', text: FIXTURE_GUID },
    ];
    assert.deepEqual(scanSecrets(ok), []);
    const bad = [
        { path: 'docs/m365/RUNBOOK-entra-app.md', text: `| Grupo asignado | ${GUID_A} |` },
        { path: 'tests/Fixtures/M365/me.json', text: GUID_B },
        { path: 'docs/m365/GUIA-ADMIN-ENTRA.md', text: runbookRow },
    ];
    assert.equal(scanSecrets(bad).length, 3);
    assert.equal(isAllowedGuid('tests/Fixtures/M365/me.json', FIXTURE_GUID), true);
    assert.equal(isAllowedGuid('tests/Fixtures/M365/me.json', GUID_B), false);
});

test('scanSecrets: fails when .env.local or raw/ would be committed', () => {
    const files = [
        { path: 'tests/Tools/m365-spike/.env.local', text: 'M365_TENANT_ID=' },
        { path: 'tests/Tools/m365-spike/raw/probe.json', text: '{}' },
    ];
    assert.equal(scanSecrets(files).length, 2);
});

// ---- CLI --------------------------------------------------------------------------------

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'validate-docs.mjs');

function run(...args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('cli: an unknown subcommand prints usage on stderr and exits 2', () => {
    const result = run('unknown-sub');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage/i);
});

test('cli: guide fails loudly and names the file when it does not exist', () => {
    const result = run('guide', '--file', 'docs/m365/does-not-exist.md');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL guide: .*does-not-exist\.md/m);
});

test('cli: prints "<sub>: OK (<n> checks)" and exits 0 on a valid document', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'validate-docs-'));
    const file = join(dir, 'guide.md');
    writeFileSync(file, GUIDE);
    const result = run('guide', '--file', file);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^guide: OK \(\d+ checks\)$/m);
});
