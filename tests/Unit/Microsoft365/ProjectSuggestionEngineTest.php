<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Suggestions\MeetingSignals;
use App\Microsoft365\Suggestions\ProjectSuggestionEngine;
use App\Microsoft365\Suggestions\Reason;
use App\Microsoft365\Suggestions\Suggestion;
use PHPUnit\Framework\Attributes\CoversClass;
use Tests\TestCase;

#[CoversClass(ProjectSuggestionEngine::class)]
#[CoversClass(MeetingSignals::class)]
#[CoversClass(Suggestion::class)]
#[CoversClass(Reason::class)]
class ProjectSuggestionEngineTest extends TestCase
{
    private const string SECRET = 'test-secret';

    private const string ME = 'me@untangle.es';

    /**
     * A meeting in the shape MeetingSignalInput::fromMeeting() returns.
     *
     * @param  list<string|array{0: string, 1: ?string}>  $attendees  address, or [address, name]
     * @return array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}
     */
    private function meeting(array $attendees, ?string $subject = null, ?string $organizer = null, ?string $organizerName = null, ?int $count = null): array
    {
        $list = [];
        foreach ($attendees as $attendee) {
            [$address, $name] = is_array($attendee) ? $attendee : [$attendee, null];
            $list[] = ['address' => $address, 'name' => $name, 'type' => 'required'];
        }

        return [
            'organizer_address' => $organizer ?? self::ME,
            'organizer_name' => $organizer === null ? 'Me' : $organizerName,
            'is_organizer' => $organizer === null,
            'attendees' => $list,
            'attendee_count' => $count,
            'subject' => $subject,
        ];
    }

    /**
     * @param  array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}  $meeting
     * @return array{organizer: ?string, organizer_name: ?string, organizer_internal: bool, external: array<string, ?string>, internal: array<string, ?string>, domains: list<string>, tokens: list<string>, count: int}
     */
    private function features(array $meeting): array
    {
        return MeetingSignals::features($meeting, [self::ME], ['untangle.es']);
    }

    /**
     * @param  array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}  $meeting
     * @return array{project_id: string, age_days: float, series: ?string, forgotten: bool, signals: array<string, mixed>}
     */
    private function link(string $projectId, float $ageDays, array $meeting, ?string $series = null, bool $forgotten = false): array
    {
        return [
            'project_id' => $projectId,
            'age_days' => $ageDays,
            'series' => $series,
            'forgotten' => $forgotten,
            'signals' => MeetingSignals::hashed($this->features($meeting), self::SECRET),
        ];
    }

    /**
     * Ranks a target meeting against the history with the labels 05-09 passes.
     *
     * @param  array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}  $target
     * @param  list<array{project_id: string, age_days: float, series: ?string, forgotten: bool, signals: array<string, mixed>}>  $history
     * @return list<Suggestion>
     */
    private function rank(array $target, array $history, ?string $excludeSeries = null, int $limit = ProjectSuggestionEngine::DEFAULT_LIMIT): array
    {
        $features = $this->features($target);

        return ProjectSuggestionEngine::rank(
            MeetingSignals::hashed($features, self::SECRET),
            MeetingSignals::labels($features, self::SECRET),
            $history,
            $excludeSeries,
            $limit,
        );
    }

    /**
     * Filler links of another project, with people at other.test and an unrelated subject.
     *
     * @return list<array{project_id: string, age_days: float, series: ?string, forgotten: bool, signals: array<string, mixed>}>
     */
    private function filler(int $count, string $projectId = 'project-q'): array
    {
        $links = [];
        for ($index = 0; $index < $count; $index++) {
            $links[] = $this->link($projectId, 10.0, $this->meeting(['p'.$index.'@other.test'], 'Budget planning'));
        }

        return $links;
    }

