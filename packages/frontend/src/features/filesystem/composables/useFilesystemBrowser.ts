import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type { FilesystemChannel } from '../ports/filesystem-channel';
import type { RemoteFileSearchEntry, RemoteFileEntry } from '../model/filesystem-types';
import { createDirectoryCache } from '../model/directory-cache';

export type FilesystemSortKey = 'name' | 'size' | 'permissions' | 'modified';

export type FilesystemSortDirection = 'asc' | 'desc';

export interface FilesystemBrowserController {
	path: Ref<string>;
	entries: Ref<RemoteFileEntry[]>;
	searchEntries: Ref<RemoteFileSearchEntry[]>;
	visible: ComputedRef<(RemoteFileEntry | RemoteFileSearchEntry)[]>;
	searchQuery: Ref<string>;
	searchActive: ComputedRef<boolean>;
	searching: Ref<boolean>;
	searchTruncated: Ref<boolean>;
	searchError: Ref<string | null>;
	loading: Ref<boolean>;
	loaded: Ref<boolean>;
	error: Ref<string | null>;
	selected: Ref<Set<string>>;
	selectionAnchor: Ref<string | null>;
	sortKey: Ref<FilesystemSortKey>;
	sortDirection: Ref<FilesystemSortDirection>;
	load(path?: string): Promise<boolean | undefined>;
	prefetch(path: string): void;
	cancelPrefetch(): void;
	refresh(): Promise<void>;
	open(entry: RemoteFileEntry): Promise<void>;
	goParent(): Promise<boolean | undefined>;
	search(): Promise<void>;
	scheduleSearch(delayMs?: number): void;
	clearSearch(): void;
	select(entry: RemoteFileEntry, mode?: 'only' | 'toggle' | 'range'): void;
	toggle(entry: RemoteFileEntry): void;
	selectAll(): void;
	clearSelection(): void;
	setSort(key: FilesystemSortKey): void;
	dispose(): void;
}

const parentPath = (path: string) => {
	const normalized = path.replace(/\/+$/, '') || '/';
	if (normalized === '/') return '/';
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
};

const entryName = (entry: RemoteFileEntry): string =>
	'relativePath' in entry && typeof entry.relativePath === 'string' ? entry.relativePath : entry.name;

const entryNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const compareEntryNames = (left: RemoteFileEntry, right: RemoteFileEntry): number =>
	entryNameCollator.compare(entryName(left), entryName(right));

const compare = (left: RemoteFileEntry, right: RemoteFileEntry, key: FilesystemSortKey): number => {
	let result: number;
	if (key === 'size') result = left.metadata.size - right.metadata.size;
	else if (key === 'permissions') result = left.metadata.mode - right.metadata.mode;
	else if (key === 'modified') result = left.metadata.modifiedAt - right.metadata.modifiedAt;
	else result = compareEntryNames(left, right);
	return result;
};

