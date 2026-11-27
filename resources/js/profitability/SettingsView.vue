<script setup lang="ts">
import PeopleSettingsCard from './PeopleSettingsCard.vue';

// The Settings tab of the Profitability page (D-12, D-16). ProfitabilityPage discovers this file by
// its `*View.vue` name and renders it only when the server lists the `settings` view, which it does
// for Owner and Admin alone; every endpoint behind it answers 404 to any other scope.
</script>

<template>
    <div data-testid="profitability-settings-view" class="space-y-6">
        <PeopleSettingsCard />
    </div>
</template>
