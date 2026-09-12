import { defineStore } from 'pinia';
import { connectionsApi } from '../api/connectionsApi';
import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';
export const useConnectionsStore = defineStore('connections', {
  state: () => ({ items: [] as Connection[], loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      const incoming = await connectionsApi.list();
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
      return this.items;
    },
    upsert(item: Connection) {
      const i = this.items.findIndex((x) => x.id === item.id);
      if (i >= 0) this.items[i] = item;
      else this.items.push(item);
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
      return next;
    },
    async create(input: ConnectionInput) {
      const item = await connectionsApi.create(input);
      return this.upsert(item);
    },
    async update(id: number, input: ConnectionUpdate) {
      const item = await connectionsApi.update(id, input);
      return this.upsert(item);
    },
    async remove(id: number) {
      await connectionsApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
    },
    async clone(id: number, name: string) {
      const item = await connectionsApi.clone(id, name);
      return this.upsert(item);
    },
  },
});