export function useFilesystemBrowser(channel: FilesystemChannel, initialPath = '/'): FilesystemBrowserController {
	const path = ref(initialPath);
	// Remote listings are replaced as snapshots; entries and metadata are not
	// edited in place. Avoid tracking every property read during full-list sorts.
	const entries = shallowRef<RemoteFileEntry[]>([]);
	const searchEntries = shallowRef<RemoteFileSearchEntry[]>([]);
	const searchQuery = ref('');
	const searching = ref(false);
	const searchTruncated = ref(false);
	const searchError = ref<string | null>(null);
	const loading = ref(false);
	const loaded = ref(false);
	const error = ref<string | null>(null);
	const selected = ref(new Set<string>());
	const selectionAnchor = ref<string | null>(null);
	const sortKey = ref<FilesystemSortKey>('name');
	const sortDirection = ref<FilesystemSortDirection>('asc');
	let searchTimer: number | undefined;
	let searchToken = 0;
	let loadToken = 0;
	let requestedPath = initialPath;
	let disposed = false;
	const directoryCache = createDirectoryCache(channel);
	let prefetchTimer: number | undefined;
	let prefetchTarget: string | undefined;
	let prefetchRunning = false;
	let prefetchRevision = 0;
	let rejectedPrefetchTarget: string | undefined;

	const cancelPrefetch = (): void => {
		prefetchRevision++;
		prefetchTarget = undefined;
		if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
		prefetchTimer = undefined;
	};

	const runPrefetch = (): void => {
		prefetchTimer = undefined;
		const target = prefetchTarget;
		if (disposed || !target || prefetchRunning || loading.value) return;
		prefetchTarget = undefined;
		if (directoryCache.get(target) || !directoryCache.canPrefetch()) return;
		const revision = prefetchRevision;
		prefetchRunning = true;
		void directoryCache
			.read(target)
			.catch(() => {
				if (!disposed && revision === prefetchRevision) rejectedPrefetchTarget = target;
			})
			.finally(() => {
				prefetchRunning = false;
				if (!disposed && prefetchTarget) prefetchTimer = window.setTimeout(runPrefetch, 100);
			});
	};

	const prefetch = (target: string): void => {
		if (disposed || target === path.value || target === rejectedPrefetchTarget || directoryCache.get(target))
			return;
		prefetchTarget = target;
		if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
		prefetchTimer = window.setTimeout(runPrefetch, 100);
	};

	const stopInvalidation = channel.onInvalidate((reason) => {
		directoryCache.invalidate();
		rejectedPrefetchTarget = undefined;
		cancelPrefetch();
		if (reason.type !== 'unavailable') return;
		loadToken++;
		searchToken++;
		if (searchTimer !== undefined) window.clearTimeout(searchTimer);
		searchTimer = undefined;
		loading.value = false;
		loaded.value = false;
		error.value = reason.code;
		entries.value = [];
		searchEntries.value = [];
		searching.value = false;
		searchTruncated.value = false;
		searchError.value = null;
		selected.value = new Set();
		selectionAnchor.value = null;
	});

	const searchActive = computed(() => Boolean(searchQuery.value.trim()));

	const visible = computed(() =>
		[...(searchActive.value ? searchEntries.value : entries.value)].sort((left, right) => {
			if (left.name === '..') return -1;
			if (right.name === '..') return 1;
			if (left.metadata.isDirectory !== right.metadata.isDirectory) return left.metadata.isDirectory ? -1 : 1;
			const result = compare(left, right, sortKey.value);
			if (result !== 0) return sortDirection.value === 'asc' ? result : -result;
			return compareEntryNames(left, right);
		}),
	);

	const clearSearchTimer = () => {
		if (searchTimer === undefined) return;
		window.clearTimeout(searchTimer);
		searchTimer = undefined;
	};

	const resetSearchResults = () => {
		searchEntries.value = [];
		searchTruncated.value = false;
		searchError.value = null;
	};

	const runSearch = async (query: string, root: string, token: number) => {
		try {
			const result = await channel.search(root, query);
			if (token !== searchToken || searchQuery.value.trim() !== query || path.value !== root) return;
			searchEntries.value = result.entries;
			searchTruncated.value = result.truncated;
		} catch (cause) {
			if (token !== searchToken) return;
			searchError.value = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (token === searchToken) searching.value = false;
		}
	};

	const scheduleSearch = (delayMs = 250) => {
		clearSearchTimer();
		const query = searchQuery.value.trim();
		if (!query) {
			searchToken += 1;
			searching.value = false;
			resetSearchResults();
			return;
		}
		const root = path.value;
		const token = ++searchToken;
		searching.value = true;
		resetSearchResults();
		searchTimer = window.setTimeout(() => {
			searchTimer = undefined;
			void runSearch(query, root, token);
		}, delayMs);
	};

	const loadDirectory = async (target: string, force = false): Promise<boolean | undefined> => {
		if (disposed) return undefined;
		cancelPrefetch();
		if (force) directoryCache.invalidate();
		const token = ++loadToken;
		requestedPath = target;
		const cached = directoryCache.get(target);
		loading.value = !cached;
		error.value = null;
		try {
			let listing = cached;
			while (!listing && token === loadToken && !disposed) listing = await directoryCache.read(target);
			if (token !== loadToken) return undefined;
			if (!listing || disposed) return undefined;
			path.value = listing.path;
			requestedPath = listing.path;
			entries.value = listing.entries;
			loaded.value = true;
			selected.value = new Set();
			selectionAnchor.value = null;
			if (searchActive.value) scheduleSearch();
			return true;
		} catch (cause) {
			if (token !== loadToken) return undefined;
			requestedPath = path.value;
			error.value = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			if (token === loadToken) loading.value = false;
		}
	};

	const load = (target?: string): Promise<boolean | undefined> =>
		loadDirectory(target ?? requestedPath, target === undefined);

	const refresh = async () => {
		// A transfer can finish while navigation is awaiting its listing.
		// Refresh that requested destination rather than restoring the old page.
		let candidate = requestedPath;
		while (true) {
			const result = await loadDirectory(candidate, true);
			if (result !== false || candidate === '/') return;
			candidate = parentPath(candidate);
		}
	};

	const open = async (entry: RemoteFileEntry) => {
		if (entry.metadata.isDirectory) await load(entry.path);
	};

	const goParent = () => load(parentPath(path.value));

	const search = async () => {
		const query = searchQuery.value.trim();
		clearSearchTimer();
		if (!query) {
			searchToken += 1;
			searching.value = false;
			resetSearchResults();
			return;
		}
		const root = path.value;
		const token = ++searchToken;
		searching.value = true;
		resetSearchResults();
		await runSearch(query, root, token);
	};

	const clearSearch = () => {
		searchQuery.value = '';
		searchToken += 1;
		clearSearchTimer();
		searching.value = false;
		resetSearchResults();
	};

	const select = (entry: RemoteFileEntry, mode: 'only' | 'toggle' | 'range' = 'only') => {
		if (mode === 'range' && selectionAnchor.value) {
			const anchorIndex = visible.value.findIndex((item) => item.path === selectionAnchor.value);
			const targetIndex = visible.value.findIndex((item) => item.path === entry.path);
			if (anchorIndex >= 0 && targetIndex >= 0) {
				const [start, end] =
					anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
				selected.value = new Set(visible.value.slice(start, end + 1).map((item) => item.path));
				selectionAnchor.value = entry.path;
				return;
			}
		}
		if (mode === 'toggle') {
			const next = new Set(selected.value);
			if (next.has(entry.path)) next.delete(entry.path);
			else next.add(entry.path);
			selected.value = next;
			selectionAnchor.value = entry.path;
			return;
		}
		selected.value = new Set([entry.path]);
		selectionAnchor.value = entry.path;
	};

	const toggle = (entry: RemoteFileEntry) => select(entry, 'toggle');

	const selectAll = () => {
		selected.value = new Set(visible.value.map((entry) => entry.path));
		selectionAnchor.value = visible.value.at(-1)?.path ?? null;
	};

	const clearSelection = () => {
		selected.value = new Set();
		selectionAnchor.value = null;
	};

	const setSort = (key: FilesystemSortKey) => {
		if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
		else {
			sortKey.value = key;
			sortDirection.value = 'asc';
		}
	};

	const stopSearchWatch = watch(searchQuery, () => {
		clearSelection();
		scheduleSearch();
	});

	const dispose = () => {
		disposed = true;
		stopInvalidation();
		cancelPrefetch();
		directoryCache.dispose();
		stopSearchWatch();
		clearSearchTimer();
		searchToken += 1;
		loadToken += 1;
	};

	return {
		path,
		entries,
		searchEntries,
		visible,
		searchQuery,
		searchActive,
		searching,
		searchTruncated,
		searchError,
		loading,
		loaded,
		error,
		selected,
		selectionAnchor,
		sortKey,
		sortDirection,
		load,
		prefetch,
		cancelPrefetch,
		refresh,
		open,
		goParent,
		search,
		scheduleSearch,
		clearSearch,
		select,
		toggle,
		selectAll,
		clearSelection,
		setSort,
		dispose,
	};
}
