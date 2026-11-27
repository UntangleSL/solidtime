<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { CircleCheck, OctagonAlert, RotateCcw, TriangleAlert } from '@lucide/vue';
import DialogModal from '@/packages/ui/src/DialogModal.vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/packages/ui/src/number-field';
import { useNotificationsStore } from '@/utils/notification';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { formatHours, formatHoursNumber, formatMonth, formatPeriod } from './format';
import { t, useProfitabilityProps } from './labels';
import { monthDifference } from './plannedVsConsumedOption';
import { evenSplit, sumState } from './planGridMath';
import {
    hoursFromSeconds,
    secondsFromHours,
    summaryUrl,
    useSavePlan,
    validationErrors,
} from './contractsApi';
import { useProjectSummaryQuery } from './summaryApi';

// Monthly plan dialog (BUDG-04, D-02, D-12, UI-SPEC "Editor: Monthly plan"). Months may be uneven,
// but "Save plan" is enabled only when they add up exactly to the hours sold; the server holds the
// same rule (422) and the footer shows its message when it disagrees. Closed periods never reach
// this dialog: the callers offer it only for current and upcoming periods (D-03).
const props = defineProps<{
    projectId: string;
    periodId: string;
    projectName?: string | null;
}>();

const show = defineModel<boolean>('show', { default: false });

const emit = defineEmits<{
    saved: [];
}>();

