<?php

declare(strict_types=1);

namespace App\Appearance\Listeners;

use App\Appearance\Models\OrganizationIcon;
use App\Events\BeforeOrganizationDeletion;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Removes the icon file of an organization that is being deleted. DeletionService dispatches the
 * event inside its transaction (the Filament delete action and user deletion go through it too), so
 * the file is only deleted once that transaction commits: a rolled-back deletion keeps its icon. The
 * row itself goes with the organization through the foreign key cascade.
 */
class DeleteOrganizationIconFile
{
    public function handle(BeforeOrganizationDeletion $event): void
    {
        $icon = OrganizationIcon::query()
            ->where('organization_id', '=', $event->organization->getKey())
            ->first();
        if ($icon === null) {
            return;
        }

        $path = $icon->path;
        $disk = (string) config('filesystems.public');

        // Runs immediately when no transaction is open
        DB::afterCommit(static function () use ($disk, $path): void {
            Storage::disk($disk)->delete($path);
        });
    }
}
