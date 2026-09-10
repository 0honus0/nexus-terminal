<script setup lang="ts">
  import { computed, ref } from 'vue';
  import type { AgentAppSummary } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; activeAppId: string | null }>();
  const emit = defineEmits<{ switch: [appId: string] }>();
  const query = ref('');
  const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return props.apps
      .filter((app) => app.enabled)
      .filter((app) => !needle || `${app.displayName} ${app.id}`.toLowerCase().includes(needle));
  });
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <label class="sr-only" for="agent-app-search">{{ $t('agent.hub.searchApps') }}</label>
    <input
      id="agent-app-search"
      v-model="query"
      type="search"
      class="hidden w-40 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary sm:block"
      :placeholder="$t('agent.hub.searchApps')"
    />
    <select
      class="max-w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
      :value="activeAppId ?? ''"
      :aria-label="$t('agent.hub.appSwitcher')"
      @change="emit('switch', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>{{ $t('agent.hub.chooseApp') }}</option>
      <option v-for="app in filtered" :key="app.id" :value="app.id">{{ app.displayName }} · {{ app.health }}</option>
    </select>
  </div>
</template>
