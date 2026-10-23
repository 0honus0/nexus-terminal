<script setup lang="ts">
	import { computed, onBeforeUnmount, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiTextarea } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import type { NativeApproval, NativeRunAction } from '../model/native-run-types';

	const props = defineProps<{
		approvals: NativeApproval[];
		connections: ConnectionSummary[];
		disabled: boolean;
	}>();
	const emit = defineEmits<{ mutate: [action: NativeRunAction]; inspect: [toolId: string] }>();
	const { t } = useI18n();
	const feedback = ref('');
	const feedbackId = ref<string | null>(null);
	const now = ref(Date.now());
	const timer = window.setInterval(() => (now.value = Date.now()), 1000);
	onBeforeUnmount(() => window.clearInterval(timer));

	const connectionLabels = computed(() => {
		const labels = new Map<number, string>();
		for (const connection of props.connections) {
			labels.set(connection.id, connection.name.trim() || `${connection.username}@${connection.host}`);
		}
		return labels;
	});

	function statusLabel(approval: NativeApproval): string {
		return t(`agent.approvals.status.${approval.status}`);
	}

	function riskLabel(approval: NativeApproval): string {
		return t(`agent.approvals.risk.${approval.inspection.risk}`);
	}

	function targetLabel(approval: NativeApproval): string {
		const id = approval.inspection.targetConnectionId;
		return id === null ? '—' : (connectionLabels.value.get(id) ?? '—');
	}

	function remainingSeconds(approval: NativeApproval): number {
		return Math.max(0, Math.ceil((approval.expiresAt * 1000 - now.value) / 1000));
	}

	function actionable(approval: NativeApproval): boolean {
		return approval.status === 'requested' && remainingSeconds(approval) > 0 && !props.disabled;
	}

	function toggleFeedback(approval: NativeApproval): void {
		feedbackId.value = feedbackId.value === approval.id ? null : approval.id;
		feedback.value = '';
	}
