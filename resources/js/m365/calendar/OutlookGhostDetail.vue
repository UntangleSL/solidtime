<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import {
    CalendarOff,
    Check,
    CircleX,
    ClockPlus,
    Ellipsis,
    ExternalLink,
    Eye,
    EyeOff,
    Pencil,
    Undo2,
    Unlink,
} from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/packages/ui/src/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import { Separator } from '@/packages/ui/src/separator';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import OutlookConvertForm from './OutlookConvertForm.vue';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import OutlookMovedMeeting from './OutlookMovedMeeting.vue';
import OutlookPreassignment from './OutlookPreassignment.vue';
import { safeHttpsUrl } from './safeUrl';
import { isPreassigned, isRecurring } from './suggestions';

// Detail panel of one ghost (non-modal popover). The default slot is the trigger (the ghost). It
// owns no network code: Dismiss, Restore and "Create time entry" are emitted and the caller acts.
// Its rows (eyebrow, subject, time, organizer, online) come from the OutlookMeetingSummary shared
// with the hover card. In form mode (Phase 4, UI-SPEC section 3) the same popover, at the same
// anchor, shows the OutlookConvertForm instead; the form talks to the injected Outlook context and
// this panel only relays its outcome (converted / cancel-form). Meeting values are only ever
// rendered through text interpolation.
// Phase 5 (UI-SPEC section 3): w-96 in both modes. A pre-assigned meeting shows its full
// pre-assignment (with the why line) and the footer [More actions] … [Edit] [Confirm]; Edit is the
// Phase 4 `create` (form mode, prefilled by the series), Confirm is emitted and the caller runs it,
// passing `confirming` (spinner, the panel cannot be dismissed) and, after a failure,
// `confirmError` (inline role=alert line). A recurring meeting without assignment gets
// [More actions] … [Dismiss] [Create time entry]; a single meeting keeps the Phase 4 footer. The
// More actions menu carries Dismiss / Restore (pre-assigned) and the series actions, all emitted.
// Phase 6 (D-03, 06-UI-SPEC section 4): a meeting Outlook moved after it started (`moved_from`)
// adds the OutlookMovedMeeting block above the separator; its "Move my entry here" is emitted
// (`move-entry`) and the caller passes `moving` while it runs: the button spins, Create / Edit /
// Confirm and More actions are disabled and the panel cannot be dismissed. A failure reuses the
// `confirmError` alert line. The footer and its default are unchanged.
const props = withDefaults(
    defineProps<{
        meeting: OutlookMeeting;
        labels: OutlookCalendarLabels;
        canAct: boolean;
        mode?: 'detail' | 'form';
        confirming?: boolean;
        confirmError?: string | null;
        moving?: boolean;
    }>(),
    { mode: 'detail', confirming: false, confirmError: null, moving: false }
);

const emit = defineEmits<{
    dismiss: [];
    restore: [];
    create: [];
    confirm: [];
    'ignore-series': [];
    'unignore-series': [];
    'forget-series': [];
    converted: [results: OutlookConversionResult[]];
    'cancel-form': [];
    'move-entry': [];
}>();

const open = defineModel<boolean>('open', { default: false });

const subjectId = `outlook-detail-${useId()}`;

const link = computed(() => safeHttpsUrl(props.meeting.web_link));

// Reka labels the dialog with its trigger (the ghost) and overrides any aria-labelledby passed to the
// content, so the subject heading takes over the labelling once it is mounted.
function labelDialogBySubject(el: HTMLElement): void {
    el.closest('[role="dialog"]')?.setAttribute('aria-labelledby', el.id);
}

// The form is shown only while the caller may act (D-13: never in test-hook mode or impersonating).
const showForm = computed(() => props.mode === 'form' && props.canAct);

// The pre-assignment block, its Edit / Confirm footer and every More actions item only while the
// caller may act (T-05-36).
const preassignment = computed(() =>
    props.canAct && isPreassigned(props.meeting) ? (props.meeting.assignment ?? null) : null
);

// The D-03 moved block, only while the caller may act (D-14).
const moved = computed(() => props.canAct && Boolean(props.meeting.moved_from));

// An action of this panel runs: the panel cannot be dismissed and its other actions wait.
const locked = computed(() => props.confirming || props.moving);

const seriesIgnored = computed(() => props.meeting.series_ignored === true);

