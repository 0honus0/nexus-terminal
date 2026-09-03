<script setup lang="ts">
  import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import apiClient from '../utils/apiClient';
  import { useConnectionsStore } from '../stores/connections.store';
  import { useUiNotificationsStore } from '../stores/uiNotifications.store';
  import { useSessionStore } from '../stores/session.store';
  import {
    useProgressCenterStore,
    type ProgressTaskKind,
    type RegisteredProgressSource,
    type RegisteredProgressTask,
  } from '../stores/progressCenter.store';
  import OverlayPanel from '@/foundation/ui/OverlayPanel.vue';

  interface Props {
    visible: boolean;
    isMobile?: boolean;
  }

  const props = defineProps<Props>();
  const emit = defineEmits(['update:visible']);
  const { t, locale } = useI18n(); // +++ 解构出 locale +++
  const connectionsStore = useConnectionsStore();
  const uiNotificationsStore = useUiNotificationsStore();
  const sessionStore = useSessionStore();
  const progressCenter = useProgressCenterStore();
  const hiddenProgressSources = computed(() => progressCenter.hiddenSources);

  // Helper function to get connection name by ID
  // 注意: 此函数假设 'connectionsStore.connections' 是一个包含连接对象的数组，
  // 每个对象至少有 'id' 和 'name' 属性。请根据实际 store 结构调整。
  const getConnectionName = (connectionId: number): string => {
    const connection = connectionsStore.connections?.find((c: any) => c.id === connectionId);
    if (connection && connection.name) {
      return connection.name;
    }
    return `连接ID: ${connectionId}`; // 未找到连接或名称时的回退显示
  };

  // Helper function to format the task title
  const formatTaskTitle = (task: TransferTask): string => {
    const fileName = task.subTasks && task.subTasks.length > 0 ? task.subTasks[0].sourceItemName : '[文件名未知]';

    const sourceServerName = task.sourceConnectionId ? getConnectionName(task.sourceConnectionId) : '[源服务器名]'; // 占位符，如果 sourceConnectionId 未提供

    const targetPath = task.remoteTargetPath || '[目标路径]'; // 占位符，如果 remoteTargetPath 未提供

    // 如果 sourceConnectionId, remoteTargetPath 都未提供，且没有子任务（无法获取文件名），则退回显示原始任务ID
    if (!task.sourceConnectionId && !task.remoteTargetPath && (!task.subTasks || task.subTasks.length === 0)) {
      return `任务ID: ${task.taskId}`;
    }

    return `${sourceServerName} (${fileName} -> ${targetPath})`;
  };

  const getProgressKindLabel = (kind: ProgressTaskKind): string => {
    const keyByKind: Record<ProgressTaskKind, string> = {
      upload: 'progressCenter.kind.upload',
      download: 'progressCenter.kind.download',
      copy: 'progressCenter.kind.copy',
      move: 'progressCenter.kind.move',
      compress: 'progressCenter.kind.compress',
      decompress: 'progressCenter.kind.decompress',
      transfer: 'progressCenter.kind.transfer',
      other: 'progressCenter.kind.other',
    };
    const fallbackByKind: Record<ProgressTaskKind, string> = {
      upload: 'Upload',
      download: 'Download',
      copy: 'Copy',
      move: 'Move',
      compress: 'Compress',
      decompress: 'Decompress',
      transfer: 'Transfer',
      other: 'Task',
    };
    return t(keyByKind[kind], fallbackByKind[kind]);
  };

  const normalizeRegisteredProgress = (progress?: number | null): number | null => {
    if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
    return Math.max(0, Math.min(100, progress));
  };

  const getProgressSessionLabel = (sessionId?: string): string => {
    if (!sessionId) return '';
    return sessionStore.sessions.get(sessionId)?.connectionName?.trim() || sessionId.slice(0, 8);
  };

  const getProgressSourceLabel = (source: RegisteredProgressSource): string => {
    if (source.label === 'upload') return t('fileManager.uploadTasks', '上传任务');
    if (source.label === 'file-transfer') return t('fileManager.transferTasks', '传输任务');
    const firstTask = source.tasks[0];
    return firstTask ? getProgressKindLabel(firstTask.kind) : t('progressCenter.kind.other', '任务');
  };

  const getProgressSourceTitle = (source: RegisteredProgressSource): string => {
    const sessionLabel = getProgressSessionLabel(source.sessionId);
    const sourceLabel = getProgressSourceLabel(source);
    return sessionLabel ? `${sessionLabel} · ${sourceLabel}` : sourceLabel;
  };

  const getProgressTaskStatusLabel = (task: RegisteredProgressTask): string => {
    if (!task.status) return '';
    if (task.status === 'cancelling') return t('progressCenter.cancelling', '取消中');
    if (task.kind === 'upload') return t(`fileManager.uploadStatus.${task.status}`, task.status);
    return task.status;
  };

  const getSourceCancellableCount = (source: RegisteredProgressSource): number =>
    source.tasks.filter((task) => task.cancellable !== false && task.cancel && task.status !== 'cancelling').length;

  const restoreRegisteredProgressSource = (source: RegisteredProgressSource) => {
    progressCenter.restoreSource(source.id);
    handleClose();
  };

  const cancelRegisteredProgressSource = async (source: RegisteredProgressSource) => {
    await progressCenter.cancelSource(source.id);
  };

  const cancelRegisteredProgress = async (task: RegisteredProgressTask) => {
    await progressCenter.cancelTask(task.sourceId, task.id);
  };

  // 数据结构参考
  interface TransferSubTask {
    subTaskId: string;
    connectionId: number;
    sourceItemName: string;
    status: 'queued' | 'connecting' | 'transferring' | 'completed' | 'failed' | 'cancelling' | 'cancelled'; // +++ 新增状态 +++
    progress?: number; // 0-100
    message?: string;
    transferMethodUsed?: 'rsync' | 'scp';
  }

  interface TransferTask {
    taskId: string;
    status: 'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed' | 'cancelling' | 'cancelled'; // +++ 新增状态 +++
    createdAt: string | Date;
    updatedAt: string | Date;
    subTasks: TransferSubTask[];
    overallProgress?: number;
    sourceConnectionId?: number;
    remoteTargetPath?: string;
  }

  const transferTasks = ref<TransferTask[]>([]);
  const isLoading = ref(false);
  const errorLoading = ref<string | null>(null);
  const pollingIntervalId = ref<number | null>(null);
  const pendingTaskActions = ref<Record<string, 'cancel' | 'remove'>>({});

  // Computed property for sorted and limited tasks
  const displayedTasks = computed(() => {
    // Create a new array to avoid mutating the original transferTasks ref directly during sort
    return [...transferTasks.value]
      .sort((a, b) => {
        // Ensure createdAt is treated as a Date object for comparison
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime(); // For descending order (newest first)
      })
      .slice(0, 5); // Limit to the 5 newest tasks
  });

  const fetchTransferTasks = async () => {
    isLoading.value = true;
    errorLoading.value = null;
    try {
      // 假设后端API路径为 /api/v1/transfers/status，且返回数据结构为 { data: TransferTask[] }
      // 请根据实际API调整这里的类型和数据访问
      const response = await apiClient.get<{ data: TransferTask[] }>('/transfers/status');
      const rawTasks = Array.isArray(response.data.data)
        ? response.data.data
        : Array.isArray(response.data)
          ? response.data
          : [];
      transferTasks.value = rawTasks.map((task) => {
        // 优先信任后端已经是 'cancelled' 或其他最终状态
        if (['completed', 'failed', 'cancelled', 'partially-completed'].includes(task.status)) {
          return task;
        }
        // 对于仍在进行中或正在取消中的任务
        if (['in-progress', 'cancelling', 'queued', 'connecting', 'transferring'].includes(task.status)) {
          // 如果它有子任务，并且所有子任务都已是 'cancelled'
          if (
            task.subTasks &&
            task.subTasks.length > 0 &&
            task.subTasks.every((st: TransferSubTask) => st.status === 'cancelled')
          ) {
            // 则认为主任务也应该被标记为 'cancelled'
            // 这有助于处理后端主任务状态更新延迟或遗漏的情况
            return { ...task, status: 'cancelled' as TransferTask['status'] };
          }
          // 如果任务状态是 'cancelling' 但它没有子任务 (或子任务列表为空)
          // 这种情况也应视为已取消
          else if (task.status === 'cancelling' && (!task.subTasks || task.subTasks.length === 0)) {
            return { ...task, status: 'cancelled' as TransferTask['status'] };
          }
        }
        return task;
      });
    } catch (error: any) {
      console.error('Failed to fetch transfer tasks:', error);
      errorLoading.value =
        error.response?.data?.message || error.message || t('transferProgressModal.error.unknown', '未知错误');
    } finally {
      isLoading.value = false;
    }
  };

  const getDisplayStatus = (status: string): string => {
    const statusKeyMap: Record<string, string> = {
      queued: 'transferProgressModal.status.queued',
      'in-progress': 'transferProgressModal.status.inProgress',
      completed: 'transferProgressModal.status.completed',
      failed: 'transferProgressModal.status.failed',
      'partially-completed': 'transferProgressModal.status.partiallyCompleted',
      connecting: 'transferProgressModal.status.connecting',
      transferring: 'transferProgressModal.status.transferring',
      cancelling: 'transferProgressModal.status.cancelling',
      cancelled: 'transferProgressModal.status.cancelled',
    };
    // 提供一个默认的回退文本，以防i18n key缺失
    const defaultText = status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
    return t(statusKeyMap[status] || `status.${status}`, defaultText);
  };

  const formatDate = (dateInput: string | Date): string => {
    if (!dateInput) return '';
    try {
      // +++ 使用 i18n 的 locale 进行日期格式化 +++
      return new Date(dateInput).toLocaleString(locale.value, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (e) {
      return String(dateInput);
    }
  };

  onMounted(() => {
    if (props.visible) {
      fetchTransferTasks();
      if (pollingIntervalId.value === null) {
        pollingIntervalId.value = window.setInterval(fetchTransferTasks, 5000);
      }
    }
  });

  onUnmounted(() => {
    if (pollingIntervalId.value !== null) {
      clearInterval(pollingIntervalId.value);
      pollingIntervalId.value = null;
    }
  });

  watch(
    () => props.visible,
    (newVisible) => {
      // internalVisible.value = newVisible; // 由下面的watch处理
      if (newVisible) {
        fetchTransferTasks(); // 模态框可见时立即获取一次数据
        if (pollingIntervalId.value === null) {
          // 只有在没有定时器时才启动
          pollingIntervalId.value = window.setInterval(fetchTransferTasks, 5000);
        }
      } else {
        if (pollingIntervalId.value !== null) {
          clearInterval(pollingIntervalId.value);
          pollingIntervalId.value = null;
        }
      }
    },
    { immediate: false },
  ); // immediate: false 避免在组件初始化时立即执行，onMounted已处理首次加载

  // --- 模态框可见性控制 ---
  const internalVisible = ref(props.visible);

  // 监听 props.visible 的变化来更新 internalVisible
  watch(
    () => props.visible,
    (newVisibleValue) => {
      internalVisible.value = newVisibleValue;
    },
    { immediate: true },
  ); // 确保初始状态同步

  // 监听 internalVisible 的变化来 emit update:visible
  watch(internalVisible, (newVal) => {
    if (newVal !== props.visible) {
      emit('update:visible', newVal);
    }
  });

  const handleClose = () => {
    internalVisible.value = false;
  };

  const isTaskCancellable = (taskStatus: TransferTask['status']): boolean => {
    return ['queued', 'in-progress', 'connecting', 'transferring'].includes(taskStatus);
  };

  const isTaskFinal = (taskStatus: TransferTask['status']): boolean => {
    return ['completed', 'failed', 'partially-completed', 'cancelled'].includes(taskStatus);
  };

  const isTaskActionPending = (taskId: string): boolean => Boolean(pendingTaskActions.value[taskId]);

  const setTaskAction = (taskId: string, action?: 'cancel' | 'remove') => {
    const next = { ...pendingTaskActions.value };
    if (action) next[taskId] = action;
    else delete next[taskId];
    pendingTaskActions.value = next;
  };

  const handleTaskAction = async (task: TransferTask) => {
    if (isTaskActionPending(task.taskId)) return;
    if (!isTaskCancellable(task.status) && !isTaskFinal(task.status)) return;

    const action = isTaskCancellable(task.status) ? 'cancel' : 'remove';
    setTaskAction(task.taskId, action);
    try {
      if (action === 'cancel') {
        task.status = 'cancelling';
        await apiClient.post(`/transfers/cancel/${task.taskId}`);
        uiNotificationsStore.showInfo(t('transferProgressModal.cancelRequested'));
      } else {
        await apiClient.delete(`/transfers/${task.taskId}`);
        transferTasks.value = transferTasks.value.filter((item) => item.taskId !== task.taskId);
        uiNotificationsStore.showSuccess(t('transferProgressModal.removeSuccess'));
      }
      await fetchTransferTasks();
    } catch (error: any) {
      console.error(`Failed to ${action} task ${task.taskId}:`, error);
      uiNotificationsStore.showError(
        error.response?.data?.message ||
          (action === 'cancel'
            ? t('transferProgressModal.error.cancelFailed')
            : t('transferProgressModal.error.removeFailed')),
      );
      await fetchTransferTasks();
    } finally {
      setTaskAction(task.taskId);
    }
  };
</script>

<template>
  <OverlayPanel
    :visible="internalVisible"
    :overlay="Boolean(props.isMobile)"
    :teleport="Boolean(props.isMobile)"
    :z-index="1100"
    preset="standard-modal"
    panel-test-id="progress-display-dialog"
    data-testid="progress-display-overlay"
    @close="handleClose"
  >
    <section
      v-if="internalVisible"
      data-testid="progress-display-modal"
      :data-progress-display-placement="props.isMobile ? 'overlay' : 'inline'"
      :class="[
        'text-foreground',
        props.isMobile
          ? 'progress-display-mobile flex min-h-0 flex-col overflow-hidden bg-background'
          : 'progress-display-inline flex-shrink-0 border-x border-b border-border bg-background',
      ]"
    >
      <div
        class="transfer-progress-panel mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden bg-background"
      >
        <!-- Header -->
        <div class="transfer-progress-header relative flex-shrink-0 px-4 py-3 sm:px-6">
          <h3 class="m-0 text-center text-lg font-semibold">
            {{ t('progressCenter.title', '进度显示') }}
          </h3>
          <button
            type="button"
            data-testid="transfer-progress-minimize"
            class="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-text-secondary hover:bg-border/60 hover:text-foreground"
            @click.stop="handleClose"
            :title="t('progressCenter.hide', '隐藏进度')"
          >
            <i class="fas fa-minus"></i>
          </button>
        </div>

        <!-- Content Area -->
        <div
          class="min-h-0 flex-grow overflow-y-auto mb-4 px-4 pr-4 space-y-4 custom-scrollbar sm:mb-6 sm:px-6 sm:pr-8"
        >
          <section data-testid="progress-display-hidden-section" class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="m-0 text-sm font-semibold">{{ t('progressCenter.hiddenTitle', '已隐藏的进度') }}</h4>
                <p v-if="hiddenProgressSources.length" class="mb-0 mt-0.5 text-[11px] text-text-muted">
                  {{ t('progressCenter.hiddenSourceHint', '每个卡片代表一个隐藏任务，卡片内可滚动查看明细。') }}
                </p>
              </div>
              <span class="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-xs tabular-nums text-text-muted">{{
                hiddenProgressSources.length
              }}</span>
            </div>

            <div
              v-if="hiddenProgressSources.length === 0"
              data-testid="progress-display-empty"
              class="rounded border border-dashed border-border px-3 py-5 text-center text-xs text-text-secondary"
            >
              {{ t('progressCenter.empty', '当前没有隐藏的进度任务。') }}
            </div>

            <div v-else class="hidden-progress-source-grid" data-testid="hidden-progress-list">
              <article
                v-for="source in hiddenProgressSources"
                :key="source.id"
                data-testid="hidden-progress-source"
                class="hidden-progress-source-card"
              >
                <div class="hidden-progress-source-header">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <strong class="min-w-0 flex-1 truncate text-sm" :title="getProgressSourceTitle(source)">{{
                        getProgressSourceTitle(source)
                      }}</strong>
                      <span
                        class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary"
                        >{{ source.tasks.length }}</span
                      >
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="hidden-progress-restore"
                      class="rounded border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary"
                      @click="restoreRegisteredProgressSource(source)"
                    >
                      <i class="fas fa-window-restore mr-1"></i>{{ t('common.restore', '还原') }}
                    </button>
                    <button
                      v-if="getSourceCancellableCount(source) > 0"
                      type="button"
                      data-testid="hidden-progress-cancel-all"
                      class="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100"
                      @click="cancelRegisteredProgressSource(source)"
                    >
                      {{ t('fileManager.actions.cancelAll', '全部取消') }} ({{ getSourceCancellableCount(source) }})
                    </button>
                  </div>
                </div>

                <div data-testid="hidden-progress-source-list" class="hidden-progress-source-list custom-scrollbar">
                  <div
                    v-for="task in source.tasks"
                    :key="task.key"
                    data-testid="hidden-progress-task"
                    class="hidden-progress-task-row"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium">{{
                        getProgressKindLabel(task.kind)
                      }}</span>
                      <span class="min-w-0 flex-1 truncate text-xs font-medium" :title="task.title">{{
                        task.title
                      }}</span>
                      <span v-if="getProgressTaskStatusLabel(task)" class="shrink-0 text-[10px] text-text-muted">{{
                        getProgressTaskStatusLabel(task)
                      }}</span>
                      <button
                        type="button"
                        data-testid="hidden-progress-cancel"
                        class="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="task.cancellable === false || !task.cancel || task.status === 'cancelling'"
                        @click="cancelRegisteredProgress(task)"
                      >
                        {{
                          task.status === 'cancelling'
                            ? t('progressCenter.cancelling', '取消中')
                            : t('common.cancel', '取消')
                        }}
                      </button>
                    </div>

                    <div class="mt-1.5 flex items-center gap-2">
                      <div
                        data-testid="hidden-progress-bar"
                        class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border"
                      >
                        <div
                          v-if="normalizeRegisteredProgress(task.progress) !== null"
                          class="h-full rounded-full bg-primary"
                          :style="{ width: `${normalizeRegisteredProgress(task.progress)}%` }"
                        ></div>
                        <div v-else class="h-full w-1/3 animate-pulse rounded-full bg-primary/60"></div>
                      </div>
                      <span
                        data-testid="hidden-progress-percent"
                        class="w-11 shrink-0 text-right text-[11px] tabular-nums text-text-secondary"
                      >
                        {{
                          normalizeRegisteredProgress(task.progress) !== null
                            ? `${normalizeRegisteredProgress(task.progress)?.toFixed(1)}%`
                            : '…'
                        }}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <div class="border-t border-border pt-4">
            <h4 class="mb-3 mt-0 text-sm font-semibold">
              {{ t('progressCenter.serverTransfers', '跨服务器传输任务') }}
            </h4>
          </div>
          <div v-if="isLoading && transferTasks.length === 0" class="text-center text-text-secondary py-10">
            <svg
              class="animate-spin h-8 w-8 text-primary mx-auto mb-2"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {{ t('transferProgressModal.loading', '正在加载传输任务...') }}
          </div>
          <div v-else-if="errorLoading" class="text-center text-red-500 bg-red-50 p-4 rounded-md">
            <p class="font-semibold">{{ t('transferProgressModal.errorLoadingTitle', '加载错误') }}</p>
            <p>{{ t('transferProgressModal.errorLoading', { error: errorLoading }) }}</p>
          </div>
          <div v-else-if="!isLoading && transferTasks.length === 0" class="text-center text-text-secondary py-10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12 text-gray-400 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            {{ t('transferProgressModal.noTasks', '当前没有活动的传输任务。') }}
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="task in displayedTasks"
              :key="task.taskId"
              class="bg-background-alt p-3 rounded-lg border shadow-sm hover:shadow-md transition-shadow"
              :style="{ borderColor: 'var(--border-color)' }"
            >
              <div class="flex justify-between items-start mb-2">
                <div>
                  <span class="font-semibold text-md block"
                    >{{ t('transferProgressModal.task.idLabel', '任务') }}: {{ formatTaskTitle(task) }}</span
                  >
                  <span class="text-xs text-text-muted"
                    >{{ t('transferProgressModal.task.createdAt', '创建于') }}: {{ formatDate(task.createdAt) }}</span
                  >
                </div>
                <div class="flex items-center space-x-2">
                  <span
                    :class="[
                      'px-2.5 py-1 text-xs font-semibold rounded-full',
                      { 'bg-green-100 text-green-700': task.status === 'completed' },
                      { 'bg-red-100 text-red-700': task.status === 'failed' },
                      {
                        'bg-yellow-100 text-yellow-700':
                          task.status === 'partially-completed' ||
                          task.status === 'queued' ||
                          task.status === 'cancelling',
                      }, // cancelling 也用黄色
                      { 'bg-blue-100 text-blue-700': task.status === 'in-progress' },
                      { 'bg-gray-100 text-gray-700': task.status === 'cancelled' }, // cancelled 用灰色
                    ]"
                  >
                    {{ getDisplayStatus(task.status) }}
                  </span>
                  <button
                    v-if="isTaskCancellable(task.status) || isTaskFinal(task.status) || task.status === 'cancelling'"
                    @click="handleTaskAction(task)"
                    :disabled="task.status === 'cancelling' || isTaskActionPending(task.taskId)"
                    :class="[
                      'px-2 py-0.5 text-xs text-white rounded-md focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
                      isTaskFinal(task.status)
                        ? 'bg-gray-500 hover:bg-gray-600 focus:ring-gray-400'
                        : 'bg-red-500 hover:bg-red-600 focus:ring-red-400',
                    ]"
                    :title="
                      isTaskFinal(task.status)
                        ? t('transferProgressModal.removeTaskTooltip')
                        : t('transferProgressModal.cancelTaskTooltip')
                    "
                  >
                    <i
                      v-if="task.status === 'cancelling' || isTaskActionPending(task.taskId)"
                      class="fas fa-spinner fa-spin mr-1"
                    ></i>
                    {{
                      task.status === 'cancelling'
                        ? t('transferProgressModal.cancellingButton')
                        : isTaskFinal(task.status)
                          ? t('transferProgressModal.removeButton')
                          : t('transferProgressModal.cancelButton')
                    }}
                  </button>
                </div>
              </div>

              <div v-if="task.overallProgress !== undefined" class="mb-2">
                <div class="flex justify-between text-xs text-text-secondary mb-0.5">
                  <span>{{ t('transferProgressModal.task.overallProgress', '整体进度') }}</span>
                  <span>{{ task.overallProgress }}%</span>
                </div>
                <div class="w-full bg-border rounded-full h-1.5">
                  <div class="bg-primary h-1.5 rounded-full" :style="{ width: task.overallProgress + '%' }"></div>
                </div>
              </div>

              <details v-if="task.subTasks && task.subTasks.length > 0" class="mt-2 group">
                <summary class="text-xs font-medium text-primary hover:underline cursor-pointer list-none">
                  {{ t('transferProgressModal.subTasks.titleToggle', { count: task.subTasks.length }) }}
                  <span class="group-open:hidden">+</span><span class="hidden group-open:inline">-</span>
                </summary>
                <ul class="mt-2 space-y-1.5 pl-3 border-l ml-1" :style="{ borderLeftColor: 'var(--border-color)' }">
                  <li
                    v-for="subTask in task.subTasks"
                    :key="subTask.subTaskId"
                    class="text-xs p-1.5 rounded bg-background border"
                    :style="{ borderColor: 'var(--border-color)' }"
                  >
                    <p>
                      <strong>{{ t('transferProgressModal.subTask.source', '源文件') }}:</strong>
                      {{ subTask.sourceItemName }}
                    </p>
                    <p>
                      <strong>{{ t('transferProgressModal.subTask.connectionId', '目标连接') }}:</strong>
                      {{ getConnectionName(subTask.connectionId) }}
                    </p>
                    <div class="flex items-center">
                      <strong class="mr-1">{{ t('transferProgressModal.subTask.status', '状态') }}:</strong>
                      <span
                        :class="[
                          'px-2 py-0.5 text-xs font-semibold rounded-full',
                          { 'bg-green-100 text-green-700': subTask.status === 'completed' },
                          { 'bg-red-100 text-red-700': subTask.status === 'failed' },
                          {
                            'bg-yellow-100 text-yellow-700':
                              subTask.status === 'queued' || subTask.status === 'cancelling',
                          },
                          {
                            'bg-blue-100 text-blue-700':
                              subTask.status === 'transferring' || subTask.status === 'connecting',
                          }, // 'connecting' and 'transferring' use blue
                          { 'bg-gray-100 text-gray-700': subTask.status === 'cancelled' },
                        ]"
                      >
                        {{ getDisplayStatus(subTask.status) }}
                      </span>
                      <span v-if="subTask.progress !== undefined" class="ml-1 text-xs text-text-secondary">
                        ({{ subTask.progress }}%)</span
                      >
                    </div>
                    <p v-if="subTask.transferMethodUsed">
                      <strong>{{ t('transferProgressModal.subTask.method', '方法') }}:</strong>
                      {{ subTask.transferMethodUsed }}
                    </p>
                    <p v-if="subTask.status === 'failed' && subTask.message" class="text-red-600">
                      <strong>{{ t('transferProgressModal.subTask.error', '错误') }}:</strong> {{ subTask.message }}
                    </p>
                  </li>
                </ul>
              </details>
              <div v-else-if="task.subTasks && task.subTasks.length === 0" class="mt-2 text-xs text-text-muted">
                {{ t('transferProgressModal.subTasks.noSubTasks', '没有子任务。') }}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="flex justify-end items-center px-4 py-4 mt-auto flex-shrink-0 border-t sm:px-6"
          :style="{ borderTopColor: 'var(--border-color)' }"
        >
          <button
            data-testid="progress-display-close"
            @click="handleClose"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
          >
            {{ t('common.close', '关闭') }}
          </button>
        </div>
      </div>
    </section>
  </OverlayPanel>
