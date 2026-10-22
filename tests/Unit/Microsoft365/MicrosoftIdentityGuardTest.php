<?php

declare(strict_types=1);

namespace Tests\Unit\Microsoft365;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftIdentityGuard;
use App\Microsoft365\Auth\MicrosoftSignInException;
use App\Microsoft365\Auth\MicrosoftSignInFailure;
use App\Microsoft365\MicrosoftConfig;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use Tests\Feature\Microsoft365\Support\InteractsWithMicrosoft365;
use Tests\TestCase;

#[CoversClass(MicrosoftIdentityGuard::class)]
#[UsesClass(MicrosoftConfig::class)]
#[UsesClass(MicrosoftIdentity::class)]
#[UsesClass(MicrosoftSignInException::class)]
#[UsesClass(MicrosoftSignInFailure::class)]
class MicrosoftIdentityGuardTest extends TestCase
{
    use InteractsWithMicrosoft365;

    private MicrosoftIdentityGuard $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureMicrosoft365();
        $this->guard = new MicrosoftIdentityGuard(new MicrosoftConfig);
    }

    public function test_identity_of_configured_tenant_member_passes(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity();

        // Act
        $this->guard->check($identity);

        // Assert
        $this->addToAssertionCount(1);
    }

    public function test_tenant_id_in_upper_case_passes(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['tenantId' => strtoupper(self::MICROSOFT_TEST_TENANT_ID)]);

        // Act
        $this->guard->check($identity);

        // Assert
        $this->addToAssertionCount(1);
    }

    public function test_foreign_tenant_is_rejected_as_wrong_tenant(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['tenantId' => '00000000-0000-4000-8000-0000000000ff']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::WrongTenant, $identity);
    }

    public function test_audience_that_is_not_the_client_id_is_rejected_as_wrong_tenant(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['audience' => '00000000-0000-4000-8000-0000000000ee']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::WrongTenant, $identity);
    }

    public function test_audience_equal_to_the_tenant_id_is_rejected_as_wrong_tenant(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['audience' => self::MICROSOFT_TEST_TENANT_ID]);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::WrongTenant, $identity);
    }

    public function test_empty_object_id_is_rejected_as_generic(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['objectId' => '']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Generic, $identity);
    }

    public function test_object_id_that_is_not_a_guid_is_rejected_as_generic(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['objectId' => 'not-a-guid', 'graphId' => 'not-a-guid']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Generic, $identity);
    }

    public function test_object_id_different_from_graph_id_is_rejected_as_generic(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['graphId' => '00000000-0000-4000-8000-0000000000b2']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Generic, $identity);
    }

    public function test_object_id_and_graph_id_differing_only_in_case_pass(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity([
            'objectId' => '0A0A0A0A-0000-4000-8000-0000000000B1',
            'graphId' => '0a0a0a0a-0000-4000-8000-0000000000b1',
        ]);

        // Act
        $this->guard->check($identity);

        // Assert
        $this->addToAssertionCount(1);
    }

    public function test_guest_user_type_is_rejected_as_guest(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['userType' => 'Guest']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Guest, $identity);
    }

    public function test_missing_user_type_fails_closed_as_guest(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['userType' => null]);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Guest, $identity);
    }

    public function test_lower_case_member_user_type_is_rejected_as_guest(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['userType' => 'member']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Guest, $identity);
    }

    public function test_ext_marker_in_the_user_principal_name_is_rejected_in_any_letter_case(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity([
            'userPrincipalName' => 'ada_example.test#ext#@untangle.onmicrosoft.com',
        ]);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Guest, $identity);
    }

    public function test_account_type_one_is_rejected_as_guest(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity(['accountType' => '1']);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::Guest, $identity);
    }

    public function test_account_type_zero_and_absent_pass(): void
    {
        // Arrange
        $memberAccount = $this->microsoftIdentity(['accountType' => '0']);
        $noAccountType = $this->microsoftIdentity(['accountType' => null]);

        // Act
        $this->guard->check($memberAccount);
        $this->guard->check($noAccountType);

        // Assert
        $this->addToAssertionCount(2);
    }

    public function test_foreign_tenant_is_reported_before_guest_signals(): void
    {
        // Arrange
        $identity = $this->microsoftIdentity([
            'tenantId' => '00000000-0000-4000-8000-0000000000ff',
            'userType' => 'Guest',
        ]);

        // Act & Assert
        $this->assertRejectedWith(MicrosoftSignInFailure::WrongTenant, $identity);
    }

    private function assertRejectedWith(MicrosoftSignInFailure $expected, MicrosoftIdentity $identity): void
    {
        try {
            $this->guard->check($identity);
        } catch (MicrosoftSignInException $exception) {
            $this->assertSame($expected, $exception->reason);

            return;
        }

        $this->fail('Expected the guard to reject the identity with '.$expected->value);
    }
}
