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
     * Project managers and account managers of the profitability module (Phase 8, D-10): assignments of
     * a member to a project or to a client, never solidtime roles. Core roles and PermissionStore stay
     * unchanged; these rows are the only thing that grants a non-admin access to profitability data.
     * Additive and fork-owned: no core table is changed.
     *
     * Every foreign key cascades. The cascade lives in the database because core deletes members,
     * projects, clients and organizations in bulk without Eloquent events
     * (DeletionService::deleteOrganization): an assignment goes with its member, project, client or
     * organization wherever it is deleted.
     */
    public function up(): void
    {
        Schema::create('project_managers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('project_id');
            $table->foreign('project_id')
                ->references('id')
                ->on('projects')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('member_id');
            $table->foreign('member_id')
                ->references('id')
                ->on('members')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->timestamps();
            // One row per pair: a concurrent second assignment is a no-op (insertOrIgnore)
            $table->unique(['project_id', 'member_id']);
            // The resolver reads the assignments of one member on every request
            $table->index('member_id');
        });

        Schema::create('client_account_managers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('client_id');
            $table->foreign('client_id')
                ->references('id')
                ->on('clients')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('member_id');
            $table->foreign('member_id')
                ->references('id')
                ->on('members')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            $table->timestamps();
            $table->unique(['client_id', 'member_id']);
            $table->index('member_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('client_account_managers');
        Schema::dropIfExists('project_managers');
    }
};