// Dismiss / Restore always live in the "More actions" menu, in the same order as the meeting's
// right-click menu (owner feedback, 2026-11-23); series actions follow for recurring meetings.
const showMore = computed(() => props.canAct);
const recurring = computed(() => isRecurring(props.meeting));

function onConfirm(): void {
    if (!locked.value) emit('confirm');
}

function onCreate(): void {
    if (!props.moving) emit('create');
}

function onMoveEntry(): void {
    if (!locked.value) emit('move-entry');
}

// A menu action hands focus to the caller (the panel closes and the layer moves focus), so the
// menu must not send focus back to its trigger inside the closing panel. The menu is non-modal for
// the same reason: a modal menu traps focus and would pull it back from the block the layer focuses
// (the panel's interact-outside guard keeps the panel open while the menu is used).
let menuActed = false;

function fromMenu(run: () => void): void {
    menuActed = true;
    run();
}

function onMenuCloseAutoFocus(event: Event): void {
    if (!menuActed) return;
    menuActed = false;
    event.preventDefault();
}

// True while the form's request runs: the popover then cannot be dismissed (UI-SPEC section 3).
const busy = ref(false);

watch(showForm, (value) => {
    if (!value) busy.value = false;
});

// Layers of the nested pickers (project and tag dropdowns, billable select, a tag create dialog)
// are portaled outside this popover; an interaction inside them must never close the form
// (RESEARCH Pitfall 5). In detail mode the only nested layer is the More actions menu.
const NESTED_LAYERS =
    '[data-reka-popper-content-wrapper], [role="listbox"], [role="menu"], [role="dialog"]';
const MENU_LAYER = '[role="menu"]';

function eventTarget(event: Event): Element | null {
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = original?.target ?? event.target;
    return target instanceof Element ? target : null;
}

function onInteractOutside(event: Event): void {
    if (busy.value || locked.value) {
        event.preventDefault();
        return;
    }
    if (eventTarget(event)?.closest(showForm.value ? NESTED_LAYERS : MENU_LAYER)) {
        event.preventDefault();
    }
}

function onEscapeKeyDown(event: KeyboardEvent): void {
    if (busy.value || locked.value) event.preventDefault();
}

const confirmButton = ref<InstanceType<typeof PrimaryButton> | null>(null);
const createButton = ref<InstanceType<typeof PrimaryButton> | null>(null);

// Opened straight in form mode, the form moves focus itself (Create entry or the project picker).
// A pre-assigned meeting lands on Confirm (Enter on the block, Enter again confirms). A D-03 moved
// meeting lands on Create time entry: the move button comes first in the body, but a new entry for
// this session stays the default.
function onOpenAutoFocus(event: Event): void {
    if (showForm.value) {
        event.preventDefault();
        return;
    }
    const confirm = confirmButton.value?.$el as HTMLElement | undefined;
    if (preassignment.value && confirm) {
        event.preventDefault();
        confirm.focus();
        return;
    }
    const create = createButton.value?.$el as HTMLElement | undefined;
    if (moved.value && create) {
        event.preventDefault();
        create.focus();
    }
}
</script>

