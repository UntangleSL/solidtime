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
use App\Microsoft365\Suggestions\SeriesAssignmentResolver;
use App\Microsoft365\Suggestions\SeriesKey;
use App\Microsoft365\TimeEntries\CoreTimeEntryCreator;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
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
}
