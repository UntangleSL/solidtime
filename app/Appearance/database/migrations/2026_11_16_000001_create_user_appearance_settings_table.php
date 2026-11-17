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
        Schema::create('user_appearance_settings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            // One row per user, removed together with the user
            $table->uuid('user_id')->unique();
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // null means "not chosen": the frontend falls back to system / untangle
            $table->string('theme', 16)->nullable();
            $table->string('accent', 32)->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('user_appearance_settings');
    }
};
