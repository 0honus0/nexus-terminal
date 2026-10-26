<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiInput, UiNumberInput } from '@/foundation/ui';
	import type { UiTone } from '@/foundation/ui';
	import { AGENT_RUN_STEP_MAX_COUNT } from '@nexus-terminal/shared/agent/runs/values';
	import { getNativeStep, listNativeStepEvents, getNativeTool, listNativeToolEvents } from '../api/native-audit-api';
	import { toolCommandPreview } from './native-tool-summary';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type { NativeStep, NativeStepEvent, NativeTool, NativeToolEvent } from '../model/native-run-types';

	const props = defineProps<{
		appId: string;
		runId: string;
		active: boolean;
		disabled: boolean;
		initialToolId?: string;
	}>();
	const { t } = useI18n();
	const stepIndex = ref(1);
	const toolId = ref(props.initialToolId ?? '');
	const step = ref<NativeStep | null>(null);
	const tool = ref<NativeTool | null>(null);
	const toolCommand = computed(() => (tool.value ? toolCommandPreview(tool.value.summary) : null));
	const stepEvents = ref<NativeStepEvent[]>([]);
	const toolEvents = ref<NativeToolEvent[]>([]);
	const stepCursor = ref(0);
	const toolCursor = ref(0);
	const open = ref(false);
	const details = ref<HTMLDetailsElement | null>(null);
	let stepTimer: ReturnType<typeof setTimeout> | null = null;

	function stepTone(state: NativeStep['state']): UiTone {
		if (state === 'completed') return 'success';
		if (state === 'failed') return 'danger';
		if (state === 'reserved') return 'neutral';
		return 'warning';
	}

	function toolTone(state: NativeTool['state']): UiTone {
		if (state === 'completed') return 'success';
		if (state === 'failed') return 'danger';
		if (state === 'unknown') return 'warning';
		if (state === 'cancelled') return 'neutral';
		return 'primary';
	}

	function riskTone(risk: NativeTool['risk']): UiTone {
		if (risk === 'read') return 'success';
		if (risk === 'mutate' || risk === 'control') return 'warning';
		return 'danger';
	}

	function setStepIndex(value: string | number | null): void {
		const parsed = typeof value === 'number' ? value : Number(value);
		if (!Number.isFinite(parsed)) return;
		stepIndex.value = Math.min(AGENT_RUN_STEP_MAX_COUNT, Math.max(1, Math.trunc(parsed)));
	}

	const operation = useAgentManagementOperation(
		() => {
			step.value = null;
			tool.value = null;
			stepEvents.value = [];
			toolEvents.value = [];
			stepCursor.value = 0;
			toolCursor.value = 0;
			toolId.value = '';
			stepIndex.value = 1;
		},
		() => props.active,
		{ retainOnView: true },
	);

	async function readStep(more = false): Promise<void> {
		if (props.disabled) return;
		const index = more && step.value ? step.value.stepIndex : stepIndex.value;
		const after = more ? stepCursor.value : 0;
		await operation.execute(
			async (signal) => {
				const result = await getNativeStep(props.appId, props.runId, index, signal);
				const page = await listNativeStepEvents(props.appId, props.runId, index, after, signal);
				return { result, page };
			},
			({ result, page }) => {
				step.value = result;
				stepEvents.value = more ? [...stepEvents.value, ...page.items] : page.items;
				stepCursor.value = page.nextCursor;
			},
			{ write: false },
		);
	}

	async function initializeAudit(): Promise<void> {
		if (operation.busy.value) return;
		await readStep();
		if (toolId.value && !tool.value && !operation.busy.value) await readTool();
	}

	function handleToggle(event: Event): void {
		if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
		open.value = event.currentTarget.open;
		if (open.value) void initializeAudit();
	}

	async function revealAudit(): Promise<void> {
		await nextTick();
		if (details.value) details.value.open = true;
		open.value = true;
		await initializeAudit();
		details.value?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
	}

	onMounted(() => {
		if (props.initialToolId) void revealAudit();
	});

	watch(
		() => props.initialToolId,
		(id) => {
			if (!id) return;
			toolId.value = id;
			tool.value = null;
			toolCursor.value = 0;
			void revealAudit();
		},
	);

	watch(stepIndex, () => {
		if (!open.value || props.disabled || operation.busy.value) return;
		if (stepTimer !== null) clearTimeout(stepTimer);
		stepTimer = setTimeout(() => {
			stepTimer = null;
			void readStep();
		}, 350);
	});

	onBeforeUnmount(() => {
		if (stepTimer !== null) clearTimeout(stepTimer);
	});

	async function readTool(more = false): Promise<void> {
		if (props.disabled) return;
		const id = more && tool.value ? tool.value.id : toolId.value;
		const after = more ? toolCursor.value : 0;
		await operation.execute(
			async (signal) => {
				const result = await getNativeTool(props.appId, props.runId, id, signal);
				const page = await listNativeToolEvents(props.appId, props.runId, id, after, signal);
				return { result, page };
			},
			({ result, page }) => {
				tool.value = result;
				toolEvents.value = more ? [...toolEvents.value, ...page.items] : page.items;
				toolCursor.value = page.nextCursor;
			},
			{ write: false },
		);
	}
