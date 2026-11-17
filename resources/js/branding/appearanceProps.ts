import { computed, type ComputedRef } from 'vue';
import { usePage } from '@inertiajs/vue3';

/** The stored theme choice; null means the user never picked one (the app follows the device). */
export type ThemeSettingValue = 'system' | 'light' | 'dark';

/** Every `branding.ui.*` string shared by the server (lang/en/branding.php). */
export interface BrandingLabels {
    accent_label: string;
    accent_description: string;
    accent_default_name: string;
    accent_reset: string;
    accent_announcement: string;
    accent_save_failed_title: string;
    accent_save_failed_body: string;
    theme_helper: string;
    mode_light: string;
    mode_dark: string;
    icon_label: string;
    icon_upload: string;
    icon_replace: string;
    icon_remove: string;
    icon_helper: string;
    icon_empty: string;
    icon_pending: string;
    icon_read_only: string;
    icon_error_type: string;
    icon_error_size: string;
    icon_error_generic: string;
    icon_removed: string;
    icon_alt: string;
}

/** The `appearance` Inertia prop shared by ShareAppearanceInertiaData on every page. */
export interface AppearanceProps {
    theme: ThemeSettingValue | null;
    accent: string | null;
    /** Preset ids in display order. */
    accents: string[];
    /** PUT target for the signed-in user's own settings; null for guests. */
    update_url: string | null;
    labels: BrandingLabels;
    /** Preset id to display name. */
    presets: Record<string, string>;
    /** Organization id to icon URL (added server-side by 03.2-05); treat a missing map as empty. */
    org_icons?: Record<string, string>;
}

const EMPTY_LABELS: BrandingLabels = {
    accent_label: '',
    accent_description: '',
    accent_default_name: '',
    accent_reset: '',
    accent_announcement: '',
    accent_save_failed_title: '',
    accent_save_failed_body: '',
    theme_helper: '',
    mode_light: '',
    mode_dark: '',
    icon_label: '',
    icon_upload: '',
    icon_replace: '',
    icon_remove: '',
    icon_helper: '',
    icon_empty: '',
    icon_pending: '',
    icon_read_only: '',
    icon_error_type: '',
    icon_error_size: '',
    icon_error_generic: '',
    icon_removed: '',
    icon_alt: '',
};

/**
 * The appearance prop of the current page, with safe defaults when it is missing (for example on a
 * page rendered before the module was deployed, or in isolated component tests).
 */
export function useAppearanceProps(): ComputedRef<AppearanceProps> {
    const page = usePage<{ appearance?: Partial<AppearanceProps> }>();

    return computed<AppearanceProps>(() => {
        const appearance = page.props.appearance;
        return {
            theme: appearance?.theme ?? null,
            accent: appearance?.accent ?? null,
            accents: appearance?.accents ?? [],
            update_url: appearance?.update_url ?? null,
            labels: { ...EMPTY_LABELS, ...(appearance?.labels ?? {}) },
            presets: appearance?.presets ?? {},
            ...(appearance?.org_icons ? { org_icons: appearance.org_icons } : {}),
        };
    });
}

/**
 * Fill Laravel-style placeholders (`:name`) from params. Unknown placeholders stay as written.
 */
export function formatLabel(template: string, params: Record<string, string>): string {
    return template.replace(/:([A-Za-z_]+)/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(params, key) ? (params[key] as string) : match
    );
}
