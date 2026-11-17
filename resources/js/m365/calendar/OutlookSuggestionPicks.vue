<script setup lang="ts">
import { Button } from '@/packages/ui/src/Buttons';
import type { OutlookCalendarLabels, OutlookSuggestion } from '@/m365/types';
import OutlookProjectDot from './OutlookProjectDot.vue';
import { fillLabel } from './labels';
import { type PrefillReason, reasonLabel } from './suggestionReason';

// Quick-pick chips under the mini form's project picker (UI-SPEC section 6, D-07): the next
// candidates, one click away. A candidate is a server suggestion, or (batch form) a project named
// by a selected meeting's series assignment, whose reason is then 'series'. Names come from the
// user's own projects and clients and are only rendered through text interpolation.
type Candidate = Pick<
    OutlookSuggestion,
    'project_id' | 'project_name' | 'project_color' | 'client_name'
> & { reason: PrefillReason };

const props = defineProps<{
    candidates: Candidate[];
    labels: OutlookCalendarLabels;
}>();

const emit = defineEmits<{
    pick: [projectId: string];
}>();

function chipText(candidate: Candidate): string {
    return candidate.client_name
        ? `${candidate.project_name} · ${candidate.client_name}`
        : candidate.project_name;
}

function chipAriaLabel(candidate: Candidate): string {
    const project = candidate.client_name
        ? `${candidate.project_name} (${candidate.client_name})`
        : candidate.project_name;
    return fillLabel(props.labels.use_suggestion, { project });
}
</script>

<template>
    <div
        v-if="candidates.length > 0"
        role="group"
        :aria-label="labels.other_suggestions"
        class="mt-2 flex flex-wrap gap-2"
        data-testid="outlook-suggestion-picks">
        <Button
            v-for="candidate in candidates"
            :key="candidate.project_id"
            type="button"
            variant="outline"
            size="sm"
            class="min-w-0 gap-1.5"
            :aria-label="chipAriaLabel(candidate)"
            :title="reasonLabel(candidate.reason, labels)"
            :data-project-id="candidate.project_id"
            data-testid="outlook-suggestion-pick"
            @click="emit('pick', candidate.project_id)">
            <OutlookProjectDot :color="candidate.project_color" />
            <span class="max-w-40 truncate">{{ chipText(candidate) }}</span>
        </Button>
    </div>
</template>
