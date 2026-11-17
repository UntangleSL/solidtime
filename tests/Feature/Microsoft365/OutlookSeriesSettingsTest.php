<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Enums\Role;
use App\Http\Controllers\Api\V1\TimeEntryController;
use App\Http\Requests\V1\TimeEntry\TimeEntryStoreRequest;
use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\MicrosoftTokenService;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Http\Controllers\MeetingConversionController;
use App\Microsoft365\Http\Controllers\MicrosoftAccountController;
use App\Microsoft365\Http\Controllers\MicrosoftAuthController;
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
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Service\DeletionService;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use STS\FilamentImpersonate\ImpersonateManager;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * Series controls (Phase 5 RULE-04, RULE-05): "Always ignore this series" hides every occurrence of a
 * recurring meeting from the calendar read until "Stop ignoring" (D-10, D-18), and "Forget this series"
 * drops its pre-assignment until the next conversion (D-11). Both act only on the session user's own
 * meetings, answer 404 without an oracle (D-14), never touch a time entry (D-12) and keep ids and
 * times only, surviving Disconnect (D-17).
 */
#[CoversClass(OutlookSeriesController::class)]
#[CoversClass(OutlookSeriesSetting::class)]
#[UsesClass(OutlookMeetingController::class)]
#[UsesClass(SeriesAssignmentResolver::class)]
#[UsesClass(BookableProjects::class)]
#[UsesClass(Assignment::class)]
#[UsesClass(MeetingHints::class)]
#[UsesClass(SeriesKey::class)]
#[UsesClass(OutlookMeetingResource::class)]
#[UsesClass(MeetingRangeRequest::class)]
#[UsesClass(MeetingConversionController::class)]
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
#[UsesClass(MicrosoftAccountController::class)]
#[UsesClass(MicrosoftAuthController::class)]
#[UsesClass(MicrosoftTokenService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(OutlookMeetingSyncService::class)]
class OutlookSeriesSettingsTest extends TestCaseWithDatabase
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
     * An occurrence of a recurring series on the given day, 09:00-10:00 UTC.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function occurrence(User $user, string $graphId, string $day, string $series = self::SERIES, array $overrides = []): OutlookMeeting
    {
        return $this->meeting($user, $graphId, array_merge([
            'event_type' => 'occurrence',
            'series_master_id' => $series,
            'original_start' => $day.' 09:00:00',
            'starts_at' => $day.' 09:00:00',
            'ends_at' => $day.' 10:00:00',
        ], $overrides));
    }

    /**
     * Occurrences A (Tue), B (Thu) and C (Mon) of SERIES plus a single meeting D (Wed) in the week.
     *
     * @return array{a: OutlookMeeting, b: OutlookMeeting, c: OutlookMeeting, d: OutlookMeeting}
     */
    private function week(User $user): array
    {
        return [
            'a' => $this->occurrence($user, 'occ-a', '2026-10-20'),
            'b' => $this->occurrence($user, 'occ-b', '2026-10-22'),
            'c' => $this->occurrence($user, 'occ-c', '2026-10-19'),
            'd' => $this->meeting($user, 'single-d', ['starts_at' => '2026-10-21 11:00:00', 'ends_at' => '2026-10-21 12:00:00']),
        ];
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function read(array $extra = []): TestResponse
    {
        return $this->getJson(route('microsoft.meetings.index', [
            'start' => self::WEEK_START,
            'end' => self::WEEK_END,
        ] + $extra, false));
    }

    private function ignore(string $id): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.series.ignore', ['meeting' => $id], false));
    }

    private function unignore(string $id): TestResponse
    {
        return $this->deleteJson(route('microsoft.meetings.series.unignore', ['meeting' => $id], false));
    }

    private function forget(string $id): TestResponse
    {
        return $this->deleteJson(route('microsoft.meetings.series.forget', ['meeting' => $id], false));
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function convert(Organization $organization, array $body): TestResponse
    {
        return $this->postJson(route('microsoft.meetings.convert', ['organization' => $organization->getKey()], false), $body);
    }

    /**
     * Converts one meeting to a project (no task, no tags, not billable) and returns the entry id.
     */
    private function convertTo(Organization $organization, OutlookMeeting $meeting, Project $project): string
    {
        $response = $this->convert($organization, [
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

    private function startImpersonation(): void
    {
        // The session key of stechstudio/filament-impersonate: the id of the admin who impersonates
        session()->put(ImpersonateManager::SESSION_KEY, 1);
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

    private function assignedProjectOf(TestResponse $response, OutlookMeeting $meeting): ?string
    {
        $assignment = $this->item($response, $meeting)['assignment'];
        if ($assignment === null) {
            return null;
        }
        $this->assertIsArray($assignment);
        $this->assertIsString($assignment['project_id']);

        return $assignment['project_id'];
    }

    /**
     * @return list<string>
     */
    private function ids(TestResponse $response): array
    {
        $ids = $response->json('data.*.id');
        $this->assertIsArray($ids);

        return array_values(array_map(fn (mixed $id): string => (string) $id, $ids));
    }

    private function settingOf(User $user, string $series = self::SERIES): ?OutlookSeriesSetting
    {
        return OutlookSeriesSetting::query()
            ->where('user_id', '=', $user->getKey())
            ->where('series_master_id', '=', $series)
            ->first();
    }

    public function test_ignoring_a_series_hides_all_its_occurrences(): void
    {
        // Arrange
        $data = $this->employee();
        $week = $this->week($data->user);

        // Act
        $response = $this->ignore($week['b']->id);
        $read = $this->read();

        // Assert
        $response->assertNoContent();
        $read->assertOk();
        $this->assertSame([$week['d']->id], $this->ids($read));
        $this->assertSame(1, OutlookSeriesSetting::query()->count());
        $setting = $this->settingOf($data->user);
        $this->assertNotNull($setting);
        $this->assertNotNull($setting->ignored_at);
        $this->assertNull($setting->forgotten_at);
    }

    public function test_stop_ignoring_brings_the_series_back(): void
    {
        // Arrange
        $data = $this->employee();
        $week = $this->week($data->user);
        $this->ignore($week['b']->id)->assertNoContent();
        $this->assertSame([$week['d']->id], $this->ids($this->read()));

        // Act
        $response = $this->unignore($week['b']->id);
        $again = $this->unignore($week['b']->id);
        $read = $this->read();

        // Assert
        $response->assertNoContent();
        $again->assertNoContent();
        $read->assertOk();
        $this->assertEqualsCanonicalizing(
            [$week['a']->id, $week['b']->id, $week['c']->id, $week['d']->id],
            $this->ids($read),
        );
        foreach (['a', 'b', 'c', 'd'] as $key) {
            $this->assertFalse($this->item($read, $week[$key])['series_ignored'], $key);
        }
        $setting = $this->settingOf($data->user);
        $this->assertNotNull($setting);
        $this->assertNull($setting->ignored_at);
    }

    public function test_stop_ignoring_a_series_that_was_never_ignored_is_a_no_op(): void
    {
        // Arrange
        $data = $this->employee();
        $week = $this->week($data->user);

        // Act
        $response = $this->unignore($week['a']->id);

        // Assert
        $response->assertNoContent();
        $this->assertSame(0, OutlookSeriesSetting::query()->count());
        $this->assertCount(4, $this->ids($this->read()));
    }

    public function test_ignored_occurrences_come_back_faded_with_include_dismissed(): void
    {
        // Arrange: the series was converted before (occurrence E), A is dismissed on its own
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $week = $this->week($data->user);
        $e = $this->occurrence($data->user, 'occ-e', '2026-10-23');
        $this->convertTo($data->organization, $e, $project);
        $this->assertSame($project->getKey(), $this->assignedProjectOf($this->read(), $week['b']));
        $this->postJson(route('microsoft.meetings.dismiss', ['meeting' => $week['a']->id], false))->assertOk();

        // Act
        $this->ignore($week['b']->id)->assertNoContent();
        $hidden = $this->read();
        $included = $this->read(['include_dismissed' => '1']);

        // Assert
        $this->assertSame([$week['d']->id], $this->ids($hidden));
        $included->assertOk();
        $this->assertEqualsCanonicalizing(
            [$week['a']->id, $week['b']->id, $week['c']->id, $week['d']->id],
            $this->ids($included),
        );
        foreach (['a', 'b', 'c'] as $key) {
            $item = $this->item($included, $week[$key]);
            $this->assertTrue($item['series_ignored'], $key);
            $this->assertNull($item['assignment'], $key);
        }
        $this->assertTrue($this->item($included, $week['a'])['dismissed']);
        $this->assertFalse($this->item($included, $week['b'])['dismissed']);
        $this->assertFalse($this->item($included, $week['c'])['dismissed']);
        $this->assertFalse($this->item($included, $week['d'])['series_ignored']);
        $this->assertFalse($this->item($included, $week['d'])['dismissed']);
    }

    public function test_ignore_is_idempotent(): void
    {
        // Arrange
        $data = $this->employee();
        $week = $this->week($data->user);
        $this->ignore($week['a']->id)->assertNoContent();
        $first = $this->settingOf($data->user)?->ignored_at;
        $this->assertNotNull($first);

        // Act
        $this->travel(5)->minutes();
        $second = $this->ignore($week['c']->id);

        // Assert
        $second->assertNoContent();
        $this->assertSame(1, OutlookSeriesSetting::query()->count());
        $this->assertTrue($first->equalTo($this->settingOf($data->user)?->ignored_at), 'the first ignored_at is kept');
        $this->assertSame([$week['d']->id], $this->ids($this->read()));
    }

    public function test_forget_drops_the_pre_assignment_until_the_next_conversion(): void
    {
        // Arrange: A converted to the first project, so B and C come pre-assigned
        $data = $this->employee();
        $first = $this->publicProject($data->organization);
        $second = $this->publicProject($data->organization);
        $week = $this->week($data->user);
        $entryA = $this->convertTo($data->organization, $week['a'], $first);
        $before = $this->read();
        $this->assertSame($first->getKey(), $this->assignedProjectOf($before, $week['b']));
        $this->assertSame($first->getKey(), $this->assignedProjectOf($before, $week['c']));

        // Act: forget through B, then a minute later convert C to the second project
        $forget = $this->forget($week['b']->id);
        $forgotten = $this->read();
        $this->travel(1)->minutes();
        $this->convertTo($data->organization, $week['c'], $second);
        $after = $this->read();

        // Assert: the forget hides the history up to then; the next conversion pre-assigns again (D-11, D-05)
        $forget->assertNoContent();
        $this->assertNull($this->assignedProjectOf($forgotten, $week['b']));
        $this->assertNull($this->assignedProjectOf($forgotten, $week['c']));
        $this->assertFalse($this->item($forgotten, $week['b'])['series_ignored']);
        $this->assertSame($second->getKey(), $this->assignedProjectOf($after, $week['b']));
        $setting = $this->settingOf($data->user);
        $this->assertNotNull($setting);
        $this->assertNotNull($setting->forgotten_at);
        $this->assertNull($setting->ignored_at);
        // The entry behind the forgotten conversion is untouched (D-12)
        $this->assertSame($first->getKey(), TimeEntry::query()->findOrFail($entryA)->project_id);
    }

    public function test_every_forget_moves_the_moment_forward(): void
    {
        // Arrange: forgotten once, then converted again a minute later (pre-assigned again)
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $week = $this->week($data->user);
        $this->forget($week['b']->id)->assertNoContent();
        $firstForget = $this->settingOf($data->user)?->forgotten_at;
        $this->assertNotNull($firstForget);
        $this->travel(1)->minutes();
        $this->convertTo($data->organization, $week['a'], $project);
        $this->assertSame($project->getKey(), $this->assignedProjectOf($this->read(), $week['b']));

        // Act
        $this->travel(1)->minutes();
        $again = $this->forget($week['c']->id);

        // Assert
        $again->assertNoContent();
        $secondForget = $this->settingOf($data->user)?->forgotten_at;
        $this->assertNotNull($secondForget);
        $this->assertTrue($secondForget->greaterThan($firstForget));
        $this->assertSame(1, OutlookSeriesSetting::query()->count());
        $this->assertNull($this->assignedProjectOf($this->read(), $week['b']));
    }

    public function test_series_routes_answer_404_without_an_oracle(): void
    {
        // Arrange
        $data = $this->employee();
        $own = $this->occurrence($data->user, 'own-occ', '2026-10-20');
        $gone = $this->occurrence($data->user, 'gone-occ', '2026-10-21', 'series-gone', ['gone_at' => '2026-10-19 08:00:00']);
        $single = $this->meeting($data->user, 'single', ['starts_at' => '2026-10-22 11:00:00', 'ends_at' => '2026-10-22 12:00:00']);
        $other = User::factory()->create();
        $this->connectedAccount($other, objectId: '00000000-0000-4000-8000-0000000006c2');
        $foreign = $this->occurrence($other, 'foreign-occ', '2026-10-20');
        $calls = [
            'ignore' => fn (string $id): TestResponse => $this->ignore($id),
            'unignore' => fn (string $id): TestResponse => $this->unignore($id),
            'forget' => fn (string $id): TestResponse => $this->forget($id),
        ];

        // Act + Assert: the same 404 for every id that is not the user's own live occurrence
        foreach ($calls as $name => $call) {
            $call($foreign->id)->assertNotFound();
            $call('7b1b3a52-0d6f-4a53-9d0a-5c2f6a1e8f10')->assertNotFound();
            $call($gone->id)->assertNotFound();
            $call($single->id)->assertNotFound();
            $call('not-a-uuid')->assertNotFound();
            $this->assertSame(0, OutlookSeriesSetting::query()->count(), $name);
        }
        // Impersonating the user: even their own occurrence is a 404 (D-14)
        $this->startImpersonation();
        foreach ($calls as $name => $call) {
            $call($own->id)->assertNotFound();
            $this->assertSame(0, OutlookSeriesSetting::query()->count(), $name.' while impersonating');
        }
    }

    public function test_series_routes_are_web_session_routes(): void
    {
        // Arrange
        $methods = [
            'microsoft.meetings.series.ignore' => 'POST',
            'microsoft.meetings.series.unignore' => 'DELETE',
            'microsoft.meetings.series.forget' => 'DELETE',
        ];

        // Assert
        foreach ($methods as $name => $method) {
            $route = Route::getRoutes()->getByName($name);
            $this->assertNotNull($route, $name);
            $this->assertStringStartsWith('m365/meetings/{meeting}/series', $route->uri());
            $this->assertStringStartsNotWith('api/', $route->uri());
            $this->assertSame(['meeting'], $route->parameterNames());
            $this->assertContains($method, $route->methods(), $name);
            $middleware = $route->gatherMiddleware();
            foreach (['web', 'auth:web', 'auth.session', 'verified'] as $expected) {
                $this->assertContains($expected, $middleware, $name);
            }
            $throttles = array_filter(
                $middleware,
                fn (mixed $entry): bool => is_string($entry) && str_starts_with($entry, 'throttle:') && str_contains($entry, 'm365-series'),
            );
            $this->assertCount(1, $throttles, $name);
        }
    }

    public function test_series_settings_survive_disconnect(): void
    {
        // Arrange: the series is ignored
        $data = $this->employee();
        $week = $this->week($data->user);
        $this->ignore($week['b']->id)->assertNoContent();

        // Act: Disconnect Microsoft (purges the cached meetings), reconnect, the meetings come back
        $this->delete(route('microsoft.account.destroy', [], false))->assertRedirect(route('profile.show', [], false));
        $meetingsAfterDisconnect = OutlookMeeting::query()->where('user_id', '=', $data->user->getKey())->count();
        $settingAfterDisconnect = $this->settingOf($data->user);
        $this->fakeMicrosoftGateway()->willReturn($this->microsoftIdentity());
        $this->get(route('microsoft.redirect', ['intent' => 'connect'], false))->assertRedirect();
        $this->get(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state'], false))->assertRedirect();
        $recreated = $this->week($data->user);
        $read = $this->read();

        // Assert: the setting outlived Disconnect and still hides the re-created series (D-17)
        $this->assertSame(0, $meetingsAfterDisconnect);
        $this->assertNotNull($settingAfterDisconnect);
        $this->assertNotNull($settingAfterDisconnect->ignored_at);
        $read->assertOk();
        $this->assertSame([$recreated['d']->id], $this->ids($read));
    }

    public function test_settings_are_deleted_with_the_user(): void
    {
        // Arrange: the user ignored and forgot a series; another user has a setting of the same series id
        $data = $this->employee();
        $week = $this->week($data->user);
        $this->ignore($week['a']->id)->assertNoContent();
        $this->forget($week['a']->id)->assertNoContent();
        $other = User::factory()->create();
        OutlookSeriesSetting::query()->create([
            'user_id' => $other->getKey(),
            'series_master_id' => self::SERIES,
            'ignored_at' => '2026-10-19 08:00:00',
        ]);

        // Act
        app(DeletionService::class)->deleteUser($data->user);

        // Assert: the database cascade removed the user's rows only
        $this->assertSame(0, OutlookSeriesSetting::query()->where('user_id', '=', $data->user->getKey())->count());
        $this->assertSame(1, OutlookSeriesSetting::query()->where('user_id', '=', $other->getKey())->count());
    }

    public function test_converting_an_ignored_occurrence_keeps_the_series_ignored(): void
    {
        // Arrange: the series is ignored
        $data = $this->employee();
        $project = $this->publicProject($data->organization);
        $week = $this->week($data->user);
        $this->ignore($week['a']->id)->assertNoContent();
        $ignoredAt = $this->settingOf($data->user)?->ignored_at;
        $this->assertNotNull($ignoredAt);

        // Act: one occurrence is converted explicitly a minute later (D-18)
        $this->travel(1)->minutes();
        $convert = $this->convert($data->organization, [
            'meeting_ids' => [$week['b']->id],
            'project_id' => $project->getKey(),
            'billable' => false,
        ]);
        $read = $this->read();

        // Assert: created, the series is still ignored and its other occurrences stay hidden
        $convert->assertOk();
        $convert->assertJsonPath('results.0.status', 'created');
        $this->assertTrue($ignoredAt->equalTo($this->settingOf($data->user)?->ignored_at), 'ignored_at is unchanged');
        $read->assertOk();
        $this->assertSame([$week['d']->id], $this->ids($read));
    }
}
