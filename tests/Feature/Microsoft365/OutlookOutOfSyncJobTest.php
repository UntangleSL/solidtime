<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryUpdateRequest;
use App\Jobs\RecalculateSpentTimeForProject;
use App\Microsoft365\Console\CheckOutOfSyncCommand;
use App\Microsoft365\Graph\EventLookup;
use App\Microsoft365\Graph\EventLookupStatus;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\RetryAfter;
use App\Microsoft365\Jobs\CheckOutOfSyncForUser;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\OutOfSync\ApplyResult;
use App\Microsoft365\OutOfSync\Decision;
use App\Microsoft365\OutOfSync\DecisionAction;
use App\Microsoft365\OutOfSync\LinkState;
use App\Microsoft365\OutOfSync\Observation;
use App\Microsoft365\OutOfSync\ObservationKind;
use App\Microsoft365\OutOfSync\OutOfSyncApplier;
use App\Microsoft365\OutOfSync\OutOfSyncLookups;
use App\Microsoft365\OutOfSync\OutOfSyncRules;
use App\Microsoft365\OutOfSync\OutOfSyncScope;
use App\Microsoft365\TimeEntries\CoreTimeEntryUpdater;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Console\Command;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\ResponseSequence;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;
use TiMacDonald\Log\LogEntry;

/**
 * The daily out-of-sync check (D-11), end to end: m365:check-out-of-sync queues one job per eligible
 * user, and each job looks up that user's linked meetings in the window and applies the answers with the
 * same rules and applier as the interactive sync, without a request, a session or a signed-in user.
 */
