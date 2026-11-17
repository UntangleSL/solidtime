<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue';
import {
    CalendarOff,
    Check,
    ClockPlus,
    ExternalLink,
    Eye,
    EyeOff,
    ListChecks,
    Pencil,
    Undo2,
    Unlink,
    X,
} from '@lucide/vue';
import {
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
} from '@/packages/ui/src/context-menu';
import type { OutlookMeeting } from '@/m365/types';
import OutlookProjectDot from './OutlookProjectDot.vue';
import { safeHttpsUrl } from './safeUrl';
import { isPreassigned, isRecurring } from './suggestions';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// Items of the meeting context menu (UI-SPEC 3.1 section 4, D-06; Phase 4 UI-SPEC section 4),
// rendered through the core `context-menu-overlay` slot of TimeEntryCalendar for the right-clicked
// meeting block. The menu starts a conversion ("Create time entry" opens the meeting's form in its
// panel once the menu has closed), opens Outlook or dismisses / restores the meeting; it never
// changes or deletes a time entry itself. It always acts on the right-clicked meeting only. Meeting
// values are only ever rendered through text interpolation.
// Phase 5 (UI-SPEC section 4): a pre-assigned meeting offers Confirm (with its project as a hint)
// and Edit in place of "Create time entry"; recurring meetings get the series controls (always
// ignore / stop ignoring / forget this series).
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

// Pre-assigned and not faded (a dismissed or series-ignored occurrence is never pre-assigned).
const assignment = computed(() =>
    canAct.value && meeting.value !== null && isPreassigned(meeting.value)
        ? (meeting.value.assignment ?? null)
        : null
);
const confirmPending = computed(
    () => meeting.value !== null && context?.isConfirmPending(meeting.value.id) === true
);

function menuOf(): Element | null {
    return rootEl.value?.closest('[role="menu"]') ?? null;
}

// Select / Deselect: the keyboard and discoverable path to multi-select (D-07), always for the
// right-clicked meeting only, even while other meetings are selected.
const selected = computed(
    () => meeting.value !== null && context?.selection?.isSelected(meeting.value.id) === true
);

function onToggleSelect(): void {
    const current = meeting.value;
    if (!context || !current || !canAct.value) return;
    context.selection.toggle(current.id);
}

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

// Same rules as the detail panel (Phase 3 03-09 / 03-10, Phase 5 UI-SPEC section 5): after a
// dismiss or "Always ignore this series" the next meeting of the day that stays in the lane gets
// focus (the previous one for the last), the same block while dismissed meetings are shown (the
// meeting turns faded instead of leaving), else the Sync button. `leaving` are the ids that leave
// the lane with the action (the meeting itself, or every occurrence of its series).
async function hideAndRefocus(
    current: OutlookMeeting,
    leaving: ReadonlySet<string>,
    action: (id: string) => Promise<void>
): Promise<void> {
    if (!context) return;
    const menu = menuOf();
    const group = props.element.closest('[role="group"]');
    const stays = context.includeDismissed.value === true;
    const blocks = group ? Array.from(group.querySelectorAll<HTMLElement>('[data-ghost-id]')) : [];
    const index = blocks.findIndex((block) => block.dataset.ghostId === current.id);
    const remains = (block: HTMLElement | undefined): boolean =>
        block !== undefined && !leaving.has(block.dataset.ghostId ?? '');
    const neighbour =
        index === -1
            ? null
            : (blocks.slice(index + 1).find(remains) ??
              blocks.slice(0, index).reverse().find(remains) ??
              null);
    const targetId = stays ? current.id : (neighbour?.dataset.ghostId ?? null);

    void action(current.id);
    await afterMenuClosed(menu);

    const root: ParentNode = group?.isConnected ? group : document;
    const target = targetId ? blockIn(root, targetId) : null;
    (target ?? syncButton())?.focus();
}

// Restore, "Stop ignoring this series" and "Forget this series" keep focus on the same meeting.
async function actAndKeepFocus(
    current: OutlookMeeting,
    action: (id: string) => Promise<void>
): Promise<void> {
    const menu = menuOf();
    const group = props.element.closest('[role="group"]');

    void action(current.id);
    await afterMenuClosed(menu);

    const root: ParentNode = group?.isConnected ? group : document;
    blockIn(root, current.id)?.focus();
}

async function onDismiss(): Promise<void> {
    const current = meeting.value;
    if (!context || !current) return;
    await hideAndRefocus(current, new Set([current.id]), context.dismiss);
}

async function onRestore(): Promise<void> {
    const current = meeting.value;
    if (!context || !current) return;
    await actAndKeepFocus(current, context.restore);
}

