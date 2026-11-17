import { computed, type ComputedRef } from 'vue';
import { useAppearanceProps } from './appearanceProps';

/**
 * First user-perceived character of the trimmed name, uppercased. `Array.from` iterates by code
 * point, so an emoji or another surrogate pair is never split in half. Empty names give ''.
 */
export function firstGrapheme(name: string): string {
    const first = Array.from(name.trim())[0];
    return first === undefined ? '' : first.toUpperCase();
}

/**
 * Path of the fork's organization icon routes (POST to upload or replace, DELETE to remove).
 * Built client-side from the organization id, like the M365 URLs, instead of through Ziggy.
 */
export function organizationIconPath(organizationId: string): string {
    return `/organizations/${organizationId}/icon`;
}

export interface OrganizationIcons {
    /** Organization id to public icon URL; empty when the server shares no map. */
    icons: ComputedRef<Record<string, string>>;
    /** The icon URL of an organization, or null when it has none. */
    iconFor: (organizationId: string) => string | null;
}

/** Organization icon URLs from the shared `appearance.org_icons` prop. */
export function useOrganizationIcons(): OrganizationIcons {
    const appearance = useAppearanceProps();
    const icons = computed<Record<string, string>>(() => appearance.value.org_icons ?? {});

    function iconFor(organizationId: string): string | null {
        const url = icons.value[organizationId];
        return typeof url === 'string' && url !== '' ? url : null;
    }

    return { icons, iconFor };
}