#[CoversClass(CheckOutOfSyncForUser::class)]
#[CoversClass(CheckOutOfSyncCommand::class)]
#[UsesClass(OutOfSyncApplier::class)]
#[UsesClass(OutOfSyncLookups::class)]
#[UsesClass(OutOfSyncScope::class)]
#[UsesClass(OutOfSyncRules::class)]
#[UsesClass(CoreTimeEntryUpdater::class)]
#[UsesClass(ApplyResult::class)]
#[UsesClass(Observation::class)]
#[UsesClass(ObservationKind::class)]
#[UsesClass(LinkState::class)]
#[UsesClass(Decision::class)]
#[UsesClass(DecisionAction::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(EventLookup::class)]
#[UsesClass(EventLookupStatus::class)]
#[UsesClass(RetryAfter::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryUpdateRequest::class)]
class OutlookOutOfSyncJobTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string LOOKUP_URL = 'https://graph.microsoft.com/v1.0/me/events/*';

    private const string CHECK_MESSAGE = 'Outlook out-of-sync check';

    private int $objectIds = 0;

    /**
     * An employee of a fresh organization with a connected account. Nobody is signed in: the job runs
     * like a queue worker. The clock stands on Tuesday 2026-12-01 08:00 UTC unless given.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(string $now = '2026-12-01 08:00:00'): object
    {
        $this->travelTo(CarbonImmutable::parse($now, 'UTC'));
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $this->connectedAccount($data->user, objectId: $this->nextObjectId());
        // Every Graph answer of these tests is scripted: an unscripted request fails the test
        Http::preventStrayRequests();

        return $data;
    }

    private function nextObjectId(): string
    {
        $this->objectIds++;

        return sprintf('00000000-0000-4000-8000-%012d', $this->objectIds);
    }

    /**
     * A time entry of the user and the link of a converted occurrence at the meeting's own slot. Times
     * are UTC 'Y-m-d H:i:s'.
     */
    private function linkedEntry(User $user, string $graphId, string $start, string $end, ?Project $project = null): TimeEntry
    {
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        $entry = TimeEntry::factory()->forMember($member)->forProject($project)->create([
            'start' => Carbon::parse($start, 'UTC'),
            'end' => Carbon::parse($end, 'UTC'),
            'description' => '',
            'billable' => false,
        ]);
        OutlookMeetingLink::query()->create([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'time_entry_id' => $entry->getKey(),
            'meeting_starts_at' => $start,
            'meeting_ends_at' => $end,
        ]);

        return $entry;
    }

    /**
     * Fakes the direct lookup endpoint (GET /me/events/{id}). A single response answers every lookup; a
     * sequence answers them in order and fails the test when a lookup more than scripted is sent.
     */
    private function fakeLookups(PromiseInterface|ResponseSequence $answer): void
    {
        Http::fake([self::LOOKUP_URL => $answer]);
    }

    /**
     * A recorded lookup answer of tests/Fixtures/M365/lookups (status plus body, or the error code).
     */
    private function lookupFixture(string $scenario): PromiseInterface
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
            $body = ['error' => ['code' => $entry['errorCode'], 'message' => 'The specified object was not found in the store.']];
        }
        $this->assertIsArray($body);

        return Http::response($body, $entry['status']);
    }

    /**
     * A lookup answer of an occurrence at the given UTC times ('Y-m-d\TH:i:s').
     */
    private function lookupAt(string $id, string $start, string $end): PromiseInterface
    {
        return Http::response([
            'id' => $id,
            'type' => 'singleInstance',
            'seriesMasterId' => null,
            'start' => ['dateTime' => $start.'.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => $end.'.0000000', 'timeZone' => 'UTC'],
            'isCancelled' => false,
            'isAllDay' => false,
        ]);
    }

    /**
     * The direct lookups that were sent, in order.
     *
     * @return list<Request>
     */
    private function lookupRequests(): array
    {
        return array_values(Http::recorded(fn (Request $request): bool => str_contains($request->url(), '/v1.0/me/events/'))
            ->map(fn (array $pair): Request => $pair[0])
            ->all());
    }

    /**
     * Runs the job the way the worker does: a fresh instance, dependencies from the container.
     */
    private function runJob(User|string $user, bool $fakeQueue = false): CheckOutOfSyncForUser
    {
        $job = new CheckOutOfSyncForUser($user instanceof User ? (string) $user->getKey() : $user);
        if ($fakeQueue) {
            $job->withFakeQueueInteractions();
        }
        $this->app->call([$job, 'handle']);

        return $job;
    }

    private function account(User $user): MicrosoftAccount
    {
        return MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->sole();
    }

    private function linkOf(User $user, string $graphId): OutlookMeetingLink
    {
        return OutlookMeetingLink::query()
            ->where('user_id', '=', $user->getKey())
            ->where('graph_id', '=', $graphId)
            ->sole();
    }

    private function utc(?\DateTimeInterface $value): ?string
    {
        return $value === null ? null : CarbonImmutable::instance($value)->utc()->format('Y-m-d H:i:s');
    }

    public function test_command_queues_one_job_per_eligible_user(): void
    {
        // Arrange: A is eligible; B has no link; C must reconnect; D disconnected; E is backed off
        $this->travelTo(CarbonImmutable::parse('2026-12-01 08:00:00', 'UTC'));
        $this->configureMicrosoft365();
        Queue::fake();
        $users = [];
        foreach (['a', 'b', 'c', 'd', 'e'] as $key) {
            $users[$key] = $this->createUserWithRole(Role::Employee)->user;
            $users[$key]->save();
            $account = $this->connectedAccount($users[$key], objectId: $this->nextObjectId());
            if ($key !== 'b') {
                $this->linkedEntry($users[$key], 'evt-'.$key, '2026-12-03 10:00:00', '2026-12-03 11:00:00');
            }
            if ($key === 'c') {
                $account->reconnect_required_at = Carbon::now();
            }
            if ($key === 'd') {
                $account->refresh_token = null;
                $account->access_token = null;
                $account->disconnected_at = Carbon::now();
            }
            if ($key === 'e') {
                $account->graph_backoff_until = Carbon::now()->addMinutes(5);
            }
            $account->save();
        }

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check-out-of-sync');
        $output = Artisan::output();

        // Assert: one job, for A only; the output is counts only
        $this->assertSame(Command::SUCCESS, $exitCode);
        Queue::assertPushed(CheckOutOfSyncForUser::class, 1);
        Queue::assertPushed(CheckOutOfSyncForUser::class, fn (CheckOutOfSyncForUser $job): bool => $job->userId === $users['a']->getKey());
        $this->assertStringContainsString('users: 1', $output);
        $this->assertStringContainsString('dispatched: 1', $output);
        $this->assertStringNotContainsString('ada@example.test', $output);
        foreach ($users as $user) {
            $this->assertStringNotContainsString((string) $user->getKey(), $output);
            $this->assertStringNotContainsString($user->email, $output);
            $this->assertStringNotContainsString($user->name, $output);
        }
    }

    public function test_dry_run_queues_nothing(): void
    {
        // Arrange
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        Queue::fake();

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check-out-of-sync', ['--dry-run' => true]);
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertStringContainsString('users: 1', $output);
        $this->assertStringContainsString('dispatched: 0 (dry run)', $output);
        Queue::assertNothingPushed();
    }

    public function test_job_moves_an_unedited_entry_of_a_moved_meeting_nobody_opened(): void
    {
        // Arrange: a not-started, unedited meeting next month that Outlook moved; nobody is signed in
        $data = $this->employee();
        $project = Project::factory()->forOrganization($data->organization)->isPublic()->create();
        $entry = $this->linkedEntry($data->user, 'evt-1', '2027-01-12 10:00:00', '2027-01-12 11:00:00', $project);
        Queue::fake([RecalculateSpentTimeForProject::class]);
        $this->fakeLookups(Http::sequence()->pushResponse($this->lookupAt('evt-1', '2027-01-12T14:00:00', '2027-01-12T15:00:00')));
        $this->assertNull(Auth::guard('web')->user());

        // Act
        $this->runJob($data->user);

        // Assert: the entry followed through core's update path
        $entry->refresh();
        $this->assertSame('2027-01-12 14:00:00', $this->utc($entry->start));
        $this->assertSame('2027-01-12 15:00:00', $this->utc($entry->end));
        $this->assertSame($project->getKey(), $entry->project_id);
        Queue::assertPushed(RecalculateSpentTimeForProject::class);
        // The snapshot is the new slot, the adjust is recorded
        $link = $this->linkOf($data->user, 'evt-1');
        $this->assertSame('2027-01-12 14:00:00', $this->utc($link->meeting_starts_at));
        $this->assertSame('2027-01-12 15:00:00', $this->utc($link->meeting_ends_at));
        $this->assertSame('2027-01-12 10:00:00', $this->utc($link->auto_adjusted_from_starts_at));
        $this->assertNotNull($link->auto_adjusted_at);
        $this->assertNotNull($link->last_checked_at);
        $this->assertNull($link->flag_reason);
        // No authenticated user is left behind for the next job (T-06-32)
        $this->assertNull(Auth::guard('web')->user());
        $this->assertNull(Auth::user());
    }

    public function test_job_is_not_blocked_by_the_access_guard(): void
    {
        // Arrange: no session was started, as in a queue worker
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->fakeLookups($this->lookupAt('evt-1', '2026-12-03T10:00:00', '2026-12-03T11:00:00'));

        // Act
        $this->runJob($data->user);

        // Assert: the guard answered "not impersonating" and the lookup was actually sent (RESEARCH A1)
        $this->assertFalse(app(GraphAccessGuard::class)->blocked());
        $lookups = $this->lookupRequests();
        $this->assertCount(1, $lookups);
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-1?', $lookups[0]->url());
        $this->assertNotNull($this->linkOf($data->user, 'evt-1')->last_checked_at);
    }

    public function test_command_does_nothing_while_the_integration_is_not_configured(): void
    {
        // Arrange: an eligible user, but the client secret is missing
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->configureMicrosoft365(null, ['client_secret' => null]);
        Queue::fake();

        // Act
        $exitCode = $this->withoutMockingConsoleOutput()->artisan('m365:check-out-of-sync');
        $output = Artisan::output();

        // Assert
        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertStringContainsString('configured: no', $output);
        Queue::assertNothingPushed();
    }

    public function test_command_staggers_the_dispatches(): void
    {
        // Arrange: two eligible users
        $first = $this->employee();
        $this->linkedEntry($first->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $second = $this->createUserWithRole(Role::Employee);
        $second->user->save();
        $this->connectedAccount($second->user, objectId: $this->nextObjectId());
        $this->linkedEntry($second->user, 'evt-2', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        Queue::fake();

        // Act
        $this->withoutMockingConsoleOutput()->artisan('m365:check-out-of-sync');

        // Assert: 0 s and 10 s (microsoft365.out_of_sync.dispatch_stagger_seconds)
        $delays = [];
        Queue::assertPushed(CheckOutOfSyncForUser::class, function (CheckOutOfSyncForUser $job) use (&$delays): bool {
            $this->assertInstanceOf(\DateTimeInterface::class, $job->delay);
            $delays[] = $job->delay->getTimestamp() - CarbonImmutable::now()->getTimestamp();

            return true;
        });
        sort($delays);
        $this->assertSame([0, 10], $delays);
    }

    public function test_job_releases_itself_while_backed_off(): void
    {
        // Arrange: Graph asked to wait two more minutes
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $account = $this->account($data->user);
        $account->graph_backoff_until = Carbon::now()->addSeconds(120);
        $account->save();
        $this->fakeLookups($this->lookupFixture('S4'));

        // Act
        $job = $this->runJob($data->user, fakeQueue: true);

        // Assert: back on the queue once the back-off is over, without a Graph call
        $job->assertReleased(delay: 120);
        $this->assertSame([], $this->lookupRequests());
        $this->assertNull($this->linkOf($data->user, 'evt-1')->last_checked_at);
    }

    public function test_job_stops_at_a_throttled_lookup(): void
    {
        // Arrange: three not-started links; Graph throttles the second lookup
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->linkedEntry($data->user, 'evt-2', '2026-12-04 10:00:00', '2026-12-04 11:00:00');
        $this->linkedEntry($data->user, 'evt-3', '2026-12-05 10:00:00', '2026-12-05 11:00:00');
        $this->fakeLookups(Http::sequence()
            ->pushResponse($this->lookupAt('evt-1', '2026-12-03T10:00:00', '2026-12-03T11:00:00'))
            ->push(['error' => ['code' => 'TooManyRequests']], 429, ['Retry-After' => '90']));

        // Act
        $job = $this->runJob($data->user, fakeQueue: true);

        // Assert: two lookups, the back-off is persisted, the third link is left for the next run
        $lookups = $this->lookupRequests();
        $this->assertCount(2, $lookups);
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-1?', $lookups[0]->url());
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-2?', $lookups[1]->url());
        $this->assertSame('2026-12-01 08:01:30', $this->utc($this->account($data->user)->graph_backoff_until));
        $this->assertNotNull($this->linkOf($data->user, 'evt-1')->last_checked_at);
        $this->assertNull($this->linkOf($data->user, 'evt-2')->last_checked_at);
        $this->assertNull($this->linkOf($data->user, 'evt-3')->last_checked_at);
        // The job itself never retries a throttled lookup
        $job->assertNotReleased();
    }

    public function test_job_stops_at_reconnect(): void
    {
        // Arrange: two links; the lookup is rejected before and after a token refresh
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->linkedEntry($data->user, 'evt-2', '2026-12-04 10:00:00', '2026-12-04 11:00:00');
        Http::fake(['https://login.microsoftonline.com/*/oauth2/v2.0/token' => Http::response([
            'access_token' => 'at-new-5b2e',
            'expires_in' => 3600,
            'refresh_token' => 'rt-new-8c4a',
        ])]);
        $this->fakeLookups(Http::sequence()
            ->push(['error' => ['code' => 'InvalidAuthenticationToken']], 401)
            ->push(['error' => ['code' => 'InvalidAuthenticationToken']], 401));

        // Act
        $this->runJob($data->user);

        // Assert: Phase 3 rule, one refresh then reconnect; the second link is not looked up
        $lookups = $this->lookupRequests();
        $this->assertCount(2, $lookups);
        $this->assertSame($lookups[0]->url(), $lookups[1]->url());
        $this->assertNotNull($this->account($data->user)->reconnect_required_at);
        foreach (['evt-1', 'evt-2'] as $graphId) {
            $link = $this->linkOf($data->user, $graphId);
            $this->assertNull($link->flag_reason, $graphId);
            $this->assertNull($link->last_checked_at, $graphId);
        }
    }

    public function test_job_skips_users_without_a_valid_connection(): void
    {
        // Arrange: a disconnected user, a user who must reconnect, and a user id that no longer exists
        $disconnected = $this->employee();
        $this->linkedEntry($disconnected->user, 'evt-d', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $account = $this->account($disconnected->user);
        $account->refresh_token = null;
        $account->access_token = null;
        $account->disconnected_at = Carbon::now();
        $account->save();
        $reconnect = $this->createUserWithRole(Role::Employee);
        $reconnect->user->save();
        $account = $this->connectedAccount($reconnect->user, objectId: $this->nextObjectId());
        $account->reconnect_required_at = Carbon::now();
        $account->save();
        $this->linkedEntry($reconnect->user, 'evt-r', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->fakeLookups($this->lookupFixture('S4'));

        // Act
        $this->runJob($disconnected->user);
        $this->runJob($reconnect->user);
        $this->runJob('00000000-0000-4000-8000-ffffffffffff');

        // Assert: no Graph request, nothing changed (D-11)
        $this->assertSame([], $this->lookupRequests());
        $this->assertNull($this->linkOf($disconnected->user, 'evt-d')->last_checked_at);
        $this->assertNull($this->linkOf($reconnect->user, 'evt-r')->last_checked_at);
        $this->assertNull($this->linkOf($reconnect->user, 'evt-r')->flag_reason);
    }

    public function test_job_caps_lookups(): void
    {
        // Arrange: five not-started links, checked at different times; the budget is two lookups
        Config::set('microsoft365.out_of_sync.lookups_per_job', 2);
        $data = $this->employee();
        $checked = ['2026-11-29 08:00:00', null, '2026-11-25 08:00:00', '2026-11-30 08:00:00', '2026-11-28 08:00:00'];
        foreach ($checked as $i => $at) {
            $this->linkedEntry($data->user, 'evt-'.$i, sprintf('2026-12-%02d 10:00:00', 2 + $i), sprintf('2026-12-%02d 11:00:00', 2 + $i));
            if ($at !== null) {
                $link = $this->linkOf($data->user, 'evt-'.$i);
                $link->last_checked_at = Carbon::parse($at, 'UTC');
                $link->save();
            }
        }
        $this->fakeLookups($this->lookupFixture('S4'));

        // Act
        $this->runJob($data->user);

        // Assert: never checked first, then the least recently checked
        $lookups = $this->lookupRequests();
        $this->assertCount(2, $lookups);
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-1?', $lookups[0]->url());
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-2?', $lookups[1]->url());
        foreach ([0, 1, 2, 3, 4] as $i) {
            $expected = in_array($i, [1, 2], true) ? Decision::REASON_REMOVED : null;
            $this->assertSame($expected, $this->linkOf($data->user, 'evt-'.$i)->flag_reason, 'evt-'.$i);
        }
    }

    public function test_job_scope(): void
    {
        // Arrange: one link in the window; one recorded 61 days ago; one released; one detached
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-in', '2026-11-20 10:00:00', '2026-11-20 11:00:00');
        $this->linkedEntry($data->user, 'evt-old', '2026-10-01 07:00:00', '2026-10-01 08:00:00');
        $this->linkedEntry($data->user, 'evt-released', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->linkedEntry($data->user, 'evt-detached', '2026-12-04 10:00:00', '2026-12-04 11:00:00');
        $released = $this->linkOf($data->user, 'evt-released');
        $released->released_at = Carbon::now()->subDay();
        $released->save();
        $detached = $this->linkOf($data->user, 'evt-detached');
        $detached->detached_at = Carbon::now()->subDay();
        $detached->save();
        $this->fakeLookups($this->lookupFixture('S4'));

        // Act
        $this->runJob($data->user);

        // Assert: only the link in scope was looked up (D-10)
        $lookups = $this->lookupRequests();
        $this->assertCount(1, $lookups);
        $this->assertStringStartsWith('https://graph.microsoft.com/v1.0/me/events/evt-in?', $lookups[0]->url());
        foreach (['evt-old', 'evt-released', 'evt-detached'] as $graphId) {
            $this->assertNull($this->linkOf($data->user, $graphId)->last_checked_at, $graphId);
        }
    }

    public function test_job_releases_a_started_meeting_and_moves_its_cached_row(): void
    {
        // Arrange: the meeting started at 10:00; Outlook moved it to next week; its cached row is at the old slot
        $data = $this->employee('2026-12-03 10:30:00');
        $entry = $this->linkedEntry($data->user, 'evt-s', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $meeting = OutlookMeeting::query()->create([
            'user_id' => $data->user->getKey(),
            'graph_id' => 'evt-s',
            'event_type' => 'singleInstance',
            'subject' => 'Weekly sync',
            'starts_at' => '2026-12-03 10:00:00',
            'ends_at' => '2026-12-03 11:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid=evt-s',
            'last_seen_at' => '2026-11-30 08:00:00',
        ]);
        $this->fakeLookups(Http::sequence()->pushResponse($this->lookupAt('evt-s', '2026-12-09T10:00:00', '2026-12-09T11:00:00')));

        // Act
        $this->runJob($data->user);

        // Assert: released, the entry unchanged, the meeting shows again at its new slot (D-03, Pitfall 5)
        $link = $this->linkOf($data->user, 'evt-s');
        $this->assertNotNull($link->released_at);
        $this->assertNull($link->flag_reason);
        $this->assertNull($link->auto_adjusted_at);
        $entry->refresh();
        $this->assertSame('2026-12-03 10:00:00', $this->utc($entry->start));
        $this->assertSame('2026-12-03 11:00:00', $this->utc($entry->end));
        $meeting->refresh();
        $this->assertSame('2026-12-09 10:00:00', $this->utc($meeting->starts_at));
        $this->assertSame('2026-12-09 11:00:00', $this->utc($meeting->ends_at));
    }

    public function test_job_flags_cancelled_and_removed_not_started_meetings(): void
    {
        // Arrange: two not-started links; Outlook answers cancelled (S3) for the first, gone (S4) for the second
        $data = $this->employee();
        $cancelled = $this->linkedEntry($data->user, 'evt-3', '2026-12-04 09:00:00', '2026-12-04 09:30:00');
        $removed = $this->linkedEntry($data->user, 'evt-4', '2026-12-05 10:00:00', '2026-12-05 11:00:00');
        $this->fakeLookups(Http::sequence()
            ->pushResponse($this->lookupFixture('S3'))
            ->pushResponse($this->lookupFixture('S4')));

        // Act
        $this->runJob($data->user);

        // Assert: both flagged for the user's choice; nothing is ever deleted (D-05)
        $this->assertCount(2, $this->lookupRequests());
        $this->assertSame(Decision::REASON_CANCELLED, $this->linkOf($data->user, 'evt-3')->flag_reason);
        $this->assertSame(Decision::REASON_REMOVED, $this->linkOf($data->user, 'evt-4')->flag_reason);
        foreach ([$cancelled, $removed] as $entry) {
            $this->assertTrue(TimeEntry::query()->whereKey($entry->getKey())->exists());
            $before = [$this->utc($entry->start), $this->utc($entry->end)];
            $entry->refresh();
            $this->assertSame($before, [$this->utc($entry->start), $this->utc($entry->end)]);
        }
    }

    public function test_job_logs_counts_only(): void
    {
        // Arrange: one moved, unedited meeting; Graph throttles the next lookup
        $data = $this->employee();
        $this->linkedEntry($data->user, 'evt-1', '2026-12-03 10:00:00', '2026-12-03 11:00:00');
        $this->linkedEntry($data->user, 'evt-2', '2026-12-04 10:00:00', '2026-12-04 11:00:00');
        $this->fakeLookups(Http::sequence()
            ->pushResponse($this->lookupAt('evt-1', '2026-12-03T12:00:00', '2026-12-03T13:00:00'))
            ->push(['error' => ['code' => 'TooManyRequests']], 429, ['Retry-After' => '60']));

        // Act
        $this->runJob($data->user);

        // Assert: one summary line with fixed keys, integer counts and the stop reason
        $lines = Log::allLogs()->filter(fn (LogEntry $log): bool => $log->message === self::CHECK_MESSAGE)->values();
        $this->assertCount(1, $lines);
        $this->assertSame('info', $lines[0]->level);
        $this->assertSame([
            'checked' => 2,
            'adjusted' => 1,
            'flagged' => 0,
            'released' => 0,
            'cleared' => 0,
            'stopped' => 'throttled',
        ], $lines[0]->context);
        // No Graph id, time, subject or user data in any out-of-sync line (T-06-35)
        $everything = json_encode(Log::allLogs()
            ->filter(fn (LogEntry $log): bool => str_starts_with((string) $log->message, 'Outlook out-of-sync'))
            ->map(fn (LogEntry $log): array => $log->toArray())
            ->values()
            ->all(), JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('evt-', $everything);
        $this->assertStringNotContainsString('2026-12', $everything);
        $this->assertStringNotContainsString((string) $data->user->getKey(), $everything);
        $this->assertStringNotContainsString($data->user->email, $everything);
    }
}
