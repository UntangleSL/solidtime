<?php

declare(strict_types=1);

namespace App\Profitability\Http\Controllers;

use App\Enums\Role;
use App\Models\Client;
use App\Models\Member;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Profitability\Access\ProfitabilityAccess;
use App\Profitability\Http\Requests\AssignmentRequest;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ProjectManager;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Project managers and account managers of the profitability settings (D-10, D-12, D-16, A7, A8).
 *
 * Only Owner and Admin (full scope) list, add and remove assignments; every other caller, an assigned
 * project or account manager included, gets the same plain 404 before the body is even validated
 * (T-08-06). The organization, project and client always come from the route and are looked up inside
 * the route organization (404); the body only names the member, who must be a non-placeholder member of
 * that organization (422, T-08-09).
 *
 * Adding and removing are idempotent: the unique (project_id, member_id) and (client_id, member_id)
 * indexes turn a repeated or concurrent add into a no-op, and removing a missing row is a 204.
 * Core roles and permissions are never touched: assignments are rows in fork tables only (BUDG-07).
 */
class AssignmentController extends Controller
{
    public function __construct(private readonly ProfitabilityAccess $access) {}

    /**
     * Every client with its account managers, every billable active project with its project managers,
     * and the members that can be assigned (placeholders excluded), each sorted by name.
     */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $this->ensureFullScope($request, $organization);

        /** @var array<string, array{member_id: string, name: string, role: string}> $members */
        $members = [];
        $memberRows = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->with('user')
            ->get();
        foreach ($memberRows as $member) {
            $members[$member->getKey()] = [
                'member_id' => $member->getKey(),
                'name' => $member->user->name,
                'role' => $member->role,
            ];
        }

        /** @var array<string, list<string>> $accountManagersByClient */
        $accountManagersByClient = [];
        $accountRows = ClientAccountManager::query()
            ->where('organization_id', '=', $organization->getKey())
            ->get(['client_id', 'member_id']);
        foreach ($accountRows as $row) {
            $accountManagersByClient[$row->client_id][] = $row->member_id;
        }

        /** @var array<string, list<string>> $projectManagersByProject */
        $projectManagersByProject = [];
        $projectRows = ProjectManager::query()
            ->where('organization_id', '=', $organization->getKey())
            ->get(['project_id', 'member_id']);
        foreach ($projectRows as $row) {
            $projectManagersByProject[$row->project_id][] = $row->member_id;
        }

        $clients = Client::query()
            ->whereBelongsTo($organization, 'organization')
            ->get();
        /** @var array<string, string> $clientNames */
        $clientNames = [];
        $clientList = [];
        foreach ($clients as $client) {
            $clientNames[$client->getKey()] = $client->name;
            $clientList[] = [
                'id' => $client->getKey(),
                'name' => $client->name,
                'account_managers' => $this->people($accountManagersByClient[$client->getKey()] ?? [], $members),
            ];
        }

        $projects = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->where('is_billable', '=', true)
            ->whereNull('archived_at')
            ->get();
        $projectList = [];
        foreach ($projects as $project) {
            $projectList[] = [
                'id' => $project->getKey(),
                'name' => $project->name,
                'client_id' => $project->client_id,
                'client_name' => $clientNames[(string) $project->client_id] ?? null,
                'project_managers' => $this->people($projectManagersByProject[$project->getKey()] ?? [], $members),
            ];
        }

        $assignable = array_values(array_filter(
            $members,
            fn (array $member): bool => $member['role'] !== Role::Placeholder->value,
        ));

