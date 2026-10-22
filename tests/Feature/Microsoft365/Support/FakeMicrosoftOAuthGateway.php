<?php

declare(strict_types=1);

namespace Tests\Feature\Microsoft365\Support;

use App\Microsoft365\Auth\MicrosoftIdentity;
use App\Microsoft365\Auth\MicrosoftOAuthGateway;
use Illuminate\Http\Request;
use LogicException;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Throwable;

/**
 * Test double for the Microsoft gateway: no network, no Socialite. The identity (or the failure)
 * handed back by authenticate() is chosen by the test.
 */
final class FakeMicrosoftOAuthGateway implements MicrosoftOAuthGateway
{
    private ?MicrosoftIdentity $identity = null;

    private ?Throwable $failure = null;

    private int $authenticateCalls = 0;

    public function willReturn(MicrosoftIdentity $identity): self
    {
        $this->identity = $identity;
        $this->failure = null;

        return $this;
    }

    public function willThrow(Throwable $failure): self
    {
        $this->failure = $failure;
        $this->identity = null;

        return $this;
    }

    public function authenticateCalls(): int
    {
        return $this->authenticateCalls;
    }

    public function redirect(Request $request): RedirectResponse
    {
        return new RedirectResponse(route('microsoft.callback', ['code' => 'fake-code', 'state' => 'fake-state']));
    }

    public function authenticate(Request $request): MicrosoftIdentity
    {
        $this->authenticateCalls++;

        if ($this->failure !== null) {
            throw $this->failure;
        }

        return $this->identity ?? throw new LogicException('FakeMicrosoftOAuthGateway has neither an identity nor a failure.');
    }
}
