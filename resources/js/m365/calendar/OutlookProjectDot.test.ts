import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OutlookProjectDot from './OutlookProjectDot.vue';

describe('OutlookProjectDot', () => {
    it('renders an aria-hidden 8px dot in the project colour with a tertiary ring', () => {
        const wrapper = mount(OutlookProjectDot, { props: { color: '#ef5350' } });
        const dot = wrapper.get('[data-testid="outlook-project-dot"]');

        expect(dot.element.tagName).toBe('SPAN');
        expect(dot.attributes('aria-hidden')).toBe('true');
        for (const cls of [
            'size-2',
            'rounded-full',
            'shrink-0',
            'ring-1',
            'ring-[var(--color-text-tertiary)]',
        ]) {
            expect(dot.classes()).toContain(cls);
        }
        expect((dot.element as HTMLElement).style.backgroundColor).toMatch(
            /^(#ef5350|rgb\(239, 83, 80\))$/i
        );
        expect(dot.text()).toBe('');

        wrapper.unmount();
    });

    it('follows a colour change', async () => {
        const wrapper = mount(OutlookProjectDot, { props: { color: '#ef5350' } });
        await wrapper.setProps({ color: '#42a5f5' });

        const dot = wrapper.get('[data-testid="outlook-project-dot"]');
        expect((dot.element as HTMLElement).style.backgroundColor).toMatch(
            /^(#42a5f5|rgb\(66, 165, 245\))$/i
        );

        wrapper.unmount();
    });
});
