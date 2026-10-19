// Placeholder so the first test run fails on assertions instead of on a missing module.
const NOT_IMPLEMENTED = ['not implemented'];

export function checkSchema() {
    return NOT_IMPLEMENTED;
}

export function checkSemantic() {
    return NOT_IMPLEMENTED;
}

export function checkLeaks() {
    return NOT_IMPLEMENTED;
}

export function checkReplay() {
    return NOT_IMPLEMENTED;
}

export function replayReport() {
    return { reasons: NOT_IMPLEMENTED, passes: [] };
}

export function scanText() {
    return NOT_IMPLEMENTED;
}

export function main() {
    return 1;
}
