<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use App\Service\TimezoneService;
use Carbon\CarbonImmutable;
use Carbon\CarbonTimeZone;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Hours consumed on a project, computed live from time entries (BUDG-03): nobody logging time does an
 * extra step, and nothing is read from the job-maintained project totals.
 *
 * Rules (Goals convention): only work entries count (breaks never); an entry belongs to the local date its
 * start is on, in the profitability timezone, and counts in full there even if it ends later; a running
 * entry counts up to now. Seconds are summed exactly and rounded once at the end.
 *
 * Cost (D-07, D-08, D-09) is computed live from the dated hourly cost of each person, never stored per
 * entry: a LEFT JOIN LATERAL on member_cost_rates picks, per entry, the row of the entry's member with
 * the greatest effective_from on or before the entry's local start date. An entry without such a row is
 * counted as unpriced time, never as free (RESEARCH Pitfall 3). The cost join only runs when the caller
 * asks for it, which callers do only for scopes with money (D-11).
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
     * Totals of the whole local date range (both dates inclusive) in one statement: all work seconds, the
     * billable ones and, with $withCost only, the cost in cents (each entry's duration times the hourly
     * cost effective on its local start date, summed exactly and rounded once), the seconds that had a
     * cost and the seconds of entries whose member had no cost row on that date.
     *
     * Without $withCost the cost columns are not selected at all and come back null.
     *
     * @return array{seconds: int, billable_seconds: int, cost_cents: int|null, priced_seconds: int|null, unpriced_seconds: int|null}
     */
    public function periodTotals(
        string $organizationId,
        string $projectId,
        CarbonImmutable $fromDate,
        CarbonImmutable $toDate,
        CarbonImmutable $now,
        bool $withCost,
    ): array {
        $duration = $this->durationSql();
        $nowBinding = $this->nowBinding($now);

        $query = $this->baseQuery($organizationId, $projectId, $fromDate, $toDate)
            ->selectRaw('coalesce(round(sum('.$duration.')), 0) as seconds', [$nowBinding])
            ->selectRaw('coalesce(round(sum(case when billable then '.$duration.' else 0 end)), 0) as billable_seconds', [$nowBinding]);

        if ($withCost) {
            // Inside the lateral subquery the bare "start" resolves to the outer time entry (member_cost_rates
            // has no such column), so the rate is the one in force on the entry's local start date.
            $local = $this->timezoneService->getLocalDateTimeSqlExpression('start', $this->timezone());
            $rate = DB::table('member_cost_rates')
                ->select('member_cost_rates.hourly_cost_cents')
                ->whereColumn('member_cost_rates.member_id', '=', 'time_entries.member_id')
                ->whereColumn('member_cost_rates.organization_id', '=', 'time_entries.organization_id')
                ->whereRaw('member_cost_rates.effective_from <= CAST('.$local['sql'].' AS date)', $local['bindings'])
                ->orderByDesc('member_cost_rates.effective_from')
                ->limit(1);

            $query->leftJoinLateral($rate, 'rate')
                ->selectRaw('coalesce(round(sum('.$duration.' * rate.hourly_cost_cents / 3600.0)), 0) as cost_cents', [$nowBinding])
                ->selectRaw('coalesce(round(sum(case when rate.hourly_cost_cents is not null then '.$duration.' else 0 end)), 0) as priced_seconds', [$nowBinding])
                ->selectRaw('coalesce(round(sum(case when rate.hourly_cost_cents is null then '.$duration.' else 0 end)), 0) as unpriced_seconds', [$nowBinding]);
        }

        /** @var object{seconds: int|float|string|null, billable_seconds: int|float|string|null, cost_cents?: int|float|string|null, priced_seconds?: int|float|string|null, unpriced_seconds?: int|float|string|null}|null $row */
        $row = $query->first();
        if ($row === null) {
            return [
                'seconds' => 0,
                'billable_seconds' => 0,
                'cost_cents' => $withCost ? 0 : null,
                'priced_seconds' => $withCost ? 0 : null,
                'unpriced_seconds' => $withCost ? 0 : null,
            ];
        }

        return [
            'seconds' => max(0, (int) $row->seconds),
            'billable_seconds' => max(0, (int) $row->billable_seconds),
            'cost_cents' => $withCost ? max(0, (int) ($row->cost_cents ?? 0)) : null,
            'priced_seconds' => $withCost ? max(0, (int) ($row->priced_seconds ?? 0)) : null,
            'unpriced_seconds' => $withCost ? max(0, (int) ($row->unpriced_seconds ?? 0)) : null,
        ];
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
        return 'round(sum('.$this->durationSql().'))';
    }

    /**
     * Duration of one entry in seconds, unrounded; a running entry runs up to now (one binding).
     *
     * @return literal-string
     */
    private function durationSql(): string
    {
        return 'extract(epoch from (coalesce("end", CAST(? AS timestamp)) - "start"))';
    }

    private function nowBinding(CarbonImmutable $now): string
    {
        return $now->utc()->format('Y-m-d H:i:s');
    }
}
