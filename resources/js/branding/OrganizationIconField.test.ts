import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import OrganizationIconField from './OrganizationIconField.vue';

const { pageProps, axiosMock, reloadMock, addNotification } = vi.hoisted(() => ({
    pageProps: {} as Record<string, unknown>,
    axiosMock: { post: vi.fn(), delete: vi.fn() },
    reloadMock: vi.fn(),
    addNotification: vi.fn(),
}));

vi.mock('axios', () => ({ default: axiosMock }));
vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
    router: { reload: reloadMock },
}));
vi.mock('@/utils/notification', () => ({
    useNotificationsStore: () => ({ addNotification }),
}));

// Same copy as lang/en/branding.php (ui.icon_*), shared through the appearance prop.
const labels = {
    icon_label: 'Organization icon',
    icon_upload: 'Upload icon',
    icon_replace: 'Replace icon',
    icon_remove: 'Remove icon',
    icon_helper: 'PNG or JPG, up to 1 MB. Square images work best (at least 128 x 128 px).',
    icon_empty: 'No icon set. The first letter of the organization name is shown instead.',
    icon_pending: 'New icon selected. Save to apply it.',
    icon_read_only: 'Only organization owners and admins can change the icon.',
    icon_error_type: 'The icon must be a PNG or JPG image.',
    icon_error_size: 'The icon must be 1 MB or smaller.',
    icon_error_generic: "Couldn't update the organization icon. Try again.",
    icon_removed: 'Organization icon removed.',
    icon_alt: ':name icon',
};

const ORG = { id: 'org-1', name: 'Acme' };
const SAVED_URL = 'https://cdn.test/organization-icons/saved.png';

type FieldWrapper = VueWrapper<InstanceType<typeof OrganizationIconField>>;

function setIcons(icons?: Record<string, string>): void {
    pageProps.appearance = { labels, ...(icons ? { org_icons: icons } : {}) };
}

function mountField(
    options: { canUpdate?: boolean; disabled?: boolean; saved?: boolean } = {}
): FieldWrapper {
    setIcons(options.saved ? { [ORG.id]: SAVED_URL } : undefined);
    return mount(OrganizationIconField, {
        props: {
            organization: ORG,
            canUpdate: options.canUpdate ?? true,
            disabled: options.disabled ?? false,
        },
    }) as FieldWrapper;
}

function uploadButton(wrapper: FieldWrapper) {
    return wrapper.get('[data-testid="organization_icon_upload"]');
}

function removeButton(wrapper: FieldWrapper) {
    return wrapper.find('[data-testid="organization_icon_remove"]');
}

async function chooseFile(wrapper: FieldWrapper, file: File): Promise<void> {
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
}

