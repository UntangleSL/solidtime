<?php

declare(strict_types=1);

namespace App\Profitability\Access;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use App\Profitability\Models\ClientAccountManager;
use App\Profitability\Models\ProjectManager;
use App\Service\PermissionStore;
use Illuminate\Database\Eloquent\Builder;

/**
 * The single place that decides what a user may see of the profitability module (D-10, D-11, D-16).
 *
 * Core roles grant read access only through Owner and Admin (full scope). A core Manager, an Employee
 * and a placeholder get nothing from their role: project and account manager assignments (fork tables
 * project_managers and client_account_managers) are the only other way in, whatever the member's core
 * role. A placeholder never gets anything, even with a stale assignment row. Core permissions and roles
 * are never changed for this.
 *
 * No static cache: the member comes from the request-scoped PermissionStore (Octane) and the two
 * assignment reads run on every call.
 */
class ProfitabilityAccess
{
    public function __construct(private readonly PermissionStore $permissionStore) {}

    public function forUser(Organization $organization, User $user): AccessScope
    {
        $member = $this->permissionStore->getMember($organization, $user);
        if ($member === null || $member->role === Role::Placeholder->value) {
            return AccessScope::none();
        }

        if ($member->role === Role::Owner->value || $member->role === Role::Admin->value) {
            return AccessScope::full();
        }

        // Only assignments whose project or client belongs to this organization count: a row can never
        // reach across organizations, even if it was written with a foreign id.
        $managedProjectIds = ProjectManager::query()
            ->where('member_id', '=', $member->getKey())
            ->where('organization_id', '=', $organization->getKey())
            ->whereHas('project', fn (Builder $project): Builder => $project->whereBelongsTo($organization, 'organization'))
            ->orderBy('project_id')
            ->pluck('project_id')
            ->all();

        $accountClientIds = ClientAccountManager::query()
            ->where('member_id', '=', $member->getKey())
            ->where('organization_id', '=', $organization->getKey())
            ->whereHas('client', fn (Builder $client): Builder => $client->whereBelongsTo($organization, 'organization'))
            ->orderBy('client_id')
            ->pluck('client_id')
            ->all();

        return new AccessScope(false, array_values($managedProjectIds), array_values($accountClientIds));
    }
}
