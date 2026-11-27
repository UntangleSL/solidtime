<?php

declare(strict_types=1);

namespace Tests\Unit\Profitability;

use App\Profitability\Enums\ContractSchedule;
use App\Profitability\Periods\PeriodBounds;
use App\Profitability\Periods\PeriodCalendar;
use Carbon\CarbonImmutable;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The contract period grid (D-03, D-04, D-15, D-18), proven without a database: every date is passed
 * in, there is no clock.
 */
#[CoversClass(PeriodCalendar::class)]
#[CoversClass(PeriodBounds::class)]
#[CoversClass(ContractSchedule::class)]
class PeriodCalendarTest extends TestCase
{
    private function date(string $value): CarbonImmutable
    {
        return CarbonImmutable::parse($value, 'UTC');
    }

    private function bounds(string $startsOn, string $endsOn, bool $isStub = false): PeriodBounds
    {
        return new PeriodBounds($this->date($startsOn), $this->date($endsOn), $isStub);
    }

    /**
     * @return array{0: string, 1: string, 2: bool}
     */
    private function flat(?PeriodBounds $bounds): array
    {
        $this->assertNotNull($bounds);

        return [$bounds->startsOn->format('Y-m-d'), $bounds->endsOn->format('Y-m-d'), $bounds->isStub];
    }

    /**
     * @return array<string, array{0: ContractSchedule, 1: string, 2: string|null, 3: array{0: string, 1: string, 2: bool}}>
     */
    public static function firstPeriods(): array
    {
        return [
            'monthly from the 1st' => [ContractSchedule::Monthly, '2026-11-01', null, ['2026-11-01', '2026-11-30', false]],
            'monthly from the 15th is a stub' => [ContractSchedule::Monthly, '2026-11-15', null, ['2026-11-15', '2026-11-30', true]],
            'quarterly from the 15th is a stub' => [ContractSchedule::Quarterly, '2026-11-15', null, ['2026-11-15', '2026-11-30', true]],
            'quarterly from the 1st' => [ContractSchedule::Quarterly, '2026-11-01', null, ['2026-11-01', '2027-01-31', false]],
            'annual from January' => [ContractSchedule::Annual, '2026-01-01', null, ['2026-01-01', '2026-12-31', false]],
            'annual from March into a leap February' => [ContractSchedule::Annual, '2027-03-01', null, ['2027-03-01', '2028-02-29', false]],
            'monthly from the 31st' => [ContractSchedule::Monthly, '2026-12-31', null, ['2026-12-31', '2026-12-31', true]],
            'monthly stub in a leap February' => [ContractSchedule::Monthly, '2028-02-10', null, ['2028-02-10', '2028-02-29', true]],
            'one-off runs start to end' => [ContractSchedule::OneOff, '2026-11-15', '2027-03-31', ['2026-11-15', '2027-03-31', false]],
        ];
    }

    /**
     * @param  array{0: string, 1: string, 2: bool}  $expected
     */
    #[DataProvider('firstPeriods')]
    public function test_first_period(ContractSchedule $schedule, string $startsOn, ?string $endsOn, array $expected): void
    {
        $calendar = new PeriodCalendar;

        $first = $calendar->first($schedule, $this->date($startsOn), $endsOn === null ? null : $this->date($endsOn));

        $this->assertSame($expected, $this->flat($first));
    }

