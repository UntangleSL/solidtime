<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleAlert, Pencil, TriangleAlert, Users } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import { Badge, Button, CardTitle } from '@/packages/ui/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { capitalizeFirstLetter } from '@/utils/format';
import PersonSettingsDialog from './PersonSettingsDialog.vue';
import { readQueryParam, replaceQueryParam, t, useProfitabilityProps } from './labels';
import { usePeopleSettingsQuery, useSettingsFormat, type SettingsPerson } from './settingsApi';

// People card of the Settings tab (BUDG-05, CHRG-01): every member, placeholders included (their
// past hours still need a cost, A8), with the values in force today. Rows without an hourly cost or
// a working week are the focal point: "Not set" with the only amber icon of the view.
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const format = useSettingsFormat();
const { data, isPending, isError, refetch } = usePeopleSettingsQuery();
const people = computed<SettingsPerson[]>(() => data.value ?? []);

// `?member=<id>` opens that person's dialog (the People view's "Set in Settings" link, 08-18).
const selectedId = ref<string | null>(readQueryParam('member'));
const selected = computed(
    () => people.value.find((person) => person.member_id === selectedId.value) ?? null
);

function edit(person: SettingsPerson) {
    selectedId.value = person.member_id;
}

function closeDialog() {
    selectedId.value = null;
    replaceQueryParam('member', null);
}

const WARNING = 'text-amber-800 dark:text-amber-400';
const HEAD = 'px-4 py-2 text-left text-xs font-medium text-text-secondary whitespace-nowrap';
const CELL = 'px-4 py-3 border-t border-row-separator text-sm text-text-primary align-middle';
const NUMBER_CELL = `${CELL} tabular-nums whitespace-nowrap`;
</script>

<template>
    <Card data-testid="profitability-settings-people">
        <div class="px-4 pt-2">
            <CardTitle :title="label('admin.settings.people_title')" :icon="Users" />
        </div>
        <div
            v-if="isPending"
            class="flex justify-center items-center py-12"
            aria-busy="true"
            data-testid="profitability-settings-people-loading">
            <LoadingSpinner />
        </div>
        <div
            v-else-if="isError"
            class="p-4 flex flex-wrap items-center gap-3 text-sm text-text-secondary"
            data-testid="profitability-settings-people-error">
            <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ label('common.load_error') }}</span>
            <SecondaryButton @click="refetch()">{{ label('common.try_again') }}</SecondaryButton>
        </div>
        <div v-else class="overflow-x-auto">
            <TooltipProvider>
                <table class="w-full" data-testid="profitability-settings-people-table">
                    <thead>
                        <tr>
                            <th :class="HEAD">
                                {{ label('admin.settings.people_columns.person') }}
                            </th>
                            <th :class="HEAD">{{ label('admin.settings.people_columns.role') }}</th>
                            <th :class="HEAD">
                                {{ label('admin.settings.people_columns.hourly_cost') }}
                            </th>
                            <th :class="HEAD">
                                {{ label('admin.settings.people_columns.working_week') }}
                            </th>
                            <th :class="HEAD">
                                {{ label('admin.settings.people_columns.target') }}
                            </th>
                            <th :class="HEAD">
                                {{ label('admin.settings.people_columns.since') }}
                            </th>
                            <th class="w-14"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="person in people"
                            :key="person.member_id"
                            data-testid="profitability-settings-person-row"
                            :data-member-id="person.member_id">
                            <td :class="CELL">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="truncate" :title="person.name">{{
                                        person.name
                                    }}</span>
                                    <Badge
                                        v-if="person.is_placeholder"
                                        data-testid="profitability-former-member">
                                        {{ label('common.former_member') }}
                                    </Badge>
                                </div>
                            </td>
                            <td :class="[CELL, 'text-text-secondary']">
                                {{ capitalizeFirstLetter(person.role) }}
                            </td>
                            <td :class="NUMBER_CELL">
                                <template v-if="person.hourly_cost_cents !== null">
                                    {{
                                        label('admin.settings.per_hour', {
                                            value: format.money(person.hourly_cost_cents),
                                        })
                                    }}
                                </template>
                                <span
                                    v-else
                                    class="inline-flex items-center gap-1.5 text-text-secondary"
                                    data-testid="profitability-settings-not-set">
                                    {{ label('admin.settings.not_set') }}
                                    <Tooltip>
                                        <TooltipTrigger as-child>
                                            <TriangleAlert
                                                :class="['size-4', WARNING]"
                                                tabindex="0"
                                                :aria-label="
                                                    label('admin.settings.not_set_tooltip')
                                                " />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {{ label('admin.settings.not_set_tooltip') }}
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                            </td>
                            <td :class="NUMBER_CELL">
                                <template v-if="person.weekly_seconds !== null">
                                    {{ format.hours(person.weekly_seconds) }}
                                </template>
                                <span
                                    v-else
                                    class="inline-flex items-center gap-1.5 text-text-secondary"
                                    data-testid="profitability-settings-not-set">
                                    {{ label('admin.settings.not_set') }}
                                    <Tooltip>
                                        <TooltipTrigger as-child>
                                            <TriangleAlert
                                                :class="['size-4', WARNING]"
                                                tabindex="0"
                                                :aria-label="
                                                    label('admin.settings.not_set_tooltip')
                                                " />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {{ label('admin.settings.not_set_tooltip') }}
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                            </td>
                            <td :class="NUMBER_CELL">
                                <template v-if="person.target_percent !== null">
                                    {{ person.target_percent }} %
                                </template>
                            </td>
                            <td :class="NUMBER_CELL">
                                <template v-if="person.since">{{
                                    format.date(person.since)
                                }}</template>
                            </td>
                            <td :class="[CELL, 'text-right']">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="size-8"
                                    :aria-label="
                                        label('admin.settings.edit_aria', { name: person.name })
                                    "
                                    data-testid="profitability-settings-edit-person"
                                    @click="edit(person)">
                                    <Pencil class="size-4" aria-hidden="true" />
                                </Button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </TooltipProvider>
        </div>
        <PersonSettingsDialog :show="selected !== null" :person="selected" @close="closeDialog" />
    </Card>
</template>
