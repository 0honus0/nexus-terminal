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

  const progressTasks = computed(() => items.value.map(toTransferTask).sort((a, b) => b.createdAt - a.createdAt));

  const load = async (): Promise<void> => {
    if (loading.value) return;
    loading.value = true;
    error.value = '';
    try {
      items.value = await serverTransfersApi.list();
    } catch (cause) {
      error.value = apiErrorMessage(cause, 'Failed to load transfer tasks.');
    } finally {
      loading.value = false;
    }
  };

  const send = async (request: SendFilesRequest): Promise<ServerTransferTask> => {
    const task = await serverTransfersApi.send(request);
    items.value = [task, ...items.value.filter((item) => item.taskId !== task.taskId)];
    return task;
  };

  const cancel = async (taskId: string): Promise<void> => {
    const task = items.value.find((item) => item.taskId === taskId);
    if (task && !['completed', 'failed', 'partially-completed', 'cancelled'].includes(task.status)) {
      task.status = 'cancelling';
    }
    await serverTransfersApi.cancel(taskId);
    void load();
  };

  const remove = async (taskId: string): Promise<void> => {
    await serverTransfersApi.remove(taskId);
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
    timer = window.setInterval(() => void load(), Math.max(1000, intervalMs));
    return stopPolling;
  };

  function stopPolling(): void {
    window.clearInterval(timer);
    timer = undefined;
  }

  return { items, progressTasks, loading, error, load, send, cancel, remove, cancelAll, startPolling, stopPolling };
});
