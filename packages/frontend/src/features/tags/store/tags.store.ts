import { defineStore } from 'pinia';
import { tagsApi } from '../api/tagsApi';
import type { ConnectionTag } from '../model/tag';
export const useTagsStore = defineStore('connection-tags', {
  state: () => ({ items: [] as ConnectionTag[], loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      this.items = await tagsApi.list();
      this.loaded = true;
      return this.items;
    },
    async create(name: string) {
      const tag = await tagsApi.create(name);
      this.items.push(tag);
      return tag;
    },
    async rename(id: number, name: string) {
      const tag = await tagsApi.update(id, name);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = tag;
      return tag;
    },
    async remove(id: number) {
      await tagsApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
    },
  },
});
