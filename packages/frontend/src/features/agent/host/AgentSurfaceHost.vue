<script setup lang="ts">
  import { onBeforeUnmount, ref, watch } from 'vue';
  import { logger } from '@/client/logging/logger';
  import { useAuthSession } from '@/features/auth/public';
  import { agentApi, resetAgentCsrf, type AgentHostSummaryDto } from '../api/agent-api';
  import { agentEvents } from '../api/agent-events';
  import AgentHubWindow from './AgentHubWindow.vue';
  import AgentLauncher from './AgentLauncher.vue';
  import { agentHostEvents } from './agent-host-events';
  import { agentSurfaceSession } from './surface-session';
  import { agentWindowManager } from './window-manager';

  const auth = useAuthSession();
  const summary = ref<AgentHostSummaryDto | null>(null);
  const HOST_STREAM_LOCK_NAME = 'nexus.agent.host-stream.v1';
  const HOST_EVENT_CHANNEL_NAME = 'nexus.agent.host-events.v1';
  const hostChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(HOST_EVENT_CHANNEL_NAME);

  let hostAbort: AbortController | null = null;
  let generation = 0;
  let refreshGeneration = 0;
  let activeUserId: number | null = null;

  const dispatchThreadChanged = (payload: Record<string, unknown>): void => {
    agentHostEvents.emit('thread-changed', payload);
  };

  const dispatchAuthorizationChanged = (payload: Record<string, unknown> = {}): void => {
    agentHostEvents.emit('authorization-changed', payload);
  };

  const dispatchMemoryChanged = (payload: Record<string, unknown>): void => {
    agentHostEvents.emit('memory-changed', payload);
  };

  const chooseDefaultApp = (next: AgentHostSummaryDto): void => {
    const enabled = next.apps.filter((app) => app.enabled);
    if (enabled.length === 0) {
      agentWindowManager.closeHub();
      return;
    }
    const current = enabled.find((app) => app.id === agentWindowManager.state.activeAppId);
    if (current) return;
    const preferred = enabled.find((app) => app.id === 'nexus.agent') ?? enabled[0]!;
    agentWindowManager.switchApp({ appId: preferred.id });
  };

  const refresh = async (reason: 'initial' | 'host-event'): Promise<AgentHostSummaryDto | null> => {
    if (!auth.isAuthenticated.value || activeUserId === null) return null;
    const requestGeneration = ++refreshGeneration;
    const requestUserId = activeUserId;
    try {
      const next = await agentApi.summary();
      if (!auth.isAuthenticated.value || activeUserId !== requestUserId) return null;
      if (requestGeneration !== refreshGeneration) return next;
      const previousFeatureEnabled = summary.value?.featureEnabled ?? null;
      summary.value = next;
      chooseDefaultApp(next);
      if (!next.featureEnabled) agentWindowManager.closeHub();
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
          refreshGeneration: requestGeneration,
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
      if (!auth.isAuthenticated.value || activeUserId !== requestUserId) return null;
      if (requestGeneration !== refreshGeneration) return summary.value;
      logger.warn(
        { err: cause, reason, userId: activeUserId, generation, refreshGeneration: requestGeneration },
        'Failed to refresh Agent global surface',
      );
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

  const runHostStreamAsLeader = async (controller: AbortController, currentGeneration: number): Promise<void> => {
    const initial = await refresh('initial');
    if (!initial || controller.signal.aborted || currentGeneration !== generation) return;
    logger.debug(
      { userId: activeUserId, generation: currentGeneration, cursor: initial.eventCursor },
      'Agent global surface event subscription starting as cross-tab leader',
    );
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
      if (event.type === 'host.changed' && event.sourceType === 'thread.changed') {
        dispatchThreadChanged(event.payload);
      }
      if (event.type === 'host.changed' && event.sourceType === 'authorization.changed') {
        dispatchAuthorizationChanged(event.payload);
      }
      if (event.type === 'host.changed' && event.sourceType === 'memory.changed') {
        dispatchMemoryChanged(event.payload);
      }
      await refresh('host-event');
      if (activeUserId !== null) {
        hostChannel?.postMessage({
          type: 'host.changed',
          userId: activeUserId,
          sourceType: event.type === 'host.changed' ? event.sourceType : undefined,
          payload: event.type === 'host.changed' ? event.payload : undefined,
        });
      }
    }
  };

  const start = (): void => {
    stop('restart');
    const controller = new AbortController();
    hostAbort = controller;
    const currentGeneration = ++generation;
    logger.debug(
      { userId: activeUserId, generation: currentGeneration },
      'Agent global surface host coordination starting',
    );
    void (async () => {
      try {
        if (typeof navigator.locks?.request === 'function') {
          await navigator.locks.request(
            HOST_STREAM_LOCK_NAME,
            { mode: 'exclusive', signal: controller.signal },
            async () => {
              if (controller.signal.aborted || currentGeneration !== generation) return;
              logger.debug(
                { userId: activeUserId, generation: currentGeneration },
                'Agent global surface acquired cross-tab host stream ownership',
              );
              await runHostStreamAsLeader(controller, currentGeneration);
            },
          );
          return;
        }
        await runHostStreamAsLeader(controller, currentGeneration);
      } catch (cause) {
        if (controller.signal.aborted || currentGeneration !== generation) return;
        logger.warn(
          { err: cause, userId: activeUserId, generation: currentGeneration },
          'Agent global surface host coordination ended unexpectedly',
        );
      }
    })();
  };

  const persistLayout = (reason: string): void => {
    if (activeUserId === null) return;
    agentWindowManager.persistForUser(activeUserId);
    logger.debug({ reason, userId: activeUserId }, 'Agent global surface layout persistence requested');
  };

  const detachUserScopedState = (reason: string): void => {
    const detachedUserId = activeUserId;
    refreshGeneration += 1;
    persistLayout(reason);
    stop(reason);
    summary.value = null;
    resetAgentCsrf();
    agentWindowManager.reset();
    agentSurfaceSession.disposeSession();
    logger.debug({ reason, userId: detachedUserId }, 'Agent global surface user-scoped state cleared');
  };

  watch(
    () => [auth.isAuthenticated.value, auth.user.value?.id ?? null] as const,
    ([authenticated, userId]) => {
      if (authenticated && userId !== null) {
        if (activeUserId !== null && activeUserId !== userId) {
          const previousUserId = activeUserId;
          detachUserScopedState('user-changed');
          logger.info({ previousUserId, userId }, 'Agent global surface authenticated user changed');
        }
        activeUserId = userId;
        logger.debug({ userId }, 'Agent global surface attached to authenticated shell');
        agentWindowManager.restoreForUser(userId);
        void refresh('initial');
        start();
        return;
      }
      const detachedUserId = activeUserId;
      detachUserScopedState('auth-ended');
      logger.debug({ userId: detachedUserId }, 'Agent global surface detached from authenticated shell');
      activeUserId = null;
    },
    { immediate: true },
  );

  const onHostBroadcast = (event: MessageEvent<unknown>): void => {
    if (!auth.isAuthenticated.value || activeUserId === null) return;
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    const message = event.data as {
      type?: unknown;
      userId?: unknown;
      sourceType?: unknown;
      payload?: unknown;
    };
    if (message.type !== 'host.changed' || message.userId !== activeUserId) return;
    if (
      message.sourceType === 'thread.changed' &&
      message.payload &&
      typeof message.payload === 'object' &&
      !Array.isArray(message.payload)
    ) {
      dispatchThreadChanged(message.payload as Record<string, unknown>);
    }
    if (message.sourceType === 'authorization.changed') {
      dispatchAuthorizationChanged(
        message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
          ? (message.payload as Record<string, unknown>)
          : {},
      );
    }
    if (
      message.sourceType === 'memory.changed' &&
      message.payload &&
      typeof message.payload === 'object' &&
      !Array.isArray(message.payload)
    ) {
      dispatchMemoryChanged(message.payload as Record<string, unknown>);
    }
    void refresh('host-event');
  };
  hostChannel?.addEventListener('message', onHostBroadcast);

  const onLocalHostChanged = (): void => {
    if (!auth.isAuthenticated.value || activeUserId === null) return;
    void refresh('host-event');
    if (activeUserId !== null) hostChannel?.postMessage({ type: 'host.changed', userId: activeUserId });
  };
  const stopLocalHostChanged = agentHostEvents.on('host-changed', onLocalHostChanged);

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') persistLayout('document-hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);

  onBeforeUnmount(() => {
    detachUserScopedState('host-unmount');
    activeUserId = null;
    document.removeEventListener('visibilitychange', onVisibility);
    stopLocalHostChanged();
    hostChannel?.removeEventListener('message', onHostBroadcast);
    hostChannel?.close();
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
        v-if="summary.featureEnabled && agentWindowManager.state.status !== 'visible'"
        :summary="summary"
        @layout-change="persistLayout('launcher-interaction')"
      />
    </template>
  </Teleport>
</template>
