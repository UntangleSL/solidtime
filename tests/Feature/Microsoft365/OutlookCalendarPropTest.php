<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Http\Middleware\ShareMicrosoftInertiaData;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\Fluent\AssertableJson;
use Inertia\Inertia;
use Inertia\ResponseFactory;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Symfony\Component\HttpFoundation\Response;
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
        $this->assertNotNull($user->current_team_id);
        $response->assertStatus(200);
        $response->assertInertia(fn (AssertableInertia $page) => $page
            ->where('microsoft.enabled', true)
            ->where('microsoft.calendar.state', 'connected')
            ->where('microsoft.calendar.urls.meetings', route('microsoft.meetings.index'))
            ->where('microsoft.calendar.urls.sync', route('microsoft.meetings.sync'))
            ->where('microsoft.calendar.urls.convert', route('microsoft.meetings.convert', ['organization' => $user->current_team_id]))
            ->where('microsoft.calendar.urls.out_of_sync', url('m365/out-of-sync'))
            ->where('microsoft.calendar.urls.organization_meetings', url('m365/organizations/'.$user->current_team_id.'/meetings'))
            ->has('microsoft.calendar.labels', 178)
            ->where('microsoft.calendar.labels.no_subject', '(No subject)')
            ->where('microsoft.calendar.labels.last_synced', 'Last synced :time')
            ->where('microsoft.calendar.labels.sync', 'Sync Outlook')
            ->has('microsoft', fn (AssertableJson $microsoft) => $microsoft
                ->has('calendar', fn (AssertableJson $calendar) => $calendar
                    ->hasAll(['state', 'urls', 'connect_url', 'notice', 'labels'])
                    ->has('urls', fn (AssertableJson $urls) => $urls->hasAll(['meetings', 'sync', 'convert', 'out_of_sync', 'organization_meetings'])))
                ->etc())
            ->etc());
    }

    public function test_out_of_sync_urls_match_the_routes_the_client_builds(): void
    {
        // Arrange
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->actingAs($user);
        $entryId = '00000000-0000-4000-8000-000000000e01';
        $meetingId = '00000000-0000-4000-8000-000000000e02';

        // Act
        $response = $this->get(route('calendar', [], false));

        // Assert: base + /{entry}/keep|adjust and base + /{meeting}/move-entry are the named routes
        $response->assertStatus(200);
        $response->assertInertia(function (AssertableInertia $page) use ($entryId, $meetingId, $user): void {
            $urls = $page->toArray()['props']['microsoft']['calendar']['urls'];
            $this->assertSame(route('microsoft.meetings.out-of-sync.keep', ['entry' => $entryId]), $urls['out_of_sync'].'/'.$entryId.'/keep');
            $this->assertSame(route('microsoft.meetings.out-of-sync.adjust', ['entry' => $entryId]), $urls['out_of_sync'].'/'.$entryId.'/adjust');
            $this->assertSame(
                route('microsoft.meetings.move-entry', ['organization' => $user->current_team_id, 'meeting' => $meetingId]),
                $urls['organization_meetings'].'/'.$meetingId.'/move-entry',
            );
        });
    }

    public function test_organization_urls_are_null_without_a_current_organization(): void
    {
        // Arrange: the shared closure, evaluated for the calendar route, for a user without a current team
        $this->configureMicrosoft365();
        $user = $this->createUser();
        $user->current_team_id = null;
        $this->actingAs($user);
        $request = Request::create('/calendar', 'GET');
        $request->setLaravelSession(app('session.store'));
        $request->setRouteResolver(fn (): ?RoutingRoute => Route::getRoutes()->getByName('calendar'));

        // Act
        app(ShareMicrosoftInertiaData::class)->handle($request, fn (): Response => new Response);
        $shared = Inertia::getShared('microsoft');
        $this->assertInstanceOf(Closure::class, $shared);
        $microsoft = $shared();

        // Assert
        $this->assertIsArray($microsoft);
        $urls = $microsoft['calendar']['urls'];
        $this->assertNull($urls['convert']);
        $this->assertNull($urls['organization_meetings']);
        $this->assertSame(url('m365/out-of-sync'), $urls['out_of_sync']);
        $this->assertSame(route('microsoft.meetings.index'), $urls['meetings']);
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
            ->has('microsoft.calendar.labels', 178)
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
                ->has('microsoft.calendar.labels', 178)
                ->etc());
        }
    }
}
