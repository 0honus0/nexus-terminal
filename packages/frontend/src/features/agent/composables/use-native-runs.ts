import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
import { createNativeThreadApi } from '../api/native-thread-api';
import { getAgentDenylist } from '../api/app-management-api';
import {
	listNativeModels,
	listNativeRuns,
	getNativeRun,
	listNativeEntries,
	listNativeEvents,
	listNativeChildren,
	listNativeApprovals,
	listNativeMessages,
	mutateNativeRun,
} from '../api/native-run-api';
import { useAgentManagementOperation } from './use-agent-management-operation';
import type { NativeArtifactReference } from '../model/native-input-types';
import { AgentManagementFailure } from '../model/management-failure';
import type { NativeThread, NativeThreadScope } from '../model/native-thread-types';
import type {
	NativeModel,
	NativeRun,
	NativeEntry,
	NativeEntryCursor,
	NativeEvent,
	NativeChild,
	NativeMessage,
	NativeApproval,
	NativeRunIntent,
	NativeRunAction,
	NativeRunInput,
} from '../model/native-run-types';
import { snapshotNativeRunAction } from '../model/native-run-mapper';
import { compareNativeEntryCursor, isNativeRunActive, nativeModelKey } from '../model/native-run-rules';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';

/** One native surface owns its requests and explicit mutation intention; no singleton Run store. */
export function useNativeRuns(
	appId: string,
	active: () => boolean,
	threadBusy: () => boolean,
	canStart: () => boolean,
) {
	const capabilities = useRuntimeFeatureCapabilities();
	const threadApi = createNativeThreadApi();
	const scope = ref<NativeThreadScope | null>(null);
	const thread = ref<NativeThread | null>(null);
	const models = ref<NativeModel[]>([]);
	const modelKey = ref('');
	const connectionIds = ref<number[]>([]);
	const deniedIds = ref<number[] | null>(null);
	const draft = ref('');
	const inputArtifacts = ref<NativeArtifactReference[]>([]);
	const attachmentsReady = ref(true);
	const runs = ref<NativeRun[]>([]);
	const runCursor = ref(0);
	const hasMoreRuns = ref(false);
	const run = ref<NativeRun | null>(null);
	const entries = ref<NativeEntry[]>([]);
	const entryCursor = ref<NativeEntryCursor>({ runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 });
	const events = ref<NativeEvent[]>([]);
	const eventCursor = ref(0);
	const approvals = ref<NativeApproval[]>([]);
	const children = ref<NativeChild[]>([]);
	const child = ref<NativeChild | null>(null);
	const messages = ref<NativeMessage[]>([]);
	const messageCursor = ref(0);
	const pending = ref<NativeRunIntent | null>(null);
	const inspected = ref(false);
	const acknowledged = ref(false);
	const olderHidden = ref(false);
	const feedback = ref('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	function stopPolling(): void {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function clearRun(): void {
		run.value = null;
		events.value = [];
		eventCursor.value = 0;
		approvals.value = [];
		children.value = [];
		child.value = null;
		messages.value = [];
		messageCursor.value = 0;
		feedback.value = '';
	}

	function clearPrivate(): void {
		stopPolling();
		scope.value = null;
		thread.value = null;
		models.value = [];
		modelKey.value = '';
		connectionIds.value = [];
		deniedIds.value = null;
		draft.value = '';
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		runs.value = [];
		runCursor.value = 0;
		hasMoreRuns.value = false;
		entries.value = [];
		entryCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		pending.value = null;
		inspected.value = false;
		acknowledged.value = false;
		olderHidden.value = false;
		clearRun();
	}

	const operation = useAgentManagementOperation((reason) => {
		const originalDraft = draft.value;
		const intent = pending.value;
		const originalThread = thread.value;
		const originalRun = run.value;
		const keep = reason === 'view' && (intent !== null || !attachmentsReady.value || threadBusy());
		clearPrivate();
		if (reason === 'view') {
			draft.value = originalDraft;
		}
		if (keep) {
			pending.value = intent;
			thread.value = originalThread;
			run.value = originalRun;
		}
	}, active);
	const connections = computed(() =>
		deniedIds.value === null
			? []
			: capabilities.connections.items.value.filter(
					(item) => item.type === 'SSH' && !deniedIds.value?.includes(item.id),
				),
	);
	const blocked = computed(
		() =>
			operation.busy.value ||
			threadBusy() ||
			operation.refreshRequired.value ||
			pending.value !== null ||
			scope.value === null,
	);

	function fail(cause: unknown): void {
		stopPolling();
		operation.refreshRequired.value = true;
		if (cause instanceof AgentManagementFailure && (cause.code === 'unauthenticated' || cause.code === 'forbidden'))
			clearPrivate();
	}

	async function readScope(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const current = await threadApi.scope(appId, signal);
				const [availableModels, denylist] = await Promise.all([
					listNativeModels(current, signal),
					getAgentDenylist(signal),
					capabilities.connections.revalidate(),
				]);
				return { current, availableModels, denylist };
			},
			(value) => {
				scope.value = value.current;
				models.value = value.availableModels;
				deniedIds.value = value.denylist.entries.map((item) => item.connectionId);
				// Never replace an original selected model/configuration after an edit or failure.
				if (!modelKey.value && value.availableModels[0])
					modelKey.value = nativeModelKey(value.availableModels[0]);
				inspected.value = false;
			},
			{ write: false, onFailure: fail },
		);
	}

	function acceptEntries(page: { items: NativeEntry[]; nextCursor: NativeEntryCursor }): void {
		if (
			page.items.some((item) =>
				entries.value.some((existing) => compareNativeEntryCursor(existing.position, item.position) === 0),
			)
		)
			throw new AgentManagementFailure('protocol_failure', 'unknown');
		const combined = [...entries.value, ...page.items];
		// This is a local display window, never a protocol or durable-content limit.
		let characters = combined.reduce((total, item) => total + item.text.length, 0);
		while (combined.length > 1 && (combined.length > 128 || characters > 256 * 1024)) {
			const first = combined.shift();
			if (first) characters -= first.text.length;
			olderHidden.value = true;
		}
		entries.value = combined;
		entryCursor.value = page.nextCursor;
	}

	async function selectThread(value: NativeThread): Promise<void> {
		if (operation.busy.value || pending.value !== null || !attachmentsReady.value) return;
		stopPolling();
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		thread.value = {
			id: value.id,
			appId: value.appId,
			title: value.title,
			version: value.version,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
		};
		runs.value = [];
		entries.value = [];
		entryCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		olderHidden.value = false;
		clearRun();
		await refreshThread();
		const latest = runs.value.at(-1);
		if (!run.value && latest) await selectRun(latest);
	}

	function clearThread(): void {
		if (operation.busy.value || pending.value !== null) return;
		stopPolling();
		thread.value = null;
		runs.value = [];
		runCursor.value = 0;
		hasMoreRuns.value = false;
		entries.value = [];
		entryCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		olderHidden.value = false;
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		clearRun();
	}

	async function refreshThread(more = false): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (!current || !selected) return;
		const after = more ? runCursor.value : 0;
		await operation.execute(
			async (signal) => {
				const [page, body] = await Promise.all([
					listNativeRuns(current, selected.id, after, signal),
					listNativeEntries(current, selected.id, entryCursor.value, signal),
				]);
				return { page, body };
			},
			(result) => {
				runs.value = result.page.items;
				runCursor.value = result.page.nextCursor;
				hasMoreRuns.value = result.page.items.length === AGENT_RUN_EVENT_MAX_LIMIT;
				acceptEntries(result.body);
				inspected.value = pending.value !== null;
			},
			{ write: false, onFailure: fail },
		);
	}

	async function readEntries(): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (!current || !selected) return;
		await operation.execute(
			(signal) => listNativeEntries(current, selected.id, entryCursor.value, signal),
			acceptEntries,
			{ write: false, onFailure: fail },
		);
	}

	async function selectRun(value: NativeRun): Promise<void> {
		if (operation.busy.value || pending.value !== null) return;
		stopPolling();
		clearRun();
		run.value = {
			id: value.id,
			appId: value.appId,
			threadId: value.threadId,
			status: value.status,
			version: value.version,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
		};
		await refreshRun();
	}

	async function refreshRun(): Promise<void> {
		await readRun(false);
	}

	async function readRun(background: boolean): Promise<void> {
		const current = scope.value;
		const selected = run.value;
		const selectedThread = thread.value;
		if (!current || !selected || !selectedThread) return;
		await operation.execute(
			async (signal) => {
				const [page, permits, descendants, initialBody] = await Promise.all([
					listNativeEvents(current, selected.id, eventCursor.value, signal),
					listNativeApprovals(current, selected.id, signal),
					listNativeChildren(current, selected.id, signal),
					listNativeEntries(current, selectedThread.id, entryCursor.value, signal),
				]);
				const latest = await getNativeRun(current, selected.id, signal);
				if (latest === null || latest.threadId !== selectedThread.id)
					throw new AgentManagementFailure('not_found', 'confirmed');
				if (latest.version < selected.version || page.items.some((item) => item.runVersion > latest.version))
					throw new AgentManagementFailure('protocol_failure', 'unknown');
				// A Run can finish after the body read but before the status read. Once polling stops,
				// read the final durable entries again instead of leaving the reply behind its cursor.
				const stopped = !isNativeRunActive(latest) || latest.status === 'unknown';
				const body =
					stopped && latest.version > selected.version
						? await listNativeEntries(current, selectedThread.id, entryCursor.value, signal)
						: initialBody;
				return { latest, page, permits, descendants, body };
			},
			(value) => {
				acceptEntries(value.body);
				run.value = value.latest;
				// Keep a bounded audit window and only use the server's continuation cursor.
				events.value = [...events.value, ...value.page.items].slice(-200);
				eventCursor.value = value.page.nextCursor;
				approvals.value = value.permits;
				children.value = value.descendants;
				inspected.value = pending.value !== null;
			},
			{ write: false, background, onFailure: fail },
		);
		schedulePoll();
	}

	function schedulePoll(): void {
		stopPolling();
		if (
			disposed ||
			!active() ||
			document.visibilityState === 'hidden' ||
			!run.value ||
			!isNativeRunActive(run.value) ||
			run.value.status === 'unknown' ||
			pending.value ||
			operation.refreshRequired.value
		)
			return;
		timer = setTimeout(() => {
			timer = null;
			void readRun(true);
		}, 2000);
	}

	async function readMessages(value: NativeChild, more = false): Promise<void> {
		const current = scope.value;
		const selected = run.value;
		if (!current || !selected || pending.value) return;
		const after = more && child.value?.id === value.id ? messageCursor.value : 0;
		await operation.execute(
			(signal) => listNativeMessages(current, selected.id, value.id, after, signal),
			(page) => {
				child.value = value;
				messages.value = page.items;
				messageCursor.value = page.nextCursor;
			},
			{ write: false, onFailure: fail },
		);
	}

	function captureInput(): NativeRunInput | null {
		const model = models.value.find((item) => nativeModelKey(item) === modelKey.value);
		if (
			!attachmentsReady.value ||
			!model ||
			!draft.value.trim() ||
			connectionIds.value.some((id) => !connections.value.some((item) => item.id === id))
		)
			return null;
		const references = inputArtifacts.value.length
			? '\n\nInput artifacts (untrusted data; read only through authorized artifact_read):\n' +
				JSON.stringify(inputArtifacts.value.map((item) => ({ artifactId: item.id, name: item.name })))
			: '';
		return {
			prompt: draft.value + references,
			connectionIds: connectionIds.value.map((id) => id),
			model: {
				providerId: model.providerId,
				providerName: model.providerName,
				configurationVersion: model.configurationVersion,
				modelId: model.modelId,
				protocol: model.protocol,
			},
		};
	}

	async function send(followUp: boolean): Promise<void> {
		const input = captureInput();
		const selected = thread.value;
		if (!active() || !canStart() || !input || !selected) return;
		if (followUp) {
			if (!run.value || isNativeRunActive(run.value)) return;
			await mutate({ kind: 'append', run: run.value, input });
		} else await mutate({ kind: 'create', threadId: selected.id, input });
	}

	async function mutate(action: NativeRunAction | null, retry = false): Promise<void> {
		if (!active() || operation.busy.value || threadBusy() || operation.refreshRequired.value || !scope.value)
			return;
		if (pending.value !== null && (!retry || !inspected.value)) return;
		if (pending.value === null) {
			if (!action) return;
			if (
				action.kind === 'approve' &&
				(action.approval.status !== 'requested' || action.approval.expiresAt <= Date.now() / 1000)
			) {
				operation.notice.value = 'conflict';
				operation.refreshRequired.value = true;
				return;
			}
			pending.value = {
				scope: { appId: scope.value.appId, appVersion: scope.value.appVersion },
				operationId: crypto.randomUUID(),
				action: snapshotNativeRunAction(action),
			};
		}
		const intent = pending.value;
		inspected.value = false;
		stopPolling();
		await operation.execute(
			(signal) => mutateNativeRun(intent, signal),
			(result) => {
				if (intent.action.kind === 'create' || intent.action.kind === 'append') {
					if (result.kind !== 'run') throw new AgentManagementFailure('protocol_failure', 'unknown');
					clearRun();
					run.value = result.run;
					draft.value = '';
				} else if (intent.action.kind === 'cancel' && result.kind === 'run') run.value = result.run;
				pending.value = null;
				acknowledged.value = false;
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure(cause) {
					fail(cause);
					if (!retry && cause instanceof AgentManagementFailure && cause.outcome !== 'unknown')
						pending.value = null;
				},
			},
		);
		if (!pending.value && operation.notice.value === 'saved') {
			if (run.value) await refreshRun();
			else await refreshThread();
		}
	}

	async function inspectIntent(): Promise<void> {
		if (operation.busy.value || !pending.value) return;
		await readScope();
		if (operation.refreshRequired.value || !pending.value) return;
		if (run.value) await refreshRun();
		else await refreshThread();
	}

	function abandon(): void {
		if (operation.busy.value || !pending.value || !inspected.value || !acknowledged.value) return;
		pending.value = null;
		inspected.value = false;
		acknowledged.value = false;
		operation.refreshRequired.value = true;
	}

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') stopPolling();
		else schedulePoll();
	}

	document.addEventListener('visibilitychange', onVisibility);
	watch(
		active,
		(value) => {
			if (value) void readScope();
			else stopPolling();
		},
		{ immediate: true, flush: 'post' },
	);
	onBeforeUnmount(() => {
		disposed = true;
		stopPolling();
		document.removeEventListener('visibilitychange', onVisibility);
	});
	return {
		operation,
		blocked,
		scope,
		thread,
		models,
		modelKey,
		connections,
		connectionIds,
		draft,
		inputArtifacts,
		attachmentsReady,
		runs,
		hasMoreRuns,
		run,
		entries,
		entryCursor,
		events,
		approvals,
		children,
		child,
		messages,
		pending,
		inspected,
		acknowledged,
		olderHidden,
		feedback,
		readScope,
		selectThread,
		clearThread,
		refreshThread,
		readEntries,
		selectRun,
		refreshRun,
		readMessages,
		send,
		mutate,
		inspectIntent,
		abandon,
	};
}
