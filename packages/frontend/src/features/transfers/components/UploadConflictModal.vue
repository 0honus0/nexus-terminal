<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseModal } from '@/foundation/ui';
  const props = defineProps<{ visible: boolean; path?: string }>();
  const emit = defineEmits<{ resolve: [strategy: 'overwrite' | 'skip', applyToAll: boolean] }>();
  const { t } = useI18n();
  const all = ref(false);
  watch(
    () => [props.visible, props.path] as const,
    ([visible], previous) => {
      if (visible && (!previous || !previous[0] || previous[1] !== props.path)) all.value = false;
    },
  );
</script>
<template>
  <BaseModal
    :visible="visible"
    :z-index="70"
    :title="t('fileManager.uploadConflict.title')"
    @close="emit('resolve', 'skip', false)"
    ><div class="space-y-4">
      <p>{{ t('fileManager.uploadConflict.description') }}</p>
      <code class="block break-all rounded bg-header p-2 text-sm">{{ path }}</code
      ><label class="flex items-center gap-2"
        ><BaseCheckbox v-model="all" />{{ t('fileManager.uploadConflict.applyToAll') }}</label
      >
      <div class="flex justify-end gap-2">
        <BaseButton @click="emit('resolve', 'skip', all)">{{ t('fileManager.uploadConflict.skip') }}</BaseButton
        ><BaseButton variant="primary" @click="emit('resolve', 'overwrite', all)">{{
          t('fileManager.uploadConflict.overwrite')
        }}</BaseButton>
      </div>
    </div></BaseModal
  >
</template>
