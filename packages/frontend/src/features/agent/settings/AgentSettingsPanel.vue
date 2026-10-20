<script setup lang="ts">
	import { computed, reactive, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import AppManagementSettings from './AppManagementSettings.vue';
	import BrowserRuntimeSettings from './BrowserRuntimeSettings.vue';
	import AppScopedSettings from './AppScopedSettings.vue';
	import AppIntegrationEditor from './AppIntegrationEditor.vue';
	import AppMemoryEditor from './AppMemoryEditor.vue';
	import ModelProviderSettings from './ModelProviderSettings.vue';
	import { UiButton } from '@/foundation/ui';
	import { useExecutionSettings } from '../composables/use-execution-settings';
	import { useAppManagement } from '../composables/use-app-management';
	import ExecutionSettings from './ExecutionSettings.vue';
	import PluginManagementSettings from './PluginManagementSettings.vue';
	import SafetyNetworkSettings from './SafetyNetworkSettings.vue';

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
	const management = useAppManagement();
	const enabledApps = computed(() => management.apps.value.filter((app) => app.enabled).length);
	const visitedGroups = reactive(new Set<SettingsGroup>(['models']));

	function selectGroup(id: SettingsGroup): void {
		activeGroup.value = id;
		visitedGroups.add(id);
	}
</script>

<template>
	<div class="agent-settings-panel space-y-3 sm:space-y-4">
		<div
			v-if="execution.saved.value"
			class="agent-settings-master rounded-xl border border-border bg-card px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-xs"
		>
			<span
				class="agent-settings-master__status inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
				:class="execution.saved.value.enabled ? 'bg-success/10 text-success' : 'bg-header text-text-secondary'"
				><span
					class="h-1.5 w-1.5 rounded-full"
					:class="execution.saved.value.enabled ? 'bg-success' : 'bg-text-secondary'"
				></span
				>{{
					t(
						execution.saved.value.enabled
							? 'agent.settings.feature.stateLabels.enabled'
							: 'agent.settings.feature.stateLabels.disabled',
					)
				}}</span
			>
			<span
				class="agent-settings-master__apps inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-text-secondary"
				><span>{{ t('agent.settings.summary.activeApps') }}</span
				><span class="font-mono font-medium text-foreground"
					>{{ enabledApps }} / {{ management.apps.value.length }}</span
				></span
			>
			<UiButton
				type="button"
				density="compact"
				class="agent-settings-master__toggle text-xs"
				:appearance="execution.saved.value.enabled ? 'soft' : 'solid'"
				:tone="execution.saved.value.enabled ? 'danger' : 'neutral'"
				:disabled="
					execution.blocked.value ||
					execution.dirty.value ||
					execution.hardChanged.value ||
					execution.confirmation.value !== null
				"
				@click="execution.toggleEnabled"
				><i
					:class="execution.saved.value.enabled ? 'fa-solid fa-power-off' : 'fa-solid fa-play'"
					aria-hidden="true"
				></i
				>{{
					t(
						execution.saved.value.enabled
							? 'agent.settings.feature.disable'
							: 'agent.settings.feature.enable',
					)
				}}</UiButton
			>
		</div>
		<template
			v-if="
				(execution.saved.value && execution.refreshRequired.value) ||
				(execution.notice.value && execution.notice.value !== 'saved')
			"
			><p v-if="execution.notice.value" role="alert" class="text-sm text-warning">
				{{ t('agent.settings.execution.' + execution.notice.value) }}
			</p>
			<UiButton type="button" :disabled="execution.busy.value" @click="execution.perform('read')">{{
				t('agent.settings.execution.read')
			}}</UiButton></template
		>
		<nav class="grid w-full grid-cols-4 gap-2 sm:gap-2.5" :aria-label="t('agent.settings.navigation')">
			<button
				v-for="group in groups"
				:key="group.id"
				type="button"
				class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-1.5 py-2 text-center text-xs font-medium transition-all sm:gap-2 sm:px-3 sm:py-2.5"
				:class="
					activeGroup === group.id
						? 'border border-border/70 bg-header/65 font-semibold text-foreground shadow-xs backdrop-blur-md'
						: 'border border-border/40 bg-card/40 text-text-secondary shadow-2xs backdrop-blur-xs hover:border-border/60 hover:bg-header/40 hover:text-foreground'
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
			<AppManagementSettings :model="management" />
			<AppScopedSettings :title="t('agent.settings.integrationManagement.title')">
				<template #default="{ appId }"
					><AppIntegrationEditor
						:key="appId"
						:app-id="appId"
						:active="props.active && activeGroup === 'tools'"
				/></template>
			</AppScopedSettings>
			<PluginManagementSettings />
		</div>
		<div v-if="visitedGroups.has('runtime')" v-show="activeGroup === 'runtime'" class="space-y-5">
			<ExecutionSettings :editor="execution" section="runtime" />
			<BrowserRuntimeSettings :active="props.active && activeGroup === 'runtime'" />
			<ExecutionSettings :editor="execution" section="storage" />
		</div>
		<div v-if="visitedGroups.has('safety')" v-show="activeGroup === 'safety'" class="space-y-5">
			<AppScopedSettings :title="t('agent.settings.memoryManagement.title')">
				<template #default="{ appId, apps }"
					><AppMemoryEditor :key="appId" :app-id="appId" :apps="apps"
				/></template>
			</AppScopedSettings>
			<ExecutionSettings :editor="execution" section="subagents" />
			<SafetyNetworkSettings />
		</div>
	</div>
</template>

<style scoped>
	.agent-settings-panel {
		container-type: inline-size;
	}

	.agent-settings-master {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
	}

	.agent-settings-master__status,
	.agent-settings-master__apps,
	.agent-settings-master__toggle {
		min-width: 0;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.agent-settings-master__toggle {
		justify-self: end;
	}

	@container (max-width: 480px) {
		.agent-settings-master {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.5rem;
		}

		.agent-settings-master__toggle {
			justify-self: stretch;
		}
	}
</style>
