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
        Schema::table('microsoft_accounts', function (Blueprint $table): void {
            // Set when a refresh or a Graph call proves the user has to sign in again; NULL means no problem recorded
            $table->dateTime('reconnect_required_at')->nullable();
            // Persisted Graph throttling back-off: no Graph request is sent before this moment
            $table->dateTime('graph_backoff_until')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('microsoft_accounts', function (Blueprint $table): void {
            $table->dropColumn(['reconnect_required_at', 'graph_backoff_until']);
        });
    }
};
