import { computed } from 'vue';
import { useProxiesStore } from '../store/proxies.store';
export function useProxies() {
  const store = useProxiesStore();
  return {
    proxies: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
  };
}