// The panel opens in form mode only after the menu has closed (3.1 layering rule: never a panel
// while the menu is open); the lane's formRequest watcher does the opening.
async function onCreate(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || !canAct.value) return;
    const menu = menuOf();
    await afterMenuClosed(menu);
    context.openForm(current.id);
}

// Confirm from the menu: the menu closes first, then the request runs with the block's pending
// state; confirmOne says the outcome by toast and announcement.
async function onConfirm(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || assignment.value === null) return;
    const menu = menuOf();
    await afterMenuClosed(menu);
    void context.confirmOne(current.id);
}

async function onEdit(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || assignment.value === null) return;
    const menu = menuOf();
    await afterMenuClosed(menu);
    context.openForm(current.id);
}

// Series controls (D-10, D-11): "Always ignore" on a recurring meeting that is not ignored, "Stop
// ignoring" on a (faded) occurrence of an ignored series, "Forget" on a pre-assigned meeting.
const recurring = computed(
    () => canAct.value && meeting.value !== null && isRecurring(meeting.value)
);
const seriesIgnored = computed(() => recurring.value && meeting.value?.series_ignored === true);

async function onIgnoreSeries(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || !recurring.value || seriesIgnored.value) return;
    const leaving = new Set(
        context.meetings.value
            .filter((candidate) => candidate.series_key === current.series_key)
            .map((candidate) => candidate.id)
    );
    leaving.add(current.id);
    await hideAndRefocus(current, leaving, context.ignoreSeries);
}

async function onUnignoreSeries(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || !seriesIgnored.value) return;
    await actAndKeepFocus(current, context.unignoreSeries);
}

async function onForgetSeries(): Promise<void> {
    const current = meeting.value;
    if (!context || !current || assignment.value === null) return;
    await actAndKeepFocus(current, context.forgetSeries);
}
</script>

<template>
    <div v-if="labels" ref="rootEl" class="min-w-[200px]" data-testid="outlook-meeting-menu">
        <ContextMenuLabel
            class="max-w-56 truncate text-xs font-normal text-text-tertiary"
            data-testid="outlook-menu-label">
            {{ subject }}
        </ContextMenuLabel>
        <template v-if="assignment">
            <ContextMenuItem
                class="gap-3"
                data-testid="outlook-menu-confirm"
                :disabled="confirmPending"
                @select="onConfirm()">
                <Check class="w-4 h-4 shrink-0 text-icon-default" aria-hidden="true" />
                <span>{{ labels.confirm }}</span>
                <span class="ml-auto flex min-w-0 items-center gap-1.5 pl-2">
                    <OutlookProjectDot :color="assignment.project_color" />
                    <span
                        class="max-w-32 truncate text-xs text-text-tertiary"
                        data-testid="outlook-menu-project-hint">
                        {{ assignment.project_name }}
                    </span>
                </span>
            </ContextMenuItem>
            <ContextMenuItem class="space-x-3" data-testid="outlook-menu-edit" @select="onEdit()">
                <Pencil class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.edit }}</span>
            </ContextMenuItem>
        </template>
        <ContextMenuItem
            v-else-if="canAct && meeting"
            class="space-x-3"
            data-testid="outlook-menu-create"
            @select="onCreate()">
            <ClockPlus class="w-4 h-4 text-icon-default" aria-hidden="true" />
            <span>{{ labels.create_entry }}</span>
        </ContextMenuItem>
        <ContextMenuItem
            v-if="canAct && meeting"
            class="space-x-3"
            data-testid="outlook-menu-select"
            @select="onToggleSelect()">
            <X v-if="selected" class="w-4 h-4 text-icon-default" aria-hidden="true" />
            <ListChecks v-else class="w-4 h-4 text-icon-default" aria-hidden="true" />
            <span>{{ selected ? labels.deselect : labels.select }}</span>
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
            <ContextMenuItem
                v-if="seriesIgnored"
                class="space-x-3"
                data-testid="outlook-menu-unignore-series"
                @select="onUnignoreSeries()">
                <Undo2 class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.unignore_series }}</span>
            </ContextMenuItem>
            <ContextMenuItem
                v-else-if="recurring"
                class="space-x-3"
                data-testid="outlook-menu-ignore-series"
                @select="onIgnoreSeries()">
                <CalendarOff class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.ignore_series }}</span>
            </ContextMenuItem>
            <ContextMenuItem
                v-if="assignment"
                class="space-x-3"
                data-testid="outlook-menu-forget-series"
                @select="onForgetSeries()">
                <Unlink class="w-4 h-4 text-icon-default" aria-hidden="true" />
                <span>{{ labels.forget_series }}</span>
            </ContextMenuItem>
        </template>
    </div>
</template>
