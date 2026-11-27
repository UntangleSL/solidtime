<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Reporting\ChargeabilityService;
use App\Profitability\Reporting\ConsumptionQuery;
use App\Profitability\Reporting\ReportRange;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

/**
 * The by-person view of the Profitability page (CHRG-02, CHRG-03, D-13): each person's chargeability
 * against their target over a calendar-aligned range, with team totals.
 *
 * Owner and Admin only (D-16): the gate is isFull() alone, so account managers, project managers, core
 * managers and employees never see anybody's chargeability. Every other caller gets the same plain 404
 * as an unknown organization (no oracle).
 *
 * The range comes from `?range=`; only the whitelisted keys of ReportRange map to dates, anything else
 * falls back to This month.
 */
class PeopleViewController extends Controller
{
    public function __construct(
        private readonly ProfitabilityAccess $access,
        private readonly ChargeabilityService $chargeability,
        private readonly ConsumptionQuery $consumption,
    ) {}

    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        assert($user instanceof User);
        if (! $this->access->forUser($organization, $user)->isFull()) {
            throw (new ModelNotFoundException)->setModel(Organization::class);
        }

        $now = now()->toImmutable();
        $today = $now->setTimezone($this->consumption->timezone())->startOfDay();
        $key = $request->query('range');
        $range = ReportRange::fromKey(is_string($key) ? $key : ReportRange::THIS_MONTH, $today);

        $result = $this->chargeability->forRange($organization, $range, $now);

        return new JsonResponse([
            'data' => $result['people'],
            'meta' => [
                'range' => $range->toArray(),
                'team' => $result['team'],
            ],
        ]);
    }
}
