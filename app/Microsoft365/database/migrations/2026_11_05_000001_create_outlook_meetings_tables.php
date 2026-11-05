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
        Schema::create('outlook_meetings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Immutable Graph id of the occurrence (Prefer: IdType="ImmutableId"), unique per user mailbox
            $table->string('graph_id', 255);
            // Stored for the series rules of a later phase
            $table->string('series_master_id', 255)->nullable();
            $table->dateTime('original_start')->nullable();
            $table->string('event_type', 20);
            $table->text('subject')->nullable();
            // Always UTC
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            // Display name only, never the address
            $table->string('organizer_name', 255)->nullable();
            $table->boolean('is_organizer')->default(false);
            $table->boolean('is_online_meeting')->default(false);
            $table->string('show_as', 20)->nullable();
            $table->text('web_link')->nullable();
            $table->dateTime('last_seen_at');
            $table->dateTime('gone_at')->nullable();
            $table->dateTime('dismissed_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'graph_id']);
            $table->index(['user_id', 'starts_at']);
        });

        Schema::create('outlook_sync_windows', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->dateTime('window_start');
            $table->dateTime('window_end');
            $table->dateTime('synced_at');
            $table->timestamps();
            $table->unique(['user_id', 'window_start', 'window_end']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('outlook_sync_windows');
        Schema::dropIfExists('outlook_meetings');
    }
};
