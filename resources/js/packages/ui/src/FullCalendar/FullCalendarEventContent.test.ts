import { afterEach, describe, expect, it } from 'vitest';
import { computed, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import FullCalendarEventContent from './FullCalendarEventContent.vue';

// Fork seam guard (Phase 4, D-12): the optional `title-prefix` slot must leave the entry exactly as
// upstream renders it when no content is passed, and put slot content first in the title row.
let wrapper: VueWrapper | null = null;

function mountContent(
    props: { title: string; isBreak?: boolean },
    slots: Record<string, () => ReturnType<typeof h>> = {}
): VueWrapper {
    wrapper = mount(FullCalendarEventContent, {
        props: { durationSeconds: 3600, ...props },
        slots,
        global: {
            provide: {
                organization: computed(() => undefined),
            },
        },
    });
    return wrapper;
}

function titleRow(content: VueWrapper): HTMLElement {
    const row = content.find('.font-semibold');
    expect(row.exists()).toBe(true);
    return row.element as HTMLElement;
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
});

describe('FullCalendarEventContent title-prefix slot', () => {
    it('renders only the title span without slot content', () => {
        const content = mountContent({ title: 'Design review' });
        const row = titleRow(content);

        const children = Array.from(row.children);
        expect(children).toHaveLength(1);
        expect(children[0]!.tagName).toBe('SPAN');
        expect(children[0]!.textContent).toBe('Design review');
        expect(row.textContent!.trim()).toBe('Design review');
    });

    it('renders the break icon then the title for breaks without slot content', () => {
        const content = mountContent({ title: 'Lunch', isBreak: true });
        const row = titleRow(content);

        const children = Array.from(row.children);
        expect(children).toHaveLength(2);
        expect(children[0]!.tagName.toLowerCase()).toBe('svg');
        expect(children[1]!.tagName).toBe('SPAN');
        expect(children[1]!.textContent).toBe('Lunch');
    });

    it('puts title-prefix content first in the title row, before the title text', () => {
        const content = mountContent(
            { title: 'Weekly sync' },
            { 'title-prefix': () => h('i', { 'data-testid': 'prefix' }, 'P') }
        );
        const row = titleRow(content);

        const children = Array.from(row.children);
        expect(children).toHaveLength(2);
        expect(children[0]!.getAttribute('data-testid')).toBe('prefix');
        expect(children[1]!.textContent).toBe('Weekly sync');
    });
});
