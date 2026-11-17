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
     * One row per converted meeting occurrence: which time entry a user created from which Outlook
     * occurrence (Phase 4 D-05, D-06). Additive and fork-owned: no core table is changed.
     */
    public function up(): void
    {
        Schema::create('outlook_meeting_links', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            // Deleting the user removes their links
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Immutable Graph id of the occurrence, same type as outlook_meetings.graph_id. Deliberately no
            // foreign key to the meetings table: Disconnect purges those rows and re-syncs upsert them, and
            // the link must survive both so a converted meeting never comes back (D-15).
            $table->string('graph_id', 255);
            // One link per entry. The cascade lives in the database because core deletes entries in bulk
            // without Eloquent events (organization deletion, member removal): the link goes with the
            // entry wherever it is deleted, and the meeting is a suggestion again (D-05).
            $table->uuid('time_entry_id')->unique();
            $table->foreign('time_entry_id')
                ->references('id')
                ->on('time_entries')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Snapshot of the meeting time at conversion, for the out-of-sync checks of a later phase
            $table->dateTime('meeting_starts_at')->nullable();
            $table->dateTime('meeting_ends_at')->nullable();
            $table->timestamps();
            // An occurrence becomes at most one time entry per user (D-06)
            $table->unique(['user_id', 'graph_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('outlook_meeting_links');
    }
};
