import { defineStore } from 'pinia';
import { ref } from 'vue';
import { tagsApi } from '../api/tagsApi';
import type { ConnectionTagDto } from '../model/tag';

const DEFAULT_STALE_MS = 60_000;
export const useTagsStore = defineStore('connection-tags', () => {
  const items = ref<ConnectionTagDto[]>([]);
  const loaded = ref(false);
  const loadedAt = ref(0);
  let loadPromise: Promise<ConnectionTagDto[]> | null = null;
  let cacheGeneration = 0;

  return {
    items,
    loaded,
    loadedAt,
    async load(force = false) {
      if (loaded.value && !force) return items.value;
      if (loadPromise) return loadPromise;
      const generation = cacheGeneration;
      const request = tagsApi.list().then((incoming) => {
        if (generation !== cacheGeneration) return items.value;
        items.value = incoming;
        loaded.value = true;
        loadedAt.value = Date.now();
        return items.value;
      });
      loadPromise = request;
      try {
        return await request;
      } finally {
        if (loadPromise === request) loadPromise = null;
      }
    },
    async revalidate(maxAgeMs = DEFAULT_STALE_MS) {
      if (!loaded.value) return this.load();
      if (Date.now() - loadedAt.value < Math.max(0, maxAgeMs)) return items.value;
      return this.load(true);
    },
    reset() {
      cacheGeneration += 1;
      loadPromise = null;
      items.value = [];
      loaded.value = false;
      loadedAt.value = 0;
    },
    async create(name: string) {
      const tag = await tagsApi.create(name);
      items.value.push(tag);
      loadedAt.value = Date.now();
      return tag;
    },
    async rename(id: number, name: string) {
      const tag = await tagsApi.update(id, name);
      const i = items.value.findIndex((x) => x.id === id);
      if (i >= 0) items.value[i] = tag;
      loadedAt.value = Date.now();
      return tag;
    },
    async remove(id: number) {
      await tagsApi.remove(id);
      items.value = items.value.filter((x) => x.id !== id);
      loadedAt.value = Date.now();
    },
  };
});
