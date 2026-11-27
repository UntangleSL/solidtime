<?php

declare(strict_types=1);

namespace App\Profitability\TimeEntries;

use App\Enums\TimeEntryType;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Service\BillingContract;

/**
 * D-05: on a billable client project every time entry is billable. Registered once as a
 * TimeEntry `saving` listener from ProfitabilityServiceProvider, so it covers every write path that
 * ends in save(): the API store, update and bulk update, the web forms through the API and the
 * Outlook conversion (which runs core store() in process).
 *
 * The entry is forced to billable, and its billable rate recomputed, only when every condition holds
 * (checked cheapest first):
 *  - it is a work entry: breaks are never billable (core's own saving hook clears them);
 *  - it has a project: time without a project has nothing to be billable for;
 *  - it is not billable yet: nothing to change otherwise;
 *  - it is not imported: an import copies history as it was recorded; violations show in the
 *    profitability:report-nonbillable report instead;
 *  - the save creates the entry or changes its project, billable flag or type: an edit that touches
 *    none of them (a description, a time) never flips a legacy entry. D-05 decided that existing
 *    entries are reported, never silently rewritten;
 *  - the project is billable (one value() query);
 *  - the organization can use billable rates: core's premium lock wins, an organization without
 *    billable rates keeps non-billable entries. Asked last, so the billing contract (which the
 *    Billing extension may back with a query) is only consulted when the entry would change.
 *
 * The rate is recomputed after the flag because BillableRateService returns null for a non-billable
 * entry. Nothing is logged.
 */
class EnforceBillableOnBillableProject
{
    public function __construct(
        private readonly BillingContract $billingContract,
    ) {}

    public function handle(TimeEntry $entry): void
    {
        if ($entry->type !== TimeEntryType::Work) {
            return;
        }
        if ($entry->project_id === null) {
            return;
        }
        if ($entry->billable) {
            return;
        }
        if ($entry->is_imported === true) {
            return;
        }
        if ($entry->exists && ! $entry->isDirty(['project_id', 'billable', 'type'])) {
            return;
        }

        $projectIsBillable = Project::query()->whereKey($entry->project_id)->value('is_billable');
        if ($projectIsBillable !== true) {
            return;
        }

        /** @var Organization|null $organization */
        $organization = Organization::query()->whereKey($entry->organization_id)->first();
        if ($organization === null || ! $this->billingContract->canUseBillableRates($organization)) {
            return;
        }

        $entry->billable = true;
        $entry->setComputedAttributeValue('billable_rate');
    }
}
