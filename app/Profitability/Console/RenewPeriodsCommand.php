<?php

declare(strict_types=1);

namespace App\Profitability\Console;

use App\Profitability\Models\ContractPeriod;
use App\Profitability\Models\ProjectContract;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Reporting\ConsumptionQuery;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Daily safety net of contract renewal (BUDG-02, D-04): materializes the periods due today, plus the next
 * one, for every contract of every organization whose project is not archived.
 *
 * Correctness never depends on this command: every read of a summary materializes lazily through the same
 * PeriodMaterializer, which is insert-only and idempotent. Running it twice, or missing a night, changes
 * nothing. Archived projects are skipped (D-18: archiving pauses renewal).
 *
 * Output holds counts only (no names, no figures), like profitability:report-nonbillable.
 */
class RenewPeriodsCommand extends Command
{
    private const int CHUNK = 200;

    /**
     * @var string
     */
    protected $signature = 'profitability:renew-periods {--dry-run : Count the contracts without writing}';

    /**
     * @var string
     */
    protected $description = 'Create the contract periods that are due (safety net; reads also create them)';

    public function handle(PeriodMaterializer $materializer, ConsumptionQuery $consumption): int
    {
        // "Today" is the local date in the profitability timezone, as for every read
        $today = now()->setTimezone($consumption->timezone())->toImmutable()->startOfDay();
        $dryRun = (bool) $this->option('dry-run');

        $before = ContractPeriod::query()->count();
        $contracts = 0;
        ProjectContract::query()
            ->whereHas('project', static function (Builder $query): void {
                $query->whereNull('archived_at');
            })
            ->chunkById(self::CHUNK, function (Collection $chunk) use ($materializer, $today, $dryRun, &$contracts): void {
                foreach ($chunk as $contract) {
                    /** @var ProjectContract $contract */
                    $contracts++;
                    if (! $dryRun) {
                        $materializer->ensureThrough($contract, $today);
                    }
                }
            });

        $this->line('contracts: '.$contracts);
        if ($dryRun) {
            $this->line('dry-run: nothing written');

            return self::SUCCESS;
        }
        $this->line('created: '.max(0, ContractPeriod::query()->count() - $before));

        return self::SUCCESS;
    }
}
