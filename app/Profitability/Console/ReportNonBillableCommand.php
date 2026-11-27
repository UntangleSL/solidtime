<?php

declare(strict_types=1);

namespace App\Profitability\Console;

use App\Profitability\TimeEntries\LegacyNonBillableQuery;
use Illuminate\Console\Command;

/**
 * D-05 report: how much legacy non-billable work time sits on billable projects, per organization
 * and project. Read-only: it never changes a row. D-05 decided that these entries are reported,
 * never silently rewritten; the explicit fix path is core's bulk edit of time entries (select them,
 * set Billable), done by a person who decides they should be billable.
 *
 * Output holds counts, hours and ids only (no names, no member data), like m365:check.
 */
class ReportNonBillableCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'profitability:report-nonbillable {--organization= : Only this organization id}';

    /**
     * @var string
     */
    protected $description = 'Report (read-only) legacy non-billable work time on billable projects';

    public function handle(LegacyNonBillableQuery $query): int
    {
        $organization = $this->option('organization');
        $organizationId = is_string($organization) && $organization !== '' ? $organization : null;

        $rows = $query->byProject($organizationId);

        $organizations = [];
        $entries = 0;
        $seconds = 0;
        foreach ($rows as $row) {
            $organizations[$row['organization_id']] = true;
            $entries += $row['entries'];
            $seconds += $row['seconds'];
        }

        $this->line('organizations: '.count($organizations));
        $this->line('projects: '.count($rows));
        $this->line('entries: '.$entries);
        $this->line('hours: '.$this->hours($seconds));
        foreach ($rows as $row) {
            $this->line('project '.$row['project_id'].' '.$row['entries'].' '.$this->hours($row['seconds']));
        }

        return self::SUCCESS;
    }

    private function hours(int $seconds): string
    {
        return number_format($seconds / 3600, 1, '.', '');
    }
}
