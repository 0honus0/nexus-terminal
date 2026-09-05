<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import SuspendedSessionsPanel from './SuspendedSessionsPanel.vue';
  import type { MarkedSuspendedSession, SuspendedSession } from '../model/sshSuspend';

  withDefaults(defineProps<{ visible: boolean; canResume?: boolean; markedSessions?: MarkedSuspendedSession[] }>(), {
    canResume: false,
    markedSessions: () => [],
  });
  const emit = defineEmits<{
    close: [];
    resume: [session: SuspendedSession];
    resumeMarked: [workspaceId: string];
    unmark: [workspaceId: string];
  }>();
  const { t } = useI18n();
</script>

<template>
  <OverlayPanel
    data-testid="suspended-sessions-modal"
    :visible="visible"
    teleport
    :close-on-escape="true"
    panel-class="max-w-2xl max-h-[85vh] flex flex-col p-4"
    role="dialog"
    :aria-modal="true"
    :aria-label="t('suspendedSshSessions.modalTitle')"
    @close="emit('close')"
  >
    <button
      type="button"
      class="absolute right-2 top-2 z-10 p-1 text-text-secondary transition-colors hover:text-foreground"
      :title="t('common.close')"
      :aria-label="t('common.close')"
      @click="emit('close')"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
    <h3 class="mb-3 shrink-0 text-center text-lg font-semibold">{{ t('suspendedSshSessions.modalTitle') }}</h3>
    <div class="min-h-0 flex-grow overflow-y-auto rounded border border-border">
      <SuspendedSessionsPanel
        v-if="visible"
        :can-resume="canResume"
        :marked-sessions="markedSessions"
        @resume="emit('resume', $event)"
        @resume-marked="emit('resumeMarked', $event)"
        @unmark="emit('unmark', $event)"
        @removed="emit('close')"
      />
    </div>
  </OverlayPanel>
</template>
