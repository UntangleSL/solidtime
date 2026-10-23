<script setup lang="ts">
import { computed, ref } from 'vue';
import { router, usePage } from '@inertiajs/vue3';
import ActionSection from '@/Components/ActionSection.vue';
import SectionBorder from '@/Components/SectionBorder.vue';
import DangerButton from '@/packages/ui/src/Buttons/DangerButton.vue';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import DialogModal from '@/packages/ui/src/DialogModal.vue';
import { navigateTo } from '@/m365/navigation';
import type { MicrosoftSharedProps } from '@/m365/types';

const page = usePage<{ microsoft?: MicrosoftSharedProps }>();

// The section only exists when the integration is on and the server sent the profile payload.
const account = computed(() => {
    const prop = page.props.microsoft;
    return prop && prop.enabled && prop.account ? prop.account : null;
});

const status = computed(() => {
    if (!account.value) {
        return '';
    }
    if (account.value.connected) {
        return account.value.labels.connected_as;
    }
    return account.value.linked
        ? account.value.labels.disconnected_status
        : account.value.labels.not_connected;
});

const confirmingDisconnect = ref(false);
const processing = ref(false);

function connect() {
    if (account.value) {
        // Full-page navigation: the OAuth redirect is cross-origin, so never Inertia's router.
        navigateTo(account.value.connect_url);
    }
}

function closeDialog() {
    confirmingDisconnect.value = false;
}

function disconnect() {
    if (!account.value || processing.value) {
        return;
    }
    processing.value = true;
    router.delete(account.value.disconnect_url, {
        preserveScroll: true,
        onFinish: () => {
            processing.value = false;
            closeDialog();
        },
    });
}
</script>

<template>
    <div v-if="account" data-testid="microsoft-connection">
        <ActionSection class="mt-10 sm:mt-0">
            <template #title>{{ account.labels.section_title }}</template>

            <template #description>{{ account.labels.section_description }}</template>

            <template #content>
                <div class="max-w-xl text-sm text-text-secondary">
                    <p data-testid="microsoft-status">{{ status }}</p>
                    <p v-if="account.notice" data-testid="microsoft-notice" class="mt-2">
                        {{ account.notice }}
                    </p>
                </div>

                <div class="mt-5">
                    <DangerButton
                        v-if="account.connected"
                        data-testid="microsoft-disconnect"
                        @click="confirmingDisconnect = true">
                        {{ account.labels.disconnect }}
                    </DangerButton>
                    <SecondaryButton v-else data-testid="microsoft-connect" @click="connect">
                        {{ account.labels.connect }}
                    </SecondaryButton>
                </div>

                <DialogModal :show="confirmingDisconnect" @close="closeDialog">
                    <template #title>{{ account.labels.disconnect_title }}</template>

                    <template #content>
                        <p>{{ account.labels.disconnect_body }}</p>
                        <p
                            v-if="!account.has_password"
                            data-testid="microsoft-passwordless-warning"
                            class="mt-3">
                            {{ account.labels.disconnect_body_passwordless }}
                        </p>
                    </template>

                    <template #footer>
                        <SecondaryButton data-testid="microsoft-cancel" @click="closeDialog">
                            {{ account.labels.cancel }}
                        </SecondaryButton>

                        <DangerButton
                            class="ms-3"
                            data-testid="microsoft-confirm-disconnect"
                            :class="{ 'opacity-25': processing }"
                            :disabled="processing"
                            @click="disconnect">
                            {{ account.labels.disconnect }}
                        </DangerButton>
                    </template>
                </DialogModal>
            </template>
        </ActionSection>

        <SectionBorder />
    </div>
</template>
