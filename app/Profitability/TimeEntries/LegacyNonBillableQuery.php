<?php

declare(strict_types=1);

namespace App\Profitability\TimeEntries;

use App\Enums\TimeEntryType;
use App\Models\TimeEntry;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;

/**
 * Read-only view of the legacy data D-05 leaves in place: non-billable work entries on billable
 * projects, saved before the EnforceBillableOnBillableProject listener existed (or imported). D-05
 * decided to report them, never to rewrite them, so this class only selects. Each method runs one
 * statement; running entries count up to now.
 *
 * Used by the profitability:report-nonbillable command and by the data-quality notice of the
 * profitability views.
 */
class LegacyNonBillableQuery
{
    /**
     * One row per organization and project with legacy non-billable work time, ordered by
     * organization and project id.
     *
     * @return list<array{organization_id: string, project_id: string, entries: int, seconds: int}>
     */
    public function byProject(?string $organizationId = null, ?CarbonImmutable $now = null): array
    {
        $query = $this->baseQuery($now)
            // addSelect, not select: select() would drop the seconds column of baseQuery()
            ->addSelect(['time_entries.organization_id', 'time_entries.project_id'])
            ->selectRaw('count(*) as entries')
            ->groupBy(['time_entries.organization_id', 'time_entries.project_id'])
            ->orderBy('time_entries.organization_id')
            ->orderBy('time_entries.project_id');
        if ($organizationId !== null) {
            $query->where('time_entries.organization_id', '=', $organizationId);
        }

        $result = [];
        foreach ($query->get() as $row) {
            /** @var object{organization_id: string, project_id: string, entries: int|string, seconds: int|float|string|null} $row */
            $result[] = [
                'organization_id' => (string) $row->organization_id,
                'project_id' => (string) $row->project_id,
                'entries' => (int) $row->entries,
                'seconds' => max(0, (int) $row->seconds),
            ];
        }

        return $result;
    }

    /**
     * Total legacy non-billable work seconds of one organization, optionally limited to some projects.
     *
     * @param  array<int, string>|null  $projectIds
     */
    public function secondsFor(string $organizationId, ?array $projectIds = null, ?CarbonImmutable $now = null): int
    {
        if ($projectIds === []) {
            return 0;
        }

        $query = $this->baseQuery($now)
            ->where('time_entries.organization_id', '=', $organizationId);
        if ($projectIds !== null) {
            $query->whereIn('time_entries.project_id', array_values($projectIds));
        }

        /** @var object{seconds: int|float|string|null}|null $row */
        $row = $query->first();

        return $row === null ? 0 : max(0, (int) $row->seconds);
    }

    /**
     * Work entries, not billable, on a billable project, with the summed seconds column selected.
     */
    private function baseQuery(?CarbonImmutable $now): Builder
    {
        $nowBinding = ($now ?? CarbonImmutable::now())->utc()->format('Y-m-d H:i:s');

        return TimeEntry::query()
            ->toBase()
            ->join('projects', 'projects.id', '=', 'time_entries.project_id')
            ->where('time_entries.type', '=', TimeEntryType::Work->value)
            ->where('time_entries.billable', '=', false)
            ->where('projects.is_billable', '=', true)
            ->selectRaw(
                'coalesce(round(sum(extract(epoch from (coalesce(time_entries."end", CAST(? AS timestamp)) - time_entries."start")))), 0) as seconds',
                [$nowBinding],
            );
    }
}
