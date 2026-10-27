<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiInfoHint, UiSelect } from '@/foundation/ui';
	import type { ManagedApp } from '../model/app-management-types';
	import AppExecutionPolicyEditor from './AppExecutionPolicyEditor.vue';

	const props = withDefaults(defineProps<{ apps: ManagedApp[]; active: boolean; embedded?: boolean }>(), {
		embedded: false,
	});
	const { t } = useI18n();
	const selectedAppId = ref('');
	const appOptions = computed(() => props.apps.map((app) => ({ value: app.id, label: app.name })));
	watch(
		appOptions,
		(options) => {
			if (!options.some((option) => option.value === selectedAppId.value))
				selectedAppId.value = options[0]?.value ?? '';
		},
		{ immediate: true },
	);
</script>

<template>
	<section :class="embedded ? 'min-w-0' : 'ui-glass-panel overflow-hidden rounded-2xl'">
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3"
			:class="embedded ? 'justify-end pb-3' : 'ui-glass-chrome border-b border-border px-4 py-3 sm:px-5'"
		>
			<div v-if="!embedded" class="flex items-center gap-1.5">
				<h3 class="text-sm font-semibold text-foreground">{{ t('agent.settings.executionPolicy.title') }}</h3>
				<UiInfoHint :text="t('agent.settings.executionPolicy.description')" />
			</div>
			<UiSelect
				v-model="selectedAppId"
				class="min-w-52"
				:options="appOptions"
				:aria-label="t('agent.settings.executionPolicy.app')"
			/>
		</div>
		<AppExecutionPolicyEditor v-if="selectedAppId" :key="selectedAppId" :app-id="selectedAppId" :active="active" />
	</section>
</template>
