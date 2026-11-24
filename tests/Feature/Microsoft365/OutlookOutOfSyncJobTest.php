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
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

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
}
