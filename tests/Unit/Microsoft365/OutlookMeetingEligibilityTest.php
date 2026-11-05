<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Graph\OutlookMeetingEligibility;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

#[CoversClass(OutlookMeetingEligibility::class)]
class OutlookMeetingEligibilityTest extends TestCase
{
    /**
     * Scenario file(s) and the fixed verdict of every captured and synthetic scenario. The files come from
     * manifest.json, never from a directory listing.
     *
     * @return array<string, array{0: string, 1: string, 2: bool}>
     */
    public static function scenarioProvider(): array
    {
        return [
            'S1 single meeting' => ['S1', 'round_a', true],
            'S1b organizer with attendee' => ['S1b', 'round_a', true],
            'S2 recurring occurrences' => ['S2', 'round_a', true],
            'S3 cancelled (round B)' => ['S3', 'round_b', false],
            'S5 not responded (round B)' => ['S5', 'round_b', true],
            'S6 private' => ['S6', 'round_a', false],
            'S6b normal sensitivity' => ['S6b', 'round_a', true],
            'S7 all day' => ['S7', 'round_a', false],
            'S8 personal block, no response' => ['S8', 'round_a', true],
            'SYN-confidential' => ['SYN-confidential', 'round_a', false],
            'SYN-personal' => ['SYN-personal', 'round_a', false],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function scenarioEvents(string $scenario, string $round): array
    {
        $manifest = $this->readJson('manifest.json');
        $files = $manifest['scenarios'][$scenario][$round]['files'] ?? [];
        $this->assertNotEmpty($files, 'No fixture file for '.$scenario.' '.$round);

        $events = [];
        foreach ($files as $file) {
            $data = $this->readJson((string) $file);
            foreach ($data['value'] as $event) {
                $events[] = $event;
            }
        }
        $this->assertNotEmpty($events);

        return $events;
    }

    /**
     * @return array<string, mixed>
     */
    private function readJson(string $path): array
    {
        $json = file_get_contents(base_path('tests/Fixtures/M365/'.$path));
        $this->assertNotFalse($json);
        $data = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertIsArray($data);

        return $data;
    }

    /**
     * A normal accepted meeting to copy and change in one field.
     *
     * @return array<string, mixed>
     */
    private function baseEvent(): array
    {
        return $this->scenarioEvents('S1', 'round_a')[0];
    }

    #[DataProvider('scenarioProvider')]
    public function test_every_scenario_has_a_fixed_verdict(string $scenario, string $round, bool $eligible): void
    {
        // Arrange
        $eligibility = new OutlookMeetingEligibility;

        // Act and Assert
        foreach ($this->scenarioEvents($scenario, $round) as $event) {
            $this->assertSame($eligible, $eligibility->isEligible($event), $scenario.' '.$round);
        }
    }

    public function test_the_base_fixture_is_eligible(): void
    {
        $this->assertTrue((new OutlookMeetingEligibility)->isEligible($this->baseEvent()));
    }

    public function test_a_flag_that_did_not_come_back_fails_closed(): void
    {
        // Arrange
        $eligibility = new OutlookMeetingEligibility;

        foreach (['isCancelled', 'isAllDay', 'sensitivity'] as $flag) {
            $event = $this->baseEvent();
            unset($event[$flag]);

            // Act and Assert
            $this->assertFalse($eligibility->isEligible($event), 'removed '.$flag);
        }
    }

    public function test_a_declined_copy_is_not_eligible(): void
    {
        // Arrange
        $event = $this->baseEvent();
        $event['responseStatus'] = ['response' => 'declined', 'time' => '2026-10-19T16:24:00Z'];

        // Act and Assert
        $this->assertFalse((new OutlookMeetingEligibility)->isEligible($event));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function otherResponseProvider(): array
    {
        return [
            'tentativelyAccepted' => ['tentativelyAccepted'],
            'notResponded' => ['notResponded'],
            'none' => ['none'],
            'organizer' => ['organizer'],
            'accepted' => ['accepted'],
        ];
    }

    #[DataProvider('otherResponseProvider')]
    public function test_other_response_statuses_stay_eligible(string $response): void
    {
        // Arrange
        $event = $this->baseEvent();
        $event['responseStatus'] = ['response' => $response, 'time' => '2026-10-19T16:24:00Z'];

        // Act and Assert
        $this->assertTrue((new OutlookMeetingEligibility)->isEligible($event));
    }

    public function test_an_event_without_a_string_id_is_not_eligible(): void
    {
        // Arrange
        $eligibility = new OutlookMeetingEligibility;

        foreach ([null, 12, ['x']] as $id) {
            $event = $this->baseEvent();
            $event['id'] = $id;

            // Act and Assert
            $this->assertFalse($eligibility->isEligible($event));
        }

        $event = $this->baseEvent();
        unset($event['id']);
        $this->assertFalse($eligibility->isEligible($event));
    }
}
