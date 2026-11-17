<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Every link column Phase 5 needs, in one additive migration on the fork-owned links table:
     * - series_master_id: the series of the converted occurrence (D-02, D-17). Captured at conversion
     *   because Disconnect purges the cached meetings while the links survive (Phase 4 D-15), so the
     *   series history must live on the link itself.
     * - signals: keyed hashes of the meeting's signals for learned suggestions (D-09), filled from 05-05.
     *   Hashes only, never a subject or an address. They are keyed with APP_KEY, so rotating it silently
     *   resets learning; the `v` field inside the payload allows a re-hash later.
     * - prefill_source / prefill_kept: whether the dialog was pre-filled ('series' or 'suggestion') and
     *   whether the user kept it (D-16). Hit rate = share of rows with prefill_kept true among the rows
     *   with prefill_source in ('series', 'suggestion').
     */
    public function up(): void
    {
        Schema::table('outlook_meeting_links', function (Blueprint $table): void {
            // Phase 1 series key of the occurrence (occurrences and exceptions share it); null for a single meeting
            $table->string('series_master_id', 255)->nullable();
            // Latest conversion of a user's series (DISTINCT ON series ordered by created_at desc)
            $table->index(['user_id', 'series_master_id', 'created_at']);
            $table->jsonb('signals')->nullable();
            $table->string('prefill_source', 20)->nullable();
            $table->boolean('prefill_kept')->nullable();
        });

        $this->backfill();
    }

    /**
     * Gives Phase 4 links the series of their occurrence from the cached meetings (RESEARCH Pattern 2).
     * A link whose meeting row was purged by a Disconnect keeps null: there is nothing to read it from.
     * Signals are not backfilled: no attendee data was cached before this phase.
     */
    public function backfill(): void
    {
        DB::statement(<<<'SQL'
            UPDATE outlook_meeting_links AS l
            SET series_master_id = m.series_master_id
            FROM outlook_meetings AS m
            WHERE m.user_id = l.user_id
              AND m.graph_id = l.graph_id
              AND m.series_master_id IS NOT NULL
              AND l.series_master_id IS NULL
            SQL);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('outlook_meeting_links', function (Blueprint $table): void {
            $table->dropIndex(['user_id', 'series_master_id', 'created_at']);
            $table->dropColumn(['series_master_id', 'signals', 'prefill_source', 'prefill_kept']);
        });
    }
};
