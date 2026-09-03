<script setup lang="ts">
  import { ref, watch, onBeforeUnmount } from 'vue';
  import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';

  interface Props {
    visible: boolean;
    title: string;
    message: string;
    okText?: string;
  }

  const props = defineProps<Props>();
  const emit = defineEmits(['ok', 'update:visible']);

  const dialogVisible = ref(props.visible);

  watch(
    () => props.visible,
    (newValue) => {
      dialogVisible.value = newValue;
    },
  );

  watch(dialogVisible, (newValue) => {
    if (newValue !== props.visible) {
      emit('update:visible', newValue);
    }
  });

  const handleOk = () => {
    emit('ok');
    // 通常点击"确定"后对话框会关闭，如果store管理visible，则由store处理
    // emit('update:visible', false);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dialogVisible.value) {
      handleOk();
    }
  };

  watch(dialogVisible, (isVisible) => {
    if (isVisible) {
      document.addEventListener('keydown', handleKeydown);
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  });

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown);
  });
</script>

<template>
  <OverlayPanel
    :visible="dialogVisible"
    teleport
    :z-index="9999"
    backdrop-trigger="mousedown"
    panel-class="max-w-md flex flex-col p-5"
    role="dialog"
    :aria-modal="true"
    :aria-labelledby="props.title"
    @close="handleOk"
  >
    <h3 class="text-xl font-semibold mb-4 text-center flex-shrink-0" :id="props.title">
      {{ props.title }}
    </h3>
    <div class="flex-grow mb-6 text-sm">
      <p class="text-text-secondary text-center whitespace-pre-wrap">
        {{ props.message }}
      </p>
    </div>
    <div class="flex justify-end gap-3 flex-shrink-0">
      <button
        @click="handleOk"
        type="button"
        class="px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-background-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center bg-primary hover:bg-primary-hover focus:ring-primary"
      >
        {{ props.okText || 'OK' }}
      </button>
    </div>
  </OverlayPanel>
</template>
