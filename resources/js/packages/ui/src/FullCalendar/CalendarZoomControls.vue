<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue';
import { Button } from '..';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

const props = defineProps<{
    canZoomIn: boolean;
    canZoomOut: boolean;
}>();

const emit = defineEmits<{
    'zoom-in': [];
    'zoom-out': [];
}>();

// The tooltip is where the wheel gesture is discoverable, so it names the platform's modifier
function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || '';
    return /mac/i.test(platform);
}

const isMac = isMacPlatform();
const zoomInHint = isMac ? 'Zoom in (⌘ + scroll)' : 'Zoom in (Ctrl + scroll)';
const zoomOutHint = isMac ? 'Zoom out (⌘ + scroll)' : 'Zoom out (Ctrl + scroll)';

// aria-disabled (not disabled) keeps the button focusable at the end of the ladder
function onZoomIn(): void {
    if (props.canZoomIn) emit('zoom-in');
}

function onZoomOut(): void {
    if (props.canZoomOut) emit('zoom-out');
}

const buttonClass =
    'size-6 p-0 [&_svg]:size-3 text-muted-foreground hover:text-foreground aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent';
</script>

<template>
    <TooltipProvider :delay-duration="300">
        <div class="flex flex-col items-center gap-0.5">
            <Tooltip>
                <TooltipTrigger as-child>
                    <Button
                        variant="ghost"
                        :class="buttonClass"
                        aria-label="Zoom in"
                        data-testid="calendar-zoom-in"
                        :aria-disabled="canZoomIn ? undefined : 'true'"
                        @click="onZoomIn">
                        <Plus aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="right" data-testid="calendar-zoom-tooltip-in">
                    {{ zoomInHint }}
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger as-child>
                    <Button
                        variant="ghost"
                        :class="buttonClass"
                        aria-label="Zoom out"
                        data-testid="calendar-zoom-out"
                        :aria-disabled="canZoomOut ? undefined : 'true'"
                        @click="onZoomOut">
                        <Minus aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="right" data-testid="calendar-zoom-tooltip-out">
                    {{ zoomOutHint }}
                </TooltipContent>
            </Tooltip>
        </div>
    </TooltipProvider>
</template>
