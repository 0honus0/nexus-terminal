import { ref } from 'vue';
import { AGENT_THREAD_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import type { NativeThreadApi } from '../api/native-thread-api';
import type {
	NativeThread,
	NativeThreadDeleteIntent,
	NativeThreadIntent,
	NativeThreadScope,
} from '../model/native-thread-types';
import { AgentManagementFailure } from '../model/management-failure';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function useNativeThreads(
	appId: string,
	api: NativeThreadApi,
	active: () => boolean,
	select: (value: NativeThread | null) => void,
	removed: (threadId: string) => void,
) {
	const items = ref<NativeThread[]>([]);
	const observedThread = ref<NativeThread | null>(null);
	const scope = ref<NativeThreadScope | null>(null);
	const nextCursor = ref<string | null>(null);
	const title = ref('');
	const selected = ref<NativeThread | null>(null);
	const loaded = ref(false);
	const pending = ref<NativeThreadIntent | null>(null);
	const pendingDelete = ref<NativeThreadDeleteIntent | null>(null);
	const inspected = ref(false);
	const deleteInspected = ref(false);

	function clearPrivate(): void {
		items.value = [];
		observedThread.value = null;
		scope.value = null;
		nextCursor.value = null;
		title.value = '';
		selected.value = null;
		loaded.value = false;
		pending.value = null;
		pendingDelete.value = null;
		inspected.value = false;
		deleteInspected.value = false;
	}

	function handleAuthorityFailure(cause: unknown): void {
		if (
			cause instanceof AgentManagementFailure &&
			(cause.code === 'unauthenticated' || cause.code === 'forbidden')
		) {
			clearPrivate();
		}
	}

	const operation = useAgentManagementOperation(
		(reason) => {
			const intent = pending.value;
			const deleteIntent = pendingDelete.value;
			const draftTitle = title.value;
			const originalThread = selected.value;
			const keep = reason === 'view' && (intent !== null || deleteIntent !== null);
			clearPrivate();
			if (keep) {
				pending.value = intent;
				pendingDelete.value = deleteIntent;
				title.value = draftTitle;
				selected.value = originalThread;
			}
		},
		active,
		{ retainOnView: true, notifySuccess: false, notifyFailureDetails: true },
	);

	async function refresh(): Promise<void> {
		const background =
			loaded.value && pending.value === null && pendingDelete.value === null && !operation.refreshRequired.value;
		const lastLoadedId = items.value.reduce((last, item) => (item.id > last ? item.id : last), '');
		await operation.execute(
			async (signal) => {
				const current = await api.scope(appId, signal);
				let page = await api.list(current, null, AGENT_THREAD_MAX_PAGE, signal);
				const refreshed = [...page.items];
				// Revalidate the loaded range without dropping later pages when the Hub reopens.
				while (page.nextCursor !== null && page.nextCursor < lastLoadedId) {
					page = await api.list(current, page.nextCursor, AGENT_THREAD_MAX_PAGE, signal);
					refreshed.push(...page.items);
				}
				const deletedId = pendingDelete.value?.thread.id;
				let found = deletedId === undefined || refreshed.some((item) => item.id === deletedId);
				let after = page.nextCursor;
				// Absence from one page cannot confirm an unknown delete.
				while (!found && after !== null) {
					const next = await api.list(current, after, AGENT_THREAD_MAX_PAGE, signal);
					found = next.items.some((item) => item.id === deletedId);
					after = next.nextCursor;
				}
				return {
					scope: current,
					page: { items: refreshed, nextCursor: page.nextCursor },
					deletedThreadExists: found,
				};
			},
			(result) => {
				scope.value = result.scope;
				items.value = result.page.items.map((item) => {
					const observed = observedThread.value;
					const existing = items.value.find((value) => value.id === item.id);
					const current = existing && existing.version > item.version ? existing : item;
					return observed?.id === current.id && observed.version > current.version ? observed : current;
				});
				const updatedSelection = items.value.find((item) => item.id === selected.value?.id);
				if (updatedSelection) {
					acceptThread(updatedSelection);
				} else if (selected.value && pending.value === null && pendingDelete.value === null) {
					removed(selected.value.id);
					selected.value = null;
					title.value = '';
					if (items.value.length === 0) {
						select(null);
					}
				}
				nextCursor.value = result.page.nextCursor;
				loaded.value = true;
				inspected.value = pending.value !== null;
				if (
					pending.value === null &&
					pendingDelete.value === null &&
					selected.value === null &&
					items.value.length > 0
				) {
					const newest = items.value.reduce((latest, item) =>
						item.updatedAt > latest.updatedAt ? item : latest,
					);
					selected.value = newest;
					title.value = newest.title;
					select(newest);
				}
				if (pendingDelete.value) {
					deleteInspected.value = true;
					if (!result.deletedThreadExists) {
						const deletedId = pendingDelete.value.thread.id;
						pendingDelete.value = null;
						removed(deletedId);
						if (selected.value?.id === deletedId) {
							const replacement = items.value[0] ?? null;
							selected.value = replacement;
							title.value = replacement?.title ?? '';
							select(replacement);
						}
					}
				}
				// A list cannot prove that an earlier mutation failed to commit.
			},
			{
				write: false,
				background,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					inspected.value = false;
					deleteInspected.value = false;
					operation.refreshRequired.value = true;
				},
			},
		);
	}

	async function loadMore(): Promise<void> {
		const current = scope.value;
		const after = nextCursor.value;
		if (!current || after === null || operation.refreshRequired.value) {
			return;
		}
		await operation.execute(
			(signal) => api.list(current, after, AGENT_THREAD_MAX_PAGE, signal),
			(page) => {
				// Confirmed local creations can already belong to a not-yet-loaded page.
				const merged = new Map(items.value.map((item) => [item.id, item]));
				for (const item of page.items) {
					const previous = merged.get(item.id);
					if (!previous || item.version > previous.version) {
						merged.set(item.id, item);
					}
				}
				items.value = [...merged.values()];
				nextCursor.value = page.nextCursor;
			},
			{
				write: false,
				background: true,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					operation.refreshRequired.value = true;
				},
			},
		);
	}

	function acceptThread(value: NativeThread): void {
		if (value.appId !== appId) return;
		if (observedThread.value?.id !== value.id || value.version > observedThread.value.version)
			observedThread.value = value;
		items.value = items.value.map((item) => (item.id === value.id && value.version > item.version ? value : item));
		const current = selected.value;
		if (current?.id !== value.id || value.version <= current.version) return;
		// Keep an in-flight mutation's original CAS and any unsent manual title draft.
		if (pending.value !== null || pendingDelete.value !== null) return;
		if (title.value === current.title) title.value = value.title;
		selected.value = value;
	}

	function choose(value: NativeThread): void {
		if (pending.value !== null || pendingDelete.value !== null || operation.busy.value) {
			return;
		}
		if (selected.value?.id === value.id) {
			return;
		}
		selected.value = value;
		title.value = value.title;
		select(value);
	}

	function newThread(): void {
		if (pending.value !== null || pendingDelete.value !== null || operation.busy.value) {
			return;
		}
		selected.value = null;
		title.value = '';
	}

	function replacementFor(value: NativeThread): NativeThread | null {
		const ordered = items.value.slice().sort((left, right) => right.updatedAt - left.updatedAt);
		const index = ordered.findIndex((item) => item.id === value.id);
		return ordered[index + 1] ?? ordered[index - 1] ?? null;
	}

	async function executeDelete(intent: NativeThreadDeleteIntent, retry: boolean): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value) {
			return;
		}
		if (!retry) {
			pendingDelete.value = intent;
			deleteInspected.value = false;
		}
		if (!pendingDelete.value || (retry && !deleteInspected.value)) {
			return;
		}
		const current = pendingDelete.value;
		const wasSelected = selected.value?.id === current.thread.id;
		const replacement = wasSelected ? replacementFor(current.thread) : null;
		deleteInspected.value = false;
		await operation.execute(
			(signal) => api.remove(current, signal),
			(result) => {
				pendingDelete.value = null;
				deleteInspected.value = true;
				items.value = items.value.filter((item) => item.id !== result.threadId);
				removed(result.threadId);
				if (wasSelected) {
					selected.value = replacement;
					title.value = replacement?.title ?? '';
					select(replacement);
				}
			},
			{
				write: true,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					if (cause instanceof AgentManagementFailure && cause.code === 'active_run_conflict') {
						operation.notice.value = 'deleteThreadActive';
					}
					if (!retry && cause instanceof AgentManagementFailure && cause.outcome !== 'unknown') {
						pendingDelete.value = null;
					}
				},
			},
		);
	}

	async function remove(value: NativeThread): Promise<void> {
		if (operation.busy.value || pending.value !== null || pendingDelete.value !== null || !scope.value) {
			return;
		}
		await executeDelete(
			{
				scope: { appId: scope.value.appId, appVersion: scope.value.appVersion },
				thread: {
					id: value.id,
					appId: value.appId,
					title: value.title,
					version: value.version,
					createdAt: value.createdAt,
					updatedAt: value.updatedAt,
				},
			},
			false,
		);
	}

	async function retryDelete(): Promise<void> {
		if (!pendingDelete.value || !deleteInspected.value) {
			return;
		}
		await executeDelete(pendingDelete.value, true);
	}

	function abandonDelete(): void {
		if (operation.busy.value || !pendingDelete.value || !deleteInspected.value) {
			return;
		}
		pendingDelete.value = null;
		deleteInspected.value = false;
		operation.refreshRequired.value = true;
	}

	async function submit(retry = false, autoTitle = false): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value || pendingDelete.value !== null || !scope.value) {
			return;
		}
		if (pending.value !== null && (!retry || !inspected.value)) {
			return;
		}
		if (pending.value === null) {
			const current = scope.value;
			pending.value =
				selected.value === null
					? {
							kind: 'create',
							autoTitle,
							scope: { appId: current.appId, appVersion: current.appVersion },
							operationId: crypto.randomUUID(),
							title: title.value,
						}
					: {
							kind: 'rename',
							scope: { appId: current.appId, appVersion: current.appVersion },
							operationId: crypto.randomUUID(),
							title: title.value,
							thread: {
								id: selected.value.id,
								appId: selected.value.appId,
								title: selected.value.title,
								version: selected.value.version,
								createdAt: selected.value.createdAt,
								updatedAt: selected.value.updatedAt,
							},
						};
		}
		const intent = pending.value;
		inspected.value = false;
		await operation.execute(
			(signal) => api.mutate(intent, signal),
			(value) => {
				pending.value = null;
				const previous = items.value.find((item) => item.id === value.id);
				const observed = observedThread.value?.id === value.id ? observedThread.value : null;
				const confirmed = previous && previous.version > value.version ? previous : value;
				const latest = observed && observed.version > confirmed.version ? observed : confirmed;
				if (!previous) {
					items.value = [latest, ...items.value];
				} else {
					items.value = items.value.map((item) => (item.id === value.id ? latest : item));
				}
				selected.value = latest;
				title.value = latest.title;
				select(latest);
			},
			{
				write: true,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					if (!retry && cause instanceof AgentManagementFailure && cause.outcome !== 'unknown') {
						pending.value = null;
					}
				},
			},
		);
	}

	function abandon(): void {
		if (operation.busy.value || !inspected.value) {
			return;
		}
		pending.value = null;
		inspected.value = false;
		selected.value = null;
		title.value = '';
		operation.refreshRequired.value = true;
	}

	return {
		...operation,
		items,
		nextCursor,
		title,
		selected,
		loaded,
		pending,
		pendingDelete,
		inspected,
		deleteInspected,
		refresh,
		loadMore,
		acceptThread,
		choose,
		newThread,
		submit,
		remove,
		retryDelete,
		abandonDelete,
		abandon,
	};
}
