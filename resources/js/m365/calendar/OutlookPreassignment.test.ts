import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OutlookPreassignment from './OutlookPreassignment.vue';
import type { OutlookAssignment, OutlookCalendarLabels } from '@/m365/types';

const labels = {
    preassigned_eyebrow: 'Pre-assigned · Same series',
    why_series: 'You logged this series to :project on :date.',
    tags_one: '1 Tag',
    tags_many: ':count Tags',
    billable: 'Billable',
    non_billable: 'Non-Billable',
} as OutlookCalendarLabels;

function assignment(overrides: Partial<OutlookAssignment> = {}): OutlookAssignment {
    return {
        project_id: 'p-1',
        project_name: 'Acme Website',
        project_color: '#ef5350',
        client_name: 'Acme',
        task_id: 't-1',
        task_name: 'Design',
        tags: ['tag-1', 'tag-2'],
        billable: true,
        // Tuesday (the test setup uses timezone UTC)
        converted_at: '2026-11-10T09:00:00Z',
        ...overrides,
    };
}

function mountBlock(
    variant: 'compact' | 'full',
    overrides: Partial<OutlookAssignment> = {}
): ReturnType<typeof mount> {
    return mount(OutlookPreassignment, {
        props: { assignment: assignment(overrides), labels, variant },
    });
}

function text(wrapper: ReturnType<typeof mount>, testId: string): string {
    return wrapper.find(`[data-testid="${testId}"]`).text();
}

describe('OutlookPreassignment', () => {
    it('compact: eyebrow with the Repeat icon, project line and detail line', () => {
        const wrapper = mountBlock('compact');

        const root = wrapper.find('[data-testid="outlook-preassignment"]');
        expect(root.exists()).toBe(true);
        expect(root.classes()).toContain('space-y-1');
        // The host sets the top margin
        expect(root.classes().some((name) => name.startsWith('mt-'))).toBe(false);

        const eyebrow = wrapper.find('[data-testid="outlook-preassignment-eyebrow"]');
        expect(eyebrow.text()).toBe('Pre-assigned · Same series');
        expect(eyebrow.find('svg').attributes('aria-hidden')).toBe('true');

        const project = wrapper.find('[data-testid="outlook-preassignment-project"]');
        expect(project.text()).toBe('Acme Website · Acme');
        expect(project.find('[data-testid="outlook-project-dot"]').exists()).toBe(true);
        expect(project.find('.font-semibold').text()).toBe('Acme Website');
        expect(project.find('.font-semibold').classes()).toContain('text-text-primary');

        expect(text(wrapper, 'outlook-preassignment-detail')).toBe('Design · 2 Tags · Billable');
        expect(wrapper.find('[data-testid="outlook-detail-why"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="outlook-detail-preassignment"]').exists()).toBe(false);
    });

    it('colours only the dot with the project colour', () => {
        const wrapper = mountBlock('compact');

        const dot = wrapper.find('[data-testid="outlook-project-dot"]');
        expect(dot.attributes('style')).toContain('background-color');
        expect(wrapper.findAll('[style]')).toHaveLength(1);
    });

    it('omits the client, the task and the tags when absent', () => {
        const wrapper = mountBlock('compact', {
            client_name: null,
            task_id: null,
            task_name: null,
            tags: [],
            billable: false,
        });

        expect(text(wrapper, 'outlook-preassignment-project')).toBe('Acme Website');
        expect(text(wrapper, 'outlook-preassignment-detail')).toBe('Non-Billable');
    });

    it('uses the singular tag copy for one tag', () => {
        const wrapper = mountBlock('compact', { task_name: null, tags: ['tag-1'] });

        expect(text(wrapper, 'outlook-preassignment-detail')).toBe('1 Tag · Billable');
    });

    it('full: the same lines plus the why line with the date of the last conversion', () => {
        const wrapper = mountBlock('full');

        expect(wrapper.find('[data-testid="outlook-detail-preassignment"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="outlook-preassignment"]').exists()).toBe(false);
        expect(text(wrapper, 'outlook-preassignment-project')).toBe('Acme Website · Acme');
        expect(text(wrapper, 'outlook-preassignment-detail')).toBe('Design · 2 Tags · Billable');
        const why = wrapper.find('[data-testid="outlook-detail-why"]');
        expect(why.text()).toBe('You logged this series to Acme Website on Tue, Nov 10.');
        expect(why.classes()).toContain('tabular-nums');
    });

    it('truncates long names and keeps the full text in title', () => {
        const long = 'A very long project name that does not fit into the hover card at all';
        const wrapper = mountBlock('compact', {
            project_name: long,
            client_name: 'Client with a long name',
            task_name: 'A long task name as well',
        });

        const name = wrapper.find('[data-testid="outlook-preassignment-project"] [title]');
        expect(name.classes()).toContain('truncate');
        expect(name.attributes('title')).toBe(`${long} · Client with a long name`);
        const detail = wrapper.find('[data-testid="outlook-preassignment-detail"]');
        expect(detail.classes()).toContain('truncate');
        expect(detail.attributes('title')).toBe('A long task name as well · 2 Tags · Billable');
    });

    it('renders values containing HTML as text', () => {
        const html = '<img src=x onerror="alert(1)"><b>bold</b>';
        const wrapper = mountBlock('full', {
            project_name: html,
            client_name: '<i>client</i>',
            task_name: '<u>task</u>',
        });

        expect(text(wrapper, 'outlook-preassignment-project')).toBe(`${html} · <i>client</i>`);
        expect(text(wrapper, 'outlook-preassignment-detail')).toContain('<u>task</u>');
        expect(text(wrapper, 'outlook-detail-why')).toContain(html);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.find('i').exists()).toBe(false);
        expect(wrapper.find('u').exists()).toBe(false);
    });
});
