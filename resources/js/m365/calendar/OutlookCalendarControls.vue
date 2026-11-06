<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { Link, RefreshCw, TriangleAlert } from '@lucide/vue';
import type { Organization } from '@/packages/api/src';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { navigateTo } from '@/m365/navigation';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';
import { describeLastSynced, describeSyncStatus } from './syncStatus';

// Sync half of the Outlook cluster in the calendar toolbar (rendered through the core `extra`
// slot). It reads everything from the injected composable context and never blocks the grid:
// there is no dialog, and meetings are only ever a status text and a spinning icon here. The
// connection state picks the variant: Sync + status (connected), "Reconnect Microsoft" in the Sync
// position (reconnect) or only "Connect Microsoft 365" (not connected); no error banner anywhere.
const context = inject(OUTLOOK_MEETINGS_KEY, null);
const organization = inject<ComputedRef<Organization | undefined> | undefined>(
    'organization',
    undefined
);

const labels = computed(() => context?.labels.value ?? null);
const isConnected = computed(() => context?.connectionState.value === 'connected');
const isReconnect = computed(() => context?.connectionState.value === 'reconnect');
const isNotConnected = computed(() => context?.connectionState.value === 'not_connected');
const isSyncing = computed(() => context?.isSyncing.value === true);
const timeFormat = computed(() => organization?.value?.time_format ?? '24-hours');

const status = computed(() => {
    if (!context || !labels.value) return null;
    return describeSyncStatus({
        isSyncing: context.isSyncing.value,
        lastSync: context.lastSync.value,
        readFailed: context.readFailed.value,
        syncedAt: context.syncedAt.value,
        visibleCount: context.visibleCount.value,
        labels: labels.value,
        timeFormat: timeFormat.value,
        now: new Date(),
    });
});

// Reconnect keeps the last known meetings on screen, so it says when they were last synced.
const reconnectStatus = computed(() => {
    const syncedAt = context?.syncedAt.value;
    if (!isReconnect.value || !labels.value || !syncedAt) return null;
    return describeLastSynced(syncedAt, labels.value, timeFormat.value, new Date());
});

// The Sync tooltip carries the status (it is the only place a sighted user finds it below lg) and
// the extra sentence of the state, or the button name while there is nothing to say.
const tooltipLines = computed(() => {
    const lines: string[] = [];
    if (status.value?.text) lines.push(status.value.text);
    if (status.value?.tooltip) lines.push(status.value.tooltip);
    if (lines.length === 0 && labels.value) lines.push(labels.value.sync_aria);
    return lines;
});

function onSync() {
    context?.requestSync(true);
}

// Full-page navigation: the Microsoft OAuth redirect is cross-origin, so never Inertia's router.
function onConnect() {
    const url = context?.calendar.value?.connect_url;
    if (url) navigateTo(url);
}
</script>

<template>
    <div
        v-if="context && context.calendar.value"
        data-testid="outlook-calendar-controls"
        class="flex items-center gap-2">
        <template v-if="isConnected && labels">
            <div
                role="status"
                aria-live="polite"
                data-testid="outlook-sync-status"
                class="flex min-w-0 items-center gap-1.5">
                <TriangleAlert
                    v-if="status?.warning"
                    class="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true" />
                <span
                    v-if="status?.text"
                    class="sr-only text-xs text-text-tertiary lg:not-sr-only lg:max-w-64 lg:truncate">
                    {{ status.text }}
                </span>
            </div>
            <TooltipProvider :delay-duration="300">
                <Tooltip>
                    <TooltipTrigger as-child>
                        <span class="inline-flex">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="outlook-sync-button"
                                class="w-8 p-0 md:w-auto md:px-3"
                                :aria-label="labels.sync_aria"
                                :aria-busy="isSyncing ? 'true' : 'false'"
                                :disabled="!context.canSync.value"
                                @click="onSync">
                                <RefreshCw
                                    aria-hidden="true"
                                    :class="
                                        isSyncing
                                            ? 'motion-safe:animate-spin text-accent-500 dark:text-accent-400'
                                            : ''
                                    " />
                                <span class="hidden md:inline">{{ labels.sync }}</span>
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p v-for="line in tooltipLines" :key="line">{{ line }}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </template>
        <template v-else-if="(isReconnect || isNotConnected) && labels">
            <div
                v-if="reconnectStatus"
                role="status"
                aria-live="polite"
                data-testid="outlook-sync-status"
                class="flex min-w-0 items-center gap-1.5">
                <span
                    class="sr-only text-xs text-text-tertiary lg:not-sr-only lg:max-w-64 lg:truncate">
                    {{ reconnectStatus }}
                </span>
            </div>
            <TooltipProvider :delay-duration="300">
                <Tooltip>
                    <TooltipTrigger as-child>
                        <span class="inline-flex">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                :data-testid="
                                    isReconnect
                                        ? 'outlook-reconnect-button'
                                        : 'outlook-connect-button'
                                "
                                class="w-8 p-0 md:w-auto md:px-3"
                                :aria-label="isReconnect ? labels.reconnect : labels.connect"
                                @click="onConnect">
                                <TriangleAlert
                                    v-if="isReconnect"
                                    class="text-amber-600 dark:text-amber-400"
                                    aria-hidden="true" />
                                <Link v-else aria-hidden="true" />
                                <span class="hidden md:inline">
                                    {{ isReconnect ? labels.reconnect : labels.connect }}
                                </span>
                            </Button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{{ isReconnect ? labels.reconnect_hint : labels.connect_hint }}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </template>
    </div>
</template>
