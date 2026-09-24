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
    :close-on-escape="true"
    :focus-on-open="true"
    :restore-focus="true"
    backdrop-trigger="mousedown"
    panel-class="max-w-[340px] w-full flex flex-col p-4 rounded-xl border border-border bg-background shadow-xl"
    role="dialog"
    :aria-modal="true"
    :aria-labelledby="titleId"
    @close="closeFromBackdrop"
  >
    <div class="flex items-start gap-3">
      <!-- 紧凑状态图标 -->
      <div
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        :class="store.state.destructive ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'"
      >
        <i
          :class="store.state.destructive ? 'fas fa-exclamation-triangle text-xs' : 'fas fa-question-circle text-xs'"
          aria-hidden="true"
        ></i>
      </div>
      <div class="min-w-0 flex-1">
        <h3 :id="titleId" class="text-sm font-semibold text-foreground leading-snug">
          {{ title }}
        </h3>
        <p class="mt-1 text-xs text-text-secondary leading-relaxed break-words whitespace-pre-wrap">
          {{ store.state.message }}
        </p>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        v-if="store.state.kind === 'confirm'"
        type="button"
        :disabled="store.state.loading"
        class="h-7 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-header hover:border-border/80 disabled:opacity-50 cursor-pointer"
        @click="store.cancel"
      >
        {{ cancelText }}
      </button>
      <button
        type="button"
        :disabled="store.state.loading"
        class="h-7 inline-flex items-center justify-center rounded-lg px-3 text-xs font-medium text-white transition-opacity disabled:opacity-50 cursor-pointer"
        :class="store.state.destructive ? 'bg-error hover:opacity-90' : 'bg-primary hover:opacity-90'"
        @click="store.accept"
      >
        <i
          v-if="store.state.loading"
          class="fas fa-spinner fa-spin mr-1.5 !text-white text-[10px]"
          aria-hidden="true"
        ></i>
        {{ primaryText }}
      </button>
    </div>
  </OverlayPanel>
</template>
