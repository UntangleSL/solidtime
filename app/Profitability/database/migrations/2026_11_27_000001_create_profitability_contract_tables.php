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
     * The contract family of the profitability module (Phase 8, D-01 to D-04): the terms of a project
     * (one contract per project), its materialized periods and the monthly plan of each period.
     * Additive and fork-owned: no core table is changed.
     *
     * Every foreign key cascades. The cascade lives in the database because core deletes projects and
     * organizations in bulk without Eloquent events (DeletionService::deleteOrganization): the fork rows
     * go with their project or organization wherever it is deleted.
     */
    public function up(): void
    {
        Schema::create('project_contracts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // The contract is the project (D-01): at most one per project
            $table->uuid('project_id')->unique();
            $table->foreign('project_id')
                ->references('id')
                ->on('projects')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->string('service', 255)->nullable();
            // one_off, monthly, quarterly or annual; the enum arrives with period materialization
            $table->string('schedule', 16);
            $table->date('starts_on');
            $table->date('ends_on')->nullable();
            // Template of every period: money in cents, hours in seconds
            $table->bigInteger('amount_cents');
            $table->bigInteger('budget_seconds');
            // Pause of a running contract (D-18)
            $table->date('paused_on')->nullable();
            $table->date('resume_on')->nullable();
            $table->timestamps();
        });

        Schema::create('contract_periods', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('contract_id');
            $table->foreign('contract_id')
                ->references('id')
                ->on('project_contracts')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Both dates inclusive, local to the profitability timezone
            $table->date('starts_on');
            $table->date('ends_on');
            $table->bigInteger('amount_cents');
            $table->bigInteger('budget_seconds');
            $table->timestamps();
            // Concurrent materialization of the same period cannot create a duplicate
            $table->unique(['contract_id', 'starts_on']);
        });

        Schema::create('contract_period_months', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('period_id');
            $table->foreign('period_id')
                ->references('id')
                ->on('contract_periods')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // First day of the month
            $table->date('month');
            $table->bigInteger('planned_seconds');
            $table->timestamps();
            $table->unique(['period_id', 'month']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('contract_period_months');
        Schema::dropIfExists('contract_periods');
        Schema::dropIfExists('project_contracts');
    }
};
