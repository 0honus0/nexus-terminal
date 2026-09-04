<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';

  defineProps<{ visible: boolean }>();
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
</script>

<template>
  <BaseModal
    :visible="visible"
    :title="t('styleCustomizer.title')"
    panel-class="w-[min(1180px,96vw)] h-[min(900px,94vh)]"
    @close="emit('close')"
  >
    <AppearanceSettingsPanel />
  </BaseModal>
</template>
