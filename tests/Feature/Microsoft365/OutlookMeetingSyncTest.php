<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Graph\GraphCalendarClient;
use App\Microsoft365\Graph\OutlookMeetingEligibility;
use App\Microsoft365\Graph\OutlookMeetingSyncService;
use App\Microsoft365\Graph\SyncOutcome;
use App\Microsoft365\Graph\SyncStatus;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Models\Member;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithGraphFixtures;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

#[CoversClass(OutlookMeetingSyncService::class)]
#[UsesClass(GraphCalendarClient::class)]
#[UsesClass(OutlookMeetingEligibility::class)]
#[UsesClass(SyncOutcome::class)]
#[UsesClass(SyncStatus::class)]
#[UsesClass(MicrosoftAccount::class)]
#[UsesClass(OutlookMeeting::class)]
class OutlookMeetingSyncTest extends TestCaseWithDatabase
{
    use InteractsWithGraphFixtures;
    use InteractsWithMicrosoft365;

    private function createUser(): User
    {
        return User::factory()->withPersonalOrganization()->create();
    }

    private function fixtureStart(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->fixtureWindow()['start']);
    }

    private function fixtureEnd(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->fixtureWindow()['end']);
    }

    private function syncFixtureWindow(User $user): SyncOutcome
    {
        return app(OutlookMeetingSyncService::class)->sync($user, $this->fixtureStart(), $this->fixtureEnd());
    }

    public function test_sync_replays_round_a_and_stores_only_eligible_meetings(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $pages = $this->fakeGraphCalendar('A');

        // Act
        $outcome = $this->syncFixtureWindow($user);

        // Assert
        $this->assertSame(SyncStatus::Ok, $outcome->status);
        $this->assertFalse($outcome->truncated);
        $this->assertCount(22, $pages);
        Http::assertSentCount(22);
        $this->assertSame(12, OutlookMeeting::query()->where('user_id', '=', $user->getKey())->count());
        $this->assertSame(0, OutlookMeeting::query()->where('subject', 'like', '%S6]%')->count());
        $this->assertSame(0, OutlookMeeting::query()->where('subject', 'like', '%S7]%')->count());
        $this->assertSame(1, OutlookMeeting::query()->where('subject', 'like', '%S8]%')->count());
    }

    public function test_every_graph_request_carries_the_combined_prefer_header_and_bearer(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $recorded = Http::recorded();
        $this->assertCount(22, $recorded);
        foreach ($recorded as [$request]) {
            /** @var Request $request */
            $this->assertSame('GET', $request->method());
            $this->assertSame(['outlook.timezone="UTC", IdType="ImmutableId"'], $request->header('Prefer'));
            $this->assertSame(['Bearer at-marker-7f3c'], $request->header('Authorization'));
        }
        $firstUrl = $recorded[0][0]->url();
        $this->assertSame(
            'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-19T00%3A00%3A00Z'
            .'&endDateTime=2026-11-16T00%3A00%3A00Z'
            .'&$select=id,iCalUId,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,type,seriesMasterId,originalStart,organizer,showAs,sensitivity,webLink,isOnlineMeeting'
            .'&$orderby=start/dateTime&$top=100',
            $firstUrl
        );
    }

    public function test_s2_occurrences_are_stored_in_utc(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $starts = OutlookMeeting::query()
            ->where('subject', 'like', '%S2]%')
            ->orderBy('starts_at')
            ->get()
            ->map(fn (OutlookMeeting $meeting): string => $meeting->starts_at->format('Y-m-d H:i:s'))
            ->values()
            ->all();
        $this->assertCount(4, $starts);
        $this->assertSame('2026-10-20 08:00:00', $starts[0]);
        $this->assertSame('2026-10-27 09:00:00', $starts[1]);
    }

    public function test_sync_does_not_change_time_entries(): void
    {
        // Arrange
        $user = $this->createUser();
        $this->connectedAccount($user);
        $member = Member::query()->where('user_id', '=', $user->getKey())->firstOrFail();
        TimeEntry::factory()->forMember($member)->count(3)->create();
        $before = $this->timeEntrySnapshot();
        $this->fakeGraphCalendar('A');

        // Act
        $this->syncFixtureWindow($user);

        // Assert
        $this->assertCount(3, $before);
        $this->assertSame($before, $this->timeEntrySnapshot());
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function timeEntrySnapshot(): array
    {
        return TimeEntry::query()
            ->orderBy('id')
            ->get(['id', 'start', 'end', 'description', 'project_id', 'user_id', 'member_id', 'organization_id'])
            ->map(fn (TimeEntry $entry): array => $entry->getAttributes())
            ->all();
    }
}
