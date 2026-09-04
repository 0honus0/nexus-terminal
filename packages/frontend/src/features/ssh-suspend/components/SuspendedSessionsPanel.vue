<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseBadge, BaseButton, BaseInput, BaseSpinner } from '@/foundation/ui';
  import { apiErrorMessage } from '@/client/http';
  import { useFeedback } from '@/shared/feedback/public';
  import { useSuspendedSessions } from '../composables/useSuspendedSessions';
  import type { MarkedSuspendedSession, SuspendedSession } from '../model/sshSuspend';

  const props = withDefaults(defineProps<{ canResume?: boolean; markedSessions?: MarkedSuspendedSession[] }>(), {
    canResume: false,
    markedSessions: () => [],
  });
  const emit = defineEmits<{
    resume: [session: SuspendedSession];
    resumeMarked: [workspaceId: string];
    unmark: [workspaceId: string];
    removed: [session: SuspendedSession];
  }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const data = useSuspendedSessions();
  const editingId = ref<string | null>(null);
  const editingName = ref('');
  const renamingId = ref<string | null>(null);
  const exportingId = ref<string | null>(null);
  const removingId = ref<string | null>(null);

  const filteredMarked = computed(() => {
    const term = data.search.value.trim().toLowerCase();
    if (!term) return props.markedSessions;
    return props.markedSessions.filter((session) =>
      `${session.connectionName} ${session.workspaceId}`.toLowerCase().includes(term),
    );
  });
  const hasResults = computed(() => filteredMarked.value.length > 0 || data.filtered.value.length > 0);

  onMounted(async () => {
    await data.load();
    data.startPolling();
  });
  onBeforeUnmount(() => data.stopPolling());

  const startRename = (session: SuspendedSession) => {
    if (renamingId.value) return;
    editingId.value = session.id;
    editingName.value = session.customName ?? session.connectionName;
  };
  const cancelRename = () => {
    editingId.value = null;
    editingName.value = '';
  };
  const finishRename = async (session: SuspendedSession) => {
    if (editingId.value !== session.id || renamingId.value === session.id) return;
    const name = editingName.value.trim();
    const currentName = session.customName ?? session.connectionName;
    if (!name || name === currentName) {
      cancelRename();
      return;
    }
    renamingId.value = session.id;
    editingId.value = null;
    try {
      const authoritativeName = await data.rename(session, name);
      feedback.notifySuccess(
        t('sshSuspend.notifications.nameEditedSuccess', {
          name: authoritativeName.trim() || session.connectionName,
        }),
      );
    } catch (cause) {
      feedback.notifyError(apiErrorMessage(cause, t('sshSuspend.notifications.nameEditedError', { error: '' })));
    } finally {
      renamingId.value = null;
      editingName.value = '';
    }
  };

  const remove = async (session: SuspendedSession) => {
    if (removingId.value) return;
    const name = session.customName ?? session.connectionName;
    if (
      !(await feedback.confirm({ message: `${t('suspendedSshSessions.action.remove')} ${name}?`, destructive: true }))
    )
      return;
    removingId.value = session.id;
    try {
      const wasActive = session.status === 'active';
      await data.remove(session);
      feedback.notifySuccess(
        t(wasActive ? 'sshSuspend.notifications.terminatedSuccess' : 'sshSuspend.notifications.entryRemovedSuccess', {
          name,
        }),
      );
      emit('removed', session);
    } catch (cause) {
      feedback.notifyError(
        apiErrorMessage(
          cause,
          t(
            session.status === 'active'
              ? 'sshSuspend.notifications.terminateError'
              : 'sshSuspend.notifications.entryRemovedError',
            { error: '' },
          ),
        ),
      );
    } finally {
      removingId.value = null;
    }
  };

  const exportLog = async (session: SuspendedSession) => {
    if (exportingId.value) return;
    exportingId.value = session.id;
    try {
      const filename = await data.exportLog(session.id);
      feedback.notifySuccess(t('sshSuspend.notifications.logExportSuccess', { name: filename }));
    } catch (cause) {
      feedback.notifyError(apiErrorMessage(cause, t('sshSuspend.notifications.logExportError', { error: '' })));
    } finally {
      exportingId.value = null;
    }
  };
</script>

