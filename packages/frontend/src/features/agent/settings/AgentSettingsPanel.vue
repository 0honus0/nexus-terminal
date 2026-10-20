<script setup lang="ts">
	import { reactive, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import AppManagementSettings from './AppManagementSettings.vue';
	import BrowserRuntimeSettings from './BrowserRuntimeSettings.vue';
	import AppScopedSettings from './AppScopedSettings.vue';
	import AppIntegrationEditor from './AppIntegrationEditor.vue';
	import AppMemoryEditor from './AppMemoryEditor.vue';
	import ModelProviderSettings from './ModelProviderSettings.vue';
	import ModelRegistrySettings from './ModelRegistrySettings.vue';
	import ExecutionSettings from './ExecutionSettings.vue';
	import PluginManagementSettings from './PluginManagementSettings.vue';
	import SafetyNetworkSettings from './SafetyNetworkSettings.vue';
	import ArtifactLibraryView from '../files/ArtifactLibraryView.vue';

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
	const visitedGroups = reactive(new Set<SettingsGroup>(['models']));

	function selectGroup(id: SettingsGroup): void {
		activeGroup.value = id;
		visitedGroups.add(id);
	}
</script>

<template>
	<div class="space-y-3 sm:space-y-4">
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
			<ModelRegistrySettings />
		</div>
		<div v-if="visitedGroups.has('tools')" v-show="activeGroup === 'tools'" class="space-y-5">
			<AppManagementSettings />
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
			<ExecutionSettings />
			<BrowserRuntimeSettings :active="props.active && activeGroup === 'runtime'" />
			<ArtifactLibraryView />
		</div>
		<div v-if="visitedGroups.has('safety')" v-show="activeGroup === 'safety'" class="space-y-5">
			<AppScopedSettings :title="t('agent.settings.memoryManagement.title')">
				<template #default="{ appId, apps }"
					><AppMemoryEditor :key="appId" :app-id="appId" :apps="apps"
				/></template>
			</AppScopedSettings>
			<SafetyNetworkSettings />
		</div>
	</div>
</template>
