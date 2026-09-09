import { defineStore } from 'pinia';
import { connectionsApi } from '../api/connectionsApi';
import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';
export const useConnectionsStore = defineStore('connections', {
  state: () => ({ items: [] as Connection[], loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      this.items = await connectionsApi.list();
      this.loaded = true;
      return this.items;
    },
    async create(input: ConnectionInput) {
      const item = await connectionsApi.create(input);
      this.items.push(item);
      return item;
    },
    async update(id: number, input: ConnectionUpdate) {
      const item = await connectionsApi.update(id, input);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = item;
      return item;
    },
    async remove(id: number) {
      await connectionsApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
    },
    async clone(id: number, name: string) {
      const item = await connectionsApi.clone(id, name);
      this.items.push(item);
      return item;
    },
  },
});
