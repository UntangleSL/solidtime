import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { OutlookCalendarLabels, OutlookSuggestion } from '@/m365/types';
import OutlookSuggestionPicks from './OutlookSuggestionPicks.vue';
import type { PrefillReason } from './suggestionReason';

const labels = {
    other_suggestions: 'Other suggestions',
    use_suggestion: 'Use :project',
    reason_series: 'Same series',
    reason_domain_one: 'Like 1 meeting with @:domain',
    reason_domain_many: 'Like :count meetings with @:domain',
    reason_person_one: 'Like 1 meeting with :name',
    reason_person_many: 'Like :count meetings with :name',
    reason_subject_one: 'Like 1 meeting with a similar subject',
    reason_subject_many: 'Like :count meetings with a similar subject',
} as OutlookCalendarLabels;

function candidate(overrides: Partial<OutlookSuggestion> = {}): OutlookSuggestion {
    return {
        project_id: 'p-1',
        project_name: 'Acme Website',
        project_color: '#ef5350',
        client_name: 'Acme',
        confident: false,
        reason: { kind: 'domain', count: 4, value: 'client.com' },
        ...overrides,
    };
}

type Candidate = Pick<
    OutlookSuggestion,
    'project_id' | 'project_name' | 'project_color' | 'client_name'
> & { reason: PrefillReason };

function mountPicks(candidates: Candidate[]) {
    return mount(OutlookSuggestionPicks, { props: { candidates, labels } });
}

describe('OutlookSuggestionPicks', () => {
    it('renders nothing without candidates', () => {
        const wrapper = mountPicks([]);

        expect(wrapper.find('[role="group"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="outlook-suggestion-pick"]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders a labelled group of outline chips with dot, name, client, aria-label and reason title', () => {
        const wrapper = mountPicks([
            candidate(),
            candidate({
                project_id: 'p-2',
                project_name: 'Internal',
                client_name: null,
                project_color: '#42a5f5',
                reason: { kind: 'person', count: 1, value: 'Ana López' },
            }),
        ]);

        const group = wrapper.get('[role="group"]');
        expect(group.attributes('aria-label')).toBe('Other suggestions');
        const chips = wrapper.findAll('[data-testid="outlook-suggestion-pick"]');
        expect(chips).toHaveLength(2);

        const [first, second] = chips;
        expect(first!.element.tagName).toBe('BUTTON');
        expect(first!.attributes('type')).toBe('button');
        expect(first!.text()).toBe('Acme Website · Acme');
        expect(first!.attributes('aria-label')).toBe('Use Acme Website (Acme)');
        expect(first!.attributes('title')).toBe('Like 4 meetings with @client.com');
        expect(first!.find('[data-testid="outlook-project-dot"]').exists()).toBe(true);
        expect(first!.find('.max-w-40.truncate').text()).toBe('Acme Website · Acme');

        expect(second!.text()).toBe('Internal');
        expect(second!.attributes('aria-label')).toBe('Use Internal');
        expect(second!.attributes('title')).toBe('Like 1 meeting with Ana López');
        wrapper.unmount();
    });

    it('titles a series candidate "Same series"', () => {
        const wrapper = mountPicks([
            {
                project_id: 'p-3',
                project_name: 'Ops',
                project_color: '#66bb6a',
                client_name: null,
                reason: { kind: 'series' },
            },
        ]);

        expect(wrapper.get('[data-testid="outlook-suggestion-pick"]').attributes('title')).toBe(
            'Same series'
        );
        wrapper.unmount();
    });

    it('emits pick with the project id on click', async () => {
        const wrapper = mountPicks([candidate(), candidate({ project_id: 'p-2' })]);

        await wrapper.findAll('[data-testid="outlook-suggestion-pick"]')[1]!.trigger('click');

        expect(wrapper.emitted('pick')).toEqual([['p-2']]);
        wrapper.unmount();
    });

    it('renders names as literal text', () => {
        const wrapper = mountPicks([
            candidate({ project_name: '<img src=x onerror=alert(1)>', client_name: '<b>x</b>' }),
        ]);

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.get('[data-testid="outlook-suggestion-pick"]').text()).toBe(
            '<img src=x onerror=alert(1)> · <b>x</b>'
        );
        wrapper.unmount();
    });
});
