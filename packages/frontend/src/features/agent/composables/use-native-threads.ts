import { ref } from 'vue';
import { AGENT_THREAD_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import type { NativeThreadApi } from '../api/native-thread-api';
import type { NativeThread, NativeThreadIntent, NativeThreadScope } from '../model/native-thread-types';
import { AgentManagementFailure } from '../model/management-failure';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function useNativeThreads(
	appId: string,
	api: NativeThreadApi,
	active: () => boolean,
	select: (value: NativeThread) => void,
) {
	const items = ref<NativeThread[]>([]);
	const scope = ref<NativeThreadScope | null>(null);
	const nextCursor = ref<string | null>(null);
	const title = ref('');
	const selected = ref<NativeThread | null>(null);
	const pending = ref<NativeThreadIntent | null>(null);
	const inspected = ref(false);

	function clearPrivate(): void {
		items.value = [];
		scope.value = null;
		nextCursor.value = null;
		title.value = '';
		selected.value = null;
		pending.value = null;
		inspected.value = false;
	}

	function handleAuthorityFailure(cause: unknown): void {
		if (
			cause instanceof AgentManagementFailure &&
			(cause.code === 'unauthenticated' || cause.code === 'forbidden')
		) {
			clearPrivate();
		}
	}

	const operation = useAgentManagementOperation((reason) => {
		const intent = pending.value;
		const draftTitle = title.value;
		const originalThread = selected.value;
		clearPrivate();
		if (reason === 'view') {
			pending.value = intent;
			title.value = draftTitle;
			selected.value = originalThread;
		}
	}, active);

	async function refresh(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const current = await api.scope(appId, signal);
				return { scope: current, page: await api.list(current, null, AGENT_THREAD_MAX_PAGE, signal) };
			},
			(result) => {
				scope.value = result.scope;
				items.value = result.page.items;
				nextCursor.value = result.page.nextCursor;
				inspected.value = pending.value !== null;
				// A list cannot prove that an earlier mutation failed to commit.
			},
			{
				write: false,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					scope.value = null;
					items.value = [];
					nextCursor.value = null;
					inspected.value = false;
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
				if (page.items.some((item) => items.value.some((existing) => existing.id === item.id))) {
					throw new AgentManagementFailure('protocol_failure', 'unknown');
				}
				items.value = [...items.value, ...page.items];
				nextCursor.value = page.nextCursor;
			},
			{
				write: false,

				onFailure: (cause) => {
					handleAuthorityFailure(cause);
					operation.refreshRequired.value = true;
				},
			},
		);
	}

	function choose(value: NativeThread): void {
		if (pending.value !== null || operation.busy.value) {
			return;
		}
		selected.value = value;
		title.value = value.title;
		select(value);
	}

	function newThread(): void {
		if (pending.value !== null || operation.busy.value) {
			return;
		}
		selected.value = null;
		title.value = '';
	}

	async function submit(retry = false): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value || !scope.value) {
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
				selected.value = value;
				title.value = value.title;
				select(value);
			},
			{
				write: true,
				refreshAfterSuccess: true,

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
		pending,
		inspected,
		refresh,
		loadMore,
		choose,
		newThread,
		submit,
		abandon,
	};
}
