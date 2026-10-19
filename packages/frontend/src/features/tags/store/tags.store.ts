import { defineStore } from 'pinia';
import { ref } from 'vue';
import { targetArray } from '@nexus-terminal/shared/targets/http';
import { readTagCreateRequest } from '@nexus-terminal/shared/targets/tags/http-codec';
import { TARGET_CONNECTION_MAX_TAGS } from '@nexus-terminal/shared/targets/connections/values';
import { resetConnectionsCache } from '@/features/connections/public';
import { toTagCreate } from '../model/tag-mapper';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { TargetRequestFailure } from '@/client/targets/target-types';
import { tagsApi } from '../api/tags-api';
import type { TagSummary } from '../model/tag-types';
import { TagEnsureFailure } from '../model/tag-errors';

export const useTagsStore = defineStore('connection-tags', () => {
	const items = ref<TagSummary[]>([]);
	const loaded = ref(false);
	const busy = ref(false);
	const needsRefresh = ref(true);
	let generation = 0;
	let loadedAt = 0;
	let revision = 0;
	let session = new AbortController();
	let read: AbortController | null = null;
	let loadPromise: Promise<TagSummary[]> | null = null;

	function reset(): void {
		generation += 1;
		revision += 1;
		session.abort();
		read?.abort();
		session = new AbortController();
		read = null;
		loadPromise = null;
		items.value = [];
		loaded.value = false;
		loadedAt = 0;
		busy.value = false;
		needsRefresh.value = true;
	}

	async function load(force = false): Promise<TagSummary[]> {
		if (busy.value) {
			throw new TargetRequestFailure('request_pending', 'not_dispatched');
		}
		if (loadPromise) {
			return loadPromise;
		}
		if (loaded.value && !needsRefresh.value && !force) {
			return items.value;
		}
		const current = generation;
		const snapshot = revision;
		const controller = new AbortController();
		read = controller;
		const request = tagsApi.list(AbortSignal.any([session.signal, controller.signal])).then((incoming) => {
			if (current !== generation || snapshot !== revision || controller.signal.aborted) {
				throw new TargetRequestFailure('cancelled', 'confirmed');
			}
			items.value = incoming.sort((a, b) => a.name.localeCompare(b.name));
			loaded.value = true;
			loadedAt = Date.now();
			needsRefresh.value = false;
			return items.value;
		});
		loadPromise = request;
		try {
			return await request;
		} catch (cause) {
			if (current === generation && snapshot === revision) {
				needsRefresh.value = true;
			}
			throw cause;
		} finally {
			if (loadPromise === request) {
				loadPromise = null;
				read = null;
			}
		}
	}

	async function mutate<T>(
		work: (signal: AbortSignal) => Promise<T>,
		publish: (result: T) => void,
		signal?: AbortSignal,
	): Promise<T> {
		if (busy.value || needsRefresh.value) {
			throw new TargetRequestFailure(busy.value ? 'request_pending' : 'recovery_required', 'not_dispatched');
		}
		const current = generation;
		revision += 1;
		read?.abort();
		read = null;
		loadPromise = null;
		busy.value = true;
		const scope = signal ? AbortSignal.any([session.signal, signal]) : session.signal;
		try {
			const result = await work(scope);
			if (current !== generation || scope.aborted) {
				throw new TargetRequestFailure('cancelled', 'unknown');
			}
			publish(result);
			return result;
		} catch (cause) {
			if (
				current === generation &&
				(cause instanceof TagEnsureFailure ||
					!(cause instanceof TargetRequestFailure) ||
					cause.outcome === 'unknown' ||
					['version_conflict', 'conflict', 'not_found', 'unauthenticated', 'forbidden'].includes(cause.code))
			) {
				needsRefresh.value = true;
			}
			throw cause;
		} finally {
			if (current === generation) {
				busy.value = false;
			}
		}
	}

	function save(item: TagSummary): void {
		items.value = items.value
			.filter((existing) => existing.id !== item.id)
			.concat(item)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	function create(name: string, signal?: AbortSignal): Promise<TagSummary> {
		return mutate((scope) => tagsApi.create(name, scope), save, signal);
	}

	function rename(snapshot: TagSummary, name: string, signal?: AbortSignal): Promise<TagSummary> {
		return mutate((scope) => tagsApi.rename(snapshot, name, scope), save, signal);
	}

	async function changeRelations(
		work: (signal: AbortSignal) => Promise<void>,
		publish: () => void,
		signal?: AbortSignal,
	): Promise<void> {
		return mutate(
			async (scope) => {
				const current = generation;
				resetConnectionsCache();
				try {
					await work(scope);
				} finally {
					if (current === generation) {
						resetConnectionsCache();
					}
				}
			},
			publish,
			signal,
		);
	}

	function remove(id: number, signal?: AbortSignal): Promise<void> {
		return changeRelations(
			(scope) => tagsApi.remove(id, scope),
			() => {
				items.value = items.value.filter((item) => item.id !== id);
			},
			signal,
		);
	}

	function setConnections(id: number, connectionIds: number[], signal?: AbortSignal): Promise<void> {
		return changeRelations(
			(scope) => tagsApi.setConnections(id, connectionIds, scope),
			() => {},
			signal,
		);
	}

	async function ensure(names: string[], signal?: AbortSignal): Promise<TagSummary[]> {
		const normalized = [
			...new Set(
				targetArray(
					names,
					(name) => {
						const input = readTagCreateRequest({ name });
						return readTagCreateRequest(toTagCreate(input.name)).name;
					},
					TARGET_CONNECTION_MAX_TAGS,
				),
			),
		];
		if (normalized.length === 0) {
			return [];
		}
		if (!loaded.value) {
			await load();
		}
		return mutate(
			async (scope) => {
				const result: TagSummary[] = [];
				let completed = 0;
				try {
					for (const name of normalized) {
						if (scope.aborted) {
							throw new TargetRequestFailure('cancelled', 'not_dispatched');
						}
						const existing = items.value.find((item) => item.name === name);
						if (existing) {
							result.push(existing);
							continue;
						}
						const tag = await tagsApi.create(name, scope);
						if (scope.aborted) {
							throw new TargetRequestFailure('cancelled', 'unknown');
						}
						save(tag);
						completed += 1;
						result.push(tag);
					}
					return result;
				} catch (cause) {
					if (completed > 0) {
						throw new TagEnsureFailure(completed, cause);
					}
					throw cause;
				}
			},
			() => {},
			signal,
		);
	}

	function revalidate(maxAgeMs = 60_000): Promise<TagSummary[]> {
		return load(Date.now() - loadedAt >= Math.max(0, maxAgeMs));
	}

	return {
		items,
		loaded,
		busy,
		needsRefresh,
		reset,
		load,
		revalidate,
		create,
		rename,
		remove,
		setConnections,
		ensure,
	};
});

registerAuthenticatedSessionReset('connection-tags-cache', () => useTagsStore().reset());
