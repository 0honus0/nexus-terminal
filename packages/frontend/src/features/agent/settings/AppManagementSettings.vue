<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import { useAppManagement } from '../composables/use-app-management';
	import AppGovernanceEditor from './AppGovernanceEditor.vue';
	const { t } = useI18n();
	const {
		apps,
		definitions,
		name,
		definitionId,
		selectedId,
		appOperation,
		definitionOperation,
		loadApps,
		loadDefinitions,
		create,
		toggle,
	} = useAppManagement();
	const selected = computed(() => apps.value.find((app) => app.id === selectedId.value));
	const blocked = computed(() => appOperation.busy.value || appOperation.refreshRequired.value);

	function chooseApp(event: Event): void {
		if (event.target instanceof HTMLSelectElement) {
			selectedId.value = event.target.value;
		}
	}

	function chooseDefinition(event: Event): void {
		if (event.target instanceof HTMLSelectElement) {
			definitionId.value = event.target.value;
		}
	}
</script>
<template>
	<section
		class="space-y-4 rounded-xl border border-border bg-card p-4"
		:aria-label="t('agent.settings.appManagement.title')"
	>
		<h3 class="font-medium">{{ t('agent.settings.appManagement.title') }}</h3>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.appManagement.description') }}</p>
		<p v-if="appOperation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + appOperation.notice.value) }}
		</p>
		<p v-if="appOperation.refreshRequired.value" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<UiButton type="button" :disabled="appOperation.busy.value" @click="loadApps">{{
			t('agent.settings.appManagement.readApps')
		}}</UiButton>
		<article v-for="app in apps" :key="app.id" class="space-y-2 rounded border border-border p-3">
			<h4 class="font-medium">{{ app.name }} · v{{ app.version }}</h4>
			<p class="break-all text-xs text-text-secondary">
				{{ app.definitionId }}@{{ app.definitionVersion }} · {{ app.id }}
			</p>
			<p class="text-xs">{{ app.capabilities.join(', ') }}</p>
			<UiButton type="button" :disabled="blocked" @click="toggle(app)">{{
				t(app.enabled ? 'agent.settings.appManagement.disable' : 'agent.settings.appManagement.enable')
			}}</UiButton>
		</article>
		<form class="space-y-3 rounded border border-border p-3" @submit.prevent="create">
			<h4>{{ t('agent.settings.appManagement.create') }}</h4>
			<p v-if="definitionOperation.notice.value" role="alert">
				{{ t('agent.settings.appManagement.definitionsFailed') }}
			</p>
			<UiButton type="button" :disabled="definitionOperation.busy.value" @click="loadDefinitions">{{
				t('agent.settings.appManagement.readDefinitions')
			}}</UiButton>
			<fieldset
				:disabled="blocked || definitionOperation.busy.value || definitionOperation.refreshRequired.value"
				class="space-y-3"
			>
				<label class="block text-sm"
					>{{ t('agent.settings.appManagement.name')
					}}<input v-model="name" class="mt-1 w-full rounded border border-border bg-background p-2"
				/></label>
				<label class="block text-sm"
					>{{ t('agent.settings.appManagement.definition')
					}}<select
						:value="definitionId"
						class="mt-1 w-full rounded border border-border bg-background p-2"
						@change="chooseDefinition"
					>
						<option value="">{{ t('agent.settings.appManagement.chooseDefinition') }}</option>
						<option v-for="definition in definitions" :key="definition.id" :value="definition.id">
							{{ definition.name }} · {{ definition.id }}@{{ definition.version }}
						</option>
					</select></label
				>
				<UiButton type="submit" :disabled="!definitionId">{{
					t('agent.settings.appManagement.create')
				}}</UiButton>
			</fieldset>
		</form>
		<label class="block text-sm"
			>{{ t('agent.settings.appManagement.editApp')
			}}<select
				:value="selectedId"
				:disabled="appOperation.busy.value"
				class="mt-1 w-full rounded border border-border bg-background p-2"
				@change="chooseApp"
			>
				<option value="">{{ t('agent.settings.appManagement.chooseApp') }}</option>
				<option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }} · {{ app.id }}</option>
			</select></label
		>
		<AppGovernanceEditor v-if="selected" :key="selected.id" :app="selected" />
	</section>
</template>
