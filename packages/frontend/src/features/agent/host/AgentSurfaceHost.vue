<script setup lang="ts">
  import { onBeforeUnmount, ref, watch } from 'vue';
  import { useAuthSession } from '@/features/auth/public';
  import { agentApi, resetAgentCsrf, type HostSummaryView } from '../api/agent-api';
  import { agentEvents } from '../api/agent-events';
  import AgentHubWindow from './AgentHubWindow.vue';
  import AgentLauncher from './AgentLauncher.vue';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const auth = useAuthSession();
  const summary = ref<HostSummaryView | null>(null);
  let hostAbort: AbortController | null = null;
  let generation = 0;
  let activeUserId: number | null = null;

  const chooseDefaultApp = (next: HostSummaryView): void => {
    const enabled = next.apps.filter((app) => app.enabled);
    if (enabled.length === 0) {
      agentWindowManager.closeHub();
      return;
    }
    const current = enabled.find((app) => app.id === agentWindowManager.state.activeAppId);
    if (current) return;
    const preferred = enabled.find((app) => app.id === 'nexus.operations') ?? enabled[0]!;
    agentWindowManager.switchApp({ appId: preferred.id });
  };

  const refresh = async (): Promise<HostSummaryView | null> => {
    if (!auth.isAuthenticated.value) return null;
    try {
      const next = await agentApi.summary();
      summary.value = next;
      chooseDefaultApp(next);
      if (!next.featureEnabled) agentWindowManager.closeHub();
      return next;
    } catch {
      return null;
    }
  };

  const stop = (): void => {
    generation += 1;
    hostAbort?.abort();
    hostAbort = null;
  };

  const start = async (): Promise<void> => {
    stop();
    const initial = await refresh();
    if (!initial) return;
    const controller = new AbortController();
    hostAbort = controller;
    const currentGeneration = ++generation;
    void (async () => {
      try {
        for await (const _event of agentEvents.host(initial.eventCursor, controller.signal)) {
          if (controller.signal.aborted || currentGeneration !== generation) return;
          await refresh();
        }
      } catch {
        if (controller.signal.aborted || currentGeneration !== generation) return;
      }
    })();
  };

  const persistLayout = (): void => {
    if (activeUserId !== null) agentWindowManager.persistForUser(activeUserId);
  };

  watch(
    () => [auth.isAuthenticated.value, auth.user.value?.id ?? null] as const,
    ([authenticated, userId]) => {
      if (authenticated && userId !== null) {
        activeUserId = userId;
        agentWindowManager.restoreForUser(userId);
        void start();
        return;
      }
      persistLayout();
      activeUserId = null;
      stop();
      summary.value = null;
      resetAgentCsrf();
      agentWindowManager.reset();
      agentSurfaceSession.disposeSession();
    },
    { immediate: true },
  );

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') persistLayout();
  };
  document.addEventListener('visibilitychange', onVisibility);

  onBeforeUnmount(() => {
    persistLayout();
    document.removeEventListener('visibilitychange', onVisibility);
    stop();
    agentWindowManager.reset();
    agentSurfaceSession.disposeSession();
  });
</script>

<template>
  <template v-if="auth.isAuthenticated.value && summary">
    <AgentHubWindow v-if="summary.featureEnabled" :summary="summary" />
    <AgentLauncher v-if="summary.featureEnabled" :summary="summary" />
  </template>
</template>
