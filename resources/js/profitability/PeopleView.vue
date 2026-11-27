<script setup lang="ts">
import { computed, ref } from 'vue';
import { Link } from '@inertiajs/vue3';
import { CircleAlert, CircleCheck, OctagonAlert, Users } from '@lucide/vue';
import Card from '@/Components/Common/Card.vue';
import StatCard from '@/Components/Common/StatCard.vue';
import TableHeading from '@/Components/Common/TableHeading.vue';
import { Badge } from '@/packages/ui/src';
import CardTitle from '@/packages/ui/src/CardTitle.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { useOrganizationQuery } from '@/utils/useOrganizationQuery';
import { getCurrentOrganizationId } from '@/utils/useUser';
import ChargeabilityChart from './ChargeabilityChart.vue';
import RangeSelect from './RangeSelect.vue';
import { plottedPeople } from './chargeabilityOption';
import { formatHours, formatPercent, formatPp } from './format';
import {
    initialRange,
    t,
    useProfitabilityProps,
    useViewToolbarTarget,
    type RangeKey,
} from './labels';
import { usePeopleViewQuery, type PeopleViewRow } from './peopleApi';

// The People view of the Profitability page (D-14, CHRG-02, CHRG-03): each person's chargeability
// (billable / available) against their dated target (D-13). Owner/Admin only (D-16): the page lists
// this tab only when the server's `views` carries `people`, and the endpoint answers 404 to anybody
// else, so no per-person figure ever reaches an account or project manager.
const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const { organization } = useOrganizationQuery(getCurrentOrganizationId() ?? '');
const numberFormat = computed(() => organization.value?.number_format ?? null);

function hours(seconds: number): string {
    return formatHours(seconds, numberFormat.value);
}

// Targets are whole percents (75), chargeability a ratio (0.68): both read "n %".
function targetText(percent: number): string {
    return formatPercent(percent / 100);
}

// Range, kept in ?range= by RangeSelect (UI-D13)
const range = ref<RangeKey>(initialRange());

const { data, isPending, isError, isFetching, refetch } = usePeopleViewQuery(range);

const hasData = computed(() => data.value !== undefined);
const rows = computed<PeopleViewRow[]>(() => data.value?.data ?? []);
const meta = computed(() => data.value?.meta ?? null);
const refreshing = computed(() => isFetching.value && hasData.value);

/** A person without a working week in force in the range has no available hours (08-11). */
function hasWorkingWeek(row: PeopleViewRow): boolean {
    return row.available_seconds !== null;
}

const kpi = computed(() => {
    const team = meta.value?.team;
    if (!team) return null;
    return {
        chargeability: team.chargeability === null ? null : formatPercent(team.chargeability),
        target:
            team.target_percent === null
                ? null
                : label('admin.people.kpi.target', { pct: targetText(team.target_percent) }),
        billable: hours(team.billable_seconds),
        available: hours(team.available_seconds),
        absence: hours(team.absence_seconds),
    };
});

// Nobody has a working week (or nobody is listed): chargeability cannot be calculated at all.
const isEmpty = computed(() => hasData.value && !rows.value.some(hasWorkingWeek));

const showChart = computed(() => plottedPeople(rows.value).length > 0);

/**
 * The Settings tab with that person's dialog (`?view=settings&member=`). An Inertia visit to the same
 * page remounts it, so the page reads the new `?view=`.
 */
function settingsHref(memberId?: string): string {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'settings');
    if (memberId) {
        url.searchParams.set('member', memberId);
    } else {
        url.searchParams.delete('member');
    }
    return `${url.pathname}${url.search}`;
}

// The 4px meter of the Chargeability cell: the scale grows past 100 % when a value or the target does,
// so a 110 % person still ends inside the track. The target is a 2px x 12px tick (UI-SPEC Spacing).
function meter(row: PeopleViewRow) {
    const value = Math.max(0, row.chargeability ?? 0);
    const target = row.target_percent === null ? null : Math.max(0, row.target_percent / 100);
    const scale = Math.max(1, value, target ?? 0);
    return {
        fill: `${Number(((value / scale) * 100).toFixed(3))}%`,
        tick:
            target === null ? null : `calc(${Number(((target / scale) * 100).toFixed(3))}% - 1px)`,
        max: Math.round(scale * 100),
        now: Math.round(value * 100),
        text:
            target === null
                ? formatPercent(value)
                : `${formatPercent(value)} · ${label('admin.people.kpi.target', { pct: targetText(row.target_percent as number) })}`,
    };
}

