<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue';
import { ClockPlus, ExternalLink, Eye, EyeOff } from '@lucide/vue';
import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
} from '@/packages/ui/src/context-menu';
import type { OutlookMeeting } from '@/m365/types';
import { safeHttpsUrl } from './safeUrl';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Items of the meeting context menu (UI-SPEC 3.1 section 4, D-06; Phase 4 UI-SPEC section 4),
// rendered through the core `context-menu-overlay` slot of TimeEntryCalendar for the right-clicked
// meeting block. The menu starts a conversion ("Create time entry" opens the meeting's form in its
// panel once the menu has closed), opens Outlook or dismisses / restores the meeting; it never
// changes or deletes a time entry itself. It always acts on the right-clicked meeting only. Meeting
// values are only ever rendered through text interpolation.
const props = defineProps<{
    element: HTMLElement;
}>();

const context = inject(OUTLOOK_MEETINGS_KEY, null);
const labels = computed(() => context?.labels.value ?? null);

// The meeting is resolved from the block's id against the current list at render time, so a stale
// element (meeting gone after a sync) renders only the label and no action (T-03.1-08).
const meeting = computed<OutlookMeeting | null>(() => {
    const id = props.element.dataset.ghostId;
    if (!context || !id) return null;
    return context.meetings.value.find((candidate) => candidate.id === id) ?? null;
});

const subject = computed(() => {
    const value = meeting.value?.subject;
    return value && value.trim() ? value : (labels.value?.no_subject ?? '');
});

const link = computed(() => (meeting.value ? safeHttpsUrl(meeting.value.web_link) : null));
const canAct = computed(() => meeting.value !== null && context?.canAct.value === true);

const rootEl = ref<HTMLElement | null>(null);

function openInOutlook(): void {
    if (link.value) window.open(link.value, '_blank', 'noopener,noreferrer');
}

// Focus moves only after the menu has closed and given focus back (reka restores it in a zero-delay
// timeout after the content unmounts), otherwise that restore would undo the move.
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

function blockIn(root: ParentNode, id: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(`[data-ghost-id="${CSS.escape(id)}"]`);
}

function syncButton(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="outlook-sync-button"]');
}

// Same rules as the detail panel (Phase 3 03-09 / 03-10): after a dismiss the next meeting of the
// day gets focus (the previous one for the last), the same block while dismissed meetings are
// shown, else the Sync button. A restore keeps focus on that meeting.
async function onDismiss(): Promise<void> {
    const current = meeting.value;
    if (!context || !current) return;
    const menu = rootEl.value?.closest('[role="menu"]') ?? null;
    const group = props.element.closest('[role="group"]');
    const stays = context.includeDismissed.value === true;
    const blocks = group ? Array.from(group.querySelectorAll<HTMLElement>('[data-ghost-id]')) : [];
    const index = blocks.findIndex((block) => block.dataset.ghostId === current.id);
    const neighbour = index === -1 ? null : (blocks[index + 1] ?? blocks[index - 1] ?? null);
    const targetId = stays ? current.id : (neighbour?.dataset.ghostId ?? null);

    void context.dismiss(current.id);
    await afterMenuClosed(menu);

    const root: ParentNode = group?.isConnected ? group : document;
    const target = targetId ? blockIn(root, targetId) : null;
    (target ?? syncButton())?.focus();
}

// The panel opens in form mode only after the menu has closed (3.1 layering rule: never a panel
// while the menu is open); the lane's formRequest watcher does the opening.
async function onCreate(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || !canAct.value) return;
    const menu = rootEl.value?.closest('[role="menu"]') ?? null;
    await afterMenuClosed(menu);
    context.openForm(current.id);
}

async function onRestore(): Promise<void> {
    const current = meeting.value;
    if (!context || !current) return;
    const menu = rootEl.value?.closest('[role="menu"]') ?? null;
    const group = props.element.closest('[role="group"]');

    void context.restore(current.id);
    await afterMenuClosed(menu);

    const root: ParentNode = group?.isConnected ? group : document;
    blockIn(root, current.id)?.focus();
}
</script>

<template>
    <div v-if="labels" ref="rootEl" class="min-w-[200px]" data-testid="outlook-meeting-menu">
        <ContextMenuLabel
            class="max-w-56 truncate text-xs font-normal text-text-tertiary"
            data-testid="outlook-menu-label">
            {{ subject }}
        </ContextMenuLabel>
        <ContextMenuItem
            v-if="canAct && meeting"
            class="space-x-3"
            data-testid="outlook-menu-create"
            @select="onCreate()">
            <ClockPlus class="w-4 h-4 text-icon-default" aria-hidden="true" />
            <span>{{ labels.create_entry }}</span>
        </ContextMenuItem>
        <ContextMenuItem
            v-if="link"
            class="space-x-3"
            data-testid="outlook-menu-open"
            @select="openInOutlook()">
            <ExternalLink class="w-4 h-4 text-icon-default" aria-hidden="true" />
            <span>{{ labels.open_in_outlook }}</span>
            <span class="sr-only">{{ labels.opens_new_tab }}</span>
        </ContextMenuItem>
        <template v-if="canAct && meeting">
            <ContextMenuSeparator />
            <ContextMenuItem
                v-if="meeting.dismissed"
                class="space-x-3"
                data-testid="outlook-menu-restore"
                @select="onRestore()">
                <Eye class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.restore }}</span>
            </ContextMenuItem>
            <ContextMenuItem
                v-else
                class="space-x-3"
                data-testid="outlook-menu-dismiss"
                @select="onDismiss()">
                <EyeOff class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.dismiss }}</span>
            </ContextMenuItem>
        </template>
    </div>
</template>
