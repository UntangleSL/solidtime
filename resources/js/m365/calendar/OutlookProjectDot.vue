<script setup lang="ts">
// Shared 8px project dot of every Phase 5 surface (lane block, hover card, detail panel, chips,
// confirm list). The project colour is user data, shown like on core time entries; the 1px
// text-tertiary ring keeps a 3:1 boundary on the accent-tinted meeting fill whatever the colour,
// and the project name always sits next to it, so colour is never the only cue (aria-hidden).
defineProps<{ color: string }>();
</script>

<template>
    <span
        aria-hidden="true"
        data-testid="outlook-project-dot"
        class="size-2 shrink-0 rounded-full ring-1 ring-[var(--color-text-tertiary)]"
        :style="{ backgroundColor: color }" />
</template>
