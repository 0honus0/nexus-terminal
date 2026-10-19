<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
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
	<details class="space-y-2 rounded border border-border p-3">
		<summary>{{ t('agent.nativeRun.audit') }}</summary>
		<p class="text-xs">{{ t('agent.nativeRun.auditHelp') }}</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<form class="flex flex-wrap gap-2" @submit.prevent="readStep()">
			<label
				>{{ t('agent.nativeRun.step') }}
				<input
					v-model.number="stepIndex"
					type="number"
					min="1"
					:max="AGENT_RUN_STEP_MAX_COUNT"
					class="w-20 border bg-background p-1"
			/></label>
			<button :disabled="disabled || operation.busy.value">{{ t('agent.nativeRun.read') }}</button>
			<button v-if="step" type="button" :disabled="disabled || operation.busy.value" @click="readStep(true)">
				{{ t('agent.nativeRun.moreEvents') }}
			</button>
		</form>
		<div v-if="step" class="text-xs">
			<p>
				{{ step.stepIndex }} · {{ t('agent.nativeRun.stepStates.' + step.state) }} · v{{ step.revision }} ·
				{{ step.textBytes }} bytes
			</p>
			<p v-if="step.inputTokens !== undefined">
				{{ t('agent.nativeRun.tokens') }}: {{ step.inputTokens }} / {{ step.outputTokens }}
			</p>
			<ul>
				<li v-for="event in stepEvents" :key="event.sequence">
					#{{ event.sequence }} · {{ event.kind }}
					<template v-if="event.kind === 'text.delta'">· {{ event.textBytes }} bytes</template
					><template v-else-if="event.kind === 'usage'"
						>· {{ event.inputTokens }} / {{ event.outputTokens }}</template
					>
				</li>
			</ul>
		</div>
		<form class="flex flex-wrap gap-2" @submit.prevent="readTool()">
			<label
				>{{ t('agent.nativeRun.toolId') }}
				<input v-model="toolId" class="min-w-0 border bg-background p-1" required
			/></label>
			<button :disabled="disabled || operation.busy.value">{{ t('agent.nativeRun.read') }}</button>
			<button v-if="tool" type="button" :disabled="disabled || operation.busy.value" @click="readTool(true)">
				{{ t('agent.nativeRun.moreEvents') }}
			</button>
		</form>
		<div v-if="tool" class="text-xs">
			<p>
				{{ tool.toolName }} · {{ tool.state }} · v{{ tool.revision }} · {{ tool.capability }} · {{ tool.risk }}
			</p>
			<p>{{ t('agent.nativeRun.target') }}: {{ tool.targetId ?? '—' }} · {{ tool.operationHash }}</p>
			<ul>
				<li v-for="event in toolEvents" :key="event.revision">
					#{{ event.revision }} · {{ event.state }} · {{ event.operationHash }}
				</li>
			</ul>
		</div>
	</details>
</template>
