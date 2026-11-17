<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { ClockPlus, ExternalLink } from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import PrimaryButton from '@/packages/ui/src/Buttons/PrimaryButton.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import { Separator } from '@/packages/ui/src/separator';
import type { OutlookCalendarLabels, OutlookConversionResult, OutlookMeeting } from '@/m365/types';
import OutlookConvertForm from './OutlookConvertForm.vue';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import { safeHttpsUrl } from './safeUrl';

// Detail panel of one ghost (non-modal popover). The default slot is the trigger (the ghost). It
// owns no network code: Dismiss, Restore and "Create time entry" are emitted and the caller acts.
// Its rows (eyebrow, subject, time, organizer, online) come from the OutlookMeetingSummary shared
// with the hover card. In form mode (Phase 4, UI-SPEC section 3) the same popover, at the same
// anchor, shows the OutlookConvertForm instead; the form talks to the injected Outlook context and
// this panel only relays its outcome (converted / cancel-form). Meeting values are only ever
// rendered through text interpolation.
const props = withDefaults(
    defineProps<{
        meeting: OutlookMeeting;
        labels: OutlookCalendarLabels;
        canAct: boolean;
        mode?: 'detail' | 'form';
    }>(),
    { mode: 'detail' }
);

const emit = defineEmits<{
    dismiss: [];
    restore: [];
    create: [];
    converted: [results: OutlookConversionResult[]];
    'cancel-form': [];
}>();

const open = defineModel<boolean>('open', { default: false });

const subjectId = `outlook-detail-${useId()}`;

const link = computed(() => safeHttpsUrl(props.meeting.web_link));

// Reka labels the dialog with its trigger (the ghost) and overrides any aria-labelledby passed to the
// content, so the subject heading takes over the labelling once it is mounted.
function labelDialogBySubject(el: HTMLElement): void {
    el.closest('[role="dialog"]')?.setAttribute('aria-labelledby', el.id);
}

function onAction() {
    if (props.meeting.dismissed) emit('restore');
    else emit('dismiss');
}

// The form is shown only while the caller may act (D-13: never in test-hook mode or impersonating).
const showForm = computed(() => props.mode === 'form' && props.canAct);

// True while the form's request runs: the popover then cannot be dismissed (UI-SPEC section 3).
const busy = ref(false);

watch(showForm, (value) => {
    if (!value) busy.value = false;
});

// Layers of the nested pickers (project and tag dropdowns, billable select, a tag create dialog)
// are portaled outside this popover; an interaction inside them must never close the form
// (RESEARCH Pitfall 5).
const NESTED_LAYERS =
    '[data-reka-popper-content-wrapper], [role="listbox"], [role="menu"], [role="dialog"]';

function eventTarget(event: Event): Element | null {
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = original?.target ?? event.target;
    return target instanceof Element ? target : null;
}

function onInteractOutside(event: Event): void {
    if (busy.value) {
        event.preventDefault();
        return;
    }
    if (showForm.value && eventTarget(event)?.closest(NESTED_LAYERS)) event.preventDefault();
}

function onEscapeKeyDown(event: KeyboardEvent): void {
    if (busy.value) event.preventDefault();
}

// Opened straight in form mode, the form moves focus itself (Create entry or the project picker).
function onOpenAutoFocus(event: Event): void {
    if (showForm.value) event.preventDefault();
}
</script>

<template>
    <Popover v-model:open="open">
        <PopoverTrigger as-child>
            <slot />
        </PopoverTrigger>
        <PopoverContent
            :class="showForm ? 'w-96 p-4' : 'w-80 p-4'"
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
                <Separator class="mt-3" />
                <div class="mt-4 flex justify-end gap-2">
                    <Button
                        v-if="canAct"
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="outlook-detail-action"
                        @click="onAction">
                        {{ meeting.dismissed ? labels.restore : labels.dismiss }}
                    </Button>
                    <PrimaryButton
                        v-if="canAct"
                        type="button"
                        :icon="ClockPlus"
                        data-testid="outlook-detail-create"
                        @click="emit('create')">
                        {{ labels.create_entry }}
                    </PrimaryButton>
                    <slot name="actions" />
                </div>
                <div v-if="$slots['footer-note']" class="mt-2 text-xs text-text-tertiary">
                    <slot name="footer-note" />
                </div>
            </template>
        </PopoverContent>
    </Popover>
</template>
