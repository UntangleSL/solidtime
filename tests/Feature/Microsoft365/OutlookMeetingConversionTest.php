<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Middleware\EnsureMicrosoftIsEnabled;
use App\Microsoft365\Http\Requests\MeetingConversionRequest;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookMeetingLink;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(MeetingConversionController::class)]
#[UsesClass(MeetingConversionRequest::class)]
#[UsesClass(CoreTimeEntryCreator::class)]
#[UsesClass(OutlookMeetingLink::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(GraphAccessGuard::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
#[UsesClass(TimeEntryController::class)]
#[UsesClass(TimeEntryStoreRequest::class)]
class OutlookMeetingConversionTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

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

    private function publicProject(Organization $organization): Project
    {
        return Project::factory()->forOrganization($organization)->isPublic()->create();
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
            'subject' => 'Subject '.$graphId,
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
     * @param  array<string, mixed>  $body
     */
    private function convert(Organization $organization, array $body): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), $body);
    }

    public function test_converts_one_meeting_into_a_time_entry(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $meeting = $this->meeting($data->user, 'weekly', ['subject' => 'Weekly sync']);

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$meeting->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonCount(1, 'results');
        $response->assertJsonPath('results.0.meeting_id', $meeting->id);
        $response->assertJsonPath('results.0.status', 'created');
        $response->assertJsonPath('results.0.error', null);
        $entryId = $response->json('results.0.time_entry_id');
        $this->assertIsString($entryId);
        $this->assertTrue(Str::isUuid($entryId));
        $this->assertSame(1, TimeEntry::query()->count());
        $entry = TimeEntry::query()->findOrFail($entryId);
        $this->assertSame($data->user->getKey(), $entry->user_id);
        $this->assertSame($data->member->getKey(), $entry->member_id);
        $this->assertSame($data->organization->getKey(), $entry->organization_id);
        $this->assertSame('2026-10-20 09:00:00', $entry->start->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-20 10:00:00', $entry->end?->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('Weekly sync', $entry->description);
        $this->assertSame($project->getKey(), $entry->project_id);
        $this->assertFalse($entry->billable);
        $links = OutlookMeetingLink::query()->get();
        $this->assertCount(1, $links);
        $this->assertSame($data->user->getKey(), $links[0]->user_id);
        $this->assertSame('weekly', $links[0]->graph_id);
        $this->assertSame($entryId, $links[0]->time_entry_id);
    }

    public function test_route_is_a_web_session_route_outside_api(): void
    {
        // Arrange
        $route = Route::getRoutes()->getByName('microsoft.meetings.convert');

        // Assert
        $this->assertNotNull($route);
        $this->assertSame('m365/organizations/{organization}/meetings/time-entries', $route->uri());
        $this->assertSame(['POST'], $route->methods());
        $this->assertStringStartsNotWith('api/', $route->uri());
        $middleware = $route->gatherMiddleware();
        foreach (['web', 'auth:web', 'auth.session', 'verified', 'check-organization-blocked'] as $expected) {
            $this->assertContains($expected, $middleware, $expected);
        }
        $throttles = array_filter(
            $middleware,
            fn (mixed $name): bool => is_string($name) && str_starts_with($name, 'throttle:') && str_contains($name, 'm365-convert'),
        );
        $this->assertCount(1, $throttles);
        $this->assertArrayHasKey('organization', $route->wheres);
        $this->assertStringContainsString('{12}', (string) $route->wheres['organization']);
    }

    public function test_unknown_meeting_id_is_reported_per_meeting(): void
    {
        // Arrange
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $unknown = (string) Str::uuid();

        // Act
        $response = $this->convert($data->organization, [
            'meeting_ids' => [$unknown],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);

        // Assert
        $response->assertOk();
        $response->assertJsonPath('results.0.meeting_id', $unknown);
        $response->assertJsonPath('results.0.status', 'failed');
        $response->assertJsonPath('results.0.time_entry_id', null);
        $response->assertJsonPath('results.0.error.key', 'meeting_not_found');
        $this->assertSame(0, TimeEntry::query()->count());
        $this->assertSame(0, OutlookMeetingLink::query()->count());
    }
}
