<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { router } from '@inertiajs/vue3';
import { Trash2, Upload } from '@lucide/vue';
import { Button } from '@/packages/ui/src/Buttons';
import SecondaryButton from '@/packages/ui/src/Buttons/SecondaryButton.vue';
import { FieldDescription, FieldError, FieldLabel } from '@/packages/ui/src/field';
import { useNotificationsStore } from '@/utils/notification';
import { formatLabel, useAppearanceProps } from './appearanceProps';
import OrganizationIcon from './OrganizationIcon.vue';
import { organizationIconPath, useOrganizationIcons } from './organizationIcons';

// Organization icon block of the Organization Settings form (UI-SPEC "Organization Icon").
// The parent form calls commit() after its own update succeeds, so the single Save button
// persists name, currency and icon together. Client checks are convenience only: the server
// request (03.2-05) sniffs the content and enforces size, dimensions and permission.

const props = withDefaults(
    defineProps<{
        organization: { id: string; name: string };
        canUpdate: boolean;
        disabled?: boolean;
    }>(),
    {
        disabled: false,
    }
);

const MAX_BYTES = 1_048_576;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];

const appearance = useAppearanceProps();
const labels = computed(() => appearance.value.labels);
const { iconFor } = useOrganizationIcons();
const notifications = useNotificationsStore();

const fileInput = ref<HTMLInputElement | null>(null);
const pendingDataUrl = ref<string | null>(null);
const error = ref<string | null>(null);
const removing = ref(false);

// Local result of the last upload or removal, shown until the reloaded appearance prop arrives.
// undefined = follow the prop; null = removed; string = the URL the server answered with.
const savedOverride = ref<string | null | undefined>(undefined);
const sharedUrl = computed(() => iconFor(props.organization.id));
watch(sharedUrl, () => {
    savedOverride.value = undefined;
});

const savedUrl = computed(() =>
    savedOverride.value !== undefined ? savedOverride.value : sharedUrl.value
);
const previewUrl = computed(() => pendingDataUrl.value ?? savedUrl.value);
const hasSaved = computed(() => !!savedUrl.value);
const hasPending = computed(() => pendingDataUrl.value !== null);
const alt = computed(() => formatLabel(labels.value.icon_alt, { name: props.organization.name }));
const buttonsDisabled = computed(() => props.disabled || removing.value);

function clearPending(): void {
    pendingDataUrl.value = null;
    if (fileInput.value) fileInput.value.value = '';
}

function selectNewIcon(): void {
    fileInput.value?.click();
}

function readSelectedIcon(): void {
    const file = fileInput.value?.files?.[0];
    if (!file) return;

    error.value = null;
    if (!ACCEPTED_TYPES.includes(file.type)) {
        clearPending();
        error.value = labels.value.icon_error_type;
        return;
    }
    if (file.size > MAX_BYTES) {
        clearPending();
        error.value = labels.value.icon_error_size;
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            pendingDataUrl.value = reader.result;
        }
    };
    reader.onerror = () => {
        clearPending();
        error.value = labels.value.icon_error_generic;
    };
    reader.readAsDataURL(file);
}

interface ErrorResponse {
    status?: number;
    data?: { message?: unknown; errors?: { icon?: unknown } };
}

function serverMessage(failure: unknown): string {
    const response = (failure as { response?: ErrorResponse } | null)?.response;
    if (response?.status === 422) {
        const iconErrors = response.data?.errors?.icon;
        if (Array.isArray(iconErrors) && typeof iconErrors[0] === 'string') {
            return iconErrors[0];
        }
        if (typeof response.data?.message === 'string' && response.data.message !== '') {
            return response.data.message;
        }
    }
    return labels.value.icon_error_generic;
}

/**
 * Upload the pending icon, if any. Resolves true on success or when there is nothing to send,
 * false on failure (the message is shown under the field). The pending state is cleared either
 * way, so the previous icon stays shown after a failure.
 */
async function commit(): Promise<boolean> {
    const dataUrl = pendingDataUrl.value;
    if (dataUrl === null) return true;

    error.value = null;
    try {
        const response = await axios.post<{ url?: unknown }>(
            organizationIconPath(props.organization.id),
            { icon: dataUrl }
        );
        const url = response?.data?.url;
        if (typeof url === 'string' && url !== '') {
            savedOverride.value = url;
        }
        return true;
    } catch (failure) {
        error.value = serverMessage(failure);
        return false;
    } finally {
        clearPending();
    }
}

async function removeIcon(): Promise<void> {
    error.value = null;
    // A pending selection is only discarded; a saved icon underneath stays.
    if (hasPending.value) {
        clearPending();
        return;
    }
    if (!hasSaved.value) return;

    removing.value = true;
    try {
        await axios.delete(organizationIconPath(props.organization.id));
        savedOverride.value = null;
        notifications.addNotification('success', labels.value.icon_removed);
        router.reload({ only: ['appearance'] });
    } catch (failure) {
        error.value = serverMessage(failure);
    } finally {
        removing.value = false;
    }
}

defineExpose({ commit });
</script>

<template>
    <div class="col-span-6 sm:col-span-4" data-testid="organization_icon_field">
        <template v-if="canUpdate">
            <input
                id="organization_icon"
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg"
                class="hidden"
                :disabled="buttonsDisabled"
                @change="readSelectedIcon" />

            <FieldLabel for="organization_icon">{{ labels.icon_label }}</FieldLabel>

            <div class="mt-2">
                <OrganizationIcon
                    :name="organization.name"
                    :icon-url="previewUrl"
                    size="lg"
                    :alt="alt" />
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
                <SecondaryButton
                    type="button"
                    :icon="Upload"
                    data-testid="organization_icon_upload"
                    :disabled="buttonsDisabled"
                    @click.prevent="selectNewIcon">
                    {{ hasSaved || hasPending ? labels.icon_replace : labels.icon_upload }}
                </SecondaryButton>

                <Button
                    v-if="hasSaved || hasPending"
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="organization_icon_remove"
                    :disabled="buttonsDisabled"
                    @click.prevent="removeIcon">
                    <Trash2 />
                    {{ labels.icon_remove }}
                </Button>
            </div>

            <FieldDescription class="mt-2">{{ labels.icon_helper }}</FieldDescription>
            <FieldDescription v-if="hasPending" class="mt-1" data-testid="organization_icon_hint">
                {{ labels.icon_pending }}
            </FieldDescription>
            <FieldDescription
                v-else-if="!hasSaved"
                class="mt-1"
                data-testid="organization_icon_hint">
                {{ labels.icon_empty }}
            </FieldDescription>

            <FieldError v-if="error" class="mt-2">{{ error }}</FieldError>
        </template>

        <template v-else>
            <FieldLabel>{{ labels.icon_label }}</FieldLabel>
            <div class="mt-2">
                <OrganizationIcon
                    :name="organization.name"
                    :icon-url="savedUrl"
                    size="lg"
                    :alt="alt" />
            </div>
            <FieldDescription class="mt-2">{{ labels.icon_read_only }}</FieldDescription>
        </template>
    </div>
</template>