</script>
<template>
	<section v-if="approvals.length" class="space-y-2.5">
		<div class="flex items-center gap-2 px-1">
			<i class="fa-solid fa-shield-halved text-[10px] text-warning" aria-hidden="true"></i>
			<h4 class="text-xs font-semibold text-foreground">{{ t('agent.approvals.title') }}</h4>
			<UiBadge tone="warning" appearance="soft" density="compact">
				{{ approvals.length }}
			</UiBadge>
		</div>
		<article
			v-for="approval in approvals"
			:key="approval.id"
			class="rounded-xl border border-warning/35 bg-card p-3 text-xs shadow-xs"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="font-semibold text-foreground">
						{{
							approval.kind === 'acp_permission'
								? t('agent.approvals.acpInnerTitle')
								: t('agent.approvals.title')
						}}
					</div>
					<div
						class="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-text-secondary"
					>
						<span class="truncate font-mono">{{ approval.inspection.toolName }}</span>
						<span aria-hidden="true">·</span>
						<span>{{ statusLabel(approval) }}</span>
					</div>
				</div>
				<UiBadge class="shrink-0" tone="warning" appearance="soft" density="compact">
					{{ riskLabel(approval) }}
				</UiBadge>
			</div>

			<p class="mt-3 whitespace-pre-wrap break-words leading-5 text-text-secondary">
				{{ approval.inspection.summary }}
			</p>

			<dl
				class="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-border/45 bg-background/45 p-2.5 text-[11px] sm:grid-cols-2"
			>
				<div class="min-w-0">
					<dt class="text-text-secondary">{{ t('agent.approvals.target') }}</dt>
					<dd class="mt-0.5 truncate font-medium text-foreground">{{ targetLabel(approval) }}</dd>
				</div>
				<div>
					<dt class="text-text-secondary">{{ t('agent.approvals.expires') }}</dt>
					<dd class="mt-0.5 font-medium tabular-nums text-foreground">
						{{ t('agent.approvals.expiresIn', { seconds: remainingSeconds(approval) }) }}
					</dd>
				</div>
			</dl>

			<details class="mt-2 rounded-lg border border-border/55 bg-background/55 p-2.5 text-[11px]">
				<summary class="cursor-pointer font-medium text-text-secondary hover:text-foreground">
					{{ t('agent.approvals.operation') }}
				</summary>
				<dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px]">
					<dt class="text-text-secondary">ID</dt>
					<dd class="break-all text-foreground">{{ approval.id }}</dd>
					<dt class="text-text-secondary">Tool</dt>
					<dd class="break-all text-foreground">
						{{ approval.inspection.toolName }} · v{{ approval.inspection.toolVersion }}
					</dd>
					<dt class="text-text-secondary">Target ID</dt>
					<dd class="break-all text-foreground">{{ approval.inspection.targetConnectionId ?? '—' }}</dd>
					<dt class="text-text-secondary">Hash</dt>
					<dd class="break-all text-foreground">{{ approval.operationHash }}</dd>
					<dt class="text-text-secondary">Revision</dt>
					<dd class="text-foreground">
						{{ approval.policyRevision }} / {{ approval.inputRevision }} / {{ approval.version }}
					</dd>
				</dl>
				<UiButton
					class="mt-2"
					density="compact"
					appearance="ghost"
					:disabled="disabled"
					@click="emit('inspect', approval.toolCallId)"
				>
					{{ t('agent.nativeRun.inspectTool') }}
				</UiButton>
			</details>

			<p v-if="approval.status !== 'requested'" class="mt-3 text-[11px] text-text-secondary">
				{{ t('agent.approvals.resolved', { state: statusLabel(approval) }) }}
			</p>
			<p v-else-if="remainingSeconds(approval) === 0" class="mt-3 text-[11px] text-error">
				{{ t('agent.approvals.expired') }}
			</p>
			<div v-else class="mt-3 space-y-2">
				<div v-if="feedbackId === approval.id" class="rounded-lg border border-border/70 bg-background/70 p-2">
					<label class="mb-1.5 block text-[11px] font-medium text-text-secondary">
						{{ t('agent.approvals.feedbackLabel') }}
					</label>
					<UiTextarea
						v-model="feedback"
						density="compact"
						:min-rows="2"
						resize="none"
						maxlength="2000"
						class="w-full text-[11px]"
						:placeholder="t('agent.approvals.feedbackPlaceholder')"
						:aria-label="t('agent.approvals.feedbackLabel')"
					/>
					<div class="mt-2 flex justify-end gap-1.5">
						<UiButton
							density="compact"
							appearance="ghost"
							:disabled="!actionable(approval)"
							@click="feedbackId = null"
						>
							{{ t('common.cancel') }}
						</UiButton>
						<UiButton
							density="compact"
							appearance="solid"
							tone="danger"
							:disabled="!actionable(approval) || !feedback.trim()"
							@click="
								emit('mutate', {
									kind: 'approve',
									approval,
									decision: 'denied',
									feedback: feedback.trim(),
								})
							"
						>
							{{ t('agent.approvals.denyWithFeedbackSubmit') }}
						</UiButton>
					</div>
				</div>
				<div class="grid gap-2" :class="approval.kind === 'acp_permission' ? 'grid-cols-2' : 'grid-cols-3'">
					<UiButton
						density="compact"
						appearance="soft"
						tone="danger"
						:disabled="!actionable(approval)"
						@click="emit('mutate', { kind: 'approve', approval, decision: 'denied', feedback: '' })"
					>
						{{
							approval.kind === 'acp_permission'
								? t('agent.approvals.rejectOnce')
								: t('agent.approvals.deny')
						}}
					</UiButton>
					<UiButton
						v-if="approval.kind !== 'acp_permission'"
						density="compact"
						appearance="soft"
						:disabled="!actionable(approval)"
						@click="toggleFeedback(approval)"
					>
						{{ t('agent.approvals.denyWithFeedback') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="solid"
						tone="primary"
						:disabled="!actionable(approval)"
						@click="emit('mutate', { kind: 'approve', approval, decision: 'approved', feedback: '' })"
					>
						{{
							approval.kind === 'acp_permission'
								? t('agent.approvals.allowOnce')
								: t('agent.approvals.approve')
						}}
					</UiButton>
				</div>
			</div>
		</article>
	</section>
</template>
