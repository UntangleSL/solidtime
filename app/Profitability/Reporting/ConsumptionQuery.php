<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use App\Service\TimezoneService;
use Carbon\CarbonImmutable;
use Carbon\CarbonTimeZone;
use Illuminate\Database\Query\Builder;

/**
 * Hours consumed on a project, computed live from time entries (BUDG-03): nobody logging time does an
 * extra step, and nothing is read from the job-maintained project totals.
 *
 * Rules (Goals convention): only work entries count (breaks never); an entry belongs to the local date its
 * start is on, in the profitability timezone, and counts in full there even if it ends later; a running
 * entry counts up to now. Seconds are summed exactly and rounded once at the end.
 *
 * Read-only: it never writes to time_entries or projects.
 */
class ConsumptionQuery
{
    public function __construct(private readonly TimezoneService $timezoneService) {}

    /**
     * The timezone every profitability date (periods, months, today) is local to.
     */
    public function timezone(): CarbonTimeZone
    {
        $name = config('profitability.timezone', 'Europe/Madrid');

        return new CarbonTimeZone(is_string($name) && $name !== '' ? $name : 'Europe/Madrid');
    }

    /**
     * Consumed seconds per local month, keyed by the first day of the month (Y-m-01). Months without
     * time are absent.
     *
     * @param  CarbonImmutable  $fromDate  first local date counted (inclusive)
     * @param  CarbonImmutable  $toDate  last local date counted (inclusive)
     * @return array<string, int>
     */
    public function secondsByMonth(
        string $organizationId,
        string $projectId,
        CarbonImmutable $fromDate,
        CarbonImmutable $toDate,
        CarbonImmutable $now,
    ): array {
        $local = $this->timezoneService->getLocalDateTimeSqlExpression('start', $this->timezone());

        $rows = $this->baseQuery($organizationId, $projectId, $fromDate, $toDate)
            ->selectRaw('to_char(date_trunc(\'month\', '.$local['sql'].'), \'YYYY-MM-DD\') as month', $local['bindings'])
            ->selectRaw($this->secondsSql().' as seconds', [$this->nowBinding($now)])
            ->groupByRaw('1')
            ->orderByRaw('1')
            ->get();

        $seconds = [];
        foreach ($rows as $row) {
            /** @var object{month: string, seconds: int|float|string|null} $row */
            $seconds[$row->month] = max(0, (int) $row->seconds);
        }

        return $seconds;
    }

    /**
     * Consumed seconds of the whole local date range, both dates inclusive.
     */
    public function totalSeconds(
        string $organizationId,
        string $projectId,
        CarbonImmutable $fromDate,
        CarbonImmutable $toDate,
        CarbonImmutable $now,
    ): int {
        /** @var object{seconds: int|float|string|null}|null $row */
        $row = $this->baseQuery($organizationId, $projectId, $fromDate, $toDate)
            ->selectRaw('coalesce('.$this->secondsSql().', 0) as seconds', [$this->nowBinding($now)])
            ->first();

        return $row === null ? 0 : max(0, (int) $row->seconds);
    }

    /**
     * Work entries of the project whose start falls inside the local date range: from the start of
     * $fromDate (inclusive) to the start of the day after $toDate (exclusive), as UTC bounds so the
     * organization/start index serves the range scan.
     */
    private function baseQuery(string $organizationId, string $projectId, CarbonImmutable $fromDate, CarbonImmutable $toDate): Builder
    {
        $timezone = $this->timezone();
        $from = CarbonImmutable::parse($fromDate->format('Y-m-d'), $timezone)->startOfDay()->utc();
        $to = CarbonImmutable::parse($toDate->format('Y-m-d'), $timezone)->addDay()->startOfDay()->utc();

        return TimeEntry::query()
            ->toBase()
            ->where('organization_id', '=', $organizationId)
            ->where('project_id', '=', $projectId)
            ->where('type', '=', TimeEntryType::Work->value)
            ->where('start', '>=', $from->format('Y-m-d H:i:s'))
            ->where('start', '<', $to->format('Y-m-d H:i:s'));
    }

    /**
     * Exact sum of the durations, rounded once; a running entry (no end) runs up to now.
     *
     * @return literal-string
     */
    private function secondsSql(): string
    {
        return 'round(sum(extract(epoch from (coalesce("end", CAST(? AS timestamp)) - "start"))))';
    }

    private function nowBinding(CarbonImmutable $now): string
    {
        return $now->utc()->format('Y-m-d H:i:s');
    }
}
