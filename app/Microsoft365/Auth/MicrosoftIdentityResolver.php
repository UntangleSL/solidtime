<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Enums\Role;
use App\Microsoft365\MicrosoftConfig;
use App\Microsoft365\Models\MicrosoftAccount;
use App\Models\Organization;
use App\Models\User;
use App\Service\MemberService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns a Microsoft identity into a solidtime user.
 *
 * The identity is matched on tenant id + object id, never on the email once a link exists. The
 * email is used exactly once, to link the identity to an existing verified user. A new person is
 * provisioned as a verified, passwordless employee of the configured organization. The core
 * user-creation path is never used: it hashes a mandatory password and creates a personal
 * organization.
 */
final class MicrosoftIdentityResolver
{
    public function __construct(
        private readonly MicrosoftConfig $config,
        private readonly MemberService $memberService,
    ) {}

    /**
     * @throws MicrosoftSignInException
     */
    public function resolve(MicrosoftIdentity $identity, ?string $timezone): User
    {
        try {
            return $this->attempt($identity, $timezone);
        } catch (UniqueConstraintViolationException) {
            // A concurrent sign-in won the race for one of the unique indexes. Its rows are committed
            // by now, so one more pass finds them (or links to them) instead of creating duplicates.
        }

        try {
            return $this->attempt($identity, $timezone);
        } catch (UniqueConstraintViolationException) {
            // Fixed reason only: the database error text can carry emails and ids.
            throw new MicrosoftSignInException(MicrosoftSignInFailure::Generic);
        }
    }

    private function attempt(MicrosoftIdentity $identity, ?string $timezone): User
    {
        /** @var User $user */
        $user = DB::transaction(function () use ($identity, $timezone): User {
            $tenantId = strtolower(trim($identity->tenantId));
            $objectId = strtolower(trim($identity->objectId));

            // Same identity, same lock: concurrent callbacks run one after the other, so the stored
            // token pair is always one complete set and a second pass sees the first one's rows.
            DB::select('select pg_advisory_xact_lock(hashtext(?))', ['microsoft:'.$tenantId.':'.$objectId]);

            $account = MicrosoftAccount::query()
                ->with('user')
                ->where('tenant_id', '=', $tenantId)
                ->where('microsoft_oid', '=', $objectId)
                ->lockForUpdate()
                ->first();

            if ($account !== null) {
                // Returning identity: tid + oid only, the current email is irrelevant.
                $user = $account->user;
            } else {
                $user = $this->findLinkCandidate($identity) ?? $this->provision($identity, $timezone);
                $account = new MicrosoftAccount;
                $account->user()->associate($user);
                $account->tenant_id = $tenantId;
                $account->microsoft_oid = $objectId;
            }

            $this->storeSignIn($account, $identity);

            return $user;
        });

        return $user;
    }

    /**
     * The one existing user the identity may be linked to, or null when nobody matches. Only verified,
     * non-placeholder users qualify and only by an address in an allowlisted domain.
     *
     * @throws MicrosoftSignInException
     */
    private function findLinkCandidate(MicrosoftIdentity $identity): ?User
    {
        $addresses = $this->candidateAddresses($identity);
        if ($addresses === []) {
            return null;
        }

        // Stored emails can differ in case from what Entra reports, so compare lower-cased.
        $users = User::query()
            ->where('is_placeholder', '=', false)
            ->whereIn(DB::raw('lower(email)'), $addresses)
            ->get();

        if ($users->count() > 1) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::AmbiguousAccount);
        }

        $user = $users->first();
        if ($user === null) {
            return null;
        }

        // An account that was never verified may belong to someone else: pre-registration takeover.
        if ($user->email_verified_at === null) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::UnverifiedAccount);
        }

        if (MicrosoftAccount::query()->where('user_id', '=', $user->getKey())->exists()) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::AlreadyLinked);
        }

        return $user;
    }

    /**
     * Lower-cased mail and user principal name, de-duplicated, restricted to the allowlisted domains.
     *
     * @return list<string>
     */
    private function candidateAddresses(MicrosoftIdentity $identity): array
    {
        $allowedDomains = $this->config->allowedDomains();
        $addresses = [];

        foreach ([$identity->mail, $identity->userPrincipalName] as $candidate) {
            $address = strtolower(trim($candidate ?? ''));
            $at = strrpos($address, '@');
            if ($at === false) {
                continue;
            }
            if (in_array(substr($address, $at + 1), $allowedDomains, true)) {
                $addresses[] = $address;
            }
        }

        return array_values(array_unique($addresses));
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
