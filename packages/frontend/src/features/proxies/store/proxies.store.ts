import { defineStore } from 'pinia';
import { ref } from 'vue';
import { proxiesApi } from '../api/proxiesApi';
import type { ProxyDto, ProxyCreateRequestDto } from '../model/proxy';

export const useProxiesStore = defineStore('proxies', () => {
  const items = ref<ProxyDto[]>([]);
  const loaded = ref(false);
  let loadPromise: Promise<ProxyDto[]> | null = null;
  let cacheGeneration = 0;

  return {
    items,
    loaded,
    reset() {
      cacheGeneration += 1;
      loadPromise = null;
      items.value = [];
      loaded.value = false;
    },
    async load(force = false) {
      if (loaded.value && !force) return items.value;
      if (loadPromise) return loadPromise;
      const generation = cacheGeneration;
      const request = proxiesApi.list().then((incoming) => {
        if (generation !== cacheGeneration) return items.value;
        items.value = incoming;
        loaded.value = true;
        return items.value;
      });
      loadPromise = request;
      try {
        return await request;
      } finally {
        if (loadPromise === request) loadPromise = null;
      }
    },
    async create(input: ProxyCreateRequestDto) {
      const item = await proxiesApi.create(input);
      items.value.push(item);
      return item;
    },
    async update(id: number, input: Partial<ProxyCreateRequestDto>) {
      const item = await proxiesApi.update(id, input);
      const i = items.value.findIndex((x) => x.id === id);
      if (i >= 0) items.value[i] = item;
      return item;
    },
    async remove(id: number) {
      await proxiesApi.remove(id);
      items.value = items.value.filter((x) => x.id !== id);
    },
  };
});
