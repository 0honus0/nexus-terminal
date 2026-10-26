<script setup lang="ts">
	import { ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiInfoHint, UiSelect } from '@/foundation/ui';
	import type { ManagedApp } from '../model/app-management-types';
	import AppIntegrationEditor from './AppIntegrationEditor.vue';

	const props = withDefaults(defineProps<{ apps: ManagedApp[]; active: boolean; embedded?: boolean }>(), {
		embedded: false,
	});
	const { t } = useI18n();
	const selectedAppId = ref('');
	watch(
		() => props.apps,
		(apps) => {
			if (!apps.some((app) => app.id === selectedAppId.value)) {
				selectedAppId.value = apps.find((app) => app.definitionId === 'nexus.agent')?.id ?? apps[0]?.id ?? '';
			}
		},
		{ immediate: true },
	);
</script>

<template>
	<AppIntegrationEditor
		v-if="selectedAppId"
		:key="selectedAppId"
		:app-id="selectedAppId"
		:active="active"
		:embedded="embedded"
	>
		<template #app-selector>
			<UiSelect
				v-if="apps.length > 1"
				v-model="selectedAppId"
				class="w-40"
				:aria-label="t('agent.settings.appManagement.chooseApp')"
			>
				<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
			</UiSelect>
		</template>
	</AppIntegrationEditor>
	<section
		v-else
		:class="embedded ? 'min-w-0' : 'ui-glass-panel overflow-hidden rounded-2xl'"
		:aria-label="t('agent.settings.integrationManagement.title')"
	>
		<div class="agent-settings-head ui-glass-chrome flex items-center gap-2 px-4 py-3 sm:px-5 sm:py-3.5">
			<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.integrationManagement.title') }}</h3>
			<UiInfoHint :text="t('agent.settings.integrationManagement.description')" />
		</div>
	</section>
</template>
