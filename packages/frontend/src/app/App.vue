<script setup lang="ts">
  import { computed, defineAsyncComponent, ref, watch } from 'vue';
  import { RouterView } from 'vue-router';
  import { preloadAuthenticatedRoutes } from './router';
  import { logger } from '@/client/logging/logger';
  import AppHeader from './shell/AppHeader.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { loadAppearanceCustomizerModal, resetAppearanceCache, useAppearance } from '@/features/appearance/public';
  import { AgentSurfaceHost } from '@/features/agent/public';
  import { markConnectionConnected, resetConnectionsCache } from '@/features/connections/public';
  import { loadRemoteDesktopModal, remoteDesktopLauncher } from '@/features/remote-desktop/public';
  import { resetPreferencesCache, usePreferences } from '@/features/preferences/public';
  import { DialogHost, NotificationHost } from '@/shared/feedback/public';
  import { resetProxiesCache } from '@/features/proxies/public';
  import { resetConnectionTagsCache } from '@/features/tags/public';
  import { resetNotificationsCache } from '@/features/notifications/public';
  import { resetAuditCache } from '@/features/audit/public';
  import { resetSuspendedSessionsCatalog } from '@/features/ssh-suspend/public';
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

  const resetAuthenticatedUiState = () => {
    authenticatedPageCacheGeneration.value += 1;
    resetConnectionsCache();
    resetConnectionTagsCache();
    resetProxiesCache();
    resetNotificationsCache();
    resetAuditCache();
    resetSuspendedSessionsCatalog();
    resetPreferencesCache();
    resetAppearanceCache();
  };

  watch(
    () => auth.user.value?.id ?? null,
    (userId, previousUserId) => {
      if (previousUserId !== null && userId !== null && userId !== previousUserId) resetAuthenticatedUiState();
    },
  );

  watch(
    auth.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (authenticated) {
        preloadAuthenticatedRoutes();
        void appearance.load().catch((cause) => logger.error({ err: cause }, 'Failed to load appearance settings'));
        void preferences
          .load()
          .catch((cause) => logger.error({ err: cause }, 'Failed to load application preferences'));
        return;
      }
      remoteDesktopLauncher.close();
      if (wasAuthenticated) {
        resetAuthenticatedUiState();
        void disposeWorkspaceRuntime();
      }
    },
    { immediate: true },
  );
</script>

<template>
  <div class="flex min-h-dvh flex-col text-foreground">
    <AppHeader v-if="auth.isAuthenticated.value" @customize-appearance="appearance.openCustomizer()" />
    <div class="min-h-0 flex-1">
      <RouterView v-slot="{ Component, route }">
        <KeepAlive :key="authenticatedPageCacheGeneration">
          <component v-if="route.meta.keepAlive" :is="Component" :key="String(route.name)" />
        </KeepAlive>
        <component v-if="!route.meta.keepAlive" :is="Component" />
      </RouterView>
    </div>
    <AgentSurfaceHost v-if="auth.isAuthenticated.value" />
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