const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);
const organizationUrl = computed(() => profitability.value.organization_url ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

function hours(seconds: number): string {
    return formatHours(Math.abs(seconds), numberFormat.value);
}

const { addNotification } = useNotificationsStore();
const { mutateAsync, isPending: saving } = useSavePlan();

// The period with its months, from the same summary endpoint (and cache) as the project card.
const url = computed(() =>
    show.value && organizationUrl.value !== null
        ? summaryUrl(organizationUrl.value, props.projectId)
        : null
);
const { data, isPending, isError, refetch } = useProjectSummaryQuery(
    url,
    () => props.projectId,
    () => props.periodId
);

const period = computed(() => {
    const candidate = data.value?.period ?? null;
    return candidate !== null && candidate.id === props.periodId ? candidate : null;
});
const budget = computed(() => period.value?.budget_seconds ?? 0);

// Planned hours per month as typed (half-hour steps), filled once per opening so a background
// refetch never overwrites what the user is editing.
const planned = ref<(number | null)[]>([]);
const initialized = ref(false);
const serverError = ref<string | null>(null);

watch(
    [show, period],
    ([open, current]) => {
        if (!open) {
            initialized.value = false;
            serverError.value = null;
            return;
        }
        if (current && !initialized.value) {
            planned.value = current.months.map((month) => hoursFromSeconds(month.planned_seconds));
            initialized.value = true;
        }
    },
    { immediate: true }
);

const plannedSeconds = computed(() => planned.value.map((value) => secondsFromHours(value) ?? 0));

const todayMonth = dayjs().format('YYYY-MM');

const rows = computed(() =>
    (period.value?.months ?? []).map((month, index) => {
        const seconds = plannedSeconds.value[index] ?? 0;
        const future = month.month.slice(0, 7) > todayMonth;
        const difference = monthDifference(seconds, month.consumed_seconds);
        const n = formatHoursNumber(difference.seconds, numberFormat.value);
        return {
            key: month.month,
            index,
            name: formatMonth(month.month),
            consumed: future ? '—' : hours(month.consumed_seconds),
            difference:
                difference.kind === 'on_plan'
                    ? { text: label('common.on_plan'), tone: 'text-text-primary' }
                    : difference.kind === 'over'
                      ? {
                            text: label('common.hours_over', { n }),
                            tone: 'text-red-700 dark:text-red-400',
                        }
                      : { text: label('common.hours_left', { n }), tone: 'text-text-secondary' },
        };
    })
);

const sum = computed(() => sumState(plannedSeconds.value, budget.value));

const sumText = computed(() => {
    const sold = hours(budget.value);
    const x = hours(sum.value.planned);
    const n = formatHoursNumber(sum.value.seconds, numberFormat.value);
    if (sum.value.kind === 'equal') return label('plan_editor.sum_equal', { sold });
    return label(sum.value.kind === 'under' ? 'plan_editor.sum_under' : 'plan_editor.sum_over', {
        x,
        sold,
        n,
    });
});

const SUM_ICON = {
    equal: { icon: CircleCheck, tone: 'text-green-700 dark:text-green-400' },
    under: { icon: TriangleAlert, tone: 'text-amber-800 dark:text-amber-400' },
    over: { icon: OctagonAlert, tone: 'text-red-700 dark:text-red-400' },
} as const;

const canSave = computed(
    () =>
        initialized.value &&
        period.value !== null &&
        period.value.state !== 'closed' &&
        sum.value.kind === 'equal'
);

const subtitle = computed(() => {
    if (!period.value) return '';
    const periodLabel = formatPeriod(period.value.starts_on, period.value.ends_on);
    const sold = hours(budget.value);
    if (props.projectName) {
        return label('plan_editor.subtitle', {
            project: props.projectName,
            period: periodLabel,
            sold,
        });
    }
    // Without a known name the copy keeps its order and drops the project part.
    return label('plan_editor.subtitle', { project: '', period: periodLabel, sold }).replace(
        /^\s*·\s*/,
        ''
    );
});

function setPlanned(index: number, value: number | null | undefined) {
    const next = [...planned.value];
    next[index] = value ?? null;
    planned.value = next;
    serverError.value = null;
}

function splitEvenly() {
    planned.value = evenSplit(budget.value, planned.value.length).map(
        (seconds) => hoursFromSeconds(seconds) ?? 0
    );
    serverError.value = null;
}

// Keyboard: Enter moves to the next month's Planned cell; focus selects the value to overwrite it.
const grid = ref<HTMLElement | null>(null);

function plannedInputs(): HTMLInputElement[] {
    return Array.from(
        grid.value?.querySelectorAll<HTMLInputElement>('input[data-plan-input]') ?? []
    );
}

function focusNext(index: number, event: KeyboardEvent) {
    const next = plannedInputs()[index + 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
}

function selectAll(event: FocusEvent) {
    const target = event.target;
    if (target instanceof HTMLInputElement) target.select();
}

async function save() {
    if (!canSave.value || saving.value || organizationUrl.value === null || !period.value) return;
    serverError.value = null;
    const months = period.value.months.map((month, index) => ({
        month: month.month.slice(0, 10),
        planned_seconds: plannedSeconds.value[index] ?? 0,
    }));
    try {
        await mutateAsync({
            organizationUrl: organizationUrl.value,
            projectId: props.projectId,
            periodId: props.periodId,
            months,
        });
        addNotification('success', label('toasts.plan_saved'));
        show.value = false;
        emit('saved');
    } catch (error) {
        const fields = validationErrors(error);
        if (fields === null) {
            addNotification('error', label('common.save_error'));
        } else {
            serverError.value = fields.months ?? Object.values(fields)[0] ?? null;
        }
    }
}

function discard() {
    show.value = false;
}
</script>

<template>
    <DialogModal :show="show" max-width="2xl" @close="discard" @submit="save">
        <template #title>
            <span>{{ label('plan_editor.title') }}</span>
            <span
                v-if="subtitle"
                class="block text-sm font-normal text-text-secondary"
                data-testid="plan-grid-subtitle">
                {{ subtitle }}
            </span>
        </template>
        <template #content>
            <div data-testid="profitability-plan-grid">
                <div
                    v-if="isPending && !period"
                    class="flex justify-center py-12"
                    data-testid="plan-grid-loading"
                    aria-busy="true">
                    <LoadingSpinner />
                </div>
                <div
                    v-else-if="isError || !period"
                    class="flex flex-wrap items-center gap-3 py-6"
                    data-testid="plan-grid-error">
                    <span>{{ label('common.load_error') }}</span>
                    <Button type="button" variant="ghost" size="sm" @click="refetch()">
                        {{ label('common.try_again') }}
                    </Button>
                </div>
                <!-- A 12-month period scrolls inside this box; the sum row stays visible -->
                <div
                    v-else
                    ref="grid"
                    class="max-h-[min(60vh,32rem)] overflow-y-auto rounded-md border border-card-background-separator">
                    <div
                        class="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_minmax(0,1fr)] text-sm text-text-primary">
                        <div
                            class="contents text-xs text-text-secondary"
                            data-testid="plan-grid-heading">
                            <div class="sticky top-0 z-10 bg-card-background px-3 py-2">
                                {{ label('summary.month') }}
                            </div>
                            <div class="sticky top-0 z-10 bg-card-background px-3 py-2 text-right">
                                {{ label('summary.planned') }}
                            </div>
                            <div class="sticky top-0 z-10 bg-card-background px-3 py-2 text-right">
                                {{ label('summary.consumed') }}
                            </div>
                            <div class="sticky top-0 z-10 bg-card-background px-3 py-2 text-right">
                                {{ label('summary.difference') }}
                            </div>
                        </div>
                        <div
                            v-for="row in rows"
                            :key="row.key"
                            class="contents"
                            data-testid="plan-grid-row">
                            <div
                                class="px-3 py-1.5 flex items-center border-t border-card-background-separator">
                                <label :for="`plan-month-${row.index}`">{{ row.name }}</label>
                            </div>
                            <div class="px-3 py-1.5 border-t border-card-background-separator">
                                <NumberField
                                    :id="`plan-month-${row.index}`"
                                    :model-value="planned[row.index] ?? null"
                                    :step="0.5"
                                    :min="0"
                                    @update:model-value="setPlanned(row.index, $event)">
                                    <NumberFieldContent class="flex items-center gap-1">
                                        <NumberFieldInput
                                            class="text-right"
                                            data-plan-input
                                            :data-testid="`plan-input-${row.index}`"
                                            @focus="selectAll"
                                            @keydown.enter="focusNext(row.index, $event)" />
                                        <span class="text-text-secondary">h</span>
                                    </NumberFieldContent>
                                </NumberField>
                            </div>
                            <div
                                class="px-3 py-1.5 flex items-center justify-end tabular-nums text-text-secondary border-t border-card-background-separator">
                                {{ row.consumed }}
                            </div>
                            <div
                                class="px-3 py-1.5 flex items-center justify-end tabular-nums border-t border-card-background-separator"
                                :class="row.difference.tone">
                                {{ row.difference.text }}
                            </div>
                        </div>
                        <div
                            class="col-span-4 sticky bottom-0 z-10 bg-card-background border-t border-card-background-separator px-3 py-2 space-y-1"
                            aria-live="polite"
                            data-testid="plan-grid-sum">
                            <p
                                class="flex items-center gap-2 font-medium tabular-nums"
                                :data-sum="sum.kind">
                                <component
                                    :is="SUM_ICON[sum.kind].icon"
                                    class="size-4 shrink-0"
                                    :class="SUM_ICON[sum.kind].tone"
                                    aria-hidden="true" />
                                <span>{{ sumText }}</span>
                            </p>
                            <p
                                v-if="sum.kind !== 'equal'"
                                class="text-xs text-text-secondary"
                                data-testid="plan-grid-reason">
                                {{ label('plan_editor.save_disabled_reason') }}
                            </p>
                            <p
                                v-if="serverError"
                                role="alert"
                                class="text-xs text-red-700 dark:text-red-400"
                                data-testid="plan-grid-server-error">
                                {{ serverError }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="mr-auto"
                    :disabled="!period"
                    data-testid="plan-split-evenly"
                    @click="splitEvenly">
                    <RotateCcw class="size-4" aria-hidden="true" />
                    {{ label('plan_editor.split_evenly') }}
                </Button>
                <SecondaryButton data-testid="plan-discard" @click="discard">{{
                    label('common.discard_changes')
                }}</SecondaryButton>
                <PrimaryButton
                    type="button"
                    :loading="saving"
                    :disabled="saving || !canSave"
                    :title="canSave ? undefined : label('plan_editor.save_disabled_reason')"
                    data-testid="plan-save"
                    @click="save">
                    {{ label('plan_editor.save') }}
                </PrimaryButton>
            </div>
        </template>
    </DialogModal>
</template>
