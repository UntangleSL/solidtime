<?php

declare(strict_types=1);

namespace App\Profitability\Periods;

use App\Models\Project;
use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Support\Facades\DB;

/**
 * D-18: archiving a project pauses its contract's renewal; un-archiving resumes it from the current month
 * without back-filling the months it was archived.
 *
 * Called from a Project::updated listener (core archives through a model save, so no core file changes):
 * - Archived (archived_at goes from empty to set): paused_on = today, and the periods that have not
 *   started yet are removed (their months cascade). The current period and closed periods stay as
 *   they are (D-03). While the project is archived the materializer creates nothing.
 * - Un-archived (archived_at goes from set to empty): resume_on = the first day of the current month and
 *   paused_on is cleared; the next read (or the daily command) creates the periods from there.
 *
 * Re-archiving an archived project (a new archived_at timestamp) changes nothing. Only fork rows are
 * written, in one transaction holding the contract row locked like the materializer. "Today" is the
 * local date in the profitability timezone.
 */
class RecordRenewalPause
{
    public function __construct(
        private readonly ConsumptionQuery $consumption,
    ) {}

    public function handle(Project $project): void
    {
        if (! $project->wasChanged('archived_at')) {
            return;
        }

        $previous = $project->getPrevious()['archived_at'] ?? null;
        $archived = $previous === null && $project->archived_at !== null;
        $unarchived = $previous !== null && $project->archived_at === null;
        if (! $archived && ! $unarchived) {
            return;
        }

        $contractId = ProjectContract::query()
            ->where('organization_id', '=', $project->organization_id)
            ->where('project_id', '=', $project->getKey())
            ->value('id');
        if (! is_string($contractId)) {
            return;
        }

        $today = now()->setTimezone($this->consumption->timezone())->toImmutable()->startOfDay();

        DB::transaction(function () use ($contractId, $archived, $today): void {
            /** @var ProjectContract|null $contract */
            $contract = ProjectContract::query()->whereKey($contractId)->lockForUpdate()->first();
            if ($contract === null) {
                return;
            }

            if ($archived) {
                $contract->paused_on = $today;
                $contract->save();

                // Not started yet: nothing was consumed against them. Started periods are never touched.
                ContractPeriod::query()
                    ->where('contract_id', '=', $contract->getKey())
                    ->where('starts_on', '>', $today->format('Y-m-d'))
                    ->delete();

                return;
            }

            $contract->resume_on = $today->startOfMonth();
            $contract->paused_on = null;
            $contract->save();
        });
    }
}
