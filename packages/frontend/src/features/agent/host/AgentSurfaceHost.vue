<script setup lang="ts">
  import { onBeforeUnmount, ref, watch } from 'vue';
  import { logger } from '@/client/logging/logger';
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

  const refresh = async (reason: 'initial' | 'host-event'): Promise<HostSummaryView | null> => {
    if (!auth.isAuthenticated.value) return null;
    try {
      const next = await agentApi.summary();
      const previousFeatureEnabled = summary.value?.featureEnabled ?? null;
      summary.value = next;
      chooseDefaultApp(next);
      if (!next.featureEnabled) agentWindowManager.closeHub();
      else if (previousFeatureEnabled === false) agentWindowManager.openHub({ restoreRecent: true });
      if (previousFeatureEnabled !== null && previousFeatureEnabled !== next.featureEnabled) {
        logger.info(
          { userId: activeUserId, previousFeatureEnabled, featureEnabled: next.featureEnabled },
          'Agent global surface feature state changed',
        );
      }
      logger.debug(
        {
          reason,
          userId: activeUserId,
          generation,
          featureEnabled: next.featureEnabled,
          eventCursor: next.eventCursor,
          appCount: next.apps.length,
          runningRuns: next.totalRunningRuns,
          pendingApprovals: next.totalPendingApprovals,
          pendingBudgetRequests: next.totalPendingBudgetRequests,
        },
        'Agent global surface summary refreshed',
      );
      return next;
    } catch (cause) {
      logger.warn({ err: cause, reason, userId: activeUserId, generation }, 'Failed to refresh Agent global surface');
      return null;
    }
  };

  const stop = (reason: string): void => {
    const previousGeneration = generation;
    generation += 1;
    const hadSubscription = hostAbort !== null;
    hostAbort?.abort();
    hostAbort = null;
    if (hadSubscription) {
      logger.debug(
        { reason, userId: activeUserId, previousGeneration, generation },
        'Agent global surface event subscription stopped',
      );
    }
  };

  const start = async (): Promise<void> => {
    stop('restart');
    logger.debug({ userId: activeUserId, generation }, 'Agent global surface starting');
    const initial = await refresh('initial');
    if (!initial) return;
    const controller = new AbortController();
    hostAbort = controller;
    const currentGeneration = ++generation;
    logger.debug(
      { userId: activeUserId, generation: currentGeneration, cursor: initial.eventCursor },
      'Agent global surface event subscription starting',
    );
    void (async () => {
      try {
        for await (const event of agentEvents.host(initial.eventCursor, controller.signal)) {
          if (controller.signal.aborted || currentGeneration !== generation) return;
          logger.debug(
            {
              userId: activeUserId,
              generation: currentGeneration,
              eventType: event.type,
              sourceType: event.type === 'host.changed' ? event.sourceType : undefined,
              eventId: event.id,
            },
            'Agent global surface host event received',
          );
          await refresh('host-event');
        }
      } catch (cause) {
        if (controller.signal.aborted || currentGeneration !== generation) return;
        logger.warn(
          { err: cause, userId: activeUserId, generation: currentGeneration },
          'Agent global surface event subscription ended unexpectedly',
        );
      }
    })();
  };

  const persistLayout = (reason: string): void => {
    if (activeUserId === null) return;
    agentWindowManager.persistForUser(activeUserId);
    logger.debug({ reason, userId: activeUserId }, 'Agent global surface layout persistence requested');
  };

  watch(
    () => [auth.isAuthenticated.value, auth.user.value?.id ?? null] as const,
    ([authenticated, userId]) => {
      if (authenticated && userId !== null) {
        activeUserId = userId;
        logger.debug({ userId }, 'Agent global surface attached to authenticated shell');
        agentWindowManager.restoreForUser(userId);
        void start();
        return;
      }
      persistLayout('auth-ended');
      logger.debug({ userId: activeUserId }, 'Agent global surface detached from authenticated shell');
      activeUserId = null;
      stop('auth-ended');
      summary.value = null;
      resetAgentCsrf();
      agentWindowManager.reset();
      agentSurfaceSession.disposeSession();
    },
    { immediate: true },
  );

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') persistLayout('document-hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);

  onBeforeUnmount(() => {
    persistLayout('host-unmount');
    document.removeEventListener('visibilitychange', onVisibility);
    stop('host-unmount');
    agentWindowManager.reset();
    agentSurfaceSession.disposeSession();
  });
</script>

<template>
  <Teleport to="body">
    <template v-if="auth.isAuthenticated.value && summary">
      <AgentHubWindow
        v-if="summary.featureEnabled"
        :summary="summary"
        @layout-change="persistLayout('window-interaction')"
      />
      <AgentLauncher
        v-if="summary.featureEnabled"
        :summary="summary"
        @layout-change="persistLayout('launcher-interaction')"
      />
    </template>
  </Teleport>
</template>
