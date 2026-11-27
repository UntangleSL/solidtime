<?php

declare(strict_types=1);

namespace App\Profitability\Access;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use App\Service\PermissionStore;

/**
 * The single place that decides what a user may see of the profitability module (D-10, D-11, D-16).
 *
 * Core roles grant read access only through Owner and Admin (full scope). A core Manager, an Employee
 * and a placeholder get nothing from their role: project and account manager assignments (fork tables)
 * are the only other way in. Core permissions and roles are never changed for this.
 *
 * No static cache: the member comes from the request-scoped PermissionStore (Octane).
 */
class ProfitabilityAccess
{
    public function __construct(private readonly PermissionStore $permissionStore) {}

    public function forUser(Organization $organization, User $user): AccessScope
    {
        $member = $this->permissionStore->getMember($organization, $user);
        if ($member === null) {
            return AccessScope::none();
        }

        if ($member->role === Role::Owner->value || $member->role === Role::Admin->value) {
            return AccessScope::full();
        }

        return AccessScope::none();
    }
}
