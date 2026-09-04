<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
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
  <BaseModal
    :visible="visible"
    :title="t('suspendedSshSessions.modalTitle')"
    panel-class="h-[min(760px,90vh)] w-[min(900px,94vw)]"
    @close="emit('close')"
  >
    <SuspendedSessionsPanel
      v-if="visible"
      :can-resume="canResume"
      :marked-sessions="markedSessions"
      @resume="emit('resume', $event)"
      @resume-marked="emit('resumeMarked', $event)"
      @unmark="emit('unmark', $event)"
      @removed="emit('close')"
    />
  </BaseModal>
</template>
