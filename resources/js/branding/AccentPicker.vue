<script setup lang="ts">
/**
 * Accent color radio group for the profile Theme section (Phase 3.2, BRAND-02, D-04). Selecting
 * a swatch applies the accent at once (one class on <html>); useAppearance saves it to the
 * user's account in the background, so there is no Save button.
 */
import { computed, nextTick, ref } from 'vue';
import { Check, RotateCcw } from '@lucide/vue';
import { Field, FieldDescription, FieldLabel } from '@/packages/ui/src/field';
import { Button } from '@/packages/ui/src/Buttons';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/packages/ui/src/tooltip';
import { theme } from '@/utils/theme';
import { activeAccent, setAccent } from './accent';
import { ACCENT_PRESETS, DEFAULT_ACCENT, type AccentId } from './accentPresets';
import { formatLabel, useAppearanceProps } from './appearanceProps';

const LABEL_ID = 'accent-color-label';

const appearance = useAppearanceProps();
const labels = computed(() => appearance.value.labels);

function presetName(id: AccentId): string {
    const localized = appearance.value.presets[id];
    return localized || (ACCENT_PRESETS.find((preset) => preset.id === id)?.name ?? id);
}

const swatches = computed(() =>
    ACCENT_PRESETS.map((preset) => ({
        id: preset.id,
        name: presetName(preset.id),
        color: theme.value === 'dark' ? preset.swatch.dark : preset.swatch.light,
    }))
);

const selectedName = computed(() => {
    const name = presetName(activeAccent.value);
    return activeAccent.value === DEFAULT_ACCENT
        ? formatLabel(labels.value.accent_default_name || ':name (default)', { name })
        : name;
});

const description = computed(() =>
    formatLabel(
        labels.value.accent_description || ':name. Used for buttons, links and selected items.',
        {
            name: selectedName.value,
        }
    )
);

const announcement = ref('');
const radios: (HTMLButtonElement | null)[] = [];

function setRadio(el: unknown, index: number): void {
    radios[index] = el instanceof HTMLButtonElement ? el : null;
}

function select(id: AccentId): void {
    if (id !== activeAccent.value) {
        setAccent(id);
    }
    announcement.value = formatLabel(
        labels.value.accent_announcement || 'Accent color set to :name.',
        {
            name: presetName(id),
        }
    );
}

function selectAndFocus(index: number): void {
    const preset = ACCENT_PRESETS[index];
    if (!preset) {
        return;
    }
    select(preset.id);
    void nextTick(() => radios[index]?.focus());
}

function onKeydown(event: KeyboardEvent, index: number): void {
    const last = ACCENT_PRESETS.length - 1;
    switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
            selectAndFocus(index === last ? 0 : index + 1);
            break;
        case 'ArrowLeft':
        case 'ArrowUp':
            selectAndFocus(index === 0 ? last : index - 1);
            break;
        case 'Home':
            selectAndFocus(0);
            break;
        case 'End':
            selectAndFocus(last);
            break;
        case ' ':
        case 'Enter':
            selectAndFocus(index);
            break;
        default:
            return;
    }
    event.preventDefault();
}
</script>

<template>
    <Field class="col-span-6 sm:col-span-4">
        <FieldLabel :id="LABEL_ID">{{ labels.accent_label || 'Accent color' }}</FieldLabel>
        <TooltipProvider :delay-duration="300">
            <div role="radiogroup" :aria-labelledby="LABEL_ID" class="flex flex-wrap gap-3">
                <Tooltip v-for="(swatch, index) in swatches" :key="swatch.id">
                    <TooltipTrigger as-child>
                        <button
                            :ref="(el) => setRadio(el, index)"
                            type="button"
                            role="radio"
                            :data-accent-id="swatch.id"
                            :aria-checked="swatch.id === activeAccent ? 'true' : 'false'"
                            :aria-label="swatch.name"
                            :tabindex="swatch.id === activeAccent ? 0 : -1"
                            :style="{ backgroundColor: swatch.color }"
                            :class="[
                                'flex h-8 w-8 items-center justify-center rounded-full motion-safe:transition-shadow motion-safe:duration-100',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card-background',
                                swatch.id === activeAccent
                                    ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-card-background'
                                    : '',
                            ]"
                            @click="select(swatch.id)"
                            @keydown="onKeydown($event, index)">
                            <Check
                                v-if="swatch.id === activeAccent"
                                data-testid="accent-check"
                                aria-hidden="true"
                                class="h-4 w-4 text-[color:var(--color-on-accent)]" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>{{ swatch.name }}</TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
        <FieldDescription class="mt-2">{{ description }}</FieldDescription>
        <div v-if="activeAccent !== DEFAULT_ACCENT">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="accent-reset"
                @click="select(DEFAULT_ACCENT)">
                <RotateCcw aria-hidden="true" />
                {{ labels.accent_reset || 'Reset to Untangle' }}
            </Button>
        </div>
        <span class="sr-only" aria-live="polite" data-testid="accent-announcement">{{
            announcement
        }}</span>
    </Field>
</template>
