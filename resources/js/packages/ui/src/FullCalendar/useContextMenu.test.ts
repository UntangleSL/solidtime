import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeEntry } from '@/packages/api/src';
import type { CalendarEvent } from './calendarTypes';
import { useContextMenu } from './useContextMenu';

function breakEntry(): TimeEntry {
    return {
        id: 'break-1',
        start: '2026-07-14T10:00:00Z',
        end: '2026-07-14T11:00:00Z',
        duration: 3600,
        description: 'Lunch',
        project_id: null,
        task_id: null,
        organization_id: 'organization-1',
        user_id: 'user-1',
        tags: [],
        billable: false,
        type: 'break',
    } as TimeEntry;
}

describe('useContextMenu break actions', () => {
    const createTimeEntry = vi.fn().mockResolvedValue(undefined);
    const updateTimeEntry = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function contextMenu() {
        const entry = breakEntry();
        const calendarEvents = computed(() => [
            {
                id: entry.id,
                timeEntry: entry,
            } as CalendarEvent,
        ]);
        const menu = useContextMenu({
            calendarSettings: ref({
                snapMinutes: 15,
                startHour: 0,
                endHour: 24,
                slotMinutes: 15,
            }),
            calendarEvents,
            pixelsToMinutesFromMidnight: () => 0,
            getDayFromClientX: () => null,
            clientYToGridPixels: () => 0,
            createTimeEntry,
            updateTimeEntry,
            deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
            onEditEvent: vi.fn(),
            onCreateEvent: vi.fn(),
            onCreateBreak: vi.fn(),
            emitRefresh: vi.fn(),
        });

        menu.handleCalendarContextMenu({
            target: {
                closest: () => ({
                    getAttribute: () => entry.id,
                }),
            },
        } as unknown as MouseEvent);

        return menu;
    }

    it('preserves the type when duplicating a break', async () => {
        await contextMenu().handleContextDuplicate();

        expect(createTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
    });

    it('preserves the type when creating the second half of a split break', async () => {
        await contextMenu().handleContextSplit();

        expect(updateTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
        expect(createTimeEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'break',
            })
        );
    });
});

// Fork seam (m365, D-06): a right-click on an overlay block ([data-calendar-overlay]) selects the
// overlay branch; the entry branch still wins, and the empty-slot branch clears the element.
describe('useContextMenu overlay target', () => {
    const entry = breakEntry();

    function setup() {
        const calendarEvents = computed(() => [
            {
                id: entry.id,
                timeEntry: entry,
            } as CalendarEvent,
        ]);
        return useContextMenu({
            calendarSettings: ref({
                snapMinutes: 15,
                startHour: 0,
                endHour: 24,
                slotMinutes: 15,
            }),
            calendarEvents,
            pixelsToMinutesFromMidnight: (px: number) => px,
            getDayFromClientX: () => '2026-07-14',
            clientYToGridPixels: (clientY: number) => clientY,
            createTimeEntry: vi.fn().mockResolvedValue(undefined),
            updateTimeEntry: vi.fn().mockResolvedValue(undefined),
            deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
            onEditEvent: vi.fn(),
            onCreateEvent: vi.fn(),
            onCreateBreak: vi.fn(),
            emitRefresh: vi.fn(),
        });
    }

    // A fake event target whose closest() answers per selector.
    function contextMenuEvent(
        matches: Record<string, unknown>,
        position: { clientX: number; clientY: number } = { clientX: 300, clientY: 600 }
    ): MouseEvent {
        return {
            ...position,
            target: {
                closest: (selector: string) => matches[selector] ?? null,
            },
        } as unknown as MouseEvent;
    }

    const overlayBlock = document.createElement('div');
    overlayBlock.setAttribute('data-calendar-overlay', '');
    overlayBlock.setAttribute('data-ghost-id', 'meeting-1');
    const entryElement = { getAttribute: () => entry.id };

    it('selects the overlay branch for a meeting block', () => {
        const menu = setup();

        menu.handleCalendarContextMenu(
            contextMenuEvent({ '[data-calendar-overlay]': overlayBlock })
        );

        expect(menu.contextMenuOverlayElement.value).toBe(overlayBlock);
        expect(menu.contextMenuTimeEntry.value).toBeNull();
        expect(menu.contextMenuCreateTime.value).not.toBeNull();
        expect(menu.contextMenuCreateTime.value?.start.toISOString()).toBe(
            '2026-07-14T10:00:00.000Z'
        );
    });

    it('the entry branch clears the overlay element', () => {
        const menu = setup();
        menu.handleCalendarContextMenu(
            contextMenuEvent({ '[data-calendar-overlay]': overlayBlock })
        );

        menu.handleCalendarContextMenu(
            contextMenuEvent({
                '[data-event-id]': entryElement,
                '[data-calendar-overlay]': overlayBlock,
            })
        );

        expect(menu.contextMenuOverlayElement.value).toBeNull();
        expect(menu.contextMenuTimeEntry.value?.id).toBe(entry.id);
        expect(menu.contextMenuCreateTime.value).toBeNull();
    });

    it('the empty-slot branch clears the overlay element', () => {
        const menu = setup();
        menu.handleCalendarContextMenu(
            contextMenuEvent({ '[data-calendar-overlay]': overlayBlock })
        );

        menu.handleCalendarContextMenu(contextMenuEvent({}));

        expect(menu.contextMenuOverlayElement.value).toBeNull();
        expect(menu.contextMenuTimeEntry.value).toBeNull();
        expect(menu.contextMenuCreateTime.value).not.toBeNull();
    });

    it('a keyboard-opened menu on a focused block takes the overlay branch', () => {
        const menu = setup();

        // The context-menu key or Shift+F10 fires contextmenu on the focused block at 0/0
        menu.handleCalendarContextMenu(
            contextMenuEvent(
                { '[data-calendar-overlay]': overlayBlock },
                { clientX: 0, clientY: 0 }
            )
        );

        expect(menu.contextMenuOverlayElement.value).toBe(overlayBlock);
        expect(menu.contextMenuTimeEntry.value).toBeNull();
    });
});
