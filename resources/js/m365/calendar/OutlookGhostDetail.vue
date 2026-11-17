<script setup lang="ts">
import { computed, useId } from 'vue';
import { ExternalLink } from '@lucide/vue';
import Button from '@/packages/ui/src/Buttons/Button.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/packages/ui/src/popover';
import { Separator } from '@/packages/ui/src/separator';
import type { OutlookCalendarLabels, OutlookMeeting } from '@/m365/types';
import OutlookMeetingSummary from './OutlookMeetingSummary.vue';
import { safeHttpsUrl } from './safeUrl';

// Detail panel of one ghost (non-modal popover). The default slot is the trigger (the ghost). It
// owns no network code: Dismiss and Restore are emitted and the caller acts. Its rows (eyebrow,
// subject, time, organizer, online) come from the OutlookMeetingSummary shared with the hover card.
// Meeting values are only ever rendered through text interpolation.
const props = defineProps<{
    meeting: OutlookMeeting;
    labels: OutlookCalendarLabels;
    canAct: boolean;
}>();

const emit = defineEmits<{
    dismiss: [];
    restore: [];
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
</script>

<template>
    <Popover v-model:open="open">
        <PopoverTrigger as-child>
            <slot />
        </PopoverTrigger>
        <PopoverContent
            class="w-80 p-4"
            side="right"
            align="start"
            :side-offset="8"
            data-testid="outlook-ghost-detail">
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
                <slot name="actions" />
            </div>
            <div v-if="$slots['footer-note']" class="mt-2 text-xs text-text-tertiary">
                <slot name="footer-note" />
            </div>
        </PopoverContent>
    </Popover>
</template>