function png(bytes = 64, name = 'icon.png'): File {
    return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

async function choosePendingPng(wrapper: FieldWrapper): Promise<string> {
    await chooseFile(wrapper, png());
    await vi.waitFor(() => {
        expect(wrapper.get('img').attributes('src')).toMatch(/^data:image\/png;base64,/);
    });
    return wrapper.get('img').attributes('src') as string;
}

beforeEach(() => {
    for (const key of Object.keys(pageProps)) delete pageProps[key];
    axiosMock.post.mockReset();
    axiosMock.delete.mockReset();
    reloadMock.mockReset();
    addNotification.mockReset();
});

describe('OrganizationIconField', () => {
    it('without an icon shows the letter tile, the empty hint, Upload icon and the helper', () => {
        const wrapper = mountField();

        expect(wrapper.text()).toContain('Organization icon');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('[data-testid="organization_icon_letter"]').text()).toBe('A');
        expect(wrapper.text()).toContain(labels.icon_empty);
        expect(wrapper.text()).toContain(labels.icon_helper);
        expect(uploadButton(wrapper).text()).toBe('Upload icon');
        expect(removeButton(wrapper).exists()).toBe(false);
        const input = wrapper.get('input[type="file"]');
        expect(input.attributes('accept')).toBe('image/png,image/jpeg');
    });

    it('with a saved icon shows the image, Replace icon and Remove icon', () => {
        const wrapper = mountField({ saved: true });

        const img = wrapper.get('img');
        expect(img.attributes('src')).toBe(SAVED_URL);
        expect(img.attributes('alt')).toBe('Acme icon');
        expect(uploadButton(wrapper).text()).toBe('Replace icon');
        expect(removeButton(wrapper).text()).toBe('Remove icon');
        expect(wrapper.text()).not.toContain(labels.icon_empty);
    });

    it('read-only shows the tile and the explanation, with no buttons and no file input', () => {
        const wrapper = mountField({ canUpdate: false, saved: true });

        expect(wrapper.get('img').attributes('src')).toBe(SAVED_URL);
        expect(wrapper.text()).toContain(labels.icon_read_only);
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    });

    it('rejects a file that is not PNG or JPEG without a preview', async () => {
        const wrapper = mountField();

        await chooseFile(wrapper, new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }));
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toBe(labels.icon_error_type);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(labels.icon_pending);
    });

    it('rejects a file over 1 MB', async () => {
        const wrapper = mountField();

        await chooseFile(wrapper, png(2 * 1024 * 1024, 'big.png'));
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toBe(labels.icon_error_size);
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('previews a valid file with the pending hint, Replace icon and Remove icon', async () => {
        const wrapper = mountField();

        await choosePendingPng(wrapper);

        expect(wrapper.text()).toContain(labels.icon_pending);
        expect(wrapper.text()).not.toContain(labels.icon_empty);
        expect(uploadButton(wrapper).text()).toBe('Replace icon');
        expect(removeButton(wrapper).exists()).toBe(true);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('commit() POSTs the pending data URL and clears the pending state', async () => {
        axiosMock.post.mockResolvedValue({ data: { url: 'https://cdn.test/new.png' } });
        const wrapper = mountField();
        const dataUrl = await choosePendingPng(wrapper);

        const result = await wrapper.vm.commit();
        await nextTick();

        expect(result).toBe(true);
        expect(axiosMock.post).toHaveBeenCalledTimes(1);
        expect(axiosMock.post).toHaveBeenCalledWith('/organizations/org-1/icon', {
            icon: dataUrl,
        });
        expect(wrapper.text()).not.toContain(labels.icon_pending);
        expect(wrapper.get('img').attributes('src')).toBe('https://cdn.test/new.png');
    });

    it('commit() without a pending icon sends nothing and resolves true', async () => {
        const wrapper = mountField({ saved: true });

        await expect(wrapper.vm.commit()).resolves.toBe(true);
        expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it('commit() shows the 422 icon message, keeps the previous icon and resolves false', async () => {
        const message = 'The icon must be between 32 and 1024 pixels on each side.';
        axiosMock.post.mockRejectedValue({
            response: { status: 422, data: { message, errors: { icon: [message] } } },
        });
        const wrapper = mountField({ saved: true });
        await choosePendingPng(wrapper);

        const result = await wrapper.vm.commit();
        await nextTick();

        expect(result).toBe(false);
        expect(wrapper.get('[role="alert"]').text()).toBe(message);
        expect(wrapper.get('img').attributes('src')).toBe(SAVED_URL);
        expect(wrapper.text()).not.toContain(labels.icon_pending);
    });

    it('commit() shows the generic message on a network error', async () => {
        axiosMock.post.mockRejectedValue(new Error('Network Error'));
        const wrapper = mountField();
        await choosePendingPng(wrapper);

        await expect(wrapper.vm.commit()).resolves.toBe(false);
        await nextTick();

        expect(wrapper.get('[role="alert"]').text()).toBe(labels.icon_error_generic);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('[data-testid="organization_icon_letter"]').text()).toBe('A');
    });

    it('Remove with a saved icon DELETEs it, notifies, reloads appearance and shows the letter', async () => {
        axiosMock.delete.mockResolvedValue({ status: 204 });
        const wrapper = mountField({ saved: true });

        await removeButton(wrapper).trigger('click');
        await flushPromises();

        expect(axiosMock.delete).toHaveBeenCalledWith('/organizations/org-1/icon');
        expect(addNotification).toHaveBeenCalledWith('success', 'Organization icon removed.');
        expect(reloadMock).toHaveBeenCalledWith({ only: ['appearance'] });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('[data-testid="organization_icon_letter"]').text()).toBe('A');
        expect(removeButton(wrapper).exists()).toBe(false);
    });

    it('Remove with only a pending icon discards it without a request', async () => {
        const wrapper = mountField({ saved: true });
        await choosePendingPng(wrapper);

        await removeButton(wrapper).trigger('click');
        await flushPromises();

        expect(axiosMock.delete).not.toHaveBeenCalled();
        expect(wrapper.get('img').attributes('src')).toBe(SAVED_URL);
        expect(wrapper.text()).not.toContain(labels.icon_pending);
    });

    it('disables Remove while its request runs', async () => {
        let resolveDelete: (value: unknown) => void = () => {};
        axiosMock.delete.mockReturnValue(
            new Promise((resolve) => {
                resolveDelete = resolve;
            })
        );
        const wrapper = mountField({ saved: true });

        await removeButton(wrapper).trigger('click');
        await nextTick();
        expect(removeButton(wrapper).attributes('disabled')).toBeDefined();
        expect(uploadButton(wrapper).attributes('disabled')).toBeDefined();

        resolveDelete({ status: 204 });
        await flushPromises();
        expect(removeButton(wrapper).exists()).toBe(false);
        expect(uploadButton(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('the disabled prop disables Upload, Replace and Remove', () => {
        const empty = mountField({ disabled: true });
        expect(uploadButton(empty).attributes('disabled')).toBeDefined();

        const saved = mountField({ disabled: true, saved: true });
        expect(uploadButton(saved).attributes('disabled')).toBeDefined();
        expect(removeButton(saved).attributes('disabled')).toBeDefined();
    });
});
