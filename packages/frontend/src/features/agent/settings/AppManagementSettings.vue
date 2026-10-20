<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInfoHint, UiSelect } from '@/foundation/ui';
	import type { useAppManagement } from '../composables/use-app-management';
	import AppGovernanceEditor from './AppGovernanceEditor.vue';
	const { t } = useI18n();
	const props = defineProps<{ model: ReturnType<typeof useAppManagement> }>();
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
	} = props.model;
	const enabledCount = computed(() => apps.value.filter((app) => app.enabled).length);
	const blocked = computed(() => appOperation.busy.value || appOperation.refreshRequired.value);
</script>
<template>
	<section
		class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
		:aria-label="t('agent.settings.appManagement.title')"
	>
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4"
		>
			<div class="flex items-center gap-2.5">
				<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<i class="fa-solid fa-puzzle-piece text-sm" aria-hidden="true"></i>
				</div>
				<h3 class="text-sm font-bold text-foreground">{{ t('agent.settings.appManagement.title') }}</h3>
				<UiInfoHint :text="t('agent.settings.appManagement.description')" />
			</div>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-text-secondary shadow-2xs"
				><span class="h-1.5 w-1.5 rounded-full bg-success"></span
				>{{ t('agent.settings.apps.enabledCount', { enabled: enabledCount, total: apps.length }) }}</span
			>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<p v-if="appOperation.notice.value" role="status" class="text-sm">
				{{ t('agent.settings.appManagement.' + appOperation.notice.value) }}
			</p>
			<p v-if="appOperation.refreshRequired.value" class="text-sm text-warning">
				{{ t('agent.settings.appManagement.refreshRequired') }}
			</p>
			<UiButton
				v-if="appOperation.refreshRequired.value || appOperation.notice.value === 'failed'"
				type="button"
				:disabled="appOperation.busy.value"
				@click="loadApps"
				>{{ t('agent.settings.appManagement.readApps') }}</UiButton
			>
			<article
				v-for="app in apps"
				:key="app.id"
				class="overflow-hidden rounded-xl transition-colors duration-200"
				:class="app.enabled ? 'bg-header/20 hover:bg-header/35' : 'bg-header/40 opacity-85'"
			>
				<div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
					<div class="flex min-w-0 items-center gap-3.5">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs"
						>
							<i class="fa-solid fa-puzzle-piece text-xl" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<h4 class="text-sm font-bold tracking-tight text-foreground">{{ app.name }}</h4>
							<p class="mt-1 break-all text-xs text-text-secondary">
								{{ app.definitionId }}@{{ app.definitionVersion }}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 items-center justify-end gap-2">
						<UiButton
							appearance="soft"
							type="button"
							:aria-expanded="selectedId === app.id"
							@click="selectedId = selectedId === app.id ? '' : app.id"
							><i class="fa-solid fa-shield-halved text-xs text-primary" aria-hidden="true"></i
							>{{ t('agent.settings.apps.configPermissions')
							}}<i
								class="fa-solid fa-chevron-down text-[10px] transition-transform"
								:class="{ 'rotate-180': selectedId === app.id }"
								aria-hidden="true"
							></i
						></UiButton>
						<UiButton
							type="button"
							:appearance="app.enabled ? 'soft' : 'solid'"
							:tone="app.enabled ? 'neutral' : 'primary'"
							:disabled="blocked"
							@click="toggle(app)"
							><span
								class="h-1.5 w-1.5 rounded-full"
								:class="app.enabled ? 'bg-success' : 'bg-white/70'"
							></span
							>{{
								t(
									app.enabled
										? 'agent.settings.appManagement.disable'
										: 'agent.settings.appManagement.enable',
								)
							}}</UiButton
						>
					</div>
				</div>
				<div v-if="selectedId === app.id" class="border-t border-border bg-header/20 p-4 sm:p-5">
					<AppGovernanceEditor :key="app.id" :app="app" />
				</div>
			</article>
			<details class="rounded-xl border border-border p-4">
				<summary class="cursor-pointer text-sm font-medium">
					{{ t('agent.settings.appManagement.create') }}
				</summary>
				<form class="mt-3 space-y-3" @submit.prevent="create">
					<p v-if="definitionOperation.notice.value" role="alert">
						{{ t('agent.settings.appManagement.definitionsFailed') }}
					</p>
					<UiButton
						v-if="
							definitionOperation.refreshRequired.value || definitionOperation.notice.value === 'failed'
						"
						type="button"
						:disabled="definitionOperation.busy.value"
						@click="loadDefinitions"
						>{{ t('agent.settings.appManagement.readDefinitions') }}</UiButton
					>
					<fieldset
						:disabled="
							blocked || definitionOperation.busy.value || definitionOperation.refreshRequired.value
						"
						class="space-y-3"
					>
						<label class="block space-y-1 text-sm"
							><span>{{ t('agent.settings.appManagement.name') }}</span
							><input v-model="name" class="w-full rounded border border-border bg-background p-2"
						/></label>
						<label class="block space-y-1 text-sm"
							><span>{{ t('agent.settings.appManagement.definition') }}</span
							><UiSelect
								v-model="definitionId"
								:placeholder="t('agent.settings.appManagement.chooseDefinition')"
								><option v-for="definition in definitions" :key="definition.id" :value="definition.id">
									{{ definition.name }} · {{ definition.id }}@{{ definition.version }}
								</option></UiSelect
							></label
						>
						<UiButton type="submit" appearance="solid" tone="primary" :disabled="!definitionId">{{
							t('agent.settings.appManagement.create')
						}}</UiButton>
					</fieldset>
				</form>
			</details>
		</div>
	</section>
</template>
