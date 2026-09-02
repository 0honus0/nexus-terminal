<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue';
import QuickCommandsView from '../views/QuickCommandsView.vue'; // 导入视图
import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';
import { useWorkspaceEventSubscriber } from '../composables/workspaceEvents'; // 导入事件订阅器

const props = defineProps<{
  isVisible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'execute-command', command: string): void;
}>();

const closeModal = () => {
  emit('close');
};

// 处理从 QuickCommandsView 传来的事件
const handleCommandExecute = (command: string) => {
  emit('execute-command', command);
  closeModal(); // 选择指令后自动关闭
};

// Optional: Add keyboard listener to close on Esc key
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeModal();
  }
};

watch(() => props.isVisible, (newValue) => {
  if (newValue) {
    document.addEventListener('keydown', handleKeydown);
  } else {
    document.removeEventListener('keydown', handleKeydown);
  }
});

const onWorkspaceEvent = useWorkspaceEventSubscriber(); // 获取事件订阅器

// Clean up listener on unmount (though v-if usually handles this)
import { onUnmounted } from 'vue';
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

onMounted(() => {
  // 监听 terminal:sendCommand 事件以关闭模态框
  onWorkspaceEvent('terminal:sendCommand', () => {
    console.log('[QuickCommandsModal] Received terminal:sendCommand event, closing modal.');
    closeModal();
  });
});

</script>

<template>
  <OverlayPanel
    :visible="isVisible"
    preset="standard-modal"
    panel-test-id="quick-commands-dialog"
    @close="closeModal"
  >
    <!-- Close Button -->
    <button class="absolute top-2 right-2 p-1 text-text-secondary hover:text-foreground z-10" @click="closeModal" title="关闭">
       <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
         <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
       </svg>
    </button>
    <!-- Title -->
    <h3 class="text-lg font-semibold text-center mb-3 flex-shrink-0">快捷指令</h3>
    <!-- Quick Commands View Embedded -->
    <div class="flex-grow overflow-y-auto border border-border rounded">
      <QuickCommandsView @execute-command="handleCommandExecute" />
    </div>
  </OverlayPanel>
</template>
