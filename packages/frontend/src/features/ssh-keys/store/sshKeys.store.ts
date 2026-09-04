import { defineStore } from 'pinia';
import { sshKeysApi } from '../api/sshKeysApi';
import type { SshKeyInput, SshKeySummary } from '../model/sshKey';
export const useSshKeysStore = defineStore('ssh-keys', {
  state: () => ({ items: [] as SshKeySummary[], loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.items;
      this.items = await sshKeysApi.list();
      this.loaded = true;
      return this.items;
    },
    async create(input: SshKeyInput) {
      const key = await sshKeysApi.create(input);
      this.items.push(key);
      return key;
    },
    async update(id: number, input: SshKeyInput) {
      const key = await sshKeysApi.update(id, input);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = key;
      return key;
    },
    async remove(id: number) {
      await sshKeysApi.remove(id);
      this.items = this.items.filter((x) => x.id !== id);
    },
  },
});