    /**
     * @return array<string, array{0: ContractSchedule, 1: array{0: string, 1: string}, 2: string|null, 3: string|null, 4: array{0: string, 1: string, 2: bool}|null}>
     */
    public static function nextPeriods(): array
    {
        return [
            'quarterly after a stub' => [ContractSchedule::Quarterly, ['2026-11-15', '2026-11-30'], null, null, ['2026-12-01', '2027-02-28', false]],
            'monthly into a leap February' => [ContractSchedule::Monthly, ['2028-01-01', '2028-01-31'], null, null, ['2028-02-01', '2028-02-29', false]],
            'monthly December to January' => [ContractSchedule::Monthly, ['2026-12-01', '2026-12-31'], null, null, ['2027-01-01', '2027-01-31', false]],
            'annual across the year' => [ContractSchedule::Annual, ['2026-01-01', '2026-12-31'], null, null, ['2027-01-01', '2027-12-31', false]],
            'starts on the end date' => [ContractSchedule::Monthly, ['2026-11-01', '2026-11-30'], '2026-12-01', null, ['2026-12-01', '2026-12-31', false]],
            'stops after the end date' => [ContractSchedule::Monthly, ['2026-11-01', '2026-11-30'], '2026-11-30', null, null],
            'resume skips the paused months' => [ContractSchedule::Monthly, ['2027-02-01', '2027-02-28'], null, '2027-05-01', ['2027-05-01', '2027-05-31', false]],
            'resume in the past changes nothing' => [ContractSchedule::Monthly, ['2027-06-01', '2027-06-30'], null, '2027-05-01', ['2027-07-01', '2027-07-31', false]],
            'resume mid-month gives a stub' => [ContractSchedule::Quarterly, ['2027-01-01', '2027-03-31'], null, '2027-05-10', ['2027-05-10', '2027-05-31', true]],
            'resume after the end date stops' => [ContractSchedule::Monthly, ['2027-02-01', '2027-02-28'], '2027-04-30', '2027-05-01', null],
            'one-off never renews' => [ContractSchedule::OneOff, ['2026-11-15', '2027-03-31'], '2027-03-31', null, null],
        ];
    }

    /**
     * @param  array{0: string, 1: string}  $previous
     * @param  array{0: string, 1: string, 2: bool}|null  $expected
     */
    #[DataProvider('nextPeriods')]
    public function test_next_period(ContractSchedule $schedule, array $previous, ?string $endsOn, ?string $resumeOn, ?array $expected): void
    {
        $calendar = new PeriodCalendar;

        $next = $calendar->next(
            $schedule,
            $this->bounds($previous[0], $previous[1]),
            $endsOn === null ? null : $this->date($endsOn),
            $resumeOn === null ? null : $this->date($resumeOn),
        );

        if ($expected === null) {
            $this->assertNull($next);
        } else {
            $this->assertSame($expected, $this->flat($next));
        }
    }

