<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 5 (D-09) reverses the Phase 3 "organizer display name only" choice for the meeting cache: learned
 * project suggestions score meetings by who organizes and attends them. The data stays personal data of the
 * meeting owner only (rows are per user), is scrubbed with an ineligible sighting, deleted with the meeting
 * rows on Disconnect and with the user through the existing user_id cascade, and is never served by the read.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('outlook_meetings', function (Blueprint $table): void {
            // Lower-cased organizer address; 320 is the longest valid address
            $table->string('organizer_address', 320)->nullable();
            // At most 50 entries {address, name, type}, no response status, rooms and equipment skipped
            $table->jsonb('attendees')->nullable();
            // Real number of non-resource attendees Graph returned, before the cap
            $table->integer('attendee_count')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('outlook_meetings', function (Blueprint $table): void {
            $table->dropColumn(['organizer_address', 'attendees', 'attendee_count']);
        });
    }
};
