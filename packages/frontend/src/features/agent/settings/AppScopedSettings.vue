<script setup lang="ts">
	import { onActivated, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
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
	<section class="space-y-4 rounded-xl border border-border bg-card p-4" :aria-label="title">
		<h3 class="font-medium">{{ title }}</h3>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<UiButton type="button" :disabled="operation.busy.value" @click="load">{{
			t('agent.settings.appManagement.readApps')
		}}</UiButton>
		<label class="block text-sm"
			>{{ t('agent.settings.appManagement.editApp')
			}}<select
				v-model="selectedId"
				:disabled="operation.busy.value || operation.refreshRequired.value"
				class="mt-1 w-full rounded border border-border bg-background p-2"
			>
				<option value="">{{ t('agent.settings.appManagement.chooseApp') }}</option>
				<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }} · {{ app.id }}</option>
			</select></label
		>
		<slot v-if="selectedId" :key="selectedId" :appId="selectedId" :apps="apps" />
	</section>
</template>
