import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import CalendarZoomControls from './CalendarZoomControls.vue';

let wrapper: VueWrapper | null = null;

function mountControls(props: { canZoomIn: boolean; canZoomOut: boolean }): VueWrapper {
    wrapper = mount(CalendarZoomControls, { attachTo: document.body, props });
    return wrapper;
}

// Focus opens the reka tooltip at once; returns the text announced through its role=tooltip copy
async function tooltipText(button: HTMLElement, testId: string): Promise<string> {
    button.dispatchEvent(new FocusEvent('focus'));
    await nextTick();
    await nextTick();
    const content = document.body.querySelector(`[data-testid="${testId}"]`);
    expect(content).not.toBeNull();
    const announced = content!.querySelector('[role="tooltip"]');
    expect(announced).not.toBeNull();
    return announced!.textContent!.trim();
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('CalendarZoomControls', () => {
    it('renders two labelled 24px icon buttons stacked vertically', () => {
        const controls = mountControls({ canZoomIn: true, canZoomOut: true });
        const zoomIn = controls.get('[data-testid="calendar-zoom-in"]');
        const zoomOut = controls.get('[data-testid="calendar-zoom-out"]');

        expect(zoomIn.attributes('aria-label')).toBe('Zoom in');
        expect(zoomOut.attributes('aria-label')).toBe('Zoom out');
        expect(zoomIn.element.tagName).toBe('BUTTON');
        expect(zoomIn.classes()).toEqual(expect.arrayContaining(['size-6', 'p-0']));
        expect(zoomOut.classes()).toEqual(expect.arrayContaining(['size-6', 'p-0']));
        expect(zoomIn.attributes('aria-disabled')).toBeUndefined();

        const stack = zoomIn.element.parentElement!;
        expect(stack.classList).toContain('flex-col');
        expect(stack.classList).toContain('gap-0.5');
        expect(zoomIn.element.compareDocumentPosition(zoomOut.element)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    });

    it('emits zoom-in and zoom-out on click', async () => {
        const controls = mountControls({ canZoomIn: true, canZoomOut: true });
        await controls.get('[data-testid="calendar-zoom-in"]').trigger('click');
        await controls.get('[data-testid="calendar-zoom-out"]').trigger('click');
        expect(controls.emitted('zoom-in')).toHaveLength(1);
        expect(controls.emitted('zoom-out')).toHaveLength(1);
    });

    it('marks the end of the ladder aria-disabled, keeps it focusable and emits nothing', async () => {
        const controls = mountControls({ canZoomIn: false, canZoomOut: true });
        const zoomIn = controls.get('[data-testid="calendar-zoom-in"]');

        expect(zoomIn.attributes('aria-disabled')).toBe('true');
        expect(zoomIn.attributes('disabled')).toBeUndefined();
        (zoomIn.element as HTMLButtonElement).focus();
        expect(document.activeElement).toBe(zoomIn.element);

        await zoomIn.trigger('click');
        expect(controls.emitted('zoom-in')).toBeUndefined();

        await controls.setProps({ canZoomIn: true, canZoomOut: false });
        expect(zoomIn.attributes('aria-disabled')).toBeUndefined();
        expect(controls.get('[data-testid="calendar-zoom-out"]').attributes('aria-disabled')).toBe(
            'true'
        );
    });

    it('names Ctrl + scroll in the tooltips', async () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
        const controls = mountControls({ canZoomIn: true, canZoomOut: true });
        const zoomIn = controls.get('[data-testid="calendar-zoom-in"]').element as HTMLElement;
        expect(await tooltipText(zoomIn, 'calendar-zoom-tooltip-in')).toBe(
            'Zoom in (Ctrl + scroll)'
        );
    });

    it('names ⌘ + scroll on macOS', async () => {
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
        const controls = mountControls({ canZoomIn: true, canZoomOut: true });
        const zoomOut = controls.get('[data-testid="calendar-zoom-out"]').element as HTMLElement;
        expect(await tooltipText(zoomOut, 'calendar-zoom-tooltip-out')).toBe(
            'Zoom out (⌘ + scroll)'
        );
    });
});
