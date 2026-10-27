<script setup lang="ts">
	import { useElementSize, useResizeObserver } from '@vueuse/core';
	import { useResizeHandle } from '@/foundation/interaction';
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { UiButton, UiCheckbox, UiEmptyState, UiLoadingState, UiInlineNotice } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import { useNativeRuns } from '../composables/use-native-runs';
	import { isNativeRunActive, nativeModelKey } from '../model/native-run-rules';
	import NativeThreadPanel from './NativeThreadPanel.vue';
	import NativeInputArtifacts from '../files/NativeInputArtifacts.vue';
	import AgentConfigPopover from '../files/AgentConfigPopover.vue';
	import NativeRunDetails from '../runtime/NativeRunDetails.vue';
	import NativeMemoryReview from '../runtime/NativeMemoryReview.vue';
	import NativeApprovalList from '../runtime/NativeApprovalList.vue';
	import NativeApprovalHistoryList from '../runtime/NativeApprovalHistoryList.vue';
	import NativeToolActivityList from '../runtime/NativeToolActivityList.vue';
	import AgentMessageBody from '../ai/AgentMessageBody.vue';
	import AgentConversationWelcome from '../ai/AgentConversationWelcome.vue';
	import type { NativeThread } from '../model/native-thread-types';
	import { formatAgentNumber } from '../locale-format';
	import type { NativeApproval, NativeModel, NativeTool } from '../model/native-run-types';
	import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';

	const props = defineProps<{
		appId: string;
		appVersion: number;
		resumeRevision?: number;
		appNames?: Record<string, string>;
		executionEnabled: boolean;
		active: boolean;
	}>();
	const { t, locale } = useI18n();
	const layoutRoot = ref<HTMLElement | null>(null);
	const composer = ref<HTMLElement | null>(null);
	const { width: composerWidth } = useElementSize(composer);
	const threadsOverlay = ref(false);
	const threadSidebarVisible = ref(true);
	const threadDrawerOpen = ref(false);
	const taskRailVisible = ref(false);
	const memoryRailVisible = ref(false);
	const memoryCount = ref(0);
	const memoryNeedsRead = ref(false);
	const taskRailWidth = ref(360);
	const taskRailHeight = ref(0);
	const pendingThreadSelection = ref<NativeThread | null>(null);
	const scroller = ref<HTMLElement | null>(null);
	const attachmentControl = ref<{ removeById(id: string): void } | null>(null);
	const showJumpToLatest = ref(false);
	const keepPinnedToBottom = ref(true);
	const canJumpPrevious = ref(false);
	const canJumpNext = ref(false);
	type AgentConfigControl = 'model' | 'reasoning' | 'target' | 'approval';
	const selectedConfig = ref<AgentConfigControl | null>(null);
	let applyingThreadSelection = false;
	let layoutObserver: ReturnType<typeof useResizeObserver> | null = null;
	let transcriptObserver: ReturnType<typeof useResizeObserver> | null = null;
	let transcriptFrame: number | null = null;

	onMounted(() => {
		if (!layoutRoot.value) {
			return;
		}
		threadsOverlay.value = layoutRoot.value.clientWidth <= 760;
		layoutObserver = useResizeObserver(layoutRoot.value, (entries) => {
			const entry = entries[0];
			if (entry) {
				threadsOverlay.value = entry.contentRect.width <= 760;
			}
		});
	});
	onBeforeUnmount(() => {
		layoutObserver?.stop();
		transcriptObserver?.stop();
		if (transcriptFrame !== null) cancelAnimationFrame(transcriptFrame);
	});

	const threadBusy = ref(false);
	const bindingBusy = ref(false);
	const runtime = useNativeRuns(
		props.appId,
		() => props.active,
		() => threadBusy.value || bindingBusy.value,
		() => props.executionEnabled,
	);
	const {
		operation,
		scope,
		thread,
		models,
		modelKey,
		reasoningEffort,
		approvalMode,
		connections,
		connectionIds,
		draft,
		run,
		usage,
		entries,
		submittedMessage,
		tools,
		toolCursor,
		readOlderTools,
		events,
		approvals,
		children,
		child,
		messages,
		pending,
		inspected,
		acknowledged,
		olderHidden,
		blocked,
		inputArtifacts,
		attachmentsReady,
	} = runtime;

	const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'requested'));
	const requestedApprovalCount = computed(() => pendingApprovals.value.length);
	const layoutStyle = computed<Record<string, string> | undefined>(() => {
		if (!run.value || !taskRailVisible.value) return undefined;
		return { '--agent-task-rail-column': `${taskRailWidth.value}px` };
	});
	const taskRailResize = useResizeHandle({
		width: taskRailWidth,
		height: taskRailHeight,
		minWidth: 300,
		minHeight: 0,

		maxWidth: () => Math.min(560, Math.max(320, (layoutRoot.value?.clientWidth ?? 1280) - 520)),

		maxHeight: () => 0,

		widthDirection: -1,

		canStart: (event) => event.button === 0 && (layoutRoot.value?.clientWidth ?? 0) > 1040,
	});

	watch(
		requestedApprovalCount,
		(count, previous) => {
			if (count > 0 && count > (previous ?? 0)) {
				taskRailVisible.value = true;
				memoryRailVisible.value = false;
			}
		},
		{ flush: 'sync' },
	);

	watch(
		() => thread.value?.id,
		() => {
			memoryRailVisible.value = false;
			memoryCount.value = 0;
			memoryNeedsRead.value = false;
		},
		{ flush: 'sync' },
	);
	watch(
		taskRailVisible,
		(visible) => {
			if (visible) memoryRailVisible.value = false;
		},
		{ flush: 'sync' },
	);
	watch(
		memoryRailVisible,
		(visible) => {
			if (visible) taskRailVisible.value = false;
		},
		{ flush: 'sync' },
	);

	function memoryProposed(threadId: string): void {
		if (props.active && thread.value?.id === threadId) memoryRailVisible.value = true;
	}

	function memorySummary(threadId: string, count: number, needsRead: boolean): void {
		if (thread.value?.id !== threadId) return;
		memoryCount.value = count;
		memoryNeedsRead.value = needsRead;
	}

	const chatError = computed(() => {
		if (operation.failureMessage.value) return operation.failureMessage.value;
		const current = run.value;
		if (operation.busy.value || !current || (current.status !== 'failed' && current.status !== 'unknown'))
			return '';
		const reason = current.failure
			? t('agent.nativeRun.failureReasons.' + current.failure.code, { tool: current.failure.toolName })
			: t('agent.nativeRun.runFailedReasonUnavailable');
		return t(current.status === 'unknown' ? 'agent.nativeRun.runUnknown' : 'agent.nativeRun.runFailed', {
			reason,
			runId: current.id,
		});
	});

	const toolGroups = computed<NativeTool[][]>(() => {
		const groups = new Map<string, NativeTool[]>();
		for (const tool of tools.value) {
			const key = tool.runId + ':' + tool.modelStepIndex;
			const group = groups.get(key);
			if (group) group.push(tool);
			else groups.set(key, [tool]);
		}
		return [...groups.values()]
			.filter((group) => group.length > 0)
			.map((group) => group.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
			.sort(
				(a, b) =>
					(a[0]?.createdAt ?? 0) - (b[0]?.createdAt ?? 0) || (a[0]?.id ?? '').localeCompare(b[0]?.id ?? ''),
			);
	});

	const toolsByEntry = computed(() => {
		const assigned = new Map<number, NativeTool[]>();
		const orphan: NativeTool[] = [];
		const indexByToolId = new Map<string, number>();
		for (const group of toolGroups.value) {
			const first = group[0];
			if (!first) continue;
			let target = -1;
			for (let index = 0; index < entries.value.length; index++) {
				const entry = entries.value[index];
				if (!entry || entry.role !== 'assistant' || entry.runId !== first.runId) continue;
				if (entry.position.stepIndex === first.modelStepIndex) {
					target = index;
					break;
				}
				if (entry.position.stepIndex < first.modelStepIndex) target = index;
			}
			if (target < 0) {
				for (let index = entries.value.length - 1; index >= 0; index--) {
					if (entries.value[index]?.runId === first.runId) {
						target = index;
						break;
					}
				}
			}
			if (target < 0) orphan.push(...group);
			else {
				assigned.set(target, [...(assigned.get(target) ?? []), ...group]);
				for (const tool of group) indexByToolId.set(tool.id, target);
			}
		}
		return { assigned, orphan, indexByToolId };
	});

	const approvalsByEntry = computed(() => {
		const assigned = new Map<number, NativeApproval[]>();
		const orphan: NativeApproval[] = [];
		for (const approval of approvals.value) {
			if (approval.status === 'requested') continue;
			const target = toolsByEntry.value.indexByToolId.get(approval.toolCallId);
			if (target === undefined) orphan.push(approval);
			else assigned.set(target, [...(assigned.get(target) ?? []), approval]);
		}
		return { assigned, orphan };
	});

	const totalTokens = computed(() => {
		const value = usage.value;
		return value?.inputTokens !== null && value?.inputTokens !== undefined && value.outputTokens !== null
			? value.inputTokens + value.outputTokens
			: null;
	});
	const tokenLabel = computed(() => {
		const value = totalTokens.value;
		if (value === null) return '—';
		const divisor = value >= 1_000_000 ? 1_000_000 : value >= 1_000 ? 1_000 : 1;
		return (
			formatAgentNumber(locale.value, value / divisor, { maximumFractionDigits: divisor === 1 ? 0 : 1 }) +
			(divisor === 1_000_000 ? 'M' : divisor === 1_000 ? 'k' : '')
		);
	});
	const usageDetails = computed(() => {
		const value = usage.value;
		if (!value) return '';
		const tokens =
			value.inputTokens === null
				? t('agent.nativeRun.usageUnavailable')
				: t('agent.nativeRun.tokens') +
					': ' +
					formatAgentNumber(locale.value, value.inputTokens) +
					' / ' +
					formatAgentNumber(locale.value, value.outputTokens ?? 0);
		return (
			tokens +
			' · ' +
			t('agent.tasks.modelRequests') +
			': ' +
			value.modelRequests +
			' · ' +
			t('agent.tasks.toolExecutions') +
			': ' +
			value.toolExecutions +
			' · ' +
			t('agent.nativeRun.usageCoverage', { reported: value.reportedModelRequests, requests: value.modelRequests })
		);
	});

	const selectedModel = computed(() => models.value.find((model) => nativeModelKey(model) === modelKey.value));

	const reasoningLevels = computed(() => {
		const model = selectedModel.value;
		if (!model || model.protocol === 'images') return [];
		return AGENT_REASONING_EFFORTS.filter(
			(effort) => model.reasoningEfforts.includes(effort) && (!model.reasoningMandatory || effort !== 'none'),
		);
	});
	const reasoningDisplayLabel = computed(() =>
		reasoningEffort.value
			? t(`agent.ui.reasoningLevels.${reasoningEffort.value}`)
			: t('agent.ui.reasoningDefaultShort'),
	);
	const activeReasoningIndex = computed(() => {
		const effort = reasoningEffort.value || selectedModel.value?.defaultReasoningEffort;
		if (!effort) return 0;
		const index = reasoningLevels.value.indexOf(effort);
		return index === -1 ? 0 : index;
	});
	const reasoningDragging = ref(false);
	const reasoningDragPercent = ref<number | null>(null);
	const reasoningThumbPercent = computed(() => {
		if (reasoningDragging.value && reasoningDragPercent.value !== null) return reasoningDragPercent.value;
		const count = reasoningLevels.value.length;
		if (count <= 1) return 50;
		return Math.round(5 + (activeReasoningIndex.value / (count - 1)) * 90);
	});
	const reasoningIntense = computed(() => reasoningEffort.value === 'max' || reasoningEffort.value === 'xhigh');
	const reasoningDescription = computed(() =>
		reasoningEffort.value
			? t(`agent.ui.reasoningDescriptions.${reasoningEffort.value}`)
			: t('agent.ui.reasoningDefault'),
	);
	const reasoningTrack = ref<HTMLElement | null>(null);
	let reasoningPointerId: number | null = null;

	function setReasoning(effort: AgentReasoningEffort | ''): void {
		if (blocked.value || (effort && !reasoningLevels.value.includes(effort))) return;
		reasoningEffort.value = effort;
	}

	function updateReasoningFromPointer(clientX: number): void {
		const track = reasoningTrack.value;
		const levels = reasoningLevels.value;
		if (!track || levels.length <= 1) return;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		reasoningDragPercent.value = Math.round(5 + ratio * 90);
		const index = Math.max(0, Math.min(levels.length - 1, Math.round(ratio * (levels.length - 1))));
		const effort = levels[index];
		if (effort && effort !== reasoningEffort.value) setReasoning(effort);
	}

	function onReasoningPointerDown(event: PointerEvent): void {
		if (blocked.value || event.button !== 0 || reasoningLevels.value.length <= 1) return;
		reasoningPointerId = event.pointerId;
		reasoningDragging.value = true;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointers and detached targets may not support capture.
		}
		updateReasoningFromPointer(event.clientX);
	}

	function onReasoningPointerMove(event: PointerEvent): void {
		if (!reasoningDragging.value || reasoningPointerId !== event.pointerId) return;
		updateReasoningFromPointer(event.clientX);
	}

	function releaseReasoningPointer(event: PointerEvent): void {
		if (reasoningPointerId !== event.pointerId) return;
		const target = event.currentTarget as HTMLElement;
		try {
			if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		} catch {
			// Ignore capture teardown failures; the drag state still resets below.
		}
		reasoningPointerId = null;
		reasoningDragging.value = false;
		reasoningDragPercent.value = null;
	}

	function onReasoningKeydown(event: KeyboardEvent): void {
		const levels = reasoningLevels.value;
		if (!levels.length || blocked.value) return;
		const current = activeReasoningIndex.value;
		let index = current;
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') index = Math.min(levels.length - 1, current + 1);
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') index = Math.max(0, current - 1);
		else if (event.key === 'Home') index = 0;
		else if (event.key === 'End') index = levels.length - 1;
		else return;
		event.preventDefault();
		const effort = levels[index];
		if (effort) setReasoning(effort);
	}

	function selectModel(model: NativeModel, close: () => void): void {
		if (blocked.value) return;
		modelKey.value = nativeModelKey(model);
		close();
	}

	function selectConfigControl(control: AgentConfigControl, open: boolean): void {
		selectedConfig.value = open ? control : null;
	}

	function setConnectionSelected(id: number, selected: boolean): void {
		const next = new Set(connectionIds.value);
		if (selected) next.add(id);
		else next.delete(id);
		runtime.selectConnections([...next]);
	}

	const allConnectionsSelected = computed(
		() =>
			connections.value.length > 0 &&
			connections.value.every((connection) => connectionIds.value.includes(connection.id)),
	);

	function setAllConnectionsSelected(selected: boolean): void {
		if (blocked.value) return;
		runtime.selectConnections(
			selected ? connections.value.map((connection) => connection.id).sort((left, right) => left - right) : [],
		);
	}

	const activeRun = computed(() => run.value !== null && isNativeRunActive(run.value));
	const sendDisabled = computed(
		() =>
			blocked.value ||
			!props.executionEnabled ||
			!attachmentsReady.value ||
			!scope.value ||
			!thread.value ||
			!modelKey.value ||
			!draft.value.trim() ||
			activeRun.value,
	);

	async function applyThreadSelection(): Promise<void> {
		if (applyingThreadSelection) return;
		const value = pendingThreadSelection.value;
		if (!value || !scope.value || operation.busy.value || pending.value !== null || !attachmentsReady.value) {
			return;
		}
		applyingThreadSelection = true;
		pendingThreadSelection.value = null;
		try {
			await runtime.selectThread(value);
		} finally {
			applyingThreadSelection = false;
			void applyThreadSelection();
		}
	}

	function isNearBottom(): boolean {
		const element = scroller.value;
		return !element || element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
	}

	async function scrollToBottom(): Promise<void> {
		const selectedThreadId = thread.value?.id;
		await nextTick();
		if (!props.active || thread.value?.id !== selectedThreadId) return;
		const element = scroller.value;
		if (element) element.scrollTop = element.scrollHeight;
		keepPinnedToBottom.value = true;
		showJumpToLatest.value = false;
		updateMessageNavigation();
	}

	function updateMessageNavigation(): void {
		const element = scroller.value;
		canJumpPrevious.value = !!element && element.scrollTop > 2;
		canJumpNext.value = !!element && element.scrollHeight - element.scrollTop - element.clientHeight > 2;
	}

	function isMessageStart(index: number): boolean {
		const entry = entries.value[index];
		if (!entry) return false;
		const previous = entries.value[index - 1];
		return (
			!previous ||
			previous.role !== entry.role ||
			previous.runId !== entry.runId ||
			previous.position.stepIndex !== entry.position.stepIndex ||
			(entry.role === 'user' && previous.position.eventSequence !== entry.position.eventSequence)
		);
	}

	function jumpMessage(direction: 'previous' | 'next'): void {
		const element = scroller.value;
		if (!props.active || !element) return;
		const top = element.getBoundingClientRect().top + element.clientTop;
		const padding = Number.parseFloat(getComputedStyle(element).paddingTop) || 0;
		const positions = Array.from(
			element.querySelectorAll<HTMLElement>('[data-agent-message]'),
			(message) => message.getBoundingClientRect().top - top + element.scrollTop - padding,
		);
		const target =
			direction === 'previous'
				? (positions.filter((position) => position < element.scrollTop - 2).at(-1) ?? 0)
				: (positions.find((position) => position > element.scrollTop + 2) ?? element.scrollHeight);
		keepPinnedToBottom.value = false;
		element.scrollTop = target;
		handleTranscriptScroll();
	}

	function handleTranscriptScroll(): void {
		if (!props.active) return;
		updateMessageNavigation();
		keepPinnedToBottom.value = isNearBottom();
		showJumpToLatest.value = !keepPinnedToBottom.value;
	}

	function handleTranscriptResize(): void {
		if (!props.active || transcriptFrame !== null) return;
		transcriptFrame = requestAnimationFrame(() => {
			transcriptFrame = null;
			if (!props.active) return;
			updateMessageNavigation();
			if (keepPinnedToBottom.value) void scrollToBottom();
			else showJumpToLatest.value = !isNearBottom();
		});
	}

	watch(
		scroller,
		(element) => {
			transcriptObserver?.stop();
			if (!element) return;
			transcriptObserver = useResizeObserver(element, handleTranscriptResize);
		},
		{ flush: 'post' },
	);
	watch(
		() => props.active,
		(shown) => {
			if (shown) handleTranscriptResize();
			else if (transcriptFrame !== null) {
				cancelAnimationFrame(transcriptFrame);
				transcriptFrame = null;
			}
		},
	);

	function submitComposer(): void {
		if (!thread.value || activeRun.value) {
			return;
		}
		keepPinnedToBottom.value = true;
		void runtime.send(run.value !== null);
	}

	function stopRun(): void {
		if (run.value && isNativeRunActive(run.value)) {
			void runtime.mutate({ kind: 'cancel', run: run.value });
		}
	}

	function selectNativeThread(value: NativeThread | null): void {
		threadDrawerOpen.value = false;
		pendingThreadSelection.value = value;
		if (value) void applyThreadSelection();
		else runtime.clearThread();
	}

	function removeInputArtifact(id: string): void {
		attachmentControl.value?.removeById(id);
	}

	watch(
		() => [scope.value, operation.busy.value, pending.value, attachmentsReady.value] as const,
		() => void applyThreadSelection(),
		{ flush: 'post' },
	);
	watch(
		() =>
			[
				thread.value?.id,
				entries.value.length,
				entries.value.at(-1)?.text,
				submittedMessage.value?.operationId,
				chatError.value,
			] as const,
		(value, previous) => {
			const threadId = value[0];
			const previousThreadId = previous?.[0];
			if (threadId && threadId !== previousThreadId) {
				keepPinnedToBottom.value = true;
				void scrollToBottom();
				return;
			}
			if (keepPinnedToBottom.value) void scrollToBottom();
			else showJumpToLatest.value = !isNearBottom();
			updateMessageNavigation();
		},
		{ flush: 'post' },
	);

	const runStatusClass = computed(() => {
		switch (run.value?.status) {
			case 'running':
				return 'bg-success/10 text-success';
			case 'pending':
				return 'bg-warning/10 text-warning';
			case 'failed':
				return 'bg-error/10 text-error';
			case 'unknown':
				return 'bg-warning/10 text-warning';
			default:
				return 'bg-header text-text-secondary';
		}
	});

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
			return;
		}
		event.preventDefault();
		if (event.currentTarget instanceof HTMLTextAreaElement) {
			event.currentTarget.form?.requestSubmit();
		}
	}
