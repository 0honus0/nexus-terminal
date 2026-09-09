<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
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
  let panelMounted = false;
  let pollingStarted = false;

  onMounted(async () => {
    panelMounted = true;
    await data.load({ force: true });
    if (!panelMounted) return;
    data.startPolling();
    pollingStarted = true;
  });
  onBeforeUnmount(() => {
    panelMounted = false;
    if (!pollingStarted) return;
    data.stopPolling();
    pollingStarted = false;
  });

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
  <section
    data-testid="suspended-sessions-view"
    class="suspended-sessions-panel flex h-full min-h-0 flex-col p-2"
    role="region"
    :aria-label="t('suspendedSshSessions.modalTitle')"
  >
    <div class="view-header mb-2">
      <div class="relative w-full">
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <i class="fas fa-search text-text-secondary" aria-hidden="true"></i>
        </span>
        <input
          v-model="data.search.value"
          type="text"
          :placeholder="t('suspendedSshSessions.searchPlaceholder')"
          class="suspended-session-search w-full rounded-lg border border-border/50 bg-input px-10 py-1.5 text-center text-sm text-foreground shadow-sm transition duration-150 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>

    <div class="session-list-container min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="data.loading.value && !filteredMarked.length"
        class="suspended-session-loading p-4 text-center text-text-secondary"
      >
        <i class="fas fa-spinner fa-spin text-2xl" aria-hidden="true"></i>
        <p class="mt-2">{{ t('suspendedSshSessions.loading') }}</p>
      </div>
      <p v-else-if="data.error.value" class="px-3 py-2 text-sm text-error">{{ data.error.value }}</p>
      <p v-else-if="!hasResults" class="suspended-session-empty p-4 text-center text-text-secondary">
        {{ t('suspendedSshSessions.noResults') }}
      </p>

      <ul v-else class="m-0 list-none p-0">
        <li
          v-for="session in filteredMarked"
          :key="`marked-${session.workspaceId}`"
          :data-testid="`marked-suspended-session-${session.workspaceId}`"
          class="session-item mb-2 rounded-md border border-border/70 bg-background p-3"
        >
          <div class="session-row flex items-center justify-between">
            <div class="session-info mr-2 min-w-0 flex-1">
              <div class="session-title flex items-center text-lg font-bold">
                <span class="session-name">{{ session.connectionName }}</span>
                <span class="status-badge status-marked">{{ t('suspendedSshSessions.status.marked') }}</span>
              </div>
              <div class="session-meta mt-1 text-xs text-text-secondary">
                {{ t('suspendedSshSessions.label.markedAt') }}: {{ new Date(session.markedAt).toLocaleString() }}
              </div>
            </div>
            <div class="session-status-actions flex flex-col items-end">
              <div class="actions mt-1 flex flex-col gap-2">
                <button
                  v-if="props.canResume"
                  type="button"
                  class="session-action action-resume"
                  :title="t('suspendedSshSessions.action.resume')"
                  :aria-label="t('suspendedSshSessions.action.resume')"
                  @click="emit('resumeMarked', session.workspaceId)"
                >
                  <i class="fas fa-play action-icon" aria-hidden="true"></i>
                  <span class="button-session-text">{{ t('suspendedSshSessions.action.resume') }}</span>
                </button>
                <button
                  type="button"
                  class="session-action action-remove"
                  :title="t('tabs.contextMenu.unmarkForSuspend')"
                  :aria-label="t('tabs.contextMenu.unmarkForSuspend')"
                  @click="emit('unmark', session.workspaceId)"
                >
                  <i class="fas fa-undo action-icon" aria-hidden="true"></i>
                  <span class="button-session-text">{{ t('tabs.contextMenu.unmarkForSuspend') }}</span>
                </button>
              </div>
            </div>
          </div>
        </li>

        <li
          v-for="session in data.filtered.value"
          :key="session.id"
          :data-testid="`suspended-session-${session.id}`"
          :data-suspend-id="session.id"
          class="session-item mb-2 rounded-md border border-border/70 bg-background p-3"
          :class="{ 'opacity-60': session.status !== 'active' }"
        >
          <div class="session-row flex items-center justify-between">
            <div class="session-info mr-2 min-w-0 flex-1">
              <div class="session-title flex items-center text-lg font-bold">
                <input
                  v-if="editingId === session.id"
                  v-model="editingName"
                  type="text"
                  autofocus
                  class="min-w-0 flex-1 rounded-md border border-primary bg-background px-1 py-0.5 text-lg font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  @blur="finishRename(session)"
                  @keyup.enter.prevent="finishRename(session)"
                  @keyup.esc.prevent="cancelRename"
                />
                <button
                  v-else
                  type="button"
                  class="session-name min-w-0 text-left font-bold hover:text-primary disabled:cursor-default disabled:hover:text-inherit"
                  :disabled="Boolean(renamingId)"
                  :title="t('suspendedSshSessions.tooltip.editName')"
                  @click="startRename(session)"
                >
                  {{ session.customName || session.connectionName }}
                </button>
                <span
                  class="status-badge"
                  :class="session.status === 'active' ? 'status-active' : 'status-disconnected'"
                >
                  {{
                    t(
                      session.status === 'active'
                        ? 'suspendedSshSessions.status.hanging'
                        : 'suspendedSshSessions.status.disconnected',
                    )
                  }}
                </span>
              </div>
              <div class="session-meta text-sm text-text-secondary">
                {{ t('suspendedSshSessions.label.originalConnection') }}: {{ session.connectionName }}
              </div>
              <div class="session-meta mt-1 text-xs text-text-secondary">
                {{ t('suspendedSshSessions.label.suspendedAt') }}: {{ new Date(session.suspendedAt).toLocaleString() }}
              </div>
              <div v-if="session.disconnectedAt" class="session-meta mt-1 text-xs text-orange-500">
                {{
                  t('suspendedSshSessions.disconnectedAt', { time: new Date(session.disconnectedAt).toLocaleString() })
                }}
              </div>
            </div>

            <div class="session-status-actions flex flex-col items-end">
              <div class="actions mt-1 flex flex-col gap-2">
                <button
                  v-if="session.status === 'active' && props.canResume"
                  type="button"
                  class="session-action action-resume"
                  :title="t('suspendedSshSessions.action.resume')"
                  :aria-label="t('suspendedSshSessions.action.resume')"
                  @click="emit('resume', session)"
                >
                  <i class="fas fa-play action-icon" aria-hidden="true"></i>
                  <span class="button-session-text">{{ t('suspendedSshSessions.action.resume') }}</span>
                </button>
                <button
                  type="button"
                  class="session-action action-remove"
                  :disabled="removingId === session.id"
                  :title="t('suspendedSshSessions.action.remove')"
                  :aria-label="t('suspendedSshSessions.action.remove')"
                  @click="remove(session)"
                >
                  <i class="fas fa-trash-alt action-icon" aria-hidden="true"></i>
                  <span class="button-session-text">{{ t('suspendedSshSessions.action.remove') }}</span>
                </button>
                <button
                  type="button"
                  class="session-action action-export"
                  :disabled="exportingId === session.id"
                  :title="t('suspendedSshSessions.action.exportLog')"
                  :aria-label="t('suspendedSshSessions.action.exportLog')"
                  @click="exportLog(session)"
                >
                  <i class="fas fa-download action-icon" aria-hidden="true"></i>
                  <span class="button-session-text">{{ t('suspendedSshSessions.action.exportLog') }}</span>
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
  .suspended-sessions-panel {
    container-type: size;
    container-name: suspended-sessions-view-pane;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji',
      'Segoe UI Emoji', 'Segoe UI Symbol';
  }

  .session-item {
    transition: background-color 0.2s ease-in-out;
  }
  .session-item:hover {
    background: color-mix(in srgb, var(--header-bg-color) 45%, var(--app-bg-color));
  }

  .session-title {
    min-width: 0;
  }
  .session-name {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .session-meta {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status-badge {
    flex: none;
    margin-left: 0.5rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .status-active {
    color: #166534;
    background: #dcfce7;
  }
  .status-marked {
    color: #1d4ed8;
    background: #dbeafe;
  }
  .status-disconnected {
    color: #a16207;
    background: #fef3c7;
  }

  .session-action {
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem 0.75rem;
    border: 0;
    border-radius: 0.375rem;
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    transition:
      background 0.15s ease,
      opacity 0.15s ease;
  }
  .session-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .action-resume {
    color: var(--button-text-color, white);
    background: var(--button-bg-color, var(--link-active-color));
  }
  .action-resume:hover:not(:disabled) {
    background: var(--button-hover-bg-color, color-mix(in srgb, var(--link-active-color) 82%, black));
  }
  .action-remove {
    background: #dc2626;
  }
  .action-remove:hover:not(:disabled) {
    background: #b91c1c;
  }
  .action-export {
    color: var(--button-text-color, white);
    background: #2563eb;
  }
  .action-export:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .action-icon {
    margin-right: 0.375rem;
    color: currentColor;
  }

  @container suspended-sessions-view-pane (max-width: 420px) {
    .session-row {
      display: flex;
      flex-flow: row wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .session-info {
      min-width: 8.5rem;
      flex: 1 1 8.5rem;
      margin-right: 0;
      text-align: left;
    }
    .session-title {
      flex-flow: row wrap;
      align-items: center;
      justify-content: flex-start;
      gap: 0.25rem 0.375rem;
      text-align: left;
    }
    .session-name {
      width: auto;
      max-width: 100%;
      flex: 0 1 auto;
      text-align: left;
      overflow-wrap: break-word;
      word-break: normal;
    }
    .session-title > input {
      width: 100%;
      flex: 1 1 100%;
      text-align: left;
    }
    .status-badge {
      margin-top: 0;
      margin-left: 0;
    }
    .button-session-text {
      display: none;
    }
    .session-status-actions {
      flex: 0 0 auto;
      align-items: flex-end;
    }
    .session-status-actions .actions {
      width: auto;
      margin-top: 0;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: flex-end;
      gap: 0.375rem;
    }
    .action-icon {
      display: flex;
      width: 1em;
      height: 1em;
      align-items: center;
      justify-content: center;
      margin-right: 0;
      line-height: 1;
    }
    .session-action {
      width: 1.75rem;
      height: 1.75rem;
      min-width: 1.75rem;
      min-height: 1.75rem;
      flex: 0 0 1.75rem;
      padding: 0;
      font-size: 0.75rem;
      line-height: 1;
    }
  }

  @container suspended-sessions-view-pane (max-width: 260px) {
    .session-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.375rem;
    }
    .session-info {
      width: 100%;
      min-width: 0;
      text-align: center;
    }
    .session-title {
      justify-content: center;
      text-align: center;
    }
    .session-name,
    .session-title > input {
      text-align: center;
    }
    .session-status-actions {
      justify-self: center;
      align-items: center;
    }
    .session-status-actions .actions {
      justify-content: center;
      gap: 0.5rem;
    }
  }

  @container suspended-sessions-view-pane (max-height: 280px) {
    .view-header {
      margin-bottom: 0.35rem;
    }
    .suspended-session-search {
      padding-top: 0.25rem;
      padding-bottom: 0.25rem;
      padding-right: 2rem;
      padding-left: 2rem;
      font-size: 0.75rem;
      line-height: 1rem;
    }
    .view-header span {
      padding-left: 0.65rem;
    }
    .suspended-session-loading,
    .suspended-session-empty {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      line-height: 1.25rem;
    }
    .suspended-session-loading i {
      font-size: 1rem;
    }
    .suspended-session-loading p {
      margin-top: 0.25rem;
    }
    .session-item {
      margin-bottom: 0.35rem;
      padding: 0.5rem;
    }
    .session-title {
      font-size: 0.875rem;
      line-height: 1.2;
    }
    .status-badge {
      margin-left: 0.35rem;
      padding: 0.0625rem 0.35rem;
      font-size: 0.65rem;
    }
    .session-action {
      min-height: 1.75rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      line-height: 1rem;
    }
  }

  @container suspended-sessions-view-pane (max-width: 420px) and (max-height: 280px) {
    .status-badge {
      margin-left: 0;
    }
    .session-action {
      padding: 0;
    }
  }
</style>
