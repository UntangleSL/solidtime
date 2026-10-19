// Placeholder so the first test run fails on assertions instead of on a missing module.
export function loadOrCreateSalt() {
    return Buffer.alloc(0);
}

export function createSanitizer() {
    return {
        event: () => ({}),
        page: () => ({}),
        me: () => ({}),
        nextLink: () => '',
        requestUrl: () => '',
        context: () => '',
        guid: () => '',
        id: () => '',
        errorBody: () => ({}),
        persistIdentityMap: () => {},
        stats: { droppedUntagged: 0 },
    };
}

export function buildLeakSet() {
    return new Set();
}

export function findLeaks() {
    return [];
}
