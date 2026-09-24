<script setup lang="ts">
  import { defineAsyncComponent } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  const SuspendedSessionsPanel = defineAsyncComponent(() => import('./SuspendedSessionsPanel.vue'));
  import type { MarkedSuspendedSessionState, SuspendedSessionDto } from '../model/sshSuspend';

  withDefaults(
    defineProps<{ visible: boolean; canResume?: boolean; markedSessions?: MarkedSuspendedSessionState[] }>(),
    {
      canResume: false,
      markedSessions: () => [],
    },
  );
  const emit = defineEmits<{
    close: [];
    resume: [session: SuspendedSessionDto];
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
    panel-class="max-w-[480px] w-full max-h-[82vh] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl p-0"
    role="dialog"
    :aria-modal="true"
    :aria-label="t('suspendedSshSessions.modalTitle')"
    @close="emit('close')"
  >
    <!-- 弹窗顶栏 -->
    <div
      class="flex items-center justify-between border-b border-border/70 px-3.5 py-2.5 shrink-0 bg-header/30 select-none"
    >
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <i class="fas fa-pause text-[9px]" aria-hidden="true"></i>
        </div>
        <h3 class="text-xs font-semibold text-foreground truncate">
          {{ t('suspendedSshSessions.modalTitle') }}
        </h3>
      </div>
      <button
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-header hover:text-foreground cursor-pointer"
        :title="t('common.close')"
        :aria-label="t('common.close')"
        @click="emit('close')"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- 主面板内容区 -->
    <div data-testid="suspended-sessions-modal-body" class="min-h-0 flex-1 overflow-y-auto p-3">
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
