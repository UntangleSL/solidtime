// The core entry block carries an aria-label (its title), which hides any text inside it from
// screen readers. Fork markers (out-of-sync flag, origin icon) render a hidden description with an
// id and attach it here to the closest core block's aria-describedby at runtime, so the core
// calendar components need no change (06-UI-SPEC section 1, same DOM hookup idea as
// labelDialogBySubject in OutlookGhostDetail).

const BLOCK_SELECTOR = '[data-event-id]';
const ATTRIBUTE = 'aria-describedby';

function readIds(el: Element): string[] {
    return (el.getAttribute(ATTRIBUTE) ?? '').split(/\s+/).filter((id) => id !== '');
}

function writeIds(el: Element, ids: string[]): void {
    if (ids.length === 0) el.removeAttribute(ATTRIBUTE);
    else el.setAttribute(ATTRIBUTE, ids.join(' '));
}

/**
 * Adds `id` to the aria-describedby list of the closest `[data-event-id]` element around `from`
 * and returns a remover that takes it out again, leaving every other id in place. The block is
 * captured now, so the remover still works once `from` is detached (unmount). No block, an empty
 * id or an id already in the list: nothing is added and the remover does nothing.
 */
export function describeBlock(from: Element, id: string): () => void {
    const block = from.closest(BLOCK_SELECTOR);
    if (block === null || id === '' || readIds(block).includes(id)) return () => {};

    writeIds(block, [...readIds(block), id]);
    return () =>
        writeIds(
            block,
            readIds(block).filter((current) => current !== id)
        );
}
