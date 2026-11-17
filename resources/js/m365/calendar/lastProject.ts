// The project last used for a meeting conversion, remembered per organization in this browser
// (same convention as the solidtime:m365-show-dismissed view preference). It is only a prefill:
// the stored id is used when it matches a non-archived project of the loaded list, and the server
// re-validates the project on every conversion.

const STORAGE_PREFIX = 'solidtime:m365-last-meeting-project:';

interface PrefillProject {
    id: string;
    is_archived: boolean;
}

export function lastProjectStorageKey(organizationId: string): string {
    return STORAGE_PREFIX + organizationId;
}

// Storage can be unavailable (privacy mode, quota, blocked cookies): no prefill then.
export function readLastProject(organizationId: string): string | null {
    try {
        const value = window.localStorage.getItem(lastProjectStorageKey(organizationId));
        return value !== null && value.trim() !== '' ? value : null;
    } catch {
        return null;
    }
}

export function rememberLastProject(organizationId: string, projectId: string): void {
    try {
        window.localStorage.setItem(lastProjectStorageKey(organizationId), projectId);
    } catch {
        // Only a convenience; a failed write changes nothing else.
    }
}

// The stored id when that project is loaded and not archived, else the fallback (the project of the
// user's most recent work entry) under the same rule, else null (D-02).
export function resolvePrefillProject(
    storedId: string | null,
    projects: readonly PrefillProject[],
    fallbackId: string | null
): string | null {
    const usable = (id: string | null): id is string =>
        id !== null && projects.some((project) => project.id === id && !project.is_archived);

    if (usable(storedId)) return storedId;
    if (usable(fallbackId)) return fallbackId;
    return null;
}
