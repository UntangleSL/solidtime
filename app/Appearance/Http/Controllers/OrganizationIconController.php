<?php

declare(strict_types=1);

namespace App\Appearance\Http\Controllers;

use App\Appearance\Http\Requests\OrganizationIconRequest;
use App\Appearance\Models\OrganizationIcon;
use App\Http\Controllers\Web\Controller;
use App\Models\Organization;
use App\Support\Base64File;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Upload and removal of an organization icon (owners and admins: organizations:update). Same storage
 * pattern as the core profile photo: public disk, a fresh uuid file name per upload (so caches never
 * serve a stale icon), extension derived from the sniffed MIME type, previous file deleted.
 */
class OrganizationIconController extends Controller
{
    /**
     * Store or replace the icon and answer with its public URL.
     *
     * @throws AuthorizationException
     */
    public function store(Organization $organization, OrganizationIconRequest $request): JsonResponse
    {
        $this->authorizeUpdate($organization);

        $icon = $request->getIcon();
        $extension = Base64File::extension($icon['mime_type']);
        assert($extension !== null);

        $disk = Storage::disk($this->diskName());
        $path = 'organization-icons/'.Str::uuid().'.'.$extension;
        $disk->put($path, $icon['data'], 'public');

        $existing = OrganizationIcon::query()->where('organization_id', '=', $organization->getKey())->first();
        $previousPath = $existing?->path;

        OrganizationIcon::query()->updateOrCreate(
            ['organization_id' => $organization->getKey()],
            ['path' => $path],
        );

        // Only once the row points at the new file, so a failed write never leaves a dangling row
        if ($previousPath !== null && $previousPath !== $path) {
            $disk->delete($previousPath);
        }

        return response()->json(['url' => $disk->url($path)]);
    }

    /**
     * Membership is checked inside the permission store; owner and admin hold organizations:update.
     *
     * @throws AuthorizationException
     */
    private function authorizeUpdate(Organization $organization): void
    {
        if (! $this->hasPermission($organization, 'organizations:update')) {
            throw new AuthorizationException;
        }
    }

    private function diskName(): string
    {
        return (string) config('filesystems.public');
    }
}
