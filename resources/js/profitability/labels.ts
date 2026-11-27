import { computed, type ComputedRef } from 'vue';
import { usePage } from '@inertiajs/vue3';
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
