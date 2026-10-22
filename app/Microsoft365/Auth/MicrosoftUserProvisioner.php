<?php

declare(strict_types=1);

namespace App\Microsoft365\Auth;

use App\Enums\Role;
use App\Microsoft365\MicrosoftConfig;
use App\Models\Organization;
use App\Models\User;
use App\Service\MemberService;
use App\Service\TimezoneService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Creates the solidtime user for a person who signs in with Microsoft for the first time.
 *
 * The user is verified (the tenant check is the verification, not an email claim), has no password,
 * and joins the configured organization as employee, the lowest role. No personal organization is
 * created and neither the core user-creation service nor Fortify's registration action is used, so
 * the registration mode (off, invite-only) does not matter.
 *
 * The member is added through MemberService's default path, the one invitation acceptance uses: it
 * dispatches MemberAdding and MemberAdded. Core registers no listener for them and the fork image
 * ships without extensions, so there is no billing or seat side effect today; an extension installed
 * later sees Microsoft joins like any other join instead of being bypassed.
 */
final class MicrosoftUserProvisioner
{
    private const string FALLBACK_TIMEZONE = 'UTC';

    public function __construct(
        private readonly MicrosoftConfig $config,
        private readonly MemberService $memberService,
        private readonly TimezoneService $timezoneService,
    ) {}

    /**
     * @throws MicrosoftSignInException when no organization is configured or it does not exist
     */
    public function provision(MicrosoftIdentity $identity, ?string $timezone): User
    {
        $organization = $this->organization();

        // Lower-case on purpose: MemberService merges placeholders by exact email match
        $email = $identity->primaryEmail();
        $name = trim($identity->displayName ?? '');

        $user = new User;
        $user->name = $name !== '' ? $name : Str::before($email, '@');
        $user->email = $email;
        $user->password = null;
        $user->email_verified_at = Carbon::now();
        $user->timezone = $this->timezone($timezone);
        $user->is_placeholder = false;
        $user->save();

        // Sets the current organization and merges a placeholder member with the same email
        $this->memberService->addMember($user, $organization, Role::Employee);

        return $user;
    }

    private function organization(): Organization
    {
        $organizationId = $this->config->organizationId();
        if ($organizationId === null || ! Str::isUuid($organizationId)) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::ProvisioningUnavailable);
        }

        $organization = Organization::query()->find($organizationId);
        if ($organization === null) {
            throw new MicrosoftSignInException(MicrosoftSignInFailure::ProvisioningUnavailable);
        }

        return $organization;
    }

    /**
     * The browser timezone when valid, else the configured default when valid, else UTC.
     */
    private function timezone(?string $browserTimezone): string
    {
        if ($browserTimezone !== null && $this->timezoneService->isValid($browserTimezone)) {
            return $browserTimezone;
        }

        $default = $this->config->defaultTimezone();

        return $this->timezoneService->isValid($default) ? $default : self::FALLBACK_TIMEZONE;
    }
}
