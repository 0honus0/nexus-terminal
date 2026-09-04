<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseModal, BaseSpinner } from '@/foundation/ui';
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
</script>

<template>
  <BaseModal :visible="store.state.visible" :title="title" :z-index="9999" @close="store.cancel">
    <p class="whitespace-pre-wrap text-center text-sm text-text-secondary">{{ store.state.message }}</p>

    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton
          v-if="store.state.kind === 'confirm'"
          variant="secondary"
          :disabled="store.state.loading"
          @click="store.cancel"
        >
          {{ cancelText }}
        </BaseButton>
        <BaseButton
          :variant="store.state.destructive ? 'danger' : 'primary'"
          :loading="store.state.loading"
          @click="store.accept"
        >
          <template v-if="store.state.loading" #leading>
            <BaseSpinner size="sm" />
          </template>
          {{ primaryText }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
