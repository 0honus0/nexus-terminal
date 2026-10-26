<script setup lang="ts">
	import { computed, onBeforeUnmount, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiTextarea } from '@/foundation/ui';
	import type { UiTone } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import type { NativeApproval, NativeRunAction } from '../model/native-run-types';
	import { formatToolSummary, toolCommandPreview } from './native-tool-summary';

	const props = defineProps<{
		approvals: NativeApproval[];
		connections: ConnectionSummary[];
		disabled: boolean;
	}>();
	const emit = defineEmits<{ mutate: [action: NativeRunAction]; inspect: [toolId: string] }>();
	const { t, te } = useI18n();
	const feedback = ref('');
	const feedbackId = ref<string | null>(null);
	const expandedId = ref<string | null>(null);
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

	function riskTone(approval: NativeApproval): UiTone {
		if (approval.inspection.risk === 'read') return 'success';
		if (approval.inspection.risk === 'mutate' || approval.inspection.risk === 'control') return 'warning';
		return 'danger';
	}

	function statusTone(approval: NativeApproval): UiTone {
		if (approval.status === 'approved') return 'success';
		if (approval.status === 'denied') return 'danger';
		if (approval.status === 'requested') return 'warning';
		return 'neutral';
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

	function showRemaining(approval: NativeApproval): boolean {
		return approval.status === 'requested' && remainingSeconds(approval) > 0;
	}

	function toggleFeedback(approval: NativeApproval): void {
		feedbackId.value = feedbackId.value === approval.id ? null : approval.id;
		feedback.value = '';
	}

	function toggleExpanded(approval: NativeApproval): void {
		expandedId.value = expandedId.value === approval.id ? null : approval.id;
	}

	function stateIcon(approval: NativeApproval): string {
		if (approval.status === 'approved') return 'fa-solid fa-check';
		if (approval.status === 'denied') return 'fa-solid fa-xmark';
		if (approval.status === 'expired' || approval.status === 'superseded') return 'fa-solid fa-clock-rotate-left';
		return 'fa-solid fa-shield-halved';
	}

	function summaryText(approval: NativeApproval): string {
		return formatToolSummary(approval.inspection.summary, approval.inspection.toolName, {
			translate: (key, named) => t(key, named ?? {}),

			has: (key) => te(key),
		});
	}

	function commandPreview(approval: NativeApproval) {
		return toolCommandPreview(approval.inspection.summary);
	}
</script>
<template>
	<section v-if="approvals.length" class="space-y-2.5">
		<div class="flex items-center gap-2 px-1">
			<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-warning/10 text-warning">
				<i class="fa-solid fa-shield-halved text-[10px]" aria-hidden="true"></i>
			</span>
			<h4 class="text-xs font-semibold text-foreground">{{ t('agent.approvals.title') }}</h4>
			<UiBadge tone="warning" appearance="soft" density="compact" dot>
				{{ approvals.length }}
			</UiBadge>
		</div>
		<article
			v-for="approval in approvals"
			:key="approval.id"
			class="overflow-hidden rounded-2xl border border-warning/25 bg-card/90 shadow-xs backdrop-blur-sm"
		>
			<div class="flex items-start gap-3 p-3.5">
				<span
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning ring-1 ring-inset ring-warning/15"
				>
					<i class="text-xs" :class="stateIcon(approval)" aria-hidden="true"></i>
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h5 class="min-w-0 text-xs font-semibold text-foreground">
							{{
								approval.kind === 'acp_permission'
									? t('agent.approvals.acpInnerTitle')
									: t('agent.approvals.title')
							}}
						</h5>
						<UiBadge :tone="statusTone(approval)" appearance="ghost" density="compact">
							{{ statusLabel(approval) }}
						</UiBadge>
						<UiBadge :tone="riskTone(approval)" appearance="soft" density="compact">
							{{ riskLabel(approval) }}
						</UiBadge>
					</div>
					<div class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
						<i class="fa-solid fa-terminal text-[8px] opacity-70" aria-hidden="true"></i>
						<span class="truncate font-mono">{{ approval.inspection.toolName }}</span>
					</div>
				</div>
			</div>

			<div class="space-y-3 px-3.5 pb-3.5">
				<details
					class="group/command overflow-hidden rounded-xl bg-warning/[0.045] ring-1 ring-inset ring-warning/10"
				>
					<summary
						class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[11px] text-text-secondary transition-colors hover:bg-warning/[0.055]"
					>
						<i class="fa-solid fa-terminal text-[9px] text-warning/80" aria-hidden="true"></i>
						<span class="font-medium text-foreground/80">{{ t('agent.approvals.command') }}</span>
						<i
							class="fa-solid fa-chevron-down ml-auto text-[8px] transition-transform duration-150 group-open/command:rotate-180"
							aria-hidden="true"
						></i>
					</summary>
					<div class="border-t border-warning/10 px-3 py-2.5">
						<p class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/80">
							{{ summaryText(approval) }}
						</p>
						<pre
							v-if="commandPreview(approval)"
							class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/85 ring-1 ring-inset ring-border/30"
							>{{ commandPreview(approval)?.text }}</pre>
						<p v-if="commandPreview(approval)?.truncated" class="mt-1.5 text-[10px] text-warning">
							{{ t('agent.approvals.commandTruncated') }}
						</p>
					</div>
				</details>

				<dl class="grid grid-cols-1 gap-2" :class="showRemaining(approval) ? 'sm:grid-cols-2' : ''">
					<div class="min-w-0 rounded-xl bg-background/45 px-3 py-2.5">
						<dt class="flex items-center gap-1.5 text-[10px] text-text-secondary/75">
							<i class="fa-solid fa-server text-[8px]" aria-hidden="true"></i>
							{{ t('agent.approvals.target') }}
						</dt>
						<dd class="mt-1 truncate text-[11px] font-medium text-foreground">
							{{ targetLabel(approval) }}
						</dd>
					</div>
					<div v-if="showRemaining(approval)" class="rounded-xl bg-background/45 px-3 py-2.5">
						<dt class="flex items-center gap-1.5 text-[10px] text-text-secondary/75">
							<i class="fa-regular fa-clock text-[8px]" aria-hidden="true"></i>
							{{ t('agent.approvals.expires') }}
						</dt>
						<dd class="mt-1 text-[11px] font-medium tabular-nums text-foreground">
							{{ t('agent.approvals.expiresIn', { seconds: remainingSeconds(approval) }) }}
						</dd>
					</div>
				</dl>

				<div>
					<UiButton
						block
						appearance="ghost"
						density="compact"
						class="rounded-xl text-text-secondary"
						:aria-expanded="expandedId === approval.id"
						@click="toggleExpanded(approval)"
					>
						<span class="flex w-full items-center justify-between gap-2">
							<span class="inline-flex items-center gap-1.5">
								<i class="fa-solid fa-fingerprint text-[9px]" aria-hidden="true"></i>
								{{ t('agent.approvals.operation') }}
							</span>
							<i
								class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150"
								:class="expandedId === approval.id ? 'rotate-180' : ''"
								aria-hidden="true"
							></i>
						</span>
					</UiButton>
					<div
						v-if="expandedId === approval.id"
						class="rounded-xl bg-background/55 px-3 py-2.5 ring-1 ring-inset ring-border/30"
					>
						<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[10px]">
							<dt class="text-text-secondary/70">ID</dt>
							<dd class="break-all text-foreground/85">{{ approval.id }}</dd>
							<dt class="text-text-secondary/70">Tool</dt>
							<dd class="break-all text-foreground/85">
								{{ approval.inspection.toolName }} · v{{ approval.inspection.toolVersion }}
							</dd>
							<dt class="text-text-secondary/70">Target</dt>
							<dd class="break-all text-foreground/85">
								{{ approval.inspection.targetConnectionId ?? '—' }}
							</dd>
							<dt class="text-text-secondary/70">Hash</dt>
							<dd class="break-all text-foreground/85">{{ approval.operationHash }}</dd>
							<dt class="text-text-secondary/70">Revision</dt>
							<dd class="text-foreground/85">
								{{ approval.policyRevision }} / {{ approval.inputRevision }} / {{ approval.version }}
							</dd>
						</dl>
						<UiButton
							class="mt-2"
							density="compact"
							appearance="soft"
							:disabled="disabled"
							@click="emit('inspect', approval.toolCallId)"
						>
							<i class="fa-solid fa-magnifying-glass mr-1.5 text-[9px]" aria-hidden="true"></i>
							{{ t('agent.nativeRun.inspectTool') }}
						</UiButton>
					</div>
				</div>

				<p v-if="approval.status !== 'requested'" class="text-[11px] text-text-secondary">
					{{ t('agent.approvals.resolved', { state: statusLabel(approval) }) }}
				</p>
				<p v-else-if="remainingSeconds(approval) === 0" class="text-[11px] text-error">
					{{ t('agent.approvals.expired') }}
				</p>
				<div v-else class="space-y-2.5">
					<div
						v-if="feedbackId === approval.id"
						class="rounded-xl bg-background/55 p-3 ring-1 ring-inset ring-border/35"
					>
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
						<div class="mt-2 grid grid-cols-2 gap-2">
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
					<div
						class="grid gap-2"
						:class="approval.kind === 'acp_permission' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'"
					>
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
			</div>
		</article>
	</section>
</template>
