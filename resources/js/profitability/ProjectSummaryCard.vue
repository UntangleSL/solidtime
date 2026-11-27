<script setup lang="ts">
import { computed } from 'vue';
import { Briefcase } from '@lucide/vue';
import MainContainer from '@/packages/ui/src/MainContainer.vue';
import CardTitle from '@/packages/ui/src/CardTitle.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import { formatHours } from './format';
import { t, useProfitabilityProps } from './labels';
import { isNotFound, useProjectSummaryQuery } from './summaryApi';

// Contract card on the project page (D-14, UI-SPEC "Project summary card"). It renders only what the
// server allows: without `project.summary_url` in the shared prop there is no markup and no request,
// and a 404 from the summary endpoint renders nothing (no empty card, no error).
const props = defineProps<{
    projectId: string;
}>();

const profitability = useProfitabilityProps();
const summaryUrl = computed(() => profitability.value.project?.summary_url ?? null);
const labels = computed(() => profitability.value.labels ?? null);

const { data, isPending, isError, error, refetch } = useProjectSummaryQuery(
    summaryUrl,
    () => props.projectId
);

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

const visible = computed(
    () => summaryUrl.value !== null && !(isError.value && isNotFound(error.value))
);

const summary = computed(() => data.value ?? null);
const period = computed(() => summary.value?.period ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

function hours(seconds: number | undefined): string | undefined {
    return seconds === undefined ? undefined : formatHours(seconds, numberFormat.value);
}
</script>

<template>
    <MainContainer v-if="visible" class="pt-6" data-testid="profitability-summary-card">
        <CardTitle :title="label('summary.title')" :icon="Briefcase" />
        <Card>
            <div
                v-if="isPending"
                class="min-h-[160px] flex items-center justify-center py-12"
                data-testid="profitability-summary-loading"
                aria-busy="true">
                <LoadingSpinner />
            </div>
            <div
                v-else-if="isError || !summary"
                class="p-4 sm:p-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary"
                data-testid="profitability-summary-error">
                <span>{{ label('common.load_error') }}</span>
                <Button type="button" variant="ghost" size="sm" @click="refetch()">
                    {{ label('common.try_again') }}
                </Button>
            </div>
            <div
                v-else-if="summary.contract === null"
                class="py-12 px-4 flex flex-col items-center text-center gap-1"
                data-testid="profitability-summary-empty">
                <p class="text-base font-semibold text-text-primary">
                    {{ label('summary.empty_title') }}
                </p>
                <p class="text-sm text-text-secondary">
                    {{
                        summary.can_edit_terms
                            ? label('summary.empty_body_editor')
                            : label('summary.empty_body_pm')
                    }}
                </p>
            </div>
            <div v-else class="p-4 sm:p-6 space-y-6">
                <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard :title="label('kpi.hours_sold')">
                        <span class="tabular-nums" data-testid="profitability-summary-sold">{{
                            hours(period?.budget_seconds) ?? '--'
                        }}</span>
                    </StatCard>
                    <StatCard :title="label('kpi.consumed')">
                        <span class="tabular-nums" data-testid="profitability-summary-consumed">{{
                            hours(period?.consumed_seconds) ?? '--'
                        }}</span>
                    </StatCard>
                </dl>
            </div>
        </Card>
    </MainContainer>
</template>
