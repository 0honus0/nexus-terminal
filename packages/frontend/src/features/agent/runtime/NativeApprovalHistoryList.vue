<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge } from '@/foundation/ui';
	import type { UiTone } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import type { NativeApproval } from '../model/native-run-types';
	import { formatToolSummary, toolCommandPreview } from './native-tool-summary';

	const props = defineProps<{
		approvals: NativeApproval[];
		connections: ConnectionSummary[];
	}>();
	const { t, te, locale } = useI18n();

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

	function statusTone(approval: NativeApproval): UiTone {
		if (approval.status === 'approved') return 'success';
		if (approval.status === 'denied') return 'danger';
		if (approval.status === 'expired' || approval.status === 'superseded') return 'warning';
		return 'neutral';
	}

	function statusIcon(approval: NativeApproval): string {
		if (approval.status === 'approved') return 'fa-solid fa-check';
		if (approval.status === 'denied') return 'fa-solid fa-xmark';
		if (approval.status === 'expired' || approval.status === 'superseded') return 'fa-solid fa-clock-rotate-left';
		return 'fa-solid fa-shield-halved';
	}

	function targetLabel(approval: NativeApproval): string {
		const id = approval.inspection.targetConnectionId;
		return id === null ? '—' : (connectionLabels.value.get(id) ?? '—');
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

	function formatTime(value: number | null): string {
		return value === null ? '—' : new Date(value * 1000).toLocaleString(locale.value);
	}
</script>
<template>
	<section v-if="approvals.length" class="mx-auto w-full max-w-3xl">
		<details class="group/approvals">
			<summary
				class="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-[11px] text-text-secondary transition-colors select-none hover:bg-header/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
			>
				<span
					class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15"
				>
					<i class="fa-solid fa-stamp text-[9px]" aria-hidden="true"></i>
				</span>
				<span class="shrink-0 font-semibold text-foreground/90">
					{{ t('agent.approvals.historyTitle') }}
				</span>
				<span class="rounded bg-primary/10 px-1.5 py-0.5 font-medium tabular-nums text-primary">
					{{ approvals.length }}
				</span>
				<span class="ml-auto flex h-5 w-5 shrink-0 items-center justify-center text-text-secondary/60">
					<i
						class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/approvals:rotate-180"
						aria-hidden="true"
					></i>
				</span>
			</summary>
			<div class="ml-4 mt-1 space-y-0.5 border-l border-primary/20 pl-4">
				<article
					v-for="approval in approvals"
					:key="approval.id"
					:data-approval-status="approval.status"
					:data-tool-name="approval.inspection.toolName"
				>
					<details class="group/approval">
						<summary
							class="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors select-none hover:bg-header/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
						>
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
								:class="
									approval.status === 'approved'
										? 'bg-success/10 text-success ring-1 ring-success/15'
										: approval.status === 'denied'
											? 'bg-error/10 text-error ring-1 ring-error/15'
											: 'bg-warning/10 text-warning ring-1 ring-warning/15'
								"
							>
								<i class="text-[9px]" :class="statusIcon(approval)" aria-hidden="true"></i>
							</span>
							<code class="shrink-0 font-mono font-semibold text-foreground/85">{{
								approval.inspection.toolName
							}}</code>
							<span class="min-w-0 flex-1 truncate text-text-secondary/75" :title="summaryText(approval)">
								{{ summaryText(approval) }}
							</span>
							<UiBadge :tone="statusTone(approval)" appearance="ghost" density="compact">
								{{ statusLabel(approval) }}
							</UiBadge>
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-secondary/55 transition-colors group-hover:bg-background/70 group-hover:text-foreground/70"
							>
								<i
									class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/approval:rotate-180"
									aria-hidden="true"
								></i>
							</span>
						</summary>
						<div class="mb-1.5 ml-7 rounded-xl bg-header/25 px-3 py-2.5 ring-1 ring-inset ring-border/30">
							<div v-if="commandPreview(approval)" class="mb-2.5 min-w-0">
								<p class="text-text-secondary/75">{{ t('agent.approvals.command') }}</p>
								<pre
									class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 px-2.5 py-2 font-mono text-[10px] leading-4 text-foreground/85 ring-1 ring-inset ring-border/30"
									>{{ commandPreview(approval)?.text }}</pre>
								<p v-if="commandPreview(approval)?.truncated" class="mt-1.5 text-[10px] text-warning">
									{{ t('agent.approvals.commandTruncated') }}
								</p>
							</div>
							<p
								v-else
								class="mb-2.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-foreground/85"
							>
								{{ summaryText(approval) }}
							</p>
							<dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-2">
								<div class="min-w-0">
									<dt class="text-text-secondary/75">{{ t('agent.approvals.target') }}</dt>
									<dd class="mt-0.5 truncate font-medium text-foreground">
										{{ targetLabel(approval) }}
									</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.approvals.requestedAt') }}</dt>
									<dd class="mt-0.5 font-mono text-[10px] text-foreground">
										{{ formatTime(approval.requestedAt) }}
									</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.approvals.decidedAt') }}</dt>
									<dd class="mt-0.5 font-mono text-[10px] text-foreground">
										{{ formatTime(approval.decidedAt) }}
									</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.approvals.riskLabel') }}</dt>
									<dd class="mt-0.5 font-medium text-foreground">
										{{ t(`agent.approvals.risk.${approval.inspection.risk}`) }}
									</dd>
								</div>
							</dl>
							<div
								class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/35 pt-2 font-mono text-[10px] text-text-secondary/75"
							>
								<span>v{{ approval.inspection.toolVersion }}</span>
								<span class="min-w-0 truncate" :title="approval.operationHash">{{
									approval.operationHash
								}}</span>
							</div>
						</div>
					</details>
				</article>
			</div>
		</details>
	</section>
</template>