        return new JsonResponse([
            'data' => [
                'clients' => $this->sortByName($clientList),
                'projects' => $this->sortByName($projectList),
                'members' => $this->sortByName($assignable),
            ],
        ]);
    }

    /**
     * Adds the body member as a project manager of the route project; a repeated call is a no-op.
     */
    public function addProjectManager(Request $request, Organization $organization, string $project): Response
    {
        $this->ensureFullScope($request, $organization);
        $model = $this->project($organization, $project);
        if (! $model->is_billable) {
            throw ValidationException::withMessages([
                'project_id' => __('profitability.validation.project_not_billable'),
            ]);
        }
        $member = $this->assignableMember($organization);

        $now = now();
        ProjectManager::query()->insertOrIgnore([
            'id' => Str::uuid()->toString(),
            'organization_id' => $organization->getKey(),
            'project_id' => $model->getKey(),
            'member_id' => $member->getKey(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->noContent();
    }

    /**
     * Removes the member from the project managers of the route project; a 204 also when they were not one.
     */
    public function removeProjectManager(Request $request, Organization $organization, string $project, string $memberId): Response
    {
        $this->ensureFullScope($request, $organization);
        $model = $this->project($organization, $project);
        $memberModel = $this->member($organization, $memberId);

        ProjectManager::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('project_id', '=', $model->getKey())
            ->where('member_id', '=', $memberModel->getKey())
            ->delete();

        return response()->noContent();
    }

    /**
     * Adds the body member as an account manager of the route client; a repeated call is a no-op.
     */
    public function addAccountManager(Request $request, Organization $organization, string $client): Response
    {
        $this->ensureFullScope($request, $organization);
        $model = $this->client($organization, $client);
        $member = $this->assignableMember($organization);

        $now = now();
        ClientAccountManager::query()->insertOrIgnore([
            'id' => Str::uuid()->toString(),
            'organization_id' => $organization->getKey(),
            'client_id' => $model->getKey(),
            'member_id' => $member->getKey(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->noContent();
    }

    /**
     * Removes the member from the account managers of the route client; a 204 also when they were not one.
     */
    public function removeAccountManager(Request $request, Organization $organization, string $client, string $memberId): Response
    {
        $this->ensureFullScope($request, $organization);
        $model = $this->client($organization, $client);
        $memberModel = $this->member($organization, $memberId);

        ClientAccountManager::query()
            ->where('organization_id', '=', $organization->getKey())
            ->where('client_id', '=', $model->getKey())
            ->where('member_id', '=', $memberModel->getKey())
            ->delete();

        return response()->noContent();
    }

    /**
     * Owner and Admin only (D-16); everyone else, assigned managers included, gets a 404.
     */
    private function ensureFullScope(Request $request, Organization $organization): void
    {
        $user = $request->user();
        assert($user instanceof User);

        if (! $this->access->forUser($organization, $user)->isFull()) {
            throw (new ModelNotFoundException)->setModel(Organization::class, [$organization->getKey()]);
        }
    }

    private function project(Organization $organization, string $id): Project
    {
        /** @var Project $project */
        $project = Project::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($id)
            ->firstOrFail();

        return $project;
    }

    private function client(Organization $organization, string $id): Client
    {
        /** @var Client $client */
        $client = Client::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($id)
            ->firstOrFail();

        return $client;
    }

    private function member(Organization $organization, string $id): Member
    {
        /** @var Member $member */
        $member = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($id)
            ->firstOrFail();

        return $member;
    }

    /**
     * The body member, validated only after the scope check so a non-admin never learns more than a 404.
     * A placeholder (A8), a member of another organization or an unknown id is a 422 on member_id.
     */
    private function assignableMember(Organization $organization): Member
    {
        $body = app(AssignmentRequest::class);

        /** @var Member|null $member */
        $member = Member::query()
            ->whereBelongsTo($organization, 'organization')
            ->whereKey($body->memberId())
            ->where('role', '!=', Role::Placeholder->value)
            ->first();
        if ($member === null) {
            throw ValidationException::withMessages([
                'member_id' => __('validation.exists', ['attribute' => 'member id']),
            ]);
        }

        return $member;
    }

    /**
     * @param  list<string>  $memberIds
     * @param  array<string, array{member_id: string, name: string, role: string}>  $members
     * @return list<array{member_id: string, name: string}>
     */
    private function people(array $memberIds, array $members): array
    {
        $people = [];
        foreach ($memberIds as $memberId) {
            if (! isset($members[$memberId])) {
                continue;
            }
            $people[] = ['member_id' => $memberId, 'name' => $members[$memberId]['name']];
        }

        return $this->sortByName($people);
    }

    /**
     * @template T of array{name: string}
     *
     * @param  list<T>  $rows
     * @return list<T>
     */
    private function sortByName(array $rows): array
    {
        usort($rows, fn (array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));

        return $rows;
    }
}