    public function test_two_conversions_with_the_same_client_domain_give_a_confident_suggestion(): void
    {
        $history = [
            $this->link('project-p', 5.0, $this->meeting([['ana@client.test', 'Ana'], ['luis@client.test', 'Luis']], 'Design review')),
            $this->link('project-p', 20.0, $this->meeting([['ana@client.test', 'Ana'], ['luis@client.test', 'Luis']], 'Roadmap')),
            ...$this->filler(8),
        ];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Kickoff ACME'), $history);

        $this->assertCount(1, $suggestions);
        $this->assertSame('project-p', $suggestions[0]->projectId);
        $this->assertTrue($suggestions[0]->confident);
        $this->assertSame(['kind' => 'domain', 'count' => 2, 'value' => 'client.test'], $suggestions[0]->reason->toArray());
        // idf = ln(1 + 10 / 2) = ln 6, weight 2, decay of 5 and 20 days
        $expected = 2.0 * log(6) * (0.5 ** (5 / 90) + 0.5 ** (20 / 90));
        $this->assertEqualsWithDelta($expected, $suggestions[0]->score, 0.0001);

        $payload = $suggestions[0]->toArray();
        $this->assertArrayNotHasKey('score', $payload);
        $this->assertSame(['project_id', 'confident', 'reason'], array_keys($payload));
    }

