<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { RouterView } from 'vue-router';
  import AppHeader from './shell/AppHeader.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { AppearanceCustomizerModal, useAppearanceStore } from '@/features/appearance/public';
  import DialogHost from '@/shared/feedback/components/DialogHost.vue';
  import NotificationHost from '@/shared/feedback/components/NotificationHost.vue';

  const auth = useAuthSession();
  const appearance = useAppearanceStore();
  const appearanceVisible = ref(false);

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
    <AppHeader @customize-appearance="appearanceVisible = true" />
    <div class="min-h-0 flex-1">
      <RouterView />
    </div>
    <AppearanceCustomizerModal :visible="appearanceVisible" @close="appearanceVisible = false" />
    <NotificationHost />
    <DialogHost />
  </div>
</template>