</script>
<template>
	<details ref="details" class="group/audit rounded-xl border border-border/55 bg-card/70 p-3" @toggle="handleToggle">
		<summary
			class="flex cursor-pointer list-none items-center gap-2.5 rounded-lg text-xs font-medium text-foreground select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
		>
			<span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
				<i class="fa-solid fa-list-check text-[9px]" aria-hidden="true"></i>
			</span>
			<span class="min-w-0 flex-1 truncate">{{ t('agent.nativeRun.audit') }}</span>
			<span class="flex h-5 w-5 shrink-0 items-center justify-center text-text-secondary/55">
				<i
					class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/audit:rotate-180"
					aria-hidden="true"
				></i>
			</span>
		</summary>
		<div class="mt-2.5 space-y-3">
			<p
				class="flex items-start gap-2 rounded-lg bg-background/45 px-2.5 py-2 text-[10px] leading-4 text-text-secondary"
			>
				<i class="fa-regular fa-circle-info mt-0.5 shrink-0 text-[9px] text-primary/70" aria-hidden="true"></i>
				<span class="min-w-0">{{ t('agent.nativeRun.auditHelp') }}</span>
			</p>

			<section class="rounded-xl bg-background/35 p-2.5 ring-1 ring-inset ring-border/30">
				<header class="flex items-center gap-2">
					<span class="flex h-4 w-4 items-center justify-center rounded bg-primary/10 text-primary">
						<i class="fa-solid fa-list-ol text-[8px]" aria-hidden="true"></i>
					</span>
					<h6 class="text-[11px] font-semibold text-foreground">{{ t('agent.nativeRun.auditStep') }}</h6>
				</header>
				<form class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="readStep()">
					<label class="flex min-w-0 items-center gap-2 text-[10px] text-text-secondary">
						<span class="shrink-0">{{ t('agent.nativeRun.step') }}</span>
						<UiNumberInput
							:model-value="stepIndex"
							min="1"
							:max="AGENT_RUN_STEP_MAX_COUNT"
							density="compact"
							class="w-20"
							:aria-label="t('agent.nativeRun.step')"
							@update:model-value="setStepIndex"
						/>
					</label>
				</form>
				<div v-if="step" class="mt-2.5 space-y-2">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<UiBadge appearance="soft" tone="neutral" density="compact">#{{ step.stepIndex }}</UiBadge>
						<UiBadge :tone="stepTone(step.state)" appearance="soft" density="compact">
							{{ t('agent.nativeRun.stepStates.' + step.state) }}
						</UiBadge>
						<span class="font-mono text-[10px] text-text-secondary">
							v{{ step.revision }} · {{ step.textBytes }} bytes
						</span>
					</div>
					<p v-if="step.inputTokens !== undefined" class="font-mono text-[10px] text-text-secondary/75">
						{{ t('agent.nativeRun.tokens') }}: {{ step.inputTokens }} / {{ step.outputTokens }}
					</p>
					<div
						v-if="stepEvents.length"
						class="max-h-44 overflow-auto rounded-lg bg-background/45 ring-1 ring-inset ring-border/25"
					>
						<ul class="divide-y divide-border/20">
							<li
								v-for="event in stepEvents"
								:key="event.sequence"
								class="flex items-center gap-2 px-2.5 py-1.5 text-[10px]"
							>
								<span class="shrink-0 font-mono text-text-secondary/75">#{{ event.sequence }}</span>
								<span class="min-w-0 flex-1 truncate font-mono text-foreground/75" :title="event.kind">
									{{ event.kind }}
								</span>
								<span
									v-if="event.kind === 'text.delta'"
									class="shrink-0 tabular-nums text-text-secondary/75"
								>
									{{ event.textBytes }} B
								</span>
								<span
									v-else-if="event.kind === 'usage'"
									class="shrink-0 tabular-nums text-text-secondary/75"
								>
									{{ event.inputTokens }} / {{ event.outputTokens }}
								</span>
							</li>
						</ul>
					</div>
					<div class="flex justify-end">
						<UiButton
							type="button"
							density="compact"
							appearance="ghost"
							:disabled="disabled || operation.busy.value"
							@click="readStep(true)"
						>
							{{ t('agent.nativeRun.moreEvents') }}
						</UiButton>
					</div>
				</div>
			</section>

			<section class="rounded-xl bg-background/35 p-2.5 ring-1 ring-inset ring-border/30">
				<header class="flex items-center gap-2">
					<span class="flex h-4 w-4 items-center justify-center rounded bg-primary/10 text-primary">
						<i class="fa-solid fa-screwdriver-wrench text-[8px]" aria-hidden="true"></i>
					</span>
					<h6 class="text-[11px] font-semibold text-foreground">{{ t('agent.nativeRun.auditTool') }}</h6>
				</header>
				<form class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="readTool()">
					<label class="flex min-w-0 flex-1 items-center gap-2 text-[10px] text-text-secondary">
						<span class="shrink-0">{{ t('agent.nativeRun.toolId') }}</span>
						<UiInput
							v-model="toolId"
							density="compact"
							class="min-w-0 flex-1 font-mono"
							required
							:aria-label="t('agent.nativeRun.toolId')"
						/>
					</label>
				</form>
				<div v-if="tool" class="mt-2.5 space-y-2">
					<div class="flex flex-wrap items-center gap-1.5">
						<code
							class="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] font-semibold text-foreground ring-1 ring-inset ring-border/25"
						>
							{{ tool.toolName }}
						</code>
						<UiBadge :tone="toolTone(tool.state)" appearance="soft" density="compact">
							{{ t('agent.nativeRun.toolStates.' + tool.state) }}
						</UiBadge>
						<UiBadge appearance="ghost" tone="neutral" density="compact" class="font-mono">
							{{ tool.capability }}
						</UiBadge>
						<UiBadge :tone="riskTone(tool.risk)" appearance="soft" density="compact">
							{{ t('agent.approvals.risk.' + tool.risk) }}
						</UiBadge>
					</div>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-text-secondary">
						<span>{{ t('agent.nativeRun.target') }}: {{ tool.targetId ?? '—' }}</span>
						<span>v{{ tool.revision }}</span>
					</div>
					<div
						class="flex items-start gap-2 rounded-lg bg-background/45 px-2.5 py-2 ring-1 ring-inset ring-border/25"
					>
						<i
							class="fa-solid fa-fingerprint mt-0.5 shrink-0 text-[9px] text-text-secondary/55"
							aria-hidden="true"
						></i>
						<code class="min-w-0 break-all font-mono text-[10px] leading-4 text-text-secondary/80">
							{{ tool.operationHash }}
						</code>
					</div>
					<div v-if="toolCommand" class="space-y-1.5">
						<p class="flex items-center gap-1.5 text-[10px] text-text-secondary/75">
							<i class="fa-solid fa-terminal text-[8px]" aria-hidden="true"></i>
							{{ t('agent.approvals.command') }}
						</p>
						<pre
							class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 px-2.5 py-2 font-mono text-[10px] leading-4 text-foreground/85 ring-1 ring-inset ring-border/30"
							>{{ toolCommand.text }}</pre>
						<p v-if="toolCommand.truncated" class="text-[10px] text-warning">
							{{ t('agent.approvals.commandTruncated') }}
						</p>
					</div>
					<div
						v-if="toolEvents.length"
						class="max-h-44 overflow-auto rounded-lg bg-background/45 ring-1 ring-inset ring-border/25"
					>
						<ul class="divide-y divide-border/20">
							<li
								v-for="event in toolEvents"
								:key="event.revision"
								class="flex items-center gap-2 px-2.5 py-1.5 text-[10px]"
							>
								<span class="shrink-0 font-mono text-text-secondary/75">#{{ event.revision }}</span>
								<UiBadge :tone="toolTone(event.state)" appearance="ghost" density="compact">
									{{ t('agent.nativeRun.toolStates.' + event.state) }}
								</UiBadge>
								<span
									class="min-w-0 truncate font-mono text-text-secondary/70"
									:title="event.operationHash"
								>
									{{ event.operationHash }}
								</span>
							</li>
						</ul>
					</div>
					<div class="flex justify-end">
						<UiButton
							type="button"
							density="compact"
							appearance="ghost"
							:disabled="disabled || operation.busy.value"
							@click="readTool(true)"
						>
							{{ t('agent.nativeRun.moreEvents') }}
						</UiButton>
					</div>
				</div>
			</section>
		</div>
	</details>
</template>
