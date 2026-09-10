<script setup lang="ts">
  import { computed, watch } from 'vue';
  import { RouterView } from 'vue-router';
  import AppHeader from './shell/AppHeader.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { AppearanceCustomizerModal, useAppearance } from '@/features/appearance/public';
  import { AgentSurfaceHost } from '@/features/agent/public';
  import { RemoteDesktopModal, remoteDesktopLauncher } from '@/features/remote-desktop/public';
  import { usePreferences } from '@/features/preferences/public';
  import DialogHost from '@/shared/feedback/components/DialogHost.vue';
  import NotificationHost from '@/shared/feedback/components/NotificationHost.vue';
  import { disposeWorkspaceRuntime } from './workspaceLifecycle';

  const auth = useAuthSession();
  const appearance = useAppearance();
  const appearanceCustomizerVisible = appearance.customizerVisible;
  const preferences = usePreferences();
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
  const saveRemoteDesktopSize = (size: { width: number; height: number }) => {
    const type = remoteDesktopConnection.value?.type;
    if (!type) return;
    void preferences
      .update(
        type === 'VNC'
          ? { vncModalWidth: size.width, vncModalHeight: size.height }
          : { rdpModalWidth: size.width, rdpModalHeight: size.height },
      )
      .catch((cause) => console.error('[RemoteDesktop] Failed to persist window size:', cause));
  };

  watch(
    auth.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (authenticated) {
        void appearance
          .load()
          .catch((cause) => console.error('[Appearance] Failed to load application settings:', cause));
        void preferences
          .load()
          .catch((cause) => console.error('[Preferences] Failed to load application settings:', cause));
        return;
      }
      remoteDesktopLauncher.close();
      if (wasAuthenticated) void disposeWorkspaceRuntime();
    },
    { immediate: true },
  );
</script>

<template>
  <div class="flex min-h-dvh flex-col text-foreground">
    <AppHeader v-if="auth.isAuthenticated.value" @customize-appearance="appearance.openCustomizer()" />
    <div class="min-h-0 flex-1">
      <RouterView />
    </div>
    <AgentSurfaceHost v-if="auth.isAuthenticated.value" />
    <RemoteDesktopModal
      :visible="remoteDesktopVisible"
      :connection="remoteDesktopConnection"
      :width="remoteDesktopWidth"
      :height="remoteDesktopHeight"
      @size-change="saveRemoteDesktopSize"
      @close="remoteDesktopLauncher.close()"
    />
    <AppearanceCustomizerModal :visible="appearanceCustomizerVisible" @close="appearance.closeCustomizer()" />
    <NotificationHost />
    <DialogHost />
  </div>
</template>
