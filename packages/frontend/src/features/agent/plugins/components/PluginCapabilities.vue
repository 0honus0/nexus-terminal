<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiCheckbox, UiEmptyState } from '@/foundation/ui';
	import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
	import { CAPABILITY_GROUPS, CAPABILITY_CATEGORIES, CAPABILITY_ICONS } from '../model/plugin-capabilities';

	const props = withDefaults(
		defineProps<{
			capabilities: AgentCapability[];
			granted?: AgentCapability[];
			editable?: boolean;
			disabled?: boolean;
			showSummary?: boolean;
		}>(),
		{ showSummary: true },
	);
	const emit = defineEmits<{ change: [capability: AgentCapability, enabled: boolean] }>();
	const { t } = useI18n();
	const groups = computed(() =>
		CAPABILITY_GROUPS.map((group) => ({
			id: group.id,
			label: group.label,
			icon: group.icon,
			accent: group.accent,
			capabilities: [...new Set(props.capabilities)].filter(
				(capability) => CAPABILITY_CATEGORIES[capability] === group.id,
			),
		})).filter((group) => group.capabilities.length > 0),
	);
</script>
<template>
	<div class="plugin-capabilities text-xs">
		<div v-if="showSummary" class="flex items-center justify-between gap-3 px-3 py-2.5 text-text-secondary">
			<span>{{ t('agent.settings.apps.declaredCapabilities') }}</span>
			<span class="font-mono tabular-nums">{{ capabilities.length }}</span>
		</div>
		<details
			v-for="group in groups"
			:key="group.id"
			:style="{ '--capability-accent': group.accent }"
			class="plugin-capabilities__group group/capability border-t border-border/40 first:border-t-0"
		>
			<summary
				class="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 hover:bg-header/30 focus-visible:outline-primary"
			>
				<i
					:class="group.icon"
					class="plugin-capabilities__accent w-4 shrink-0 text-center"
					aria-hidden="true"
				></i>
				<span class="min-w-0 flex-1 font-medium text-foreground">{{ t(group.label) }}</span>
				<span class="plugin-capabilities__accent shrink-0 font-mono tabular-nums"
					>{{
						editable
							? `${group.capabilities.filter((capability) => granted?.includes(capability)).length} / `
							: ''
					}}{{ group.capabilities.length }}</span
				>
				<i
					class="fa-solid fa-chevron-right shrink-0 text-[9px] text-text-secondary transition-transform group-open/capability:rotate-90"
					aria-hidden="true"
				></i>
			</summary>
			<div class="space-y-1 px-3 pb-3">
				<div
					v-for="capability in group.capabilities"
					:key="capability"
					class="flex items-start gap-2.5 rounded-lg bg-background/35 px-3 py-2.5"
				>
					<UiCheckbox
						v-if="editable"
						class="mt-0.5 shrink-0"
						:model-value="granted?.includes(capability) ?? false"
						:disabled="disabled"
						:aria-label="t(`agent.settings.apps.capabilities.${capability}.name`)"
						@update:model-value="(checked) => emit('change', capability, checked)"
					/>
					<i
						v-else
						:class="CAPABILITY_ICONS[capability]"
						class="mt-0.5 w-4 shrink-0 text-text-secondary"
						aria-hidden="true"
					></i>
					<div class="min-w-0 flex-1">
						<p class="font-medium text-foreground">
							{{ t(`agent.settings.apps.capabilities.${capability}.name`) }}
						</p>
						<p class="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
							{{ t(`agent.settings.apps.capabilities.${capability}.desc`) }}
						</p>
						<code class="mt-1 block break-all text-[10px] text-text-secondary/75">{{ capability }}</code>
					</div>
				</div>
			</div>
		</details>
		<UiEmptyState
			v-if="!groups.length"
			compact
			:bordered="false"
			icon="fa-solid fa-sliders"
			:title="t('agent.settings.apps.noCapabilities')"
		/>
	</div>
</template>
<style scoped>
	.plugin-capabilities__accent {
		color: color-mix(in srgb, var(--capability-accent) 65%, var(--text-color));
	}
	.plugin-capabilities__group[open] > summary {
		background: color-mix(in srgb, var(--capability-accent) 7%, transparent);
	}

	summary::-webkit-details-marker {
		display: none;
	}
</style>
