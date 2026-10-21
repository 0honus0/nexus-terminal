<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { UiButton } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import { useNativeRuns } from '../composables/use-native-runs';
	import { isNativeRunActive, nativeModelKey } from '../model/native-run-rules';
	import NativeThreadPanel from './NativeThreadPanel.vue';
	import NativeInputArtifacts from '../files/NativeInputArtifacts.vue';
	import AgentConfigPopover from '../files/AgentConfigPopover.vue';
	import NativeRunDetails from '../runtime/NativeRunDetails.vue';
	import NativeApprovalList from '../runtime/NativeApprovalList.vue';
	import AgentMessageBody from '../ai/AgentMessageBody.vue';
	import AgentConversationWelcome from '../ai/AgentConversationWelcome.vue';
	import type { NativeThread } from '../model/native-thread-types';

	const props = defineProps<{
		appId: string;
		appVersion: number;
		appNames?: Record<string, string>;
		executionEnabled: boolean;
		active: boolean;
	}>();
	const { t } = useI18n();
	const layoutRoot = ref<HTMLElement | null>(null);
	const threadsOverlay = ref(false);
	const threadSidebarVisible = ref(true);
	const threadDrawerOpen = ref(false);
	const taskRailVisible = ref(false);
	const auditToolId = ref('');
	const pendingThreadSelection = ref<NativeThread | null>(null);
	const scroller = ref<HTMLElement | null>(null);
	const attachmentControl = ref<{ removeById(id: string): void } | null>(null);
	const showJumpToLatest = ref(false);
	const keepPinnedToBottom = ref(true);
	let applyingThreadSelection = false;
	let layoutObserver: ResizeObserver | null = null;

	onMounted(() => {
		if (!layoutRoot.value) {
			return;
		}
		threadsOverlay.value = layoutRoot.value.clientWidth <= 760;
		layoutObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				threadsOverlay.value = entry.contentRect.width <= 760;
			}
		});
		layoutObserver.observe(layoutRoot.value);
	});
	onBeforeUnmount(() => layoutObserver?.disconnect());

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
		connections,
		connectionIds,
		draft,
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
		blocked,
		inputArtifacts,
		attachmentsReady,
	} = runtime;

	watch(
		() => run.value?.id,
		() => {
			auditToolId.value = '';
		},
	);

	const selectedModel = computed(() => models.value.find((model) => nativeModelKey(model) === modelKey.value));
	const activeRun = computed(() => run.value !== null && isNativeRunActive(run.value));
	const hasMoreEntries = computed(() => Object.values(entryCursor.value).some((value) => value > 0));
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
		await nextTick();
		const element = scroller.value;
		if (element) element.scrollTop = element.scrollHeight;
		keepPinnedToBottom.value = true;
		showJumpToLatest.value = false;
	}

	function handleTranscriptScroll(): void {
		keepPinnedToBottom.value = isNearBottom();
		showJumpToLatest.value = !keepPinnedToBottom.value;
	}

	function submitComposer(): void {
		if (!thread.value || activeRun.value) {
			return;
		}
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
		() => [thread.value?.id, entries.value.length, entries.value.at(-1)?.text] as const,
		(value, previous) => {
			const threadId = value[0];
			const previousThreadId = previous?.[0];
			if (threadId && threadId !== previousThreadId) {
				keepPinnedToBottom.value = true;
				void scrollToBottom();
				return;
			}
			if (keepPinnedToBottom.value) void scrollToBottom();
			else showJumpToLatest.value = true;
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
		:class="{ 'is-threads-hidden': !threadSidebarVisible, 'has-task-rail': run && taskRailVisible }"
	>
		<aside
			id="agent-thread-sidebar"
			class="agent-thread-sidebar flex min-h-0 flex-col overflow-hidden border-r border-border/45 bg-header/30 backdrop-blur-xs"
			:class="{ 'is-open': threadDrawerOpen }"
			:inert="threadsOverlay ? !threadDrawerOpen : !threadSidebarVisible"
		>
			<NativeThreadPanel
				:app-id="appId"
				:active="active"
				:disabled="operation.busy.value || bindingBusy || !!pending || !attachmentsReady"
				auto-load
				@select="selectNativeThread"
				@working="threadBusy = $event"
			/>
		</aside>
		<main class="agent-conversation-pane relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
			<div class="agent-conversation-ambient pointer-events-none absolute inset-0 z-0 opacity-70"></div>
			<header
				class="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-header/40 px-3.5 backdrop-blur-xs"
			>
				<button
					type="button"
					class="agent-thread-toggle flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-text-secondary hover:bg-header hover:text-foreground"
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
				</button>
				<span class="truncate text-xs font-semibold tracking-tight text-foreground">{{
					thread?.title || t('agent.operations.untitledThread')
				}}</span>
				<span
					v-if="run"
					class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
					:class="runStatusClass"
					>{{ t('agent.nativeRun.states.' + run.status) }}</span
				>
				<button
					v-if="run"
					type="button"
					class="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-text-secondary hover:bg-header hover:text-foreground"
					:aria-label="t('agent.ui.toggleTasks')"
					:aria-expanded="taskRailVisible"
					aria-controls="agent-task-rail"
					@click="taskRailVisible = !taskRailVisible"
				>
					<i class="fa-solid fa-list-check text-xs" aria-hidden="true"></i>
				</button>
			</header>
			<!-- The transcript owns scrolling; the composer stays docked above the bottom edge. -->
			<div class="relative z-10 flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
				<p v-if="!executionEnabled" role="status">{{ t('agent.nativeRun.executionDisabled') }}</p>
				<p v-if="operation.notice.value && operation.notice.value !== 'saved'" role="status">
					{{ t('agent.settings.appManagement.' + operation.notice.value) }}
				</p>
				<section v-if="pending" class="space-y-2 rounded border border-warning p-3">
					<p>{{ t('agent.nativeRun.unknown') }}</p>
					<details class="text-xs text-text-secondary">
						<summary class="cursor-pointer select-none">
							{{ t('agent.nativeRun.technicalDetails') }}
						</summary>
						<code class="mt-1 block break-all">{{ pending.operationId }}</code>
					</details>
					<div class="flex flex-wrap gap-3">
						<UiButton :disabled="operation.busy.value" @click="runtime.inspectIntent">
							{{ t('agent.nativeRun.inspect') }}</UiButton
						><UiButton
							:disabled="operation.busy.value || !inspected || operation.refreshRequired.value"
							@click="runtime.mutate(null, true)"
						>
							{{ t('agent.nativeThreads.retry') }}
						</UiButton>
					</div>
					<label class="flex gap-2"
						><input v-model="acknowledged" type="checkbox" :disabled="operation.busy.value" />{{
							t('agent.nativeRun.acknowledge')
						}}</label
					><UiButton :disabled="operation.busy.value || !inspected || !acknowledged" @click="runtime.abandon">
						{{ t('agent.nativeThreads.abandon') }}
					</UiButton>
				</section>
				<div
					v-else-if="operation.busy.value || !scope"
					class="flex flex-1 items-center justify-center gap-2 text-xs text-text-secondary"
					role="status"
				>
					<i class="fa-solid fa-circle-notch fa-spin text-[11px]" aria-hidden="true"></i>
					{{ t('agent.operations.loading') }}
				</div>
				<section v-if="thread" class="flex min-h-0 flex-1 flex-col gap-3">
					<p v-if="olderHidden" role="status" class="text-xs">{{ t('agent.nativeRun.windowed') }}</p>
					<div
						ref="scroller"
						class="agent-conversation-scroller min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-5 touch-pan-y"
						aria-live="polite"
						@scroll.passive="handleTranscriptScroll"
					>
						<div v-if="hasMoreEntries" class="mx-auto mb-4 flex max-w-3xl justify-center">
							<button
								type="button"
								class="rounded-full bg-card/80 px-3.5 py-2 text-xs text-text-secondary shadow-sm hover:bg-header hover:text-foreground disabled:opacity-50"
								:disabled="operation.busy.value || threadBusy"
								@click="runtime.readEntries"
							>
								<i class="fa-solid fa-clock-rotate-left mr-1.5" aria-hidden="true"></i>
								{{ t('agent.conversation.loadOlder') }}
							</button>
						</div>
						<AgentConversationWelcome
							v-if="!entries.length"
							:active="active"
							:draft="draft"
							@select="draft = $event"
						/>
						<article
							v-for="entry in entries"
							:key="
								[
									entry.position.runSequence,
									entry.position.stepIndex,
									entry.position.eventSequence,
									entry.position.textOffset,
								].join(':')
							"
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
						<div v-if="run" class="mx-auto max-w-3xl">
							<NativeApprovalList
								:key="run.id"
								:approvals="approvals"
								:connections="connections"
								:disabled="operation.busy.value || threadBusy"
								@mutate="runtime.mutate"
								@inspect="
									auditToolId = $event;
									taskRailVisible = true;
								"
							/>
						</div>
					</div>
					<footer
						class="agent-composer-footer relative z-10 shrink-0 bg-background/90 px-4 pb-4 pt-2 backdrop-blur-xs"
					>
						<div class="mx-auto max-w-3xl">
							<div v-if="inputArtifacts.length" class="mb-2 flex flex-wrap gap-1.5">
								<button
									v-for="artifact in inputArtifacts"
									:key="artifact.id"
									type="button"
									class="max-w-56 truncate rounded-full bg-background/80 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-header hover:text-foreground"
									:title="artifact.name"
									@click="removeInputArtifact(artifact.id)"
								>
									<i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>{{ artifact.name }}
									<span class="ml-1 opacity-60" aria-hidden="true">×</span>
								</button>
							</div>
							<div class="agent-composer-status mb-1.5 flex min-h-6 items-center justify-between gap-2">
								<span
									class="agent-composer-hint min-w-0 truncate text-[11px] leading-none text-text-secondary/65 select-none"
								>
									<i class="fa-regular fa-keyboard mr-1 text-[9px] opacity-80" aria-hidden="true"></i>
									{{ t('agent.conversation.sendHint') }}
									<span class="px-1 text-text-secondary/40">·</span>
									{{ t('agent.conversation.sendHintNewline') }}
								</span>
								<button
									v-if="showJumpToLatest"
									type="button"
									class="agent-jump-latest inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 text-[11px] text-text-secondary shadow-xs backdrop-blur-md transition-colors hover:bg-header hover:text-foreground"
									:title="t('agent.ui.latest')"
									:aria-label="t('agent.ui.latest')"
									@click="scrollToBottom"
								>
									<i class="fa-solid fa-arrow-down text-[9px]" aria-hidden="true"></i>
									<span class="agent-jump-latest-label">{{ t('agent.ui.latest') }}</span>
								</button>
							</div>
							<form
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
									class="agent-composer-toolbar flex min-h-10 flex-nowrap items-center justify-between gap-1.5 border-t border-border/35 bg-header/25 px-2 py-1 backdrop-blur-xs"
								>
									<div
										class="agent-toolbar-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1"
									>
										<AgentConfigPopover
											:ariaLabel="t('agent.nativeRun.model')"
											:disabled="blocked"
											panel-class="w-72"
										>
											<template #trigger
												><i class="fa-solid fa-microchip text-[9px]" aria-hidden="true"></i
												><span class="max-w-28 truncate">{{
													selectedModel?.modelId || t('agent.nativeRun.chooseModel')
												}}</span
												><i class="fa-solid fa-chevron-down text-[7px]" aria-hidden="true"></i
											></template>
											<template #panel>
												<label class="block text-sm"
													>{{ t('agent.nativeRun.model')
													}}<select
														v-model="modelKey"
														class="ml-2 max-w-full rounded border bg-background p-2"
														:disabled="blocked"
													>
														<option value="">{{ t('agent.nativeRun.chooseModel') }}</option>
														<option
															v-for="model in models"
															:key="nativeModelKey(model)"
															:value="nativeModelKey(model)"
														>
															{{ model.providerName }} / {{ model.modelId }}
														</option>
													</select></label
												>
											</template>
										</AgentConfigPopover>
										<AgentConfigPopover
											:ariaLabel="t('agent.nativeRun.targets')"
											:disabled="blocked"
											panel-class="w-72"
										>
											<template #trigger
												><i class="fa-solid fa-server text-[9px]" aria-hidden="true"></i
												><span
													>{{ t('agent.nativeRun.targets')
													}}<span v-if="connectionIds.length">
														· {{ connectionIds.length }}</span
													></span
												><i class="fa-solid fa-chevron-down text-[7px]" aria-hidden="true"></i
											></template>
											<template #panel>
												<fieldset :disabled="blocked" class="max-h-32 overflow-auto text-xs">
													<legend>{{ t('agent.nativeRun.targets') }}</legend>
													<label
														v-for="connection in connections"
														:key="connection.id"
														class="mr-3 inline-flex gap-1"
														><input
															v-model="connectionIds"
															type="checkbox"
															:value="connection.id"
														/>{{ connection.name }}</label
													>
												</fieldset></template
											>
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
										<button
											v-if="activeRun"
											type="button"
											class="agent-stop-button flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-error/45 bg-error/10 text-[11px] font-semibold text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-50"
											:aria-label="t('agent.conversation.cancelRun')"
											:title="t('agent.conversation.cancelRun')"
											:disabled="blocked"
											@click="stopRun"
										>
											<i class="fa-solid fa-stop text-[10px] text-error" aria-hidden="true"></i>
										</button>
										<button
											v-else
											type="submit"
											class="agent-send-button flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-white shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:border disabled:border-border/70 disabled:bg-foreground/[0.07] disabled:text-text-secondary disabled:opacity-50 disabled:shadow-none"
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
										</button>
									</div>
								</div>
							</form>
						</div>
					</footer>
				</section>
			</div>
		</main>
		<button
			v-if="run && taskRailVisible"
			type="button"
			class="agent-task-backdrop absolute inset-0 z-20 hidden bg-black/20"
			:aria-label="t('common.close')"
			@click="taskRailVisible = false"
		></button>
		<aside
			v-if="run && taskRailVisible"
			id="agent-task-rail"
			class="agent-task-rail min-h-0 overflow-y-auto border-l border-border/50 bg-background p-3"
			:aria-label="t('agent.tasks.title')"
		>
			<header class="mb-3 flex items-center justify-between border-b border-border/50 pb-2">
				<h3 class="text-xs font-semibold">{{ t('agent.tasks.title') }}</h3>
				<button type="button" :aria-label="t('common.close')" @click="taskRailVisible = false">
					<i class="fa-solid fa-xmark" aria-hidden="true"></i>
				</button>
			</header>
			<NativeRunDetails
				:key="run.id"
				:app-id="appId"
				:run="run"
				:events="events"
				:audit-tool-id="auditToolId"
				:children="children"
				:child="child"
				:messages="messages"
				:active="active"
				:disabled="blocked"
				@refresh="runtime.refreshRun"
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
