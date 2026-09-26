<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
  import { RouterView } from 'vue-router';
  import { preloadAuthenticatedRoutes } from './router';
  import { logger } from '@/client/logging/logger';
  import AppHeader from './shell/AppHeader.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { loadAppearanceCustomizerModal, useAppearance } from '@/features/appearance/public';
  import { AgentSurfaceHost } from '@/features/agent/public';
  import { markConnectionConnected } from '@/features/connections/public';
  import { loadRemoteDesktopModal, remoteDesktopLauncher } from '@/features/remote-desktop/public';
  import { usePreferences } from '@/features/preferences/public';
  import { DialogHost, NotificationHost, RuntimeErrorBoundary } from '@/shared/feedback/public';
  import { authenticatedSessionLifecycle, type AuthenticatedSessionDispatch } from '@/shared/session/public';
  import { disposeWorkspaceRuntime } from './workspaceLifecycle';

  const RemoteDesktopModal = defineAsyncComponent(loadRemoteDesktopModal);
  const AppearanceCustomizerModal = defineAsyncComponent(loadAppearanceCustomizerModal);
  const auth = useAuthSession();
  const appearance = useAppearance();
  const appearanceCustomizerVisible = appearance.customizerVisible;
  const preferences = usePreferences();
  const authenticatedPageCacheGeneration = ref(0);
  const remoteDesktopConnection = remoteDesktopLauncher.connection;
  const remoteDesktopVisible = remoteDesktopLauncher.visible;
  const remoteDesktopWidth = computed(() =>
    remoteDesktopConnection.value?.type === 'VNC'
      ? preferences.values.value.vncModalWidth
      : preferences.values.value.rdpModalWidth,
  );
  const remoteDesktopHeight = computed(() =>
    remoteDesktopConnection.value?.type === 'VNC'
      ? preferences.values.value.vncModalHeight
      : preferences.values.value.rdpModalHeight,
  );
  const updateRemoteDesktopConnection = (connectionId: number, lastConnectedAt: number) => {
    markConnectionConnected(connectionId, lastConnectedAt);
  };

  const saveRemoteDesktopSize = (size: { width: number; height: number }) => {
    const type = remoteDesktopConnection.value?.type;
    if (!type) return;
    void preferences
      .update(
        type === 'VNC'
          ? { vncModalWidth: size.width, vncModalHeight: size.height }
          : { rdpModalWidth: size.width, rdpModalHeight: size.height },
      )
      .catch((cause) => logger.error({ err: cause }, 'Failed to persist remote desktop window size'));
  };

  const reportSessionCleanupFailures = (result: AuthenticatedSessionDispatch | null): void => {
    if (!result) return;
    for (const failure of result.failures) {
      logger.error(
        { err: failure.cause, ownerId: failure.ownerId, sessionEvent: result.event.type },
        'Authenticated session owner cleanup failed',
      );
    }
  };

  const disposeAuthenticatedShell = (): void => {
    authenticatedPageCacheGeneration.value += 1;
    remoteDesktopLauncher.close();
    void disposeWorkspaceRuntime();
  };

  watch(
    [auth.isAuthenticated, () => auth.user.value?.id ?? null],
    ([authenticated, userId]) => {
      if (authenticated && userId !== null) {
        const result = authenticatedSessionLifecycle.attach(userId);
        reportSessionCleanupFailures(result);
        if (result?.event.type === 'user-changed') disposeAuthenticatedShell();
        preloadAuthenticatedRoutes();
        void appearance.load().catch((cause) => logger.error({ err: cause }, 'Failed to load appearance settings'));
        void preferences
          .load()
          .catch((cause) => logger.error({ err: cause }, 'Failed to load application preferences'));
        return;
      }
      const result = authenticatedSessionLifecycle.logout();
      reportSessionCleanupFailures(result);
      if (result) disposeAuthenticatedShell();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    reportSessionCleanupFailures(authenticatedSessionLifecycle.dispose());
    remoteDesktopLauncher.close();
    void disposeWorkspaceRuntime();
  });
</script>

<template>
  <div class="flex min-h-dvh flex-col text-foreground">
    <AppHeader v-if="auth.isAuthenticated.value" @customize-appearance="appearance.openCustomizer()" />
    <div class="min-h-0 flex-1">
      <RouterView v-slot="{ Component, route }">
        <RuntimeErrorBoundary scope="route" :reset-key="route.fullPath">
          <KeepAlive :key="authenticatedPageCacheGeneration">
            <component v-if="route.meta.keepAlive" :is="Component" :key="String(route.name)" />
          </KeepAlive>
          <component v-if="!route.meta.keepAlive" :is="Component" />
        </RuntimeErrorBoundary>
      </RouterView>
    </div>
    <RuntimeErrorBoundary v-if="auth.isAuthenticated.value" scope="agent" :reset-key="auth.user.value?.id ?? null">
      <AgentSurfaceHost />
    </RuntimeErrorBoundary>
    <RemoteDesktopModal
      v-if="remoteDesktopVisible"
      :visible="true"
      :connection="remoteDesktopConnection"
      :width="remoteDesktopWidth"
      :height="remoteDesktopHeight"
      @size-change="saveRemoteDesktopSize"
      @connected="updateRemoteDesktopConnection"
      @close="remoteDesktopLauncher.close()"
    />
    <AppearanceCustomizerModal
      v-if="appearanceCustomizerVisible"
      :visible="true"
      @close="appearance.closeCustomizer()"
    />
    <NotificationHost />
    <DialogHost />
  </div>
</template>
