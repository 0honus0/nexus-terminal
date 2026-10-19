<script setup lang="ts">
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
</script>
<template>
	<div class="space-y-4">
		<ModelProviderSettings />
		<ModelRegistrySettings />
		<ExecutionSettings />
		<AppManagementSettings />
		<SafetyNetworkSettings />
		<ArtifactLibraryView />
		<BrowserRuntimeSettings />
		<AppScopedSettings :title="t('agent.settings.integrationManagement.title')">
			<template #default="{ appId }"><AppIntegrationEditor :key="appId" :app-id="appId" /></template>
		</AppScopedSettings>
		<AppScopedSettings :title="t('agent.settings.memoryManagement.title')">
			<template #default="{ appId, apps }"
				><AppMemoryEditor :key="appId" :app-id="appId" :apps="apps"
			/></template>
		</AppScopedSettings>
		<PluginManagementSettings />
	</div>
</template>
