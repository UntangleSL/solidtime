import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    DECISION_HEADINGS,
    SCOPES,
    checkDecisions,
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
    '- [ ] Modo de acceso: todo el tenant (asignación requerida = No) (runbook)',
    '- [ ] Dominios del tenant (runbook)',
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
        'Dominios: untanglegrowth.com (primario) y untangle.es.',
        'Sin Entra ID P1 o P2 no hay grupos; si alguien activa la asignación, el error es AADSTS50105.',
        'Un Administrador global también puede configurar.',
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
                '¿Asignación requerida? (Assignment required?) = No.',
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
    'Modo de acceso',
    'Dominios',
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
        'Modo de acceso': 'tenant',
        Dominios: 'untanglegrowth.com (primario), untangle.es',
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

const PENDING_B_LINE =
    '- Usuaria B (sin rol de administrador, no asignada) inicia sesión sin pantalla de permisos ' +
    'y recibe los seis permisos: PENDIENTE';

const FINAL_B_LINE =
    '- Usuaria B (sin rol de administrador, no asignada) inicia sesión sin pantalla de permisos ' +
    'y recibe los seis permisos: sí, comprobado el 2026-10-20';

const FINAL_VERIFICATION = [
    '- Fecha: 2026-10-20',
    '- scopeMatches: true',
    FINAL_B_LINE,
    FINAL_PROD_LINE,
].join('\n');

const PENDING_VERIFICATION = [
    '- Fecha: PENDIENTE',
    '- scopeMatches: PENDIENTE',
    PENDING_B_LINE,
    PENDING_PROD_LINE,
].join('\n');

const DOPPLER_SECTION = [
    'Proyecto `vps`, configuraciones `dev` y `prd`.',
    '',
    '| Configuración | Clave |',
    '| --- | --- |',
    '| prd | `SOLIDTIME_MICROSOFT_CLIENT_SECRET` |',
    '| dev | `SOLIDTIME_M365_SPIKE_CLIENT_SECRET` |',
    '| dev, prd | `SOLIDTIME_MICROSOFT_TENANT_ID` |',
    '| dev, prd | `SOLIDTIME_MICROSOFT_CLIENT_ID` |',
].join('\n');

