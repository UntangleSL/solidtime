import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    ENV_SOURCES,
    PRODUCTION_SECRET_NAME,
    assertNoProductionSecret,
    resolveEnv,
} from '../lib/env.mjs';

const CANARY = ['canary', 'value', 'never', 'printed'].join('-');

const DOPPLER_PAIRS = [
    ['M365_TENANT_ID', 'SOLIDTIME_MICROSOFT_TENANT_ID'],
    ['M365_CLIENT_ID', 'SOLIDTIME_MICROSOFT_CLIENT_ID'],
    ['M365_CLIENT_SECRET', 'SOLIDTIME_M365_SPIKE_CLIENT_SECRET'],
    ['M365_SPIKE_LOGIN_HINT', 'SOLIDTIME_M365_SPIKE_LOGIN_HINT'],
    ['M365_SPIKE_B_LOGIN_HINT', 'SOLIDTIME_M365_SPIKE_B_LOGIN_HINT'],
    ['M365_SPIKE_WINDOW_START', 'SOLIDTIME_M365_SPIKE_WINDOW_START'],
    ['M365_SPIKE_WINDOW_END', 'SOLIDTIME_M365_SPIKE_WINDOW_END'],
    ['M365_SPIKE_OUTLOOK_CLIENT', 'SOLIDTIME_M365_SPIKE_OUTLOOK_CLIENT'],
    ['M365_SPIKE_PORT', 'SOLIDTIME_M365_SPIKE_PORT'],
];

test('each M365_* name falls back to its Doppler name and reports the source', () => {
    for (const [logical, doppler] of DOPPLER_PAIRS) {
        const { env, sources } = resolveEnv({ [doppler]: CANARY });
        assert.equal(env[logical], CANARY, logical);
        assert.equal(sources[logical], doppler, logical);
    }
});

test('the M365_* name wins over the Doppler name and an empty value counts as unset', () => {
    const both = resolveEnv({ M365_CLIENT_ID: 'direct', SOLIDTIME_MICROSOFT_CLIENT_ID: 'doppler' });
    assert.equal(both.env.M365_CLIENT_ID, 'direct');
    assert.equal(both.sources.M365_CLIENT_ID, 'M365_CLIENT_ID');

    const empty = resolveEnv({ M365_CLIENT_ID: '   ', SOLIDTIME_MICROSOFT_CLIENT_ID: 'doppler' });
    assert.equal(empty.env.M365_CLIENT_ID, 'doppler');
    assert.equal(empty.sources.M365_CLIENT_ID, 'SOLIDTIME_MICROSOFT_CLIENT_ID');
});

test('a name that is set nowhere is absent and has no source', () => {
    const { env, sources } = resolveEnv({});
    assert.equal(env.M365_CLIENT_SECRET, undefined);
    assert.equal(sources.M365_CLIENT_SECRET, null);
});

test('the B hint reads M365_SPIKE_B_LOGIN_HINT, then the Doppler name, then the deprecated alias', () => {
    const all = {
        M365_SPIKE_B_LOGIN_HINT: 'one',
        SOLIDTIME_M365_SPIKE_B_LOGIN_HINT: 'two',
        M365_SPIKE_BLOCKED_LOGIN_HINT: 'three',
    };
    assert.equal(resolveEnv(all).env.M365_SPIKE_B_LOGIN_HINT, 'one');
    delete all.M365_SPIKE_B_LOGIN_HINT;
    assert.equal(resolveEnv(all).env.M365_SPIKE_B_LOGIN_HINT, 'two');
    delete all.SOLIDTIME_M365_SPIKE_B_LOGIN_HINT;
    const alias = resolveEnv(all);
    assert.equal(alias.env.M365_SPIKE_B_LOGIN_HINT, 'three');
    assert.equal(alias.sources.M365_SPIKE_B_LOGIN_HINT, 'M365_SPIKE_BLOCKED_LOGIN_HINT');
    assert.deepEqual(alias.deprecated, ['M365_SPIKE_BLOCKED_LOGIN_HINT']);
});

test('the production secret is never read: not a source, not in the resolved env', () => {
    const resolved = resolveEnv({ [PRODUCTION_SECRET_NAME]: CANARY });

    assert.equal(resolved.productionSecretPresent, true);
    assert.equal(resolved.env.M365_CLIENT_SECRET, undefined);
    assert.equal(JSON.stringify(resolved).includes(CANARY), false);
    for (const names of Object.values(ENV_SOURCES)) {
        assert.equal(names.includes(PRODUCTION_SECRET_NAME), false);
    }
    assert.equal(resolveEnv({}).productionSecretPresent, false);
    assert.equal(resolveEnv({ [PRODUCTION_SECRET_NAME]: '  ' }).productionSecretPresent, false);
});

test('assertNoProductionSecret throws a bilingual exit-2 error that names the variable only', () => {
    assert.doesNotThrow(() => assertNoProductionSecret({}));
    assert.throws(
        () => assertNoProductionSecret({ [PRODUCTION_SECRET_NAME]: CANARY }),
        (error) => {
            assert.equal(error.exitCode, 2);
            assert.ok(error.message.includes(PRODUCTION_SECRET_NAME));
            assert.match(error.message, /producción/);
            assert.match(error.message, /production/);
            assert.equal(error.message.includes(CANARY), false);
            return true;
        }
    );
});
