<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseModal } from '@/foundation/ui';
  defineProps<{ visible: boolean; path?: string }>();
  const emit = defineEmits<{ resolve: [strategy: 'overwrite' | 'skip', applyToAll: boolean] }>();
  const { t } = useI18n();
  const all = ref(false);
</script>
<template>
  <BaseModal
    data-testid="upload-conflict-modal"
    :visible="visible"
    :z-index="70"
    :title="t('fileManager.uploadConflict.title')"
    @close="emit('resolve', 'skip', false)"
    ><div class="space-y-4">
      <p>{{ t('fileManager.uploadConflict.description') }}</p>
      <code class="block break-all rounded bg-header p-2 text-sm">{{ path }}</code
      ><label class="flex items-center gap-2"
        ><BaseCheckbox v-model="all" data-testid="upload-conflict-apply-all" />{{
          t('fileManager.uploadConflict.applyToAll')
        }}</label
      >
      <div class="flex justify-end gap-2">
        <BaseButton data-testid="upload-conflict-skip" @click="emit('resolve', 'skip', all)">{{
          t('fileManager.uploadConflict.skip')
        }}</BaseButton
        ><BaseButton
          data-testid="upload-conflict-overwrite"
          variant="primary"
          @click="emit('resolve', 'overwrite', all)"
          >{{ t('fileManager.uploadConflict.overwrite') }}</BaseButton
        >
      </div>
    </div></BaseModal
  >
</template>