function buildRunbook({
    values = skeletonValues(),
    verification = PENDING_VERIFICATION,
    renewal = 'Procedimiento. ### Secreto spike: si caduca (AADSTS7000222) se crea otro spike.',
    doppler = DOPPLER_SECTION,
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
        '## Doppler',
        '',
        doppler,
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

test('guide: Assignment required? = Sí or = Yes fails (tenant-wide access is the decision)', () => {
    for (const wrong of ['= Sí.', '= Yes.']) {
        const broken = GUIDE.replace(
            '(Assignment required?) = No.',
            `(Assignment required?) ${wrong}`
        );
        const reasons = checkGuide(broken);
        assert.ok(
            reasons.some((reason) => reason.includes('Assignment required?')),
            wrong
        );
    }
});

test('guide: every Assignment required? line must say No and the label must exist', () => {
    const extra = `${GUIDE}\nActiva ¿Asignación requerida? (Assignment required?) = Sí.\n`;
    assert.ok(checkGuide(extra).some((reason) => reason.includes('Assignment required?')));
    const unlabelled = GUIDE.replaceAll('Assignment required?', 'Asignación');
    assert.ok(checkGuide(unlabelled).some((reason) => reason.includes('Assignment required?')));
});

test('guide: both tenant domains must be named', () => {
    const noPrimary = GUIDE.replaceAll('untanglegrowth.com', 'otro-dominio.test');
    assert.ok(checkGuide(noPrimary).some((reason) => reason.includes('untanglegrowth.com')));
    const noSecond = GUIDE.replaceAll('untangle.es', 'otro-dominio.test');
    assert.ok(checkGuide(noSecond).some((reason) => reason.includes('untangle.es')));
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

test('runbook: the old group and assignment-mode rows are unknown rows now', () => {
    const text = buildRunbook().replace(
        '| Modo de acceso | PENDIENTE |',
        '| Grupo asignado | PENDIENTE |\n| Modo de asignación | PENDIENTE |\n| Modo de acceso | PENDIENTE |'
    );
    const reasons = checkRunbook(text, skeletonOpts());
    assert.ok(reasons.some((reason) => reason.includes('Grupo asignado')));
});

test('runbook: --final needs the B success line filled, not PENDIENTE', () => {
    const text = buildRunbook({
        values: finalValues(),
        verification: FINAL_VERIFICATION.replace(FINAL_B_LINE, PENDING_B_LINE),
    });
    const reasons = checkRunbook(text, finalOpts());
    assert.ok(reasons.some((reason) => reason.includes('Usuaria B')));
});

test('runbook: --final does not require AADSTS50105 any more', () => {
    assert.equal(FINAL_VERIFICATION.includes('AADSTS50105'), false);
    const text = buildRunbook({ values: finalValues(), verification: FINAL_VERIFICATION });
    assert.deepEqual(checkRunbook(text, finalOpts()), []);
});

test('runbook: a Verificación without the Usuaria B line fails in both modes', () => {
    const verification = PENDING_VERIFICATION.replace(`${PENDING_B_LINE}\n`, '');
    const skeleton = buildRunbook({ verification });
    assert.ok(checkRunbook(skeleton, skeletonOpts()).some((r) => r.includes('Usuaria B')));
    const final = buildRunbook({
        values: finalValues(),
        verification: FINAL_VERIFICATION.replace(`${FINAL_B_LINE}\n`, ''),
    });
    assert.ok(checkRunbook(final, finalOpts()).some((r) => r.includes('Usuaria B')));
});

test('runbook: --final needs Dominios with untanglegrowth.com and Modo de acceso tenant', () => {
    const noDomain = buildRunbook({
        values: { ...finalValues(), Dominios: 'untangle.es' },
        verification: FINAL_VERIFICATION,
    });
    assert.ok(checkRunbook(noDomain, finalOpts()).some((r) => r.includes('untanglegrowth.com')));
    const noMode = buildRunbook({
        values: { ...finalValues(), 'Modo de acceso': 'individual' },
        verification: FINAL_VERIFICATION,
    });
    assert.ok(checkRunbook(noMode, finalOpts()).some((r) => r.includes('Modo de acceso')));
});

test('runbook: a Doppler section naming vps and the four SOLIDTIME_ keys is required', () => {
    const missingSection = buildRunbook().replace('## Doppler', '## Otra cosa');
    assert.ok(checkRunbook(missingSection, skeletonOpts()).some((r) => r.includes('Doppler')));
    const missingKey = buildRunbook({
        doppler: DOPPLER_SECTION.replace('SOLIDTIME_MICROSOFT_CLIENT_ID', 'OTRA'),
    });
    assert.ok(
        checkRunbook(missingKey, skeletonOpts()).some((r) =>
            r.includes('SOLIDTIME_MICROSOFT_CLIENT_ID')
        )
    );
    const noProject = buildRunbook({ doppler: DOPPLER_SECTION.replace('`vps`', 'otro') });
    assert.ok(checkRunbook(noProject, skeletonOpts()).some((r) => r.includes('vps')));
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
        { path: 'docs/m365/RUNBOOK-entra-app.md', text: `| Modo de acceso | ${GUID_A} |` },
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

// ---- decisions --------------------------------------------------------------------------

const READBASIC = '## Calendars.ReadBasic (informational)';
const SCENARIO_CITATION = '`tests/Fixtures/M365/scenarios/S2.roundA.json`';

function defaultDecisionLines(heading) {
    return [`Decision: Rule for ${heading.slice(3)}.`, `Evidence: ${SCENARIO_CITATION}`];
}

function buildDecisions({ skip = [], rename = {}, lines = {}, extra = [] } = {}) {
    const out = ['# Decisions for the Graph sync', ''];
    for (const heading of DECISION_HEADINGS) {
        if (skip.includes(heading)) {
            continue;
        }
        out.push(rename[heading] ?? heading, '');
        out.push(...(lines[heading] ?? defaultDecisionLines(heading)), '');
    }
    out.push(...extra);
    return out.join('\n');
}

test('decisions: the twelve required headings are exported in order', () => {
    assert.equal(DECISION_HEADINGS.length, 12);
    assert.equal(DECISION_HEADINGS[0], '## Occurrence key');
    assert.equal(DECISION_HEADINGS[10], READBASIC);
    assert.equal(DECISION_HEADINGS[11], '## Corrections to earlier research');
});

test('decisions: a document with every section, Decision and Evidence line passes', () => {
    assert.deepEqual(checkDecisions(buildDecisions()), []);
});

test('decisions: extra sections are allowed', () => {
    const text = buildDecisions({ extra: ['## Open questions', '', 'Nothing yet.', ''] });
    assert.deepEqual(checkDecisions(text), []);
});

test('decisions: removing any required heading fails and names it', () => {
    for (const heading of DECISION_HEADINGS) {
        const reasons = checkDecisions(buildDecisions({ skip: [heading] }));
        assert.ok(
            reasons.some((reason) => reason.includes(heading)),
            `expected a reason naming ${heading}`
        );
    }
});

test('decisions: a heading with different text fails', () => {
    const text = buildDecisions({ rename: { '## Series key': '## Series Key' } });
    assert.ok(checkDecisions(text).some((reason) => reason.includes('## Series key')));
});

test('decisions: a required heading that appears twice fails', () => {
    const text = buildDecisions({ extra: ['## Series key', '', ...defaultDecisionLines('## x')] });
    assert.ok(checkDecisions(text).some((reason) => reason.includes('## Series key')));
});

test('decisions: a section without a Decision line fails and names the section', () => {
    const heading = '## Moved meetings';
    const text = buildDecisions({ lines: { [heading]: [`Evidence: ${SCENARIO_CITATION}`] } });
    const reasons = checkDecisions(text);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(heading) && reasons[0].includes('Decision:'));
});

test('decisions: a section without an Evidence line fails and names the section', () => {
    const heading = '## Private meetings';
    const text = buildDecisions({ lines: { [heading]: ['Decision: Keep them.'] } });
    const reasons = checkDecisions(text);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(heading) && reasons[0].includes('Evidence:'));
});

test('decisions: an Evidence line with an unbackticked fixture path fails', () => {
    const heading = '## All-day events';
    const bare = 'Evidence: tests/Fixtures/M365/scenarios/S6.roundA.json';
    const text = buildDecisions({ lines: { [heading]: ['Decision: Keep them.', bare] } });
    assert.ok(checkDecisions(text).some((reason) => reason.includes(heading)));
});

test('decisions: an Evidence path outside tests/Fixtures/M365/ does not count', () => {
    const heading = '## Occurrence key';
    const other = 'Evidence: `docs/m365/notes.md`';
    const text = buildDecisions({ lines: { [heading]: ['Decision: Use the id.', other] } });
    assert.ok(checkDecisions(text).some((reason) => reason.includes(heading)));
});

test('decisions: one Evidence line with a fixture path is enough among several', () => {
    const heading = '## Occurrence key';
    const notes = 'Evidence: see notes';
    const lines = ['Decision: Use the id.', notes, `Evidence: ${SCENARIO_CITATION}`];
    assert.deepEqual(checkDecisions(buildDecisions({ lines: { [heading]: lines } })), []);
});

test('decisions: the ReadBasic section may cite a learn.microsoft.com URL instead', () => {
    const url = 'Evidence: https://learn.microsoft.com/en-us/graph/permissions-reference';
    const text = buildDecisions({ lines: { [READBASIC]: ['Decision: Informational.', url] } });
    assert.deepEqual(checkDecisions(text), []);
});

test('decisions: any other section citing only a URL fails', () => {
    const heading = '## Series key';
    const url = 'Evidence: https://learn.microsoft.com/en-us/graph/api/event-get';
    const text = buildDecisions({ lines: { [heading]: ['Decision: Use it.', url] } });
    const reasons = checkDecisions(text);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(heading));
});

test('decisions: a URL from another host does not satisfy the ReadBasic section', () => {
    const url = 'Evidence: https://example.test/permissions';
    const text = buildDecisions({ lines: { [READBASIC]: ['Decision: Informational.', url] } });
    assert.ok(checkDecisions(text).some((reason) => reason.includes(READBASIC)));
});

test('decisions: CRLF line endings are accepted', () => {
    assert.deepEqual(checkDecisions(buildDecisions().replace(/\n/g, '\r\n')), []);
});

// ---- decisions --trace ------------------------------------------------------------------

const PAGE = 'calendarview/roundA.prod-select.page-1.json';
const MANIFEST = {
    captured_at: { A: '2026-10-20T10:00:00Z', B: '2026-10-26T10:00:00Z' },
    window: { start: '2026-10-19T00:00:00Z', end: '2026-10-31T00:00:00Z' },
    outlook_client: 'owa',
    mailbox_timezone: 'W. Europe Standard Time',
    files: {
        me: 'me.json',
        token_shape: 'token-response.shape.json',
        calendarview: {
            A: {
                'prod-select': {
                    pages: [PAGE],
                    requests: 'calendarview/roundA.prod-select.requests.json',
                    complete: true,
                },
            },
        },
        id_format: { A: 'calendarview/roundA.id-format.json' },
        series: { A: { S3: { master: 'series/S3.master.roundA.json' } } },
        lookups: { B: { S3: 'lookups/S3.roundB.json' } },
    },
    scenarios: {
        S2: {
            extra: false,
            synthetic: false,
            round_a: { files: ['scenarios/S2.roundA.json'], present: true, count: 1 },
            round_b: {
                files: ['scenarios/S2.roundB.json'],
                present: true,
                count: 1,
                id_equal: true,
                lookup: null,
            },
            observed: 'It moved.',
        },
        S3: {
            extra: false,
            synthetic: false,
            round_a: { files: ['scenarios/S3.roundA.json'], present: true, count: 1 },
            round_b: {
                files: [],
                present: false,
                count: 0,
                id_equal: null,
                lookup: { file: 'lookups/S3.roundB.json', status: 404, isCancelled: null },
            },
            observed: 'It disappeared.',
        },
        'SYN-confidential': {
            extra: true,
            synthetic: true,
            round_a: { files: ['scenarios/SYN-confidential.json'], present: true, count: 1 },
        },
    },
    experiments: {
        prefer_combined: { status: 200, utc_on_all_pages: true },
        select_experiment: { status: 400, error_code: 'ErrorInvalidProperty' },
        full_shape_properties: ['body', 'subject'],
        series_master: null,
    },
};

const S2_PATH = 'tests/Fixtures/M365/scenarios/S2.roundA.json';
const S2_B_PATH = 'tests/Fixtures/M365/scenarios/S2.roundB.json';
const S3_PATH = 'tests/Fixtures/M365/scenarios/S3.roundA.json';

function traceDoc(...extra) {
    return buildDecisions({
        lines: {
            '## Occurrence key': ['Decision: Use the id.', `Evidence: \`${S2_PATH}\``, ...extra],
        },
    });
}

function trace(text, overrides = {}) {
    return checkDecisions(text, {
        trace: true,
        manifest: MANIFEST,
        exists: () => true,
        ...overrides,
    });
}

const S3_CLAIMS = ['Claim: S3.round_b.present = false', 'Claim: S3.round_b.lookup.status = 404'];

test('decisions --trace: a document citing every path and scenario with true Claims passes', () => {
    const text = traceDoc(...S3_CLAIMS, 'Claim: experiments.select_experiment.status = 400');
    assert.deepEqual(trace(text), []);
});

test('decisions --trace: the structure checks still run', () => {
    const text = buildDecisions({ skip: ['## Series key'], extra: S3_CLAIMS });
    assert.ok(trace(text).some((reason) => reason.includes('## Series key')));
});

test('decisions --trace: a cited path that does not exist fails and names it', () => {
    const text = traceDoc(...S3_CLAIMS);
    const reasons = trace(text, { exists: (path) => path !== S2_PATH });
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(S2_PATH));
});

test('decisions --trace: a cited path that exists but is not in the manifest fails', () => {
    const stray = 'tests/Fixtures/M365/scenarios/S9.roundA.json';
    const text = traceDoc(...S3_CLAIMS, `Evidence: \`${stray}\``);
    const reasons = trace(text);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes(stray));
});

test('decisions --trace: paths reachable through the files index or a lookup count', () => {
    const cited = [PAGE, 'lookups/S3.roundB.json', 'series/S3.master.roundA.json', 'me.json'];
    const lines = cited.map((path) => `Evidence: \`tests/Fixtures/M365/${path}\``);
    assert.deepEqual(trace(traceDoc(...lines)), []);
});

test('decisions --trace: the Round B scenario files count as manifest paths', () => {
    const text = traceDoc(`Evidence: \`${S2_B_PATH}\``, ...S3_CLAIMS);
    assert.deepEqual(trace(text), []);
});

test('decisions --trace: a path that climbs out of the fixtures directory fails', () => {
    const sneaky = 'tests/Fixtures/M365/../M365/scenarios/S2.roundA.json';
    const reasons = trace(traceDoc(...S3_CLAIMS, `Evidence: \`${sneaky}\``));
    assert.ok(reasons.some((reason) => reason.includes(sneaky)));
});

test('decisions --trace: a non-synthetic scenario that is never cited fails', () => {
    const reasons = trace(traceDoc());
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes('S3'));
});