</template>

<style scoped>
  .progress-display-inline {
    position: static;
    z-index: auto;
    width: 100%;
    max-height: min(48vh, 34rem);
    overflow: hidden;
  }
  .progress-display-inline .transfer-progress-panel {
    max-height: min(48vh, 34rem);
  }
  @media (max-width: 640px) {
    .progress-display-mobile .hidden-progress-source-header {
      align-items: flex-start;
      flex-wrap: wrap;
    }
  }
  .transfer-progress-header {
    border-bottom: 1px solid var(--border-color);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--link-active-color, #007bff) 10%, transparent),
      transparent
    );
  }

  .hidden-progress-source-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    width: 100%;
  }
  .hidden-progress-source-card {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg-color) 96%, var(--header-bg-color));
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  }
  .hidden-progress-source-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
    background: color-mix(in srgb, var(--header-bg-color) 88%, transparent);
  }
  .hidden-progress-source-list {
    width: 100%;
    max-height: 260px;
    overflow-y: auto;
    padding: 4px 10px 7px;
  }
  .hidden-progress-task-row {
    padding: 7px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  }
  .hidden-progress-task-row:last-child {
    border-bottom: 0;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(128, 128, 128, 0.3);
    border-radius: 10px;
    border: 2px solid transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(128, 128, 128, 0.5);
  }

  /* For Firefox */
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
  }
</style>
