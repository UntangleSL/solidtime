<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Graph\GraphAccessGuard;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSeriesSetting;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Str;

/**
 * The series controls of the calendar (Phase 5): "Always ignore this series" and its undo (RULE-04,
 * D-10) and "Forget this series" (RULE-05, D-11). Each call names one of the session user's own
 * meetings and acts on that meeting's series for that user only; there is no user id input (D-13).
 *
 * Only outlook_series_settings is ever written: no time entry is created, changed or deleted (D-12),
 * and converting an occurrence never un-ignores its series, only "Stop ignoring" does (D-18). While an
 * admin impersonates the user every call is a 404 (D-14). All calls are idempotent.
 */
class OutlookSeriesController extends Controller
{
    public function __construct(private readonly GraphAccessGuard $access) {}

    /**
     * Hides every occurrence of the meeting's series from the calendar read. A second call keeps the
     * first ignored_at.
     */
    public function ignore(Request $request, string $meeting): Response
    {
        $row = $this->ownSeries($request, $meeting);
        $this->ensureSetting($row);
        $this->setting($row)->whereNull('ignored_at')->update(['ignored_at' => now()]);

        return response()->noContent();
    }

    /**
     * The session user's own, non-gone occurrence of a recurring series with this id. Impersonation,
     * another user's id, an unknown id, a gone meeting and a single meeting are all the same 404: no
     * oracle for what exists (D-14).
     */
    private function ownSeries(Request $request, string $id): OutlookMeeting
    {
        if ($this->access->blocked()) {
            throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
        }

        $user = $request->user();
        assert($user instanceof User);

        $meeting = OutlookMeeting::query()
            ->where('user_id', '=', $user->getKey())
            ->whereKey($id)
            ->whereNull('gone_at')
            ->firstOrFail();

        if ($meeting->series_master_id === null || $meeting->series_master_id === '') {
            throw (new ModelNotFoundException)->setModel(OutlookMeeting::class, [$id]);
        }

        return $meeting;
    }

    /**
     * Creates the settings row of the meeting's series when missing. Race-free: the unique (user_id,
     * series_master_id) index turns a concurrent second insert into a no-op.
     */
    private function ensureSetting(OutlookMeeting $meeting): void
    {
        $now = now();
        OutlookSeriesSetting::query()->insertOrIgnore([
            'id' => Str::uuid()->toString(),
            'user_id' => $meeting->user_id,
            'series_master_id' => (string) $meeting->series_master_id,
            'ignored_at' => null,
            'forgotten_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    /**
     * @return Builder<OutlookSeriesSetting>
     */
    private function setting(OutlookMeeting $meeting): Builder
    {
        return OutlookSeriesSetting::query()
            ->where('user_id', '=', $meeting->user_id)
            ->where('series_master_id', '=', (string) $meeting->series_master_id);
    }
}
