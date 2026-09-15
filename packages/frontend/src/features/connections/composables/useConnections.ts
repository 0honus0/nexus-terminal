import { computed } from 'vue';
import { useConnectionsStore } from '../store/connections.store';
export function useConnections() {
  const store = useConnectionsStore();
  return {
    connections: computed(() => store.items),
    loaded: computed(() => store.loaded),
    load: store.load.bind(store),
    revalidate: store.revalidate.bind(store),
    refresh: store.refresh.bind(store),
    markConnected: store.markConnected.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
    clone: store.clone.bind(store),
  };
}

export const refreshConnection = (id: number) => useConnectionsStore().refresh(id);
export const markConnectionConnected = (id: number, timestamp: number) =>
  useConnectionsStore().markConnected(id, timestamp);
export const resetConnectionsCache = (): void => useConnectionsStore().reset();