    public function test_one_off_first_without_end_date_is_refused(): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new PeriodCalendar)->first(ContractSchedule::OneOff, $this->date('2026-11-15'), null);
    }

    public function test_months_lists_the_first_day_of_every_month_touched(): void
    {
        $calendar = new PeriodCalendar;
        $format = fn (array $months): array => array_map(fn (CarbonImmutable $month): string => $month->format('Y-m-d'), $months);

        $this->assertSame(
            ['2026-12-01', '2027-01-01', '2027-02-01'],
            $format($calendar->months($this->bounds('2026-12-01', '2027-02-28'))),
        );
        $this->assertSame(
            ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'],
            $format($calendar->months($this->bounds('2026-11-15', '2027-03-31'))),
        );
        $this->assertSame(['2026-11-01'], $format($calendar->months($this->bounds('2026-11-15', '2026-11-30', true))));
    }

    public function test_stub_days(): void
    {
        $calendar = new PeriodCalendar;

        $this->assertSame(['days' => 16, 'of' => 30], $calendar->stubDays($this->date('2026-11-15')));
        $this->assertSame(['days' => 1, 'of' => 31], $calendar->stubDays($this->date('2026-12-31')));
        $this->assertSame(['days' => 20, 'of' => 29], $calendar->stubDays($this->date('2028-02-10')));
        $this->assertSame(['days' => 30, 'of' => 30], $calendar->stubDays($this->date('2026-11-01')));
    }

    /**
     * @return array<string, array{0: int, 1: ContractSchedule, 2: string, 3: int}>
     */
    public static function proratedSeconds(): array
    {
        return [
            'monthly 40 h from the 15th of November' => [144000, ContractSchedule::Monthly, '2026-11-15', 77400],
            'quarterly 120 h from the 15th of November' => [432000, ContractSchedule::Quarterly, '2026-11-15', 77400],
            'annual 480 h from the 15th of November' => [1728000, ContractSchedule::Annual, '2026-11-15', 77400],
            'one day of a 31-day month rounds to the half hour' => [144000, ContractSchedule::Monthly, '2026-12-31', 5400],
            'zero stays zero' => [0, ContractSchedule::Monthly, '2026-11-15', 0],
            'one-off is never prorated' => [144000, ContractSchedule::OneOff, '2026-11-15', 144000],
        ];
    }

    #[DataProvider('proratedSeconds')]
    public function test_prorate_seconds(int $perPeriod, ContractSchedule $schedule, string $startsOn, int $expected): void
    {
        $this->assertSame($expected, (new PeriodCalendar)->prorateSeconds($perPeriod, $schedule, $this->date($startsOn)));
    }

    public function test_prorated_seconds_are_whole_half_hours(): void
    {
        $calendar = new PeriodCalendar;
        foreach ([1, 2, 10, 15, 28, 31] as $day) {
            $seconds = $calendar->prorateSeconds(100000, ContractSchedule::Monthly, $this->date(sprintf('2026-12-%02d', $day)));
            $this->assertSame(0, $seconds % PeriodCalendar::HOUR_STEP_SECONDS, 'day '.$day);
        }
    }

    public function test_prorate_cents(): void
    {
        $calendar = new PeriodCalendar;

        $this->assertSame(160000, $calendar->prorateCents(300000, ContractSchedule::Monthly, $this->date('2026-11-15')));
        $this->assertSame(160000, $calendar->prorateCents(900000, ContractSchedule::Quarterly, $this->date('2026-11-15')));
        // 100000 x 1 / 31 = 3225.8 cents
        $this->assertSame(3226, $calendar->prorateCents(100000, ContractSchedule::Monthly, $this->date('2026-12-31')));
        $this->assertSame(300000, $calendar->prorateCents(300000, ContractSchedule::OneOff, $this->date('2026-11-15')));
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function states(): array
    {
        return [
            'before the start' => ['2026-10-31', 'upcoming'],
            'on the start' => ['2026-11-01', 'current'],
            'inside' => ['2026-11-18', 'current'],
            'on the end date (inclusive)' => ['2026-11-30', 'current'],
            'after the end' => ['2026-12-01', 'closed'],
        ];
    }

    #[DataProvider('states')]
    public function test_state_on(string $today, string $expected): void
    {
        $this->assertSame(
            $expected,
            (new PeriodCalendar)->stateOn($this->date('2026-11-01'), $this->date('2026-11-30'), $this->date($today)),
        );
    }

    public function test_dates_in_another_timezone_are_read_as_their_calendar_date(): void
    {
        $calendar = new PeriodCalendar;
        // Local midnight in Madrid is the previous evening in UTC; the calendar date must win
        $madrid = CarbonImmutable::parse('2026-11-01 00:00:00', 'Europe/Madrid');

        $this->assertSame(['2026-11-01', '2026-11-30', false], $this->flat($calendar->first(ContractSchedule::Monthly, $madrid, null)));
        $this->assertSame('current', $calendar->stateOn($this->date('2026-11-01'), $this->date('2026-11-30'), $madrid));
    }

    public function test_schedule_lengths(): void
    {
        $this->assertNull(ContractSchedule::OneOff->months());
        $this->assertSame(1, ContractSchedule::Monthly->months());
        $this->assertSame(3, ContractSchedule::Quarterly->months());
        $this->assertSame(12, ContractSchedule::Annual->months());
        $this->assertFalse(ContractSchedule::OneOff->isRenewing());
        $this->assertTrue(ContractSchedule::Annual->isRenewing());
    }
}
