<?php

declare(strict_types=1);

namespace App\Microsoft365\Http\Controllers;

use App\Microsoft365\Models\MicrosoftAccount;
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
     * Nothing else is touched: no time entries, no user fields, no row removal.
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

                if ($account === null) {
                    return;
                }

                $account->access_token = null;
                $account->refresh_token = null;
                $account->access_token_expires_at = null;
                $account->scopes = null;
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
