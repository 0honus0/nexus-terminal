import { defineStore } from 'pinia';
import { ref } from 'vue';
import { connectionsApi } from '../api/connectionsApi';
import type { ConnectionDto, ConnectionFormInput, ConnectionFormUpdate } from '../model/connection';

const DEFAULT_STALE_MS = 30_000;
export const useConnectionsStore = defineStore('connections', () => {
	const items = ref<ConnectionDto[]>([]);
	const loaded = ref(false);
	const loadedAt = ref(0);
	let loadPromise: Promise<ConnectionDto[]> | null = null;
	let cacheGeneration = 0;

	return {
		items,
		loaded,
		loadedAt,

		async load(force = false) {
			if (loaded.value && !force) return items.value;
			if (loadPromise) return loadPromise;
			const generation = cacheGeneration;
			const request = connectionsApi.list().then((incoming) => {
				if (generation !== cacheGeneration) return items.value;
				const currentById = new Map(items.value.map((item) => [item.id, item] as const));
				items.value = incoming.map((item) => {
					const current = currentById.get(item.id);
					if (!current || (current.lastConnectedAt ?? 0) <= (item.lastConnectedAt ?? 0)) return item;
					return {
						...item,
						lastConnectedAt: current.lastConnectedAt,
						updatedAt: Math.max(item.updatedAt, current.updatedAt),
					};
				});
				loaded.value = true;
				loadedAt.value = Date.now();
				return items.value;
			});
			loadPromise = request;
			try {
				return await request;
			} finally {
				if (loadPromise === request) loadPromise = null;
			}
		},

		async revalidate(maxAgeMs = DEFAULT_STALE_MS) {
			if (!loaded.value) return this.load();
			if (Date.now() - loadedAt.value < Math.max(0, maxAgeMs)) return items.value;
			return this.load(true);
		},

		reset() {
			cacheGeneration += 1;
			loadPromise = null;
			items.value = [];
			loaded.value = false;
			loadedAt.value = 0;
		},

		upsert(item: ConnectionDto) {
			const i = items.value.findIndex((x) => x.id === item.id);
			if (i >= 0) items.value[i] = item;
			else items.value.push(item);
			loadedAt.value = Date.now();
			return item;
		},

		async refresh(id: number) {
			const generation = cacheGeneration;
			const item = await connectionsApi.get(id);
			return generation === cacheGeneration ? this.upsert(item) : item;
		},

		markConnected(id: number, timestamp: number) {
			const i = items.value.findIndex((item) => item.id === id);
			if (i < 0 || !Number.isFinite(timestamp)) return null;
			const current = items.value[i]!;
			const next = {
				...current,
				lastConnectedAt: timestamp,
				updatedAt: Math.max(current.updatedAt, timestamp),
			};
			items.value[i] = next;
			loadedAt.value = Date.now();
			return next;
		},

		async create(input: ConnectionFormInput) {
			const generation = cacheGeneration;
			const item = await connectionsApi.create(input);
			return generation === cacheGeneration ? this.upsert(item) : item;
		},

		async update(id: number, input: ConnectionFormUpdate) {
			const generation = cacheGeneration;
			const item = await connectionsApi.update(id, input);
			return generation === cacheGeneration ? this.upsert(item) : item;
		},

		async remove(id: number) {
			const generation = cacheGeneration;
			await connectionsApi.remove(id);
			if (generation !== cacheGeneration) return;
			items.value = items.value.filter((x) => x.id !== id);
			loadedAt.value = Date.now();
		},

		async clone(id: number, name: string) {
			const generation = cacheGeneration;
			const item = await connectionsApi.clone(id, name);
			return generation === cacheGeneration ? this.upsert(item) : item;
		},
	};
});