test('decisions --trace: the synthetic scenario needs no citation', () => {
    assert.ok(!trace(traceDoc(...S3_CLAIMS)).some((reason) => reason.includes('SYN-')));
});

test('decisions --trace: a scenario is cited by a path of its own files', () => {
    assert.deepEqual(trace(traceDoc(`Evidence: \`${S3_PATH}\``)), []);
});

test('decisions --trace: a scenario is cited by a Claim that starts with its id', () => {
    assert.deepEqual(trace(traceDoc('Claim: S3.round_a.count = 1')), []);
});

test('decisions --trace: a path of another scenario does not cite this one', () => {
    const text = traceDoc(`Evidence: \`${S2_B_PATH}\``);
    assert.ok(trace(text).some((reason) => reason.includes('S3')));
});

test('decisions --trace: a Claim that disagrees with the manifest fails with both values', () => {
    const reasons = trace(traceDoc('Claim: S3.round_b.present = true'));
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes('Claim: S3.round_b.present = true'));
    assert.ok(reasons[0].includes('false'));
});

test('decisions --trace: Claims match booleans, numbers, strings, null and structures', () => {
    const claims = [
        'Claim: S3.round_b.present = false',
        'Claim: S3.round_b.count = 0',
        'Claim: S3.round_b.lookup.status = 404',
        'Claim: S3.round_b.lookup.isCancelled = null',
        'Claim: experiments.select_experiment.status = 400',
        'Claim: experiments.select_experiment.error_code = "ErrorInvalidProperty"',
        'Claim: experiments.select_experiment.error_code = ErrorInvalidProperty',
        'Claim: experiments.prefer_combined = {"status": 200, "utc_on_all_pages": true}',
        'Claim: experiments.full_shape_properties = ["body","subject"]',
        'Claim: experiments.full_shape_properties.1 = subject',
        'Claim: experiments.series_master = null',
        'Claim: S2.round_a.files = ["scenarios/S2.roundA.json"]',
    ];
    assert.deepEqual(trace(traceDoc(...claims, ...S3_CLAIMS)), []);
});

