<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\OutlookMeetingController;
use App\Microsoft365\Http\Controllers\OutlookSeriesController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Http\Requests\MeetingRangeRequest;
use App\Microsoft365\Http\Resources\OutlookMeetingResource;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\Models\OutlookSeriesSetting;
use App\Microsoft365\Suggestions\Assignment;
use App\Microsoft365\Suggestions\BookableProjects;
use App\Microsoft365\Suggestions\MeetingHints;
use App\Microsoft365\Suggestions\MeetingSignalInput;
use App\Microsoft365\Suggestions\MeetingSignals;
use App\Microsoft365\Suggestions\MeetingSuggester;
use App\Microsoft365\Suggestions\ProjectSuggestionEngine;
use App\Microsoft365\Suggestions\Reason;
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\Suggestions\SubjectTokenizer;
use App\Microsoft365\Suggestions\Suggestion;
use App\Microsoft365\Suggestions\SuggestionHistory;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * Learned project suggestions in the calendar read (Phase 5 RULE-03, RULE-05; D-06, D-07, D-08, D-09,
 * D-11, D-12, D-14): every meeting without a series assignment comes with up to three projects ranked
 * from the session user's own conversions in the current organization, each explained by one short
 * reason. Conversions go through the real convert endpoint, so the signals are the ones 05-05 stores.
 * Meetings have no subject unless a test needs one, so subject words never add noise to the ranking.
 */
