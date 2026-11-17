<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * One row per user and recurring series the user acted on (Phase 5): "Always ignore this series"
     * (ignored_at, D-10) and "Forget this series" (forgotten_at, D-11). Ids and times only, never a
     * subject, a series name or a Graph event body (D-17). Keyed by the Graph series id, deliberately
     * with no foreign key to the meetings table: like the links it survives Disconnect and re-syncs, and
     * it goes away with the user. Additive and fork-owned: no core table is changed.
     */
    public function up(): void
    {
        Schema::create('outlook_series_settings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            // Deleting the user removes their series settings
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Graph seriesMasterId, same type as outlook_meetings.series_master_id
            $table->string('series_master_id', 255);
            // Set while the series is ignored; null again after "Stop ignoring"
            $table->dateTime('ignored_at')->nullable();
            // Links created up to this moment no longer pre-assign the series; every forget moves it on
            $table->dateTime('forgotten_at')->nullable();
            $table->timestamps();
            // One settings row per user and series
            $table->unique(['user_id', 'series_master_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('outlook_series_settings');
    }
};
