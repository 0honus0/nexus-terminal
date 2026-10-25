<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge } from '@/foundation/ui';
	import type { ConnectionSummary } from '@/features/connections/public';
	import type { NativeTool } from '../model/native-run-types';
	import { formatToolSummary } from './native-tool-summary';

	const props = defineProps<{
		tools: NativeTool[];
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

	const groupState = computed(() => {
		if (props.tools.some((tool) => tool.state === 'failed')) return 'failed';
		if (props.tools.some((tool) => tool.state === 'unknown')) return 'unknown';
		if (props.tools.some((tool) => tool.state === 'dispatched' || tool.state === 'inspected')) return 'dispatched';
		if (props.tools.some((tool) => tool.state === 'cancelled')) return 'cancelled';
		return 'completed';
	});

	const failedCount = computed(() => props.tools.filter((tool) => tool.state === 'failed').length);

	const activeCount = computed(
		() => props.tools.filter((tool) => tool.state === 'dispatched' || tool.state === 'inspected').length,
	);

	function targetLabel(tool: NativeTool): string {
		return tool.targetId === null ? '—' : (connectionLabels.value.get(tool.targetId) ?? '—');
	}

	function stateLabel(state: NativeTool['state']): string {
		return t(`agent.nativeRun.toolStates.${state}`);
	}

	function riskLabel(risk: NativeTool['risk']): string {
		return t(`agent.approvals.risk.${risk}`);
	}

	function iconClass(state: NativeTool['state']): string {
		switch (state) {
			case 'completed':
				return 'fa-solid fa-check';
			case 'failed':
				return 'fa-solid fa-triangle-exclamation';
			case 'unknown':
				return 'fa-solid fa-circle-question';
			case 'cancelled':
				return 'fa-solid fa-ban';
			case 'dispatched':
				return 'fa-solid fa-tower-broadcast';
			default:
				return 'fa-solid fa-magnifying-glass';
		}
	}

	function toneClass(state: NativeTool['state']): string {
		switch (state) {
			case 'completed':
				return 'bg-success/10 text-success ring-1 ring-success/15';
			case 'failed':
				return 'bg-error/10 text-error ring-1 ring-error/15';
			case 'unknown':
				return 'bg-warning/10 text-warning ring-1 ring-warning/15';
			case 'cancelled':
				return 'bg-text-secondary/10 text-text-secondary ring-1 ring-border/30';
			default:
				return 'bg-primary/10 text-primary ring-1 ring-primary/15';
		}
	}

	function formatTime(value: number): string {
		return new Date(value).toLocaleString(locale.value);
	}

	function summaryText(tool: NativeTool): string {
		return formatToolSummary(tool.summary, tool.toolName, {
			translate: (key, named) => t(key, named ?? {}),

			has: (key) => te(key),
		});
	}
</script>
<template>
	<section v-if="tools.length" class="mx-auto w-full max-w-3xl">
		<details class="group/tools">
			<summary
				class="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-1.5 text-[11px] text-text-secondary transition-colors select-none hover:bg-header/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
			>
				<span
					class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
					:class="toneClass(groupState)"
				>
					<i :class="iconClass(groupState)" aria-hidden="true"></i>
				</span>
				<span class="shrink-0 font-semibold text-foreground/90">
					{{ t('agent.nativeRun.toolActivity') }}
				</span>
				<span class="rounded bg-primary/10 px-1.5 py-0.5 font-medium tabular-nums text-primary">
					{{ tools.length }}
				</span>
				<span v-if="failedCount" class="text-error/90">
					{{ t('agent.nativeRun.toolSummary.failedCount', { count: failedCount }) }}
				</span>
				<span v-else-if="activeCount" class="text-primary/90">
					{{ stateLabel('dispatched') }}
				</span>
				<span class="ml-auto flex h-5 w-5 shrink-0 items-center justify-center text-text-secondary/60">
					<i
						class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/tools:rotate-180"
						aria-hidden="true"
					></i>
				</span>
			</summary>
			<div class="ml-4 mt-1 space-y-0.5 border-l border-primary/20 pl-4">
				<article
					v-for="tool in tools"
					:key="tool.id"
					:data-tool-name="tool.toolName"
					:data-tool-state="tool.state"
				>
					<details class="group/tool">
						<summary
							class="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors select-none hover:bg-header/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
						>
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
								:class="toneClass(tool.state)"
							>
								<i class="text-[9px]" :class="iconClass(tool.state)" aria-hidden="true"></i>
							</span>
							<code class="shrink-0 font-mono font-semibold text-foreground/85">{{ tool.toolName }}</code>
							<span class="min-w-0 flex-1 truncate text-text-secondary/75" :title="summaryText(tool)">
								{{ summaryText(tool) }}
							</span>
							<UiBadge
								appearance="ghost"
								density="compact"
								:class="
									tool.state === 'failed'
										? 'text-error'
										: tool.state === 'unknown'
											? 'text-warning'
											: ''
								"
							>
								{{ stateLabel(tool.state) }}
							</UiBadge>
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-secondary/55 transition-colors group-hover:bg-background/70 group-hover:text-foreground/70"
							>
								<i
									class="fa-solid fa-chevron-down text-[8px] transition-transform duration-150 group-open/tool:rotate-180"
									aria-hidden="true"
								></i>
							</span>
						</summary>
						<div class="mb-1.5 ml-7 rounded-xl bg-header/25 px-3 py-2.5 ring-1 ring-inset ring-border/30">
							<dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-2">
								<div class="min-w-0">
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.target') }}</dt>
									<dd class="mt-0.5 truncate font-medium text-foreground">{{ targetLabel(tool) }}</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.toolStep') }}</dt>
									<dd class="mt-0.5 font-medium tabular-nums text-foreground">
										{{ tool.modelStepIndex }}
									</dd>
								</div>
								<div class="min-w-0">
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.toolCapability') }}</dt>
									<dd class="mt-0.5 truncate font-mono text-[10px] text-foreground">
										{{ tool.capability }}
									</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.toolRisk') }}</dt>
									<dd class="mt-0.5 font-medium text-foreground">{{ riskLabel(tool.risk) }}</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.toolStartedAt') }}</dt>
									<dd class="mt-0.5 font-mono text-[10px] text-foreground">
										{{ formatTime(tool.createdAt) }}
									</dd>
								</div>
								<div>
									<dt class="text-text-secondary/75">{{ t('agent.nativeRun.toolUpdatedAt') }}</dt>
									<dd class="mt-0.5 font-mono text-[10px] text-foreground">
										{{ formatTime(tool.updatedAt) }}
									</dd>
								</div>
							</dl>
							<div
								class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/35 pt-2 font-mono text-[10px] text-text-secondary/75"
							>
								<span>v{{ tool.toolVersion }}</span>
								<span class="min-w-0 truncate" :title="tool.operationHash">{{
									tool.operationHash
								}}</span>
							</div>
						</div>
					</details>
				</article>
			</div>
		</details>
	</section>
</template>
