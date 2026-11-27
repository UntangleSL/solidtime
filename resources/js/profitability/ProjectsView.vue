<script setup lang="ts">
import { computed } from 'vue';
import Card from '@/Components/Common/Card.vue';
import TableHeading from '@/Components/Common/TableHeading.vue';
import { Badge } from '@/packages/ui/src';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { formatHours, formatPeriod } from './format';
import { t, useProfitabilityProps } from './labels';
import { useProjectsViewQuery } from './projectsApi';

// The by-project view of the Profitability page (D-14): one row per project in the caller's scope.
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

const { data, isPending } = useProjectsViewQuery('active');
const rows = computed(() => data.value?.data ?? []);

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

function label(path: string): string {
    return t(labels.value, path);
}
</script>

<template>
    <div data-testid="profitability-projects-view">
        <Card>
            <div
                class="grid min-w-full"
                style="grid-template-columns: minmax(220px, 2fr) minmax(170px, 1fr) 110px 110px">
                <TableHeading>
                    <div class="px-4 py-1.5 text-text-tertiary">
                        {{ label('projects.columns.project') }}
                    </div>
                    <div class="px-4 py-1.5 text-text-tertiary">
                        {{ label('projects.columns.period') }}
                    </div>
                    <div class="px-4 py-1.5 text-text-tertiary text-right">
                        {{ label('projects.columns.sold') }}
                    </div>
                    <div class="px-4 py-1.5 text-text-tertiary text-right">
                        {{ label('projects.columns.consumed') }}
                    </div>
                </TableHeading>
                <div v-if="isPending" class="col-span-full flex justify-center py-12">
                    <LoadingSpinner />
                </div>
                <div v-for="row in rows" :key="row.project_id" role="row" class="contents">
                    <div class="px-4 py-3 border-b border-row-separator min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                            <span
                                class="w-3 h-3 rounded-full shrink-0"
                                :style="{ backgroundColor: row.color }"></span>
                            <span class="truncate text-base text-text-primary" :title="row.name">{{
                                row.name
                            }}</span>
                        </div>
                        <div
                            v-if="row.client_name"
                            class="truncate text-xs text-text-secondary pl-5"
                            :title="row.client_name">
                            {{ row.client_name }}
                        </div>
                    </div>
                    <div class="px-4 py-3 border-b border-row-separator text-sm tabular-nums">
                        <template v-if="row.period">
                            {{ formatPeriod(row.period.starts_on, row.period.ends_on) }}
                            <Badge class="ml-1">{{
                                label(`period_state.${row.period.state}`)
                            }}</Badge>
                        </template>
                    </div>
                    <div
                        class="px-4 py-3 border-b border-row-separator text-right tabular-nums text-base">
                        {{ formatHours(row.budget_seconds, numberFormat) }}
                    </div>
                    <div
                        class="px-4 py-3 border-b border-row-separator text-right tabular-nums text-base">
                        {{ formatHours(row.consumed_seconds, numberFormat) }}
                    </div>
                </div>
            </div>
        </Card>
    </div>
</template>
