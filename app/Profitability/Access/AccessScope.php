<?php

declare(strict_types=1);

namespace App\Profitability\Access;

use App\Models\Project;

/**
 * What one user may see and change in the profitability module of one organization (D-10, D-11, D-16).
 * Built only by ProfitabilityAccess; controllers, resources and the shared prop ask it before reading
 * any data.
 *
 * - full: Owner or Admin, everything (every project, client, person, the money and the settings)
 * - account manager of a client: terms and money of that client's projects
 * - project manager of a project: that project's hours and monthly plan, never money
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
