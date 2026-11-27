<?php

declare(strict_types=1);

namespace App\Profitability\Models;

use App\Models\Concerns\HasUuids;
use App\Models\Member;
use App\Models\Project;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A member assigned as project manager of one project (D-10). Grants the hour balances and the monthly
 * plan of that project, never its money (D-11, D-12). It is an assignment row, not a solidtime role:
 * the member keeps their core role, whatever it is.
 *
 * organization_id is set by code from the route organization, never from request input. Only Owner and
 * Admin create or delete these rows (D-16).
 *
 * Deliberately not audited and not in Filament: it is part of the profitability access model.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $project_id
 * @property string $member_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Member $member
 * @property-read Project $project
 */
class ProjectManager extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'project_managers';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'project_id',
        'member_id',
    ];

    /**
     * @return BelongsTo<Member, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(Member::class, 'member_id');
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class, 'project_id');
    }
}
