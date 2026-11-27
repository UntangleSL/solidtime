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
     * The people family of the profitability module (Phase 8, D-06, D-08, D-13): the dated hourly cost of
     * each member, the dated working week with its chargeability target, and the projects an Owner or
     * Admin marked explicitly as absence. Additive and fork-owned: no core table is changed and
     * members.billable_rate is never touched (sale rate and cost differ).
     *
     * Every foreign key cascades. The cascade lives in the database because core deletes members, projects
     * and organizations in bulk without Eloquent events (DeletionService::deleteOrganization): the fork
     * rows go with their member, project or organization wherever it is deleted.
     */
    public function up(): void
    {
        Schema::create('member_cost_rates', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Placeholder members keep their rows: their past hours still need a cost (A8)
            $table->uuid('member_id');
            $table->foreign('member_id')
                ->references('id')
                ->on('members')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Applies from this local date until the next row of the member (D-08)
            $table->date('effective_from');
            $table->bigInteger('hourly_cost_cents');
            $table->timestamps();
            $table->unique(['member_id', 'effective_from']);
        });

        Schema::create('member_work_weeks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('member_id');
            $table->foreign('member_id')
                ->references('id')
                ->on('members')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // One dated row carries both the working week and the chargeability target (D-13)
            $table->date('effective_from');
            $table->integer('weekly_seconds');
            $table->smallInteger('chargeability_target_percent');
            $table->timestamps();
            $table->unique(['member_id', 'effective_from']);
        });

        Schema::create('profitability_absence_projects', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Marked explicitly by an Owner or Admin; project names are never matched (D-06)
            $table->uuid('project_id')->unique();
            $table->foreign('project_id')
                ->references('id')
                ->on('projects')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('profitability_absence_projects');
        Schema::dropIfExists('member_work_weeks');
        Schema::dropIfExists('member_cost_rates');
    }
};
