import { computed } from 'vue';
import { useConnectionsStore } from '../store/connections.store';
export function useConnections() {
  const store = useConnectionsStore();
  return {
    connections: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
    clone: store.clone.bind(store),
  };
}
