import { defineStore } from 'pinia';
import { tagsApi } from '../api/tagsApi';
import type { ConnectionTagDto } from '../model/tag';

const DEFAULT_STALE_MS = 60_000;
let loadPromise: Promise<ConnectionTagDto[]> | null = null;
let cacheGeneration = 0;

export const useTagsStore = defineStore('connection-tags', {
  state: () => ({ items: [] as ConnectionTagDto[], loaded: false, loadedAt: 0 }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      if (loadPromise) return loadPromise;
      const generation = cacheGeneration;
      const request = tagsApi.list().then((items) => {
        if (generation !== cacheGeneration) return this.items;
        this.items = items;
        this.loaded = true;
        this.loadedAt = Date.now();
        return this.items;
      });
      loadPromise = request;
      try {
        return await request;
      } finally {
        if (loadPromise === request) loadPromise = null;
      }
    },
    async revalidate(maxAgeMs = DEFAULT_STALE_MS) {
      if (!this.loaded) return this.load();
      if (Date.now() - this.loadedAt < Math.max(0, maxAgeMs)) return this.items;
      return this.load(true);
    },
    reset() {
      cacheGeneration += 1;
      loadPromise = null;
      this.items = [];
      this.loaded = false;
      this.loadedAt = 0;
    },
    async create(name: string) {
      const tag = await tagsApi.create(name);
      this.items.push(tag);
      this.loadedAt = Date.now();
      return tag;
    },
    async rename(id: number, name: string) {
      const tag = await tagsApi.update(id, name);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = tag;
      this.loadedAt = Date.now();
      return tag;
    },
    async remove(id: number) {
      await tagsApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
      this.loadedAt = Date.now();
    },
  },
});