test('decisions --trace: a number never matches a different number or a quoted string', () => {
    for (const claim of [
        'Claim: experiments.select_experiment.status = 401',
        'Claim: experiments.select_experiment.status = "400"',
        'Claim: experiments.select_experiment.error_code = Other',
        'Claim: experiments.select_experiment.error_code = 400',
    ]) {
        const reasons = trace(traceDoc(claim, ...S3_CLAIMS));
        assert.equal(reasons.length, 1, claim);
        assert.ok(reasons[0].includes(claim));
    }
});

test('decisions --trace: a Claim about an unknown scenario fails instead of being skipped', () => {
    const reasons = trace(traceDoc('Claim: S9.round_a.present = true', ...S3_CLAIMS));
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes('S9'));
});

test('decisions --trace: a Claim with an unknown path fails instead of being skipped', () => {
    for (const claim of [
        'Claim: experiments.nope = 1',
        'Claim: S2.round_b.nope = 1',
        'Claim: S2.observed.length = 9',
        'Claim: S2.__proto__ = 1',
        'Claim: experiments.constructor = 1',
        'Claim: S2.round_a..count = 1',
    ]) {
        const reasons = trace(traceDoc(claim, ...S3_CLAIMS));
        assert.equal(reasons.length, 1, claim);
        assert.ok(reasons[0].includes(claim));
    }
});

