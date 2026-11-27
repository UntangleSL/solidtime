<?php

declare(strict_types=1);

namespace App\Profitability\Reporting;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Billable, absence and internal time per member over a local date range, the inputs of chargeability
 * (CHRG-02, D-06, D-13). One read-only statement over time_entries, computed live (never from the
 * job-maintained totals), with the Goals convention of ConsumptionQuery: only work entries count, an
 * entry belongs to the local date its start is on in the profitability timezone, a running entry counts
 * up to now, and every sum is exact and rounded once.
 *
 * - absence_seconds: work time on a marked absence project (profitability_absence_projects), whatever
 *   its billable flag; it lowers available hours (D-06). Projects are matched by id only, never by name.
 * - billable_seconds: billable work time on any other project.
 * - internal_seconds: non-billable work time that is not absence, with or without a project. It is
 *   neither billable nor deducted, so it lowers chargeability (intended, RESEARCH Chargeability).
 *
 * No cost is read here.
 */
class ChargeabilityQuery
{
    public function __construct(private readonly ConsumptionQuery $consumption) {}

    /**
     * @param  CarbonImmutable  $fromDate  first local date counted (inclusive)
     * @param  CarbonImmutable  $toDate  last local date counted (inclusive)
     * @param  list<string>  $absenceProjectIds  ids of the organization's marked absence projects
     * @return array<string, array{billable_seconds: int, absence_seconds: int, internal_seconds: int}> keyed by member id; members without work time are absent
     */
    public function byMemberForRange(
        string $organizationId,
        CarbonImmutable $fromDate,
        CarbonImmutable $toDate,
        CarbonImmutable $now,
        array $absenceProjectIds,
    ): array {
        $timezone = $this->consumption->timezone();
        $from = CarbonImmutable::parse($fromDate->format('Y-m-d'), $timezone)->startOfDay()->utc();
        $to = CarbonImmutable::parse($toDate->format('Y-m-d'), $timezone)->addDay()->startOfDay()->utc();

        // A Postgres array literal of validated uuids, bound as one parameter (never interpolated)
        $ids = array_values(array_filter($absenceProjectIds, fn (string $id): bool => Str::isUuid($id)));
        $absenceArray = '{'.implode(',', $ids).'}';
        $nowBinding = $now->utc()->format('Y-m-d H:i:s');

        $duration = 'extract(epoch from (coalesce("end", CAST(? AS timestamp)) - "start"))';
        $isAbsence = 'coalesce("project_id" = any(CAST(? AS uuid[])), false)';

        $rows = TimeEntry::query()
            ->toBase()
            ->select('member_id')
            ->selectRaw('coalesce(round(sum('.$duration.') filter (where not '.$isAbsence.' and "billable" = true)), 0) as billable_seconds', [$nowBinding, $absenceArray])
            ->selectRaw('coalesce(round(sum('.$duration.') filter (where '.$isAbsence.')), 0) as absence_seconds', [$nowBinding, $absenceArray])
            ->selectRaw('coalesce(round(sum('.$duration.') filter (where not '.$isAbsence.' and "billable" = false)), 0) as internal_seconds', [$nowBinding, $absenceArray])
            ->where('organization_id', '=', $organizationId)
            ->where('type', '=', TimeEntryType::Work->value)
            ->where('start', '>=', $from->format('Y-m-d H:i:s'))
            ->where('start', '<', $to->format('Y-m-d H:i:s'))
            ->groupBy('member_id')
            ->get();

        $result = [];
        foreach ($rows as $row) {
            /** @var object{member_id: string, billable_seconds: int|float|string|null, absence_seconds: int|float|string|null, internal_seconds: int|float|string|null} $row */
            $result[$row->member_id] = [
                'billable_seconds' => max(0, (int) $row->billable_seconds),
                'absence_seconds' => max(0, (int) $row->absence_seconds),
                'internal_seconds' => max(0, (int) $row->internal_seconds),
            ];
        }

        return $result;
    }
}
