<script setup lang="ts">
import { computed } from 'vue';
import { usePage } from '@inertiajs/vue3';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { navigateTo } from '@/m365/navigation';

type MicrosoftProp =
    | { enabled: false }
    | {
          enabled: true;
          login_url: string;
          labels: { sign_in: string; sign_in_hint: string };
      };

const page = usePage<{ microsoft?: MicrosoftProp }>();

const microsoft = computed(() => {
    const prop = page.props.microsoft;
    return prop && prop.enabled ? prop : null;
});

function signIn() {
    if (!microsoft.value) {
        return;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const href = timeZone
        ? `${microsoft.value.login_url}?timezone=${encodeURIComponent(timeZone)}`
        : microsoft.value.login_url;
    navigateTo(href);
}
</script>

<template>
    <div v-if="microsoft" class="mt-4">
        <SecondaryButton
            data-testid="microsoft-sign-in"
            class="w-full justify-center"
            @click="signIn">
            <span class="flex items-center justify-center gap-2">
                <svg
                    aria-hidden="true"
                    focusable="false"
                    width="16"
                    height="16"
                    viewBox="0 0 21 21"
                    xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
                {{ microsoft.labels.sign_in }}
            </span>
        </SecondaryButton>
        <p class="mt-2 text-center text-xs text-text-secondary">
            {{ microsoft.labels.sign_in_hint }}
        </p>
    </div>
</template>
