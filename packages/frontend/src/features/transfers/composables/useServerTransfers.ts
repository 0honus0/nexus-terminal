import { computed, type ComputedRef } from 'vue';
import type { TransferTask } from '../model/transfer';
import type { ServerTransferTaskDto } from '../model/serverTransfer';
import { useServerTransfersStore } from '../store/serverTransfers.store';

export interface ServerTransfersController {
  items: ComputedRef<readonly ServerTransferTaskDto[]>;
  progressTasks: ComputedRef<readonly TransferTask[]>;
  loading: ComputedRef<boolean>;
  error: ComputedRef<string>;
  cancel(taskId: string): Promise<void>;
  remove(taskId: string): Promise<void>;
  cancelAll(): Promise<void>;
  startPolling(intervalMs?: number): () => void;
  stopPolling(): void;
}

/** Public server-transfer facade for Workspace/runtime composition. */
export function useServerTransfers(): ServerTransfersController {
  const store = useServerTransfersStore();

  return {
    items: computed<readonly ServerTransferTaskDto[]>(() => store.items),
    progressTasks: computed<readonly TransferTask[]>(() => store.progressTasks),
    loading: computed(() => store.loading),
    error: computed(() => store.error),
    cancel: store.cancel.bind(store),
    remove: store.remove.bind(store),
    cancelAll: store.cancelAll.bind(store),
    startPolling: store.startPolling.bind(store),
    stopPolling: store.stopPolling.bind(store),
  };
}
