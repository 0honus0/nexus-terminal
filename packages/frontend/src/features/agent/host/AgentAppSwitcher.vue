<script setup lang="ts">
  import { computed, ref } from 'vue';
  import type { AgentAppSummary } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; activeAppId: string | null }>();
  const emit = defineEmits<{ switch: [appId: string] }>();
  const query = ref('');
  const enabledApps = computed(() => props.apps.filter((app) => app.enabled));
  const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return enabledApps.value.filter((app) => !needle || `${app.displayName} ${app.id}`.toLowerCase().includes(needle));
  });
  const showSearch = computed(() => enabledApps.value.length > 4);
</script>

<template>
  <div class="flex min-w-0 items-center gap-1.5">
    <label class="sr-only" for="agent-app-search">{{ $t('agent.hub.searchApps') }}</label>
    <input
      v-if="showSearch"
      id="agent-app-search"
      v-model="query"
      type="search"
      class="hidden w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-[10px] outline-none focus:border-primary md:block"
      :placeholder="$t('agent.hub.searchApps')"
    />
    <div class="relative min-w-0">
      <select
        class="max-w-48 appearance-none rounded-lg border border-border bg-background py-1.5 pl-2.5 pr-7 text-[11px] font-medium outline-none focus:border-primary"
        :value="activeAppId ?? ''"
        :aria-label="$t('agent.hub.appSwitcher')"
        @change="emit('switch', ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ $t('agent.hub.chooseApp') }}</option>
        <option v-for="app in filtered" :key="app.id" :value="app.id">{{ app.displayName }} · {{ app.health }}</option>
      </select>
      <i
        class="fa-solid fa-chevron-down pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] text-text-secondary"
        aria-hidden="true"
      ></i>
    </div>
  </div>
</template>
