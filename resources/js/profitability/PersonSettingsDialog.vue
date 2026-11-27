<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DialogModal from '@/packages/ui/src/DialogModal.vue';
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
    firstDayOfCurrentMonth,
    firstValidationMessage,
    pickerDate,
    unitsToCents,
    useInvalidateProfitability,
    useSettingsFormat,
    useSettingsOrganizationUrl,
    type SettingsPerson,
} from './settingsApi';

// Person settings (BUDG-05, CHRG-01, D-08, D-13): the dated hourly cost history of one person.
// Each add saves on its own with its own toast (UI-D4: dated rows are independent records, a batch
// form would hide which row failed). A duplicate date comes back as a 422 shown under the add row.
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

function saveError() {
    useNotificationsStore().addNotification('error', label('common.save_error'));
}

// Hourly cost add row
const costDate = ref<string | null>(firstDayOfCurrentMonth());
const costUnits = ref<number | null>(null);
const costError = ref<string | null>(null);
const costSaving = ref(false);

// A new person starts from a clean add row; a refetch of the same person keeps what was typed.
watch(
    () => props.person?.member_id,
    () => {
        costDate.value = firstDayOfCurrentMonth();
        costUnits.value = null;
        costError.value = null;
    }
);

const canAddCost = computed(
    () =>
        pickerDate(costDate.value) !== null &&
        typeof costUnits.value === 'number' &&
        Number.isFinite(costUnits.value) &&
        costUnits.value >= 0
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
        useNotificationsStore().addNotification('success', label('admin.toasts.cost_added'));
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

const HEAD = 'py-2 pr-4 text-left text-xs font-medium text-text-secondary whitespace-nowrap';
const CELL = 'py-2 pr-4 border-t border-row-separator text-sm text-text-primary tabular-nums';
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
                            :disabled="!canAddCost"
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
                            </tr>
                        </tbody>
                    </table>
                </FieldSet>
            </div>
        </template>
        <template #footer>
            <SecondaryButton data-testid="profitability-person-close" @click="emit('close')">
                {{ label('admin.settings.dialog.close') }}
            </SecondaryButton>
        </template>
    </DialogModal>
</template>