test('decisions --trace: a line that starts with Claim: but breaks the syntax fails', () => {
    for (const claim of [
        'Claim: S3.round_b.present',
        'Claim: S3 round_b.present = false',
        'Claim: S3.round_b.present=false',
        'Claim: SYN-confidential.round_a.count = 1',
        'Claim: = false',
    ]) {
        const reasons = trace(traceDoc(claim, ...S3_CLAIMS));
        assert.equal(reasons.length, 1, claim);
        assert.ok(reasons[0].includes(claim));
    }
});

test('decisions --trace: without a manifest the check fails and names the manifest', () => {
    const reasons = checkDecisions(traceDoc(...S3_CLAIMS), { trace: true, manifest: null });
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].toLowerCase().includes('manifiesto'));
});

test('decisions: without --trace Claims and cited paths are not compared', () => {
    const text = traceDoc('Claim: S9.nope = 1', 'Evidence: `tests/Fixtures/M365/nope.json`');
    assert.deepEqual(checkDecisions(text), []);
    assert.deepEqual(checkDecisions(text, { trace: false, manifest: MANIFEST }), []);
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

test('cli: decisions fails loudly and names the file when the document does not exist', () => {
    const result = run('decisions', '--file', 'docs/m365/does-not-exist.md');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL decisions: .*does-not-exist\.md/m);
});

test('cli: decisions without --file fails on a tree without the document and names it', () => {
    const result = run('decisions');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL decisions: .*DECISIONS-graph\.md/m);
});

