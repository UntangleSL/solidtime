<script setup lang="ts">
import { computed, ref } from 'vue';
import { Briefcase, CircleAlert, Plus, X } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import { Button, CardTitle } from '@/packages/ui/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import TextInput from '@/packages/ui/src/Input/TextInput.vue';
import {
    Combobox,
    ComboboxAnchor,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxViewport,
} from '@/packages/ui/src/combobox';
import { FieldSeparator } from '@/packages/ui/src/field';
import { useNotificationsStore } from '@/utils/notification';
import { t, useProfitabilityProps } from './labels';
import {
    addAccountManager,
    addProjectManager,
    removeAccountManager,
    removeProjectManager,
    useInvalidateProfitability,
    useManagersSettingsQuery,
    useSettingsOrganizationUrl,
    type SettingsManager,
    type SettingsMember,
} from './settingsApi';

// Project and account managers (BUDG-07, D-10, D-16). Managers are assignment rows, never roles:
// Owner and Admin add and remove them per client (account managers) and per billable project
// (project managers). Each change saves at once with a toast; removal is reversible and therefore
// not confirmed. Placeholders are never offered (A8, T-08-46; the server rejects them with a 422).
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const organizationUrl = useSettingsOrganizationUrl();
const invalidate = useInvalidateProfitability();
const { data, isPending, isError, refetch } = useManagersSettingsQuery();

type SectionKey = 'account' | 'project';

interface AssignmentRow {
    key: string;
    section: SectionKey;
    id: string;
    name: string;
    clientName: string | null;
    managers: SettingsManager[];
}

interface Section {
    key: SectionKey;
    title: string;
    helper: string;
    firstColumn: string;
    addLabel: string;
    removeAria: string;
    rows: AssignmentRow[];
}

const FILTER_THRESHOLD = 10;
const filter = ref('');

const clientRows = computed<AssignmentRow[]>(() =>
    (data.value?.clients ?? []).map((client) => ({
        key: `account:${client.id}`,
        section: 'account',
        id: client.id,
        name: client.name,
        clientName: null,
        managers: client.account_managers,
    }))
);

// One row per billable project, grouped by client (projects without a client last), then by name.
const projectRows = computed<AssignmentRow[]>(() =>
    [...(data.value?.projects ?? [])]
        .sort((a, b) => {
            if (a.client_name === null && b.client_name !== null) return 1;
            if (a.client_name !== null && b.client_name === null) return -1;
            const byClient = (a.client_name ?? '').localeCompare(b.client_name ?? '', undefined, {
                sensitivity: 'base',
            });
            if (byClient !== 0) return byClient;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        })
        .map((project) => ({
            key: `project:${project.id}`,
            section: 'project',
            id: project.id,
            name: project.name,
            clientName: project.client_name,
            managers: project.project_managers,
        }))
);

const showFilter = computed(
    () => clientRows.value.length + projectRows.value.length > FILTER_THRESHOLD
);

function matches(row: AssignmentRow, query: string): boolean {
    if (query === '') return true;
    return (
        row.name.toLowerCase().includes(query) ||
        (row.clientName ?? '').toLowerCase().includes(query)
    );
}

const sections = computed<Section[]>(() => {
    const query = showFilter.value ? filter.value.trim().toLowerCase() : '';
    return [
        {
            key: 'account',
            title: label('admin.settings.account_managers'),
            helper: label('admin.settings.account_managers_helper'),
            firstColumn: label('admin.settings.managers_columns.client'),
            addLabel: label('admin.settings.add_account_manager'),
            removeAria: 'admin.settings.remove_account_manager_aria',
            rows: clientRows.value.filter((row) => matches(row, query)),
        },
        {
            key: 'project',
            title: label('admin.settings.project_managers'),
            helper: label('admin.settings.project_managers_helper'),
            firstColumn: label('admin.settings.managers_columns.project'),
            addLabel: label('admin.settings.add_project_manager'),
            removeAria: 'admin.settings.remove_project_manager_aria',
            rows: projectRows.value.filter((row) => matches(row, query)),
        },
    ];
});

// Members a picker may offer: never placeholders (the server already omits them; this is the
// client-side guard) and never someone already assigned to the row.
const assignable = computed<SettingsMember[]>(() =>
    (data.value?.members ?? []).filter((member) => member.role !== 'placeholder')
);

function candidates(row: AssignmentRow): SettingsMember[] {
    const assigned = new Set(row.managers.map((manager) => manager.member_id));
    const query = search.value.trim().toLowerCase();
    return assignable.value.filter(
        (member) =>
            !assigned.has(member.member_id) &&
            (query === '' || member.name.toLowerCase().includes(query))
    );
}

// One picker open at a time; its search starts empty on every open.
const openPicker = ref<string | null>(null);
const search = ref('');

function setPickerOpen(row: AssignmentRow, open: boolean) {
    if (open) {
        search.value = '';
        openPicker.value = row.key;
    } else if (openPicker.value === row.key) {
        openPicker.value = null;
    }
}

function emptySearch() {
    return '';
}

const busy = ref<Set<string>>(new Set());

function setBusy(key: string, value: boolean) {
    const next = new Set(busy.value);
    if (value) {
        next.add(key);
    } else {
        next.delete(key);
    }
    busy.value = next;
}

async function run(key: string, write: (url: string) => Promise<void>, toastPath: string) {
    const url = organizationUrl.value;
    if (url === null || busy.value.has(key)) return;
    setBusy(key, true);
    try {
        await write(url);
        useNotificationsStore().addNotification('success', label(toastPath));
        await invalidate();
    } catch {
        useNotificationsStore().addNotification('error', label('common.save_error'));
    } finally {
        setBusy(key, false);
    }
}

