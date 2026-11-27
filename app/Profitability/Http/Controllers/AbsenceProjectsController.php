<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Requests\AbsenceProjectsRequest;
use App\Profitability\Models\AbsenceProject;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The projects whose time counts as absence for chargeability (D-06, CHRG-02), for the Settings view.
 *
 * An Owner or Admin marks them explicitly: project names are user data and nothing is ever matched by
 * name. Owner and Admin only (isFull()); every other caller gets a plain 404 (D-12, D-16).
 */
class AbsenceProjectsController extends Controller
{
    public function __construct(private readonly ProfitabilityAccess $access) {}

    /**
     * The marked project ids and every project of the organization for the picker, sorted by name.
     */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $this->authorizeFull($request, $organization);

        /** @var Collection<int, Project> $projects */
        $projects = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->with('client')
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        /** @var array<string, true> $marked */
        $marked = AbsenceProject::query()
            ->where('organization_id', '=', $organization->getKey())
            ->pluck('project_id')
            ->mapWithKeys(fn (string $projectId): array => [$projectId => true])
            ->all();

        $projectIds = [];
        $rows = [];
        foreach ($projects as $project) {
            if (isset($marked[$project->getKey()])) {
                $projectIds[] = $project->getKey();
            }
            $rows[] = [
                'id' => $project->getKey(),
                'name' => $project->name,
                'client_name' => $project->client?->name,
                'is_archived' => $project->archived_at !== null,
            ];
        }

        return new JsonResponse([
            'data' => [
                'project_ids' => $projectIds,
                'projects' => $rows,
            ],
        ]);
    }

    /**
     * Replaces the set of absence projects. Every id must be a project of the organization.
     */
    public function update(AbsenceProjectsRequest $request, Organization $organization): Response
    {
        $this->authorizeFull($request, $organization);

        $projectIds = $request->projectIds();
        $found = $projectIds === [] ? 0 : Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereIn('id', $projectIds)
            ->count();
        if ($found !== count($projectIds)) {
            throw ValidationException::withMessages([
                'project_ids' => [__('validation.exists', ['attribute' => 'project_ids'])],
            ]);
        }

        DB::transaction(function () use ($organization, $projectIds): void {
            AbsenceProject::query()
                ->where('organization_id', '=', $organization->getKey())
                ->whereNotIn('project_id', $projectIds)
                ->delete();

            /** @var list<string> $existing */
            $existing = AbsenceProject::query()
                ->where('organization_id', '=', $organization->getKey())
                ->pluck('project_id')
                ->all();

            foreach (array_diff($projectIds, $existing) as $projectId) {
                (new AbsenceProject)->forceFill([
                    'organization_id' => $organization->getKey(),
                    'project_id' => $projectId,
                ])->save();
            }
        });

        return response()->noContent();
    }

    private function authorizeFull(Request $request, Organization $organization): void
    {
        $user = $request->user();
        assert($user instanceof User);

        if (! $this->access->forUser($organization, $user)->isFull()) {
            throw (new ModelNotFoundException)->setModel(Project::class);
        }
    }
}