    public function test_empty_history_gives_no_suggestions(): void
    {
        $this->assertSame([], $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Kickoff ACME'), []));
    }

    public function test_nothing_shared_gives_no_suggestions(): void
    {
        $this->assertSame([], $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Kickoff ACME'), $this->filler(5)));
    }

    /**
     * @param  list<Suggestion>  $suggestions
     * @return list<string>
     */
    private function ids(array $suggestions): array
    {
        return array_map(static fn (Suggestion $suggestion): string => $suggestion->projectId, $suggestions);
    }

    public function test_organizer_beats_domain(): void
    {
        $history = [
            $this->link('project-a', 10.0, $this->meeting([], 'Alpha', 'ana@client.test', 'Ana')),
            $this->link('project-b', 10.0, $this->meeting([['luis@client.test', 'Luis']], 'Beta')),
            ...$this->filler(6),
        ];

        $suggestions = $this->rank($this->meeting([], 'Gamma', 'ana@client.test', 'Ana'), $history);

        $this->assertSame(['project-a', 'project-b'], $this->ids($suggestions));
        $this->assertTrue($suggestions[0]->confident);
        $this->assertSame(['kind' => 'organizer', 'count' => 1, 'value' => 'Ana'], $suggestions[0]->reason->toArray());
        $this->assertFalse($suggestions[1]->confident);
        $this->assertSame(['kind' => 'domain', 'count' => 1, 'value' => 'client.test'], $suggestions[1]->reason->toArray());
    }

    public function test_person_beats_three_subject_words(): void
    {
        $history = [
            $this->link('project-a', 10.0, $this->meeting([['eva@client.test', 'Eva']], 'Something else')),
            $this->link('project-b', 10.0, $this->meeting(['x@another.test'], 'Phoenix pricing roadmap')),
            ...$this->filler(4),
        ];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Phoenix pricing roadmap'), $history);

        $this->assertSame(['project-a', 'project-b'], $this->ids($suggestions));
        $this->assertGreaterThan($suggestions[1]->score, $suggestions[0]->score);
        $this->assertSame(['kind' => 'person', 'count' => 1, 'value' => 'Eva'], $suggestions[0]->reason->toArray());
        $this->assertSame(['kind' => 'subject', 'count' => 1, 'value' => null], $suggestions[1]->reason->toArray());
    }

    public function test_a_feature_in_every_row_contributes_about_ln_2_per_row(): void
    {
        $history = [];
        for ($index = 0; $index < 4; $index++) {
            $history[] = $this->link('project-p', 0.0, $this->meeting([], 'Phoenix'));
        }

        $suggestions = $this->rank($this->meeting([], 'Phoenix'), $history);

        $this->assertCount(1, $suggestions);
        $this->assertEqualsWithDelta(4 * log(2), $suggestions[0]->score, 0.000001);
    }

    public function test_a_feature_in_one_row_of_fifty_is_capped_at_the_idf_cap(): void
    {
        $history = [$this->link('project-p', 0.0, $this->meeting([], 'Phoenix')), ...$this->filler(49)];

        $suggestions = $this->rank($this->meeting([], 'Phoenix'), $history);

        $this->assertCount(1, $suggestions);
        $this->assertGreaterThan(ProjectSuggestionEngine::IDF_CAP, log(51));
        $this->assertEqualsWithDelta(ProjectSuggestionEngine::IDF_CAP * ProjectSuggestionEngine::W_TOKEN, $suggestions[0]->score, 0.000001);
        // one rare word on a single link never prefills, even at the minimum score
        $this->assertFalse($suggestions[0]->confident);
    }

    public function test_decay_halves_a_match_every_ninety_days(): void
    {
        $meeting = $this->meeting([['eva@client.test', 'Eva']], 'Alpha');
        $target = $this->meeting([['eva@client.test', 'Eva']], 'Gamma');

        $fresh = $this->rank($target, [$this->link('project-p', 0.0, $meeting), ...$this->filler(3)]);
        $old = $this->rank($target, [$this->link('project-p', 90.0, $meeting), ...$this->filler(3)]);

        $this->assertEqualsWithDelta(2.0, $fresh[0]->score / $old[0]->score, 0.01);
    }

    public function test_one_rare_subject_word_on_one_link_is_not_confident(): void
    {
        $history = [$this->link('project-p', 10.0, $this->meeting([], 'Phoenix')), ...$this->filler(9)];

        $suggestions = $this->rank($this->meeting([], 'Phoenix'), $history);

        $this->assertCount(1, $suggestions);
        $this->assertLessThan(ProjectSuggestionEngine::MIN_SCORE, $suggestions[0]->score);
        $this->assertFalse($suggestions[0]->confident);
        $this->assertSame(['kind' => 'subject', 'count' => 1, 'value' => null], $suggestions[0]->reason->toArray());
    }

    public function test_the_same_word_on_three_links_is_confident_without_a_close_second(): void
    {
        $history = [];
        for ($index = 0; $index < 3; $index++) {
            $history[] = $this->link('project-p', 0.0, $this->meeting([], 'Phoenix'));
        }

        $suggestions = $this->rank($this->meeting([], 'Phoenix'), [...$history, ...$this->filler(7)]);

        $this->assertCount(1, $suggestions);
        $this->assertGreaterThanOrEqual(ProjectSuggestionEngine::MIN_SCORE, $suggestions[0]->score);
        $this->assertTrue($suggestions[0]->confident);
        $this->assertSame(['kind' => 'subject', 'count' => 3, 'value' => null], $suggestions[0]->reason->toArray());
    }

    public function test_the_same_word_on_three_links_is_not_confident_when_the_margin_fails(): void
    {
        $history = [];
        for ($index = 0; $index < 3; $index++) {
            $history[] = $this->link('project-p', 10.0, $this->meeting([], 'Phoenix'));
        }
        $history[] = $this->link('project-r', 0.0, $this->meeting([], 'Phoenix'));
        $history[] = $this->link('project-r', 0.0, $this->meeting([], 'Phoenix'));

        $suggestions = $this->rank($this->meeting([], 'Phoenix'), [...$history, ...$this->filler(7)]);

        $this->assertSame(['project-p', 'project-r'], $this->ids($suggestions));
        $this->assertGreaterThanOrEqual(ProjectSuggestionEngine::MIN_SCORE, $suggestions[0]->score);
        $this->assertLessThan(ProjectSuggestionEngine::MARGIN * $suggestions[1]->score, $suggestions[0]->score);
        $this->assertFalse($suggestions[0]->confident);
        $this->assertFalse($suggestions[1]->confident);
    }

    public function test_close_scores_return_both_and_none_confident(): void
    {
        $history = [
            $this->link('project-a', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-a', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-b', 10.0, $this->meeting([['luis@client.test', 'Luis']], 'Beta')),
            $this->link('project-b', 10.0, $this->meeting([['luis@client.test', 'Luis']], 'Beta')),
            ...$this->filler(4),
        ];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva'], ['luis@client.test', 'Luis']], 'Gamma'), $history);

        $this->assertSame(['project-a', 'project-b'], $this->ids($suggestions));
        $this->assertLessThan(ProjectSuggestionEngine::MARGIN, $suggestions[0]->score / $suggestions[1]->score);
        $this->assertFalse($suggestions[0]->confident);
        $this->assertFalse($suggestions[1]->confident);
    }

    /**
     * Project 1 has four links with person0, projects 2 to 5 one link each with their own person.
     *
     * @return array{0: array{organizer_address: ?string, organizer_name: ?string, is_organizer: bool, attendees: list<array{address: string, name: ?string, type: string}>, attendee_count: ?int, subject: ?string}, 1: list<array{project_id: string, age_days: float, series: ?string, forgotten: bool, signals: array<string, mixed>}>}
     */
    private function fiveCandidates(): array
    {
        $history = [];
        for ($index = 0; $index < 4; $index++) {
            $history[] = $this->link('project-1', 0.0, $this->meeting([['person0@client.test', 'Person 0']], 'Alpha'));
        }
        for ($index = 1; $index <= 4; $index++) {
            $history[] = $this->link('project-'.($index + 1), 0.0, $this->meeting([['person'.$index.'@client.test', 'Person '.$index]], 'Beta'));
        }
        $attendees = [];
        for ($index = 0; $index <= 4; $index++) {
            $attendees[] = ['person'.$index.'@client.test', 'Person '.$index];
        }

        return [$this->meeting($attendees, 'Gamma'), [...$history, ...$this->filler(4)]];
    }

    public function test_at_most_three_are_returned_and_only_the_first_can_be_confident(): void
    {
        [$target, $history] = $this->fiveCandidates();

        $suggestions = $this->rank($target, $history);

        $this->assertSame(['project-1', 'project-2', 'project-3'], $this->ids($suggestions));
        $this->assertTrue($suggestions[0]->confident);
        $this->assertFalse($suggestions[1]->confident);
        $this->assertFalse($suggestions[2]->confident);
        $this->assertSame(['kind' => 'person', 'count' => 4, 'value' => 'Person 0'], $suggestions[0]->reason->toArray());

        $all = $this->rank($target, $history, null, 5);
        $this->assertSame(['project-1', 'project-2', 'project-3', 'project-4', 'project-5'], $this->ids($all));
        $this->assertSame([true, false, false, false, false], array_map(static fn (Suggestion $suggestion): bool => $suggestion->confident, $all));
    }

    public function test_reason_organizer_match_counts_the_person_in_either_role(): void
    {
        $history = [
            $this->link('project-p', 5.0, $this->meeting([['ana@client.test', 'Ana']], 'Alpha')),
            $this->link('project-p', 15.0, $this->meeting([], 'Beta', 'ana@client.test', 'Ana')),
            ...$this->filler(4),
        ];

        $suggestions = $this->rank($this->meeting([], 'Gamma', 'ana@client.test', 'Ana Client'), $history);

        $this->assertSame(['kind' => 'organizer', 'count' => 2, 'value' => 'Ana Client'], $suggestions[0]->reason->toArray());
        $this->assertTrue($suggestions[0]->confident);
    }

    public function test_reason_attendee_match_uses_the_display_name(): void
    {
        $history = [$this->link('project-p', 5.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')), ...$this->filler(4)];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva Pérez']], 'Gamma'), $history);

        $this->assertSame(['kind' => 'person', 'count' => 1, 'value' => 'Eva Pérez'], $suggestions[0]->reason->toArray());
        // a single person match is strong enough to prefill
        $this->assertTrue($suggestions[0]->confident);
    }

