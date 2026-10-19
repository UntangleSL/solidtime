// Offline sanitizer CLI: raw/ (real captures, git-ignored) -> tests/Fixtures/M365/ (committable).
// Zero dependencies (node: built-ins only). Makes no network call.
//
//   node --env-file=tests/Tools/m365-spike/.env.local tests/Tools/m365-spike/sanitize.mjs
//        [--raw <dir>] [--out <dir>]
//
// Everything is built in memory first. The leak guard then compares every output with every
// identifying value of the raw data. On any hit nothing stays on disk (previously generated
// outputs are removed too), the report names the output file and the kind of field only, never
// the value, and the exit code is 1. Success prints counts only.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    buildLeakSet,
    collectRawDocuments,
    createSanitizer,
    findLeaks,
    loadOrCreateSalt,
} from './lib/sanitize.mjs';
import {
    OUTPUT_DIRS,
    OUTPUT_FILES,
    PASS_ORDER,
    buildManifest,
    buildOutputs,
    extractRound,
    findUntaggedEvents,
} from './lib/scenarios.mjs';
import { scanText } from './validate-fixtures.mjs';

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..', '..');
const DEFAULT_RAW_DIR = path.join(SPIKE_DIR, 'raw');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'tests', 'Fixtures', 'M365');
const USAGE = 'Usage: node tests/Tools/m365-spike/sanitize.mjs [--raw <dir>] [--out <dir>]';

const serialize = (data) => `${JSON.stringify(data, null, 2)}\n`;

function readJsonIfPresent(file) {
    if (!existsSync(file)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`${file} is not valid JSON`);
    }
}

function loadRound(rawDir, round) {
    const dir = path.join(rawDir, `round${round}`);
    const meta = readJsonIfPresent(path.join(dir, 'meta.json'));
    if (meta === null) {
        return null;
    }
    const passes = {};
    for (const name of PASS_ORDER) {
        const doc = readJsonIfPresent(path.join(dir, `${name}.json`));
        if (doc !== null) {
            passes[name] = doc;
        }
    }
    const me = readJsonIfPresent(path.join(dir, 'me.json'));
    return {
        meta,
        me: me ?? readJsonIfPresent(path.join(rawDir, 'me.json')),
        tokenShape: readJsonIfPresent(path.join(dir, 'token-shape.json')),
        passes,
        series: readJsonIfPresent(path.join(dir, 'series.json')),
        lookups: readJsonIfPresent(path.join(dir, 'lookups.json')),
    };
}

function cleanOutputs(outDir) {
    for (const name of OUTPUT_DIRS) {
        rmSync(path.join(outDir, name), { recursive: true, force: true });
    }
    for (const name of OUTPUT_FILES) {
        rmSync(path.join(outDir, name), { force: true });
    }
}

const isInside = (child, parent) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// The leak guard: raw values in any output, any event without a scenario tag, and the generic
// patterns of the fixture gate (foreign e-mail, link host, GUID, token), which need no raw data.
function findProblems(written, leakSet) {
    const problems = [];
    for (const [file, data] of written) {
        const text = serialize(data);
        problems.push(...scanText(file, text).map((reason) => `${reason} (in the output)`));
        const hits = findLeaks(text, leakSet);
        const kinds = new Set(hits.map((hit) => leakSet.kinds.get(hit)));
        for (const kind of [...kinds].sort()) {
            problems.push(`${file}: a ${kind} value from the raw data is in the output`);
        }
        if (findUntaggedEvents(data) > 0) {
            problems.push(`${file}: an event without a scenario tag is in the output`);
        }
    }
    return problems;
}

export function run({
    rawDir = DEFAULT_RAW_DIR,
    outDir = DEFAULT_OUT_DIR,
    env = process.env,
    hooks = {},
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    const fail = (message, exitCode = 1) => {
        stderr.write(`FAIL sanitize: ${message}\n`);
        return { exitCode };
    };
    const metaA = path.join(rawDir, 'roundA', 'meta.json');
    if (!existsSync(metaA)) {
        return fail(`${metaA} not found: run "capture --round A" first`);
    }
    const generated = OUTPUT_DIRS.map((name) => path.resolve(outDir, name));
    if (path.resolve(rawDir) === path.resolve(outDir)) {
        return fail('--raw and --out must be different directories', 2);
    }
    if (generated.some((dir) => isInside(path.resolve(rawDir), dir))) {
        return fail('--raw must not live inside a generated output directory', 2);
    }

    let rounds;
    let leakSet;
    let sanitizer;
    try {
        sanitizer = createSanitizer({
            salt: loadOrCreateSalt(rawDir),
            identityMapPath: path.join(rawDir, 'identity-map.json'),
            loginHint: env.M365_SPIKE_LOGIN_HINT,
            blockedHint: env.M365_SPIKE_BLOCKED_LOGIN_HINT,
        });
        const rawA = loadRound(rawDir, 'A');
        const rawB = loadRound(rawDir, 'B');
        const roundA = extractRound({ round: 'A', raw: rawA, sanitizer });
        rounds = { A: roundA };
        if (rawB !== null) {
            const lookupIds = roundA.lookupIds;
            rounds.B = extractRound({ round: 'B', raw: rawB, sanitizer, lookupIds });
        }
        leakSet = buildLeakSet(collectRawDocuments(rawDir));
    } catch (error) {
        return fail(error.message);
    }

    const outputs = buildOutputs(rounds);
    const manifest = buildManifest({ rounds, env, outputs });
    const written = new Map([...outputs.written, ['manifest.json', manifest]]);
    hooks.mutateOutputs?.(written);

    const problems = findProblems(written, leakSet);
    if (problems.length > 0) {
        cleanOutputs(outDir);
        return fail(`${problems.join('\nFAIL sanitize: ')}\nnothing was written`);
    }

    cleanOutputs(outDir);
    for (const [file, data] of written) {
        const target = path.join(outDir, ...file.split('/'));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, serialize(data));
    }
    sanitizer.persistIdentityMap();

    const presentIn = (round) =>
        Object.values(manifest.scenarios).filter((entry) => entry[round]?.present).length;
    const summary = {
        files: written.size,
        scenariosA: presentIn('round_a'),
        scenariosB: rounds.B ? presentIn('round_b') : null,
        droppedUntagged: sanitizer.stats.droppedUntagged,
    };
    const roundB = rounds.B ? `, round B: ${summary.scenariosB}` : '';
    const counts = `scenarios present in round A: ${summary.scenariosA}${roundB}`;
    const dropped = `${summary.droppedUntagged} events without a scenario tag dropped`;
    stdout.write(`sanitize: wrote ${summary.files} files (${counts}; ${dropped})\n`);
    return { exitCode: 0, summary };
}

function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const name = argv[i] === '--raw' || argv[i] === '--out' ? argv[i].slice(2) : null;
        if (name === null || i + 1 >= argv.length) {
            return { error: `unknown or incomplete argument at position ${i + 1}` };
        }
        i += 1;
        options[name] = path.resolve(argv[i]);
    }
    return { options };
}

export function main(argv, io = {}) {
    const { options, error } = parseArgs(argv);
    if (error) {
        (io.stderr ?? process.stderr).write(`${error}\n${USAGE}\n`);
        return 2;
    }
    return run({ rawDir: options.raw, outDir: options.out, ...io }).exitCode;
}

const isEntryPoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
    process.exitCode = main(process.argv.slice(2));
}
