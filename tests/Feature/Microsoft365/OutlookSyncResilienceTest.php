<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\GraphException;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\RetryAfter;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use App\Models\User;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

#[CoversClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(RetryAfter::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphException::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookSyncResilienceTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string GRAPH_URL = 'https://graph.microsoft.com/v1.0/me/calendarView*';

    private const string NEXT_LINK = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next';

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    /**
     * A user with a connected account, signed in, with the integration configured.
     */
    private function connectedUser(): User
    {
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);

        return $user;
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function postSync(array $extra = []): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.sync', [], false), array_merge($this->fixtureWindow(), $extra));
    }

    private function getMeetings(): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', $this->fixtureWindow(), false));
    }

    /**
     * One Http::fake for the Graph calendarView endpoint that answers in the given order: a round name
     * replays that recorded round, an array is one page body, a promise is one prebuilt answer.
     * A second Http::fake does not override an earlier one, so a test scripts everything up front.
     *
     * @param  list<string|array<string, mixed>|PromiseInterface>  $script
     */
    private function scriptGraph(array $script): void
    {
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        foreach ($script as $item) {
            if (is_string($item)) {
                foreach ($this->graphPages($item) as $page) {
                    $sequence->push($page);
                }
            } elseif ($item instanceof PromiseInterface) {
                $sequence->pushResponse($item);
            } else {
                $sequence->push($item);
            }
        }
        Http::fake([self::GRAPH_URL => $sequence]);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function graphError(int $status, array $headers = [], string $code = 'TooManyRequests'): PromiseInterface
    {
        return Http::response(['error' => ['code' => $code]], $status, $headers);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function graphEvent(string $id, string $start = '2026-10-21T08:00:00', string $end = '2026-10-21T09:00:00', array $overrides = []): array
    {
        return array_merge([
            'id' => $id,
            'iCalUId' => 'ical-'.$id,
            'subject' => 'Subject '.$id,
            'start' => ['dateTime' => $start.'.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => $end.'.0000000', 'timeZone' => 'UTC'],
            'isAllDay' => false,
            'isCancelled' => false,
            'isOrganizer' => false,
            'responseStatus' => ['response' => 'accepted', 'time' => '0001-01-01T00:00:00Z'],
            'type' => 'singleInstance',
            'seriesMasterId' => null,
            'originalStart' => null,
            'organizer' => ['emailAddress' => ['name' => 'Org Name', 'address' => 'org@example.test']],
            'showAs' => 'busy',
            'sensitivity' => 'normal',
            'webLink' => 'https://outlook.example.test/'.$id,
            'isOnlineMeeting' => false,
        ], $overrides);
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, mixed>
     */
    private function page(array $events, bool $hasNext = false): array
    {
        $page = ['value' => $events];
        if ($hasNext) {
            $page['@odata.nextLink'] = self::NEXT_LINK;
        }

        return $page;
    }

    private function cachedMeeting(User $user, string $graphId): OutlookMeeting
    {
        return OutlookMeeting::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => '2026-10-22 08:00:00',
            'ends_at' => '2026-10-22 09:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => false,
            'web_link' => 'https://outlook.example.test/'.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ]);
    }

    private function account(User $user): MicrosoftAccount
    {
        return MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->firstOrFail();
    }

    private function meetingByGraphId(string $graphId): OutlookMeeting
    {
        return OutlookMeeting::query()->where('graph_id', '=', $graphId)->firstOrFail();
    }

    /**
     * The Graph id of a recorded event, found by its test tag, e.g. "S3", in round A.
     */
    private function recordedGraphId(string $tag, string $startPrefix = ''): string
    {
        foreach ($this->graphPages('A') as $page) {
            foreach ($page['value'] as $event) {
                $subject = (string) ($event['subject'] ?? '');
                $start = (string) ($event['start']['dateTime'] ?? '');
                if (str_contains($subject, '[M365-TEST '.$tag.']') && str_starts_with($start, $startPrefix)) {
                    return (string) $event['id'];
                }
            }
        }
        $this->fail('Recorded event not found: '.$tag);
    }

    /**
     * @return list<LogEntry>
     */
    private function degradedLogs(): array
    {
        return Log::allLogs()
            ->filter(fn (LogEntry $log): bool => $log->message === 'Outlook sync degraded')
            ->values()
            ->all();
    }

    // Task 1: back-off

    public function test_throttled_graph_persists_backoff_and_keeps_cache(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph(['A', $this->graphError(429, ['Retry-After' => '10'])]);
        $this->postSync()->assertOk()->assertJsonPath('status', 'ok');
        $this->travel(61)->seconds();

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk();
        $response->assertJsonPath('status', 'throttled');
        $response->assertJsonPath('retry_after', 10);
        $until = $this->account($user)->graph_backoff_until;
        $this->assertNotNull($until);
        $this->assertEqualsWithDelta(Carbon::now()->addSeconds(10)->getTimestamp(), $until->getTimestamp(), 1);
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookMeeting::query()->whereNotNull('gone_at')->count());
    }

    /**
     * @return array<string, array{0: int}>
     */
    public static function throttlingStatusProvider(): array
    {
        return ['429' => [429], '503 with Retry-After' => [503], '504 with Retry-After' => [504]];
    }

    #[DataProvider('throttlingStatusProvider')]
    public function test_throttling_statuses_with_retry_after_are_a_backoff(int $status): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph([$this->graphError($status, ['Retry-After' => '17'])]);

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk()->assertJsonPath('status', 'throttled')->assertJsonPath('retry_after', 17);
        $this->assertNotNull($this->account($user)->graph_backoff_until);
        $logs = $this->degradedLogs();
        $this->assertCount(1, $logs);
        $this->assertSame(['status' => 'throttled', 'http_status' => $status], $logs[0]->context);
        $this->assertSame(0, OutlookSyncWindow::query()->count());
    }

    public function test_sync_during_backoff_sends_no_request(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph([$this->graphError(429, ['Retry-After' => '10'])]);
        $this->postSync()->assertJsonPath('status', 'throttled');
        $this->travel(3)->seconds();
        $sentBefore = count(Http::recorded());

        // Act
        $response = $this->postSync(['force' => true]);

        // Assert
        $response->assertOk()->assertJsonPath('status', 'throttled');
        $retryAfter = $response->json('retry_after');
        $this->assertIsInt($retryAfter);
        $this->assertGreaterThanOrEqual(1, $retryAfter);
        $this->assertLessThanOrEqual(10, $retryAfter);
        Http::assertSentCount($sentBefore);
    }

    public function test_read_endpoint_serves_cache_and_retry_after_during_backoff(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', $this->graphError(429, ['Retry-After' => '10']), 'A']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $this->travel(61)->seconds();
        $this->postSync()->assertJsonPath('status', 'throttled');
        $this->travel(2)->seconds();

        // Act
        $during = $this->getMeetings();
        $this->travel(9)->seconds();
        $after = $this->getMeetings();
        $sync = $this->postSync();

        // Assert
        $during->assertOk()->assertJsonCount(12, 'data');
        $retryAfter = $during->json('sync.retry_after');
        $this->assertIsInt($retryAfter);
        $this->assertGreaterThan(0, $retryAfter);
        $after->assertOk()->assertJsonCount(12, 'data');
        $this->assertNull($after->json('sync.retry_after'));
        $sync->assertJsonPath('status', 'ok');
    }

    public function test_read_endpoint_has_a_null_retry_after_without_backoff(): void
    {
        // Arrange
        $this->connectedUser();
        Http::fake();

        // Act
        $response = $this->getMeetings();

        // Assert
        $response->assertOk();
        $this->assertArrayHasKey('retry_after', $response->json('sync'));
        $this->assertNull($response->json('sync.retry_after'));
    }

    public function test_token_endpoint_429_is_a_backoff(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user, expired: true);
        $this->actingAs($user);
        Http::fake([
            'https://login.microsoftonline.com/*/oauth2/v2.0/token' => Http::response(['error' => 'temporarily_unavailable'], 429, ['Retry-After' => '20']),
            self::GRAPH_URL => Http::response(['error' => ['code' => 'unexpected_graph_request']], 500),
        ]);

        // Act
        $first = $this->postSync();
        $second = $this->postSync(['force' => true]);

        // Assert
        $first->assertOk()->assertJsonPath('status', 'throttled')->assertJsonPath('retry_after', 20);
        $second->assertOk()->assertJsonPath('status', 'throttled');
        $fresh = $this->account($user);
        $this->assertNotNull($fresh->graph_backoff_until);
        $this->assertSame('rt-marker-9d1e', $fresh->refresh_token);
        $this->assertNull($fresh->reconnect_required_at);
        $this->assertSame($account->getKey(), $fresh->getKey());
        // One token request, no Graph request: the second sync waited without any HTTP
        Http::assertSentCount(1);
        $logs = $this->degradedLogs();
        $this->assertSame(['status' => 'throttled', 'http_status' => 429], $logs[0]->context);
    }

    // Task 2: reuse window, minimum interval, lock, route throttle

    public function test_two_auto_syncs_inside_reuse_window_traverse_once(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', 'A']);
        $first = $this->postSync();
        $this->travel(30)->seconds();

        // Act
        $second = $this->postSync();

        // Assert
        $first->assertJsonPath('status', 'ok');
        $second->assertOk()->assertJsonPath('status', 'reused');
        $this->assertNotNull($first->json('last_synced_at'));
        $second->assertJsonPath('last_synced_at', $first->json('last_synced_at'));
        Http::assertSentCount(22);
    }

    public function test_auto_sync_after_reuse_window_traverses_again(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', 'A']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $this->travel(61)->seconds();

        // Act
        $second = $this->postSync();

        // Assert
        $second->assertOk()->assertJsonPath('status', 'ok');
        Http::assertSentCount(44);
    }

    public function test_forced_sync_bypasses_reuse_but_not_min_interval(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', 'A']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $this->travel(5)->seconds();

        // Act
        $tooSoon = $this->postSync(['force' => true]);
        $sentAfterTooSoon = count(Http::recorded());
        $this->travel(6)->seconds();
        $auto = $this->postSync();
        $forced = $this->postSync(['force' => true]);

        // Assert
        $tooSoon->assertOk()->assertJsonPath('status', 'reused');
        $this->assertSame(22, $sentAfterTooSoon);
        // 11 s later an automatic sync is still inside the 60 s window, a forced one is not
        $auto->assertOk()->assertJsonPath('status', 'reused');
        $forced->assertOk()->assertJsonPath('status', 'ok');
        Http::assertSentCount(44);
    }

    public function test_held_lock_answers_coalesced_without_graph(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph(['A']);
        $lock = Cache::lock('m365:meetings-sync:'.$user->getKey(), 20);
        $this->assertTrue($lock->get());

        // Act
        $coalesced = $this->postSync();
        $lock->release();
        $first = $this->postSync();
        $reused = $this->postSync();

        // Assert
        $coalesced->assertOk()->assertJsonPath('status', 'coalesced')->assertJsonPath('last_synced_at', null);
        $first->assertOk()->assertJsonPath('status', 'ok');
        $reused->assertOk()->assertJsonPath('status', 'reused');
        Http::assertSentCount(22);
    }

    public function test_coalesced_answer_carries_the_last_synced_at_of_the_window(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph(['A']);
        $first = $this->postSync();
        $this->travel(61)->seconds();
        $lock = Cache::lock('m365:meetings-sync:'.$user->getKey(), 20);
        $this->assertTrue($lock->get());

        // Act
        $coalesced = $this->postSync();

        // Assert
        $coalesced->assertOk()->assertJsonPath('status', 'coalesced');
        $coalesced->assertJsonPath('last_synced_at', $first->json('last_synced_at'));
        Http::assertSentCount(22);
    }

    public function test_lock_is_released_after_a_failed_sync(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph([$this->graphError(500, [], 'boom')]);

        // Act
        $response = $this->postSync();
        $lock = Cache::lock('m365:meetings-sync:'.$user->getKey(), 20);
        $acquired = $lock->get();

        // Assert
        $response->assertOk()->assertJsonPath('status', 'unavailable');
        $this->assertTrue($acquired);
        $lock->release();
    }

    public function test_route_throttle_is_per_user(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $other = $this->createUser();
        Http::fake();
        $this->actingAs($user);

        // Act: reads have their own counter, so they never eat the sync budget
        for ($read = 0; $read < 5; $read++) {
            $this->getMeetings()->assertOk();
        }
        $statuses = [];
        for ($attempt = 0; $attempt < 13; $attempt++) {
            $statuses[] = $this->postSync()->getStatusCode();
        }
        $this->actingAs($other);
        $otherStatus = $this->postSync()->getStatusCode();

        // Assert
        $this->assertSame(array_fill(0, 12, 200), array_slice($statuses, 0, 12));
        $this->assertSame(429, $statuses[12]);
        $this->assertSame(200, $otherStatus);
        Http::assertNothingSent();
    }

    public function test_force_must_be_boolean(): void
    {
        // Arrange
        $this->connectedUser();
        Http::fake();

        // Act
        $maybe = $this->postSync(['force' => 'maybe']);
        $listed = $this->postSync(['force' => ['x']]);

        // Assert
        $maybe->assertStatus(422);
        $maybe->assertJsonValidationErrors(['force']);
        $listed->assertStatus(422);
        Http::assertNothingSent();
    }

    // Task 3: reconcile, scrub, partial traversals, outages

    public function test_round_a_then_round_b_reconciles_moves_cancellations_and_removals(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->scriptGraph(['A', 'B']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $roundAIds = $this->getMeetings()->collect('data')->pluck('id', 'start');
        $s5Id = $this->meetingByGraphId($this->recordedGraphId('S5'))->id;
        $s2ExceptionId = $this->meetingByGraphId($this->recordedGraphId('S2', '2026-11-03'))->id;
        $this->travel(61)->seconds();

        // Act
        $this->postSync()->assertJsonPath('status', 'ok');
        $read = $this->getMeetings();

        // Assert
        $this->assertCount(12, $roundAIds);
        $read->assertOk()->assertJsonCount(9, 'data');
        // Rows are never deleted, only marked
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $gone = OutlookMeeting::query()->whereNotNull('gone_at')->pluck('graph_id')->all();
        sort($gone, SORT_STRING);
        $expected = [
            $this->recordedGraphId('S3'),
            $this->recordedGraphId('S4'),
            $this->recordedGraphId('S5b'),
        ];
        sort($expected, SORT_STRING);
        $this->assertSame($expected, $gone);
        $starts = $read->collect('data')->pluck('id', 'start');
        $this->assertSame($s5Id, $starts['2026-10-30T10:00:00Z']);
        $this->assertSame($s2ExceptionId, $starts['2026-11-03T10:00:00Z']);
        $this->assertSame('2026-10-30 10:00:00', $this->meetingByGraphId($this->recordedGraphId('S5'))->starts_at->format('Y-m-d H:i:s'));
    }

    public function test_cancelled_row_is_scrubbed(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', 'B']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $s3 = $this->meetingByGraphId($this->recordedGraphId('S3'));
        $this->assertNotNull($s3->subject);
        $this->assertNotNull($s3->web_link);
        $this->travel(61)->seconds();

        // Act
        $this->postSync()->assertJsonPath('status', 'ok');

        // Assert
        $s3 = $this->meetingByGraphId($this->recordedGraphId('S3'));
        $this->assertNotNull($s3->gone_at);
        $this->assertNull($s3->subject);
        $this->assertNull($s3->organizer_name);
        $this->assertNull($s3->web_link);
        // The title of the cancelled meeting ("Canceled: ...") is never written either
        $this->assertSame(0, OutlookMeeting::query()->where('subject', 'like', '%Canceled%')->count());
    }

    public function test_meeting_that_turns_private_is_scrubbed_even_on_partial_traversal(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $s1Id = $this->recordedGraphId('S1');
        $s1Event = null;
        foreach ($this->graphPages('A') as $page) {
            foreach ($page['value'] as $event) {
                if ($event['id'] === $s1Id) {
                    $s1Event = $event;
                }
            }
        }
        $this->assertIsArray($s1Event);
        $s1Event['sensitivity'] = 'private';
        $this->scriptGraph(['A', $this->page([$s1Event], hasNext: true), $this->graphError(500, [], 'boom')]);
        $this->postSync()->assertJsonPath('status', 'ok');
        $this->assertNotNull($this->meetingByGraphId($s1Id)->subject);
        $this->travel(61)->seconds();

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk()->assertJsonPath('status', 'unavailable');
        $row = $this->meetingByGraphId($s1Id);
        $this->assertNotNull($row->gone_at);
        $this->assertNull($row->subject);
        $this->assertNull($row->organizer_name);
        $this->assertNull($row->web_link);
        $this->assertSame(1, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->whereNotNull('gone_at')->count());
        $this->getMeetings()->assertJsonCount(11, 'data');
    }

    public function test_dismissal_survives_resync(): void
    {
        // Arrange
        $this->connectedUser();
        $this->scriptGraph(['A', 'A']);
        $this->postSync()->assertJsonPath('status', 'ok');
        $s1 = $this->meetingByGraphId($this->recordedGraphId('S1'));
        $s1->dismissed_at = Carbon::parse('2026-10-25 12:00:00');
        $s1->save();
        $this->travel(61)->seconds();

        // Act
        $this->postSync()->assertJsonPath('status', 'ok');

        // Assert
        $fresh = $this->meetingByGraphId($this->recordedGraphId('S1'));
        $this->assertNotNull($fresh->dismissed_at);
        $this->assertSame('2026-10-25 12:00:00', $fresh->dismissed_at->format('Y-m-d H:i:s'));
        $this->assertNull($fresh->gone_at);
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: bool, 3: int}>
     */
    public static function partialTraversalProvider(): array
    {
        return [
            'server error on page 3' => ['server_error', 'unavailable', false, 3],
            'connection failure on page 3' => ['connection', 'unavailable', false, 3],
            'page cap' => ['page_cap', 'ok', true, 2],
            'deadline after page 1' => ['deadline', 'ok', true, 1],
        ];
    }

    #[DataProvider('partialTraversalProvider')]
    public function test_partial_traversals_never_mark_gone(string $case, string $status, bool $truncated, int $requests): void
    {
        // Arrange
        $user = $this->connectedUser();
        $stale = $this->cachedMeeting($user, 'stale-1');
        $first = $this->page([$this->graphEvent('seen-1')], hasNext: true);
        $second = $this->page([$this->graphEvent('seen-2')], hasNext: true);
        switch ($case) {
            case 'server_error':
                $this->scriptGraph([$first, $second, $this->graphError(500, [], 'boom')]);
                break;
            case 'connection':
                Http::fake([self::GRAPH_URL => Http::sequence()->push($first)->push($second)->pushFailedConnection()]);
                break;
            case 'page_cap':
                Http::fake([self::GRAPH_URL => Http::sequence()->push($first)->push($second)->push($this->page([$this->graphEvent('seen-3')]))]);
                Config::set('microsoft365.graph.max_pages', 2);
                break;
            default:
                // The clock passes the 15 s deadline while page 1 is answered
                Http::fake([self::GRAPH_URL => function () use ($first) {
                    $this->travel(20)->seconds();

                    return Http::response($first);
                }]);
        }

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk()->assertJsonPath('status', $status)->assertJsonPath('truncated', $truncated);
        Http::assertSentCount($requests);
        $this->assertNull($this->meetingByGraphId($stale->graph_id)->gone_at);
        $this->assertSame(0, OutlookMeeting::query()->whereNotNull('gone_at')->count());
        $this->assertSame('Subject stale-1', $this->meetingByGraphId($stale->graph_id)->subject);
        $this->assertSame(1, OutlookMeeting::query()->where('graph_id', '=', 'seen-1')->count());
        // A failed traversal records no window, a truncated one does
        $this->assertSame($status === 'ok' ? 1 : 0, OutlookSyncWindow::query()->count());
    }

    public function test_complete_traversal_marks_only_unseen_rows_inside_the_window(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $unseen = $this->cachedMeeting($user, 'unseen-1');
        $outside = $this->cachedMeeting($user, 'outside-1');
        $outside->starts_at = Carbon::parse('2026-12-01 08:00:00');
        $outside->ends_at = Carbon::parse('2026-12-01 09:00:00');
        $outside->save();
        $touching = $this->cachedMeeting($user, 'touching-1');
        $touching->starts_at = Carbon::parse('2026-10-18 23:00:00');
        $touching->ends_at = Carbon::parse('2026-10-19 00:00:00');
        $touching->save();
        $otherUser = $this->createUser();
        $foreign = $this->cachedMeeting($otherUser, 'unseen-1');
        Http::fake([self::GRAPH_URL => Http::response($this->page([$this->graphEvent('seen-1')]))]);

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk()->assertJsonPath('status', 'ok')->assertJsonPath('truncated', false);
        $this->assertNotNull(OutlookMeeting::query()->whereKey($unseen->getKey())->firstOrFail()->gone_at);
        // Outside the window, only touching its start, or another user's: never judged by this traversal
        $this->assertNull(OutlookMeeting::query()->whereKey($outside->getKey())->firstOrFail()->gone_at);
        $this->assertNull(OutlookMeeting::query()->whereKey($touching->getKey())->firstOrFail()->gone_at);
        $this->assertNull(OutlookMeeting::query()->whereKey($foreign->getKey())->firstOrFail()->gone_at);
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function mailboxProvider(): array
    {
        return [
            'not enabled' => ['MailboxNotEnabledForRESTAPI', 'no_mailbox'],
            'not supported' => ['MailboxNotSupportedForRESTAPI', 'no_mailbox'],
            'other 404 code' => ['ErrorItemNotFound', 'unavailable'],
        ];
    }

    #[DataProvider('mailboxProvider')]
    public function test_no_mailbox_answers_quietly(string $code, string $status): void
    {
        // Arrange
        $user = $this->connectedUser();
        Http::fake([self::GRAPH_URL => $this->graphError(404, [], $code)]);

        // Act
        $response = $this->postSync();

        // Assert
        $response->assertOk()->assertJsonPath('status', $status);
        $this->assertSame(0, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookSyncWindow::query()->count());
        $loud = Log::allLogs()
            ->filter(fn (LogEntry $log): bool => in_array($log->level, ['error', 'critical', 'alert', 'emergency'], true))
            ->count();
        $this->assertSame(0, $loud);
        $noMailbox = Log::allLogs()
            ->filter(fn (LogEntry $log): bool => $log->message === 'Outlook sync: no mailbox')
            ->count();
        $this->assertSame($status === 'no_mailbox' ? 1 : 0, $noMailbox);
        $this->assertCount($status === 'unavailable' ? 1 : 0, $this->degradedLogs());
    }

    public function test_server_errors_and_timeouts_are_unavailable(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $cached = $this->cachedMeeting($user, 'cached-1');
        Http::fake([self::GRAPH_URL => Http::sequence()
            ->push(['error' => ['code' => 'boom']], 500)
            ->push('<html>bad gateway</html>', 502)
            ->push(['error' => ['code' => 'unavailable']], 503)
            ->push(['error' => ['code' => 'timeout']], 504)
            ->pushFailedConnection(),
        ]);

        // Act
        $statuses = [];
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $statuses[] = $this->postSync()->assertOk()->json('status');
        }
        $read = $this->getMeetings();

        // Assert
        $this->assertSame(array_fill(0, 5, 'unavailable'), $statuses);
        $contexts = array_map(fn (LogEntry $log): array => $log->context, $this->degradedLogs());
        $this->assertSame([
            ['status' => 'unavailable', 'http_status' => 500],
            ['status' => 'unavailable', 'http_status' => 502],
            ['status' => 'unavailable', 'http_status' => 503],
            ['status' => 'unavailable', 'http_status' => 504],
            ['status' => 'unavailable', 'http_status' => null],
        ], $contexts);
        $fresh = $this->meetingByGraphId($cached->graph_id);
        $this->assertNull($fresh->gone_at);
        $this->assertSame('Subject cached-1', $fresh->subject);
        $read->assertOk()->assertJsonCount(1, 'data');
        $this->assertNull($this->account($user)->graph_backoff_until);
        $this->assertSame(0, OutlookSyncWindow::query()->count());
    }

    public function test_degraded_logs_carry_no_meeting_data(): void
    {
        // Arrange
        $this->connectedUser();
        $event = $this->graphEvent('secret-event', overrides: ['subject' => 'TOP-SECRET-SUBJECT']);
        $this->scriptGraph([$this->page([$event], hasNext: true), $this->graphError(429, ['Retry-After' => '5'])]);

        // Act
        $this->postSync()->assertJsonPath('status', 'throttled');

        // Assert
        $everything = json_encode(Log::allLogs()->map(fn (LogEntry $log): array => $log->toArray())->all());
        $this->assertIsString($everything);
        $this->assertStringNotContainsString('TOP-SECRET-SUBJECT', $everything);
        $this->assertStringNotContainsString('secret-event', $everything);
        $this->assertStringNotContainsString('at-marker-7f3c', $everything);
        // What the traversal saw before the throttle is kept
        $this->assertSame(1, OutlookMeeting::query()->where('graph_id', '=', 'secret-event')->count());
    }

    public function test_sync_never_deletes_rows(): void
    {
        // Arrange
        $user = $this->connectedUser();
        $this->cachedMeeting($user, 'old-1');
        $this->cachedMeeting($user, 'old-2');
        Http::fake([self::GRAPH_URL => Http::response($this->page([]))]);

        // Act
        $this->postSync()->assertJsonPath('status', 'ok');

        // Assert
        $this->assertSame(2, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(2, OutlookMeeting::query()->whereNotNull('gone_at')->count());
    }
}
