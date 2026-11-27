<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Trash2 } from '@lucide/vue';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/Components/ui/alert-dialog';
import { Button } from '@/packages/ui/src';
import DialogModal from '@/packages/ui/src/DialogModal.vue';
import DangerButton from '@/packages/ui/src/Buttons/DangerButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import DatePicker from '@/packages/ui/src/Input/DatePicker.vue';
import {
    FieldDescription,
    FieldError,
    FieldLabel,
    FieldLegend,
    FieldSet,
} from '@/packages/ui/src/field';
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/packages/ui/src/number-field';
import { getOrganizationCurrencyString } from '@/utils/money';
import { useNotificationsStore } from '@/utils/notification';
import { t, useProfitabilityProps } from './labels';
import {
    addCostRate,
    addWorkWeek,
    deleteCostRate,
    deleteWorkWeek,
    firstDayOfCurrentMonth,
    firstValidationMessage,
    hoursToSeconds,
    pickerDate,
    unitsToCents,
    useInvalidateProfitability,
    useSettingsFormat,
    useSettingsOrganizationUrl,
    type SettingsCostRate,
    type SettingsPerson,
    type SettingsWorkWeek,
} from './settingsApi';

// Person settings (BUDG-05, CHRG-01, D-08, D-13): the dated hourly cost history and the dated working
// week and chargeability target history of one person. Each add and each delete saves on its own
// with its own toast (UI-D4: dated rows are independent records, a batch form would hide which row
// failed). A duplicate date comes back as a 422 shown under the add row. Deleting a row changes past
// margins or chargeability, so it is confirmed first (T-08-45).
const props = defineProps<{
    show: boolean;
    person: SettingsPerson | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const format = useSettingsFormat();
const organizationUrl = useSettingsOrganizationUrl();
const invalidate = useInvalidateProfitability();
const currency = getOrganizationCurrencyString();

function toast(path: string) {
    useNotificationsStore().addNotification('success', label(path));
}

function saveError() {
    useNotificationsStore().addNotification('error', label('common.save_error'));
}

function isAmount(value: number | null, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

// Hourly cost add row
const costDate = ref<string | null>(firstDayOfCurrentMonth());
const costUnits = ref<number | null>(null);
const costError = ref<string | null>(null);
const costSaving = ref(false);

// Working week add row (UI-SPEC defaults: 40 h, 75 %)
const DEFAULT_HOURS = 40;
const DEFAULT_TARGET = 75;
const weekDate = ref<string | null>(firstDayOfCurrentMonth());
const weekHours = ref<number | null>(DEFAULT_HOURS);
const weekTarget = ref<number | null>(DEFAULT_TARGET);
const weekError = ref<string | null>(null);
const weekSaving = ref(false);

// A new person starts from clean add rows; a refetch of the same person keeps what was typed.
watch(
    () => props.person?.member_id,
    () => {
        costDate.value = firstDayOfCurrentMonth();
        costUnits.value = null;
        costError.value = null;
        weekDate.value = firstDayOfCurrentMonth();
        weekHours.value = DEFAULT_HOURS;
        weekTarget.value = DEFAULT_TARGET;
        weekError.value = null;
        pending.value = null;
    }
);

const canAddCost = computed(
    () => pickerDate(costDate.value) !== null && isAmount(costUnits.value, 1000000)
);

const canAddWeek = computed(
    () =>
        pickerDate(weekDate.value) !== null &&
        isAmount(weekHours.value, 168) &&
        isAmount(weekTarget.value, 100)
);

async function addCost() {
    const person = props.person;
    const effectiveFrom = pickerDate(costDate.value);
    if (!person || organizationUrl.value === null || effectiveFrom === null) return;
    if (!canAddCost.value || costSaving.value) return;
    costSaving.value = true;
    costError.value = null;
    try {
        await addCostRate(organizationUrl.value, person.member_id, {
            effective_from: effectiveFrom,
            hourly_cost_cents: unitsToCents(costUnits.value as number),
        });
        toast('admin.toasts.cost_added');
        costUnits.value = null;
        await invalidate();
    } catch (error) {
        const message = firstValidationMessage(error, ['effective_from', 'hourly_cost_cents']);
        if (message !== null) {
            costError.value = message;
        } else {
            saveError();
        }
    } finally {
        costSaving.value = false;
    }
}

async function addWeek() {
    const person = props.person;
    const effectiveFrom = pickerDate(weekDate.value);
    if (!person || organizationUrl.value === null || effectiveFrom === null) return;
    if (!canAddWeek.value || weekSaving.value) return;
    weekSaving.value = true;
    weekError.value = null;
    try {
        await addWorkWeek(organizationUrl.value, person.member_id, {
            effective_from: effectiveFrom,
            weekly_seconds: hoursToSeconds(weekHours.value as number),
            target_percent: Math.round(weekTarget.value as number),
        });
        toast('admin.toasts.work_week_added');
        await invalidate();
    } catch (error) {
        const message = firstValidationMessage(error, [
            'effective_from',
            'weekly_seconds',
            'target_percent',
        ]);
        if (message !== null) {
            weekError.value = message;
        } else {
            saveError();
        }
    } finally {
        weekSaving.value = false;
    }
}

// Confirmed deletes
type PendingDelete =
    | { kind: 'cost'; row: SettingsCostRate; hasPrevious: boolean }
    | { kind: 'work_week'; row: SettingsWorkWeek };

const pending = ref<PendingDelete | null>(null);
const deleting = ref(false);

function askDeleteCost(row: SettingsCostRate) {
    const hasPrevious = (props.person?.cost_rates ?? []).some(
        (other) => other.id !== row.id && other.effective_from < row.effective_from
    );
    pending.value = { kind: 'cost', row, hasPrevious };
}

function askDeleteWeek(row: SettingsWorkWeek) {
    pending.value = { kind: 'work_week', row };
}

const confirmCopy = computed(() => {
    const current = pending.value;
    if (current === null) return null;
    const params = {
        date: format.date(current.row.effective_from),
        name: props.person?.name ?? '',
    };
    if (current.kind === 'cost') {
        return {
            title: label('admin.settings.delete_cost.title'),
            body: label(
                current.hasPrevious
                    ? 'admin.settings.delete_cost.body'
                    : 'admin.settings.delete_cost.body_no_previous',
                params
            ),
            keep: label('admin.settings.delete_cost.keep'),
            confirm: label('admin.settings.delete_cost.confirm'),
        };
    }
    return {
        title: label('admin.settings.delete_work_week.title'),
        body: label('admin.settings.delete_work_week.body', params),
        keep: label('admin.settings.delete_work_week.keep'),
        confirm: label('admin.settings.delete_work_week.confirm'),
    };
});

function onConfirmOpen(open: boolean) {
    if (!open && !deleting.value) pending.value = null;
}

async function confirmDelete() {
    const current = pending.value;
    const person = props.person;
    if (current === null || !person || organizationUrl.value === null || deleting.value) return;
    deleting.value = true;
    try {
        if (current.kind === 'cost') {
            await deleteCostRate(organizationUrl.value, person.member_id, current.row.id);
            toast('admin.toasts.cost_deleted');
        } else {
            await deleteWorkWeek(organizationUrl.value, person.member_id, current.row.id);
            toast('admin.toasts.work_week_deleted');
        }
        pending.value = null;
        await invalidate();
    } catch {
        saveError();
    } finally {
        deleting.value = false;
    }
}

const HEAD = 'py-2 pr-4 text-left text-xs font-medium text-text-secondary whitespace-nowrap';
const CELL =
    'py-1.5 pr-4 border-t border-row-separator text-sm text-text-primary tabular-nums align-middle';
</script>

<template>
    <DialogModal :show="show" max-width="2xl" @close="emit('close')">
        <template #title>{{ person?.name }}</template>
        <template #content>
            <div v-if="person" class="space-y-8" data-testid="profitability-person-dialog">
                <FieldSet class="gap-3" data-testid="profitability-person-costs">
                    <FieldLegend variant="legend" class="mb-0 text-text-primary">
                        {{ label('admin.settings.dialog.cost_legend') }}
                    </FieldLegend>
                    <FieldDescription class="text-text-secondary">
                        {{ label('admin.settings.dialog.cost_helper') }}
                    </FieldDescription>
                    <div class="flex flex-wrap items-end gap-3">
                        <div class="grid gap-1.5 w-44">
                            <FieldLabel class="text-xs text-text-secondary">
                                {{ label('admin.settings.dialog.effective_from') }}
                            </FieldLabel>
                            <DatePicker v-model="costDate" data-testid="profitability-cost-date" />
                        </div>
                        <div class="grid gap-1.5 w-44">
                            <FieldLabel class="text-xs text-text-secondary">
                                {{ label('admin.settings.dialog.cost_per_hour') }}
                            </FieldLabel>
                            <NumberField
                                :model-value="costUnits ?? undefined"
                                :min="0"
                                :step-snapping="false"
                                :format-options="{
                                    style: 'currency',
                                    currency: currency,
                                    currencyDisplay: 'code',
                                }"
                                data-testid="profitability-cost-amount"
                                @update:model-value="(value) => (costUnits = value ?? null)">
                                <NumberFieldContent>
                                    <NumberFieldInput
                                        :aria-label="
                                            label('admin.settings.dialog.cost_per_hour')
                                        " />
                                </NumberFieldContent>
                            </NumberField>
                        </div>
                        <SecondaryButton
                            :loading="costSaving"
                            :disabled="!canAddCost || costSaving"
                            data-testid="profitability-add-cost"
                            @click="addCost">
                            {{ label('admin.settings.dialog.add_cost') }}
                        </SecondaryButton>
                    </div>
                    <FieldError v-if="costError" data-testid="profitability-cost-error">
                        {{ costError }}
                    </FieldError>
                    <p
                        v-if="person.cost_rates.length === 0"
                        class="text-sm text-text-secondary"
                        data-testid="profitability-cost-history-empty">
                        {{ label('admin.settings.dialog.history_empty') }}
                    </p>
                    <table v-else class="w-full" data-testid="profitability-cost-history">
                        <thead>
                            <tr>
                                <th :class="HEAD">
                                    {{ label('admin.settings.dialog.effective_from') }}
                                </th>
                                <th :class="HEAD">
                                    {{ label('admin.settings.dialog.cost_per_hour') }}
                                </th>
                                <th class="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="rate in person.cost_rates"
                                :key="rate.id"
                                data-testid="profitability-cost-row">
                                <td :class="CELL">{{ format.date(rate.effective_from) }}</td>
                                <td :class="CELL">
                                    {{
                                        label('admin.settings.per_hour', {
                                            value: format.money(rate.hourly_cost_cents),
                                        })
                                    }}
                                </td>
                                <td :class="[CELL, 'pr-0 text-right']">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        class="size-8"
                                        :aria-label="
                                            label('admin.settings.dialog.delete_cost_aria', {
                                                date: format.date(rate.effective_from),
                                            })
                                        "
                                        data-testid="profitability-delete-cost"
                                        @click="askDeleteCost(rate)">
                                        <Trash2 class="size-4" aria-hidden="true" />
                                    </Button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </FieldSet>

                <FieldSet class="gap-3" data-testid="profitability-person-work-weeks">
                    <FieldLegend variant="legend" class="mb-0 text-text-primary">
                        {{ label('admin.settings.dialog.work_week_legend') }}
                    </FieldLegend>
                    <FieldDescription class="text-text-secondary">
                        {{ label('admin.settings.dialog.work_week_helper') }}
                    </FieldDescription>
                    <div class="flex flex-wrap items-end gap-3">
                        <div class="grid gap-1.5 w-44">
                            <FieldLabel class="text-xs text-text-secondary">
                                {{ label('admin.settings.dialog.effective_from') }}
                            </FieldLabel>
                            <DatePicker
                                v-model="weekDate"
                                data-testid="profitability-work-week-date" />
                        </div>
                        <div class="grid gap-1.5 w-32">
                            <FieldLabel class="text-xs text-text-secondary">
                                {{ label('admin.settings.dialog.hours_per_week') }}
                            </FieldLabel>
                            <NumberField
                                :model-value="weekHours ?? undefined"
                                :min="0"
                                :max="168"
                                :step-snapping="false"
                                data-testid="profitability-work-week-hours"
                                @update:model-value="(value) => (weekHours = value ?? null)">
                                <NumberFieldContent>
                                    <NumberFieldInput
                                        :aria-label="
                                            label('admin.settings.dialog.hours_per_week')
                                        " />
                                </NumberFieldContent>
                            </NumberField>
                        </div>
                        <div class="grid gap-1.5 w-28">
                            <FieldLabel class="text-xs text-text-secondary">
                                {{ label('admin.settings.dialog.target') }}
                            </FieldLabel>
                            <NumberField
                                :model-value="weekTarget ?? undefined"
                                :min="0"
                                :max="100"
                                :step-snapping="false"
                                :format-options="{ maximumFractionDigits: 0 }"
                                data-testid="profitability-work-week-target"
                                @update:model-value="(value) => (weekTarget = value ?? null)">
                                <NumberFieldContent>
                                    <NumberFieldInput
                                        :aria-label="label('admin.settings.dialog.target')" />
                                </NumberFieldContent>
                            </NumberField>
                        </div>
                        <SecondaryButton
                            :loading="weekSaving"
                            :disabled="!canAddWeek || weekSaving"
                            data-testid="profitability-add-work-week"
                            @click="addWeek">
                            {{ label('admin.settings.dialog.add_work_week') }}
                        </SecondaryButton>
                    </div>
                    <FieldError v-if="weekError" data-testid="profitability-work-week-error">
                        {{ weekError }}
                    </FieldError>
                    <p
                        v-if="person.work_weeks.length === 0"
                        class="text-sm text-text-secondary"
                        data-testid="profitability-work-week-history-empty">
                        {{ label('admin.settings.dialog.history_empty') }}
                    </p>
                    <table v-else class="w-full" data-testid="profitability-work-week-history">
                        <thead>
                            <tr>
                                <th :class="HEAD">
                                    {{ label('admin.settings.dialog.effective_from') }}
                                </th>
                                <th :class="HEAD">
                                    {{ label('admin.settings.dialog.hours_per_week') }}
                                </th>
                                <th :class="HEAD">{{ label('admin.settings.dialog.target') }}</th>
                                <th class="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="week in person.work_weeks"
                                :key="week.id"
                                data-testid="profitability-work-week-row">
                                <td :class="CELL">{{ format.date(week.effective_from) }}</td>
                                <td :class="CELL">{{ format.hours(week.weekly_seconds) }}</td>
                                <td :class="CELL">{{ week.target_percent }} %</td>
                                <td :class="[CELL, 'pr-0 text-right']">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        class="size-8"
                                        :aria-label="
                                            label('admin.settings.dialog.delete_work_week_aria', {
                                                date: format.date(week.effective_from),
                                            })
                                        "
                                        data-testid="profitability-delete-work-week"
                                        @click="askDeleteWeek(week)">
                                        <Trash2 class="size-4" aria-hidden="true" />
                                    </Button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </FieldSet>
            </div>

            <AlertDialog :open="pending !== null" @update:open="onConfirmOpen">
                <AlertDialogContent data-testid="profitability-delete-confirm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{{ confirmCopy?.title }}</AlertDialogTitle>
                        <AlertDialogDescription data-testid="profitability-delete-confirm-body">
                            {{ confirmCopy?.body }}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel data-testid="profitability-delete-keep">
                            {{ confirmCopy?.keep }}
                        </AlertDialogCancel>
                        <DangerButton
                            data-testid="profitability-delete-confirm-button"
                            @click="confirmDelete">
                            {{ confirmCopy?.confirm }}
                        </DangerButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </template>
        <template #footer>
            <SecondaryButton data-testid="profitability-person-close" @click="emit('close')">
                {{ label('admin.settings.dialog.close') }}
            </SecondaryButton>
        </template>
    </DialogModal>
</template>
