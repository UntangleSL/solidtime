<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Periods\PeriodMaterializer;
use App\Profitability\Reporting\ClientRollupService;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ReportRange;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

/**
 * The by-client view of the Profitability page (BUDG-06, D-07, D-11, D-14): the account manager's
 * portfolio, per client the hours and money sold, consumed hours, cost and margin of its contract
 * projects over a calendar-aligned range, with the projects nested (ClientRollupService).
 *
 * Only the scopes whose views() contain "clients" get it: Owner/Admin (every client and the "No client"
 * bucket) and account managers (their clients). Project managers, employees, core managers and
 * non-members get the same plain 404 as an unknown organization (D-16, no oracle): this view always
 * carries money.
 *
 * The range comes from `?range=`; only the whitelisted keys of ReportRange map to dates, anything else
 * falls back to This month. The contracts in scope are materialized through the end of the range (at
 * least through today), so every month of a range that is still running has its period and plan.
 */
class ClientsViewController extends Controller
{
    public const string VIEW = 'clients';

    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ConsumptionQuery $consumption,
        private readonly PeriodMaterializer $materializer,
        private readonly ClientRollupService $rollup,
    ) {}

    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        assert($user instanceof User);
        $scope = $this->access->forUser($organization, $user);
        if (! in_array(self::VIEW, $scope->views(), true)) {
            throw (new ModelNotFoundException)->setModel(Organization::class);
        }

        $now = now()->toImmutable();
        $today = $now->setTimezone($this->consumption->timezone())->startOfDay();
        $key = $request->query('range');
        $range = ReportRange::fromKey(is_string($key) ? $key : ReportRange::THIS_MONTH, $today);

        $through = $range->to->greaterThan($today) ? $range->to : $today;
        foreach ($this->rollup->contractsInScope($organization, $scope) as $contract) {
            $this->materializer->ensureThrough($contract, $through);
        }

        $result = $this->rollup->forRange($organization, $scope, $range, $now);

        return new JsonResponse([
            'data' => $result['clients'],
            'meta' => [
                'range' => $range->toArray(),
                'totals' => $result['totals'],
            ],
        ]);
    }
}
