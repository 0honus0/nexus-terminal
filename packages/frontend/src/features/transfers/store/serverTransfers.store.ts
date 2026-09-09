import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { apiErrorMessage } from '@/client/http';
import { serverTransfersApi } from '../api/serverTransfersApi';
import { toTransferTask, type SendFilesRequest, type ServerTransferTask } from '../model/serverTransfer';

export const useServerTransfersStore = defineStore('serverTransfers', () => {
  const items = ref<ServerTransferTask[]>([]);
  const loading = ref(false);
  const error = ref('');
  let timer: number | undefined;
  let refreshInFlight: Promise<void> | undefined;
  let pendingRefresh = false;
  let pendingRefreshBackground = true;
  let freshnessGeneration = 0;

  const progressTasks = computed(() => items.value.map(toTransferTask).sort((a, b) => b.createdAt - a.createdAt));
  const invalidateInFlightRefresh = () => {
    freshnessGeneration += 1;
  };

  type LoadOptions = { background?: boolean; ensureFresh?: boolean };

  const performLoad = async (background: boolean, generation: number): Promise<void> => {
    const showLoading = !background;
    if (showLoading) loading.value = true;
    if (generation === freshnessGeneration) error.value = '';
    try {
      const nextItems = await serverTransfersApi.list();
      // A mutation may invalidate a poll while it is still in flight. Do not let that
      // older response overwrite the optimistic/newer state before the queued refresh.
      if (generation === freshnessGeneration) items.value = nextItems;
    } catch (cause) {
      if (generation === freshnessGeneration) {
        error.value = apiErrorMessage(cause, 'Failed to load transfer tasks.');
      }
    } finally {
      if (showLoading) loading.value = false;
    }
  };

  const runRefreshLoop = async (initialBackground: boolean): Promise<void> => {
    let background = initialBackground;
    try {
      while (true) {
        pendingRefresh = false;
        pendingRefreshBackground = true;
        const generation = freshnessGeneration;
        await performLoad(background, generation);
        if (!pendingRefresh) return;
        // Keep an existing foreground load visible through its queued refresh, and
        // upgrade a background refresh if any queued caller explicitly needs foreground loading.
        background = background && pendingRefreshBackground;
      }
    } finally {
      refreshInFlight = undefined;
    }
  };

  const load = (options: LoadOptions = {}): Promise<void> => {
    const background = Boolean(options.background);
    if (options.ensureFresh) {
      invalidateInFlightRefresh();
      if (refreshInFlight) {
        pendingRefresh = true;
        pendingRefreshBackground = pendingRefreshBackground && background;
        return refreshInFlight;
      }
    }
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = runRefreshLoop(background);
    return refreshInFlight;
  };

  const send = async (request: SendFilesRequest): Promise<ServerTransferTask> => {
    const task = await serverTransfersApi.send(request);
    invalidateInFlightRefresh();
    items.value = [task, ...items.value.filter((item) => item.taskId !== task.taskId)];
    return task;
  };

  const cancel = async (taskId: string): Promise<void> => {
    const task = items.value.find((item) => item.taskId === taskId);
    invalidateInFlightRefresh();
    if (task && !['completed', 'failed', 'partially-completed', 'cancelled'].includes(task.status)) {
      task.status = 'cancelling';
    }
    await serverTransfersApi.cancel(taskId);
    void load({ background: true, ensureFresh: true });
  };

  const remove = async (taskId: string): Promise<void> => {
    await serverTransfersApi.remove(taskId);
    invalidateInFlightRefresh();
    items.value = items.value.filter((item) => item.taskId !== taskId);
  };

  const cancelAll = async (): Promise<void> => {
    const active = items.value.filter(
      (item) => !['completed', 'failed', 'partially-completed', 'cancelled', 'cancelling'].includes(item.status),
    );
    await Promise.allSettled(active.map((item) => cancel(item.taskId)));
  };

  const startPolling = (intervalMs = 2000): (() => void) => {
    window.clearInterval(timer);
    void load();
    timer = window.setInterval(() => void load({ background: true }), Math.max(1000, intervalMs));
    return stopPolling;
  };

  function stopPolling(): void {
    window.clearInterval(timer);
    timer = undefined;
  }

  return { items, progressTasks, loading, error, load, send, cancel, remove, cancelAll, startPolling, stopPolling };
});