#[CoversClass(MeetingSuggester::class)]
#[CoversClass(SuggestionHistory::class)]
#[UsesClass(ProjectSuggestionEngine::class)]
#[UsesClass(Suggestion::class)]
#[UsesClass(Reason::class)]
#[UsesClass(MeetingSignals::class)]
#[UsesClass(MeetingSignalInput::class)]
#[UsesClass(SubjectTokenizer::class)]
#[UsesClass(BookableProjects::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(Assignment::class)]
#[UsesClass(MeetingHints::class)]
#[UsesClass(SeriesKey::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(OutlookSeriesController::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSeriesSetting::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
class OutlookMeetingSuggestionTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string WEEK_START = '2026-10-19T00:00:00Z';

    private const string WEEK_END = '2026-10-26T00:00:00Z';

    private const string SERIES = 'series-1';

    /**
     * An employee of a fresh organization, signed in on the web guard with a connected account.
     *
     * @return object{user: User, organization: Organization, member: Member, owner: User, ownerMember: Member}
     */
    private function employee(): object
    {
        $this->configureMicrosoft365();
        $data = $this->createUserWithRole(Role::Employee);
        $data->user->save();
        $this->connectedAccount($data->user);
        $this->actingAs($data->user);

        return $data;
    }

    private function publicProject(Organization $organization, ?Client $client = null): Project
    {
        return Project::factory()->forOrganization($organization)->forClient($client)->isPublic()->create();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => null,
            'starts_at' => '2026-10-20 09:00:00',
            'ends_at' => '2026-10-20 10:00:00',
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ], $overrides));
    }

    /**
     * A one-hour single meeting with the given attendees (address, display name or null).
     *
     * @param  list<array{0: string, 1: string|null}>  $people
     * @param  array<string, mixed>  $overrides
     */
    private function single(User $user, string $graphId, string $start, array $people, array $overrides = []): OutlookMeeting
    {
        $startsAt = Carbon::parse($start, 'UTC');

        return $this->meeting($user, $graphId, array_merge([
            'starts_at' => $startsAt->format('Y-m-d H:i:s'),
            'ends_at' => $startsAt->copy()->addHour()->format('Y-m-d H:i:s'),
            'attendees' => array_map(
                fn (array $person): array => ['address' => $person[0], 'name' => $person[1], 'type' => 'required'],
                $people,
            ),
            'attendee_count' => count($people),
        ], $overrides));
    }

    /**
     * An occurrence of a recurring series on the given day, 09:00-10:00 UTC, with the given attendees.
     *
     * @param  list<array{0: string, 1: string|null}>  $people
     */
    private function occurrence(User $user, string $graphId, string $day, array $people, string $series = self::SERIES): OutlookMeeting
    {
        return $this->single($user, $graphId, $day.' 09:00:00', $people, [
            'event_type' => 'occurrence',
            'series_master_id' => $series,
            'original_start' => $day.' 09:00:00',
        ]);
    }

    /**
     * Converts one meeting to a project (no task, no tags, not billable) and returns the entry id.
     */
    private function convertTo(Organization $organization, OutlookMeeting $meeting, Project $project): string
    {
        $response = $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'created');
        $entryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($entryId);

        return $entryId;
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function read(string $start = self::WEEK_START, string $end = self::WEEK_END, array $extra = []): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', ['start' => $start, 'end' => $end] + $extra, false));
    }

    /**
     * The serialized meeting with this id in a read.
     *
     * @return array<string, mixed>
     */
    private function item(TestResponse $response, OutlookMeeting $meeting): array
    {
        $data = $response->json('data');
        $this->assertIsArray($data);
        foreach ($data as $item) {
            if (is_array($item) && ($item['id'] ?? null) === $meeting->id) {
                return $item;
            }
        }
        $this->fail('Meeting '.$meeting->graph_id.' is not in the read');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function suggestionsOf(TestResponse $response, OutlookMeeting $meeting): array
    {
        $suggestions = $this->item($response, $meeting)['suggestions'];
        $this->assertIsArray($suggestions);
        $this->assertTrue(array_is_list($suggestions));
        $this->assertLessThanOrEqual(3, count($suggestions));

        /** @var list<array<string, mixed>> $suggestions */
        return $suggestions;
    }

    /**
     * @return list<string>
     */
    private function suggestedProjectIds(TestResponse $response, OutlookMeeting $meeting): array
    {
        return array_map(fn (array $suggestion): string => (string) $suggestion['project_id'], $this->suggestionsOf($response, $meeting));
    }

    /**
     * Two past conversions to the project with people from client.test (ana and luis).
     */
    private function twoClientConversions(Organization $organization, User $user, Project $project, string $day = '2026-10-19'): void
    {
        $people = [['ana@client.test', 'Ana'], ['luis@client.test', 'Luis']];
        $this->convertTo($organization, $this->single($user, 'hist-1', $day.' 09:00:00', $people), $project);
        $this->convertTo($organization, $this->single($user, 'hist-2', $day.' 11:00:00', $people), $project);
    }

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
    }

    /**
     * Every time entry and link as stored, to prove a read changes nothing (D-12).
     *
     * @return array{entries: list<array<string, mixed>>, links: list<array<string, mixed>>}
     */
    private function storedSnapshot(): array
    {
        return [
            'entries' => array_values(TimeEntry::query()
                ->orderBy('id')
                ->get(['id', 'start', 'end', 'description', 'project_id', 'task_id', 'tags', 'billable', 'user_id', 'member_id', 'organization_id', 'updated_at'])
                ->map(fn (TimeEntry $entry): array => $entry->getAttributes())
                ->all()),
            'links' => array_values(OutlookMeetingLink::query()
                ->orderBy('id')
                ->get()
                ->map(fn (OutlookMeetingLink $link): array => $link->getAttributes())
                ->all()),
        ];
    }

    public function test_two_conversions_with_a_client_domain_suggest_that_project(): void
    {
        // Arrange: two conversions to P with people at client.test, four to Q with people at other.test
        $data = $this->employee();
        $clientCo = Client::factory()->forOrganization($data->organization)->create(['name' => 'Client Co']);
        $p = $this->publicProject($data->organization, $clientCo);
        $q = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        foreach (range(0, 3) as $index) {
            $other = $this->single($data->user, 'other-'.$index, '2026-10-20 '.(9 + $index).':00:00', [['pat'.$index.'@other.test', 'Pat'], ['kim@other.test', 'Kim']]);
            $this->convertTo($data->organization, $other, $q);
        }
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva']]);

        // Act
        $read = $this->read();

        // Assert: P first, confident, explained by the shared domain; no score, nothing pre-assigned
        $read->assertOk();
        $this->assertSame([$next->id], $read->json('data.*.id'));
        $suggestions = $this->suggestionsOf($read, $next);
        $this->assertNotEmpty($suggestions);
        $this->assertSame([
            'project_id' => $p->getKey(),
            'confident' => true,
            'reason' => ['kind' => 'domain', 'count' => 2, 'value' => 'client.test'],
            'project_name' => $p->name,
            'project_color' => $p->color,
            'client_name' => 'Client Co',
        ], $suggestions[0]);
        $this->assertNotContains($q->getKey(), $this->suggestedProjectIds($read, $next));
        $this->assertNull($this->item($read, $next)['assignment']);
    }

    public function test_meeting_with_an_assignment_has_no_suggestions(): void
    {
        // Arrange: one occurrence of the series converted to P; a single meeting with the same people
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $people = [['ana@client.test', 'Ana'], ['luis@client.test', 'Luis']];
        $a = $this->occurrence($data->user, 'occ-a', '2026-10-20', $people);
        $b = $this->occurrence($data->user, 'occ-b', '2026-10-22', $people);
        $single = $this->single($data->user, 'single', '2026-10-21 11:00:00', $people);
        $this->convertTo($data->organization, $a, $p);

        // Act
        $read = $this->read();

        // Assert: the pre-assigned occurrence carries no suggestion, the single meeting does
        $read->assertOk();
        $this->assertSame($p->getKey(), $this->item($read, $b)['assignment']['project_id'] ?? null);
        $this->assertSame([], $this->suggestionsOf($read, $b));
        $this->assertNull($this->item($read, $single)['assignment']);
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($read, $single));
    }

    public function test_other_users_conversions_never_influence_the_ranking(): void
    {
        // Arrange: the user's own history, then a colleague of the same organization with ten
        // conversions of client.test meetings to a public project R
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $r = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $people = [['eva@client.test', 'Eva'], ['ana@client.test', 'Ana']];
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', $people);
        $before = $this->read();
        $colleague = User::factory()->create();
        Member::factory()->forUser($colleague)->forOrganization($data->organization)->role(Role::Employee)->create();
        $colleague->currentOrganization()->associate($data->organization);
        $colleague->save();
        $this->connectedAccount($colleague, objectId: '00000000-0000-4000-8000-0000000009c2');
        $this->actingAs($colleague);
        foreach (range(0, 9) as $index) {
            $meeting = $this->single($colleague, 'colleague-'.$index, '2026-10-2'.intdiv($index, 5).' '.(9 + $index % 5).':00:00', $people);
            $this->convertTo($data->organization, $meeting, $r);
        }

        // Act
        $this->actingAs($data->user);
        $after = $this->read();

        // Assert: the same answer, and R never shows up
        $before->assertOk();
        $after->assertOk();
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($before, $next));
        $this->assertSame($this->suggestionsOf($before, $next), $this->suggestionsOf($after, $next));
        $this->assertSame(12, OutlookMeetingLink::query()->count());
    }

    public function test_other_organizations_and_reassigned_entries_are_ignored(): void
    {
        // Arrange: two conversions in a second organization, and one in the current organization whose
        // entry core then moved to another member
        $data = $this->employee();
        $otherOrganization = Organization::factory()->create();
        Member::factory()->forUser($data->user)->forOrganization($otherOrganization)->role(Role::Employee)->create();
        $x = $this->publicProject($otherOrganization);
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($otherOrganization, $data->user, $x);
        $reassigned = $this->single($data->user, 'reassigned', '2026-10-20 09:00:00', [['ana@client.test', 'Ana']]);
        $entryId = $this->convertTo($data->organization, $reassigned, $p);
        TimeEntry::query()->whereKey($entryId)->update([
            'user_id' => $data->owner->getKey(),
            'member_id' => $data->ownerMember->getKey(),
        ]);
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva'], ['ana@client.test', 'Ana']]);

        // Act
        $inCurrent = $this->read();
        $data->user->current_team_id = $otherOrganization->getKey();
        $data->user->save();
        $inOther = $this->read();

        // Assert: nothing in the current organization; the other organization's history only counts there
        $inCurrent->assertOk();
        $this->assertContains($reassigned->id, $inCurrent->json('data.*.id'));
        foreach ($inCurrent->json('data') as $item) {
            $this->assertSame([], $item['suggestions']);
        }
        $inOther->assertOk();
        $this->assertSame([$x->getKey()], $this->suggestedProjectIds($inOther, $next));
    }

    public function test_archived_and_unbookable_projects_are_never_suggested(): void
    {
        // Arrange: P (public) learned from client.test, S (private, the employee a member) from partner.test
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $s = Project::factory()->forOrganization($data->organization)->isPrivate()->create();
        $projectMember = ProjectMember::factory()->forProject($s)->forMember($data->member)->create();
        $this->twoClientConversions($data->organization, $data->user, $p);
        foreach ([0, 1] as $index) {
            $partner = $this->single($data->user, 'partner-'.$index, '2026-10-20 '.(9 + 2 * $index).':00:00', [['bo@partner.test', 'Bo']]);
            $this->convertTo($data->organization, $partner, $s);
        }
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva'], ['ida@partner.test', 'Ida']]);
        $before = $this->read();

        // Act: P is archived and the employee leaves S
        $p->archived_at = Carbon::now();
        $p->save();
        ProjectMember::query()->whereKey($projectMember->getKey())->delete();
        $after = $this->read();

        // Assert
        $before->assertOk();
        $this->assertEqualsCanonicalizing([$p->getKey(), $s->getKey()], $this->suggestedProjectIds($before, $next));
        $after->assertOk();
        $this->assertSame([], $this->suggestionsOf($after, $next));
    }

    public function test_impersonation_returns_no_suggestions(): void
    {
        // Arrange
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva']]);

        // Act
        $this->startImpersonation();
        $read = $this->read();

        // Assert: the existing empty answer, nothing about meetings or suggestions (D-14)
        $read->assertOk();
        $read->assertExactJson(['data' => [], 'linked_time_entry_ids' => [], 'sync' => ['last_synced_at' => null, 'retry_after' => null]]);
    }

    public function test_suggestions_carry_no_personal_data(): void
    {
        // Arrange: Eva has no display name, in the history and in the next meeting
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        foreach ([0, 1] as $index) {
            $past = $this->single($data->user, 'past-'.$index, '2026-10-19 '.(9 + 2 * $index).':00:00', [['eva@client.test', null]]);
            $this->convertTo($data->organization, $past, $p);
        }
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', null]]);

        // Act
        $read = $this->read();

        // Assert: Eva is explained by her domain; no score, no attendee data, no address anywhere
        $read->assertOk();
        $suggestions = $this->suggestionsOf($read, $next);
        $this->assertCount(1, $suggestions);
        $this->assertSame($p->getKey(), $suggestions[0]['project_id']);
        $this->assertSame(['kind' => 'domain', 'count' => 2, 'value' => 'client.test'], $suggestions[0]['reason']);
        $this->assertSame(['project_id', 'confident', 'reason', 'project_name', 'project_color', 'client_name'], array_keys($suggestions[0]));
        $json = (string) $read->getContent();
        foreach (['"score"', '"attendees"', '"organizer_address"', '"attendee_count"', '"signals"'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $json, $forbidden);
        }
        $this->assertDoesNotMatchRegularExpression('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/', $json);
    }

    public function test_dismissed_and_ignored_meetings_have_no_suggestions(): void
    {
        // Arrange: P learned from client.test; a dismissed meeting, an occurrence of an ignored series and
        // a plain meeting, all with people from client.test
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $people = [['eva@client.test', 'Eva']];
        $dismissed = $this->single($data->user, 'dismissed', '2026-10-21 14:00:00', $people, ['dismissed_at' => '2026-10-19 08:00:00']);
        $ignored = $this->occurrence($data->user, 'occ-ignored', '2026-10-22', $people);
        $plain = $this->single($data->user, 'plain', '2026-10-23 09:00:00', $people);
        $this->postJson(route('microsoft.meetings.series.ignore', ['meeting' => $ignored->id], false))->assertNoContent();

        // Act
        $read = $this->read(extra: ['include_dismissed' => '1']);

        // Assert
        $read->assertOk();
        $this->assertTrue($this->item($read, $dismissed)['dismissed']);
        $this->assertSame([], $this->suggestionsOf($read, $dismissed));
        $this->assertTrue($this->item($read, $ignored)['series_ignored']);
        $this->assertSame([], $this->suggestionsOf($read, $ignored));
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($read, $plain));
    }

    public function test_history_window_is_bounded(): void
    {
        // Arrange
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva']]);
        $before = $this->read();

        // Act: the links are now 400 days old, past the 365-day window
        OutlookMeetingLink::query()->update(['created_at' => Carbon::now()->subDays(400)]);
        $after = $this->read();

        // Assert
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($before, $next));
        $after->assertOk();
        $this->assertSame([], $this->suggestionsOf($after, $next));
    }

    public function test_read_query_count_is_constant(): void
    {
        // Arrange: one meeting without assignment in the first week, fifteen in the second one
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $people = [['eva@client.test', 'Eva']];
        $this->single($data->user, 'w1', '2026-10-22 09:00:00', $people);
        foreach (range(0, 14) as $index) {
            $this->single($data->user, 'w2-'.$index, '2026-10-2'.(6 + intdiv($index, 5)).' '.(9 + $index % 5).':00:00', $people);
        }
        $this->read()->assertOk();

        // Act
        $this->enableQueryLog();
        $small = $this->read();
        $smallQueries = count($this->getQueryLog());
        DB::flushQueryLog();
        $large = $this->read('2026-10-26T00:00:00Z', '2026-11-02T00:00:00Z');
        $largeQueries = count($this->getQueryLog());
        DB::disableQueryLog();

        // Assert: every meeting got its suggestion, at the same cost (D-12, T-05-34)
        $small->assertOk();
        $large->assertOk();
        $this->assertCount(1, $small->json('data'));
        $this->assertCount(15, $large->json('data'));
        foreach ([$small, $large] as $read) {
            foreach ($read->json('data') as $item) {
                $this->assertSame($p->getKey(), $item['suggestions'][0]['project_id'] ?? null);
            }
        }
        $this->assertSame($smallQueries, $largeQueries);
    }

    public function test_reading_suggestions_never_changes_time_entries(): void
    {
        // Arrange
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $this->twoClientConversions($data->organization, $data->user, $p);
        $next = $this->single($data->user, 'next', '2026-10-22 09:00:00', [['eva@client.test', 'Eva']]);
        $before = $this->storedSnapshot();
        $this->travel(1)->minutes();

        // Act
        $first = $this->read();
        $second = $this->read();

        // Assert: suggested, but nothing converted, changed or linked (D-08, D-12)
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($first, $next));
        $this->assertSame([$p->getKey()], $this->suggestedProjectIds($second, $next));
        $this->assertSame($before, $this->storedSnapshot());
        $this->assertSame(2, TimeEntry::query()->count());
    }

    public function test_forgotten_series_history_does_not_suggest_itself(): void
    {
        // Arrange: three occurrences of a series with people from client.test converted to P, then the
        // series is forgotten through its fourth occurrence
        $data = $this->employee();
        $p = $this->publicProject($data->organization);
        $people = [['ana@client.test', 'Ana']];
        foreach (['2026-10-19', '2026-10-20', '2026-10-21'] as $index => $day) {
            $this->convertTo($data->organization, $this->occurrence($data->user, 'occ-'.$index, $day, $people), $p);
        }
        $fourth = $this->occurrence($data->user, 'occ-3', '2026-10-22', $people);
        $single = $this->single($data->user, 'single', '2026-10-23 09:00:00', [['eva@client.test', 'Eva']]);
        $this->assertSame($p->getKey(), $this->item($this->read(), $fourth)['assignment']['project_id'] ?? null);
        $this->deleteJson(route('microsoft.meetings.series.forget', ['meeting' => $fourth->id], false))->assertNoContent();

        // Act
        $read = $this->read();

        // Assert: the forgotten links neither pre-assign nor suggest their own series (RESEARCH Pitfall 9),
        // while another meeting with the same client still learns from them
        $read->assertOk();
        $this->assertNull($this->item($read, $fourth)['assignment']);
        $this->assertNotContains($p->getKey(), $this->suggestedProjectIds($read, $fourth));
        $suggestions = $this->suggestionsOf($read, $single);
        $this->assertNotEmpty($suggestions);
        $this->assertSame($p->getKey(), $suggestions[0]['project_id']);
        $this->assertSame(['kind' => 'domain', 'count' => 3, 'value' => 'client.test'], $suggestions[0]['reason']);
    }
}
