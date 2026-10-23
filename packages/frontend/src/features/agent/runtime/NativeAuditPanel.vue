<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiNumberInput } from '@/foundation/ui';
	import { AGENT_RUN_STEP_MAX_COUNT } from '@nexus-terminal/shared/agent/runs/values';
	import { getNativeStep, listNativeStepEvents, getNativeTool, listNativeToolEvents } from '../api/native-audit-api';
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
	const stepEvents = ref<NativeStepEvent[]>([]);
	const toolEvents = ref<NativeToolEvent[]>([]);
	const stepCursor = ref(0);
	const toolCursor = ref(0);

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
				stepEvents.value = page.items;
				stepCursor.value = page.nextCursor;
			},
			{ write: false },
		);
	}

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
				toolEvents.value = page.items;
				toolCursor.value = page.nextCursor;
			},
			{ write: false },
		);
	}
</script>
<template>
	<details class="rounded-xl border border-border/55 bg-card/70 p-3">
		<summary class="cursor-pointer text-xs font-medium text-foreground">
			{{ t('agent.nativeRun.audit') }}
		</summary>
		<div class="mt-2 space-y-3">
			<p class="text-[11px] leading-4 text-text-secondary">{{ t('agent.nativeRun.auditHelp') }}</p>
			<form class="flex flex-wrap items-end gap-2" @submit.prevent="readStep()">
				<label class="flex items-center gap-2 text-[11px] text-text-secondary">
					<span>{{ t('agent.nativeRun.step') }}</span>
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
				<UiButton
					type="submit"
					density="compact"
					appearance="soft"
					:disabled="disabled || operation.busy.value"
				>
					{{ t('agent.nativeRun.read') }}
				</UiButton>
				<UiButton
					v-if="step"
					type="button"
					density="compact"
					appearance="ghost"
					:disabled="disabled || operation.busy.value"
					@click="readStep(true)"
				>
					{{ t('agent.nativeRun.moreEvents') }}
				</UiButton>
			</form>
			<div v-if="step" class="rounded-lg bg-background/50 p-2.5 text-[11px]">
				<p class="text-text-secondary">
					{{ step.stepIndex }} · {{ t('agent.nativeRun.stepStates.' + step.state) }} · v{{ step.revision }} ·
					{{ step.textBytes }} bytes
				</p>
				<p v-if="step.inputTokens !== undefined" class="mt-1 text-text-secondary">
					{{ t('agent.nativeRun.tokens') }}: {{ step.inputTokens }} / {{ step.outputTokens }}
				</p>
				<ul class="mt-2 space-y-1">
					<li v-for="event in stepEvents" :key="event.sequence" class="break-all text-text-secondary">
						#{{ event.sequence }} · {{ event.kind }}
						<template v-if="event.kind === 'text.delta'">· {{ event.textBytes }} bytes</template>
						<template v-else-if="event.kind === 'usage'"
							>· {{ event.inputTokens }} / {{ event.outputTokens }}</template
						>
					</li>
				</ul>
			</div>
			<form class="flex flex-wrap items-end gap-2" @submit.prevent="readTool()">
				<label class="flex min-w-0 items-center gap-2 text-[11px] text-text-secondary">
					<span class="shrink-0">{{ t('agent.nativeRun.toolId') }}</span>
					<UiInput
						v-model="toolId"
						density="compact"
						class="min-w-0 flex-1"
						required
						:aria-label="t('agent.nativeRun.toolId')"
					/>
				</label>
				<UiButton
					type="submit"
					density="compact"
					appearance="soft"
					:disabled="disabled || operation.busy.value"
				>
					{{ t('agent.nativeRun.read') }}
				</UiButton>
				<UiButton
					v-if="tool"
					type="button"
					density="compact"
					appearance="ghost"
					:disabled="disabled || operation.busy.value"
					@click="readTool(true)"
				>
					{{ t('agent.nativeRun.moreEvents') }}
				</UiButton>
			</form>
			<div v-if="tool" class="rounded-lg bg-background/50 p-2.5 text-[11px]">
				<p class="text-text-secondary">
					{{ tool.toolName }} · {{ tool.state }} · v{{ tool.revision }} · {{ tool.capability }} ·
					{{ tool.risk }}
				</p>
				<p class="mt-1 break-all text-text-secondary">
					{{ t('agent.nativeRun.target') }}: {{ tool.targetId ?? '—' }} · {{ tool.operationHash }}
				</p>
				<ul class="mt-2 space-y-1">
					<li v-for="event in toolEvents" :key="event.revision" class="break-all text-text-secondary">
						#{{ event.revision }} · {{ event.state }} · {{ event.operationHash }}
					</li>
				</ul>
			</div>
		</div>
	</details>
</template>
