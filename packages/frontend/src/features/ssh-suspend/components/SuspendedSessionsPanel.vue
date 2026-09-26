<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { useFeedback } from '@/shared/feedback/public';
  import { useSuspendedSessions } from '../composables/useSuspendedSessions';
  import type { MarkedSuspendedSessionState, SuspendedSessionDto } from '../model/sshSuspend';

  const props = withDefaults(defineProps<{ canResume?: boolean; markedSessions?: MarkedSuspendedSessionState[] }>(), {
    canResume: false,
    markedSessions: () => [],
  });
  const emit = defineEmits<{
    resume: [session: SuspendedSessionDto];
    resumeMarked: [workspaceId: string];
    unmark: [workspaceId: string];
    removed: [session: SuspendedSessionDto];
  }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const data = useSuspendedSessions();
  const editingId = ref<string | null>(null);
  const editingName = ref('');
  const renamingId = ref<string | null>(null);
  const exportingId = ref<string | null>(null);
  const removingId = ref<string | null>(null);

  const catalogWorkspaceIds = computed(() => {
    const ids = new Set<string>();
    for (const session of data.sessions.value) {
      if (session.originalWorkspaceId) ids.add(session.originalWorkspaceId);
      if (session.attachedWorkspaceId) ids.add(session.attachedWorkspaceId);
    }
    return ids;
  });
  const filteredMarked = computed(() => {
    const term = data.search.value.trim().toLowerCase();
    return props.markedSessions.filter((session) => {
      // A marked runtime is only a provisional/local representation. Once the backend
      // catalog owns the same original or attached Workspace, render that authoritative
      // record instead of showing the same suspended shell twice after resume/reconnect.
      if (catalogWorkspaceIds.value.has(session.workspaceId)) return false;
      return !term || `${session.connectionName} ${session.workspaceId}`.toLowerCase().includes(term);
    });
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

  const startRename = (session: SuspendedSessionDto) => {
    if (renamingId.value) return;
    editingId.value = session.id;
    editingName.value = session.customName ?? session.connectionName;
  };
  const cancelRename = () => {
    editingId.value = null;
    editingName.value = '';
  };
  const finishRename = async (session: SuspendedSessionDto) => {
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

  const remove = async (session: SuspendedSessionDto) => {
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

  const exportLog = async (session: SuspendedSessionDto) => {
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

  const getStatusLabel = (session: SuspendedSessionDto): string => {
    if (session.status !== 'active') return t('suspendedSshSessions.status.disconnected');
    if (session.ownershipState === 'attached') return t('suspendedSshSessions.status.attached');
    if (session.ownershipState === 'resuming') return t('suspendedSshSessions.status.resuming');
    return t('suspendedSshSessions.status.hanging');
  };

  const formatTime = (isoString?: string | number): string => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };
</script>

<template>
  <section
    data-testid="suspended-sessions-view"
    class="suspended-sessions-panel flex h-full min-h-0 flex-col"
    role="region"
    :aria-label="t('suspendedSshSessions.modalTitle')"
  >
    <!-- 紧凑搜索栏 -->
    <div class="view-header mb-2 shrink-0">
      <div class="relative w-full">
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-text-secondary/60">
          <i class="fas fa-search text-[10px]" aria-hidden="true"></i>
        </span>
        <input
          v-model="data.search.value"
          type="text"
          :placeholder="t('suspendedSshSessions.searchPlaceholder')"
          class="suspended-session-search h-7 w-full rounded-lg border border-border/80 bg-input/40 pl-7 pr-7 text-xs text-foreground placeholder:text-text-secondary/50 transition-colors focus:border-primary focus:bg-background focus:outline-none"
        />
        <button
          v-if="data.search.value"
          type="button"
          class="absolute inset-y-0 right-0 flex items-center pr-2 text-text-secondary/60 hover:text-foreground cursor-pointer"
          @click="data.search.value = ''"
        >
          <i class="fas fa-times-circle text-[10px]" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- 列表容器 -->
    <div class="session-list-container min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="data.loading.value && !filteredMarked.length"
        class="suspended-session-loading flex flex-col items-center justify-center py-6 text-center text-text-secondary"
      >
        <i class="fas fa-spinner fa-spin text-base text-primary" aria-hidden="true"></i>
        <p class="mt-1.5 text-xs">{{ t('suspendedSshSessions.loading') }}</p>
      </div>
      <p v-else-if="data.error.value" class="rounded-lg border border-error/20 bg-error/5 p-2 text-xs text-error">
        {{ data.error.value }}
      </p>
      <div
        v-else-if="!hasResults"
        class="suspended-session-empty flex flex-col items-center justify-center py-6 px-3 text-center"
      >
        <i class="fas fa-inbox text-base text-text-secondary/40 mb-1" aria-hidden="true"></i>
        <p class="text-xs font-medium text-foreground">{{ t('suspendedSshSessions.noResults') }}</p>
      </div>

      <!-- 紧凑小卡片列表 -->
      <ul v-else class="m-0 list-none p-0 space-y-1.5">
        <!-- 待关闭标记的会话 (Marked Sessions) -->
        <li
          v-for="(session, index) in filteredMarked"
          :key="`marked-${session.workspaceId}`"
          :data-testid="`marked-suspended-session-${session.workspaceId}`"
          class="session-card group rounded-lg border border-border/80 bg-card/60 p-2.5 shadow-2xs hover:border-primary/40 hover:bg-card transition-all"
        >
          <!-- 顶行：左侧序号、图标与标题，右侧时间与状态徽章 -->
          <div class="session-row-top flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                class="session-seq flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-blue-500/10 px-1 font-mono text-[10px] font-semibold text-blue-500"
              >
                #{{ index + 1 }}
              </span>
              <i class="fas fa-bookmark text-[9px] text-blue-500 shrink-0" aria-hidden="true"></i>
              <span class="session-name font-semibold text-xs text-foreground truncate">{{
                session.connectionName
              }}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                class="session-time text-[11px] font-mono text-text-secondary/60"
                :title="new Date(session.markedAt).toLocaleString()"
              >
                {{ formatTime(session.markedAt) }}
              </span>
              <span class="status-badge status-marked shrink-0">
                <span class="status-dot"></span>
                <span>{{ t('suspendedSshSessions.status.marked') }}</span>
              </span>
            </div>
          </div>

          <!-- 底行：居中均匀分布的操作按钮 -->
          <div class="session-actions mt-2 flex items-center justify-center gap-2">
            <button
              v-if="props.canResume"
              type="button"
              class="session-action action-resume flex-1 justify-center"
              :title="t('suspendedSshSessions.action.resume')"
              :aria-label="t('suspendedSshSessions.action.resume')"
              @click="emit('resumeMarked', session.workspaceId)"
            >
              <i class="fas fa-play text-[8px]" aria-hidden="true"></i>
              <span class="button-session-text">{{ t('suspendedSshSessions.action.resume') }}</span>
            </button>
            <button
              type="button"
              class="session-action action-export flex-1 justify-center"
              :title="t('tabs.contextMenu.unmarkForSuspend')"
              :aria-label="t('tabs.contextMenu.unmarkForSuspend')"
              @click="emit('unmark', session.workspaceId)"
            >
              <i class="fas fa-undo text-[9px]" aria-hidden="true"></i>
              <span class="button-session-text">{{ t('tabs.contextMenu.unmarkForSuspend') }}</span>
            </button>
          </div>
        </li>

        <!-- 挂起的会话小卡片 (Suspended Sessions) -->
        <li
          v-for="(session, index) in data.filtered.value"
          :key="session.id"
          :data-testid="`suspended-session-${session.id}`"
          :data-suspend-id="session.id"
          class="session-card group rounded-lg border border-border/80 bg-card/60 p-2.5 shadow-2xs hover:border-primary/40 hover:bg-card transition-all"
          :class="{ 'opacity-75': session.status !== 'active' }"
        >
          <!-- 顶行：左侧序号、图标与标题，右侧紧凑时间与状态徽章（不额外多占一行） -->
          <div class="session-row-top flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                class="session-seq flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-primary/10 px-1 font-mono text-[10px] font-semibold text-primary"
              >
                #{{ (filteredMarked.length || 0) + index + 1 }}
              </span>
              <i class="fas fa-terminal text-[9px] text-primary/70 shrink-0" aria-hidden="true"></i>

              <input
                v-if="editingId === session.id"
                v-model="editingName"
                type="text"
                autofocus
                class="h-5 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 text-xs font-semibold text-foreground focus:outline-none"
                @blur="finishRename(session)"
                @keyup.enter.prevent="finishRename(session)"
                @keyup.esc.prevent="cancelRename"
              />
              <button
                v-else
                type="button"
                class="session-name min-w-0 text-left font-semibold text-xs text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 cursor-pointer truncate disabled:cursor-default"
                :disabled="Boolean(renamingId)"
                :title="t('suspendedSshSessions.tooltip.editName')"
                @click="startRename(session)"
              >
                <span class="truncate">{{ session.customName || session.connectionName }}</span>
                <!-- 若有自定义名称且与底层连接不同，才显示连接名副标，杜绝同一名字出现两次 -->
                <span
                  v-if="session.customName && session.customName !== session.connectionName"
                  class="font-normal text-text-secondary/70 text-[11px] shrink-0"
                >
                  ({{ session.connectionName }})
                </span>
                <i
                  class="fas fa-pen text-[8px] text-text-secondary/40 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                  aria-hidden="true"
                ></i>
              </button>
            </div>

            <!-- 右侧：紧凑时间 + 状态徽章 -->
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                class="session-time text-[11px] font-mono text-text-secondary/60"
                :title="new Date(session.suspendedAt).toLocaleString()"
              >
                {{ formatTime(session.suspendedAt) }}
              </span>
              <span
                class="status-badge shrink-0"
                :class="session.status === 'active' ? 'status-active' : 'status-disconnected'"
              >
                <span class="status-dot"></span>
                <span>{{ getStatusLabel(session) }}</span>
              </span>
            </div>
          </div>

          <!-- 底行：操作按钮组居中并均匀分布（flex-1 铺满，不再偏向右侧） -->
          <div class="session-actions mt-2 flex items-center justify-center gap-2">
            <button
              v-if="session.status === 'active' && props.canResume"
              type="button"
              class="session-action action-resume flex-1 justify-center"
              :title="t('suspendedSshSessions.action.resume')"
              :aria-label="t('suspendedSshSessions.action.resume')"
              @click="emit('resume', session)"
            >
              <i class="fas fa-play text-[8px]" aria-hidden="true"></i>
              <span class="button-session-text">{{ t('suspendedSshSessions.action.resume') }}</span>
            </button>
            <button
              type="button"
              class="session-action action-export flex-1 justify-center"
              :disabled="exportingId === session.id"
              :title="t('suspendedSshSessions.action.exportLog')"
              :aria-label="t('suspendedSshSessions.action.exportLog')"
              @click="exportLog(session)"
            >
              <i
                :class="exportingId === session.id ? 'fas fa-spinner fa-spin' : 'fas fa-download'"
                class="text-[9px]"
                aria-hidden="true"
              ></i>
              <span class="button-session-text">{{ t('suspendedSshSessions.action.exportLog') }}</span>
            </button>
            <button
              type="button"
              class="session-action action-remove flex-1 justify-center"
              :disabled="removingId === session.id"
              :title="t('suspendedSshSessions.action.remove')"
              :aria-label="t('suspendedSshSessions.action.remove')"
              @click="remove(session)"
            >
              <i
                :class="removingId === session.id ? 'fas fa-spinner fa-spin' : 'fas fa-trash-alt'"
                class="text-[9px]"
                aria-hidden="true"
              ></i>
              <span class="button-session-text">{{ t('suspendedSshSessions.action.remove') }}</span>
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
  .suspended-sessions-panel {
    container-type: inline-size;
    container-name: suspended-sessions-view-pane;
    font-family: var(--font-family-sans-serif);
  }

  .session-card {
    transition: all 0.15s ease-in-out;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.08rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.625rem;
    font-weight: 500;
    white-space: nowrap;
    line-height: 1.25;
  }
  .status-dot {
    width: 0.3125rem;
    height: 0.3125rem;
    border-radius: 9999px;
    background: currentColor;
  }
  .status-active {
    color: rgb(22 163 74);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
  }
  .status-marked {
    color: rgb(37 99 235);
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
  }
  .status-disconnected {
    color: rgb(217 119 6);
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
  }

  /* 规整统一的操作按钮体系 */
  .session-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: 1.5rem;
    padding: 0 0.45rem;
    border-radius: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 500;
    transition: all 0.12s ease;
    cursor: pointer;
    white-space: nowrap;
  }
  .session-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .action-resume {
    color: white;
    background: var(--button-bg-color, var(--link-active-color));
    border: 1px solid transparent;
  }
  .action-resume:hover:not(:disabled) {
    background: var(--button-hover-bg-color, color-mix(in srgb, var(--link-active-color) 85%, black));
  }
  .action-export {
    color: var(--text-color, #4b5563);
    background: var(--header-bg-color, #f3f4f6);
    border: 1px solid var(--border-color, #e5e7eb);
  }
  .action-export:hover:not(:disabled) {
    color: var(--link-active-color, #2563eb);
    border-color: var(--link-active-color, #2563eb);
    background: rgba(37, 99, 235, 0.05);
  }
  .action-remove {
    color: var(--text-color, #4b5563);
    background: var(--header-bg-color, #f3f4f6);
    border: 1px solid var(--border-color, #e5e7eb);
  }
  .action-remove:hover:not(:disabled) {
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border-color: rgba(220, 38, 38, 0.25);
  }

  /* 窄屏自适应 (<= 320px)：适度缩小按钮高度与内边距，时间隐藏防挤压 */
  @container suspended-sessions-view-pane (max-width: 320px) {
    .session-time {
      display: none;
    }
    .session-action {
      height: 1.375rem;
      padding: 0 0.25rem;
      font-size: 0.625rem;
    }
  }

  /* 极窄模式 (<= 240px)：按钮纯图标化 */
  @container suspended-sessions-view-pane (max-width: 240px) {
    .button-session-text {
      display: none;
    }
    .session-action {
      min-width: 0;
      padding: 0;
    }
    .session-action i {
      margin: 0 !important;
    }
  }
</style>
