import { defineStore } from 'pinia';
import { proxiesApi } from '../api/proxiesApi';
import type { Proxy, ProxyInput } from '../model/proxy';
export const useProxiesStore = defineStore('proxies', {
  state: () => ({ items: [] as Proxy[], loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      this.items = await proxiesApi.list();
      this.loaded = true;
      return this.items;
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
