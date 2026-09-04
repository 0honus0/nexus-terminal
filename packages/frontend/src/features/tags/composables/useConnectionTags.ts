import { computed } from 'vue';
import { useTagsStore } from '../store/tags.store';
export function useConnectionTags() {
  const store = useTagsStore();
  return {
    tags: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    rename: store.rename.bind(store),
    remove: store.remove.bind(store),
  };
}
