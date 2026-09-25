import { computed, type ComputedRef } from 'vue';
import type { ConnectionTagDto } from '../model/tag';
import { useTagsStore } from '../store/tags.store';

export interface ConnectionTagsController {
  tags: ComputedRef<ConnectionTagDto[]>;
  loaded: ComputedRef<boolean>;
  load(force?: boolean): Promise<ConnectionTagDto[]>;
  revalidate(maxAgeMs?: number): Promise<ConnectionTagDto[]>;
  create(name: string): Promise<ConnectionTagDto>;
  rename(id: number, name: string): Promise<ConnectionTagDto>;
  remove(id: number): Promise<void>;
}

export function useConnectionTags(): ConnectionTagsController {
  const store = useTagsStore();
  return {
    tags: computed(() => store.items),
    loaded: computed(() => store.loaded),
    load: store.load.bind(store),
    revalidate: store.revalidate.bind(store),
    create: store.create.bind(store),
    rename: store.rename.bind(store),
    remove: store.remove.bind(store),
  };
}

export const resetConnectionTagsCache = (): void => useTagsStore().reset();
