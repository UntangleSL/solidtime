<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('microsoft_accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            // One Microsoft identity per user and one user per Microsoft identity
            $table->uuid('user_id')->unique();
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Entra tid + oid identify the person; the email is kept for display only
            $table->string('tenant_id', 36);
            $table->string('microsoft_oid', 36);
            $table->unique(['tenant_id', 'microsoft_oid']);
            $table->string('microsoft_email')->nullable();
            // Encrypted by the model cast, the ciphertext is longer than 255 characters
            $table->text('access_token')->nullable();
            $table->text('refresh_token')->nullable();
            $table->dateTime('access_token_expires_at')->nullable();
            $table->jsonb('scopes')->nullable();
            $table->dateTime('disconnected_at')->nullable();
            $table->dateTime('last_login_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('microsoft_accounts');
    }
};
