<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/vue-query';
import { Check, ChevronDown, Info } from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
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
    Combobox,
    ComboboxAnchor,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxViewport,
} from '@/packages/ui/src/combobox';
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
    loadExistingTerms,
    prorateCents,
    prorateSeconds,
    secondsFromHours,
    stubDays,
    stubEnd,
    todayIso,
    useSaveContractTerms,
    validationErrors,
    type ApplyTo,
    type ContractSchedule,
    type ContractTermsBody,
    type ExistingTerms,
} from './contractsApi';
import { fetchProjectsView, type ProjectsViewRow } from './projectsApi';

// Contract terms dialog (BUDG-01, D-01, D-12, D-15, UI-SPEC "Editor: Contract terms"). Hours are
// entered in half-hour steps and sent as seconds, amounts in currency units and sent as cents. The
// server checks who may write and every rule; this dialog only shows its answers (FieldError per
// field on a 422, the save-error toast on any other failure, the user's values kept either way).
//
// - mode "set" with a project: new terms for that project (project card, Projects view row).
// - mode "set" without a project: a leading project picker of the billable projects in scope that
//   have no terms yet (Projects view toolbar, A1).
// - mode "edit": the project's current terms, loaded from its summary. Once a period has started the
//   schedule and start date are read-only (and a one-off's end date), and the user chooses whether
//   the change reaches this period or only the next one (UI-D9, apply_to). Closed periods are never
//   offered and there is no remove action (UI-D10).
const props = withDefaults(
    defineProps<{
        projectId?: string | null;
        projectName?: string | null;
        mode?: 'set' | 'edit';
    }>(),
    { projectId: null, projectName: null, mode: 'set' }
);

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
    applyTo: ApplyTo;
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
    applyTo: 'current_and_following',
});

const errors = ref<Record<string, string>>({});
// UI-D8: once the user edits a stub value, a new start date never overwrites it silently.
const stubTouched = ref(false);

const isEdit = computed(() => props.mode === 'edit' && props.projectId !== null);
const picker = computed(() => !isEdit.value && props.projectId === null);

// Existing terms (edit mode)
const existing = ref<ExistingTerms | null>(null);
const loadState = ref<'loading' | 'error' | 'ready'>('ready');
let loadToken = 0;

async function loadExisting() {
    if (!isEdit.value || organizationUrl.value === null || props.projectId === null) return;
    const token = ++loadToken;
    loadState.value = 'loading';
    try {
        const terms = await loadExistingTerms(organizationUrl.value, props.projectId);
        if (token !== loadToken) return;
        if (terms === null) {
            loadState.value = 'error';
            return;
        }
        existing.value = terms;
        form.service = terms.contract.service ?? '';
        form.schedule = terms.schedule;
        form.startsOn = terms.contract.starts_on.slice(0, 10);
        form.endsOn = terms.contract.ends_on?.slice(0, 10) ?? null;
        form.hours = hoursFromSeconds(terms.budgetSeconds);
        form.amount = amountFromCents(terms.amountCents);
        form.applyTo = terms.current ? 'current_and_following' : 'next_period';
        loadState.value = 'ready';
    } catch {
        if (token === loadToken) loadState.value = 'error';
    }
}

// A period has started: schedule and start are locked, apply_to is required (08-08)
const started = computed(() => isEdit.value && existing.value?.started === true);
const endLocked = computed(() => started.value && form.schedule === 'one_off');

// Project picker (Projects view toolbar): billable projects in scope without terms
const pickedProjectId = ref<string | null>(null);
const pickerOpen = ref(false);
const pickerSearch = ref('');

watch(pickerOpen, (open) => {
    if (open) pickerSearch.value = '';
});

const withoutTerms = useQuery({
    queryKey: computed(() => [
        'profitability',
        getCurrentOrganizationId() ?? null,
        'projects',
        'without',
    ]),
    queryFn: () => fetchProjectsView(organizationUrl.value as string, 'without'),
    enabled: computed(() => show.value && picker.value && organizationUrl.value !== null),
    staleTime: 1000 * 30,
});

const pickerProjects = computed<ProjectsViewRow[]>(() =>
    [...(withoutTerms.data.value?.data ?? [])]
        .filter((row) => row.can_edit_terms && row.schedule === null)
        .sort(
            (a, b) =>
                (a.client_name ?? '').localeCompare(b.client_name ?? '') ||
                a.name.localeCompare(b.name)
        )
);

const pickerOptions = computed(() => {
    const search = pickerSearch.value.toLowerCase().trim();
    if (!search) return pickerProjects.value;
    return pickerProjects.value.filter((row) =>
        `${row.name} ${row.client_name ?? ''}`.toLowerCase().includes(search)
    );
});

