<script setup lang="ts">
  import { watch } from 'vue';
  import { RouterView } from 'vue-router';
  import AppHeader from './shell/AppHeader.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { AppearanceCustomizerModal, useAppearanceStore } from '@/features/appearance/public';
  import DialogHost from '@/shared/feedback/components/DialogHost.vue';
  import NotificationHost from '@/shared/feedback/components/NotificationHost.vue';

  const auth = useAuthSession();
  const appearance = useAppearanceStore();

  watch(
    auth.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (authenticated) {
        void appearance.load();
        return;
      }
      if (wasAuthenticated) {
        void import('@/runtimes/workspace/session').then(({ workspaceRuntimeRegistry }) =>
          workspaceRuntimeRegistry.disposeAll(),
        );
      }
    },
    { immediate: true },
  );
</script>

<template>
  <div class="flex min-h-dvh flex-col text-foreground">
    <AppHeader @customize-appearance="appearance.openCustomizer()" />
    <div class="min-h-0 flex-1">
      <RouterView />
    </div>
    <AppearanceCustomizerModal :visible="appearance.customizerVisible" @close="appearance.closeCustomizer()" />
    <NotificationHost />
    <DialogHost />
  </div>
</template>
