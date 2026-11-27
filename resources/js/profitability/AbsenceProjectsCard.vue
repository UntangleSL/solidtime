<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarRange, Check, ChevronDown, CircleAlert, TriangleAlert, X } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import { Button, CardTitle } from '@/packages/ui/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import {
    Combobox,
    ComboboxAnchor,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxViewport,
} from '@/packages/ui/src/combobox';
import { useNotificationsStore } from '@/utils/notification';
import { t, useProfitabilityProps } from './labels';
import {
    updateAbsence,
    useAbsenceSettingsQuery,
    useInvalidateProfitability,
    useSettingsOrganizationUrl,
    type AbsenceProjectOption,
} from './settingsApi';

// Absence projects (D-06): time on these projects lowers available hours instead of counting as
// internal time. Owner and Admin mark them explicitly; nothing is matched by name. Every change
// sends the whole marked set (PUT) and is reversible, so unmarking is not confirmed.
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const organizationUrl = useSettingsOrganizationUrl();
const invalidate = useInvalidateProfitability();
const { data, isPending, isError, refetch } = useAbsenceSettingsQuery();

// The set being saved is shown at once; the server set takes over after the refetch, or again on
// failure (with the Save error toast).
const pendingIds = ref<string[] | null>(null);
const saving = ref(false);

const projects = computed<AbsenceProjectOption[]>(() => data.value?.projects ?? []);
const markedIds = computed<string[]>(() => pendingIds.value ?? data.value?.project_ids ?? []);

const projectById = computed(() => {
    const map = new Map<string, AbsenceProjectOption>();
    for (const project of projects.value) map.set(project.id, project);
    return map;
});

const marked = computed<AbsenceProjectOption[]>(() =>
    markedIds.value
        .map((id) => projectById.value.get(id))
        .filter((project): project is AbsenceProjectOption => project !== undefined)
);

const open = ref(false);
const search = ref('');

function setOpen(value: boolean) {
    if (value) search.value = '';
    open.value = value;
}

function emptySearch() {
    return '';
}

const options = computed<AbsenceProjectOption[]>(() => {
    const query = search.value.trim().toLowerCase();
    if (query === '') return projects.value;
    return projects.value.filter(
        (project) =>
            project.name.toLowerCase().includes(query) ||
            (project.client_name ?? '').toLowerCase().includes(query)
    );
});

async function save(ids: string[]) {
    const url = organizationUrl.value;
    if (url === null || saving.value) return;
    pendingIds.value = ids;
    saving.value = true;
    try {
        await updateAbsence(url, ids);
        useNotificationsStore().addNotification('success', label('admin.toasts.absence_updated'));
        await invalidate();
    } catch {
        useNotificationsStore().addNotification('error', label('common.save_error'));
    } finally {
        pendingIds.value = null;
        saving.value = false;
    }
}

function onSelect(value: unknown) {
    if (!Array.isArray(value)) return;
    const ids = value.filter((id): id is string => typeof id === 'string');
    void save(ids);
}

function unmark(project: AbsenceProjectOption) {
    void save(markedIds.value.filter((id) => id !== project.id));
}

const WARNING = 'text-amber-800 dark:text-amber-400';
const CHIP =
    'inline-flex items-center gap-1 rounded-md border border-input-border bg-card-background py-0.5 pl-2 pr-0.5 text-xs text-text-primary';
</script>

<template>
    <Card data-testid="profitability-settings-absence">
        <div class="px-4 pt-2">
            <CardTitle :title="label('admin.settings.absence_title')" :icon="CalendarRange" />
        </div>
        <div
            v-if="isPending"
            class="flex justify-center items-center py-12"
            aria-busy="true"
            data-testid="profitability-settings-absence-loading">
            <LoadingSpinner />
        </div>
        <div
            v-else-if="isError"
            class="p-4 flex flex-wrap items-center gap-3 text-sm text-text-secondary"
            data-testid="profitability-settings-absence-error">
            <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ label('common.load_error') }}</span>
            <SecondaryButton @click="refetch()">{{ label('common.try_again') }}</SecondaryButton>
        </div>
        <div v-else class="px-4 pt-1 pb-4 space-y-3">
            <p class="text-sm text-text-secondary">{{ label('admin.settings.absence_helper') }}</p>
            <div class="flex flex-wrap items-center gap-2">
                <Combobox
                    :model-value="markedIds"
                    multiple
                    :open="open"
                    :ignore-filter="true"
                    :disabled="saving"
                    data-testid="profitability-absence-picker"
                    @update:open="setOpen"
                    @update:model-value="onSelect">
                    <ComboboxAnchor class="w-auto">
                        <ComboboxTrigger as-child>
                            <Button
                                type="button"
                                variant="input"
                                class="justify-between gap-2 font-normal"
                                :aria-label="label('admin.settings.mark_absence')">
                                {{ label('admin.settings.mark_absence') }}
                                <ChevronDown class="text-icon-default" aria-hidden="true" />
                            </Button>
                        </ComboboxTrigger>
                    </ComboboxAnchor>
                    <ComboboxList>
                        <ComboboxInput
                            v-model="search"
                            :display-value="emptySearch"
                            auto-focus
                            :aria-label="label('admin.settings.mark_absence')"
                            :placeholder="label('admin.settings.mark_absence')" />
                        <ComboboxViewport class="p-1 max-h-72">
                            <ComboboxItem
                                v-for="project in options"
                                :key="project.id"
                                :value="project.id"
                                :text-value="project.name"
                                class="justify-between gap-2"
                                data-testid="profitability-absence-option">
                                <span class="min-w-0 truncate">
                                    {{ project.name }}
                                    <span v-if="project.client_name" class="text-text-tertiary">
                                        · {{ project.client_name }}
                                    </span>
                                </span>
                                <Check
                                    v-if="markedIds.includes(project.id)"
                                    class="size-4 shrink-0"
                                    aria-hidden="true" />
                            </ComboboxItem>
                        </ComboboxViewport>
                    </ComboboxList>
                </Combobox>
                <LoadingSpinner
                    v-if="saving"
                    class="h-4 w-4 m-0"
                    data-testid="profitability-absence-saving" />
                <span
                    v-for="project in marked"
                    :key="project.id"
                    :class="CHIP"
                    data-testid="profitability-absence-chip">
                    {{ project.name }}
                    <button
                        type="button"
                        class="rounded p-0.5 text-text-tertiary hover:bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        :aria-label="
                            label('admin.settings.unmark_absence_aria', { project: project.name })
                        "
                        :disabled="saving"
                        data-testid="profitability-absence-unmark"
                        @click="unmark(project)">
                        <X class="size-3" aria-hidden="true" />
                    </button>
                </span>
            </div>
            <p
                v-if="markedIds.length === 0"
                class="flex items-start gap-2 text-sm text-text-secondary"
                data-testid="profitability-absence-empty">
                <TriangleAlert :class="['size-4 shrink-0 mt-0.5', WARNING]" aria-hidden="true" />
                <span>{{ label('admin.settings.absence_empty') }}</span>
            </p>
        </div>
    </Card>
</template>
