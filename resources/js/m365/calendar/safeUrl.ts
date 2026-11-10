// Outlook links are untrusted values: only a well-formed https URL may become an href (T-03-23).
// Kept in a plain module (not exported from the SFC) so that plain tsc, which the build checker
// runs next to vue-tsc, can resolve it.
export function safeHttpsUrl(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}
