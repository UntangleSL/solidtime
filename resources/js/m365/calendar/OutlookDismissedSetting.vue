<script setup lang="ts">
import { inject, useId } from 'vue';
import { Field, FieldDescription, FieldLabel } from '@/packages/ui/src/field';
import { Switch } from '@/Components/ui/switch';
import { OUTLOOK_MEETINGS_KEY } from './useOutlookMeetings';

// "Show dismissed meetings" (D-08), filled into the calendar settings popover through the core
// `settings-extra` slot. A view preference remembered per browser by the composable; toggling it
// refetches the meetings read and never syncs.
const context = inject(OUTLOOK_MEETINGS_KEY, null);
const switchId = `outlook-show-dismissed-${useId()}`;

function onToggle(value: boolean): void {
    if (context) context.includeDismissed.value = value;
}
</script>

<template>
    <div v-if="context?.labels.value" class="space-y-3" data-testid="outlook-dismissed-setting">
        <div class="text-sm font-semibold">{{ context.labels.value.settings_heading }}</div>
        <Field>
            <div class="flex items-center justify-between gap-3">
                <FieldLabel :for="switchId">{{ context.labels.value.show_dismissed }}</FieldLabel>
                <Switch
                    :id="switchId"
                    :model-value="context.includeDismissed.value"
                    data-testid="outlook-show-dismissed-switch"
                    @update:model-value="onToggle" />
            </div>
            <FieldDescription class="text-xs">
                {{ context.labels.value.show_dismissed_help }}
            </FieldDescription>
        </Field>
    </div>
</template>
