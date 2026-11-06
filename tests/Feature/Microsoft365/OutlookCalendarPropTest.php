<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Testing\Fluent\AssertableJson;
use Inertia\Inertia;
use Inertia\ResponseFactory;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(ShareMicrosoftInertiaData::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(MicrosoftAccount::class)]
class OutlookCalendarPropTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    public function test_connected_user_gets_state_urls_and_all_labels_on_the_calendar(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.calendar.state', 'connected')
            ->where('microsoft.calendar.urls.meetings', route('microsoft.meetings.index'))
            ->where('microsoft.calendar.urls.sync', route('microsoft.meetings.sync'))
            ->has('microsoft.calendar.labels', 34)
            ->where('microsoft.calendar.labels.no_subject', '(No subject)')
            ->where('microsoft.calendar.labels.last_synced', 'Last synced :time')
            ->where('microsoft.calendar.labels.sync', 'Sync Outlook')
            ->has('microsoft', fn (AssertableJson $microsoft) => $microsoft
                ->has('calendar', fn (AssertableJson $calendar) => $calendar
                    ->hasAll(['state', 'urls', 'connect_url', 'notice', 'labels'])
                    ->has('urls', fn (AssertableJson $urls) => $urls->hasAll(['meetings', 'sync'])))
                ->etc())
            ->etc());
    }

    public function test_calendar_carries_the_connect_url_with_the_calendar_return_target_and_no_notice(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $this->actingAs($this->createUser());

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.connect_url', route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar']))
            ->where('microsoft.calendar.notice', null)
            ->etc());
    }

    public function test_connect_notice_reaches_the_calendar_once_with_its_level(): void
    {
        // Arrange: a refused connect that started in the calendar flashes an error notice
        $this->configureMicrosoft365();
        $holder = $this->createUser();
        $this->connectedAccount($holder);
        $user = $this->createUser();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))
            ->assertRedirect(route('calendar', [], false));

        // Act
        $first = $this->get(route('calendar', [], false));
        $second = $this->get(route('calendar', [], false));

        // Assert
        $first->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.notice.level', 'error')
            ->where('microsoft.calendar.notice.message', __('microsoft365.error.identity_in_use'))
            ->etc());
        $second->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.notice', null)
            ->etc());
    }

    public function test_successful_connect_notice_reaches_the_calendar_as_success(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->reconnect_required_at = Carbon::now();
        $account->save();
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->actingAs($user);
        $this->get(route('microsoft.redirect', ['intent' => 'connect', 'return' => 'calendar'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))
            ->assertRedirect(route('calendar', [], false));

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.state', 'connected')
            ->where('microsoft.calendar.notice.level', 'success')
            ->where('microsoft.calendar.notice.message', __('microsoft365.ui.connected_notice'))
            ->etc());
    }

    public function test_notice_without_a_known_level_reads_as_success(): void
    {
        // Arrange: only the two levels of the notification store ever reach the page
        $this->configureMicrosoft365();
        $this->actingAs($this->createUser());

        // Act
        $response = $this->withSession(['microsoft365.notice' => 'Done.', 'microsoft365.notice_level' => 'critical'])
            ->get(route('calendar', [], false));

        // Assert
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.notice.level', 'success')
            ->where('microsoft.calendar.notice.message', 'Done.')
            ->etc());
    }

    public function test_user_without_an_account_gets_not_connected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $this->actingAs($this->createUser());

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.state', 'not_connected')
            ->has('microsoft.calendar.labels', 34)
            ->etc());
    }

    public function test_account_flagged_for_reconnect_gets_reconnect(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->reconnect_required_at = Carbon::now();
        $account->save();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.state', 'reconnect')
            ->etc());
    }

    public function test_disconnected_account_gets_not_connected(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $account = $this->connectedAccount($user);
        $account->access_token = null;
        $account->refresh_token = null;
        $account->disconnected_at = Carbon::now();
        $account->save();
        $this->actingAs($user);

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.calendar.state', 'not_connected')
            ->etc());
    }

    public function test_other_pages_carry_no_calendar_block(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);

        // Act
        $dashboard = $this->get(route('dashboard', [], false));
        $time = $this->get(route('time', [], false));

        // Assert
        foreach ([$dashboard, $time] as $response) {
            $response->assertStatus(200);
            $response->assertInertia(fn (AssertableInertia $page) => $page
                ->where('microsoft.enabled', true)
                ->missing('microsoft.calendar')
                ->etc());
        }
    }

    public function test_unconfigured_integration_carries_no_calendar_block(): void
    {
        // Arrange
        $this->configureMicrosoft365(null, ['client_id' => null]);
        $this->actingAs($this->createUser());

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', false)
            ->missing('microsoft.calendar')
            ->etc());
    }

    public function test_calendar_payload_never_carries_tokens_or_meeting_data(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);
        // A plain request first, so the Inertia middleware has registered the asset version
        $this->get(route('calendar', [], false))->assertStatus(200);
        $headers = ['X-Inertia' => 'true', 'X-Inertia-Version' => Inertia::getVersion()];

        // Act
        $response = $this->get(route('calendar', [], false), $headers);

        // Assert
        $response->assertStatus(200);
        $response->assertHeader('X-Inertia', 'true');
        $content = (string) $response->getContent();
        $this->assertStringContainsString('"calendar"', $content);
        $this->assertStringNotContainsString('at-marker-7f3c', $content);
        $this->assertStringNotContainsString('rt-marker-9d1e', $content);
        $this->assertStringNotContainsString('access_token', $content);
        $this->assertStringNotContainsString('refresh_token', $content);
        $this->assertStringNotContainsString('graph_backoff_until', $content);
    }

    public function test_calendar_block_survives_inertia_flush_between_requests(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);
        $first = $this->get(route('calendar', [], false));

        // Act: what Octane does between two requests
        app(ResponseFactory::class)->flushShared();
        $second = $this->get(route('calendar', [], false));

        // Assert
        foreach ([$first, $second] as $response) {
            $response->assertInertia(fn (AssertableInertia $page) => $page
                ->where('microsoft.calendar.state', 'connected')
                ->has('microsoft.calendar.labels', 34)
                ->etc());
        }
    }
}
