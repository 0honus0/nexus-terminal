<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton } from '@/foundation/ui';
	import type { AgentTaskActivity } from '../model/task-activity-types';
	import { formatToolSummary, toolCommandPreview } from '../runtime/native-tool-summary';

	const props = defineProps<{ activity: AgentTaskActivity; queuedCount: number; now: number }>();
	const emit = defineEmits<{ dismiss: [] }>();
	const { t, te } = useI18n();
	const approval = computed(() => props.activity.approvals[0] ?? null);
	const canDecide = computed(
		() => approval.value !== null && approval.value.expiresAt * 1000 > props.now && !props.activity.blocked,
	);
	const summary = computed(() => {
		const inspection = approval.value?.inspection;
		return inspection
			? formatToolSummary(inspection.summary, inspection.toolName, {
					translate: (key, named) => t(key, named ?? {}),

					has: (key) => te(key),
				})
			: '';
	});
	const command = computed(() => (approval.value ? toolCommandPreview(approval.value.inspection.summary) : null));
	const target = computed(() => {
		const id = approval.value?.inspection.targetConnectionId;
		return id === null || id === undefined ? '' : (props.activity.targetLabels.get(id) ?? String(id));
	});
	const tone = computed(() => {
		if (props.activity.failureMessage || props.activity.status === 'failed') {
			return 'danger';
		}
		if (approval.value || props.activity.status === 'unknown') {
			return 'warning';
		}
		return props.activity.status === 'completed' ? 'success' : 'primary';
	});
	const icon = computed(() => {
		if (props.activity.failureMessage) {
			return 'fa-solid fa-exclamation';
		}
		if (approval.value) {
			return 'fa-solid fa-shield-halved';
		}
		switch (props.activity.status) {
			case 'completed':
				return 'fa-solid fa-check';
			case 'failed':
			case 'unknown':
				return 'fa-solid fa-exclamation';
			case 'cancelled':
				return 'fa-solid fa-stop';
			default:
				return 'fa-solid fa-ellipsis';
		}
	});
	const heading = computed(() => {
		if (
			props.activity.failureMessage &&
			props.activity.status !== 'failed' &&
			props.activity.status !== 'unknown'
		) {
			return t('agent.taskNotice.needsReview');
		}
		return t(approval.value ? 'agent.taskNotice.approval' : `agent.taskNotice.status.${props.activity.status}`);
	});
</script>

<template>
	<section class="agent-task-card" :data-tone="tone" data-agent-task-notice>
		<header class="flex items-start gap-2.5">
			<span class="agent-task-card__icon" aria-hidden="true"><i :class="icon"></i></span>
			<div class="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
				<p class="agent-task-card__status">{{ heading }}</p>
				<h3 class="mt-1 line-clamp-2 break-words text-xs font-semibold leading-5 text-foreground">
					{{ activity.threadTitle || t('agent.operations.untitledThread') }}
				</h3>
			</div>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="-mr-1 -mt-1 shrink-0 text-text-secondary"
				:aria-label="t('agent.taskNotice.dismiss')"
				:title="t('agent.taskNotice.dismiss')"
				@click="emit('dismiss')"
			>
				<i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
			</UiButton>
		</header>

		<div v-if="approval" class="agent-task-card__operation">
			<div class="mb-2 flex min-w-0 items-center gap-2">
				<UiBadge
					:tone="
						approval.inspection.risk === 'read'
							? 'success'
							: approval.inspection.risk === 'control' || approval.inspection.risk === 'mutate'
								? 'warning'
								: 'danger'
					"
					appearance="soft"
					density="compact"
				>
					{{ t(`agent.approvals.risk.${approval.inspection.risk}`) }}
				</UiBadge>
				<span v-if="target" class="min-w-0 truncate text-[11px] text-text-secondary" :title="target">
					<i class="fa-solid fa-server mr-1 text-[9px]" aria-hidden="true"></i>{{ target }}
				</span>
				<span v-if="activity.approvals.length > 1" class="ml-auto shrink-0 text-[10px] text-text-secondary">
					{{ t('agent.taskNotice.approvalCount', { count: activity.approvals.length }) }}
				</span>
			</div>
			<p class="line-clamp-2 break-words text-[11px] leading-5 text-foreground/85">{{ summary }}</p>
			<code v-if="command" class="mt-1.5 line-clamp-2 whitespace-pre-wrap break-all text-[10px] leading-4">
				{{ command.text }}{{ command.truncated ? '…' : '' }}
			</code>
			<p v-if="approval.expiresAt * 1000 <= now" class="mt-1.5 text-[11px] text-text-secondary">
				{{ t('agent.approvals.expired') }}
			</p>
		</div>
		<p
			v-else-if="activity.failureMessage || activity.preview"
			class="mt-3 line-clamp-3 whitespace-pre-line break-words text-[11px] leading-5 text-text-secondary"
		>
			{{ activity.failureMessage || activity.preview }}
		</p>
		<p v-else class="mt-2.5 text-[11px] leading-5 text-text-secondary">
			{{
				t(
					activity.status === 'unknown'
						? 'agent.taskNotice.unknownHint'
						: activity.toolExecutions === null
							? 'agent.taskNotice.detailsHint'
							: 'agent.taskNotice.toolCount',
					{
						count: activity.toolExecutions,
					},
				)
			}}
		</p>

		<footer class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/35 pt-2.5">
			<UiButton appearance="ghost" density="compact" class="shrink-0" @click="activity.open()">
				{{ t(approval ? 'agent.taskNotice.viewDetails' : 'agent.taskNotice.view') }}
				<i class="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[9px]" aria-hidden="true"></i>
			</UiButton>
			<div v-if="approval" class="ml-auto flex shrink-0 items-center gap-1.5">
				<UiButton
					appearance="soft"
					density="compact"
					:disabled="!canDecide"
					@click="activity.decide(approval, 'denied')"
				>
					{{ t(approval.kind === 'acp_permission' ? 'agent.approvals.rejectOnce' : 'agent.approvals.deny') }}
				</UiButton>
				<UiButton
					appearance="solid"
					tone="primary"
					density="compact"
					:disabled="!canDecide"
					@click="activity.decide(approval, 'approved')"
				>
					{{
						t(approval.kind === 'acp_permission' ? 'agent.approvals.allowOnce' : 'agent.approvals.approve')
					}}
				</UiButton>
			</div>
			<span v-else-if="queuedCount > 1" class="text-[10px] text-text-secondary">
				{{ t('agent.taskNotice.more', { count: queuedCount - 1 }) }}
			</span>
		</footer>
	</section>
</template>

<style scoped>
	.agent-task-card {
		--notice-accent: var(--color-primary);
		padding: 16px;
		color: var(--color-foreground);
	}
	.agent-task-card[data-tone='success'] {
		--notice-accent: var(--color-success);
	}
	.agent-task-card[data-tone='warning'] {
		--notice-accent: var(--color-warning);
	}
	.agent-task-card[data-tone='danger'] {
		--notice-accent: var(--color-error);
	}
	.agent-task-card__icon {
		display: grid;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		place-items: center;
		border-radius: 11px;
		background: color-mix(in srgb, var(--notice-accent) 11%, transparent);
		color: var(--notice-accent);
		font-size: 12px;
	}
	.agent-task-card__status {
		color: var(--notice-accent);
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
	}
	.agent-task-card__operation {
		margin-top: 12px;
		padding: 10px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-background) 55%, transparent);
	}
	@media (max-width: 360px) {
		.agent-task-card {
			padding: 12px;
		}
	}
</style>
