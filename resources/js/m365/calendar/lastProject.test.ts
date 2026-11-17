import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    lastProjectStorageKey,
    readLastProject,
    rememberLastProject,
    resolvePrefillProject,
} from './lastProject';

const projects = [
    { id: 'p-1', is_archived: false },
    { id: 'p-2', is_archived: false },
    { id: 'p-old', is_archived: true },
];

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('lastProject storage', () => {
    it('uses the solidtime:m365-last-meeting-project key per organization', () => {
        expect(lastProjectStorageKey('org-1')).toBe('solidtime:m365-last-meeting-project:org-1');
    });

    it('reads back the remembered project for the same organization only', () => {
        rememberLastProject('org-1', 'p-1');

        expect(readLastProject('org-1')).toBe('p-1');
        expect(readLastProject('org-2')).toBeNull();
        expect(localStorage.getItem('solidtime:m365-last-meeting-project:org-1')).toBe('p-1');
    });

    it('overwrites the previous project', () => {
        rememberLastProject('org-1', 'p-1');
        rememberLastProject('org-1', 'p-2');

        expect(readLastProject('org-1')).toBe('p-2');
    });

    it('treats an empty stored value as nothing', () => {
        localStorage.setItem(lastProjectStorageKey('org-1'), '');

        expect(readLastProject('org-1')).toBeNull();
    });

    it('yields null without an exception when localStorage throws', () => {
        vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });

        expect(() => rememberLastProject('org-1', 'p-1')).not.toThrow();
        expect(readLastProject('org-1')).toBeNull();
    });
});

describe('resolvePrefillProject', () => {
    it('returns the stored id when that project exists and is not archived', () => {
        expect(resolvePrefillProject('p-1', projects, 'p-2')).toBe('p-1');
    });

    it('falls back when the stored project is missing or archived', () => {
        expect(resolvePrefillProject('p-gone', projects, 'p-2')).toBe('p-2');
        expect(resolvePrefillProject('p-old', projects, 'p-2')).toBe('p-2');
        expect(resolvePrefillProject(null, projects, 'p-2')).toBe('p-2');
    });

    it('applies the same rule to the fallback', () => {
        expect(resolvePrefillProject(null, projects, 'p-old')).toBeNull();
        expect(resolvePrefillProject('p-gone', projects, 'p-gone-too')).toBeNull();
        expect(resolvePrefillProject(null, projects, null)).toBeNull();
    });

    it('returns null while no project is loaded', () => {
        expect(resolvePrefillProject('p-1', [], 'p-2')).toBeNull();
    });
});