<template>
    <Popover v-model:open="open">
        <PopoverTrigger as-child>
            <slot />
        </PopoverTrigger>
        <PopoverContent
            class="w-96 p-4"
            side="right"
            align="start"
            :side-offset="8"
            :data-mode="showForm ? 'form' : 'detail'"
            data-testid="outlook-ghost-detail"
            @interact-outside="onInteractOutside"
            @escape-key-down="onEscapeKeyDown"
            @open-auto-focus="onOpenAutoFocus">
            <OutlookConvertForm
                v-if="showForm"
                mode="single"
                :meetings="[meeting]"
                :labels="labels"
                @busy="(value: boolean) => (busy = value)"
                @done="(results: OutlookConversionResult[]) => emit('converted', results)"
                @cancel="emit('cancel-form')" />
            <template v-else>
                <OutlookMeetingSummary
                    :meeting="meeting"
                    :labels="labels"
                    testid-prefix="outlook-detail"
                    :subject-id="subjectId"
                    @subject-mounted="labelDialogBySubject">
                    <template #meta>
                        <slot name="meta" />
                    </template>
                </OutlookMeetingSummary>
                <a
                    v-if="link"
                    :href="link"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="outlook-detail-link"
                    class="mt-2 inline-flex items-center gap-1 text-xs text-accent-500 hover:underline dark:text-accent-400">
                    <span>{{ labels.open_in_outlook }}</span>
                    <ExternalLink class="size-3" aria-hidden="true" />
                    <span class="sr-only">{{ labels.opens_new_tab }}</span>
                </a>
                <OutlookPreassignment
                    v-if="preassignment"
                    class="mt-4"
                    :assignment="preassignment"
                    :labels="labels"
                    variant="full" />
                <OutlookMovedMeeting
                    v-if="moved"
                    :meeting="meeting"
                    :labels="labels"
                    variant="block"
                    :pending="moving"
                    :disabled="confirming"
                    @move="onMoveEntry" />
                <Separator class="mt-3" />
                <div class="mt-4 flex items-center gap-2">
                    <DropdownMenu v-if="showMore" :modal="false">
                        <DropdownMenuTrigger as-child>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                :disabled="moving"
                                :aria-label="labels.more_actions"
                                data-testid="outlook-detail-more">
                                <Ellipsis aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            class="min-w-[200px]"
                            @close-auto-focus="onMenuCloseAutoFocus">
                            <!-- The shared DropdownMenuContent drops attributes (teleport root), so the
                                 test hook sits on a wrapper inside the menu -->
                            <div data-testid="outlook-detail-more-menu">
                                <DropdownMenuItem
                                    v-if="meeting.dismissed"
                                    data-testid="outlook-more-restore"
                                    @select="fromMenu(() => emit('restore'))">
                                    <Eye class="text-icon-default" aria-hidden="true" />
                                    <span>{{ labels.restore }}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    v-else
                                    data-testid="outlook-more-dismiss"
                                    @select="fromMenu(() => emit('dismiss'))">
                                    <EyeOff class="text-icon-default" aria-hidden="true" />
                                    <span>{{ labels.dismiss }}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    v-if="seriesIgnored"
                                    data-testid="outlook-more-unignore-series"
                                    @select="fromMenu(() => emit('unignore-series'))">
                                    <Undo2 class="text-icon-default" aria-hidden="true" />
                                    <span>{{ labels.unignore_series }}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    v-else-if="recurring"
                                    data-testid="outlook-more-ignore-series"
                                    @select="fromMenu(() => emit('ignore-series'))">
                                    <CalendarOff class="text-icon-default" aria-hidden="true" />
                                    <span>{{ labels.ignore_series }}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    v-if="preassignment"
                                    data-testid="outlook-more-forget-series"
                                    @select="fromMenu(() => emit('forget-series'))">
                                    <Unlink class="text-icon-default" aria-hidden="true" />
                                    <span>{{ labels.forget_series }}</span>
                                </DropdownMenuItem>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <div class="ml-auto flex items-center gap-2">
                        <template v-if="preassignment">
                            <SecondaryButton
                                :icon="Pencil"
                                :disabled="moving"
                                data-testid="outlook-detail-edit"
                                @click="onCreate">
                                {{ labels.edit }}
                            </SecondaryButton>
                            <PrimaryButton
                                ref="confirmButton"
                                type="button"
                                :icon="Check"
                                :loading="confirming"
                                :disabled="confirming || moving"
                                data-testid="outlook-detail-confirm"
                                @click="onConfirm">
                                {{ labels.confirm }}
                            </PrimaryButton>
                        </template>
                        <template v-else-if="canAct">
                            <PrimaryButton
                                ref="createButton"
                                type="button"
                                :icon="ClockPlus"
                                :disabled="moving"
                                data-testid="outlook-detail-create"
                                @click="onCreate">
                                {{ labels.create_entry }}
                            </PrimaryButton>
                        </template>
                        <slot name="actions" />
                    </div>
                </div>
                <p
                    v-if="confirmError"
                    role="alert"
                    class="mt-2 flex items-center gap-1 text-xs text-destructive"
                    data-testid="outlook-detail-alert">
                    <CircleX class="size-3 shrink-0" aria-hidden="true" />
                    <span>{{ confirmError }}</span>
                </p>
                <div v-if="$slots['footer-note']" class="mt-2 text-xs text-text-tertiary">
                    <slot name="footer-note" />
                </div>
            </template>
        </PopoverContent>
    </Popover>
</template>
