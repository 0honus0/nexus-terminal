<script setup lang="ts">
	import { onActivated, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSelect } from '@/foundation/ui';
	import { listManagedApps } from '../api/app-management-api';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	defineProps<{ title: string }>();

	const { t } = useI18n();
	const apps = ref<ManagedApp[]>([]);
	const selectedId = ref('');
	const operation = useAgentManagementOperation(() => {
		apps.value = [];
		selectedId.value = '';
	});

	async function load(): Promise<void> {
		await operation.execute(
			listManagedApps,
			(value) => {
				apps.value = value;
				if (!value.some((app) => app.id === selectedId.value)) {
					selectedId.value = '';
				}
			},
			{ write: false },
		);
	}

	function initial(): void {
		if (operation.refreshRequired.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
</script>
<template>
	<section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs" :aria-label="title">
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5"
		>
			<h3 class="text-sm font-semibold text-foreground">{{ title }}</h3>
		</div>
		<div class="space-y-5 p-4 sm:p-5">
			<p v-if="operation.notice.value" role="status">
				{{ t('agent.settings.appManagement.' + operation.notice.value) }}
			</p>
			<UiButton
				v-if="operation.refreshRequired.value || operation.notice.value === 'failed'"
				type="button"
				:disabled="operation.busy.value"
				@click="load"
				>{{ t('agent.settings.appManagement.readApps') }}</UiButton
			>
			<label class="block text-sm"
				>{{ t('agent.settings.appManagement.editApp')
				}}<UiSelect
					v-model="selectedId"
					:disabled="operation.busy.value || operation.refreshRequired.value"
					class="mt-1 w-full rounded border border-border bg-background p-2"
				>
					<option value="">{{ t('agent.settings.appManagement.chooseApp') }}</option>
					<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
				</UiSelect></label
			>
			<slot v-if="selectedId" :key="selectedId" :appId="selectedId" :apps="apps" />
		</div>
	</section>
</template>
