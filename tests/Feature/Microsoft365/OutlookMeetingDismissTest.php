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
use Illuminate\Support\Carbon;
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
class OutlookMeetingDismissTest extends TestCaseWithDatabase
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
     * @param  array<string, mixed>  $extra
     */
    private function getMeetings(array $extra = []): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', [
            'start' => self::WINDOW_START,
            'end' => self::WINDOW_END,
        ] + $extra, false));
    }

    private function dismiss(string $id): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.dismiss', ['meeting' => $id], false));
    }

    public function test_dismiss_hides_the_meeting_and_is_idempotent(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $row = $this->meeting($user, 'one');
        $this->actingAs($user);

        // Act
        $first = $this->dismiss($row->id);
        $firstStamp = $row->refresh()->dismissed_at;
        Carbon::setTestNow(Carbon::now()->addMinutes(5));
        $second = $this->dismiss($row->id);
        $read = $this->getMeetings();

        // Assert
        $first->assertOk();
        $first->assertJsonPath('data.id', $row->id);
        $first->assertJsonPath('data.dismissed', true);
        $this->assertNotNull($firstStamp);
        $second->assertOk();
        $second->assertJsonPath('data.dismissed', true);
        $this->assertTrue($firstStamp->equalTo($row->refresh()->dismissed_at), 'the first dismissed_at is kept');
        $read->assertOk();
        $read->assertJsonCount(0, 'data');
    }

    public function test_dismiss_of_a_foreign_unknown_or_invalid_id_is_404(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $other = $this->createUser();
        $foreign = $this->meeting($other, 'foreign');
        $this->actingAs($user);

        // Act
        $foreignResponse = $this->dismiss($foreign->id);
        $unknownResponse = $this->dismiss('7b1b3a52-0d6f-4a53-9d0a-5c2f6a1e8f10');
        $invalidResponse = $this->dismiss('not-a-uuid');

        // Assert
        $foreignResponse->assertNotFound();
        $unknownResponse->assertNotFound();
        $invalidResponse->assertNotFound();
        $this->assertNull($foreign->refresh()->dismissed_at);
    }

    public function test_dismissal_survives_a_resync(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');
        $this->actingAs($user);
        $window = $this->fixtureWindow();
        $this->postJson(route('microsoft.meetings.sync', [], false), $window)->assertOk();
        $row = OutlookMeeting::query()->where('user_id', '=', $user->getKey())->orderBy('starts_at')->firstOrFail();
        $this->dismiss($row->id)->assertOk();
        $stamp = $row->refresh()->dismissed_at;

        // Act: a later sync of the same window returns the same occurrence again
        Carbon::setTestNow(Carbon::now()->addSeconds(61));
        $this->fakeGraphCalendar('A');
        $resync = $this->postJson(route('microsoft.meetings.sync', [], false), $window);

        // Assert
        $resync->assertOk();
        $resync->assertJsonPath('status', 'ok');
        $this->assertNotNull($stamp);
        $after = $row->refresh();
        $this->assertNotNull($after->dismissed_at);
        $this->assertTrue($stamp->equalTo($after->dismissed_at));
        $this->assertNull($after->gone_at);
    }

    public function test_dismiss_never_deletes_rows(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $row = $this->meeting($user, 'keep');
        $this->meeting($user, 'other');
        $this->actingAs($user);
        Http::fake();

        // Act
        $this->dismiss($row->id)->assertOk();

        // Assert
        $this->assertSame(2, OutlookMeeting::query()->count());
        Http::assertNothingSent();
    }
}
