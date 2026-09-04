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
  onMounted(() => keys.load());
  watch(keys.keys, (available) => {
    if (model.value !== null && !available.some((key) => key.id === model.value)) model.value = null;
  });
</script>
<template>
  <div class="flex gap-2">
    <BaseSelect v-model="model"
      ><option :value="null">{{ t('sshKeys.selector.noKey') }}</option>
      <option v-for="key in keys.keys.value" :key="key.id" :value="key.id">{{ key.name }}</option></BaseSelect
    ><BaseButton data-testid="ssh-key-manage-button" @click="manage = true">{{
      t('sshKeys.selector.manage')
    }}</BaseButton
    ><SshKeyManagementModal v-model="manage" />
  </div>
</template>
