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
}
