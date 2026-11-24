<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Graph\EventLookup;
use App\Microsoft365\Graph\EventLookupStatus;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\GraphException;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\RetryAfter;
use App\Microsoft365\Graph\SyncStatus;
use Closure;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCase;

#[CoversClass(GraphCalendarClient::class)]
#[CoversClass(EventLookup::class)]
#[UsesClass(EventLookupStatus::class)]
#[UsesClass(RetryAfter::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
class GraphEventLookupTest extends TestCase
{
    private const string GRAPH_ID = 'AAMkAGI2=abc/def+ghi';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    /**
     * Turns the captured Phase 1 lookup answer of a scenario into a fake Graph response. S4 was captured
     * without a body, so its Graph error body is rebuilt from the recorded error code.
     */
    private function fixtureResponse(string $scenario): PromiseInterface
    {
        $json = file_get_contents(base_path('tests/Fixtures/M365/lookups/'.$scenario.'.roundB.json'));
        $this->assertIsString($json);
        $entries = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertIsArray($entries);
        $entry = $entries[0];
        $this->assertIsArray($entry);
        $this->assertIsInt($entry['status']);

        $body = $entry['body'] ?? null;
        if ($body === null) {
            $body = ['error' => ['code' => $entry['errorCode']]];
        }
        $this->assertIsArray($body);

        return Http::response($body, $entry['status']);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function eventBody(array $overrides = []): array
    {
        return array_merge([
            'id' => 'evt-1',
            'type' => 'singleInstance',
            'seriesMasterId' => null,
            'start' => ['dateTime' => '2026-10-30T10:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-10-30T10:30:00.0000000', 'timeZone' => 'UTC'],
            'isCancelled' => false,
            'isAllDay' => false,
        ], $overrides);
    }

    /**
     * @param  Closure(?string): string|null  $token
     */
    private function lookup(?Closure $token = null, string $graphId = self::GRAPH_ID): EventLookup
    {
        return (new GraphCalendarClient)->event($token ?? fn (?string $rejected): string => 'tok', $graphId);
    }

    public function test_s5_moved_occurrence_is_present_at_its_new_utc_time(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => $this->fixtureResponse('S5')]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Present, $result->status);
        $this->assertNotNull($result->start);
        $this->assertNotNull($result->end);
        $this->assertSame('2026-10-30 10:00:00', $result->start->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-30 10:30:00', $result->end->format('Y-m-d H:i:s'));
        $this->assertSame('UTC', $result->start->getTimezone()->getName());
        $this->assertFalse($result->allDay);
        $this->assertNull($result->retryAfter);
        $this->assertSame(200, $result->httpStatus);
    }

    public function test_s5b_occurrence_moved_out_of_the_window_is_present_not_removed(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => $this->fixtureResponse('S5b')]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Present, $result->status);
        $this->assertNotNull($result->start);
        $this->assertNotNull($result->end);
        $this->assertSame('2026-12-09 11:00:00', $result->start->format('Y-m-d H:i:s'));
        $this->assertSame('2026-12-09 11:30:00', $result->end->format('Y-m-d H:i:s'));
    }

    public function test_s3_cancelled_occurrence_is_cancelled(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => $this->fixtureResponse('S3')]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Cancelled, $result->status);
        $this->assertSame(200, $result->httpStatus);
    }

    public function test_s4_item_not_found_is_removed(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => $this->fixtureResponse('S4')]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Removed, $result->status);
        $this->assertNull($result->start);
        $this->assertNull($result->end);
        $this->assertSame(404, $result->httpStatus);
    }

    public function test_request_carries_prefer_header_bearer_select_and_encoded_id(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody())]);

        // Act
        $this->lookup(null, 'AAMk/abc=def+g');

        // Assert
        Http::assertSentCount(1);
        Http::assertSent(fn (Request $request): bool => $request->method() === 'GET'
            && str_starts_with($request->url(), 'https://graph.microsoft.com/v1.0/me/events/AAMk%2Fabc%3Ddef%2Bg?')
            && str_contains($request->url(), '$select=id,start,end,isCancelled,isAllDay,type,seriesMasterId')
            && $request->hasHeader('Prefer', GraphCalendarClient::PREFER)
            && $request->hasHeader('Authorization', 'Bearer tok'));
    }

    public function test_all_day_occurrence_is_present_with_all_day(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody([
            'isAllDay' => true,
            'start' => ['dateTime' => '2026-10-30T00:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-10-31T00:00:00.0000000', 'timeZone' => 'UTC'],
        ]))]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Present, $result->status);
        $this->assertTrue($result->allDay);
    }

    public function test_non_utc_time_is_unknown(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody([
            'start' => ['dateTime' => '2026-10-30T10:00:00.0000000', 'timeZone' => 'Pacific Standard Time'],
        ]))]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
        $this->assertNull($result->start);
    }

    public function test_missing_time_is_unknown(): void
    {
        // Arrange
        $body = $this->eventBody();
        unset($body['end']);
        Http::fake(['https://graph.microsoft.com/*' => Http::response($body)]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
    }

    public function test_non_array_body_is_unknown(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response('not json', 200)]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
        $this->assertSame(200, $result->httpStatus);
    }
}