const CELL = 'px-4 py-3 border-b border-row-separator min-w-0';
const NUMBER_CELL = `${CELL} text-right tabular-nums text-base text-text-primary`;
const HEADER = 'px-4 py-1.5 text-left text-text-tertiary';
const HEADER_NUMBER = `${HEADER} text-right`;
const LOSS = 'text-red-700 dark:text-red-400';
const LINK = 'text-accent-500 dark:text-accent-400 hover:underline';

const STATUS = {
    on_track: { icon: CircleCheck, tone: 'text-green-800 dark:text-green-400' },
    below_target: { icon: OctagonAlert, tone: LOSS },
} as const;

const gridTemplate =
    'grid-template-columns: minmax(200px, 2fr) minmax(110px, auto) minmax(150px, auto)' +
    ' minmax(100px, auto) minmax(100px, auto) minmax(100px, auto) minmax(150px, auto)' +
    ' minmax(80px, auto) minmax(80px, auto) minmax(130px, auto);';

const toolbarTarget = useViewToolbarTarget();
const teleportTo = computed(() => toolbarTarget?.value ?? null);
</script>

<template>
    <div data-testid="profitability-people-view" class="space-y-6">
        <Teleport :to="teleportTo ?? 'body'" :disabled="teleportTo === null">
            <div class="flex items-start gap-3" data-testid="profitability-people-toolbar">
                <LoadingSpinner
                    v-if="refreshing"
                    class="h-4 w-4 m-0 mt-3"
                    data-testid="profitability-people-refreshing" />
                <RangeSelect
                    v-model="range"
                    :contains-today="meta?.range?.contains_today ?? false"
                    :date="meta?.range?.capped_to ?? null" />
            </div>
        </Teleport>

        <Card v-if="isError" data-testid="profitability-people-error">
            <div class="p-4 sm:p-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ label('common.load_error') }}</span>
                <SecondaryButton @click="refetch()">{{
                    label('common.try_again')
                }}</SecondaryButton>
            </div>
        </Card>

        <template v-else>
            <dl class="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                <StatCard :title="label('admin.people.kpi.team_chargeability')">
                    <span data-testid="profitability-people-team">{{
                        kpi?.chargeability ?? '--'
                    }}</span>
                    <span
                        v-if="kpi?.target"
                        class="block text-xs font-normal text-text-secondary"
                        data-testid="profitability-people-team-target">
                        {{ kpi.target }}
                    </span>
                </StatCard>
                <StatCard
                    :title="label('admin.people.kpi.billable_hours')"
                    :value="kpi?.billable" />
                <StatCard
                    :title="label('admin.people.kpi.available_hours')"
                    :value="kpi?.available" />
                <StatCard :title="label('admin.people.kpi.absence_hours')" :value="kpi?.absence" />
            </dl>

            <Card v-if="isPending">
                <div
                    class="flex justify-center items-center py-12"
                    data-testid="profitability-people-loading"
                    aria-busy="true">
                    <LoadingSpinner />
                </div>
            </Card>

            <Card v-else-if="isEmpty">
                <div
                    class="py-12 px-4 flex flex-col items-center text-center gap-1"
                    data-testid="profitability-people-empty">
                    <p class="text-base font-semibold text-text-primary">
                        {{ label('admin.people.empty_title') }}
                    </p>
                    <p class="text-sm text-text-secondary max-w-md">
                        {{ label('admin.people.empty_body') }}
                    </p>
                    <Link
                        :href="settingsHref()"
                        :class="['text-sm pt-2', LINK]"
                        data-testid="profitability-people-go-to-settings">
                        {{ label('admin.people.go_to_settings') }}
                    </Link>
                </div>
            </Card>

            <template v-else>
                <section v-if="showChart" data-testid="profitability-people-chart">
                    <CardTitle :title="label('admin.people.chart_title')" :icon="Users" />
                    <Card>
                        <div class="p-4">
                            <ChargeabilityChart
                                :people="rows"
                                :range-label="label(`ranges.${range}`)"
                                :labels="labels"
                                :number-format="numberFormat" />
                        </div>
                    </Card>
                </section>

                <Card>
                    <div class="overflow-x-auto">
                        <div
                            role="table"
                            :aria-label="label('tabs.people')"
                            class="grid min-w-full w-max lg:w-full"
                            :style="gridTemplate"
                            data-testid="profitability-people-table">
                            <TableHeading>
                                <div role="columnheader" :class="[HEADER, 'sticky left-0 z-10']">
                                    {{ label('admin.people.columns.person') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.working_week') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.available') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.absence') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.billable') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.internal') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.chargeability') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.target') }}
                                </div>
                                <div role="columnheader" :class="HEADER_NUMBER">
                                    {{ label('admin.people.columns.gap') }}
                                </div>
                                <div role="columnheader" :class="HEADER">
                                    {{ label('admin.people.columns.status') }}
                                </div>
                            </TableHeading>

                            <div
                                v-for="row in rows"
                                :key="row.member_id"
                                role="row"
                                class="contents"
                                data-testid="profitability-people-row"
                                :data-member-id="row.member_id">
                                <div
                                    role="cell"
                                    :class="[
                                        CELL,
                                        'sticky left-0 z-10 bg-card-background flex items-center gap-2',
                                    ]">
                                    <span
                                        class="truncate text-base text-text-primary"
                                        :title="row.name">
                                        {{ row.name }}
                                    </span>
                                    <Badge
                                        v-if="row.is_placeholder"
                                        class="shrink-0"
                                        data-testid="profitability-people-former">
                                        {{ label('common.former_member') }}
                                    </Badge>
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    <template v-if="row.weekly_seconds !== null">{{
                                        hours(row.weekly_seconds)
                                    }}</template>
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    <template v-if="row.available_seconds !== null">{{
                                        hours(row.available_seconds)
                                    }}</template>
                                    <span
                                        v-else
                                        class="flex flex-col items-end gap-0.5 text-sm"
                                        data-testid="profitability-people-no-working-week">
                                        <span class="text-text-secondary">{{
                                            label('admin.people.no_working_week')
                                        }}</span>
                                        <Link
                                            :href="settingsHref(row.member_id)"
                                            :class="['text-xs', LINK]"
                                            data-testid="profitability-people-set-in-settings">
                                            {{ label('admin.people.set_in_settings') }}
                                        </Link>
                                    </span>
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    {{ hours(row.absence_seconds) }}
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    {{ hours(row.billable_seconds) }}
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    {{ hours(row.internal_seconds) }}
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    <span
                                        v-if="!hasWorkingWeek(row)"
                                        class="text-sm text-text-secondary">
                                        {{ label('admin.people.no_working_week') }}
                                    </span>
                                    <div
                                        v-else-if="row.chargeability !== null"
                                        class="flex flex-col items-end gap-1">
                                        <span data-testid="profitability-people-chargeability">{{
                                            formatPercent(row.chargeability)
                                        }}</span>
                                        <div
                                            role="meter"
                                            class="relative w-24"
                                            aria-valuemin="0"
                                            :aria-valuemax="meter(row).max"
                                            :aria-valuenow="meter(row).now"
                                            :aria-valuetext="meter(row).text"
                                            data-testid="profitability-people-meter">
                                            <div
                                                class="relative h-1 w-full overflow-hidden rounded-full bg-quaternary">
                                                <div
                                                    class="absolute inset-y-0 left-0 rounded-l-full bg-accent-400 dark:bg-accent-200"
                                                    :style="{ width: meter(row).fill }"></div>
                                            </div>
                                            <div
                                                v-if="meter(row).tick"
                                                class="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-text-primary"
                                                :style="{ left: meter(row).tick as string }"
                                                aria-hidden="true"
                                                data-testid="profitability-people-meter-tick"></div>
                                        </div>
                                    </div>
                                    <template v-else>--</template>
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    <template v-if="row.target_percent !== null">{{
                                        targetText(row.target_percent)
                                    }}</template>
                                </div>
                                <div role="cell" :class="NUMBER_CELL">
                                    <span
                                        v-if="row.gap_points !== null"
                                        :class="row.status === 'below_target' ? LOSS : ''"
                                        data-testid="profitability-people-gap">
                                        {{ formatPp(row.gap_points) }}
                                    </span>
                                </div>
                                <div role="cell" :class="[CELL, 'flex items-center']">
                                    <span
                                        v-if="row.status"
                                        :class="[
                                            'inline-flex items-center gap-1 text-xs font-semibold',
                                            STATUS[row.status].tone,
                                        ]"
                                        data-testid="profitability-people-status"
                                        :data-status="row.status">
                                        <component
                                            :is="STATUS[row.status].icon"
                                            class="size-3.5 shrink-0"
                                            aria-hidden="true" />
                                        <span>{{ label(`status.${row.status}`) }}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </template>
        </template>
    </div>
</template>
