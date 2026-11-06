import { logger } from '@/client/logging/logger';
import type { NativeResourceSession } from '../model/native-resource-types';
import { mergeNativeApprovals } from '../model/native-run-rules';
import { subscribeNativeRun } from '../api/native-run-stream';
import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useAuthSession } from '@/features/auth/public';
import { useConnections } from '@/features/connections/public';
import { createNativeThreadApi } from '../api/native-thread-api';
import { getAgentDenylist } from '../api/app-management-api';
import {
	listNativeModels,
	listNativeRuns,
	getNativeRun,
	getNativeRunUsage,
	listNativeEntries,
	listNativeEntryHistory,
	listNativeEvents,
	listNativeChildren,
	listNativeApprovals,
	listNativeMessages,
	mutateNativeRun,
} from '../api/native-run-api';
import { listNativeThreadTools } from '../api/native-tools-api';
import { useAgentManagementOperation } from './use-agent-management-operation';
import type { NativeArtifactReference } from '../model/native-input-types';
import { AgentManagementFailure } from '../model/management-failure';
import { readNativeTargetPreference, writeNativeTargetPreference } from '../model/native-target-preferences';
import type { NativeThread, NativeThreadScope } from '../model/native-thread-types';
import type {
	NativeModel,
	NativeRun,
	NativeRunUsage,
	NativeEntry,
	NativeConversationEntry,
	NativeConversationSnapshot,
	NativeEntryCursor,
	NativeEvent,
	NativeChild,
	NativeMessage,
	NativeApproval,
	NativeRunIntent,
	NativeSubmittedMessage,
	NativeRunAction,
	NativeRunInput,
	NativeRunSubscription,
	NativeRunUpdate,
	NativeTool,
} from '../model/native-run-types';
import { snapshotNativeRunAction } from '../model/native-run-mapper';
import {
	appendNativeConversationWindow,
	appendNativeConversationEntries,
	NATIVE_CONVERSATION_MAX_ENTRIES,
	NATIVE_CONVERSATION_MAX_CHARACTERS,
	isNativeRunActive,
	canCancelNativeRun,
	mergeNativeTools,
	nativeModelKey,
} from '../model/native-run-rules';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';