<template>
  <section class="suspended-sessions-panel flex h-full min-h-0 flex-col">
    <div class="border-b border-border p-3">
      <BaseInput v-model="data.search.value" :placeholder="t('suspendedSshSessions.searchPlaceholder')" />
    </div>
    <BaseSpinner v-if="data.loading.value && !filteredMarked.length" class="m-6" />
    <div v-else class="min-h-0 flex-1 overflow-auto">
      <p v-if="data.error.value" class="px-4 pt-3 text-sm text-error">{{ data.error.value }}</p>
      <ul class="space-y-2 p-3 suspended-session-list">
        <li
          v-for="session in filteredMarked"
          :key="`marked-${session.workspaceId}`"
          class="rounded-lg border border-border p-3 suspended-session-row"
        >
          <div class="flex items-start justify-between gap-4 suspended-session-row-main">
            <div class="min-w-0 flex-1 suspended-session-identity">
              <div class="flex items-center gap-2 suspended-session-title">
                <strong class="truncate">{{ session.connectionName }}</strong>
                <BaseBadge tone="warning">{{ t('suspendedSshSessions.status.marked') }}</BaseBadge>
              </div>
              <p class="mt-1 text-xs text-text-secondary">
                {{ t('suspendedSshSessions.label.markedAt') }}: {{ new Date(session.markedAt).toLocaleString() }}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-2 suspended-session-actions">
              <BaseButton
                v-if="props.canResume"
                size="sm"
                variant="primary"
                :title="t('suspendedSshSessions.action.resume')"
                @click="emit('resumeMarked', session.workspaceId)"
              >
                <i class="fas fa-play" aria-hidden="true"></i>
                <span class="action-label">{{ t('suspendedSshSessions.action.resume') }}</span>
              </BaseButton>
              <BaseButton
                size="sm"
                :title="t('tabs.contextMenu.unmarkForSuspend')"
                @click="emit('unmark', session.workspaceId)"
              >
                <i class="fas fa-undo" aria-hidden="true"></i>
                <span class="action-label">{{ t('tabs.contextMenu.unmarkForSuspend') }}</span>
              </BaseButton>
            </div>
          </div>
        </li>
        <li
          v-for="session in data.filtered.value"
          :key="session.id"
          class="rounded-lg border border-border p-3 suspended-session-row"
        >
          <div class="flex items-start justify-between gap-4 suspended-session-row-main">
            <div class="min-w-0 flex-1 suspended-session-identity">
              <div class="flex items-center gap-2 suspended-session-title">
                <BaseInput
                  v-if="editingId === session.id"
                  v-model="editingName"
                  class="max-w-sm"
                  autofocus
                  @blur="finishRename(session)"
                  @keyup.enter.prevent="finishRename(session)"
                  @keyup.esc.prevent="cancelRename"
                />
                <button
                  v-else
                  type="button"
                  class="truncate text-left font-semibold"
                  :disabled="Boolean(renamingId)"
                  :title="t('suspendedSshSessions.tooltip.editName')"
                  @click="startRename(session)"
                >
                  {{ session.customName || session.connectionName }}
                </button>
                <BaseBadge :tone="session.status === 'active' ? 'success' : 'warning'">
                  {{
                    t(
                      session.status === 'active'
                        ? 'suspendedSshSessions.status.hanging'
                        : 'suspendedSshSessions.status.disconnected',
                    )
                  }}
                </BaseBadge>
              </div>
              <p class="mt-1 text-sm text-text-secondary">
                {{ t('suspendedSshSessions.label.originalConnection') }}: {{ session.connectionName }}
              </p>
              <p class="mt-1 text-xs text-text-secondary">
                {{ t('suspendedSshSessions.label.suspendedAt') }}: {{ new Date(session.suspendedAt).toLocaleString() }}
              </p>
              <p v-if="session.disconnectedAt" class="mt-1 text-xs text-warning">
                {{
                  t('suspendedSshSessions.disconnectedAt', { time: new Date(session.disconnectedAt).toLocaleString() })
                }}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-2 suspended-session-actions">
              <BaseButton
                v-if="session.status === 'active' && props.canResume"
                size="sm"
                variant="primary"
                :title="t('suspendedSshSessions.action.resume')"
                @click="emit('resume', session)"
              >
                <i class="fas fa-play" aria-hidden="true"></i>
                <span class="action-label">{{ t('suspendedSshSessions.action.resume') }}</span>
              </BaseButton>
              <BaseButton
                size="sm"
                :disabled="exportingId === session.id"
                :title="t('suspendedSshSessions.action.exportLog')"
                @click="exportLog(session)"
              >
                <i class="fas fa-download" aria-hidden="true"></i>
                <span class="action-label">{{ t('suspendedSshSessions.action.exportLog') }}</span>
              </BaseButton>
              <BaseButton
                size="sm"
                variant="danger"
                :disabled="removingId === session.id"
                :title="t('suspendedSshSessions.action.remove')"
                @click="remove(session)"
              >
                <i class="fas fa-trash-alt" aria-hidden="true"></i>
                <span class="action-label">{{ t('suspendedSshSessions.action.remove') }}</span>
              </BaseButton>
            </div>
          </div>
        </li>
        <li v-if="!hasResults" class="p-6 text-center text-sm text-text-secondary">
          {{ t('suspendedSshSessions.noResults') }}
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
  .suspended-sessions-panel {
    container-type: inline-size;
    container-name: suspended-sessions-view-pane;
  }

  @container suspended-sessions-view-pane (max-width: 320px) {
    .suspended-session-list {
      padding-inline: 0.5rem;
    }

    .suspended-session-row {
      padding-inline: 0.625rem;
    }

    .suspended-session-row-main,
    .suspended-session-title {
      flex-wrap: wrap;
    }

    .suspended-session-actions {
      margin-left: auto;
    }
  }

  @container suspended-sessions-view-pane (max-width: 300px) {
    .action-label {
      display: none;
    }

    .suspended-session-actions :deep(button) {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }
</style>
