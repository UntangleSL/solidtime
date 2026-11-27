<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import DialogModal from '@/packages/ui/src/DialogModal.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import DatePicker from '@/packages/ui/src/Input/DatePicker.vue';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
} from '@/packages/ui/src/field';
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/packages/ui/src/number-field';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src/select';
import {
    getLocalizedDateFromTimestamp,
    getLocalizedDayJsFromMinutes,
} from '@/packages/ui/src/utils/time';
import { useNotificationsStore } from '@/utils/notification';
import { getOrganizationCurrencyString } from '@/utils/money';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { formatPeriod } from './format';
import { t, useProfitabilityProps } from './labels';
import {
    CONTRACT_SCHEDULES,
    amountFromCents,
    centsFromAmount,
    hoursFromSeconds,
    isContractSchedule,
    isStubStart,
    prorateCents,
    prorateSeconds,
    secondsFromHours,
    stubDays,
    stubEnd,
    todayIso,
    useSaveContractTerms,
    validationErrors,
    type ContractSchedule,
    type ContractTermsBody,
} from './contractsApi';

// Contract terms dialog (BUDG-01, D-01, D-12, D-15, UI-SPEC "Editor: Contract terms"). Hours are
// entered in half-hour steps and sent as seconds, amounts in currency units and sent as cents. The
// server checks who may write and every rule; this dialog only shows its answers (FieldError per
// field on a 422, the save-error toast on any other failure, the user's values kept either way).
const props = defineProps<{
    projectId: string;
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
const currency = computed(() => organization.value?.currency ?? getOrganizationCurrencyString());

const { addNotification } = useNotificationsStore();
const { mutateAsync, isPending: saving } = useSaveContractTerms();

interface FormState {
    service: string;
    schedule: ContractSchedule;
    startsOn: string;
    endsOn: string | null;
    hours: number | null;
    amount: number | null;
    stubHours: number | null;
    stubAmount: number | null;
}

function firstOfThisMonth(): string {
    return `${todayIso().slice(0, 7)}-01`;
}

const form = reactive<FormState>({
    service: '',
    schedule: 'monthly',
    startsOn: firstOfThisMonth(),
    endsOn: null,
    hours: null,
    amount: null,
    stubHours: null,
    stubAmount: null,
});

const errors = ref<Record<string, string>>({});
// UI-D8: once the user edits a stub value, a new start date never overwrites it silently.
const stubTouched = ref(false);

function reset() {
    form.service = '';
    form.schedule = 'monthly';
    form.startsOn = firstOfThisMonth();
    form.endsOn = null;
    form.hours = null;
    form.amount = null;
    form.stubHours = null;
    form.stubAmount = null;
    errors.value = {};
    stubTouched.value = false;
}

watch(
    show,
    (open) => {
        if (open) reset();
    },
    { immediate: true }
);

const scheduleOptions = computed(() =>
    CONTRACT_SCHEDULES.map((value) => ({ value, text: label(`schedule.${value}`) }))
);

function setSchedule(value: unknown) {
    if (isContractSchedule(value)) form.schedule = value;
}

// The DatePicker works on localized timestamps; the form keeps calendar dates ("YYYY-MM-DD").
function toPicker(date: string | null): string | null {
    return date ? getLocalizedDayJsFromMinutes(date, 12 * 60).format() : null;
}

function fromPicker(value: string | null): string | null {
    return value ? getLocalizedDateFromTimestamp(value) : null;
}

const startPicker = computed<string | null>({
    get: () => toPicker(form.startsOn),
    set: (value) => {
        const date = fromPicker(value);
        if (date) form.startsOn = date;
    },
});

const endPicker = computed<string | null>({
    get: () => toPicker(form.endsOn),
    set: (value) => {
        form.endsOn = fromPicker(value);
    },
});

// First-period stub (D-15)
const showStub = computed(() => isStubStart(form.schedule, form.startsOn));

const stubLegend = computed(() =>
    label('contract_editor.first_period_legend', {
        period: formatPeriod(form.startsOn, stubEnd(form.startsOn)),
    })
);

const stubHelper = computed(() => {
    const { days, of } = stubDays(form.startsOn);
    return label('contract_editor.first_period_helper', { d: days, n: of });
});

function reprorate() {
    if (!showStub.value) return;
    const seconds = secondsFromHours(form.hours);
    const cents = centsFromAmount(form.amount);
    form.stubHours =
        seconds === null
            ? null
            : hoursFromSeconds(prorateSeconds(seconds, form.schedule, form.startsOn));
    form.stubAmount =
        cents === null ? null : amountFromCents(prorateCents(cents, form.schedule, form.startsOn));
}

watch(
    () => [form.startsOn, form.schedule, form.hours, form.amount],
    () => {
        if (!stubTouched.value) reprorate();
    }
);

function setStubHours(value: number | null | undefined) {
    stubTouched.value = true;
    form.stubHours = value ?? null;
}

function setStubAmount(value: number | null | undefined) {
    stubTouched.value = true;
    form.stubAmount = value ?? null;
}

const hoursLabel = computed(() => label(`contract_editor.hours_per.${form.schedule}`));
const amountLabel = computed(() => label(`money.editor.amount_per.${form.schedule}`));

function body(): ContractTermsBody {
    const service = form.service.trim();
    const payload: ContractTermsBody = {
        service: service === '' ? null : service,
        schedule: form.schedule,
        starts_on: form.startsOn,
        ends_on: form.endsOn,
        budget_seconds: secondsFromHours(form.hours),
        amount_cents: centsFromAmount(form.amount),
    };
    if (showStub.value) {
        payload.first_period_budget_seconds = secondsFromHours(form.stubHours);
        payload.first_period_amount_cents = centsFromAmount(form.stubAmount);
    }
    return payload;
}

async function save() {
    if (saving.value || organizationUrl.value === null) return;
    errors.value = {};
    try {
        await mutateAsync({
            organizationUrl: organizationUrl.value,
            projectId: props.projectId,
            body: body(),
        });
        addNotification('success', label('toasts.terms_saved'));
        show.value = false;
        emit('saved');
    } catch (error) {
        const fields = validationErrors(error);
        if (fields === null) {
            addNotification('error', label('common.save_error'));
        } else {
            errors.value = fields;
        }
    }
}

function discard() {
    show.value = false;
}

// Errors the form has no field for still reach the user (above the fields).
const FIELD_KEYS = [
    'service',
    'schedule',
    'starts_on',
    'ends_on',
    'budget_seconds',
    'amount_cents',
    'first_period_budget_seconds',
    'first_period_amount_cents',
];
const otherErrors = computed(() =>
    Object.entries(errors.value)
        .filter(([key]) => !FIELD_KEYS.includes(key))
        .map(([, message]) => message)
);
</script>

<template>
    <DialogModal :show="show" max-width="2xl" @close="discard" @submit="save">
        <template #title>
            <span>{{ label('contract_editor.title_set') }}</span>
            <span
                v-if="projectName"
                class="block text-sm font-normal text-text-secondary"
                data-testid="profitability-contract-editor-project">
                {{ projectName }}
            </span>
        </template>
        <template #content>
            <div data-testid="profitability-contract-editor">
                <FieldGroup class="gap-4">
                    <FieldError v-if="otherErrors.length > 0" data-testid="contract-error-other">
                        <p v-for="message in otherErrors" :key="message">{{ message }}</p>
                    </FieldError>
                    <Field>
                        <FieldLabel for="contract-service">{{
                            label('contract_editor.service')
                        }}</FieldLabel>
                        <TextInput
                            id="contract-service"
                            v-model="form.service"
                            type="text"
                            maxlength="255"
                            class="block w-full"
                            :placeholder="label('contract_editor.service_placeholder')" />
                        <FieldError v-if="errors.service" data-testid="contract-error-service">{{
                            errors.service
                        }}</FieldError>
                    </Field>
                    <Field>
                        <FieldLabel for="contract-schedule">{{
                            label('contract_editor.schedule')
                        }}</FieldLabel>
                        <Select :model-value="form.schedule" @update:model-value="setSchedule">
                            <SelectTrigger
                                id="contract-schedule"
                                class="w-full"
                                :aria-label="label('contract_editor.schedule')"
                                data-testid="contract-schedule">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem
                                    v-for="option in scheduleOptions"
                                    :key="option.value"
                                    :value="option.value">
                                    {{ option.text }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <FieldError v-if="errors.schedule" data-testid="contract-error-schedule">{{
                            errors.schedule
                        }}</FieldError>
                    </Field>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field>
                            <FieldLabel>{{ label('contract_editor.start_date') }}</FieldLabel>
                            <DatePicker v-model="startPicker" data-testid="contract-start" />
                            <FieldError
                                v-if="errors.starts_on"
                                data-testid="contract-error-starts_on"
                                >{{ errors.starts_on }}</FieldError
                            >
                        </Field>
                        <Field>
                            <FieldLabel>{{ label('contract_editor.end_date') }}</FieldLabel>
                            <DatePicker v-model="endPicker" clearable data-testid="contract-end" />
                            <FieldDescription v-if="form.schedule !== 'one_off'">{{
                                label('contract_editor.end_date_helper')
                            }}</FieldDescription>
                            <FieldError
                                v-if="errors.ends_on"
                                data-testid="contract-error-ends_on"
                                >{{ errors.ends_on }}</FieldError
                            >
                        </Field>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field>
                            <FieldLabel for="contract-hours">{{ hoursLabel }}</FieldLabel>
                            <NumberField
                                id="contract-hours"
                                :model-value="form.hours"
                                :step="0.5"
                                :min="0"
                                @update:model-value="form.hours = $event ?? null">
                                <NumberFieldContent class="flex items-center gap-2">
                                    <NumberFieldInput class="text-right" />
                                    <span class="text-sm text-text-secondary">h</span>
                                </NumberFieldContent>
                            </NumberField>
                            <FieldError
                                v-if="errors.budget_seconds"
                                data-testid="contract-error-budget_seconds"
                                >{{ errors.budget_seconds }}</FieldError
                            >
                        </Field>
                        <Field>
                            <FieldLabel for="contract-amount">{{ amountLabel }}</FieldLabel>
                            <NumberField
                                id="contract-amount"
                                :model-value="form.amount"
                                :min="0"
                                :format-options="{
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                }"
                                @update:model-value="form.amount = $event ?? null">
                                <NumberFieldContent class="flex items-center gap-2">
                                    <NumberFieldInput class="text-right" />
                                    <span class="text-sm text-text-secondary">{{ currency }}</span>
                                </NumberFieldContent>
                            </NumberField>
                            <FieldError
                                v-if="errors.amount_cents"
                                data-testid="contract-error-amount_cents"
                                >{{ errors.amount_cents }}</FieldError
                            >
                        </Field>
                    </div>
                    <FieldSet v-if="showStub" class="gap-3" data-testid="contract-stub">
                        <FieldLegend variant="label">{{ stubLegend }}</FieldLegend>
                        <FieldDescription>{{ stubHelper }}</FieldDescription>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field>
                                <FieldLabel for="contract-stub-hours">{{
                                    label('contract_editor.first_period_hours')
                                }}</FieldLabel>
                                <NumberField
                                    id="contract-stub-hours"
                                    :model-value="form.stubHours"
                                    :step="0.5"
                                    :min="0"
                                    @update:model-value="setStubHours">
                                    <NumberFieldContent class="flex items-center gap-2">
                                        <NumberFieldInput class="text-right" />
                                        <span class="text-sm text-text-secondary">h</span>
                                    </NumberFieldContent>
                                </NumberField>
                                <FieldError v-if="errors.first_period_budget_seconds">{{
                                    errors.first_period_budget_seconds
                                }}</FieldError>
                            </Field>
                            <Field>
                                <FieldLabel for="contract-stub-amount">{{
                                    label('money.editor.first_period_amount')
                                }}</FieldLabel>
                                <NumberField
                                    id="contract-stub-amount"
                                    :model-value="form.stubAmount"
                                    :min="0"
                                    :format-options="{
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    }"
                                    @update:model-value="setStubAmount">
                                    <NumberFieldContent class="flex items-center gap-2">
                                        <NumberFieldInput class="text-right" />
                                        <span class="text-sm text-text-secondary">{{
                                            currency
                                        }}</span>
                                    </NumberFieldContent>
                                </NumberField>
                                <FieldError v-if="errors.first_period_amount_cents">{{
                                    errors.first_period_amount_cents
                                }}</FieldError>
                            </Field>
                        </div>
                    </FieldSet>
                </FieldGroup>
            </div>
        </template>
        <template #footer>
            <div class="flex items-center gap-2">
                <SecondaryButton data-testid="contract-discard" @click="discard">{{
                    label('common.discard_changes')
                }}</SecondaryButton>
                <PrimaryButton
                    type="button"
                    :loading="saving"
                    :disabled="saving"
                    data-testid="contract-save"
                    @click="save">
                    {{ label('contract_editor.save') }}
                </PrimaryButton>
            </div>
        </template>
    </DialogModal>
</template>
