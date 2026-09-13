<script setup lang="ts">
  import { computed, ref } from 'vue';
  import type { AgentAppSummary } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; activeAppId: string | null }>();
  const emit = defineEmits<{ switch: [appId: string] }>();
  const query = ref('');
  const enabledApps = computed(() => props.apps.filter((app) => app.enabled));
  const filteredApps = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (!needle) return enabledApps.value;
    return enabledApps.value.filter(
      (app) => app.id === props.activeAppId || `${app.displayName} ${app.id}`.toLowerCase().includes(needle),
    );
  });
  const showSearch = computed(() => enabledApps.value.length > 5);
  const activityCount = (app: AgentAppSummary): number =>
    app.runningRuns + app.pendingApprovals + app.pendingBudgetRequests;
</script>

<template>
  <div class="flex min-w-0 items-center gap-1.5">
    <label v-if="showSearch" class="agent-app-search relative">
      <span class="sr-only">{{ $t('agent.hub.searchApps') }}</span>
      <i
        class="fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[7px] text-text-secondary"
        aria-hidden="true"
      ></i>
      <input
        v-model="query"
        type="search"
        class="h-7 w-28 rounded-lg border border-border bg-background pl-6 pr-2 text-[9px] outline-none focus:border-primary"
        :placeholder="$t('agent.hub.searchApps')"
      />
    </label>
    <div class="relative min-w-0">
      <select
        class="max-w-52 appearance-none rounded-lg border border-border bg-background py-1.5 pl-2.5 pr-7 text-[11px] font-medium outline-none focus:border-primary"
        :value="activeAppId ?? ''"
        :aria-label="$t('agent.hub.appSwitcher')"
        @change="emit('switch', ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ $t('agent.hub.chooseApp') }}</option>
        <option v-for="app in filteredApps" :key="app.id" :value="app.id">
          {{ app.displayName }} · {{ app.health }}{{ activityCount(app) ? ` · ${activityCount(app)}` : '' }}
        </option>
      </select>
      <i
        class="fa-solid fa-chevron-down pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] text-text-secondary"
        aria-hidden="true"
      ></i>
    </div>
  </div>
</template>

<style scoped>
  .agent-app-search {
    display: block;
  }

  @container agent-hub-window (max-width: 900px) {
    .agent-app-search {
      display: none;
    }
  }
</style>
