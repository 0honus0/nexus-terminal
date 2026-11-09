<script setup lang="ts">
	import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { useAppManagement } from '../composables/use-app-management';
	import type { usePluginManagement } from '../plugins/composables/use-plugin-management';
	import InstalledPluginsSettings from '../plugins/components/InstalledPluginsSettings.vue';
	import PluginInstanceSettings from '../plugins/components/PluginInstanceSettings.vue';
	import type { PluginPackageInstallation } from '../plugins/model/plugin-types';
	import AppManagementSettings from './AppManagementSettings.vue';

	type ExtensionSection = 'apps' | 'market' | 'budget';

	const AppExecutionPolicySettings = defineAsyncComponent(() => import('./AppExecutionPolicySettings.vue'));
	const PluginManagementSettings = defineAsyncComponent(
		() => import('../plugins/components/PluginManagementSettings.vue'),
	);

	const props = defineProps<{
		active: boolean;
		model: ReturnType<typeof useAppManagement>;
		plugins: ReturnType<typeof usePluginManagement>;
		revision: number;
	}>();
	const emit = defineEmits<{ recommend: [] }>();
	const { t } = useI18n();
	const activeSection = ref<ExtensionSection>('apps');
	const visitedSections = reactive(new Set<ExtensionSection>(['apps']));
	const sections = [
		{ id: 'apps', icon: 'fa-solid fa-boxes-stacked', label: 'agent.settings.extensionsNav.apps' },
		{ id: 'market', icon: 'fa-solid fa-store', label: 'agent.settings.extensionsNav.market' },
		{ id: 'budget', icon: 'fa-solid fa-sliders', label: 'agent.settings.extensionsNav.budget' },
	] as const;

	const settingsPackage = ref<PluginPackageInstallation | null>(null);
	const settingsAppId = ref('');
	const settingsName = computed(
		() =>
			props.plugins.versions.value.find((version) => version.packageHash === settingsPackage.value?.packageHash)
				?.manifest.displayName ??
			settingsPackage.value?.packageId ??
			'',
	);

	function openSettings(installation: PluginPackageInstallation, appId = ''): void {
		settingsAppId.value = appId;
		settingsPackage.value = installation;
	}

	watch(
		() => props.active && activeSection.value === 'apps',
		(active) => {
			if (!active) settingsPackage.value = null;
		},
	);

	function selectSection(section: ExtensionSection): void {
		activeSection.value = section;
		visitedSections.add(section);
	}
</script>

<template>
	<section class="min-w-0">
		<header class="ui-glass-chrome min-w-0 overflow-hidden rounded-xl">
			<nav
				class="extensions-tabs grid w-full min-w-0 grid-cols-3"
				role="tablist"
				:aria-label="t('agent.settings.groups.extensions')"
			>
				<button
					v-for="section in sections"
					:key="section.id"
					type="button"
					role="tab"
					class="relative flex w-full min-w-0 cursor-pointer items-center justify-center gap-1 border-b-2 px-1.5 py-3 text-xs font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-3"
					:class="
						activeSection === section.id
							? 'border-primary text-foreground'
							: 'border-transparent text-text-secondary hover:text-foreground'
					"
					:title="t(section.label)"
					:aria-selected="activeSection === section.id"
					:aria-current="activeSection === section.id ? 'page' : undefined"
					@click="selectSection(section.id)"
				>
					<span class="hidden min-[430px]:inline-flex" aria-hidden="true">
						<i
							:class="[
								section.icon,
								activeSection === section.id ? 'text-primary' : 'text-text-secondary',
							]"
							class="text-[11px]"
						></i>
					</span>
					<span class="min-w-0 truncate">{{ t(section.label) }}</span>
				</button>
			</nav>
		</header>

		<div v-if="visitedSections.has('apps')" v-show="activeSection === 'apps'" class="space-y-6 p-3 sm:p-4">
			<div class="min-w-0 space-y-2">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-foreground">
					<i class="fa-solid fa-wand-magic-sparkles text-xs text-primary" aria-hidden="true"></i
					>{{ t('agent.settings.plugins.installedAgents') }}
				</h3>
				<AppManagementSettings
					:model="model"
					:plugins="plugins"
					:active="active && activeSection === 'apps'"
					@settings="openSettings"
				/>
			</div>
			<InstalledPluginsSettings
				:model="plugins"
				:active="active && activeSection === 'apps'"
				@settings="openSettings"
			/>
		</div>
		<div v-if="visitedSections.has('market')" v-show="activeSection === 'market'" class="p-3 sm:p-4">
			<PluginManagementSettings
				embedded
				:model="plugins"
				:active="active && activeSection === 'market'"
				:revision="revision"
				:apps="model.apps.value"
				@recommend="emit('recommend')"
			/>
		</div>
		<div v-if="visitedSections.has('budget')" v-show="activeSection === 'budget'" class="p-3 sm:p-4">
			<AppExecutionPolicySettings
				embedded
				:apps="model.apps.value"
				:active="active && activeSection === 'budget'"
			/>
		</div>
		<PluginInstanceSettings
			v-if="active && activeSection === 'apps' && settingsPackage"
			:key="settingsPackage.packageHash + settingsAppId"
			:installation="settingsPackage"
			:name="settingsName"
			:apps="model.apps.value"
			:initial-app-id="settingsAppId"
			@close="settingsPackage = null"
		/>
	</section>
</template>