const pickedProject = computed(
    () => pickerProjects.value.find((row) => row.project_id === pickedProjectId.value) ?? null
);

function emptySearch() {
    return '';
}

function setPickedProject(value: unknown) {
    pickedProjectId.value = typeof value === 'string' ? value : null;
}

const targetProjectId = computed(() => props.projectId ?? pickedProjectId.value);

function reset() {
    form.service = '';
    form.schedule = 'monthly';
    form.startsOn = firstOfThisMonth();
    form.endsOn = null;
    form.hours = null;
    form.amount = null;
    form.stubHours = null;
    form.stubAmount = null;
    form.applyTo = 'current_and_following';
    errors.value = {};
    stubTouched.value = false;
    existing.value = null;
    pickedProjectId.value = null;
    loadState.value = isEdit.value ? 'loading' : 'ready';
}

watch(
    show,
    (open) => {
        if (!open) return;
        reset();
        void loadExisting();
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

function displayDate(date: string | null): string {
    return date ? dayjs(date.slice(0, 10)).format('D MMM YYYY') : '—';
}

// First-period stub (D-15). Only while nothing has started: the server applies the first-period
// values when it creates (or fully replaces) the periods, never to a running contract.
const showStub = computed(() => !started.value && isStubStart(form.schedule, form.startsOn));

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

// UI-D9 choice and the rescale notice (the current period's plan follows its new hours)
const currentPeriodLabel = computed(() => {
    const current = existing.value?.current;
    return current ? formatPeriod(current.starts_on, current.ends_on) : '';
});
const nextPeriodLabel = computed(() => displayDate(existing.value?.nextStartsOn ?? null));
const rescaleNotice = computed(
    () =>
        started.value &&
        existing.value !== null &&
        existing.value.current !== null &&
        form.applyTo === 'current_and_following' &&
        secondsFromHours(form.hours) !== existing.value.budgetSeconds
);

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
    if (started.value) payload.apply_to = form.applyTo;
    return payload;
}

const canSave = computed(
    () =>
        !saving.value &&
        organizationUrl.value !== null &&
        targetProjectId.value !== null &&
        loadState.value === 'ready'
);

async function save() {
    const projectId = targetProjectId.value;
    if (!canSave.value || organizationUrl.value === null || projectId === null) return;
    errors.value = {};
    try {
        await mutateAsync({
            organizationUrl: organizationUrl.value,
            projectId,
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
const FIELD_KEYS = computed(() => [
    ...(picker.value ? ['project'] : []),
    'apply_to',
    'service',
    'schedule',
    'starts_on',
    'ends_on',
    'budget_seconds',
    'amount_cents',
    'first_period_budget_seconds',
    'first_period_amount_cents',
]);
const otherErrors = computed(() =>
    Object.entries(errors.value)
        .filter(([key]) => !FIELD_KEYS.value.includes(key))
        .map(([, message]) => message)
);
</script>

<template>
    <DialogModal :show="show" max-width="2xl" @close="discard" @submit="save">
        <template #title>
            <span>{{
                label(isEdit ? 'contract_editor.title_edit' : 'contract_editor.title_set')
            }}</span>
            <span
                v-if="projectName"
                class="block text-sm font-normal text-text-secondary"
                data-testid="profitability-contract-editor-project">
                {{ projectName }}
            </span>
        </template>
        <template #content>
            <div data-testid="profitability-contract-editor">
                <div
                    v-if="loadState === 'loading'"
                    class="flex justify-center py-12"
                    data-testid="contract-loading"
                    aria-busy="true">
                    <LoadingSpinner />
                </div>
                <div
                    v-else-if="loadState === 'error'"
                    class="flex flex-wrap items-center gap-3 py-6"
                    data-testid="contract-load-error">
                    <span>{{ label('common.load_error') }}</span>
                    <Button type="button" variant="ghost" size="sm" @click="loadExisting()">
                        {{ label('common.try_again') }}
                    </Button>
                </div>
                <FieldGroup v-else class="gap-4">
                    <Field v-if="picker" data-testid="contract-project-picker">
                        <FieldLabel for="contract-project">{{
                            label('contract_editor.project')
                        }}</FieldLabel>
                        <Combobox
                            v-model:open="pickerOpen"
                            :model-value="pickedProjectId ?? undefined"
                            :ignore-filter="true"
                            @update:model-value="setPickedProject">
                            <ComboboxAnchor>
                                <ComboboxTrigger as-child>
                                    <Button
                                        id="contract-project"
                                        type="button"
                                        variant="input"
                                        class="w-full justify-between font-normal"
                                        data-testid="contract-project-trigger">
                                        <span v-if="pickedProject" class="truncate">{{
                                            pickedProject.name
                                        }}</span>
                                        <span v-else class="truncate text-muted-foreground">{{
                                            label('contract_editor.project_placeholder')
                                        }}</span>
                                        <ChevronDown class="w-4 h-4 text-icon-default shrink-0" />
                                    </Button>
                                </ComboboxTrigger>
                            </ComboboxAnchor>
                            <ComboboxList>
                                <ComboboxInput
                                    v-model="pickerSearch"
                                    :display-value="emptySearch"
                                    auto-focus
                                    :aria-label="label('contract_editor.project')"
                                    :placeholder="label('contract_editor.project_placeholder')" />
                                <ComboboxViewport class="p-1 max-h-72 overflow-y-auto">
                                    <ComboboxItem
                                        v-for="option in pickerOptions"
                                        :key="option.project_id"
                                        :value="option.project_id"
                                        class="justify-between gap-2"
                                        data-testid="contract-project-option">
                                        <span class="min-w-0">
                                            <span class="block truncate">{{ option.name }}</span>
                                            <span
                                                class="block truncate text-xs text-text-secondary"
                                                >{{
                                                    option.client_name ?? label('common.no_client')
                                                }}</span
                                            >
                                        </span>
                                        <Check
                                            v-if="option.project_id === pickedProjectId"
                                            class="h-4 w-4 shrink-0" />
                                    </ComboboxItem>
                                </ComboboxViewport>
                            </ComboboxList>
                        </Combobox>
                        <FieldDescription>{{
                            label('projects.only_billable_helper')
                        }}</FieldDescription>
                        <FieldError v-if="errors.project" data-testid="contract-error-project">{{
                            errors.project
                        }}</FieldError>
                    </Field>
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
                        <Select
                            :model-value="form.schedule"
                            :disabled="started"
                            @update:model-value="setSchedule">
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
                            <DatePicker
                                v-if="!started"
                                v-model="startPicker"
                                data-testid="contract-start" />
                            <p
                                v-else
                                class="flex h-9 items-center rounded-md border border-input-border px-2 text-sm text-text-secondary"
                                data-testid="contract-start-locked">
                                {{ displayDate(form.startsOn) }}
                            </p>
                            <FieldError
                                v-if="errors.starts_on"
                                data-testid="contract-error-starts_on"
                                >{{ errors.starts_on }}</FieldError
                            >
                        </Field>
                        <Field>
                            <FieldLabel>{{ label('contract_editor.end_date') }}</FieldLabel>
                            <DatePicker
                                v-if="!endLocked"
                                v-model="endPicker"
                                clearable
                                data-testid="contract-end" />
                            <p
                                v-else
                                class="flex h-9 items-center rounded-md border border-input-border px-2 text-sm text-text-secondary"
                                data-testid="contract-end-locked">
                                {{ displayDate(form.endsOn) }}
                            </p>
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
                    <FieldSet v-if="started" class="gap-2" data-testid="contract-apply-to">
                        <FieldLegend variant="label">{{
                            label('contract_editor.apply_to_legend')
                        }}</FieldLegend>
                        <label
                            v-if="existing?.current"
                            class="flex items-center gap-2 text-sm text-text-primary">
                            <input
                                v-model="form.applyTo"
                                type="radio"
                                name="contract-apply-to"
                                value="current_and_following"
                                data-testid="contract-apply-current" />
                            {{
                                label('contract_editor.apply_to_current', {
                                    period: currentPeriodLabel,
                                })
                            }}
                        </label>
                        <label class="flex items-center gap-2 text-sm text-text-primary">
                            <input
                                v-model="form.applyTo"
                                type="radio"
                                name="contract-apply-to"
                                value="next_period"
                                data-testid="contract-apply-next" />
                            {{ label('contract_editor.apply_to_next', { date: nextPeriodLabel }) }}
                        </label>
                        <FieldError v-if="errors.apply_to" data-testid="contract-error-apply_to">{{
                            errors.apply_to
                        }}</FieldError>
                    </FieldSet>
                    <p
                        v-if="rescaleNotice"
                        class="flex items-start gap-2 text-sm text-text-secondary"
                        data-testid="contract-rescale-notice">
                        <Info class="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{{ label('contract_editor.rescale_notice') }}</span>
                    </p>
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
                    :disabled="!canSave"
                    data-testid="contract-save"
                    @click="save">
                    {{ label('contract_editor.save') }}
                </PrimaryButton>
            </div>
        </template>
    </DialogModal>
</template>
