import { afterEach, describe, expect, it } from 'vitest';
import { describeBlock } from './describeBlock';

function block(describedBy: string | null = null): { block: HTMLElement; child: HTMLElement } {
    const el = document.createElement('div');
    el.setAttribute('data-event-id', 'e1');
    if (describedBy !== null) el.setAttribute('aria-describedby', describedBy);
    const inner = document.createElement('div');
    const child = document.createElement('span');
    inner.appendChild(child);
    el.appendChild(inner);
    document.body.appendChild(el);
    return { block: el, child };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('describeBlock', () => {
    it('adds the id to the closest entry block, after the ids already there', () => {
        const { block: el, child } = block('a');
        describeBlock(child, 'm1');
        expect(el.getAttribute('aria-describedby')).toBe('a m1');
    });

    it('removes only its own id when the remover runs', () => {
        const { block: el, child } = block('a');
        const remove = describeBlock(child, 'm1');
        remove();
        expect(el.getAttribute('aria-describedby')).toBe('a');
    });

    it('removes the attribute when the last id goes', () => {
        const { block: el, child } = block();
        const remove = describeBlock(child, 'm1');
        expect(el.getAttribute('aria-describedby')).toBe('m1');
        remove();
        expect(el.hasAttribute('aria-describedby')).toBe(false);
    });

    it('never duplicates an id', () => {
        const { block: el, child } = block('a');
        describeBlock(child, 'm1');
        describeBlock(child, 'm1');
        expect(el.getAttribute('aria-describedby')).toBe('a m1');
    });

    it('keeps an id it did not add', () => {
        const { block: el, child } = block('a m1');
        const remove = describeBlock(child, 'm1');
        remove();
        expect(el.getAttribute('aria-describedby')).toBe('a m1');
    });

    it('normalises extra whitespace in the existing list', () => {
        const { block: el, child } = block('  a   b ');
        const remove = describeBlock(child, 'm1');
        expect(el.getAttribute('aria-describedby')).toBe('a b m1');
        remove();
        expect(el.getAttribute('aria-describedby')).toBe('a b');
    });

    it('still cleans the block when the marker was detached first (unmount order)', () => {
        const { block: el, child } = block('a');
        const remove = describeBlock(child, 'm1');
        child.remove();
        remove();
        expect(el.getAttribute('aria-describedby')).toBe('a');
    });

    it('is a no-op outside an entry block', () => {
        const orphan = document.createElement('span');
        document.body.appendChild(orphan);
        const remove = describeBlock(orphan, 'm1');
        expect(() => remove()).not.toThrow();
        expect(document.querySelector('[aria-describedby]')).toBeNull();
    });

    it('is a no-op for an empty id', () => {
        const { block: el, child } = block('a');
        const remove = describeBlock(child, '');
        remove();
        expect(el.getAttribute('aria-describedby')).toBe('a');
    });
});
