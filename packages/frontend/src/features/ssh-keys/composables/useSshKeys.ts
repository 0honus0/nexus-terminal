import { computed } from 'vue';
import { useSshKeysStore } from '../store/sshKeys.store';
export function useSshKeys() {
  const store = useSshKeysStore();
  return {
    keys: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
  };
}
