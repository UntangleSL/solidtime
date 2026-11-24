<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tpetry\PostgresqlEnhanced\Schema\Blueprint;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The out-of-sync state of a converted meeting, in one additive migration on the fork-owned links
     * table (Phase 6). The snapshot that every check compares against already exists:
     * meeting_starts_at / meeting_ends_at, the meeting's own time recorded at conversion (D-01).
     *
     * - flag_reason / flagged_at: the entry is flagged ('moved', 'cancelled' or 'removed') and waits for
     *   the user's choice (D-04, D-05). Null means not flagged.
     * - outlook_starts_at / outlook_ends_at: the new Outlook slot of a 'moved' flag ("old -> new"), the
     *   target of "Adjust to Outlook" (D-04).
     * - outlook_all_day: the moved meeting became all-day, so Adjust is hidden (D-18).
     * - released_at: a started meeting moved to a new slot (D-03). The link no longer hides the meeting
     *   and is never checked again; a second link of the same occurrence may now exist.
     * - detached_at: "Keep as is" on a cancelled or removed flag; the link is never checked again.
     *   (Keep on a moved flag re-baselines the snapshot instead, D-16.)
     * - last_checked_at: time of the last applied observation (stale-observation guard, job ordering).
     * - auto_adjusted_at / auto_adjusted_from_*: the entry was moved automatically (D-04) and from where,
     *   for the "Adjusted to Outlook: old -> new" notice (UI-SPEC section 5).
     *
     * Times only, never a subject (Phase 3 D-15).
     */
    public function up(): void
    {
        Schema::table('outlook_meeting_links', function (Blueprint $table): void {
            $table->string('flag_reason', 20)->nullable();
            $table->dateTime('flagged_at')->nullable();
            $table->dateTime('outlook_starts_at')->nullable();
            $table->dateTime('outlook_ends_at')->nullable();
            $table->boolean('outlook_all_day')->default(false);
            $table->dateTime('released_at')->nullable();
            $table->dateTime('detached_at')->nullable();
            $table->dateTime('last_checked_at')->nullable();
            $table->dateTime('auto_adjusted_at')->nullable();
            $table->dateTime('auto_adjusted_from_starts_at')->nullable();
            $table->dateTime('auto_adjusted_from_ends_at')->nullable();

            // At most one ACTIVE link per occurrence and user, so Phase 4 D-06 idempotency and the
            // unique-violation race path of the conversion keep working. A released link (D-03) leaves
            // the index, so "Create time entry" on the moved meeting can add a second link.
            $table->dropUnique(['user_id', 'graph_id']);
            $table->uniqueIndex(['user_id', 'graph_id'], 'outlook_meeting_links_active_unique')
                ->where('released_at is null');
            // Scope queries: a user's links whose recorded start is in the check window (D-10)
            $table->index(['user_id', 'meeting_starts_at']);
        });

        $this->backfill();
    }

    /**
     * Gives a link without a snapshot one (RESEARCH Pattern 2). Every conversion writes the snapshot,
     * so this is expected to touch no row; it exists so no link is silently left out of the checks.
     * First from the cached meeting of the occurrence, then from the entry for the rest.
     *
     * Only null snapshots are filled. A non-null snapshot is never re-snapshotted from the cache: the
     * cached row may already show the moved time, and overwriting the snapshot with it would hide the
     * very change this phase detects.
     */
    public function backfill(): void
    {
        DB::statement(<<<'SQL'
            UPDATE outlook_meeting_links AS l
            SET meeting_starts_at = m.starts_at,
                meeting_ends_at = m.ends_at
            FROM outlook_meetings AS m
            WHERE m.user_id = l.user_id
              AND m.graph_id = l.graph_id
              AND l.meeting_starts_at IS NULL
            SQL);

        DB::statement(<<<'SQL'
            UPDATE outlook_meeting_links AS l
            SET meeting_starts_at = t.start,
                meeting_ends_at = t."end"
            FROM time_entries AS t
            WHERE t.id = l.time_entry_id
              AND l.meeting_starts_at IS NULL
            SQL);
    }

    /**
     * Reverse the migrations.
     *
     * Restoring the plain unique on (user_id, graph_id) fails while two links of one occurrence exist
     * (a released link plus the link of a second entry, D-03): remove one of them first.
     */
    public function down(): void
    {
        Schema::table('outlook_meeting_links', function (Blueprint $table): void {
            $table->dropIndex(['user_id', 'meeting_starts_at']);
            $table->dropUniqueIndex('outlook_meeting_links_active_unique');
            $table->unique(['user_id', 'graph_id']);
            $table->dropColumn([
                'flag_reason',
                'flagged_at',
                'outlook_starts_at',
                'outlook_ends_at',
                'outlook_all_day',
                'released_at',
                'detached_at',
                'last_checked_at',
                'auto_adjusted_at',
                'auto_adjusted_from_starts_at',
                'auto_adjusted_from_ends_at',
            ]);
        });
    }
};
