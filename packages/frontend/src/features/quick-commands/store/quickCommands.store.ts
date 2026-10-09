import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
import { quickCommandsApi } from '../api/quickCommandsApi';
import type {
	QuickCommandDto,
	QuickCommandGroup,
	QuickCommandFormInput,
	QuickCommandSort,
	QuickCommandTagDto,
} from '../model/quickCommand';
const expandedGroupsStorage = {
	namespace: 'quick-commands.expanded-groups',
	version: 1,
	codec: jsonStorageCodec<Record<string, boolean>>((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		const entries = Object.entries(value as Record<string, unknown>);
		if (!entries.every(([, expanded]) => typeof expanded === 'boolean')) return undefined;
		return Object.fromEntries(entries) as Record<string, boolean>;
	}),
	legacyKeys: ['quick-commands.expanded-groups'],
} as const;
export const useQuickCommandsStore = defineStore('quick-commands', () => {
	const items = ref<QuickCommandDto[]>([]),
		tags = ref<QuickCommandTagDto[]>([]),
		search = ref(''),
		sort = ref<QuickCommandSort>('name'),
		loading = ref(false),
		error = ref<string | null>(null),
		tagLoadError = ref<string | null>(null),
		selectedId = ref<number | null>(null);
	const expanded = ref<Record<string, boolean>>(readStoredValue(expandedGroupsStorage) ?? {});
	let generation = 0;

	function reset() {
		generation += 1;
		items.value = [];
		tags.value = [];
		search.value = '';
		sort.value = 'name';
		loading.value = false;
		error.value = null;
		tagLoadError.value = null;
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

	const compare = (a: QuickCommandDto, b: QuickCommandDto) =>
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
		if (untagged.length) result.push({ id: null, name: 'Untagged', commands: untagged });
		return result;
	});
	const visible = computed(() =>
		groups.value.flatMap((group) => (expanded.value[group.name] === false ? [] : group.commands)),
	);
	const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);

	watch([search, sort], () => {
		selectedId.value = null;
	});

	async function load() {
		const epoch = generation;
		loading.value = true;
		error.value = null;
		tagLoadError.value = null;
		try {
			const next = await quickCommandsApi.list();
			if (epoch !== generation) return;
			items.value = next;
			try {
				const nextTags = await quickCommandsApi.listTags();
				if (epoch === generation) tags.value = nextTags;
			} catch (cause) {
				if (epoch === generation) tagLoadError.value = cause instanceof Error ? cause.message : String(cause);
			}
		} catch (cause) {
			if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause);
			throw cause;
		} finally {
			if (epoch === generation) loading.value = false;
		}
	}

	async function save(input: QuickCommandFormInput, id?: number) {
		const epoch = generation;
		const item = id ? await quickCommandsApi.update(id, input) : await quickCommandsApi.create(input);
		if (epoch !== generation) return item;
		const i = items.value.findIndex((x) => x.id === item.id);
		if (i >= 0) items.value[i] = item;
		else items.value.push(item);
		error.value = null;
		return item;
	}

	async function remove(id: number) {
		const epoch = generation;
		await quickCommandsApi.remove(id);
		if (epoch !== generation) return;
		items.value = items.value.filter((x) => x.id !== id);
		error.value = null;
		if (selectedId.value === id) selectedId.value = null;
	}

	async function recordUsage(id: number) {
		const epoch = generation;
		try {
			const updated = await quickCommandsApi.incrementUsage(id);
			if (!updated || epoch !== generation) return;
			const index = items.value.findIndex((item) => item.id === id);
			if (index >= 0) items.value[index] = updated;
		} catch {
			// Usage accounting is auxiliary; a failed counter update must never block command execution.
		}
	}

	async function addTag(name: string) {
		const epoch = generation;
		const tag = await quickCommandsApi.createTag(name);
		if (epoch === generation) tags.value.push(tag);
		return tag;
	}

	async function removeTag(id: number) {
		const epoch = generation;
		await quickCommandsApi.removeTag(id);
		if (epoch !== generation) return;
		tags.value = tags.value.filter((tag) => tag.id !== id);
		items.value = items.value.map((item) =>
			item.tagIds.includes(id) ? { ...item, tagIds: item.tagIds.filter((tagId) => tagId !== id) } : item,
		);
	}

	async function renameTag(id: number, name: string) {
		const epoch = generation;
		const tag = tags.value.find((item) => item.id === id);
		if (!tag) throw new Error('Quick Command tag not found.');
		const oldName = tag.name;
		const updated = await quickCommandsApi.renameTag(id, name);
		if (epoch !== generation) return updated;
		const index = tags.value.findIndex((item) => item.id === id);
		if (index >= 0) tags.value[index] = updated;
		if (oldName !== updated.name && expanded.value[oldName] !== undefined) {
			const open = expanded.value[oldName];
			delete expanded.value[oldName];
			expanded.value[updated.name] = open;
			writeStoredValue(expandedGroupsStorage, expanded.value);
		}
		return updated;
	}

	async function createTagForCommands(name: string, commandIds: number[]) {
		const epoch = generation;
		const tag = await addTag(name);
		if (epoch !== generation) throw new DOMException('Session changed', 'AbortError');
		if (!commandIds.length) return { tag, assigned: true as const };
		try {
			await quickCommandsApi.assignTag(commandIds, tag.id);
			if (epoch !== generation) throw new DOMException('Session changed', 'AbortError');
			const idSet = new Set(commandIds);
			items.value = items.value.map((item) =>
				idSet.has(item.id) && !item.tagIds.includes(tag.id)
					? { ...item, tagIds: [...item.tagIds, tag.id] }
					: item,
			);
			if (expanded.value.Untagged !== undefined) {
				const open = expanded.value.Untagged;
				delete expanded.value.Untagged;
				expanded.value[tag.name] = open;
				writeStoredValue(expandedGroupsStorage, expanded.value);
			}
			return { tag, assigned: true as const };
		} catch (cause) {
			return { tag, assigned: false as const, error: cause instanceof Error ? cause.message : String(cause) };
		}
	}

	function toggle(name: string) {
		expanded.value[name] = !(expanded.value[name] ?? true);
		writeStoredValue(expandedGroupsStorage, expanded.value);
		selectedId.value = null;
	}

	function setSearch(value: string) {
		search.value = value;
	}

	function selectNext(grouped = true) {
		const candidates = grouped ? visible.value : flat.value;
		if (!candidates.length) {
			selectedId.value = null;
			return;
		}
		const current = candidates.findIndex((item) => item.id === selectedId.value);
		selectedId.value = candidates[(current + 1) % candidates.length]!.id;
	}

	function selectPrevious(grouped = true) {
		const candidates = grouped ? visible.value : flat.value;
		if (!candidates.length) {
			selectedId.value = null;
			return;
		}
		const current = candidates.findIndex((item) => item.id === selectedId.value);
		const index = current < 0 ? candidates.length - 1 : (current - 1 + candidates.length) % candidates.length;
		selectedId.value = candidates[index]!.id;
	}

	function resetSelection() {
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
		tagLoadError,
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
