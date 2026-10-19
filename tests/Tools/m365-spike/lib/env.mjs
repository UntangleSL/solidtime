// Environment names for the spike harness. Zero dependencies.
//
// Every setting has one logical name (M365_*) that the rest of the harness reads. When that name is
// unset, the value is read from the Doppler name (project `vps`, config `dev`, keys prefixed
// SOLIDTIME_). The production client secret has no entry here on purpose: this module only ever
// tests whether that variable exists, it never reads, returns or prints its value.

export const PRODUCTION_SECRET_NAME = 'SOLIDTIME_MICROSOFT_CLIENT_SECRET';

// Logical name -> names it can be read from, in order. The first one that is set wins.
export const ENV_SOURCES = {
    M365_TENANT_ID: ['M365_TENANT_ID', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
    M365_CLIENT_ID: ['M365_CLIENT_ID', 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
    M365_CLIENT_SECRET: ['M365_CLIENT_SECRET', 'SOLIDTIME_M365_SPIKE_CLIENT_SECRET'],
    M365_SPIKE_LOGIN_HINT: ['M365_SPIKE_LOGIN_HINT', 'SOLIDTIME_M365_SPIKE_LOGIN_HINT'],
    M365_SPIKE_B_LOGIN_HINT: [
        'M365_SPIKE_B_LOGIN_HINT',
        'SOLIDTIME_M365_SPIKE_B_LOGIN_HINT',
        'M365_SPIKE_BLOCKED_LOGIN_HINT',
    ],
    M365_SPIKE_WINDOW_START: ['M365_SPIKE_WINDOW_START', 'SOLIDTIME_M365_SPIKE_WINDOW_START'],
    M365_SPIKE_WINDOW_END: ['M365_SPIKE_WINDOW_END', 'SOLIDTIME_M365_SPIKE_WINDOW_END'],
    M365_SPIKE_OUTLOOK_CLIENT: ['M365_SPIKE_OUTLOOK_CLIENT', 'SOLIDTIME_M365_SPIKE_OUTLOOK_CLIENT'],
    M365_SPIKE_PORT: ['M365_SPIKE_PORT', 'SOLIDTIME_M365_SPIKE_PORT'],
};

// Names still read for backwards compatibility. `status` flags them.
export const DEPRECATED_NAMES = new Set(['M365_SPIKE_BLOCKED_LOGIN_HINT']);

const isSet = (value) => typeof value === 'string' && value.trim() !== '';

export function resolveEnv(raw = process.env) {
    const env = {};
    const sources = {};
    const deprecated = [];
    for (const [logical, names] of Object.entries(ENV_SOURCES)) {
        const source = names.find((name) => isSet(raw[name]));
        sources[logical] = source ?? null;
        if (source !== undefined) {
            env[logical] = raw[source];
            if (DEPRECATED_NAMES.has(source)) {
                deprecated.push(source);
            }
        }
    }
    return {
        env,
        sources,
        deprecated,
        productionSecretPresent: isSet(raw[PRODUCTION_SECRET_NAME]),
    };
}

export class ProductionSecretError extends Error {
    constructor() {
        super(
            `${PRODUCTION_SECRET_NAME} (secreto de producción) está en el entorno y no debe estar ` +
                'en la configuración dev: elimínelo de este entorno y use solo ' +
                'SOLIDTIME_M365_SPIKE_CLIENT_SECRET. / ' +
                `${PRODUCTION_SECRET_NAME} (the production secret) is in the environment and must ` +
                'not be in the dev config: remove it from this environment and use only ' +
                'SOLIDTIME_M365_SPIKE_CLIENT_SECRET.'
        );
        this.name = 'ProductionSecretError';
        this.exitCode = 2;
    }
}

export function assertNoProductionSecret(raw = process.env) {
    if (isSet(raw[PRODUCTION_SECRET_NAME])) {
        throw new ProductionSecretError();
    }
}