test('cli: decisions prints OK and exits 0 on a valid document', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'validate-docs-'));
    const file = join(dir, 'decisions.md');
    writeFileSync(file, buildDecisions());
    const result = run('decisions', '--file', file);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^decisions: OK \(\d+ checks\)$/m);
});

test('cli: decisions rejects an unknown flag with usage and exit 2', () => {
    const result = run('decisions', '--nope');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage/i);
});

async function writeTemp(name, text) {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'validate-docs-')), name);
    writeFileSync(file, text);
    return file;
}

const README_CITATION = '`tests/Fixtures/M365/README.md`';
const README_DOC = buildDecisions({
    lines: Object.fromEntries(
        DECISION_HEADINGS.map((heading) => [
            heading,
            ['Decision: Documented.', `Evidence: ${README_CITATION}`],
        ])
    ),
    extra: ['Claim: experiments.prefer_combined.status = 200'],
});
const SMALL_MANIFEST = JSON.stringify({
    files: { readme: 'README.md' },
    scenarios: {},
    experiments: { prefer_combined: { status: 200 } },
});

test('cli: decisions --trace on a tree without document and manifest names both files', () => {
    const result = run('decisions', '--trace');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL decisions: .*DECISIONS-graph\.md/m);
    assert.match(result.stdout, /^FAIL decisions: .*manifest\.json/m);
});

test('cli: decisions --trace fails and names the manifest when it cannot be read', async () => {
    const file = await writeTemp('decisions.md', README_DOC);
    const missing = run('decisions', '--trace', '--file', file, '--manifest', 'nope/manifest.json');
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /^FAIL decisions: .*nope\/manifest\.json/m);
    const broken = await writeTemp('manifest.json', '{ not json');
    const result = run('decisions', '--trace', '--file', file, '--manifest', broken);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(broken));
});

test('cli: decisions --trace passes with a consistent document and manifest', async () => {
    const file = await writeTemp('decisions.md', README_DOC);
    const manifest = await writeTemp('manifest.json', SMALL_MANIFEST);
    const result = run('decisions', '--trace', '--file', file, '--manifest', manifest);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^decisions: OK \(\d+ checks\)$/m);
});

test('cli: decisions --trace fails when a Claim disagrees with the manifest', async () => {
    const text = README_DOC.replace('status = 200', 'status = 500');
    const file = await writeTemp('decisions.md', text);
    const manifest = await writeTemp('manifest.json', SMALL_MANIFEST);
    const result = run('decisions', '--trace', '--file', file, '--manifest', manifest);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL decisions: .*status = 500/m);
});

test('cli: decisions --trace fails when the cited file does not exist in the repo', async () => {
    const text = README_DOC.replaceAll('README.md', 'GONE.md');
    const file = await writeTemp('decisions.md', text);
    const gone = SMALL_MANIFEST.replace('README.md', 'GONE.md');
    const manifest = await writeTemp('manifest.json', gone);
    const result = run('decisions', '--trace', '--file', file, '--manifest', manifest);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^FAIL decisions: .*GONE\.md/m);
});
