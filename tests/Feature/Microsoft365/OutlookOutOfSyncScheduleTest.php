<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365;

use App\Microsoft365\Console\CheckOutOfSyncCommand;
use App\Microsoft365\Microsoft365ServiceProvider;
use App\Microsoft365\MicrosoftConfig;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Config;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCaseWithDatabase;

/**
 * The daily out-of-sync check is scheduled from the fork's provider (D-11, D-13): no core Kernel edit,
 * 05:30 Europe/Madrid, never overlapping, and only while the integration is configured.
 */
#[CoversClass(Microsoft365ServiceProvider::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(CheckOutOfSyncCommand::class)]
class OutlookOutOfSyncScheduleTest extends TestCaseWithDatabase
{
    use InteractsWithMicrosoft365;

    /**
     * The scheduled events of the m365:check-out-of-sync command, from a freshly built Schedule: a module
     * provider may already have resolved the singleton during boot, before the test set its config.
     *
     * @return list<Event>
     */
    private function dailyChecks(): array
    {
        $this->app->forgetInstance(Schedule::class);
        $events = array_filter(
            app(Schedule::class)->events(),
            fn (Event $event): bool => is_string($event->command) && str_ends_with($event->command, 'm365:check-out-of-sync'),
        );

        return array_values($events);
    }

    public function test_daily_check_is_scheduled(): void
    {
        // Arrange
        $this->configureMicrosoft365();

        // Act
        $events = $this->dailyChecks();

        // Assert: one event, every day at 05:30 Madrid time, never two runs at once
        $this->assertCount(1, $events);
        $event = $events[0];
        $this->assertSame('30 5 * * *', $event->expression);
        $timezone = $event->timezone instanceof \DateTimeZone ? $event->timezone->getName() : $event->timezone;
        $this->assertSame('Europe/Madrid', $timezone);
        $this->assertTrue($event->withoutOverlapping);
        $this->assertTrue($event->filtersPass($this->app));
    }

    public function test_daily_check_never_runs_while_the_integration_is_not_configured(): void
    {
        // Arrange: the client secret is missing
        $this->configureMicrosoft365(null, ['client_secret' => null]);

        // Act
        $events = $this->dailyChecks();

        // Assert: the event exists but its filter keeps it from running
        $this->assertCount(1, $events);
        $this->assertFalse($events[0]->filtersPass($this->app));
    }

    public function test_daily_check_follows_the_configured_time_and_time_zone(): void
    {
        // Arrange: the time and time zone are read when Schedule is built
        $this->configureMicrosoft365();
        Config::set('microsoft365.out_of_sync.daily_at', '06:15');
        Config::set('microsoft365.out_of_sync.daily_timezone', 'UTC');

        // Act
        $events = $this->dailyChecks();

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('15 6 * * *', $events[0]->expression);
        $timezone = $events[0]->timezone instanceof \DateTimeZone ? $events[0]->timezone->getName() : $events[0]->timezone;
        $this->assertSame('UTC', $timezone);
    }
}
