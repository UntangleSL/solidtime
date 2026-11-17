<?php

declare(strict_types=1);

namespace App\Appearance\Models;

use App\Models\Concerns\HasUuids;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The icon of an organization (a PNG or JPEG on the public disk), kept in a side table so core's
 * organizations table stays untouched. Cosmetic only, so it is not audited.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $path
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Organization $organization
 */
class OrganizationIcon extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'organization_icons';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'organization_id',
        'path',
    ];

    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organization_id');
    }
}
