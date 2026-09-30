<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiConfirmationPanel } from '@/foundation/ui';
  import { useDialogStore } from '../store/dialog.store';

  const store = useDialogStore();
  const { t } = useI18n();

  const title = computed(
    () => store.state.title || (store.state.kind === 'confirm' ? t('feedback.confirmTitle') : t('feedback.alertTitle')),
  );
  const primaryText = computed(
    () => store.state.confirmText || (store.state.kind === 'confirm' ? t('common.confirm') : t('common.ok')),
  );
  const cancelText = computed(() => store.state.cancelText || t('common.cancel'));

  const closeFromBackdrop = (): void => {
    if (store.state.loading) return;
    if (store.state.kind === 'alert') store.accept();
    else store.cancel();
  };
</script>

<template>
  <UiConfirmationPanel
    :visible="store.state.visible"
    :z-index="9999"
    :close-on-escape="true"
    :focus-on-open="true"
    :restore-focus="true"
    backdrop-trigger="mousedown"
    :title="title"
    :description="store.state.message"
    :tone="store.state.destructive ? 'danger' : 'primary'"
    :icon="store.state.destructive ? 'fas fa-exclamation-triangle' : 'fas fa-question-circle'"
    @close="closeFromBackdrop"
  >
    <template #actions>
      <UiButton
        v-if="store.state.kind === 'confirm'"
        type="button"
        :disabled="store.state.loading"
        appearance="soft"
        @click="store.cancel"
      >
        {{ cancelText }}
      </UiButton>
      <UiButton
        type="button"
        appearance="solid"
        :tone="store.state.destructive ? 'danger' : 'primary'"
        :loading="store.state.loading"
        @click="store.accept"
      >
        {{ primaryText }}
      </UiButton>
    </template>
  </UiConfirmationPanel>
</template>
