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
use Illuminate\Support\Facades\Config;
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
        $this->connectedAccount($user);
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
        // One Http::fake for both syncs: a second Http::fake would not override the first, and an
        // exhausted sequence answers with an exception
        Config::set('microsoft365.graph.max_pages', 30);
        $sequence = Http::sequence();
        foreach ([1, 2] as $_round) {
            foreach ($this->graphPages('A') as $page) {
                $sequence->push($page);
            }
        }
        Http::fake(['https://graph.microsoft.com/v1.0/me/calendarView*' => $sequence]);
        $this->actingAs($user);
        $window = $this->fixtureWindow();
        $this->postJson(route('microsoft.meetings.sync', [], false), $window)->assertOk();
        $row = OutlookMeeting::query()->where('user_id', '=', $user->getKey())->orderBy('starts_at')->firstOrFail();
        $this->dismiss($row->id)->assertOk();
        $stamp = $row->refresh()->dismissed_at;

        // Act: a later sync of the same window returns the same occurrence again
        $this->travel(61)->seconds();
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

    private function restore(string $id): TestResponse
    {
        return $this->deleteJson(route('microsoft.meetings.restore', ['meeting' => $id], false));
    }

    public function test_restore_brings_the_meeting_back_and_is_idempotent(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $row = $this->meeting($user, 'back', ['dismissed_at' => '2026-10-19 08:00:00']);
        $this->actingAs($user);

        // Act
        $first = $this->restore($row->id);
        $second = $this->restore($row->id);
        $read = $this->getMeetings();

        // Assert
        $first->assertOk();
        $first->assertJsonPath('data.dismissed', false);
        $second->assertOk();
        $second->assertJsonPath('data.dismissed', false);
        $this->assertNull($row->refresh()->dismissed_at);
        $read->assertJsonCount(1, 'data');
        $read->assertJsonPath('data.0.id', $row->id);
    }

    public function test_restore_of_a_foreign_unknown_or_invalid_id_is_404(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $other = $this->createUser();
        $foreign = $this->meeting($other, 'foreign', ['dismissed_at' => '2026-10-19 08:00:00']);
        $this->actingAs($user);

        // Act
        $foreignResponse = $this->restore($foreign->id);
        $unknownResponse = $this->restore('7b1b3a52-0d6f-4a53-9d0a-5c2f6a1e8f10');
        $invalidResponse = $this->restore('not-a-uuid');

        // Assert
        $foreignResponse->assertNotFound();
        $unknownResponse->assertNotFound();
        $invalidResponse->assertNotFound();
        $this->assertNotNull($foreign->refresh()->dismissed_at);
    }

    public function test_include_dismissed_returns_dismissed_meetings_flagged(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->meeting($user, 'visible');
        $this->meeting($user, 'hidden', ['dismissed_at' => '2026-10-19 08:00:00', 'starts_at' => '2026-10-21 09:00:00', 'ends_at' => '2026-10-21 10:00:00']);
        $this->actingAs($user);

        // Act
        $default = $this->getMeetings();
        $included = $this->getMeetings(['include_dismissed' => '1']);
        $invalid = $this->getMeetings(['include_dismissed' => 'maybe']);

        // Assert
        $default->assertJsonCount(1, 'data');
        $default->assertJsonPath('data.0.subject', 'Subject visible');
        $included->assertOk();
        $included->assertJsonCount(2, 'data');
        $included->assertJsonPath('data.0.dismissed', false);
        $included->assertJsonPath('data.1.subject', 'Subject hidden');
        $included->assertJsonPath('data.1.dismissed', true);
        $invalid->assertStatus(422);
    }

    public function test_gone_meetings_are_never_returned(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $gone = $this->meeting($user, 'gone', ['gone_at' => '2026-10-19 08:00:00']);
        $goneDismissed = $this->meeting($user, 'gone-dismissed', ['gone_at' => '2026-10-19 08:00:00', 'dismissed_at' => '2026-10-19 08:00:00']);
        $this->actingAs($user);

        // Act
        $plain = $this->getMeetings();
        $included = $this->getMeetings(['include_dismissed' => '1']);

        // Assert
        $plain->assertJsonCount(0, 'data');
        $included->assertJsonCount(0, 'data');
        $this->dismiss($gone->id)->assertNotFound();
        $this->restore($goneDismissed->id)->assertNotFound();
        $this->assertNull($gone->refresh()->dismissed_at);
    }
}
