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
        Schema::create('organization_icons', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            // One icon per organization, removed together with the organization (the file is removed
            // by the BeforeOrganizationDeletion listener)
            $table->uuid('organization_id')->unique();
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->cascadeOnDelete()
                ->cascadeOnUpdate();
            // Path on the public disk: organization-icons/<uuid>.<png|jpeg>
            $table->string('path');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('organization_icons');
    }
};
