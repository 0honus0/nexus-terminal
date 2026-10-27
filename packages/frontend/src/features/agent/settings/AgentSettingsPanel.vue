<script setup lang="ts">
	import { computed, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import AgentExtensionsSettings from './AgentExtensionsSettings.vue';
	import { usePluginManagement } from '../composables/use-plugin-management';
	import BrowserRuntimeSettings from './BrowserRuntimeSettings.vue';
	import ModelProviderSettings from './ModelProviderSettings.vue';
	import { UiInfoHint, UiSwitch } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import { useExecutionSettings } from '../composables/use-execution-settings';
	import { useAppManagement } from '../composables/use-app-management';
	import ExecutionSettings from './ExecutionSettings.vue';
	import SafetyNetworkSettings from './SafetyNetworkSettings.vue';
	import AgentOnboardingModal from './AgentOnboardingModal.vue';
	import { useAgentOnboarding } from '../composables/use-agent-onboarding';

	const { t } = useI18n();
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const groups = [
		{ id: 'models', icon: 'fa-solid fa-brain', label: 'models', color: 'text-violet-500' },
		{ id: 'tools', icon: 'fa-solid fa-puzzle-piece', label: 'extensions', color: 'text-blue-500' },
		{ id: 'runtime', icon: 'fa-solid fa-gauge-high', label: 'runtime', color: 'text-amber-500' },
		{ id: 'safety', icon: 'fa-solid fa-shield-halved', label: 'safety', color: 'text-emerald-500' },
	] as const;
	type SettingsGroup = (typeof groups)[number]['id'];
	const activeGroup = ref<SettingsGroup>('models');
	const execution = useExecutionSettings();
	useSettingsReloadSource({
		id: 'agent-execution-settings',

		pending: () =>
			!execution.busy.value &&
			(execution.refreshRequired.value || Boolean(execution.notice.value && execution.notice.value !== 'saved')),

		reload: () => execution.perform('read'),
	});
	const management = useAppManagement(() => props.active);
	const plugins = usePluginManagement(() => props.active && activeGroup.value === 'tools');
	watch(plugins.installations, () => {
		if (props.active && activeGroup.value === 'tools' && !plugins.operation.refreshRequired.value)
			management.reload();
	});
	const enabledApps = computed(() => management.apps.value.filter((app) => app.enabled).length);
	const visitedGroups = reactive(new Set<SettingsGroup>(['models']));
	const pluginRevision = ref(0);
	const onboarding = useAgentOnboarding({
		available: () => props.active,

		canEnable: () =>
			props.active && !execution.blocked.value && !execution.dirty.value && !execution.hardChanged.value,

		onReady() {
			pluginRevision.value += 1;
			if (execution.saved.value?.enabled === false) void execution.toggleEnabled();
			management.reload();
		},
	});

	const agentEnabled = computed({
		get: () => execution.saved.value?.enabled ?? false,

		set: (enabled: boolean) => {
			if (enabled === agentEnabled.value) return;
			void toggleAgent();
		},
	});
	const agentToggleDisabled = computed(
		() =>
			!execution.saved.value ||
			onboarding.operation.busy.value ||
			management.appOperation.busy.value ||
			onboarding.visible.value ||
			execution.blocked.value ||
			execution.dirty.value ||
			execution.hardChanged.value,
	);
	const featureHelp = computed(
		() => `${t('agent.settings.feature.description')} ${t('agent.settings.feature.schedulerHint')}`,
	);

	async function toggleAgent(): Promise<void> {
		if (onboarding.operation.busy.value || onboarding.visible.value) return;
		if (props.active) await execution.toggleEnabled();
	}

	function selectGroup(id: SettingsGroup): void {
		activeGroup.value = id;
		visitedGroups.add(id);
	}
</script>

<template>
	<div class="agent-settings-panel space-y-3 sm:space-y-4">
		<div
			class="agent-settings-master ui-glass-panel rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3"
			:aria-busy="execution.busy.value"
		>
			<div class="agent-settings-master__heading">
				<h2 class="text-sm font-semibold tracking-tight text-foreground">
					{{ t('agent.settings.feature.title') }}
				</h2>
				<UiInfoHint :text="featureHelp" />
				<span
					class="agent-settings-master__apps inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-text-secondary"
				>
					<span>{{ t('agent.settings.summary.activeApps') }}</span>
					<span class="font-mono font-medium text-foreground">
						{{ enabledApps }} / {{ management.apps.value.length }}
					</span>
				</span>
			</div>
			<UiSwitch
				id="agent-feature-enabled"
				v-model="agentEnabled"
				density="compact"
				:disabled="agentToggleDisabled"
				:aria-label="t('agent.settings.feature.title')"
				:title="t('agent.settings.feature.title')"
			/>
		</div>
		<AgentOnboardingModal
			v-if="onboarding.entry.value"
			:entry="onboarding.entry.value"
			:visible="onboarding.visible.value"
			:busy="onboarding.operation.busy.value"
			:notice="
				onboarding.uncertain.value
					? 'unknown'
					: onboarding.operation.notice.value === 'saved'
						? ''
						: onboarding.operation.notice.value
			"
			:needs-read="onboarding.operation.refreshRequired.value"
			:confirm-disabled="
				onboarding.uncertain.value ||
				onboarding.operation.refreshRequired.value ||
				!onboarding.entry.value.compatible ||
				execution.blocked.value ||
				execution.dirty.value ||
				execution.hardChanged.value
			"
			@close="onboarding.close"
			@confirm="onboarding.confirm"
			@read="onboarding.request"
		/>
		<nav
			class="agent-settings-nav grid w-full grid-cols-4 gap-2 sm:gap-2.5"
			:aria-label="t('agent.settings.navigation')"
		>
			<button
				v-for="group in groups"
				:key="group.id"
				type="button"
				class="ui-glass-chrome flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-1.5 py-2 text-center text-xs font-medium transition-all sm:gap-2 sm:px-3 sm:py-2.5"
				:class="
					activeGroup === group.id
						? 'border border-border/70 font-semibold text-foreground shadow-xs'
						: 'border border-border/40 text-text-secondary shadow-2xs hover:border-border/60 hover:bg-header/40 hover:text-foreground'
				"
				:aria-current="activeGroup === group.id ? 'page' : undefined"
				@click="selectGroup(group.id)"
			>
				<i
					:class="[group.icon, activeGroup === group.id ? group.color : 'text-text-secondary']"
					aria-hidden="true"
				></i>
				<span class="truncate">{{ t('agent.settings.groups.' + group.label) }}</span>
			</button>
		</nav>
		<div v-if="visitedGroups.has('models')" v-show="activeGroup === 'models'" class="space-y-5">
			<ModelProviderSettings :active="props.active && activeGroup === 'models'" />
			<ExecutionSettings :editor="execution" section="budget" />
		</div>
		<div v-if="visitedGroups.has('tools')" v-show="activeGroup === 'tools'" class="space-y-5">
			<AgentExtensionsSettings
				:model="management"
				:plugins="plugins"
				:active="props.active && activeGroup === 'tools'"
				:revision="pluginRevision"
				@recommend="onboarding.request"
			/>
		</div>
		<div v-if="visitedGroups.has('runtime')" v-show="activeGroup === 'runtime'" class="space-y-5">
			<ExecutionSettings :editor="execution" section="runtime" />
			<BrowserRuntimeSettings :active="props.active && activeGroup === 'runtime'" />
			<ExecutionSettings :editor="execution" section="storage" />
		</div>
		<div v-if="visitedGroups.has('safety')" v-show="activeGroup === 'safety'" class="space-y-5">
			<ExecutionSettings :editor="execution" section="subagents" />
			<SafetyNetworkSettings />
		</div>
	</div>
</template>

<style scoped>
	.agent-settings-panel {
		container-type: inline-size;
		padding-inline-end: 0.75rem;
	}

	.agent-settings-master {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.agent-settings-master__heading {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.agent-settings-master__apps {
		min-width: 0;
		max-width: 100%;
		white-space: nowrap;
	}

	@container (max-width: 480px) {
		.agent-settings-master {
			align-items: flex-start;
			gap: 0.75rem;
		}

		.agent-settings-nav {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.agent-settings-master :deep(.ui-switch) {
			margin-top: 0.25rem;
		}
	}

	@container (max-width: 360px) {
		.agent-settings-master {
			gap: 0.5rem;
		}

		.agent-settings-master__heading {
			gap: 0.375rem;
		}

		.agent-settings-master__apps {
			padding-inline: 0.5rem;
		}
	}

	@media (max-width: 1023px) {
		.agent-settings-panel {
			padding-inline-end: 0;
		}
	}
</style>
