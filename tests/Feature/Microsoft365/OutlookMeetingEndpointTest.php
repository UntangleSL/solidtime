<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
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
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(OutlookMeetingController::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
#[UsesClass(OutlookSyncWindow::class)]
#[UsesClass(EnsureMicrosoftIsEnabled::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(Microsoft365ServiceProvider::class)]
class OutlookMeetingEndpointTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private const string WINDOW_START = '2026-10-19T00:00:00Z';

    private const string WINDOW_END = '2026-10-26T00:00:00Z';

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    /**
     * @return array<string, string>
     */
    private function window(): array
    {
        return $this->fixtureWindow();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function meeting(User $user, string $graphId, string $start, string $end, array $overrides = []): OutlookMeeting
    {
        return OutlookMeeting::query()->create(array_merge([
            'user_id' => $user->getKey(),
            'graph_id' => $graphId,
            'event_type' => 'singleInstance',
            'subject' => 'Subject '.$graphId,
            'starts_at' => $start,
            'ends_at' => $end,
            'organizer_name' => 'Org Name',
            'is_organizer' => false,
            'is_online_meeting' => true,
            'web_link' => 'https://outlook.office.com/owa/?itemid='.$graphId,
            'last_seen_at' => '2026-10-19 00:00:00',
        ], $overrides));
    }

    /**
     * @param  array<string, string>  $range
     */
    private function getMeetings(array $range): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', $range, false));
    }

    public function test_sync_then_read_returns_the_cached_meetings(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');
        $this->actingAs($user);
        $window = $this->window();

        // Act
        $sync = $this->postJson(route('microsoft.meetings.sync', [], false), $window);
        Http::fake();
        $read = $this->getMeetings($window);

        // Assert
        $sync->assertOk();
        $sync->assertJsonPath('status', 'ok');
        $sync->assertJsonPath('truncated', false);
        $read->assertOk();
        $read->assertJsonCount(12, 'data');
        $starts = array_column($read->json('data'), 'start');
        $this->assertContains('2026-10-20T08:00:00Z', $starts);
        $this->assertContains('2026-10-27T09:00:00Z', $starts);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', (string) $read->json('sync.last_synced_at'));
        Http::assertNothingSent();
    }

    public function test_sync_for_a_user_without_account_answers_not_connected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        Http::fake();
        $this->actingAs($user);

        // Act
        $response = $this->postJson(route('microsoft.meetings.sync', [], false), $this->window());

        // Assert
        $response->assertOk();
        $response->assertJsonPath('status', 'not_connected');
        Http::assertNothingSent();
    }
}
