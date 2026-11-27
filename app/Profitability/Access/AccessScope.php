<?php

declare(strict_types=1);

namespace App\Profitability\Access;

use App\Models\Project;

/**
 * What one user may see and change in the profitability module of one organization (D-10, D-11, D-16).
 * Built only by ProfitabilityAccess; controllers, resources and the shared prop ask it before reading
 * any data.
 *
 * Decision table (pinned by tests/Unit/Profitability/AccessScopeTest.php):
 *
 * | scope                         | view project       | edit terms | edit plan | money      | views                              |
 * |-------------------------------|--------------------|------------|-----------|------------|------------------------------------|
 * | full (Owner, Admin)           | every project      | yes        | yes       | yes        | projects, clients, people, settings|
 * | account manager of client C   | every project of C | C only     | no        | C only     | projects, clients                  |
 * | project manager of project P  | P only             | no         | P only    | never      | projects                           |
 * | none                          | nothing            | no         | no        | never      | (empty)                            |
 *
 * - D-11 (visibility): a project manager sees the hours of the projects they manage and never money; an
 *   account manager sees the money of their clients' projects; a project without client is reachable
 *   only through full scope or a project manager assignment.
 * - D-12 (editing): terms (hours and money sold, renewal) belong to the account side, the monthly plan
 *   to the delivery side; Owner and Admin edit everything.
 * - D-16: a core Manager, an Employee or a placeholder with no assignment gets none; per-person views
 *   and settings are full scope only.
 * - Both assignments combine: each project gets the union of what each assignment grants on it.
 *
 * Immutable and request-local: it is never cached on a static or a singleton (Octane).
 */
final readonly class AccessScope
{
    /**
     * @param  list<string>  $managedProjectIds  projects the user is a project manager of
     * @param  list<string>  $accountClientIds  clients the user is an account manager of
     */
    public function __construct(
        private bool $full,
        private array $managedProjectIds,
        private array $accountClientIds,
    ) {}

    public static function none(): self
    {
        return new self(false, [], []);
    }

    public static function full(): self
    {
        return new self(true, [], []);
    }

    public function isFull(): bool
    {
        return $this->full;
    }

    public function hasAnyAccess(): bool
    {
        return $this->full || $this->managedProjectIds !== [] || $this->accountClientIds !== [];
    }

    public function canViewProject(Project $project): bool
    {
        return $this->full || $this->managesProject($project) || $this->isAccountManagerOf($project);
    }

    /**
     * Contract terms (hours and money sold, schedule) are written by the account side.
     */
    public function canEditTerms(Project $project): bool
    {
        return $this->full || $this->isAccountManagerOf($project);
    }

    /**
     * The monthly distribution of a period's hours is written by the delivery side.
     */
    public function canEditPlan(Project $project): bool
    {
        return $this->full || $this->managesProject($project);
    }

    public function hasMoneyFor(Project $project): bool
    {
        return $this->full || $this->isAccountManagerOf($project);
    }

    public function hasAnyMoney(): bool
    {
        return $this->full || $this->accountClientIds !== [];
    }

    public function canViewClient(?string $clientId): bool
    {
        if ($this->full) {
            return true;
        }

        return $clientId !== null && in_array($clientId, $this->accountClientIds, true);
    }

    /**
     * @return list<string>
     */
    public function managedProjectIds(): array
    {
        return $this->managedProjectIds;
    }

    /**
     * @return list<string>
     */
    public function accountClientIds(): array
    {
        return $this->accountClientIds;
    }

    /**
     * The tabs of the profitability page this user gets.
     *
     * @return list<string>
     */
    public function views(): array
    {
        if ($this->full) {
            return ['projects', 'clients', 'people', 'settings'];
        }
        if ($this->accountClientIds !== []) {
            return ['projects', 'clients'];
        }
        if ($this->managedProjectIds !== []) {
            return ['projects'];
        }

        return [];
    }

    private function managesProject(Project $project): bool
    {
        return in_array($project->getKey(), $this->managedProjectIds, true);
    }

    private function isAccountManagerOf(Project $project): bool
    {
        return $this->canViewClient($project->client_id);
    }
}
