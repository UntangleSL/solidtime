<?php

declare(strict_types=1);

namespace App\Microsoft365\Models;

use App\Models\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * What one user told one recurring Outlook series (Phase 5): ignore it in the calendar (ignored_at,
 * D-10, D-18) and stop pre-assigning it from the conversions made up to a moment (forgotten_at, D-11).
 *
 * Keyed by user and Graph series id, not by an outlook_meetings row, so it survives Disconnect and
 * re-syncs like the links; it is deleted with the user (D-17).
 *
 * Deliberately not audited and not in Filament: it holds ids and times only, never a subject, a series
 * name or a Graph event body (D-17).
 *
 * @property string $id
 * @property string $user_id
 * @property string $series_master_id
 * @property Carbon|null $ignored_at
 * @property Carbon|null $forgotten_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class OutlookSeriesSetting extends Model
{
    use HasUuids;

    /**
     * @var string
     */
    protected $table = 'outlook_series_settings';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'series_master_id',
        'ignored_at',
        'forgotten_at',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'ignored_at' => 'datetime',
        'forgotten_at' => 'datetime',
    ];
}
