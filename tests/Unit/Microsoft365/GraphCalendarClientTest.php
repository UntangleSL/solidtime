<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\GraphException;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncStatus;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\TestCase;

#[CoversClass(GraphCalendarClient::class)]
#[CoversClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(SyncStatus::class)]
class GraphCalendarClientTest extends TestCase
{
    private const string NEXT_1 = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=page-2';

    private const string NEXT_2 = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=page-3';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    /**
     * @param  array<int, string>  $ids
     * @return array<string, mixed>
     */
    private function page(array $ids, ?string $nextLink = null): array
    {
        $page = ['value' => array_map(fn (string $id): array => ['id' => $id], $ids)];
        if ($nextLink !== null) {
            $page['@odata.nextLink'] = $nextLink;
        }

        return $page;
    }

    /**
     * @param  Closure(?string): string|null  $token
     * @return array{events: list<array<string, mixed>>, complete: bool, failure: SyncStatus|null, retry_after: int|null}
     */
    private function calendarView(?Closure $token = null): array
    {
        return (new GraphCalendarClient)->calendarView(
            $token ?? fn (?string $rejected): string => 'tok',
            CarbonImmutable::parse('2026-10-19T00:00:00Z'),
            CarbonImmutable::parse('2026-10-26T00:00:00Z'),
        );
    }

    public function test_empty_page_with_next_link_is_followed(): void
    {
        // Arrange
        Http::fake([
            'https://graph.microsoft.com/*' => Http::sequence()
                ->push($this->page([], self::NEXT_1))
                ->push($this->page(['evt-1', 'evt-2'])),
        ]);

        // Act
        $result = $this->calendarView();

        // Assert
        Http::assertSentCount(2);
        $this->assertTrue($result['complete']);
        $this->assertNull($result['failure']);
        $this->assertSame(['evt-1', 'evt-2'], array_column($result['events'], 'id'));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function unsafeNextLinkProvider(): array
    {
        return [
            'foreign host' => ['https://evil.example.test/v1.0/me/calendarView?$skiptoken=x'],
            'http scheme' => ['http://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=x'],
            'userinfo trick' => ['https://graph.microsoft.com@evil.example.test/v1.0/me/calendarView'],
            'look-alike host' => ['https://graph.microsoft.com.evil.example.test/v1.0/me/calendarView'],
            'explicit port' => ['https://graph.microsoft.com:8443/v1.0/me/calendarView'],
        ];
    }

    #[DataProvider('unsafeNextLinkProvider')]
    public function test_foreign_or_http_next_link_is_never_requested(string $nextLink): void
    {
        // Arrange
        Http::fake([
            '*' => Http::sequence()->push($this->page(['evt-1'], $nextLink)),
        ]);

        // Act
        $result = $this->calendarView();

        // Assert: one request only, and it went to Graph itself with the bearer
        Http::assertSentCount(1);
        Http::assertSent(fn (Request $request): bool => parse_url($request->url(), PHP_URL_HOST) === 'graph.microsoft.com'
            && $request->hasHeader('Authorization', 'Bearer tok'));
        $this->assertFalse($result['complete']);
        $this->assertSame(SyncStatus::Unavailable, $result['failure']);
        $this->assertSame(['evt-1'], array_column($result['events'], 'id'));
    }

    public function test_page_cap_counts_as_partial(): void
    {
        // Arrange
        Config::set('microsoft365.graph.max_pages', 2);
        Http::fake([
            'https://graph.microsoft.com/*' => Http::sequence()
                ->push($this->page(['a'], self::NEXT_1))
                ->push($this->page(['b'], self::NEXT_2))
                ->push($this->page(['c'])),
        ]);

        // Act
        $result = $this->calendarView();

        // Assert
        Http::assertSentCount(2);
        $this->assertFalse($result['complete']);
        $this->assertNull($result['failure']);
        $this->assertSame(['a', 'b'], array_column($result['events'], 'id'));
    }

    public function test_token_closure_value_is_sent_on_every_page(): void
    {
        // Arrange
        Http::fake([
            'https://graph.microsoft.com/*' => Http::sequence()
                ->push($this->page(['a'], self::NEXT_1))
                ->push($this->page(['b'], self::NEXT_2))
                ->push($this->page(['c'])),
        ]);
        $calls = [];
        $token = function (?string $rejected) use (&$calls): string {
            $calls[] = $rejected;

            return 'token-'.count($calls);
        };

        // Act
        $result = $this->calendarView($token);

        // Assert
        $this->assertTrue($result['complete']);
        $this->assertSame([null, null, null], $calls);
        $authorization = [];
        foreach (Http::recorded() as [$request]) {
            $authorization[] = $request->header('Authorization')[0] ?? null;
        }
        $this->assertSame(['Bearer token-1', 'Bearer token-2', 'Bearer token-3'], $authorization);
    }

    public function test_every_page_carries_the_prefer_header(): void
    {
        // Arrange
        Http::fake([
            'https://graph.microsoft.com/*' => Http::sequence()
                ->push($this->page(['a'], self::NEXT_1))
                ->push($this->page(['b'])),
        ]);

        // Act
        $this->calendarView();

        // Assert
        $this->assertCount(2, Http::recorded());
        foreach (Http::recorded() as [$request]) {
            $this->assertSame([GraphCalendarClient::PREFER], $request->header('Prefer'));
        }
    }

    public function test_a_failing_token_closure_ends_the_traversal_as_a_failure(): void
    {
        // Arrange
        Http::fake();
        $token = function (?string $rejected): string {
            throw new GraphException(SyncStatus::Reconnect);
        };

        // Act
        $result = $this->calendarView($token);

        // Assert
        Http::assertNothingSent();
        $this->assertFalse($result['complete']);
        $this->assertSame(SyncStatus::Reconnect, $result['failure']);
    }

    public function test_parse_graph_utc(): void
    {
        // Act
        $utc = OutlookMeetingSyncService::parseGraphUtc(['dateTime' => '2026-10-27T13:00:00.0000000', 'timeZone' => 'UTC']);
        $foreign = OutlookMeetingSyncService::parseGraphUtc(['dateTime' => '2026-10-27T13:00:00.0000000', 'timeZone' => 'W. Europe Standard Time']);

        // Assert
        $this->assertNotNull($utc);
        $this->assertSame('2026-10-27 13:00:00', $utc->format('Y-m-d H:i:s'));
        $this->assertSame('UTC', $utc->getTimezone()->getName());
        $this->assertNull($foreign);
    }
}
