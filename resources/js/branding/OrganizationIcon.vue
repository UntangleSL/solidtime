<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { firstGrapheme } from './organizationIcons';

// The only renderer of an organization icon, so every place shares one fallback chain
// (UI-SPEC "Organization Icon"): the uploaded image, else the first letter on the accent fill.
const props = withDefaults(
    defineProps<{
        name: string;
        iconUrl: string | null;
        size: 'sm' | 'lg';
        alt?: string;
    }>(),
    {
        alt: '',
    }
);

const failed = ref(false);

// A new URL (upload, replacement, preview) gets a fresh chance to load.
watch(
    () => props.iconUrl,
    () => {
        failed.value = false;
    }
);

const showImage = computed(() => !!props.iconUrl && !failed.value);
const letter = computed(() => firstGrapheme(props.name));

const boxClass = computed(() =>
    props.size === 'lg'
        ? 'h-20 w-20 rounded-md ring-1 ring-inset ring-border-secondary'
        : 'h-5 w-5 rounded'
);
</script>

<template>
    <!-- Fixed light backing (the one raw hex the UI-SPEC allows): a transparent logo drawn for a
         light background stays legible in dark mode. -->
    <img
        v-if="showImage"
        :src="iconUrl ?? undefined"
        :alt="alt"
        data-testid="organization_icon_image"
        :class="['flex-shrink-0 object-cover bg-[#F9FCFD]', boxClass]"
        @error="failed = true" />
    <div
        v-else
        data-testid="organization_icon_letter"
        :aria-label="alt || undefined"
        :role="alt ? 'img' : undefined"
        :aria-hidden="alt ? undefined : 'true'"
        :class="[
            'flex-shrink-0 flex items-center justify-center font-semibold font-sans',
            'bg-[color:var(--theme-color-accent-solid)] text-[color:var(--color-on-accent)]',
            size === 'lg' ? 'text-xl' : 'text-xs',
            boxClass,
        ]">
        <span :aria-hidden="alt ? 'true' : undefined">{{ letter }}</span>
    </div>
</template>
