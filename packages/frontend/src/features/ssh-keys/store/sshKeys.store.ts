import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { sshKeysApi } from '../api/sshKeysApi';
import type { SshKeyFormInput, SshKeySummaryDto } from '../model/sshKey';

const sortByName = (items: SshKeySummaryDto[]): SshKeySummaryDto[] =>
	items.sort((a, b) => a.name.localeCompare(b.name));

export const useSshKeysStore = defineStore('ssh-keys', {
	state: () => ({ items: [] as SshKeySummaryDto[], loaded: false, generation: 0 }),

	actions: {
		reset() {
			this.generation += 1;
			this.items = [];
			this.loaded = false;
		},

		async load(force = false) {
			if (this.loaded && !force) return this.items;
			const generation = this.generation;
			const items = sortByName(await sshKeysApi.list());
			if (generation !== this.generation) return this.items;
			this.items = items;
			this.loaded = true;
			return this.items;
		},

		async create(input: SshKeyFormInput) {
			const generation = this.generation;
			const key = await sshKeysApi.create(input);
			if (generation !== this.generation) return key;
			this.items.push(key);
			sortByName(this.items);
			return key;
		},

		async update(id: number, input: SshKeyFormInput) {
			const generation = this.generation;
			const key = await sshKeysApi.update(id, input);
			if (generation !== this.generation) return key;
			const i = this.items.findIndex((x) => x.id === id);
			if (i >= 0) this.items[i] = key;
			sortByName(this.items);
			return key;
		},

		async remove(id: number) {
			const generation = this.generation;
			await sshKeysApi.remove(id);
			if (generation !== this.generation) return;
			this.items = this.items.filter((x) => x.id !== id);
		},
	},
});

registerAuthenticatedSessionReset('ssh-keys-cache', () => useSshKeysStore().reset());
