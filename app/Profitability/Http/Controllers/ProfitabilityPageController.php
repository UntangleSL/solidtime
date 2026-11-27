<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The Profitability page (D-14, CHRG-03). It renders the Inertia page only; the tabs (`views`), the
 * organization URL the views read from and the copy come from the shared `profitability` prop
 * (ShareProfitabilityInertiaData adds the full label tree on this route).
 *
 * D-16: without access in the user's current organization (Employee, core Manager without an assignment,
 * Placeholder, or no membership at all) the page does not exist: a plain 404, never a 403.
 */
class ProfitabilityPageController extends Controller
{
    public function __construct(private readonly ProfitabilityAccess $access) {}

    public function show(Request $request): Response
    {
        $user = $request->user();
        if (! $user instanceof User || $user->current_team_id === null) {
            throw new NotFoundHttpException;
        }

        /** @var Organization|null $organization */
        $organization = Organization::query()->whereKey($user->current_team_id)->first();
        if ($organization === null || ! $this->access->forUser($organization, $user)->hasAnyAccess()) {
            throw new NotFoundHttpException;
        }

        return Inertia::render('Profitability');
    }
}
