import { defineStore } from 'pinia';
import { connectionsApi } from '../api/connectionsApi';
import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';

const DEFAULT_STALE_MS = 30_000;
let loadPromise: Promise<Connection[]> | null = null;
let cacheGeneration = 0;

export const useConnectionsStore = defineStore('connections', {
  state: () => ({ items: [] as Connection[], loaded: false, loadedAt: 0 }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      if (loadPromise) return loadPromise;
      const generation = cacheGeneration;
      const request = connectionsApi.list().then((incoming) => {
        if (generation !== cacheGeneration) return this.items;
        const currentById = new Map(this.items.map((item) => [item.id, item] as const));
        this.items = incoming.map((item) => {
          const current = currentById.get(item.id);
          if (!current || (current.lastConnectedAt ?? 0) <= (item.lastConnectedAt ?? 0)) return item;
          return {
            ...item,
            lastConnectedAt: current.lastConnectedAt,
            updatedAt: Math.max(item.updatedAt, current.updatedAt),
          };
        });
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
    upsert(item: Connection) {
      const i = this.items.findIndex((x) => x.id === item.id);
      if (i >= 0) this.items[i] = item;
      else this.items.push(item);
      this.loadedAt = Date.now();
      return item;
    },
    async refresh(id: number) {
      return this.upsert(await connectionsApi.get(id));
    },
    markConnected(id: number, timestamp: number) {
      const i = this.items.findIndex((item) => item.id === id);
      if (i < 0 || !Number.isFinite(timestamp)) return null;
      const current = this.items[i]!;
      const next = {
        ...current,
        lastConnectedAt: timestamp,
        updatedAt: Math.max(current.updatedAt, timestamp),
      };
      this.items[i] = next;
      this.loadedAt = Date.now();
      return next;
    },
    async create(input: ConnectionInput) {
      return this.upsert(await connectionsApi.create(input));
    },
    async update(id: number, input: ConnectionUpdate) {
      return this.upsert(await connectionsApi.update(id, input));
    },
    async remove(id: number) {
      await connectionsApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
      this.loadedAt = Date.now();
    },
    async clone(id: number, name: string) {
      return this.upsert(await connectionsApi.clone(id, name));
    },
  },
});
