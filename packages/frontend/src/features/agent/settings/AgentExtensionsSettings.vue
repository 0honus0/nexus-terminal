<script setup lang="ts">
	import { computed, reactive, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiInfoHint } from '@/foundation/ui';
	import type { useAppManagement } from '../composables/use-app-management';
	import type { usePluginManagement } from '../composables/use-plugin-management';
	import AppExecutionPolicySettings from './AppExecutionPolicySettings.vue';
	import AppIntegrationSettings from './AppIntegrationSettings.vue';
	import AppManagementSettings from './AppManagementSettings.vue';
	import PluginManagementSettings from './PluginManagementSettings.vue';

	type ExtensionSection = 'apps' | 'integrations' | 'market' | 'budget';

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
		{ id: 'integrations', icon: 'fa-solid fa-plug', label: 'agent.settings.extensionsNav.integrations' },
		{ id: 'market', icon: 'fa-solid fa-store', label: 'agent.settings.extensionsNav.market' },
		{ id: 'budget', icon: 'fa-solid fa-sliders', label: 'agent.settings.extensionsNav.budget' },
	] as const;
	const enabledApps = computed(() => props.model.apps.value.filter((app) => app.enabled).length);

	function selectSection(section: ExtensionSection): void {
		activeSection.value = section;
		visitedSections.add(section);
	}
</script>

<template>
	<section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
		<header class="flex min-w-0 items-center gap-3 border-b border-border bg-header/25 px-3 sm:px-4">
			<nav
				class="extensions-tabs grid min-w-0 flex-1 grid-cols-4"
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
					<span>{{ t(section.label) }}</span>
				</button>
			</nav>
			<div class="hidden shrink-0 items-center gap-1.5 text-[11px] text-text-secondary sm:flex">
				<span class="h-1.5 w-1.5 rounded-full bg-success"></span>
				<span>{{
					t('agent.settings.apps.enabledCount', { enabled: enabledApps, total: model.apps.value.length })
				}}</span>
				<UiInfoHint :text="t('agent.settings.groupDescriptions.extensions')" />
			</div>
		</header>

		<div v-if="visitedSections.has('apps')" v-show="activeSection === 'apps'" class="p-3 sm:p-4">
			<AppManagementSettings
				embedded
				:model="model"
				:plugins="plugins"
				:active="active && activeSection === 'apps'"
			/>
		</div>
		<div v-if="visitedSections.has('integrations')" v-show="activeSection === 'integrations'" class="p-3 sm:p-4">
			<AppIntegrationSettings
				embedded
				:apps="model.apps.value"
				:active="active && activeSection === 'integrations'"
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
	</section>
</template>

<style scoped>
	.extensions-tabs {
		scrollbar-width: none;
	}

	.extensions-tabs::-webkit-scrollbar {
		display: none;
	}
</style>
