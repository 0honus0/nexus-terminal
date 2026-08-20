<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';
import FileManager from './FileManager.vue';
import { useSessionStore } from '../stores/session.store';
import type { WebSocketDependencies } from '../composables/useSftpActions';

export interface FileManagerModalEntry {
  sessionId: string;
  instanceId: string;
  dbConnectionId: string;
  wsDeps: WebSocketDependencies;
}

const props = defineProps<{
  visible: boolean;
  currentSessionId: string | null;
  entries: Map<string, FileManagerModalEntry>;
  isMobile: boolean;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const sessionStore = useSessionStore();
const { t } = useI18n();
const effectiveVisible = computed(() => Boolean(
  props.visible
  && props.currentSessionId
  && props.entries.has(props.currentSessionId),
));
const currentSessionLabel = computed(() => {
  if (!props.currentSessionId) return '';
  return sessionStore.sessions.get(props.currentSessionId)?.connectionName || props.currentSessionId;
});
</script>

<template>
  <OverlayPanel
    :visible="effectiveVisible"
    keep-mounted
    panel-class="max-w-4xl h-[85vh] flex flex-col overflow-hidden"
    data-testid="file-manager-modal"
    @close="emit('close')"
  >
    <div class="flex justify-between items-center p-3 border-b border-border flex-shrink-0 bg-header">
      <h2 class="text-lg font-semibold text-foreground">
        {{ t('fileManager.modalTitle', '文件管理器') }} ({{ currentSessionLabel }})
      </h2>
      <button
        data-testid="file-manager-modal-close"
        class="text-text-secondary hover:text-foreground transition-colors"
        @click="emit('close')"
      >
        <i class="fas fa-times text-xl"></i>
      </button>
    </div>
    <div class="flex-grow overflow-hidden">
      <template v-for="entry in props.entries.values()" :key="`${entry.sessionId}-${props.isMobile}`">
        <div v-show="entry.sessionId === props.currentSessionId" class="h-full">
          <FileManager
            :session-id="entry.sessionId"
            :instance-id="entry.instanceId"
            :db-connection-id="entry.dbConnectionId"
            :ws-deps="entry.wsDeps"
            :is-mobile="props.isMobile"
            class="h-full"
          />
        </div>
      </template>
    </div>
  </OverlayPanel>
</template>
