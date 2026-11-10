<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Models\MicrosoftAccount;
use App\Microsoft365\Models\OutlookMeeting;
use App\Microsoft365\Models\OutlookSyncWindow;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class MicrosoftAccountController extends Controller
{
    /**
     * Disconnect Microsoft: the stored tokens are dropped, the identity link stays so the user can
     * still sign in with Microsoft (a passwordless user must never be locked out, D-10/D-19).
     * The user's cached Outlook meetings, their dismissals and sync windows are deleted in the same
     * transaction (D-21): reconnecting starts from a fresh fetch. Nothing else is touched: no time
     * entries, no user fields, no removal of the identity row.
     */
    public function destroy(Request $request): RedirectResponse
    {
        $user = $request->user();

        if ($user !== null) {
            DB::transaction(function () use ($user): void {
                // The row lock serialises this with a concurrent sign-in, which re-reads
                // disconnected_at under the same lock before it writes any token.
                $account = MicrosoftAccount::query()
                    ->where('user_id', '=', $user->getKey())
                    ->lockForUpdate()
                    ->first();

                // Nothing may outlive the connection, also when there is no link row to keep
                OutlookMeeting::query()->where('user_id', '=', $user->getKey())->delete();
                OutlookSyncWindow::query()->where('user_id', '=', $user->getKey())->delete();

                if ($account === null) {
                    return;
                }

                $account->access_token = null;
                $account->refresh_token = null;
                $account->access_token_expires_at = null;
                $account->scopes = null;
                $account->reconnect_required_at = null;
                $account->graph_backoff_until = null;
                if ($account->disconnected_at === null) {
                    $account->disconnected_at = Carbon::now();
                }
                $account->save();
            });
        }

        return redirect()->route('profile.show')
            ->with('microsoft365.notice', __('microsoft365.ui.disconnected_notice'));
    }
}
