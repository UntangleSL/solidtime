<?php

declare(strict_types=1);

namespace Tests\Unit\M365;

use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversNothing;
use Tests\TestCase;

/**
 * Replays the sanitized Microsoft Graph fixtures recorded in phase 1 (tests/Fixtures/M365).
 * Later phases copy this pattern to fake the Graph calendarView endpoint without a network.
 * Every file name comes from manifest.json, never from a directory listing: page-10 sorts
 * before page-2, so a sorted listing would replay the pages out of order.
 */
#[CoversNothing]
class CalendarViewFixturesTest extends TestCase
{
    protected bool $mockBillingContract = false;

    /**
     * @return array<string, mixed>
     */
    private function fixture(string $path): array
    {
        $json = file_get_contents(base_path('tests/Fixtures/M365/'.$path));
        $this->assertNotFalse($json, 'Fixture file not readable: '.$path);

        $data = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertIsArray($data, 'Fixture is not a JSON object or list: '.$path);

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    private function manifest(): array
    {
        return $this->fixture('manifest.json');
    }

    /**
     * Every fixture file a scenario lists (both rounds, plus the Round B lookup file).
     *
     * @param  array<string, mixed>  $scenario
     * @return array<int, string>
     */
    private function scenarioFiles(array $scenario): array
    {
        $files = [];
        foreach (['round_a', 'round_b'] as $round) {
            foreach ($scenario[$round]['files'] ?? [] as $file) {
                $files[] = $file;
            }
        }
        $lookup = $scenario['round_b']['lookup']['file'] ?? null;
        if (is_string($lookup)) {
            $files[] = $lookup;
        }

        return $files;
    }

    /**
     * Every event-like object (anything with an id) in a decoded fixture: a scenario file
     * (`value` list), a lookup file (list of results with a `body`) or a series file.
     *
     * @param  array<mixed>  $node
     * @return array<int, array<string, mixed>>
     */
    private function eventsIn(array $node): array
    {
        $events = [];
        if (isset($node['id']) && is_string($node['id'])) {
            $events[] = $node;
        }
        foreach ($node as $child) {
            if (is_array($child)) {
                array_push($events, ...$this->eventsIn($child));
            }
        }

        return $events;
    }

    public function test_calendarview_pages_replay_through_http_fake_following_next_link(): void
    {
        // Arrange
        $manifest = $this->manifest();
        $pass = $manifest['files']['calendarview']['A']['prod-select'];
        $this->assertTrue($pass['complete'], 'The Round A prod-select pass must be complete');
        $pageFiles = $pass['pages'];
        $this->assertNotEmpty($pageFiles);
        $pages = array_map(fn (string $file): array => $this->fixture($file), $pageFiles);
        $expectedIdsPerPage = array_map(
            fn (array $page): array => array_column($page['value'], 'id'),
            $pages
        );
        $expectedTotal = array_sum(array_map(fn (array $page): int => count($page['value']), $pages));
        $sequence = Http::sequence();
        foreach ($pages as $page) {
            $sequence->push($page);
        }
        Http::fake([
            'https://graph.microsoft.com/v1.0/me/calendarView*' => $sequence,
        ]);

        // Act
        $idsPerPage = [];
        $url = 'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime='.
            urlencode((string) $manifest['window']['start']).
            '&endDateTime='.urlencode((string) $manifest['window']['end']);
        do {
            $body = Http::get($url)->json();
            $idsPerPage[] = array_column($body['value'], 'id');
            $url = $body['@odata.nextLink'] ?? null;
        } while ($url !== null && count($idsPerPage) <= count($pages));

        // Assert
        $this->assertSame($expectedIdsPerPage, $idsPerPage);
        $this->assertSame($expectedTotal, count(array_merge(...$idsPerPage)));
        Http::assertSentCount(count($pages));
    }

    public function test_every_manifest_scenario_file_loads_with_sanitized_ids(): void
    {
        // Arrange
        $scenarios = $this->manifest()['scenarios'];
        $this->assertNotEmpty($scenarios);

        // Act
        $checked = 0;
        $unsanitized = [];
        foreach ($scenarios as $name => $scenario) {
            if ($scenario['synthetic'] === true) {
                continue;
            }
            foreach ($this->scenarioFiles($scenario) as $file) {
                $events = $this->eventsIn($this->fixture($file));
                foreach ($events as $event) {
                    $checked++;
                    foreach (['id', 'seriesMasterId'] as $key) {
                        $value = $event[$key] ?? null;
                        if (is_string($value) && ! str_starts_with($value, 'FAKE')) {
                            $unsanitized[] = $name.' '.$file.' '.$key;
                        }
                    }
                }
            }
        }

        // Assert
        $this->assertGreaterThan(0, $checked);
        $this->assertSame([], $unsanitized);
    }

    public function test_synthetic_scenarios_are_flagged(): void
    {
        // Arrange
        $manifest = $this->manifest();
        $replayed = $manifest['files']['calendarview']['A']['prod-select']['pages'];

        // Act
        $synthetic = array_filter(
            $manifest['scenarios'],
            fn (array $scenario): bool => $scenario['synthetic'] === true
        );

        // Assert
        $this->assertNotEmpty($synthetic);
        foreach ($synthetic as $name => $scenario) {
            $this->assertStringStartsWith('SYN-', $name);
            foreach ($this->scenarioFiles($scenario) as $file) {
                $this->assertStringStartsWith('scenarios/SYN-', $file);
                $this->assertNotContains($file, $replayed, 'Synthetic fixtures are never replayed');
            }
        }
        foreach ($manifest['scenarios'] as $name => $scenario) {
            if (str_starts_with($name, 'SYN-')) {
                $this->assertTrue($scenario['synthetic']);
            }
        }
    }
}
