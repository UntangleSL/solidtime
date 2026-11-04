<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Providers\RouteServiceProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_screen_can_be_rendered(): void
    {
        $response = $this->get('/login');

        $response->assertStatus(200);
    }

    public function test_login_screen_offers_registration_only_when_registration_is_on(): void
    {
        config(['app.enable_registration' => 'on']);
        $this->get('/login')->assertInertia(fn ($page) => $page->where('canRegister', true));

        config(['app.enable_registration' => 'off']);
        $this->get('/login')->assertInertia(fn ($page) => $page->where('canRegister', false));

        config(['app.enable_registration' => 'invite-only']);
        $this->get('/login')->assertInertia(fn ($page) => $page->where('canRegister', false));
    }

    public function test_users_can_authenticate_using_the_login_screen(): void
    {
        $user = User::factory()->create();

        $response = $this->post('/login', [
            'email' => $user->email,
            'password' => 'password',
        ]);

        $this->assertAuthenticated();
        $response->assertRedirect(RouteServiceProvider::HOME);
    }

    public function test_users_can_not_authenticate_with_invalid_password(): void
    {
        $user = User::factory()->create();

        $this->post('/login', [
            'email' => $user->email,
            'password' => 'wrong-password',
        ]);

        $this->assertGuest();
    }
}
