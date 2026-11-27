<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use App\Models\Project;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A project an Owner or Admin marked as absence (D-06, CHRG-02): time on it lowers the person's
 * available hours instead of counting as internal time. Marked explicitly; project names are user data
 * and are never matched.
 *
 * organization_id is set by code from the route organization, never from request input.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $project_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 */
class AbsenceProject extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'profitability_absence_projects';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'project_id',
    ];

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class, 'project_id');
    }
}
