<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use Carbon\CarbonImmutable;

/**
 * Available working time of one person over a local date range, before absence is deducted (D-13, A9).
 *
 * Every Monday to Friday of the range contributes one fifth of the weekly seconds of the working week in
 * force that day: the row with the greatest effective_from on or before the day. Days before the first
 * row contribute nothing; weekends never count. The share is summed exactly and rounded once.
 *
 * Public holidays are not known here: until the next phase brings holiday calendars they come in as time
 * logged on a "Festivo" absence project, which the caller deducts like any other absence (D-06).
 *
 * Pure: no database, no clock.
 */
final class AvailableHoursCalculator
{
    /**
     * @param  list<array{effective_from: CarbonImmutable, weekly_seconds: int}>  $workWeeks  any order
     * @param  CarbonImmutable  $from  first local date (inclusive)
     * @param  CarbonImmutable  $to  last local date (inclusive)
     * @return int|null null when no working week is in force on or before $to
     */
    public static function availableSeconds(array $workWeeks, CarbonImmutable $from, CarbonImmutable $to): ?int
    {
        $toDate = $to->format('Y-m-d');

        /** @var list<array{date: string, weekly_seconds: int}> $rows */
        $rows = [];
        foreach ($workWeeks as $workWeek) {
            $date = $workWeek['effective_from']->format('Y-m-d');
            if ($date <= $toDate) {
                $rows[] = ['date' => $date, 'weekly_seconds' => $workWeek['weekly_seconds']];
            }
        }
        if ($rows === []) {
            return null;
        }
        usort($rows, fn (array $a, array $b): int => $a['date'] <=> $b['date']);

        $total = 0.0;
        $index = -1;
        $count = count($rows);
        // Walk the dates as plain calendar days (no timezone arithmetic, DST cannot shift a day)
        for ($day = CarbonImmutable::createFromFormat('!Y-m-d', $from->format('Y-m-d'), 'UTC'); $day !== null && $day->format('Y-m-d') <= $toDate; $day = $day->addDay()) {
            $date = $day->format('Y-m-d');
            while ($index + 1 < $count && $rows[$index + 1]['date'] <= $date) {
                $index++;
            }
            if ($index < 0 || $day->isWeekend()) {
                continue;
            }
            $total += $rows[$index]['weekly_seconds'] / 5;
        }

        return (int) round($total);
    }
}