</script>
<template>
	<div
		ref="layoutRoot"
		class="agent-surface-layout relative grid h-full min-h-0"
		:class="{
			'is-threads-hidden': !threadSidebarVisible,
			'has-task-rail': (run && taskRailVisible) || memoryRailVisible,
		}"
		:style="layoutStyle"
	>
		<aside
			id="agent-thread-sidebar"
			class="agent-thread-sidebar ui-glass-chrome flex min-h-0 flex-col overflow-hidden border-r border-border/45"
			:class="{ 'is-open': threadDrawerOpen }"
			:inert="threadsOverlay ? !threadDrawerOpen : !threadSidebarVisible"
		>
			<NativeThreadPanel
				:app-id="appId"
				:live-thread="thread"
				:active="active"
				:resume-revision="resumeRevision"
				:disabled="operation.busy.value || bindingBusy || !!pending || !attachmentsReady"
				auto-load
				@select="selectNativeThread"
				@working="threadBusy = $event"
			/>
		</aside>
		<main class="agent-conversation-pane relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
			<div class="agent-conversation-ambient pointer-events-none absolute inset-0 z-0 opacity-70"></div>
			<header
				class="ui-glass-chrome relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3.5"
			>
				<UiButton
					density="compact"
					appearance="ghost"
					icon-only
					class="agent-header-tool agent-thread-toggle shrink-0"
					:aria-expanded="threadsOverlay ? threadDrawerOpen : threadSidebarVisible"
					aria-controls="agent-thread-sidebar"
					:aria-label="t('agent.operations.openThreads')"
					@click="
						threadsOverlay
							? (threadDrawerOpen = !threadDrawerOpen)
							: (threadSidebarVisible = !threadSidebarVisible)
					"
				>
					<i class="fa-regular fa-comments text-xs" aria-hidden="true"></i>
				</UiButton>
				<span class="truncate text-xs font-semibold tracking-tight text-foreground">{{
					thread?.title || t('agent.operations.untitledThread')
				}}</span>
				<span
					v-if="run"
					class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
					:class="runStatusClass"
					>{{ t('agent.nativeRun.states.' + run.status) }}</span
				>
				<UiButton
					v-if="run"
					density="compact"
					appearance="ghost"
					icon-only
					class="agent-header-tool relative shrink-0"
					:aria-label="t('agent.ui.toggleTasks')"
					:aria-expanded="taskRailVisible"
					aria-controls="agent-task-rail"
					@click="taskRailVisible = !taskRailVisible"
				>
					<i class="fa-solid fa-list-check text-xs" aria-hidden="true"></i>
					<span
						v-if="requestedApprovalCount"
						class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[8px] font-bold text-white"
						>{{ requestedApprovalCount }}</span
					>
				</UiButton>
				<UiButton
					v-if="thread && (memoryCount || memoryNeedsRead || memoryRailVisible)"
					density="compact"
					appearance="ghost"
					class="agent-header-tool shrink-0"
					:aria-label="t('agent.memoryReview.title')"
					:aria-expanded="memoryRailVisible"
					aria-controls="agent-memory-rail"
					@click="memoryRailVisible = !memoryRailVisible"
				>
					<i class="fa-solid fa-brain text-xs" aria-hidden="true"></i>
					<span>{{ memoryCount }}</span>
				</UiButton>
			</header>
			<!-- The transcript owns scrolling; the composer stays docked above the bottom edge. -->
			<div class="relative z-10 flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
				<UiInlineNotice
					v-if="!executionEnabled"
					class="agent-session-notice mx-auto w-full max-w-3xl"
					tone="warning"
					compact
				>
					{{ t('agent.nativeRun.executionDisabled') }}
				</UiInlineNotice>
				<UiInlineNotice
					v-if="pending && !operation.busy.value"
					class="agent-unknown-panel space-y-2.5"
					tone="warning"
				>
					<p class="text-xs font-medium">{{ t('agent.nativeRun.unknown') }}</p>
					<details class="rounded-lg bg-background/45 p-2 text-xs text-text-secondary">
						<summary class="cursor-pointer select-none">
							{{ t('agent.nativeRun.technicalDetails') }}
						</summary>
						<code class="mt-1 block break-all">{{ pending.operationId }}</code>
					</details>
					<div class="flex flex-wrap gap-2">
						<UiButton
							density="compact"
							appearance="soft"
							:disabled="operation.busy.value"
							@click="runtime.inspectIntent"
						>
							{{ t('agent.nativeRun.inspect') }}
						</UiButton>
						<UiButton
							density="compact"
							appearance="soft"
							:disabled="operation.busy.value || !inspected || operation.refreshRequired.value"
							@click="runtime.mutate(null, true)"
						>
							{{ t('agent.nativeThreads.retry') }}
						</UiButton>
					</div>
					<div class="flex items-start gap-2 text-[11px] leading-4 text-text-secondary">
						<UiCheckbox
							v-model="acknowledged"
							density="compact"
							:disabled="operation.busy.value"
							:aria-label="t('agent.nativeRun.acknowledge')"
						/>
						<span>{{ t('agent.nativeRun.acknowledge') }}</span>
					</div>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="operation.busy.value || !inspected || !acknowledged"
						@click="runtime.abandon"
					>
						{{ t('agent.nativeThreads.abandon') }}
					</UiButton>
				</UiInlineNotice>
				<UiLoadingState
					v-else-if="!thread && (operation.busy.value || (!scope && !chatError))"
					class="flex-1"
					compact
					:bordered="false"
					:title="t('agent.operations.loading')"
				/>
				<section v-if="thread" class="flex min-h-0 flex-1 flex-col gap-3">
					<p v-if="olderHidden" role="status" class="text-xs">{{ t('agent.nativeRun.windowed') }}</p>
					<div
						ref="scroller"
						class="agent-conversation-scroller min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-5 touch-pan-y"
						aria-live="polite"
						@scroll.passive="handleTranscriptScroll"
						@load.capture="handleTranscriptResize"
					>
						<AgentConversationWelcome
							v-if="!entries.length && !submittedMessage"
							:active="active"
							:draft="draft"
							@select="draft = $event"
						/>
						<template
							v-for="(entry, index) in entries"
							:key="
								[
									entry.position.runSequence,
									entry.position.stepIndex,
									entry.position.eventSequence,
									entry.position.textOffset,
								].join(':')
							"
						>
							<article
								:data-agent-message="isMessageStart(index) ? '' : undefined"
								class="mx-auto flex w-full max-w-3xl"
								:class="entry.role === 'user' ? 'justify-end' : ''"
							>
								<div
									class="min-w-0"
									:class="
										entry.role === 'user'
											? 'max-w-[80%] rounded-2xl rounded-tr-[5px] bg-primary/[0.07] px-4 py-3.5 ring-1 ring-inset ring-primary/10 shadow-2xs'
											: 'w-full'
									"
								>
									<div
										v-if="entry.role === 'assistant'"
										class="mb-2.5 flex items-center gap-2 px-1 text-[11px] text-text-secondary/70"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-primary"></span
										>{{ t('agent.nativeRun.roles.assistant') }}
									</div>
									<p
										v-if="entry.role === 'user'"
										class="whitespace-pre-wrap break-words text-[13px] leading-[1.7]"
									>
										{{ entry.text }}
									</p>
									<div
										v-else
										class="rounded-xl bg-card px-4 py-3.5 ring-1 ring-inset ring-border/30 shadow-2xs"
									>
										<AgentMessageBody :text="entry.text" />
									</div>
								</div>
							</article>
							<NativeToolActivityList
								:active="active"
								:tools="toolsByEntry.assigned.get(index) ?? []"
								:connections="connections"
							/>
							<NativeApprovalHistoryList
								:approvals="approvalsByEntry.assigned.get(index) ?? []"
								:connections="connections"
							/>
						</template>
						<article
							v-if="submittedMessage"
							data-agent-message
							class="mx-auto flex w-full max-w-3xl justify-end"
						>
							<div
								class="min-w-0 max-w-[80%] rounded-2xl rounded-tr-[5px] bg-primary/[0.07] px-4 py-3.5 ring-1 ring-inset ring-primary/10 shadow-2xs"
							>
								<p class="whitespace-pre-wrap break-words text-[13px] leading-[1.7]">
									{{ submittedMessage.text }}
								</p>
							</div>
						</article>
						<NativeToolActivityList
							:active="active"
							:tools="toolsByEntry.orphan"
							:connections="connections"
						/>
						<NativeApprovalHistoryList :approvals="approvalsByEntry.orphan" :connections="connections" />
						<div v-if="toolCursor !== null" class="mx-auto flex w-full max-w-3xl justify-center">
							<UiButton
								density="compact"
								appearance="ghost"
								:disabled="operation.busy.value"
								@click="readOlderTools"
							>
								{{ t('agent.nativeRun.toolOlder') }}
							</UiButton>
						</div>
						<UiInlineNotice v-if="chatError" class="mx-auto w-full max-w-3xl" tone="danger">
							{{ chatError }}
						</UiInlineNotice>
					</div>
					<footer class="agent-composer-footer relative z-10 shrink-0 px-4 pb-4 pt-2">
						<div class="agent-composer-area mx-auto max-w-3xl">
							<div v-if="inputArtifacts.length" class="mb-2 flex flex-wrap gap-1.5">
								<UiButton
									v-for="artifact in inputArtifacts"
									:key="artifact.id"
									density="compact"
									appearance="soft"
									class="agent-input-artifact max-w-full min-w-0 rounded-full px-3"
									:title="artifact.name"
									@click="removeInputArtifact(artifact.id)"
								>
									<i class="fa-solid fa-paperclip mr-1 shrink-0" aria-hidden="true"></i>
									<span class="agent-input-artifact-name min-w-0">{{ artifact.name }}</span>
									<span class="ml-1 shrink-0 opacity-60" aria-hidden="true">×</span>
								</UiButton>
							</div>
							<div class="agent-composer-status mb-1.5 flex min-h-6 items-center justify-between gap-2">
								<AgentConfigPopover
									v-if="usage"
									:ariaLabel="t('agent.tasks.totalTokens')"
									:title="usageDetails"
									trigger-class="agent-token-status"
									panel-class="max-w-xs text-xs text-text-secondary"
								>
									<template #trigger>
										<i class="fa-solid fa-chart-simple text-[9px]" aria-hidden="true"></i>
										<strong class="font-mono font-medium">{{ tokenLabel }}</strong>
									</template>
									<template #panel>
										<p>
											{{ t('agent.tasks.totalTokens') }}:
											{{ totalTokens === null ? '—' : formatAgentNumber(locale, totalTokens) }}
										</p>
										<p class="mt-2 leading-relaxed">{{ usageDetails }}</p>
									</template>
								</AgentConfigPopover>
								<span
									v-else
									class="agent-composer-hint min-w-0 truncate text-[11px] leading-none text-text-secondary/65 select-none"
								>
									<i class="fa-regular fa-keyboard mr-1 text-[9px] opacity-80" aria-hidden="true"></i>
									{{ t('agent.conversation.sendHint') }}
									<span class="px-1 text-text-secondary/40">·</span>
									{{ t('agent.conversation.sendHintNewline') }}
								</span>
								<div class="ml-auto flex shrink-0 items-center gap-1">
									<UiButton
										v-if="showJumpToLatest"
										density="compact"
										appearance="soft"
										class="agent-jump-latest shrink-0 rounded-full px-2.5"
										:title="t('agent.ui.latest')"
										:aria-label="t('agent.ui.latest')"
										@click="scrollToBottom"
									>
										<i class="fa-solid fa-arrow-down text-[9px]" aria-hidden="true"></i>
										<span class="agent-jump-latest-label">{{ t('agent.ui.latest') }}</span>
									</UiButton>
									<UiButton
										v-if="entries.length"
										density="compact"
										appearance="ghost"
										icon-only
										:disabled="!canJumpPrevious"
										:aria-label="t('agent.conversation.previousMessage')"
										:title="t('agent.conversation.previousMessage')"
										@click="jumpMessage('previous')"
									>
										<i class="fa-solid fa-chevron-up text-[9px]" aria-hidden="true"></i>
									</UiButton>
									<UiButton
										v-if="entries.length"
										density="compact"
										appearance="ghost"
										icon-only
										:disabled="!canJumpNext"
										:aria-label="t('agent.conversation.nextMessage')"
										:title="t('agent.conversation.nextMessage')"
										@click="jumpMessage('next')"
									>
										<i class="fa-solid fa-chevron-down text-[9px]" aria-hidden="true"></i>
									</UiButton>
								</div>
							</div>
							<form
								ref="composer"
								class="agent-composer-shell overflow-hidden rounded-xl border border-border/65 bg-card/88 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-border-hover focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15"
								@submit.prevent="submitComposer"
							>
								<textarea
									id="agent-composer"
									v-model="draft"
									rows="3"
									data-no-highlight
									class="max-h-48 min-h-24 w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-text-secondary/50"
									:disabled="blocked || !thread"
									:aria-label="t('agent.nativeRun.prompt')"
									:placeholder="t('agent.conversation.placeholder')"
									@keydown="handleComposerKeydown"
									required
								></textarea>
								<div
									class="agent-composer-toolbar ui-glass-chrome flex min-h-10 flex-nowrap items-center justify-between gap-1.5 border-t border-border/35 px-2 py-1"
								>
									<div
										class="agent-toolbar-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1"
									>
										<AgentConfigPopover
											:ariaLabel="t('agent.nativeRun.model')"
											:disabled="blocked"
											trigger-appearance="soft"
											:trigger-selected="selectedConfig === 'model'"
											:panel-class="composerWidth > 730 ? 'w-[28rem]' : 'w-80'"
											@open-change="selectConfigControl('model', $event)"
										>
											<template #trigger
												><i class="fa-solid fa-microchip text-[9px]" aria-hidden="true"></i
												><span class="agent-model-trigger-label max-w-28 truncate">{{
													selectedModel?.modelId || t('agent.nativeRun.chooseModel')
												}}</span
												><i class="fa-solid fa-chevron-down text-[7px]" aria-hidden="true"></i
											></template>
											<template #panel="{ close }">
												<div class="agent-model-picker">
													<header class="agent-model-picker__head">
														<span>{{ t('agent.nativeRun.model') }}</span>
														<span
															v-if="selectedModel"
															class="agent-model-picker__current"
															>{{ selectedModel.providerName }}</span
														>
													</header>
													<div
														v-if="models.length"
														class="agent-model-list"
														role="listbox"
														:aria-label="t('agent.nativeRun.model')"
													>
														<button
															v-for="model in models"
															:key="nativeModelKey(model)"
															type="button"
															role="option"
															class="agent-model-option"
															:aria-selected="nativeModelKey(model) === modelKey"
															:disabled="blocked"
															@click="selectModel(model, close)"
														>
															<span class="agent-model-option__mark" aria-hidden="true">
																<i class="fa-solid fa-microchip"></i>
															</span>
															<span class="agent-model-option__body">
																<strong>{{ model.modelId }}</strong>
																<small
																	>{{ model.providerName }} ·
																	{{ model.protocol }}</small
																>
															</span>
															<i
																v-if="nativeModelKey(model) === modelKey"
																class="fa-solid fa-check agent-model-option__check"
																aria-hidden="true"
															></i>
														</button>
													</div>
													<p v-else class="agent-model-picker__empty">
														{{ t('agent.nativeRun.noModels') }}
													</p>
												</div>
											</template>
										</AgentConfigPopover>
										<AgentConfigPopover
											v-if="reasoningLevels.length"
											class="agent-reasoning-control"
											:ariaLabel="t('agent.ui.reasoning')"
											:title="t('agent.ui.reasoning') + ': ' + reasoningDisplayLabel"
											:disabled="blocked"
											trigger-appearance="soft"
											:trigger-selected="selectedConfig === 'reasoning'"
											panel-class="w-56"
											@open-change="selectConfigControl('reasoning', $event)"
										>
											<template #trigger>
												<i
													class="fa-solid fa-bolt text-[9px] text-primary"
													aria-hidden="true"
												></i>
												<span
													class="agent-config-reasoning agent-reasoning-trigger-label min-w-4 whitespace-nowrap text-center"
													>{{ reasoningDisplayLabel }}</span
												>
												<i
													class="agent-config-affordance fa-solid fa-chevron-down text-[7px]"
													aria-hidden="true"
												></i>
											</template>
											<template #panel>
												<div class="space-y-2" :aria-label="t('agent.ui.reasoning')">
													<div class="flex items-center justify-between gap-2 px-0.5">
														<span class="text-[11px] font-semibold text-foreground">{{
															t('agent.ui.reasoning')
														}}</span>
														<span
															class="agent-config-reasoning text-[11px] text-text-secondary"
															>{{ reasoningDisplayLabel }}</span
														>
													</div>
													<div class="relative px-0.5">
														<div
															ref="reasoningTrack"
															class="agent-reasoning-track"
															:class="{ 'agent-reasoning-track--disabled': blocked }"
															:style="{
																'--agent-reasoning-position':
																	reasoningThumbPercent + '%',
															}"
															role="slider"
															tabindex="0"
															:aria-label="t('agent.ui.reasoning')"
															:aria-valuemin="0"
															:aria-valuemax="Math.max(0, reasoningLevels.length - 1)"
															:aria-valuenow="activeReasoningIndex"
															:aria-valuetext="reasoningDisplayLabel"
															:aria-disabled="blocked || reasoningLevels.length <= 1"
															@pointerdown="onReasoningPointerDown"
															@pointermove="onReasoningPointerMove"
															@pointerup="releaseReasoningPointer"
															@pointercancel="releaseReasoningPointer"
															@keydown="onReasoningKeydown"
														>
															<div
																class="agent-reasoning-fill"
																:class="{
																	'agent-reasoning-fill--intense': reasoningIntense,
																	'agent-reasoning-fill--dragging': reasoningDragging,
																}"
															></div>
															<div class="agent-reasoning-ticks" aria-hidden="true">
																<span
																	v-for="(level, index) in reasoningLevels"
																	:key="level"
																	class="agent-reasoning-tick"
																	:class="{
																		'agent-reasoning-tick--active':
																			index <= activeReasoningIndex,
																	}"
																></span>
															</div>
															<div
																class="agent-reasoning-thumb"
																:class="{
																	'agent-reasoning-thumb--dragging':
																		reasoningDragging,
																}"
																aria-hidden="true"
															>
																<span></span>
															</div>
														</div>
													</div>
													<p
														class="px-1 text-center text-[10.5px] leading-4 text-text-secondary"
													>
														{{ reasoningDescription }}
													</p>
												</div>
											</template>
										</AgentConfigPopover>
										<AgentConfigPopover
											class="agent-target-control"
											:ariaLabel="t('agent.nativeRun.targets')"
											:disabled="blocked"
											trigger-appearance="soft"
											:trigger-selected="selectedConfig === 'target'"
											panel-class="w-56"
											@open-change="selectConfigControl('target', $event)"
										>
											<template #trigger
												><i class="fa-solid fa-server text-[9px]" aria-hidden="true"></i
												><span class="agent-target-summary"
													><span class="agent-target-label">{{
														t('agent.nativeRun.targets')
													}}</span
													><span v-if="connectionIds.length" class="agent-target-count">
														· {{ connectionIds.length }}</span
													></span
												><i
													class="agent-target-affordance fa-solid fa-chevron-down text-[7px]"
													aria-hidden="true"
												></i
											></template>
											<template #panel>
												<fieldset class="min-w-0 text-xs">
													<legend class="mb-2 text-[11px] font-medium text-text-secondary">
														{{ t('agent.nativeRun.targets') }}
													</legend>
													<div
														v-if="connections.length"
														class="mb-2 flex items-center justify-between gap-2 rounded-lg bg-header/25 px-2 py-1.5"
													>
														<span
															class="shrink-0 text-[11px] tabular-nums text-text-secondary"
														>
															{{ connectionIds.length }} / {{ connections.length }}
														</span>
														<div class="flex shrink-0 items-center gap-1">
															<UiButton
																type="button"
																density="compact"
																appearance="ghost"
																:disabled="blocked || allConnectionsSelected"
																@click="setAllConnectionsSelected(true)"
															>
																{{ t('agent.operations.enableAllTargets') }}
															</UiButton>
															<UiButton
																type="button"
																density="compact"
																appearance="ghost"
																:disabled="blocked || connectionIds.length === 0"
																@click="setAllConnectionsSelected(false)"
															>
																{{ t('agent.operations.disableAllTargets') }}
															</UiButton>
														</div>
													</div>
													<div class="agent-target-list max-h-52 space-y-0.5 overflow-y-auto">
														<div
															v-for="connection in connections"
															:key="connection.id"
															class="agent-target-row flex items-center gap-2 rounded-lg px-1.5 py-1.5"
														>
															<UiCheckbox
																:id="`agent-target-${connection.id}`"
																:value="connection.id"
																density="compact"
																:model-value="connectionIds.includes(connection.id)"
																:disabled="blocked"
																@update:model-value="
																	setConnectionSelected(connection.id, $event)
																"
															/>
															<label
																:for="`agent-target-${connection.id}`"
																class="min-w-0 flex-1 cursor-pointer truncate text-[11px] text-foreground"
																>{{ connection.name }}</label
															>
														</div>
														<UiEmptyState
															v-if="connections.length === 0"
															compact
															:bordered="false"
															icon="fa-solid fa-server"
															:title="t('agent.operations.noTargets')"
														/>
													</div>
												</fieldset>
											</template>
										</AgentConfigPopover>
										<!-- Run 级批准策略：新 Run 创建时冻结，运行中只读 -->
										<AgentConfigPopover
											:disabled="blocked || activeRun"
											:trigger-selected="selectedConfig === 'approval'"
											@open-change="selectConfigControl('approval', $event)"
											:ariaLabel="t('agent.operations.approvalMode')"
											:title="`${t('agent.operations.approvalModeHint')}: ${
												approvalMode === 'full_access'
													? t('agent.operations.approvalFullAccess')
													: t('agent.operations.approvalAsk')
											}`"
											panel-class="w-56"
										>
											<template #trigger>
												<i
													class="fa-solid fa-shield-halved text-[9px]"
													:class="
														approvalMode === 'full_access' ? 'text-warning' : 'text-success'
													"
													aria-hidden="true"
												></i>
												<span
													class="agent-config-verbose max-w-24 truncate whitespace-nowrap text-left"
												>
													{{
														approvalMode === 'full_access'
															? t('agent.operations.approvalFullAccess')
															: t('agent.operations.approvalAsk')
													}}
												</span>
												<i
													:class="activeRun ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
													class="agent-config-affordance text-[11px] text-text-secondary"
													aria-hidden="true"
												></i>
											</template>
											<template #panel="{ close }">
												<div class="space-y-1">
													<UiButton
														appearance="ghost"
														density="compact"
														block
														class="flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-default"
														:class="
															approvalMode === 'ask'
																? 'border-success/25 bg-success/[0.06] text-foreground'
																: 'border-transparent text-text-secondary hover:bg-card/70'
														"
														:disabled="blocked || activeRun"
														@click="
															approvalMode = 'ask';
															close(true);
														"
													>
														<span
															class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
														>
															<i
																class="fa-solid fa-hand text-[9px] text-success"
																aria-hidden="true"
															></i>
														</span>
														<span
															class="min-w-0 flex-1 text-xs font-semibold text-foreground"
															>{{ t('agent.operations.approvalAsk') }}</span
														>
														<i
															v-if="approvalMode === 'ask'"
															class="fa-solid fa-check text-[9px] text-success"
															aria-hidden="true"
														></i>
													</UiButton>
													<UiButton
														appearance="ghost"
														density="compact"
														block
														class="flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-default"
														:class="
															approvalMode === 'full_access'
																? 'border-warning/25 bg-warning/[0.06] text-foreground'
																: 'border-transparent text-text-secondary hover:bg-card/70'
														"
														:disabled="blocked || activeRun"
														@click="
															approvalMode = 'full_access';
															close(true);
														"
													>
														<span
															class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
														>
															<i
																class="fa-solid fa-bolt text-[9px] text-warning"
																aria-hidden="true"
															></i>
														</span>
														<span
															class="min-w-0 flex-1 text-xs font-semibold text-foreground"
															>{{ t('agent.operations.approvalFullAccess') }}</span
														>
														<i
															v-if="approvalMode === 'full_access'"
															class="fa-solid fa-check text-[9px] text-warning"
															aria-hidden="true"
														></i>
													</UiButton>
												</div>
											</template>
										</AgentConfigPopover>
									</div>
									<div class="agent-composer-actions flex shrink-0 items-center gap-1.5">
										<NativeInputArtifacts
											ref="attachmentControl"
											:key="thread.id"
											:app-id="appId"
											:app-names="appNames"
											:thread-id="thread.id"
											:active="active"
											:disabled="blocked"
											@working="bindingBusy = $event"
											@ready="
												(ready, references) => {
													attachmentsReady = ready;
													inputArtifacts = references;
												}
											"
										/>
										<UiButton
											v-if="activeRun"
											density="compact"
											appearance="soft"
											tone="danger"
											icon-only
											class="agent-stop-button shrink-0"
											:aria-label="t('agent.conversation.cancelRun')"
											:title="t('agent.conversation.cancelRun')"
											:disabled="blocked"
											@click="stopRun"
										>
											<i class="fa-solid fa-stop text-[10px]" aria-hidden="true"></i>
										</UiButton>
										<UiButton
											v-else
											type="submit"
											density="compact"
											appearance="solid"
											tone="primary"
											class="agent-send-button shrink-0"
											:aria-label="t('agent.conversation.send')"
											:title="
												sendDisabled
													? draft.trim()
														? t('agent.conversation.sendBusyHint')
														: t('agent.conversation.sendEmptyHint')
													: t('agent.conversation.send')
											"
											:disabled="sendDisabled"
										>
											<span class="agent-send-label">{{ t('agent.conversation.send') }}</span>
											<i class="fa-solid fa-arrow-up text-xs" aria-hidden="true"></i>
										</UiButton>
									</div>
								</div>
							</form>
						</div>
					</footer>
				</section>
				<UiInlineNotice v-if="!thread && chatError" class="mx-auto mt-auto w-full max-w-3xl" tone="danger">
					{{ chatError }}
				</UiInlineNotice>
			</div>
		</main>
		<button
			v-if="(run && taskRailVisible) || memoryRailVisible"
			type="button"
			class="agent-task-backdrop absolute inset-0 z-20 hidden bg-black/20"
			:aria-label="t('common.close')"
			@click="
				taskRailVisible = false;
				memoryRailVisible = false;
			"
		></button>
		<NativeMemoryReview
			v-if="thread"
			:key="thread.id"
			:app-id="appId"
			:thread-id="thread.id"
			:active="active"
			:visible="memoryRailVisible"
			class="agent-task-rail ui-glass-chrome min-h-0 overflow-y-auto border-l border-border/50 p-3"
			@close="memoryRailVisible = false"
			@proposed="memoryProposed"
			@summary="memorySummary"
		/>
		<aside
			v-if="run && taskRailVisible"
			id="agent-task-rail"
			class="agent-task-rail ui-glass-chrome min-h-0 overflow-y-auto border-l border-border/50 p-3"
			:aria-label="t('agent.tasks.title')"
		>
			<button
				type="button"
				class="agent-task-rail-resize"
				:aria-label="t('agent.tasks.resize')"
				:title="t('agent.tasks.resize')"
				@pointerdown.prevent="taskRailResize.startResize"
			></button>
			<header class="mb-3 flex items-center justify-between border-b border-border/50 pb-2">
				<h3 class="flex items-center gap-2 text-xs font-semibold">
					{{ t('agent.tasks.title') }}
					<span
						v-if="requestedApprovalCount"
						class="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
						>{{ requestedApprovalCount }}</span
					>
				</h3>
				<UiButton
					density="compact"
					appearance="ghost"
					icon-only
					:aria-label="t('common.close')"
					@click="taskRailVisible = false"
				>
					<i class="fa-solid fa-xmark" aria-hidden="true"></i>
				</UiButton>
			</header>
			<NativeApprovalList
				v-if="pendingApprovals.length"
				class="mb-3"
				:approvals="pendingApprovals"
				:connections="connections"
				:disabled="operation.busy.value || threadBusy"
				@mutate="runtime.mutate"
			/>
			<NativeRunDetails
				:key="run.id"
				:run="run"
				:events="events"
				:children="children"
				:child="child"
				:messages="messages"
				:disabled="blocked"
				@mutate="runtime.mutate($event)"
				@messages="runtime.readMessages"
			/>
		</aside>
		<button
			v-if="threadsOverlay && threadDrawerOpen"
			type="button"
			class="agent-thread-backdrop absolute inset-0 z-20 bg-black/20"
			:aria-label="t('common.close')"
			@click="threadDrawerOpen = false"
		></button>
	</div>
</template>

<style scoped src="./AgentAppSurface.css"></style>