function add(row: AssignmentRow, memberId: unknown) {
    if (typeof memberId !== 'string' || memberId === '') return;
    openPicker.value = null;
    const write =
        row.section === 'account'
            ? (url: string) => addAccountManager(url, row.id, memberId)
            : (url: string) => addProjectManager(url, row.id, memberId);
    void run(row.key, write, 'admin.toasts.manager_added');
}

function remove(row: AssignmentRow, manager: SettingsManager) {
    const write =
        row.section === 'account'
            ? (url: string) => removeAccountManager(url, row.id, manager.member_id)
            : (url: string) => removeProjectManager(url, row.id, manager.member_id);
    void run(row.key, write, 'admin.toasts.manager_removed');
}

const HEAD = 'px-4 py-2 text-left text-xs font-medium text-text-secondary whitespace-nowrap';
const CELL = 'px-4 py-2.5 border-t border-row-separator text-sm text-text-primary align-middle';
const CHIP =
    'inline-flex items-center gap-1 rounded-md border border-input-border bg-card-background py-0.5 pl-2 pr-0.5 text-xs text-text-primary';
</script>

<template>
    <Card data-testid="profitability-settings-managers">
        <div class="px-4 pt-2">
            <CardTitle :title="label('admin.settings.managers_title')" :icon="Briefcase" />
        </div>
        <div
            v-if="isPending"
            class="flex justify-center items-center py-12"
            aria-busy="true"
            data-testid="profitability-settings-managers-loading">
            <LoadingSpinner />
        </div>
        <div
            v-else-if="isError"
            class="p-4 flex flex-wrap items-center gap-3 text-sm text-text-secondary"
            data-testid="profitability-settings-managers-error">
            <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ label('common.load_error') }}</span>
            <SecondaryButton @click="refetch()">{{ label('common.try_again') }}</SecondaryButton>
        </div>
        <div v-else class="pb-2">
            <div v-if="showFilter" class="px-4 pt-2 pb-3">
                <TextInput
                    v-model="filter"
                    type="search"
                    class="w-full max-w-sm"
                    :placeholder="label('admin.settings.managers_filter')"
                    :aria-label="label('admin.settings.managers_filter')"
                    data-testid="profitability-managers-filter" />
            </div>
            <template v-for="(section, index) in sections" :key="section.key">
                <FieldSeparator v-if="index > 0" class="my-4" />
                <section :data-testid="`profitability-managers-${section.key}`">
                    <div class="px-4 pt-2 pb-2 space-y-1">
                        <h4 class="text-sm font-medium text-text-primary">{{ section.title }}</h4>
                        <p class="text-sm text-text-secondary">{{ section.helper }}</p>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr>
                                    <th :class="[HEAD, 'w-1/4']">{{ section.firstColumn }}</th>
                                    <th v-if="section.key === 'project'" :class="[HEAD, 'w-1/5']">
                                        {{ label('admin.settings.managers_columns.client') }}
                                    </th>
                                    <th :class="HEAD">{{ section.title }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in section.rows"
                                    :key="row.key"
                                    data-testid="profitability-managers-row"
                                    :data-row-key="row.key">
                                    <td :class="CELL">
                                        <span class="block truncate" :title="row.name">{{
                                            row.name
                                        }}</span>
                                    </td>
                                    <td
                                        v-if="section.key === 'project'"
                                        :class="[CELL, 'text-text-secondary']">
                                        <span class="block truncate">{{
                                            row.clientName ?? label('common.no_client')
                                        }}</span>
                                    </td>
                                    <td :class="CELL">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span
                                                v-for="manager in row.managers"
                                                :key="manager.member_id"
                                                :class="CHIP"
                                                data-testid="profitability-manager-chip">
                                                {{ manager.name }}
                                                <button
                                                    type="button"
                                                    class="rounded p-0.5 text-text-tertiary hover:bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                    :aria-label="
                                                        label(section.removeAria, {
                                                            name: manager.name,
                                                        })
                                                    "
                                                    :disabled="busy.has(row.key)"
                                                    data-testid="profitability-manager-remove"
                                                    @click="remove(row, manager)">
                                                    <X class="size-3" aria-hidden="true" />
                                                </button>
                                            </span>
                                            <Combobox
                                                :model-value="undefined"
                                                :open="openPicker === row.key"
                                                :ignore-filter="true"
                                                :disabled="busy.has(row.key)"
                                                data-testid="profitability-manager-picker"
                                                @update:open="(open) => setPickerOpen(row, open)"
                                                @update:model-value="(value) => add(row, value)">
                                                <ComboboxAnchor class="w-auto">
                                                    <ComboboxTrigger as-child>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            class="h-7 px-2 text-text-secondary"
                                                            :aria-label="section.addLabel">
                                                            <Plus aria-hidden="true" />
                                                            {{ section.addLabel }}
                                                        </Button>
                                                    </ComboboxTrigger>
                                                </ComboboxAnchor>
                                                <ComboboxList>
                                                    <ComboboxInput
                                                        v-model="search"
                                                        :display-value="emptySearch"
                                                        auto-focus
                                                        :aria-label="section.addLabel"
                                                        :placeholder="section.addLabel" />
                                                    <ComboboxViewport class="p-1 max-h-64">
                                                        <ComboboxItem
                                                            v-for="member in candidates(row)"
                                                            :key="member.member_id"
                                                            :value="member.member_id"
                                                            :text-value="member.name"
                                                            data-testid="profitability-manager-option">
                                                            <span class="truncate">{{
                                                                member.name
                                                            }}</span>
                                                        </ComboboxItem>
                                                    </ComboboxViewport>
                                                </ComboboxList>
                                            </Combobox>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </template>
        </div>
    </Card>
</template>
