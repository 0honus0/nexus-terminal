<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type {
		NativeRun,
		NativeApproval,
		NativeChild,
		NativeMessage,
		NativeEvent,
		NativeRunAction,
	} from '../model/native-run-types';
	import { isNativeRunActive } from '../model/native-run-rules';
	import NativeAuditPanel from './NativeAuditPanel.vue';

	defineProps<{
		appId: string;
		run: NativeRun;
		events: NativeEvent[];
		approvals: NativeApproval[];
		children: NativeChild[];
		child: NativeChild | null;
		messages: NativeMessage[];
		active: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{
		refresh: [];
		mutate: [action: NativeRunAction];
		messages: [child: NativeChild, more: boolean];
	}>();
	const { t } = useI18n();
	const feedback = ref('');
	const auditToolId = ref('');
</script>
<template>
	<section class="space-y-3 text-sm">
		<header class="flex flex-wrap items-center gap-2">
			<strong>{{ t('agent.nativeRun.states.' + run.status) }}</strong
			><code class="break-all text-xs">{{ run.id }} · v{{ run.version }}</code>
			<button :disabled="disabled" @click="emit('refresh')">{{ t('agent.nativeRun.read') }}</button>
			<button v-if="isNativeRunActive(run)" :disabled="disabled" @click="emit('mutate', { kind: 'cancel', run })">
				{{ t('agent.nativeRun.cancel') }}
			</button>
		</header>
		<details>
			<summary>{{ t('agent.nativeRun.events') }}</summary>
			<ul class="max-h-40 overflow-auto text-xs">
				<li v-for="event in events" :key="event.sequence">
					#{{ event.sequence }} · {{ event.type }} · v{{ event.runVersion }}
				</li>
			</ul>
		</details>
		<section v-if="approvals.length" class="space-y-2">
			<h4>{{ t('agent.nativeRun.approvals') }}</h4>
			<label class="block"
				>{{ t('agent.nativeRun.feedback')
				}}<input v-model="feedback" class="ml-2 border bg-background p-1" :disabled="disabled"
			/></label>
			<article
				v-for="approval in approvals"
				:key="approval.id"
				class="space-y-1 rounded border border-border p-2"
			>
				<p>
					{{ approval.inspection.toolName }} · {{ approval.inspection.risk }} ·
					{{ t('agent.nativeRun.approvalStates.' + approval.status) }} · v{{ approval.version }}
				</p>
				<p class="whitespace-pre-wrap break-words">{{ approval.inspection.summary }}</p>
				<p class="text-xs">
					{{ t('agent.nativeRun.expires') }}: {{ new Date(approval.expiresAt * 1000).toLocaleString() }} ·
					{{ t('agent.nativeRun.target') }}: {{ approval.inspection.targetConnectionId ?? '—' }}
				</p>
				<code class="block break-all text-xs">{{ approval.operationHash }}</code>
				<div class="flex flex-wrap gap-3">
					<button
						v-if="approval.status === 'requested'"
						:disabled="disabled"
						@click="emit('mutate', { kind: 'approve', approval, decision: 'approved', feedback })"
					>
						{{ t('agent.nativeRun.approve') }}
					</button>
					<button
						v-if="approval.status === 'requested'"
						:disabled="disabled"
						@click="emit('mutate', { kind: 'approve', approval, decision: 'denied', feedback })"
					>
						{{ t('agent.nativeRun.deny') }}
					</button>
					<button :disabled="disabled" @click="auditToolId = approval.toolCallId">
						{{ t('agent.nativeRun.inspectTool') }}
					</button>
				</div>
			</article>
		</section>
		<section v-if="children.length" class="space-y-2">
			<h4>{{ t('agent.nativeRun.children') }}</h4>
			<article v-for="item in children" :key="item.id" class="rounded border border-border p-2">
				<p class="break-all">
					{{ item.id }} · {{ item.profile }} · {{ t('agent.nativeRun.states.' + item.status) }} · v{{
						item.version
					}}
				</p>
				<div class="flex gap-3">
					<button :disabled="disabled" @click="emit('messages', item, false)">
						{{ t('agent.nativeRun.messages') }}</button
					><button
						v-if="isNativeRunActive(item)"
						:disabled="disabled"
						@click="emit('mutate', { kind: 'cancelChild', run, child: item })"
					>
						{{ t('agent.nativeRun.cancel') }}
					</button>
				</div>
			</article>
			<div v-if="child" class="text-xs">
				<p>{{ child.id }} · {{ t('agent.nativeRun.metadataOnly') }}</p>
				<ul>
					<li v-for="message in messages" :key="message.sequence">
						#{{ message.sequence }} · {{ message.senderId }} · {{ message.bodyBytes }} bytes
					</li>
				</ul>
				<button :disabled="disabled" @click="emit('messages', child, true)">
					{{ t('agent.nativeRun.moreMessages') }}
				</button>
			</div>
		</section>
		<NativeAuditPanel
			:key="run.id + ':' + auditToolId"
			:app-id="appId"
			:run-id="run.id"
			:initial-tool-id="auditToolId"
			:active="active"
			:disabled="disabled"
		/>
	</section>
</template>
