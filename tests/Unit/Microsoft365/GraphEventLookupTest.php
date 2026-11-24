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
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
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

    public function test_rejected_token_is_refreshed_once_and_the_lookup_retried(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::sequence()
            ->push(['error' => ['code' => 'InvalidAuthenticationToken']], 401)
            ->push($this->eventBody())]);
        $calls = [];
        $token = function (?string $rejected) use (&$calls): string {
            $calls[] = $rejected;

            return $rejected === null ? 'tok-1' : 'tok-2';
        };

        // Act
        $result = $this->lookup($token);

        // Assert
        $this->assertSame([null, 'tok-1'], $calls);
        Http::assertSentCount(2);
        Http::assertSent(fn (Request $request): bool => $request->hasHeader('Authorization', 'Bearer tok-2'));
        $this->assertSame(EventLookupStatus::Present, $result->status);
    }

    /**
     * @return array<string, array{0: int}>
     */
    public static function rejectedStatusProvider(): array
    {
        return [
            '401 twice' => [401],
            '403 twice' => [403],
        ];
    }

    #[DataProvider('rejectedStatusProvider')]
    public function test_second_rejection_is_reconnect_without_a_third_request(int $status): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::sequence()
            ->push([], $status)
            ->push([], $status)
            ->push($this->eventBody())]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(2);
        $this->assertSame(EventLookupStatus::Reconnect, $result->status);
        $this->assertSame($status, $result->httpStatus);
    }

    public function test_429_is_throttled_with_retry_after_and_no_retry(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::sequence()
            ->push([], 429, ['Retry-After' => '120'])
            ->push($this->eventBody())]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Throttled, $result->status);
        $this->assertSame(120, $result->retryAfter);
        $this->assertSame(429, $result->httpStatus);
    }

    public function test_429_retry_after_is_clamped(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response([], 429, ['Retry-After' => '99999'])]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Throttled, $result->status);
        $this->assertSame(RetryAfter::MAX_SECONDS, $result->retryAfter);
    }

    public function test_503_with_retry_after_is_throttled(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response([], 503, ['Retry-After' => '7'])]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Throttled, $result->status);
        $this->assertSame(7, $result->retryAfter);
        $this->assertSame(503, $result->httpStatus);
    }

    /**
     * @return array<string, array{0: int, 1: array<string, mixed>}>
     */
    public static function unknownAnswerProvider(): array
    {
        return [
            '503 without Retry-After' => [503, []],
            '504 without Retry-After' => [504, []],
            '500' => [500, ['error' => ['code' => 'ErrorInternalServerError']]],
            '404 MailboxNotEnabledForRESTAPI' => [404, ['error' => ['code' => 'MailboxNotEnabledForRESTAPI']]],
            '404 MailboxNotSupportedForRESTAPI' => [404, ['error' => ['code' => 'MailboxNotSupportedForRESTAPI']]],
            '404 without error code' => [404, []],
            '404 other code' => [404, ['error' => ['code' => 'ResourceNotFound']]],
            '400' => [400, ['error' => ['code' => 'ErrorInvalidIdMalformed']]],
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    #[DataProvider('unknownAnswerProvider')]
    public function test_graph_error_is_unknown_never_removed(int $status, array $body): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::sequence()
            ->push($body, $status)
            ->push($this->eventBody())]);

        // Act
        $result = $this->lookup();

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
        $this->assertSame($status, $result->httpStatus);
        $this->assertNull($result->retryAfter);
    }

    public function test_connection_failure_is_unknown(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => function (): never {
            throw new ConnectionException('timed out');
        }]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
        $this->assertNull($result->httpStatus);
    }

    public function test_throttled_token_endpoint_is_throttled_without_a_graph_request(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody())]);
        $token = function (?string $rejected): string {
            throw new GraphException(SyncStatus::Throttled, 45);
        };

        // Act
        $result = $this->lookup($token);

        // Assert
        Http::assertNothingSent();
        $this->assertSame(EventLookupStatus::Throttled, $result->status);
        $this->assertSame(45, $result->retryAfter);
    }

    public function test_reconnect_from_token_closure_is_reconnect_without_a_graph_request(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody())]);
        $token = function (?string $rejected): string {
            throw new GraphException(SyncStatus::Reconnect);
        };

        // Act
        $result = $this->lookup($token);

        // Assert
        Http::assertNothingSent();
        $this->assertSame(EventLookupStatus::Reconnect, $result->status);
    }

    public function test_reconnect_from_forced_refresh_is_reconnect_after_one_request(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::sequence()
            ->push([], 401)
            ->push($this->eventBody())]);
        $token = function (?string $rejected): string {
            if ($rejected !== null) {
                throw new GraphException(SyncStatus::Reconnect);
            }

            return 'tok';
        };

        // Act
        $result = $this->lookup($token);

        // Assert
        Http::assertSentCount(1);
        $this->assertSame(EventLookupStatus::Reconnect, $result->status);
    }

    public function test_unavailable_token_endpoint_is_unknown(): void
    {
        // Arrange
        Http::fake(['https://graph.microsoft.com/*' => Http::response($this->eventBody())]);
        $token = function (?string $rejected): string {
            throw new GraphException(SyncStatus::Unavailable);
        };

        // Act
        $result = $this->lookup($token);

        // Assert
        Http::assertNothingSent();
        $this->assertSame(EventLookupStatus::Unknown, $result->status);
    }

    public function test_out_of_sync_config_has_the_phase_constants(): void
    {
        // Assert
        $this->assertSame(5, config('microsoft365.out_of_sync.lookups_per_sync'));
        $this->assertSame(300, config('microsoft365.out_of_sync.lookups_per_job'));
        $this->assertSame(10, config('microsoft365.out_of_sync.dispatch_stagger_seconds'));
        $this->assertSame('05:30', config('microsoft365.out_of_sync.daily_at'));
        $this->assertSame('Europe/Madrid', config('microsoft365.out_of_sync.daily_timezone'));
        $this->assertSame(30, config('microsoft365.out_of_sync.lock_seconds'));
        $this->assertSame(7, config('microsoft365.out_of_sync.auto_adjusted_days'));
    }

    public function test_invalid_timeout_config_falls_back_and_keeps_the_answer(): void
    {
        // Arrange
        Config::set('microsoft365.graph.connect_timeout', 'not-an-int');
        Config::set('microsoft365.graph.timeout', 0);
        Http::fake(['https://graph.microsoft.com/*' => $this->fixtureResponse('S5')]);

        // Act
        $result = $this->lookup();

        // Assert
        $this->assertSame(EventLookupStatus::Present, $result->status);
    }
}
