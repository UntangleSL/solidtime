import {
    computed,
    inject,
    type Component,
    type ComputedRef,
    type InjectionKey,
    type Ref,
} from 'vue';
import { usePage } from '@inertiajs/vue3';
import { TrendingUp } from '@lucide/vue';
import { fill } from './format';

// Copy of the profitability module lives server-side (lang/en/profitability.php, 08-02) and reaches
// the client through the shared Inertia prop `profitability.labels`; components never hard-code it.

export interface LabelTree {
    [key: string]: string | LabelTree;
}

export type ProfitabilityView = 'projects' | 'clients' | 'people' | 'settings';

/**
 * The shared prop (ShareProfitabilityInertiaData). Without scope it is exactly `{ enabled: false }`;
 * on a project page the user may view it adds `organization_url`, `project.summary_url` and the full
 * label tree (the `money` group only with money, `admin` only for Owner/Admin).
 */
export interface ProfitabilitySharedProps {
    enabled: boolean;
    url?: string;
    views?: ProfitabilityView[];
    labels?: LabelTree;
    organization_url?: string;
    project?: {
        summary_url?: string;
    };
}

const DISABLED: ProfitabilitySharedProps = { enabled: false };

export function useProfitabilityProps(): ComputedRef<ProfitabilitySharedProps> {
    const page = usePage<{ profitability?: ProfitabilitySharedProps }>();
    return computed(() => {
        const profitability = page.props.profitability;
        if (typeof profitability !== 'object' || profitability === null) return DISABLED;
        return profitability;
    });
}

/**
 * The label at a dotted path ("summary.title"), with `:key` placeholders filled. A missing or
 * non-string entry returns the path itself, so a missing key is visible instead of blank.
 */
export function t(
    labels: LabelTree | null | undefined,
    path: string,
    params?: Record<string, string | number>
): string {
    let node: string | LabelTree | undefined = labels ?? undefined;
    for (const key of path.split('.')) {
        if (typeof node !== 'object' || node === null) return path;
        node = Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined;
    }
    return typeof node === 'string' ? fill(node, params) : path;
}

export interface ProfitabilityNav {
    visible: boolean;
    title: string;
    href: string;
    current: boolean;
    icon: Component;
}

const PAGE_PATH = '/profitability';

function pathOf(url: string | undefined): string {
    if (!url) return PAGE_PATH;
    try {
        return new URL(url, window.location.origin).pathname.replace(/\/+$/, '') || PAGE_PATH;
    } catch {
        return PAGE_PATH;
    }
}

/**
 * The sidebar item of the Profitability page (D-16), entirely from the shared prop: visible only when
 * the scope has access, href from `profitability.url` (no Ziggy route), title from `labels.nav`. The
 * core layout calls this once and renders one NavigationSidebarItem, so it needs no typing change.
 */
export function useProfitabilityNav(): ComputedRef<ProfitabilityNav> {
    const profitability = useProfitabilityProps();
    return computed(() => {
        const props = profitability.value;
        return {
            visible: props.enabled === true && typeof props.url === 'string',
            title: t(props.labels, 'nav'),
            href: props.url ?? PAGE_PATH,
            current:
                typeof window !== 'undefined' && window.location.pathname === pathOf(props.url),
            icon: TrendingUp,
        };
    });
}

/**
 * Page state lives in the URL query (UI-D13: `view`, `range`, `contract`), so a shared link opens the
 * same view. Writes use history.replaceState (no reload, no history entry) and keep Inertia's
 * history state object as it is.
 */
export function readQueryParam(key: string): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(key);
}

export function replaceQueryParam(key: string, value: string | null): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value === null) {
        url.searchParams.delete(key);
    } else {
        url.searchParams.set(key, value);
    }
    window.history.replaceState(window.history.state, '', url.toString());
}

/** Tab order of the page (UI-SPEC "Tabs"), whatever order the server lists its views in. */
export const VIEW_ORDER: readonly ProfitabilityView[] = [
    'projects',
    'clients',
    'people',
    'settings',
];

/**
 * The view key of a discovered component file: `<Name>View.vue` -> `<name>` lower-cased
 * (`./ProjectsView.vue` -> `projects`); any other file name -> null.
 */
export function viewKeyFromPath(path: string): string | null {
    const match = /(?:^|\/)([A-Za-z0-9]+)View\.vue$/.exec(path);
    return match ? (match[1] as string).toLowerCase() : null;
}

/** The component map of ProfitabilityPage's eager glob, keyed by view. */
export function discoverViews<T>(modules: Record<string, { default: T }>): Record<string, T> {
    const views: Record<string, T> = {};
    for (const [path, module] of Object.entries(modules)) {
        const key = viewKeyFromPath(path);
        if (key !== null) views[key] = module.default;
    }
    return views;
}

/**
 * The tabs: the server's `views` (what the scope may see, D-16) intersected with the discovered
 * components, in VIEW_ORDER. A component alone never adds a tab, and a listed view without a
 * component is not rendered (T-08-62).
 */
export function visibleViews(
    serverViews: readonly string[] | null | undefined,
    available: readonly string[]
): ProfitabilityView[] {
    const listed = new Set(serverViews ?? []);
    return VIEW_ORDER.filter((view) => listed.has(view) && available.includes(view));
}

/** `?view=` when it is one of the tabs, else the first tab (unknown or forbidden values silently). */
export function resolveActiveView(
    requested: string | null,
    views: readonly ProfitabilityView[]
): ProfitabilityView | null {
    const match = views.find((view) => view === requested);
    return match ?? views[0] ?? null;
}

/** The ranges of the Clients and People views (RangeSelect.vue), calendar-aligned server-side. */
export const RANGE_KEYS = [
    'this_month',
    'last_month',
    'this_quarter',
    'last_quarter',
    'year_to_date',
    'last_12_months',
] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

export const DEFAULT_RANGE: RangeKey = 'this_month';

export function isRangeKey(value: unknown): value is RangeKey {
    return typeof value === 'string' && (RANGE_KEYS as readonly string[]).includes(value);
}

/** The range a view starts with: `?range=` when it is a known key, else This month (UI-D13). */
export function initialRange(): RangeKey {
    const requested = readQueryParam('range');
    return isRangeKey(requested) ? requested : DEFAULT_RANGE;
}

/**
 * The header slot a view puts its toolbar into (UI-SPEC: the view's toolbar sits on the right of the
 * page header). ProfitabilityPage provides the element; a view rendered on its own (tests) gets null
 * and keeps its toolbar inline.
 */
export const PROFITABILITY_TOOLBAR: InjectionKey<Ref<HTMLElement | null>> =
    Symbol('profitability-toolbar');

export function useViewToolbarTarget(): Ref<HTMLElement | null> | null {
    return inject(PROFITABILITY_TOOLBAR, null);
}