    public function test_reason_person_without_a_name_falls_back_to_the_domain_never_the_address(): void
    {
        $history = [$this->link('project-p', 5.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')), ...$this->filler(4)];

        $suggestions = $this->rank($this->meeting([['eva@client.test', null]], 'Gamma'), $history);

        $this->assertSame(['kind' => 'domain', 'count' => 1, 'value' => 'client.test'], $suggestions[0]->reason->toArray());
        $this->assertStringNotContainsString('@', (string) json_encode($suggestions[0]->toArray()));
    }

    public function test_reason_subject_only_has_no_value(): void
    {
        $history = [
            $this->link('project-p', 5.0, $this->meeting([], 'Phoenix launch')),
            $this->link('project-p', 5.0, $this->meeting([], 'Phoenix')),
            ...$this->filler(4),
        ];

        $suggestions = $this->rank($this->meeting([], 'Phoenix kickoff'), $history);

        $this->assertSame(['kind' => 'subject', 'count' => 2, 'value' => null], $suggestions[0]->reason->toArray());
    }

    public function test_reason_count_is_the_rows_of_the_project_sharing_the_strongest_feature(): void
    {
        $history = [
            $this->link('project-p', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-p', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-p', 0.0, $this->meeting([['luis@client.test', 'Luis']], 'Alpha')),
            ...$this->filler(5),
        ];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Gamma'), $history);

        $this->assertSame(['kind' => 'person', 'count' => 2, 'value' => 'Eva'], $suggestions[0]->reason->toArray());
    }

    public function test_broadcast_target_scores_only_the_organizer(): void
    {
        $history = [
            $this->link('project-p', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-p', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha')),
            $this->link('project-q', 0.0, $this->meeting([], 'Beta', 'ana@client.test', 'Ana')),
            ...$this->filler(4, 'project-z'),
        ];
        $target = $this->meeting([['eva@client.test', 'Eva']], 'Gamma', 'ana@client.test', 'Ana', ProjectSuggestionEngine::BROADCAST_LIMIT + 5);

        $suggestions = $this->rank($target, $history);

        $this->assertSame(['project-q'], $this->ids($suggestions));
        $this->assertSame('organizer', $suggestions[0]->reason->kind);

        // the same target under the limit also matches the attendee and the domain
        $small = $this->meeting([['eva@client.test', 'Eva']], 'Gamma', 'ana@client.test', 'Ana', ProjectSuggestionEngine::BROADCAST_LIMIT);
        $this->assertSame(['project-p', 'project-q'], $this->ids($this->rank($small, $history)));
    }

    public function test_broadcast_link_scores_only_its_organizer(): void
    {
        $history = [
            // all-hands organized by Ana: only Ana can match
            $this->link('project-p', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Alpha', 'ana@client.test', 'Ana', 40)),
            // all-hands organized by the user with Eva in it: nothing matches
            $this->link('project-r', 0.0, $this->meeting([['eva@client.test', 'Eva']], 'Beta', null, null, 40)),
            ...$this->filler(4),
        ];

        $suggestions = $this->rank($this->meeting([['eva@client.test', 'Eva']], 'Gamma', 'ana@client.test', 'Ana'), $history);

        $this->assertSame(['project-p'], $this->ids($suggestions));
        $this->assertSame(['kind' => 'organizer', 'count' => 1, 'value' => 'Ana'], $suggestions[0]->reason->toArray());
    }

    public function test_forgotten_series_links_never_score_for_that_series(): void
    {
        $meeting = $this->meeting([['eva@client.test', 'Eva']], 'Alpha');
        $history = [
            $this->link('project-p', 0.0, $meeting, 's1', true),
            $this->link('project-p', 0.0, $meeting, 's1', true),
            $this->link('project-q', 30.0, $meeting, 's1', false),
            $this->link('project-r', 60.0, $meeting, 's2', true),
            ...$this->filler(4),
        ];
        $target = $this->meeting([['eva@client.test', 'Eva']], 'Gamma');

        $this->assertSame(['project-q', 'project-r'], $this->ids($this->rank($target, $history, 's1')));
        $this->assertSame(['project-p', 'project-q', 'project-r'], $this->ids($this->rank($target, $history)));
        $this->assertSame(['project-p', 'project-q', 'project-r'], $this->ids($this->rank($target, $history, 's3')));
    }

    public function test_old_or_partial_payloads_are_read_defensively(): void
    {
        $target = MeetingSignals::hashed($this->features($this->meeting([['eva@client.test', 'Eva']], 'Gamma')), self::SECRET);
        $history = [
            ['project_id' => 'project-p', 'age_days' => 0, 'series' => null, 'forgotten' => false, 'signals' => ['v' => 1, 'a' => $target['a'], 'd' => 'not-a-list', 'n' => 'x']],
            ['project_id' => 'project-q', 'age_days' => 0, 'series' => null, 'forgotten' => false, 'signals' => []],
        ];

        $suggestions = ProjectSuggestionEngine::rank($target, [], $history);

        $this->assertSame(['project-p'], $this->ids($suggestions));
        $this->assertSame(['kind' => 'person', 'count' => 1, 'value' => null], $suggestions[0]->reason->toArray());
    }
}