/** One native surface owns its requests and explicit mutation intention; no singleton Run store. */
export function useNativeRuns(
	appId: string,
	active: () => boolean,
	threadBusy: () => boolean,
	canStart: () => boolean,
	observeMinimized: () => boolean,
) {
	const auth = useAuthSession();
	const connectionCatalog = useConnections();
	const threadApi = createNativeThreadApi();
	const scope = ref<NativeThreadScope | null>(null);
	const thread = ref<NativeThread | null>(null);
	const models = ref<NativeModel[]>([]);
	const modelKey = ref('');
	const approvalMode = ref<import('@nexus-terminal/shared/agent/runs/values').AgentApprovalMode>('ask');
	const reasoningEffort = ref<AgentReasoningEffort | ''>('');
	watch(
		modelKey,
		() => {
			reasoningEffort.value = '';
		},
		{ flush: 'sync' },
	);
	const connectionIds = ref<number[]>([]);
	const deniedIds = ref<number[] | null>(null);
	const draft = ref('');
	const inputArtifacts = ref<NativeArtifactReference[]>([]);
	const attachmentsReady = ref(true);
	const runs = ref<NativeRun[]>([]);
	const run = ref<NativeRun | null>(null);
	const usage = ref<NativeRunUsage | null>(null);
	const entries = ref<NativeConversationEntry[]>([]);
	const entryCursor = ref<NativeEntryCursor>({ runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 });
	const events = ref<NativeEvent[]>([]);
	const eventCursor = ref(0);
	const tools = ref<NativeTool[]>([]);
	const toolCursor = ref<string | null>(null);
	const approvals = ref<NativeApproval[]>([]);
	const children = ref<NativeChild[]>([]);
	const resources = ref<NativeResourceSession[]>([]);
	const child = ref<NativeChild | null>(null);
	const messages = ref<NativeMessage[]>([]);
	const messageCursor = ref(0);
	const pending = ref<NativeRunIntent | null>(null);
	const submittedMessage = ref<NativeSubmittedMessage | null>(null);
	const inspected = ref(false);
	const acknowledged = ref(false);
	const olderHidden = ref(false);
	const feedback = ref('');
	let subscription: NativeRunSubscription | null = null;
	let updateGeneration = 0;
	let awaitingConfirmedUpdate = false;
	let disposed = false;
	let toolRefreshTimer: number | null = null;
	const loadingThread = ref(false);
	const loadingOlder = ref(false);
	const historyCursor = ref<NativeEntryCursor>({ runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 });
	const startedRunId = ref<string | null>(null);
	const conversationSnapshots = new Map<string, NativeConversationSnapshot>();
	let catchingUp: NativeConversationSnapshot | null = null;
	let selectionGeneration = 0;
	let removedThreadId: string | null = null;
	let selectingSnapshot = false;

	function trimSnapshots(): void {
		const currentEntries = catchingUp?.entries ?? entries.value;
		let count = currentEntries.length;
		let characters = currentEntries.reduce((total, entry) => total + entry.text.length, 0);
		const evicted: string[] = [];
		for (const [id, snapshot] of [...conversationSnapshots].reverse()) {
			count += snapshot.entries.length;
			characters += snapshot.entries.reduce((total, entry) => total + entry.text.length, 0);
			if (count > NATIVE_CONVERSATION_MAX_ENTRIES || characters > NATIVE_CONVERSATION_MAX_CHARACTERS) {
				evicted.push(id);
			}
		}
		for (const id of evicted) {
			conversationSnapshots.delete(id);
		}
	}

	function finishCatchUp(): void {
		if (catchingUp) {
			entries.value = catchingUp.entries;
			olderHidden.value = catchingUp.olderHidden;
			catchingUp = null;
		}
		loadingThread.value = false;
		selectingSnapshot = false;
		trimSnapshots();
	}

	function hasConversationSnapshot(threadId: string): boolean {
		return conversationSnapshots.has(threadId);
	}

	function forgetThread(threadId: string): void {
		conversationSnapshots.delete(threadId);
		if (thread.value?.id === threadId) {
			operation.cancelBackgroundRead();
			removedThreadId = threadId;
			selectionGeneration += 1;
			clearToolRefreshTimer();
			stopUpdates();
		}
	}

	function stopUpdates(): void {
		updateGeneration += 1;
		subscription?.close();
		subscription = null;
	}

	function clearRun(): void {
		run.value = null;
		usage.value = null;
		events.value = [];
		eventCursor.value = 0;
		approvals.value = [];
		children.value = [];
		resources.value = [];
		child.value = null;
		messages.value = [];
		messageCursor.value = 0;
		feedback.value = '';
	}

	function clearPrivate(): void {
		selectionGeneration += 1;
		conversationSnapshots.clear();
		catchingUp = null;
		loadingThread.value = false;
		loadingOlder.value = false;
		selectingSnapshot = false;
		startedRunId.value = null;
		removedThreadId = null;
		awaitingConfirmedUpdate = false;
		clearToolRefreshTimer();
		stopUpdates();
		scope.value = null;
		thread.value = null;
		approvalMode.value = 'ask';
		models.value = [];
		modelKey.value = '';
		connectionIds.value = [];
		deniedIds.value = null;
		draft.value = '';
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		runs.value = [];
		entries.value = [];
		entryCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		historyCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		tools.value = [];
		toolCursor.value = null;
		pending.value = null;
		submittedMessage.value = null;
		inspected.value = false;
		acknowledged.value = false;
		olderHidden.value = false;
		clearRun();
	}

	const operation = useAgentManagementOperation(
		(reason) => {
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
		},
		() => active() || (observeMinimized() && run.value !== null),
		{ retainOnView: true, notifySuccess: false, notifyFailure: false, notifyFailureDetails: true },
	);
	const connections = computed(() =>
		deniedIds.value === null
			? []
			: connectionCatalog.connections.value.filter(
					(item) => item.type === 'SSH' && !deniedIds.value?.includes(item.id),
				),
	);
	const blocked = computed(
		() =>
			operation.busy.value ||
			loadingThread.value ||
			threadBusy() ||
			operation.refreshRequired.value ||
			pending.value !== null ||
			scope.value === null,
	);

	function selectConnections(ids: number[]): void {
		if (blocked.value || !active()) return;
		const available = new Set(connections.value.map((connection) => connection.id));
		connectionIds.value = [...new Set(ids)].filter((id) => available.has(id));
		const userId = auth.user.value?.id ?? null;
		if (auth.isAuthenticated.value && userId !== null) {
			writeNativeTargetPreference(userId, appId, connectionIds.value);
		}
	}

	function fail(cause: unknown): void {
		const context = {
			appId,
			runId: run.value?.id,
			code: cause instanceof AgentManagementFailure ? cause.code : 'unexpected',
		};
		if (
			cause instanceof AgentManagementFailure &&
			['cancelled', 'unauthenticated', 'forbidden'].includes(cause.code)
		)
			logger.debug(context, 'Agent update stopped');
		else if (
			!(cause instanceof AgentManagementFailure) ||
			['protocol_failure', 'internal_failure'].includes(cause.code)
		)
			logger.error(context, 'Agent update failed');
		else logger.warn(context, 'Agent update failed');
		finishCatchUp();
		awaitingConfirmedUpdate = false;
		stopUpdates();
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
					connectionCatalog.revalidate(),
				]);
				return { current, availableModels, denylist };
			},
			(value) => {
				const userId = auth.user.value?.id ?? null;
				const remembered =
					scope.value === null && auth.isAuthenticated.value && userId !== null
						? readNativeTargetPreference(userId, appId)
						: connectionIds.value;
				scope.value = value.current;
				models.value = value.availableModels;
				deniedIds.value = value.denylist.entries.map((item) => item.connectionId);
				const available = new Set(connections.value.map((connection) => connection.id));
				connectionIds.value = remembered.filter((id) => available.has(id));
				if (auth.isAuthenticated.value && userId !== null) {
					writeNativeTargetPreference(userId, appId, connectionIds.value);
				}
				// Never replace an original selected model/configuration after an edit or failure.
				// Prefer a chat model so the first run does not default to an image-only endpoint.
				if (!modelKey.value) {
					const preferred =
						value.availableModels.find((model) => model.protocol !== 'images') ?? value.availableModels[0];
					if (preferred) modelKey.value = nativeModelKey(preferred);
				}
				inspected.value = false;
			},
			{ write: false, onFailure: fail },
		);
	}

	function acceptEntries(page: { items: NativeEntry[]; nextCursor: NativeEntryCursor }): void {
		const combined = appendNativeConversationWindow(
			catchingUp ?? {
				entries: entries.value,
				cursor: entryCursor.value,
				startCursor: historyCursor.value,
				olderHidden: olderHidden.value,
			},
			page,
		);
		if (catchingUp) {
			catchingUp = combined;
		} else {
			entries.value = combined.entries;
			olderHidden.value = combined.olderHidden;
		}
		entryCursor.value = combined.cursor;
		trimSnapshots();
		const submitted = submittedMessage.value;
		if (
			submitted &&
			submitted.threadId === thread.value?.id &&
			page.items.some((item) => item.role === 'user' && item.runId === submitted.runId)
		) {
			submittedMessage.value = null;
		}
	}

	async function selectThread(value: NativeThread): Promise<void> {
		const current = scope.value;
		if (!current || operation.busy.value || pending.value !== null || !attachmentsReady.value) return;
		if (thread.value?.id === value.id && removedThreadId !== value.id && !operation.refreshRequired.value) {
			if (value.version > thread.value.version) {
				thread.value = value;
			}
			return;
		}
		const previousId = thread.value?.id;
		if (
			previousId &&
			previousId !== removedThreadId &&
			entries.value.length > 0 &&
			!loadingThread.value &&
			!operation.refreshRequired.value
		) {
			conversationSnapshots.delete(previousId);
			conversationSnapshots.set(previousId, {
				entries: entries.value,
				cursor: entryCursor.value,
				startCursor: historyCursor.value,
				olderHidden: olderHidden.value,
			});
		}
		const cached = conversationSnapshots.get(value.id);
		conversationSnapshots.delete(value.id);
		operation.cancelBackgroundRead();
		const selectedGeneration = ++selectionGeneration;
		awaitingConfirmedUpdate = false;
		inspected.value = false;
		acknowledged.value = false;
		removedThreadId = null;
		startedRunId.value = null;
		loadingThread.value = true;
		loadingOlder.value = false;
		selectingSnapshot = true;
		operation.refreshRequired.value = true;
		clearToolRefreshTimer();
		stopUpdates();
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		submittedMessage.value = null;
		thread.value = {
			id: value.id,
			appId: value.appId,
			title: value.title,
			version: value.version,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
		};
		runs.value = [];
		entries.value = cached?.entries ?? [];
		entryCursor.value = cached?.cursor ?? { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		historyCursor.value = cached?.startCursor ?? { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		olderHidden.value = cached?.olderHidden ?? false;
		catchingUp = {
			entries: entries.value,
			cursor: entryCursor.value,
			startCursor: historyCursor.value,
			olderHidden: olderHidden.value,
		};
		tools.value = [];
		toolCursor.value = null;
		trimSnapshots();
		clearRun();
		approvalMode.value = 'ask';
		// The latest Run snapshot owns the body/tool reads; selection only needs its identity here.
		await operation.execute(
			async (signal) => {
				const [recentRuns, history] = await Promise.all([
					readRecentRuns(current, value.id, signal),
					cached ? null : listNativeEntryHistory(current, value.id, null, signal),
				]);
				return { recentRuns, history };
			},
			(value) => {
				if (selectedGeneration !== selectionGeneration) return;
				runs.value = value.recentRuns;
				if (value.history) {
					entries.value = appendNativeConversationEntries([], value.history.body.items);
					entryCursor.value = value.history.body.nextCursor;
					historyCursor.value = value.history.startCursor;
					olderHidden.value = value.history.hasEarlier;
					catchingUp = {
						entries: entries.value,
						cursor: entryCursor.value,
						startCursor: historyCursor.value,
						olderHidden: olderHidden.value,
					};
				}
			},
			{ write: false, background: true, onFailure: fail },
		);
		if (selectedGeneration !== selectionGeneration || operation.refreshRequired.value) {
			return;
		}
		const latest = runs.value.at(-1);
		if (latest) {
			await selectRun(latest, true);
			if (selectedGeneration === selectionGeneration) {
				selectingSnapshot = false;
				startUpdates();
			}
		} else {
			finishCatchUp();
		}
	}

	function clearThread(): void {
		if (operation.busy.value || pending.value !== null) return;
		operation.cancelBackgroundRead();
		selectionGeneration += 1;
		catchingUp = null;
		awaitingConfirmedUpdate = false;
		loadingThread.value = false;
		loadingOlder.value = false;
		selectingSnapshot = false;
		startedRunId.value = null;
		operation.clearFeedback();
		clearToolRefreshTimer();
		stopUpdates();
		thread.value = null;
		submittedMessage.value = null;
		approvalMode.value = 'ask';
		runs.value = [];
		entries.value = [];
		entryCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		historyCursor.value = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		tools.value = [];
		toolCursor.value = null;
		olderHidden.value = false;
		inputArtifacts.value = [];
		attachmentsReady.value = true;
		clearRun();
	}

	async function readRecentRuns(
		current: NativeThreadScope,
		threadId: string,
		signal: AbortSignal,
	): Promise<NativeRun[]> {
		let after = 0;
		let recent: NativeRun[] = [];
		for (;;) {
			const page = await listNativeRuns(current, threadId, after, signal);
			recent = [...recent, ...page.items].slice(-AGENT_RUN_EVENT_MAX_LIMIT);
			if (page.items.length < AGENT_RUN_EVENT_MAX_LIMIT) return recent;
			after = page.nextCursor;
		}
	}

	async function refreshThread(): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (!current || !selected) return;
		const selectedGeneration = selectionGeneration;
		stopUpdates();
		await operation.execute(
			async (signal) => {
				const [recentRuns, body, toolPage] = await Promise.all([
					readRecentRuns(current, selected.id, signal),
					listNativeEntries(current, selected.id, entryCursor.value, signal),
					listNativeThreadTools(current.appId, selected.id, null, undefined, signal),
				]);
				return { recentRuns, body, toolPage };
			},
			(result) => {
				if (selectedGeneration !== selectionGeneration || thread.value?.id !== selected.id) {
					return;
				}
				runs.value = result.recentRuns;
				acceptEntries(result.body);
				tools.value = mergeNativeTools(tools.value, result.toolPage.items);
				toolCursor.value = result.toolPage.nextCursor;
				inspected.value = pending.value !== null;
			},
			{ write: false, onFailure: fail },
		);
		if (selectedGeneration === selectionGeneration && thread.value?.id === selected.id) {
			startUpdates();
		}
	}

	async function readOlderEntries(beforePrepend?: () => void): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (
			!current ||
			!selected ||
			!olderHidden.value ||
			loadingThread.value ||
			loadingOlder.value ||
			operation.busy.value ||
			operation.refreshRequired.value ||
			pending.value
		)
			return;
		const generation = selectionGeneration;
		const before = historyCursor.value;
		const interruptedRead = operation.cancelBackgroundRead();
		loadingOlder.value = true;
		try {
			await operation.execute(
				(signal) => listNativeEntryHistory(current, selected.id, before, signal),
				(page) => {
					if (generation !== selectionGeneration || thread.value?.id !== selected.id) return;
					beforePrepend?.();
					entries.value = appendNativeConversationEntries(
						appendNativeConversationEntries([], page.body.items),
						entries.value,
					);
					historyCursor.value = page.startCursor;
					olderHidden.value = page.hasEarlier;
					trimSnapshots();
				},
				{ write: false, background: true, onFailure: fail },
			);
		} finally {
			if (generation === selectionGeneration) {
				loadingOlder.value = false;
				if (interruptedRead && !operation.refreshRequired.value) scheduleToolRefresh();
			}
		}
	}

	async function readEntries(): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (!current || !selected) return;
		stopUpdates();
		await operation.execute(
			(signal) => listNativeEntries(current, selected.id, entryCursor.value, signal),
			acceptEntries,
			{ write: false, onFailure: fail },
		);
		startUpdates();
	}

	async function selectRun(value: NativeRun, background = false): Promise<void> {
		if (operation.busy.value || pending.value !== null) return;
		stopUpdates();
		clearRun();
		run.value = {
			id: value.id,
			appId: value.appId,
			threadId: value.threadId,
			approvalMode: value.approvalMode,
			status: value.status,
			failure: value.failure === null ? null : { code: value.failure.code, toolName: value.failure.toolName },
			version: value.version,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
		};
		approvalMode.value = value.approvalMode;
		await refreshRun(background);
	}

	async function refreshRun(background = false): Promise<void> {
		stopUpdates();
		const generation = updateGeneration;
		await readRun(background);
		if (generation === updateGeneration) {
			startUpdates();
		}
	}

	async function readRun(background = false): Promise<void> {
		const current = scope.value;
		const selected = run.value;
		const selectedThread = thread.value;
		if (!current || !selected || !selectedThread) return;
		const generation = updateGeneration;
		await operation.execute(
			async (signal) => {
				const [page, permits, descendants, initialBody, toolPage] = await Promise.all([
					listNativeEvents(current, selected.id, eventCursor.value, signal),
					listNativeApprovals(current, selected.id, signal),
					listNativeChildren(current, selected.id, signal),
					listNativeEntries(current, selectedThread.id, entryCursor.value, signal),
					listNativeThreadTools(current.appId, selectedThread.id, null, undefined, signal),
				]);
				const latest = await getNativeRun(current, selected.id, signal);
				if (latest === null || latest.threadId !== selectedThread.id)
					throw new AgentManagementFailure('not_found', 'confirmed');
				if (latest.version < selected.version || page.items.some((item) => item.runVersion > latest.version))
					throw new AgentManagementFailure('protocol_failure', 'unknown');
				// A Run can finish after the body read but before the status read. At its terminal state,
				// read the final durable entries again instead of leaving the reply behind its cursor.
				const stopped = !isNativeRunActive(latest);
				const body =
					stopped && latest.version > selected.version
						? await listNativeEntries(current, selectedThread.id, entryCursor.value, signal)
						: initialBody;
				const usage = await getNativeRunUsage(current, selected.id, signal);
				if (usage.runVersion < latest.version) throw new AgentManagementFailure('protocol_failure', 'unknown');
				return { latest, page, permits, descendants, body, usage, toolPage };
			},
			(value) => {
				if (
					generation !== updateGeneration ||
					scope.value?.appId !== current.appId ||
					run.value?.id !== selected.id ||
					thread.value?.id !== selectedThread.id
				)
					return;
				acceptEntries(value.body);
				tools.value = mergeNativeTools(tools.value, value.toolPage.items);
				toolCursor.value = value.toolPage.nextCursor;
				run.value = value.latest;
				usage.value = value.usage;
				// Keep a bounded audit window and only use the server's continuation cursor.
				events.value = [...events.value, ...value.page.items].slice(-200);
				eventCursor.value = value.page.nextCursor;
				approvals.value = value.permits;
				children.value = value.descendants;
				inspected.value = pending.value !== null;
			},
			{ write: false, background, onFailure: fail },
		);
	}

	function clearToolRefreshTimer(): void {
		if (toolRefreshTimer !== null) window.clearTimeout(toolRefreshTimer);
		toolRefreshTimer = null;
	}

	function scheduleToolRefresh(): void {
		if (disposed) return;
		clearToolRefreshTimer();
		toolRefreshTimer = window.setTimeout(() => {
			toolRefreshTimer = null;
			void refreshToolSnapshot();
		}, 250);
	}

	async function refreshToolSnapshot(): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		if (!current || !selected || disposed) return;
		const threadId = selected.id;
		const generation = updateGeneration;
		await operation.execute(
			(signal) => listNativeThreadTools(current.appId, threadId, null, undefined, signal),
			(page) => {
				if (generation !== updateGeneration || thread.value?.id !== threadId) return;
				tools.value = mergeNativeTools(tools.value, page.items);
				toolCursor.value = page.nextCursor;
			},
			{ write: false, background: true },
		);
	}

	async function readOlderTools(): Promise<void> {
		const current = scope.value;
		const selected = thread.value;
		const before = toolCursor.value;
		if (!current || !selected || before === null || disposed) return;
		const threadId = selected.id;
		const generation = updateGeneration;
		await operation.execute(
			(signal) => listNativeThreadTools(current.appId, threadId, before, undefined, signal),
			(page) => {
				if (generation !== updateGeneration || thread.value?.id !== threadId) return;
				tools.value = mergeNativeTools(tools.value, page.items);
				toolCursor.value = page.nextCursor;
			},
			{ write: false, background: true },
		);
	}

	function canReadUpdates(): boolean {
		return (
			!disposed &&
			(active() || observeMinimized()) &&
			!document.hidden &&
			scope.value !== null &&
			run.value !== null &&
			thread.value !== null &&
			pending.value === null &&
			(!operation.refreshRequired.value || awaitingConfirmedUpdate)
		);
	}

	function startUpdates(): void {
		if (selectingSnapshot || !canReadUpdates() || subscription || !scope.value || !run.value || !thread.value)
			return;
		const generation = updateGeneration;
		subscription = subscribeNativeRun(
			scope.value,
			run.value.id,
			() => {
				if (!thread.value || !run.value) throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
				return {
					threadId: thread.value.id,
					entries: {
						runSequence: entryCursor.value.runSequence,
						stepIndex: entryCursor.value.stepIndex,
						eventSequence: entryCursor.value.eventSequence,
						textOffset: entryCursor.value.textOffset,
					},
					events: eventCursor.value,
					runVersion: run.value.version,
				};
			},
			(value) => {
				if (generation !== updateGeneration || !canReadUpdates()) return false;
				acceptUpdate(value);
				return true;
			},
			(cause) => {
				if (generation === updateGeneration) {
					operation.reportFailure(cause);
					fail(cause);
				}
			},
		);
	}

	function acceptUpdate(value: NativeRunUpdate): void {
		acceptEntries(value.body);
		if (value.state) {
			const previousExecutions = usage.value?.toolExecutions ?? 0;
			const previousStatus = run.value?.status;
			if (thread.value?.id === value.state.thread.id && value.state.thread.version > thread.value.version) {
				thread.value = value.state.thread;
			}
			run.value = value.state.run;
			if (previousStatus !== value.state.run.status) {
				logger.info(
					{ appId, runId: value.state.run.id, previousStatus, status: value.state.run.status },
					'Agent run status changed',
				);
			}
			usage.value = value.state.usage;
			events.value = [...events.value, ...value.state.events.items].slice(-200);
			eventCursor.value = value.state.events.nextCursor;
			approvals.value = mergeNativeApprovals(approvals.value, value.state.approvals);
			children.value = value.state.children;
			resources.value = value.state.resources;
			if (value.state.usage.toolExecutions !== previousExecutions || value.state.run.status !== previousStatus) {
				scheduleToolRefresh();
			}
			if (awaitingConfirmedUpdate) {
				// This releases only a definitively acknowledged mutation's post-write read fence.
				awaitingConfirmedUpdate = false;
				operation.refreshRequired.value = false;
			}
		}
		if (!value.more) {
			finishCatchUp();
			if (
				run.value &&
				!isNativeRunActive(run.value) &&
				resources.value.every((resource) => resource.state === 'cleanup_failed')
			) {
				stopUpdates();
			}
		}
	}

	watch(operation.busy, (busy) => {
		if (!busy) subscription?.resume();
	});
	watch(operation.refreshRequired, (required) => {
		if (required && !awaitingConfirmedUpdate) stopUpdates();
		else if (awaitingConfirmedUpdate || (run.value && isNativeRunActive(run.value))) startUpdates();
	});

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
		const effort = reasoningEffort.value;
		if (
			effort &&
			(model.protocol === 'images' ||
				!model.reasoningEfforts.includes(effort) ||
				(model.reasoningMandatory && effort === 'none'))
		)
			return null;
		return {
			...(effort ? { reasoningEffort: effort } : {}),
			approvalMode: approvalMode.value,
			prompt: draft.value + references,
			connectionIds: connectionIds.value.map((id) => id),
			model: {
				providerId: model.providerId,
				providerName: model.providerName,
				configurationVersion: model.configurationVersion,
				modelId: model.modelId,
				protocol: model.protocol,
				reasoningEfforts: model.reasoningEfforts.map((effort) => effort),
				reasoningMandatory: model.reasoningMandatory,
				...(model.defaultReasoningEffort === undefined
					? {}
					: { defaultReasoningEffort: model.defaultReasoningEffort }),
			},
		};
	}

	async function send(followUp: boolean): Promise<void> {
		const input = captureInput();
		const selected = thread.value;
		if (!active() || !canStart() || !input || !selected) return;
		if (followUp) {
			if (!run.value || canCancelNativeRun(run.value)) return;
			await mutate({ kind: 'append', run: run.value, input });
		} else await mutate({ kind: 'create', threadId: selected.id, input });
	}

	async function mutate(action: NativeRunAction | null, retry = false): Promise<void> {
		// Minimized controls can decide an existing approval, never create, append or retry work.
		const available = active() || (observeMinimized() && action?.kind === 'approve' && !retry);
		if (
			!available ||
			operation.busy.value ||
			loadingThread.value ||
			threadBusy() ||
			operation.refreshRequired.value ||
			!scope.value
		) {
			return;
		}
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
		stopUpdates();
		if (!retry && (intent.action.kind === 'create' || intent.action.kind === 'append')) {
			submittedMessage.value = {
				operationId: intent.operationId,
				threadId: intent.action.kind === 'create' ? intent.action.threadId : intent.action.run.threadId,
				runId: null,
				text: intent.action.input.prompt,
			};
		}
		await operation.execute(
			(signal) => mutateNativeRun(intent, signal),
			(result) => {
				if (intent.action.kind === 'create' || intent.action.kind === 'append') {
					if (result.kind !== 'run') throw new AgentManagementFailure('protocol_failure', 'unknown');
					clearRun();
					startedRunId.value = result.run.id;
					run.value = result.run;
					if (submittedMessage.value?.operationId === intent.operationId) {
						if (entries.value.some((item) => item.role === 'user' && item.runId === result.run.id)) {
							submittedMessage.value = null;
						} else submittedMessage.value.runId = result.run.id;
					}
					draft.value = '';
				} else if (intent.action.kind === 'approve') {
					if (result.kind !== 'approval') throw new AgentManagementFailure('protocol_failure', 'unknown');
					approvals.value = mergeNativeApprovals(approvals.value, [result.approval]);
					scheduleToolRefresh();
				} else if (intent.action.kind === 'cancel' && result.kind === 'run') run.value = result.run;
				pending.value = null;
				acknowledged.value = false;
				awaitingConfirmedUpdate = true;
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure(cause) {
					if (submittedMessage.value?.operationId === intent.operationId) submittedMessage.value = null;
					fail(cause);
					if (!retry && cause instanceof AgentManagementFailure && cause.outcome !== 'unknown')
						pending.value = null;
				},
			},
		);
		if (!pending.value && operation.notice.value === 'saved') {
			if (run.value) startUpdates();
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
		if (document.visibilityState === 'hidden') stopUpdates();
		else {
			startUpdates();
		}
	}

	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pageshow', onVisibility);
	watch(
		() => active() || (observeMinimized() && run.value !== null),
		(value) => {
			if (!value) stopUpdates();
			else if (scope.value === null) void readScope();
			else {
				startUpdates();
			}
		},
		{ immediate: true, flush: 'post' },
	);
	onBeforeUnmount(() => {
		disposed = true;
		clearToolRefreshTimer();
		stopUpdates();
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onVisibility);
	});
	return {
		operation,
		blocked,
		loadingThread,
		loadingOlder,
		readOlderEntries,
		startedRunId,
		forgetThread,
		hasConversationSnapshot,
		scope,
		thread,
		models,
		modelKey,
		reasoningEffort,
		approvalMode,
		connections,
		connectionIds,
		selectConnections,
		draft,
		inputArtifacts,
		attachmentsReady,
		runs,
		run,
		usage,
		entries,
		submittedMessage,
		entryCursor,
		tools,
		toolCursor,
		readOlderTools,
		events,
		approvals,
		children,
		resources,
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
