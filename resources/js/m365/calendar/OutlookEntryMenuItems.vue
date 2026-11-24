<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue';
import { TriangleAlert } from '@lucide/vue';
import { ContextMenuItem, ContextMenuSeparator } from '@/packages/ui/src/context-menu';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Fork items at the top of the core time entry context menu (06-UI-SPEC sections 2 and 6): a
// flagged entry gets "Review Outlook change" and its own separator before the core items, the
// keyboard path to the resolve popover (Shift+F10 / the context-menu key on a focused entry).
// Unflagged entries, or a context that cannot act, render nothing, so the core menu stays exactly
// as it is. The popover is requested only after the menu has closed (never a popover while the
// menu is open).
const props = defineProps<{
    timeEntryId: string;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const labels = computed(() => context?.labels.value ?? null);

const flagged = computed(
    () => context?.canAct.value === true && (context.flagOf?.(props.timeEntryId) ?? null) !== null
);

const rootEl = ref<HTMLElement | null>(null);

// Waits until the reka menu has closed and given focus back (it restores it in a zero-delay
// timeout after the content unmounts), so that restore does not undo what follows. Same pattern
// as OutlookMeetingContextItems.
async function afterMenuClosed(menu: Element | null): Promise<void> {
    await nextTick();
    if (menu && menu.isConnected) {
        await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => {
                if (!menu.isConnected) finish();
            });
            const fallback = setTimeout(finish, 1000);
            function finish(): void {
                observer.disconnect();
                clearTimeout(fallback);
                resolve();
            }
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function onReview(): Promise<void> {
    if (!context || !flagged.value) return;
    const menu = rootEl.value?.closest('[role="menu"]') ?? null;
    const id = props.timeEntryId;
    await afterMenuClosed(menu);
    context.openFlagPanel(id, { anchor: 'entry', origin: 'entry' });
}
</script>

<template>
    <div v-if="flagged && labels" ref="rootEl" data-testid="outlook-entry-menu">
        <ContextMenuItem
            class="space-x-3"
            data-testid="outlook-entry-menu-review"
            @select="onReview()">
            <TriangleAlert
                class="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden="true" />
            <span>{{ labels.osync_review }}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
    </div>
</template>
