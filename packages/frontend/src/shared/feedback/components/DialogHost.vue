<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiOverlayPanel } from '@/foundation/ui';
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
  <UiOverlayPanel
    :visible="store.state.visible"
    teleport
    :z-index="9999"
    :close-on-escape="true"
    :focus-on-open="true"
    :restore-focus="true"
    backdrop-trigger="mousedown"
    panel-class="ui-form-surface ui-confirmation-panel"
    role="dialog"
    :aria-modal="true"
    :aria-labelledby="titleId"
    @close="closeFromBackdrop"
  >
    <div class="ui-confirmation-panel__body">
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        :class="store.state.destructive ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'"
      >
        <i
          :class="store.state.destructive ? 'fas fa-exclamation-triangle' : 'fas fa-question-circle'"
          aria-hidden="true"
        ></i>
      </div>
      <div class="min-w-0 flex-1">
        <h3 :id="titleId" class="text-base font-semibold text-foreground leading-snug">
          {{ title }}
        </h3>
        <p class="mt-2 text-sm text-text-secondary leading-relaxed break-words whitespace-pre-wrap">
          {{ store.state.message }}
        </p>
      </div>
    </div>

    <div class="ui-confirmation-panel__actions">
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
    </div>
  </UiOverlayPanel>
</template>
