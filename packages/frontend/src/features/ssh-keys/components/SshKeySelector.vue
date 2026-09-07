<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseSelect } from '@/foundation/ui';
  import { useSshKeys } from '../composables/useSshKeys';
  import SshKeyManagementModal from './SshKeyManagementModal.vue';
  const { t } = useI18n();
  const model = defineModel<number | null>({ default: null });
  const keys = useSshKeys();
  const manage = ref(false);
  const loading = ref(false);
  const loadError = ref('');
  onMounted(async () => {
    loading.value = true;
    loadError.value = '';
    try {
      await keys.load();
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  });
  watch(keys.keys, (available) => {
    if (model.value !== null && !available.some((key) => key.id === model.value)) model.value = null;
  });
</script>
<template>
  <div class="space-y-2">
    <div class="flex items-center space-x-3">
      <BaseSelect id="ssh-key-select" v-model="model" class="min-w-0 flex-1" :disabled="loading">
        <option :value="null">{{ t('sshKeys.selector.selectPlaceholder') }}</option>
        <option v-for="key in keys.keys.value" :key="key.id" :value="key.id">{{ key.name }}</option>
      </BaseSelect>
      <button
        data-testid="ssh-key-manage-button"
        type="button"
        class="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-text-secondary hover:bg-border disabled:opacity-50"
        :disabled="loading"
        :title="t('sshKeys.selector.manageKeysTitle')"
        @click="manage = true"
      >
        <i class="fas fa-cog" aria-hidden="true" />
      </button>
    </div>
    <div v-if="loading" class="text-xs text-text-secondary">{{ t('sshKeys.selector.loadingKeys') }}</div>
    <div v-else-if="loadError" data-testid="ssh-key-selector-error" class="break-words text-xs text-error">
      {{ loadError }}
    </div>
    <SshKeyManagementModal v-model="manage" />
  </div>
</template>
