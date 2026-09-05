<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';
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
  const titleId = 'shared-dialog-title';

  const closeFromBackdrop = (): void => {
    if (store.state.loading) return;
    if (store.state.kind === 'alert') store.accept();
    else store.cancel();
  };
</script>

<template>
  <OverlayPanel
    :visible="store.state.visible"
    teleport
    :z-index="9999"
    backdrop-trigger="mousedown"
    panel-class="max-w-md flex flex-col p-5"
    role="dialog"
    :aria-modal="true"
    :aria-labelledby="titleId"
    @close="closeFromBackdrop"
  >
    <h3 :id="titleId" class="mb-4 shrink-0 text-center text-xl font-semibold">
      {{ title }}
    </h3>
    <div class="mb-6 flex-grow text-sm">
      <p class="whitespace-pre-wrap text-center text-text-secondary">{{ store.state.message }}</p>
    </div>
    <div class="flex shrink-0 justify-end gap-3">
      <button
        v-if="store.state.kind === 'confirm'"
        type="button"
        :disabled="store.state.loading"
        class="rounded-md border border-border/50 bg-background px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        @click="store.cancel"
      >
        {{ cancelText }}
      </button>
      <button
        type="button"
        :disabled="store.state.loading"
        class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        :class="store.state.destructive ? 'bg-error hover:opacity-90' : 'bg-primary hover:bg-button-hover'"
        @click="store.accept"
      >
        <i v-if="store.state.loading" class="fas fa-spinner fa-spin mr-3 !text-white" aria-hidden="true"></i>
        {{ primaryText }}
      </button>
    </div>
  </OverlayPanel>
</template>
