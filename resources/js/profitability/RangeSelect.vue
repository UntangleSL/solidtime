<script setup lang="ts">
import { computed, watch } from 'vue';
import dayjs from 'dayjs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src/select';
import {
    DEFAULT_RANGE,
    RANGE_KEYS,
    isRangeKey,
    replaceQueryParam,
    t,
    useProfitabilityProps,
    type RangeKey,
} from './labels';

// Shared range toolbar of the Clients and People views (08-17, 08-18). The value is the v-model and is
// mirrored to `?range=` with history.replaceState; a view starts from `initialRange()` (labels.ts).
// The 12px caption appears only when the parent says the range contains today and passes the date
// the figures run to.
const props = defineProps<{
    containsToday?: boolean;
    date?: string | null;
}>();

const range = defineModel<RangeKey>({ default: DEFAULT_RANGE });

const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

function label(path: string, params?: Record<string, string | number>): string {
    return t(labels.value, path, params);
}

const options = computed(() => RANGE_KEYS.map((key) => ({ key, text: label(`ranges.${key}`) })));

watch(range, (value) => replaceQueryParam('range', value));

function select(value: unknown) {
    if (isRangeKey(value)) range.value = value;
}

const caption = computed(() => {
    if (!props.containsToday || !props.date) return null;
    return label('common.figures_up_to_today', {
        range: label(`ranges.${range.value}`),
        date: dayjs(props.date.slice(0, 10)).format('D MMM YYYY'),
    });
});
</script>

<template>
    <div class="flex flex-col items-end gap-1" data-testid="profitability-range">
        <Select :model-value="range" @update:model-value="select">
            <SelectTrigger class="w-48" :aria-label="label('ranges.label')">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem v-for="option in options" :key="option.key" :value="option.key">
                    {{ option.text }}
                </SelectItem>
            </SelectContent>
        </Select>
        <p
            v-if="caption"
            class="text-xs text-text-secondary tabular-nums"
            data-testid="profitability-range-caption">
            {{ caption }}
        </p>
    </div>
</template>
