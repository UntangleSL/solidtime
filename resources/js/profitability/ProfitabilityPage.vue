<script setup lang="ts">
import { computed, provide, ref, type Component } from 'vue';
import { TrendingUp } from '@lucide/vue';
import AppLayout from '@/Layouts/AppLayout.vue';
import MainContainer from '@/packages/ui/src/MainContainer.vue';
import PageTitle from '@/Components/Common/PageTitle.vue';
import { TabBar, TabBarItem } from '@/packages/ui/src';
import {
    PROFITABILITY_TOOLBAR,
    discoverViews,
    readQueryParam,
    replaceQueryParam,
    resolveActiveView,
    t,
    useProfitabilityProps,
    visibleViews,
} from './labels';

// The Profitability page (D-14): header with the tabs the scope may see and the active view's toolbar,
// then the active view. Labels and URLs come from the shared prop (08-02), filled on this route.
//
// View discovery by file name. Naming rule: only the top-level view components of this directory end
// with `View.vue`, and `<Name>View.vue` is the view `<name>` lower-cased (`ProjectsView.vue` ->
// `projects`, see viewKeyFromPath). 08-15, 08-17 and 08-18 add the Settings, Clients and People tabs
// by adding `SettingsView.vue`, `ClientsView.vue` and `PeopleView.vue`; this page is not edited for
// them. A tab needs both the file and the server's `views` entry (T-08-62).
const COMPONENTS = discoverViews(
    import.meta.glob<{ default: Component }>('./*View.vue', { eager: true })
);

const profitability = useProfitabilityProps();
const labels = computed(() => profitability.value.labels ?? null);

const tabs = computed(() => visibleViews(profitability.value.views, Object.keys(COMPONENTS)));

const requestedView = ref<string | null>(readQueryParam('view'));
const activeView = computed(() => resolveActiveView(requestedView.value, tabs.value));
const activeComponent = computed(() =>
    activeView.value === null ? null : (COMPONENTS[activeView.value] ?? null)
);

function selectView(value: string | number) {
    const view = String(value);
    if (!tabs.value.some((tab) => tab === view)) return;
    requestedView.value = view;
    // UI-D13: ?view= is rewritten in place with history.replaceState (no reload, no history spam)
    replaceQueryParam('view', view);
}

const tabModel = computed({
    get: () => activeView.value ?? '',
    set: (value: string) => selectView(value),
});

// The active view teleports its toolbar into this element (right side of the header).
const toolbar = ref<HTMLElement | null>(null);
provide(PROFITABILITY_TOOLBAR, toolbar);

function label(path: string): string {
    return t(labels.value, path);
}
</script>

<template>
    <AppLayout :title="label('page.title')">
        <div data-testid="profitability-page">
            <MainContainer
                class="py-5 border-b border-default-background-separator flex flex-wrap justify-between items-center gap-3">
                <div class="flex flex-wrap items-center gap-y-3">
                    <PageTitle :icon="TrendingUp" :title="label('page.title')" />
                    <div v-if="tabs.length > 0" class="pl-6">
                        <TabBar v-model="tabModel">
                            <TabBarItem
                                v-for="tab in tabs"
                                :key="tab"
                                :value="tab"
                                :data-testid="`profitability-tab-${tab}`">
                                {{ label(`tabs.${tab}`) }}
                            </TabBarItem>
                        </TabBar>
                    </div>
                </div>
                <div
                    ref="toolbar"
                    class="flex flex-wrap items-center gap-3"
                    data-testid="profitability-toolbar"></div>
            </MainContainer>
            <MainContainer class="pt-6 pb-12 space-y-6">
                <component :is="activeComponent" v-if="activeComponent" :key="activeView" />
            </MainContainer>
        </div>
    </AppLayout>
</template>
