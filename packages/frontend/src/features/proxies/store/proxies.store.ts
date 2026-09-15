import { defineStore } from 'pinia';
import { proxiesApi } from '../api/proxiesApi';
import type { Proxy, ProxyInput } from '../model/proxy';

let loadPromise: Promise<Proxy[]> | null = null;
let cacheGeneration = 0;

export const useProxiesStore = defineStore('proxies', {
  state: () => ({ items: [] as Proxy[], loaded: false }),
  actions: {
    reset() {
      cacheGeneration += 1;
      loadPromise = null;
      this.items = [];
      this.loaded = false;
    },
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      if (loadPromise) return loadPromise;
      const generation = cacheGeneration;
      const request = proxiesApi.list().then((items) => {
        if (generation !== cacheGeneration) return this.items;
        this.items = items;
        this.loaded = true;
        return this.items;
      });
      loadPromise = request;
      try {
        return await request;
      } finally {
        if (loadPromise === request) loadPromise = null;
      }
    },
    async create(input: ProxyInput) {
      const item = await proxiesApi.create(input);
      this.items.push(item);
      return item;
    },
    async update(id: number, input: Partial<ProxyInput>) {
      const item = await proxiesApi.update(id, input);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = item;
      return item;
    },
    async remove(id: number) {
      await proxiesApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
    },
  },
});
