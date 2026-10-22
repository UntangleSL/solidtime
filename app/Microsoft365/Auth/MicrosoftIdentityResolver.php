<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Enums\Role;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use App\Service\MemberService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns a Microsoft identity into a solidtime user.
 *
 * The identity is matched on tenant id + object id, never on the email. A new person is provisioned
 * as a verified, passwordless employee of the configured organization. The core user-creation path
 * is never used: it hashes a mandatory password and creates a personal organization.
 */
final class MicrosoftIdentityResolver
{
    public function __construct(
        private readonly MicrosoftConfig $config,
        private readonly MemberService $memberService,
    ) {}

    public function resolve(MicrosoftIdentity $identity, ?string $timezone): User
    {
        /** @var User $user */
        $user = DB::transaction(function () use ($identity, $timezone): User {
            $tenantId = strtolower(trim($identity->tenantId));
            $objectId = strtolower(trim($identity->objectId));

            // Re-read inside the transaction so a returning identity never provisions a second user
            $account = MicrosoftAccount::query()
                ->with('user')
                ->where('tenant_id', '=', $tenantId)
                ->where('microsoft_oid', '=', $objectId)
                ->first();

            if ($account === null) {
                $user = $this->provision($identity, $timezone);
                $account = new MicrosoftAccount;
                $account->user()->associate($user);
                $account->tenant_id = $tenantId;
                $account->microsoft_oid = $objectId;
            } else {
                $user = $account->user;
            }

            $this->storeSignIn($account, $identity);

            return $user;
        });

        return $user;
    }

    private function provision(MicrosoftIdentity $identity, ?string $timezone): User
    {
        $organizationId = $this->config->organizationId();
        if ($organizationId === null || ! Str::isUuid($organizationId)) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::ProvisioningUnavailable);
        }
        $organization = Organization::query()->find($organizationId);
        if ($organization === null) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::ProvisioningUnavailable);
        }

        $email = $identity->primaryEmail();
        $name = trim($identity->displayName ?? '');

        $user = new User;
        $user->name = $name !== '' ? $name : Str::before($email, '@');
        $user->email = $email;
        $user->password = null;
        $user->email_verified_at = Carbon::now();
        $user->timezone = $timezone ?? $this->config->defaultTimezone();
        $user->is_placeholder = false;
        $user->save();

        // Default (non superadmin) join path, the same one invitation acceptance uses
        $this->memberService->addMember($user, $organization, Role::Employee);

        return $user;
    }

    private function storeSignIn(MicrosoftAccount $account, MicrosoftIdentity $identity): void
    {
        $now = Carbon::now();

        $account->access_token = $identity->accessToken;
        $account->refresh_token = $identity->refreshToken;
        $account->access_token_expires_at = $identity->expiresIn === null ? null : $now->copy()->addSeconds($identity->expiresIn);
        $account->scopes = $identity->scopes;
        $account->microsoft_email = $identity->primaryEmail();
        $account->last_login_at = $now;
        $account->save();
    }
}
