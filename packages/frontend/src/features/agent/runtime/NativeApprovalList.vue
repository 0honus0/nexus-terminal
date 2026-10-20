<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { NativeApproval, NativeRunAction } from '../model/native-run-types';
	defineProps<{ approvals: NativeApproval[]; disabled: boolean }>();
	const emit = defineEmits<{ mutate: [action: NativeRunAction]; inspect: [toolId: string] }>();
	const { t } = useI18n();
	const feedback = ref('');
	const feedbackId = ref<string | null>(null);
</script>
<template>
	<section v-if="approvals.length" class="space-y-2">
		<h4>{{ t('agent.nativeRun.approvals') }}</h4>
		<article
			v-for="approval in approvals"
			:key="approval.id"
			class="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs"
		>
			<p>
				{{ approval.inspection.toolName }} · {{ t('agent.approvals.risk.' + approval.inspection.risk) }} ·
				{{ t('agent.nativeRun.approvalStates.' + approval.status) }}
			</p>
			<p class="whitespace-pre-wrap break-words">{{ approval.inspection.summary }}</p>
			<p class="text-xs">
				{{ t('agent.nativeRun.expires') }}: {{ new Date(approval.expiresAt * 1000).toLocaleString() }} ·
				{{ t('agent.nativeRun.target') }}: {{ approval.inspection.targetConnectionId ?? '—' }}
			</p>
			<details>
				<summary class="cursor-pointer text-text-secondary">{{ t('agent.approvals.operation') }}</summary>
				<code class="mt-2 block break-all text-xs">{{ approval.operationHash }}</code>
				<button :disabled="disabled" @click="emit('inspect', approval.toolCallId)">
					{{ t('agent.nativeRun.inspectTool') }}
				</button>
			</details>
			<label v-if="feedbackId === approval.id" class="block"
				>{{ t('agent.nativeRun.feedback')
				}}<input v-model="feedback" class="ml-2 border bg-background p-1" :disabled="disabled"
			/></label>
			<div class="flex flex-wrap gap-2">
				<button
					v-if="approval.status === 'requested'"
					class="rounded-md border border-border px-2 py-2 text-text-secondary hover:bg-header disabled:opacity-50"
					:disabled="disabled"
					@click="
						feedbackId = feedbackId === approval.id ? null : approval.id;
						feedback = '';
					"
				>
					{{ t('agent.approvals.denyWithFeedback') }}
				</button>
				<button
					v-if="approval.status === 'requested'"
					class="rounded-md border border-border px-3 py-2 font-medium hover:bg-header disabled:opacity-50"
					:disabled="disabled"
					@click="emit('mutate', { kind: 'approve', approval, decision: 'approved', feedback: '' })"
				>
					{{ t('agent.nativeRun.approve') }}
				</button>
				<button
					v-if="approval.status === 'requested'"
					:disabled="disabled"
					@click="
						emit('mutate', {
							kind: 'approve',
							approval,
							decision: 'denied',
							feedback: feedbackId === approval.id ? feedback : '',
						})
					"
				>
					{{ t('agent.nativeRun.deny') }}
				</button>
			</div>
		</article>
	</section>
</template>
