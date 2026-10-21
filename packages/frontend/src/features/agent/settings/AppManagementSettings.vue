<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiInfoHint, UiSelect } from '@/foundation/ui';
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
	const definitionNames = computed(
		() => new Map(definitions.value.map((definition) => [definition.id, definition.name])),
	);

	function appVisuals(definitionId: string) {
		if (definitionId === 'nexus.agent') {
			return {
				icon: 'fa-solid fa-wand-magic-sparkles',
				iconBg: 'bg-gradient-to-br from-primary/20 via-primary/15 to-transparent text-primary ring-1 ring-primary/25',
				badge: 'agent.settings.apps.coreOfficial',
				summary: 'agent.settings.apps.summaries.nexusAgent',
			};
		}
		if (definitionId === 'nexus.fullstack') {
			return {
				icon: 'fa-solid fa-layer-group',
				iconBg: 'bg-gradient-to-br from-success/20 via-success/15 to-transparent text-success ring-1 ring-success/25',
				badge: 'agent.settings.apps.badges.officialExtension',
				summary: 'agent.settings.apps.summaries.nexusFullstack',
			};
		}
		return {
			icon: 'fa-solid fa-puzzle-piece',
			iconBg: 'bg-primary/10 text-primary ring-1 ring-primary/20',
			badge: 'agent.settings.apps.badges.thirdParty',
			summary: 'agent.settings.apps.summaries.default',
		};
	}

	function definitionName(definitionId: string): string {
		return definitionNames.value.get(definitionId) ?? t('agent.settings.apps.unknownDefinition');
	}
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
				<div class="flex items-center gap-1.5">
					<h3 class="text-sm font-bold text-foreground">{{ t('agent.settings.appManagement.title') }}</h3>
					<UiInfoHint :text="t('agent.settings.appManagement.description')" />
				</div>
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
				<div class="p-4 sm:p-5">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex min-w-0 items-start gap-3.5">
							<div
								class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-xs"
								:class="appVisuals(app.definitionId).iconBg"
							>
								<i :class="appVisuals(app.definitionId).icon" class="text-xl" aria-hidden="true"></i>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-bold tracking-tight text-foreground">{{ app.name }}</span>
									<span
										class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
										>{{ t(appVisuals(app.definitionId).badge) }}</span
									>
									<span
										class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
										:class="
											app.enabled
												? 'border-success/30 bg-success/10 text-success'
												: 'border-border bg-header text-text-secondary'
										"
									>
										<span
											class="h-1.5 w-1.5 rounded-full"
											:class="app.enabled ? 'bg-success' : 'bg-text-secondary/50'"
										></span>
										{{
											t(
												app.enabled
													? 'agent.settings.apps.statusEnabled'
													: 'agent.settings.apps.statusDisabled',
											)
										}}
									</span>
								</div>
								<p class="mt-1 line-clamp-1 text-xs leading-relaxed text-text-secondary">
									{{ t(appVisuals(app.definitionId).summary) }}
								</p>
								<div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
									<span
										class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-text-secondary shadow-2xs"
									>
										<i
											class="fa-solid fa-cube text-[9px] text-text-secondary/70"
											aria-hidden="true"
										></i>
										{{ definitionName(app.definitionId) }}
									</span>
									<span
										class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-text-secondary shadow-2xs"
									>
										<i class="fa-solid fa-key text-[9px] text-primary" aria-hidden="true"></i>
										{{ t('agent.settings.apps.declaredCapabilities') }}:
										<strong class="font-mono text-foreground">{{ app.capabilities.length }}</strong>
									</span>
								</div>
								<details class="mt-2 text-[10px] text-text-secondary">
									<summary class="cursor-pointer select-none">
										{{ t('agent.settings.apps.technicalDetails') }}
									</summary>
									<code class="mt-1 block break-all">
										{{ app.id }} · {{ app.definitionId }}@{{ app.definitionVersion }} · v{{
											app.version
										}}
									</code>
								</details>
							</div>
						</div>
						<div class="flex shrink-0 items-center justify-end gap-2 self-end sm:self-center">
							<UiButton
								appearance="soft"
								tone="neutral"
								type="button"
								:aria-expanded="selectedId === app.id"
								@click="selectedId = selectedId === app.id ? '' : app.id"
								><i class="fa-solid fa-shield-halved text-xs text-primary" aria-hidden="true"></i>
								<span>{{ t('agent.settings.apps.configPermissions') }}</span>
								<i
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
								></span>
								{{
									t(
										app.enabled
											? 'agent.settings.appManagement.disable'
											: 'agent.settings.appManagement.enable',
									)
								}}</UiButton
							>
						</div>
					</div>
				</div>
				<div v-if="selectedId === app.id" class="border-t border-border bg-header/20 p-4 sm:p-5">
					<AppGovernanceEditor :key="app.id" :app="app" />
				</div>
			</article>
			<UiEmptyState
				v-if="apps.length === 0"
				icon="fa-solid fa-box-open"
				:title="t('agent.settings.apps.empty')"
			/>
			<details class="overflow-hidden rounded-xl border border-border bg-header/15">
				<summary
					class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium"
				>
					<span class="flex items-center gap-2"
						><i class="fa-solid fa-plus text-[10px] text-primary" aria-hidden="true"></i
						>{{ t('agent.settings.appManagement.create') }}</span
					>
					<i class="fa-solid fa-chevron-down text-[10px] text-text-secondary" aria-hidden="true"></i>
				</summary>
				<form class="space-y-3 border-t border-border bg-background/40 p-4" @submit.prevent="create">
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
						<label class="block space-y-1 text-xs font-medium text-foreground"
							><span>{{ t('agent.settings.appManagement.name') }}</span
							><input
								v-model="name"
								class="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-border-hover"
						/></label>
						<label class="block space-y-1 text-xs font-medium text-foreground"
							><span>{{ t('agent.settings.appManagement.definition') }}</span
							><UiSelect
								v-model="definitionId"
								:placeholder="t('agent.settings.appManagement.chooseDefinition')"
								><option v-for="definition in definitions" :key="definition.id" :value="definition.id">
									{{ definition.name }}
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
