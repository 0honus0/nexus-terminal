import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { COMMAND_BATCH_MAX_ENTRIES } from '@nexus-terminal/shared/preferences/commands/values';
import { quickCommandsApi } from '../api/quick-commands-api';
import type {
	QuickCommandSummary,
	QuickCommandGroup,
	QuickCommandFormInput,
	QuickCommandSort,
	QuickCommandTagSummary,
	QuickCommandTagAssignment,
} from '../model/quick-command-types';
const expandedGroupsStorage = {
	namespace: 'quick-commands.expanded-groups',
	version: 1,
	codec: jsonStorageCodec<Record<string, boolean>>((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return undefined;
		}
		const entries = Object.entries(value as Record<string, unknown>);
		if (!entries.every(([, expanded]) => typeof expanded === 'boolean')) {
			return undefined;
		}
		return Object.fromEntries(entries) as Record<string, boolean>;
	}),
} as const;

export const useQuickCommandsStore = defineStore('quick-commands', () => {
	const items = ref<QuickCommandSummary[]>([]),
		tags = ref<QuickCommandTagSummary[]>([]),
		search = ref(''),
		sort = ref<QuickCommandSort>('name'),
		loading = ref(false),
		error = shallowRef<unknown>(null),
		selectedId = ref<number | null>(null);
	const expanded = ref<Record<string, boolean>>(readStoredValue(expandedGroupsStorage) ?? {});
	let scope = new AbortController();
	let queue: Promise<unknown> = Promise.resolve();
	let blocked = false;
	let recoveryRevision = 0;

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		queue = Promise.resolve();
		blocked = false;
		recoveryRevision += 1;
		items.value = [];
		tags.value = [];
		search.value = '';
		sort.value = 'name';
		loading.value = false;
		error.value = null;
		selectedId.value = null;
		expanded.value = {};
	}

	const filtered = computed(() => {
		const term = search.value.trim().toLowerCase();
		return items.value.filter(
			(x) =>
				!term ||
				`${x.name ?? ''} ${x.command} ${x.tagIds.map((id) => tags.value.find((t) => t.id === id)?.name ?? '').join(' ')}`
					.toLowerCase()
					.includes(term),
		);
	});

	const compare = (a: QuickCommandSummary, b: QuickCommandSummary) =>
		sort.value === 'usageCount'
			? b.usageCount - a.usageCount
			: sort.value === 'lastUsed'
				? b.updatedAt - a.updatedAt
				: (a.name ?? a.command).localeCompare(b.name ?? b.command);

	const flat = computed(() => [...filtered.value].sort(compare));
	const groups = computed<QuickCommandGroup[]>(() => {
		const result: QuickCommandGroup[] = tags.value
			.map((tag) => ({
				id: tag.id,
				name: tag.name,
				commands: filtered.value.filter((x) => x.tagIds.includes(tag.id)).sort(compare),
			}))
			.filter((g) => g.commands.length);
		const untagged = filtered.value
			.filter((x) => !x.tagIds.some((id) => tags.value.some((t) => t.id === id)))
			.sort(compare);
		if (untagged.length) {
			result.push({ id: null, name: 'Untagged', commands: untagged });
		}
		return result;
	});
	const visible = computed(() =>
		groups.value.flatMap((group) => (expanded.value[group.name] === false ? [] : group.commands)),
	);
	const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);

	watch([search, sort], () => {
		selectedId.value = null;
	});

	function enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const signal = scope.signal;
		const task = queue.then(() => {
			if (signal.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			return operation(signal);
		});
		queue = task.catch(() => undefined);
		return task;
	}

	async function readCurrent(signal: AbortSignal): Promise<void> {
		const [commands, catalog] = await Promise.allSettled([
			quickCommandsApi.list(signal),
			quickCommandsApi.listTags(signal),
		]);
		if (signal.aborted) {
			return;
		}
		if (commands.status === 'fulfilled') {
			items.value = commands.value;
		}
		// Commands remain executable without a tag catalog; stale labels must not imply current associations.
		tags.value = catalog.status === 'fulfilled' ? catalog.value : [];
		const failures = [commands, catalog].flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Quick command reads failed');
		}
	}

	function load(recover = false): Promise<void> {
		const revision = recoveryRevision;
		return enqueue(async (signal) => {
			loading.value = true;
			if (!blocked) {
				error.value = null;
			}
			try {
				await readCurrent(signal);
				if (recover && !signal.aborted && revision === recoveryRevision) {
					blocked = false;
					error.value = null;
				}
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					blocked = true;
					recoveryRevision += 1;
				}
				throw cause;
			} finally {
				if (!signal.aborted) {
					loading.value = false;
				}
			}
		});
	}

	function mutate<T>(operation: (signal: AbortSignal) => Promise<T>, permission?: AbortSignal): Promise<T> {
		return enqueue(async (signal) => {
			if (permission?.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			if (blocked) {
				throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			}
			try {
				return await operation(signal);
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					if (
						cause instanceof PreferenceRequestFailure &&
						(cause.outcome === 'unknown' || cause.code === 'version_conflict' || cause.code === 'not_found')
					) {
						blocked = true;
						recoveryRevision += 1;
					}
				}
				throw cause;
			}
		});
	}

	function save(
		input: QuickCommandFormInput,
		original?: QuickCommandSummary,
		permission?: AbortSignal,
	): Promise<QuickCommandSummary> {
		return mutate(async (signal) => {
			const item = original
				? await quickCommandsApi.update(original, input, signal)
				: await quickCommandsApi.create(input, signal);
			if (!signal.aborted) {
				const index = items.value.findIndex((value) => value.id === item.id);
				if (index < 0) {
					items.value.push(item);
				} else {
					items.value[index] = item;
				}
				error.value = null;
			}
			return item;
		}, permission);
	}

	function remove(original: QuickCommandSummary, permission?: AbortSignal): Promise<void> {
		return mutate(async (signal) => {
			await quickCommandsApi.remove(original, signal);
			if (signal.aborted) {
				return;
			}
			items.value = items.value.filter((value) => value.id !== original.id);
			if (selectedId.value === original.id) {
				selectedId.value = null;
			}
			error.value = null;
		}, permission);
	}

	async function recordUsage(id: number): Promise<void> {
		const original = items.value.find((value) => value.id === id);
		if (!original) {
			return;
		}
		try {
			await mutate(async (signal) => {
				const updated = await quickCommandsApi.incrementUsage(original, signal);
				if (signal.aborted) {
					return;
				}
				const index = items.value.findIndex((value) => value.id === id);
				if (index >= 0) {
					items.value[index] = updated;
				}
			});
		} catch {
			/* mutate retains the failure and recovery fence; command execution stays independent. */
		}
	}

	function addTag(name: string, permission?: AbortSignal): Promise<QuickCommandTagSummary> {
		return mutate(async (signal) => {
			const tag = await quickCommandsApi.createTag(name, signal);
			if (!signal.aborted) {
				tags.value.push(tag);
			}
			return tag;
		}, permission);
	}

	async function refreshAfterAssociation(signal: AbortSignal): Promise<void> {
		if (signal.aborted) {
			return;
		}
		blocked = true;
		recoveryRevision += 1;
		try {
			await readCurrent(signal);
			if (!signal.aborted) {
				blocked = false;
				error.value = null;
			}
		} catch (cause) {
			if (!signal.aborted) {
				error.value = cause;
			}
		}
	}

	function removeTag(original: QuickCommandTagSummary, permission?: AbortSignal): Promise<void> {
		return mutate(async (signal) => {
			await quickCommandsApi.removeTag(original, signal);
			// Association changes advance command versions. Re-read instead of guessing them locally.
			await refreshAfterAssociation(signal);
		}, permission);
	}

	function renameTag(
		original: QuickCommandTagSummary,
		name: string,
		permission?: AbortSignal,
	): Promise<QuickCommandTagSummary> {
		return mutate(async (signal) => {
			const updated = await quickCommandsApi.renameTag(original, name, signal);
			if (signal.aborted) {
				return updated;
			}
			const index = tags.value.findIndex((value) => value.id === original.id);
			if (index >= 0) {
				tags.value[index] = updated;
			}
			if (original.name !== updated.name && expanded.value[original.name] !== undefined) {
				const open = expanded.value[original.name];
				delete expanded.value[original.name];
				if (open !== undefined) {
					expanded.value[updated.name] = open;
				}
				writeStoredValue(expandedGroupsStorage, expanded.value);
			}
			return updated;
		}, permission);
	}

	async function createTagForCommands(
		name: string,
		commands: QuickCommandSummary[],
		permission?: AbortSignal,
	): Promise<QuickCommandTagAssignment> {
		if (
			commands.length > COMMAND_BATCH_MAX_ENTRIES ||
			new Set(commands.map((value) => value.id)).size !== commands.length
		) {
			throw new PreferenceRequestFailure('invalid_input', 'not_dispatched');
		}
		const signal = scope.signal;
		const tag = await addTag(name, permission);
		if (signal.aborted) {
			throw new PreferenceRequestFailure('cancelled', 'unknown');
		}
		if (!commands.length) {
			return { tag, assigned: true };
		}
		try {
			await mutate(async (current) => {
				if (current !== signal) {
					throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
				}
				await quickCommandsApi.assignTag(commands, tag.id, current);
				await refreshAfterAssociation(current);
			}, permission);
			return { tag, assigned: true };
		} catch (cause) {
			return { tag, assigned: false, error: cause };
		}
	}

	function toggle(name: string): void {
		expanded.value[name] = !(expanded.value[name] ?? true);
		writeStoredValue(expandedGroupsStorage, expanded.value);
		selectedId.value = null;
	}

	function setSearch(value: string): void {
		search.value = value;
	}

	function selectNext(grouped = true): void {
		const candidates = grouped ? visible.value : flat.value;
		if (!candidates.length) {
			selectedId.value = null;
			return;
		}
		const current = candidates.findIndex((item) => item.id === selectedId.value);
		selectedId.value = candidates[(current + 1) % candidates.length]!.id;
	}

	function selectPrevious(grouped = true): void {
		const candidates = grouped ? visible.value : flat.value;
		if (!candidates.length) {
			selectedId.value = null;
			return;
		}
		const current = candidates.findIndex((item) => item.id === selectedId.value);
		const index = current < 0 ? candidates.length - 1 : (current - 1 + candidates.length) % candidates.length;
		selectedId.value = candidates[index]!.id;
	}

	function resetSelection(): void {
		selectedId.value = null;
	}

	return {
		reset,
		items,
		tags,
		search,
		sort,
		loading,
		error,
		expanded,
		flat,
		groups,
		visible,
		selectedId,
		selected,
		load,
		save,
		remove,
		recordUsage,
		addTag,
		removeTag,
		renameTag,
		createTagForCommands,
		toggle,
		setSearch,
		selectNext,
		selectPrevious,
		resetSelection,
	};
});

registerAuthenticatedSessionReset('quick-commands-cache', () => useQuickCommandsStore().reset());
