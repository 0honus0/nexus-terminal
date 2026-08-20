<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';

const StatusMonitor = defineAsyncComponent(() => import('./StatusMonitor.vue'));

const props = defineProps<{
  isVisible: boolean;
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const closeModal = () => emit('close');
</script>

<template>
  <OverlayPanel
    :visible="props.isVisible"
    teleport
    :z-index="1000"
    overlay-class="p-3"
    panel-class="max-w-2xl h-[min(78dvh,720px)] min-h-[360px] overflow-hidden rounded-xl shadow-2xl"
    data-testid="status-monitor-modal"
    @close="closeModal"
  >
    <button
      type="button"
      class="absolute top-2 right-2 z-20 w-8 h-8 rounded-lg bg-background/80 border border-border/60 text-text-secondary flex items-center justify-center active:scale-95"
      :title="'关闭'"
      @click="closeModal"
    >
      <i class="fas fa-times"></i>
    </button>
    <StatusMonitor :active-session-id="props.activeSessionId" />
  </OverlayPanel>
</template>
