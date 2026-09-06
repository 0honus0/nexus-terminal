<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import { useConnections } from '@/features/connections/public';
  import type { ProgressSource, TransferTask } from '../model/transfer';
  import type {
    ServerTransferSubTaskStatus,
    ServerTransferTask,
    ServerTransferTaskStatus,
  } from '../model/serverTransfer';

  const props = withDefaults(
    defineProps<{
      visible: boolean;
      sources: readonly ProgressSource[];
      serverTransfers?: readonly ServerTransferTask[];
      serverTransfersLoading?: boolean;
      serverTransfersError?: string;
      mobile?: boolean;
    }>(),
    {
      serverTransfers: () => [],
      serverTransfersLoading: false,
      serverTransfersError: '',
      mobile: false,
    },
  );
  const emit = defineEmits<{
    close: [];
    restore: [sourceId: string];
    cancel: [sourceId: string, taskId: string];
    cancelAll: [sourceId: string];
    remove: [sourceId: string, taskId: string];
  }>();
  const { t, locale } = useI18n();
  const connections = useConnections();

  const done = (status: TransferTask['status']) =>
    ['completed', 'cancelled', 'skipped', 'partial', 'error'].includes(status);
  const activeCount = (source: ProgressSource) => source.tasks.filter((task) => !done(task.status)).length;
  const normalizedProgress = (task: TransferTask) => Math.max(0, Math.min(100, task.progress));

  const displayedServerTransfers = computed(() =>
    [...props.serverTransfers]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 5),
  );
  const serverTaskFinal = (status: ServerTransferTaskStatus): boolean =>
    ['completed', 'failed', 'partially-completed', 'cancelled'].includes(status);
  const serverTaskCancellable = (status: ServerTransferTaskStatus): boolean =>
    ['queued', 'in-progress'].includes(status);
  const connectionName = (connectionId?: number): string => {
    if (!connectionId) return t('transferProgressModal.unknownSourceServer');
    const connection = connections.connections.value.find((item) => item.id === connectionId);
    return (
      connection?.name?.trim() || connection?.host || t('transferProgressModal.connectionIdFallback', { connectionId })
    );
  };
  const serverTaskTitle = (task: ServerTransferTask): string => {
    const sourceConnectionId = task.sourceConnectionId ?? task.payload.sourceConnectionId;
    const fileName =
      task.payload.sourceItems[0]?.name ||
      task.subTasks[0]?.sourceItemName ||
      t('transferProgressModal.unknownFileName');
    const targetPath =
      task.remoteTargetPath || task.payload.remoteTargetPath || t('transferProgressModal.unknownTargetPath');
    return `${connectionName(sourceConnectionId)} (${fileName} -> ${targetPath})`;
  };
  const statusLabel = (status: ServerTransferTaskStatus | ServerTransferSubTaskStatus): string => {
    const keys: Record<ServerTransferTaskStatus | ServerTransferSubTaskStatus, string> = {
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
    return t(keys[status]);
  };
  const statusClasses = (status: ServerTransferTaskStatus | ServerTransferSubTaskStatus) => ({
    'bg-green-100 text-green-700': status === 'completed',
    'bg-red-100 text-red-700': status === 'failed',
    'bg-yellow-100 text-yellow-700': status === 'partially-completed' || status === 'queued' || status === 'cancelling',
    'bg-blue-100 text-blue-700': status === 'in-progress' || status === 'connecting' || status === 'transferring',
    'bg-gray-100 text-gray-700': status === 'cancelled',
  });
  const formatDate = (value: string): string => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleString(locale.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };
</script>

<template>
  <OverlayPanel
    :visible="visible"
    :overlay="mobile"
    :teleport="mobile"
    :z-index="1100"
    preset="standard-modal"
    panel-test-id="progress-display-dialog"
    data-testid="progress-display-overlay"
    @close="emit('close')"
  >
    <section
      v-if="visible"
      data-testid="progress-display-modal"
      :data-progress-display-placement="mobile ? 'overlay' : 'inline'"
      :class="[
        'text-foreground',
        mobile
          ? 'progress-display-mobile flex min-h-0 flex-col overflow-hidden bg-background'
          : 'progress-display-inline flex-shrink-0 border-x border-b border-border bg-background',
      ]"
    >
      <div
        class="transfer-progress-panel mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden bg-background"
      >
        <div class="transfer-progress-header relative flex-shrink-0 px-4 py-3 sm:px-6">
          <h3 class="m-0 text-center text-lg font-semibold">{{ t('progressCenter.title') }}</h3>
          <button
            type="button"
            data-testid="transfer-progress-minimize"
            class="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-text-secondary hover:bg-border/60 hover:text-foreground"
            :title="t('progressCenter.hide')"
            :aria-label="t('progressCenter.hide')"
            @click.stop="emit('close')"
          >
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
        </div>

        <div
          class="progress-display-content custom-scrollbar min-h-0 flex-grow space-y-4 overflow-y-auto px-4 pr-4 sm:px-6 sm:pr-8"
        >
          <section data-testid="progress-display-hidden-section" class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="m-0 text-sm font-semibold">{{ t('progressCenter.hiddenTitle') }}</h4>
              </div>
              <span class="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-xs tabular-nums text-text-secondary">
                {{ sources.length }}
              </span>
            </div>

            <div
              v-if="!sources.length"
              data-testid="progress-display-empty"
              class="rounded border border-dashed border-border px-3 py-5 text-center text-xs text-text-secondary"
            >
              {{ t('progressCenter.empty') }}
            </div>

            <div v-else data-testid="hidden-progress-list" class="hidden-progress-source-grid">
              <article
                v-for="source in sources"
                :key="source.id"
                data-testid="hidden-progress-source"
                class="hidden-progress-source-card"
              >
                <div class="hidden-progress-source-header">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <strong class="min-w-0 flex-1 truncate text-sm" :title="source.label">{{ source.label }}</strong>
                      <span
                        class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary"
                      >
                        {{ source.tasks.length }}
                      </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      v-if="source.restorable !== false"
                      type="button"
                      data-testid="hidden-progress-restore"
                      class="rounded border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary"
                      @click="emit('restore', source.id)"
                    >
                      <i class="fas fa-window-restore mr-1" aria-hidden="true"></i>{{ t('progressCenter.restore') }}
                    </button>
                    <button
                      v-if="activeCount(source) > 0"
                      type="button"
                      data-testid="hidden-progress-cancel-all"
                      class="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300"
                      @click="emit('cancelAll', source.id)"
                    >
                      {{ t('progressCenter.cancelAll') }} ({{ activeCount(source) }})
                    </button>
                  </div>
                </div>

                <div data-testid="hidden-progress-source-list" class="hidden-progress-source-list custom-scrollbar">
                  <div
                    v-for="task in source.tasks"
                    :key="task.id"
                    data-testid="hidden-progress-task"
                    class="hidden-progress-task-row"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium">
                        {{ t(`progressCenter.kind.${task.kind}`) }}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-xs font-medium" :title="task.label">{{
                        task.label
                      }}</span>
                      <span class="shrink-0 text-[10px] text-text-secondary">{{
                        t(`progressCenter.status.${task.status}`)
                      }}</span>
                      <button
                        v-if="!done(task.status)"
                        type="button"
                        data-testid="hidden-progress-cancel"
                        class="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300"
                        :disabled="task.status === 'cancelling'"
                        @click="emit('cancel', source.id, task.id)"
                      >
                        {{ task.status === 'cancelling' ? t('progressCenter.cancelling') : t('common.cancel') }}
                      </button>
                      <button
                        v-else
                        type="button"
                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-border/60"
                        :aria-label="t('common.remove')"
                        @click="emit('remove', source.id, task.id)"
                      >
                        <i class="fas fa-times" aria-hidden="true"></i>
                      </button>
                    </div>

                    <div class="mt-1.5 flex items-center gap-2">
                      <div
                        data-testid="hidden-progress-bar"
                        class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-valuenow="Math.round(normalizedProgress(task))"
                      >
                        <div
                          class="h-full rounded-full bg-primary"
                          :style="{ width: `${normalizedProgress(task)}%` }"
                        ></div>
                      </div>
                      <span
                        data-testid="hidden-progress-percent"
                        class="w-11 shrink-0 text-right text-[11px] tabular-nums text-text-secondary"
                      >
                        {{ normalizedProgress(task).toFixed(1) }}%
                      </span>
                    </div>
                    <p v-if="task.warning" class="mb-0 mt-1 text-[11px] text-warning">{{ task.warning }}</p>
                    <p v-if="task.error" class="mb-0 mt-1 text-[11px] text-error">{{ task.error }}</p>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section class="space-y-3 border-t border-border pt-4">
            <h4 class="mb-3 mt-0 text-sm font-semibold">{{ t('progressCenter.serverTransfers') }}</h4>

            <div v-if="serverTransfersLoading && !serverTransfers.length" class="py-10 text-center text-text-secondary">
              <i class="fas fa-spinner fa-spin mb-2 text-2xl text-primary" aria-hidden="true"></i>
              <div>{{ t('transferProgressModal.loading') }}</div>
            </div>
            <div v-else-if="serverTransfersError" class="rounded-md bg-red-50 p-4 text-center text-red-500">
              <p class="font-semibold">{{ t('transferProgressModal.errorLoadingTitle') }}</p>
              <p>{{ t('transferProgressModal.errorLoading', { error: serverTransfersError }) }}</p>
            </div>
            <div v-else-if="!serverTransfers.length" class="py-10 text-center text-text-secondary">
              <i class="far fa-file-lines mb-2 text-4xl text-gray-400" aria-hidden="true"></i>
              <div>{{ t('transferProgressModal.noTasks') }}</div>
            </div>
            <div v-else class="space-y-3">
              <article
                v-for="task in displayedServerTransfers"
                :key="task.taskId"
                class="rounded-lg border border-border bg-background-alt p-3 shadow-sm transition-shadow hover:shadow-md"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <span class="block break-words text-base font-semibold">
                      {{ t('transferProgressModal.task.idLabel') }}: {{ serverTaskTitle(task) }}
                    </span>
                    <span class="text-xs text-text-secondary">
                      {{ t('transferProgressModal.task.createdAt') }}: {{ formatDate(task.createdAt) }}
                    </span>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <span :class="['rounded-full px-2.5 py-1 text-xs font-semibold', statusClasses(task.status)]">
                      {{ statusLabel(task.status) }}
                    </span>
                    <button
                      v-if="
                        serverTaskCancellable(task.status) ||
                        serverTaskFinal(task.status) ||
                        task.status === 'cancelling'
                      "
                      type="button"
                      :disabled="task.status === 'cancelling'"
                      :class="[
                        'rounded-md px-2 py-0.5 text-xs text-white transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                        serverTaskFinal(task.status)
                          ? 'bg-gray-500 hover:bg-gray-600 focus:ring-gray-400'
                          : 'bg-red-500 hover:bg-red-600 focus:ring-red-400',
                      ]"
                      :title="
                        serverTaskFinal(task.status)
                          ? t('transferProgressModal.removeTaskTooltip')
                          : t('transferProgressModal.cancelTaskTooltip')
                      "
                      @click="
                        serverTaskFinal(task.status)
                          ? emit('remove', 'server-transfers', task.taskId)
                          : emit('cancel', 'server-transfers', task.taskId)
                      "
                    >
                      <i v-if="task.status === 'cancelling'" class="fas fa-spinner fa-spin mr-1" aria-hidden="true"></i>
                      {{
                        task.status === 'cancelling'
                          ? t('transferProgressModal.cancellingButton')
                          : serverTaskFinal(task.status)
                            ? t('transferProgressModal.removeButton')
                            : t('transferProgressModal.cancelButton')
                      }}
                    </button>
                  </div>
                </div>

                <div v-if="task.overallProgress !== undefined" class="mb-2">
                  <div class="mb-0.5 flex justify-between text-xs text-text-secondary">
                    <span>{{ t('transferProgressModal.task.overallProgress') }}</span>
                    <span>{{ task.overallProgress }}%</span>
                  </div>
                  <div
                    class="h-1.5 w-full overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="Math.round(task.overallProgress)"
                  >
                    <div
                      class="h-1.5 rounded-full bg-primary"
                      :style="{ width: `${Math.max(0, Math.min(100, task.overallProgress))}%` }"
                    ></div>
                  </div>
                </div>

                <details v-if="task.subTasks.length" class="group mt-2">
                  <summary class="cursor-pointer list-none text-xs font-medium text-primary hover:underline">
                    {{ t('transferProgressModal.subTasks.titleToggle', { count: task.subTasks.length }) }}
                    <span class="group-open:hidden">+</span><span class="hidden group-open:inline">-</span>
                  </summary>
                  <ul class="ml-1 mt-2 space-y-1.5 border-l border-border pl-3">
                    <li
                      v-for="subTask in task.subTasks"
                      :key="subTask.subTaskId"
                      class="rounded border border-border bg-background p-1.5 text-xs"
                    >
                      <p>
                        <strong>{{ t('transferProgressModal.subTask.source') }}:</strong> {{ subTask.sourceItemName }}
                      </p>
                      <p>
                        <strong>{{ t('transferProgressModal.subTask.connectionId') }}:</strong>
                        {{ connectionName(subTask.connectionId) }}
                      </p>
                      <div class="flex flex-wrap items-center gap-1">
                        <strong>{{ t('transferProgressModal.subTask.status') }}:</strong>
                        <span
                          :class="['rounded-full px-2 py-0.5 text-xs font-semibold', statusClasses(subTask.status)]"
                        >
                          {{ statusLabel(subTask.status) }}
                        </span>
                        <span v-if="subTask.progress !== undefined" class="text-xs text-text-secondary">
                          ({{ subTask.progress }}%)
                        </span>
                      </div>
                      <p v-if="subTask.transferMethodUsed">
                        <strong>{{ t('transferProgressModal.subTask.method') }}:</strong>
                        {{ subTask.transferMethodUsed }}
                      </p>
                      <p v-if="subTask.status === 'failed' && subTask.message" class="text-red-600">
                        <strong>{{ t('transferProgressModal.subTask.error') }}:</strong> {{ subTask.message }}
                      </p>
                    </li>
                  </ul>
                </details>
                <div v-else class="mt-2 text-xs text-text-secondary">
                  {{ t('transferProgressModal.subTasks.noSubTasks') }}
                </div>
              </article>
            </div>
          </section>
        </div>

        <div class="mt-auto flex flex-shrink-0 items-center justify-end border-t border-border px-4 py-4 sm:px-6">
          <button
            type="button"
            data-testid="progress-display-close"
            class="rounded-md bg-button px-4 py-2 text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            @click="emit('close')"
          >
            {{ t('common.close') }}
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
  .progress-display-mobile {
    max-height: calc(85dvh - 2rem);
  }
  .transfer-progress-header {
    border-bottom: 1px solid var(--border-color);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--link-active-color, #007bff) 10%, transparent),
      transparent
    );
  }
  .progress-display-content {
    margin-bottom: 1rem;
    padding-top: 1rem;
  }
  .hidden-progress-source-grid {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
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
    border: 2px solid transparent;
    border-radius: 10px;
    background-color: rgba(128, 128, 128, 0.3);
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(128, 128, 128, 0.5);
  }
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
  }
  @media (max-width: 640px) {
    .progress-display-mobile .hidden-progress-source-header {
      align-items: flex-start;
      flex-wrap: wrap;
    }
  }
</style>
