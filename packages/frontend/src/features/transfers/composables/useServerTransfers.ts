import { computed } from 'vue';
import type { TransferTask } from '../model/transfer';
import type { ServerTransferTask } from '../model/serverTransfer';
import { useServerTransfersStore } from '../store/serverTransfers.store';

/** Public server-transfer facade for Workspace/runtime composition. */
export function useServerTransfers() {
  const store = useServerTransfersStore();

  return {
    items: computed<readonly ServerTransferTask[]>(() => store.items),
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
