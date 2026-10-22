<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiFormActions, UiInfoHint, UiModal } from '@/foundation/ui';
	import type { useAppManagement } from '../composables/use-app-management';
	import type { usePluginManagement } from '../composables/use-plugin-management';
	import type { ManagedApp } from '../model/app-management-types';
	import PluginDataEditor from './PluginDataEditor.vue';
	import AppGovernanceEditor from './AppGovernanceEditor.vue';
	const { t } = useI18n();
	const props = withDefaults(
		defineProps<{
			model: ReturnType<typeof useAppManagement>;
			plugins: ReturnType<typeof usePluginManagement>;
			active: boolean;
			embedded?: boolean;
		}>(),
		{ embedded: false },
	);
	const { apps, definitions, selectedId, appOperation, loadApps, toggle } = props.model;
	const uninstallAppId = ref('');
	watch(
		() => props.active,
		(active) => {
			if (!active) uninstallAppId.value = '';
		},
	);
	const uninstallApp = computed(() => apps.value.find((app) => app.id === uninstallAppId.value));
	const uninstallInstallation = computed(() =>
		props.plugins.installations.value.find(
			(installation) => installation.appId === uninstallAppId.value && installation.status !== 'removed',
		),
	);
	const enabledCount = computed(() => apps.value.filter((app) => app.enabled).length);
	const blocked = computed(
		() =>
			appOperation.busy.value || appOperation.refreshRequired.value || !props.active || !props.plugins.canWrite(),
	);
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

	function installationFor(app: ManagedApp) {
		return props.plugins.installations.value.find((item) => item.appId === app.id && item.status !== 'removed');
	}

	function isOfficial(app: ManagedApp): boolean {
		const installation = installationFor(app);
		return (
			installation !== undefined && props.plugins.officialPublisherIds.value.includes(installation.publisherKeyId)
		);
	}

	async function confirmUninstall(cancel = false): Promise<void> {
		const installation = uninstallInstallation.value;
		if (blocked.value || !installation || uninstallApp.value?.enabled) return;
		await props.plugins.retire(installation, cancel);
		if (!uninstallInstallation.value || cancel) uninstallAppId.value = '';
	}

	function definitionName(definitionId: string): string {
		return definitionNames.value.get(definitionId) ?? t('agent.settings.apps.unknownDefinition');
	}
</script>
<template>
	<section
		:class="embedded ? 'min-w-0' : 'overflow-hidden rounded-2xl border border-border bg-card shadow-xs'"
		:aria-label="t('agent.settings.apps.title')"
	>
		<div
			v-if="!embedded"
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4"
		>
			<div class="flex items-center gap-2.5">
				<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<i class="fa-solid fa-puzzle-piece text-sm" aria-hidden="true"></i>
				</div>
				<div class="flex items-center gap-1.5">
					<h3 class="text-sm font-bold text-foreground">{{ t('agent.settings.apps.title') }}</h3>
					<UiInfoHint :text="t('agent.settings.apps.description')" />
				</div>
			</div>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-text-secondary shadow-2xs"
				><span class="h-1.5 w-1.5 rounded-full bg-success"></span
				>{{ t('agent.settings.apps.enabledCount', { enabled: enabledCount, total: apps.length }) }}</span
			>
		</div>
		<div :class="embedded ? 'space-y-1' : 'space-y-4 p-4 sm:p-5'">
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
				:data-app-id="app.id"
				class="border-b border-border/35 transition-colors duration-200 last:border-b-0"
				:class="[
					embedded ? 'px-1 py-3.5' : 'overflow-hidden rounded-xl bg-header/20 p-4 sm:p-5',
					app.enabled ? 'hover:bg-header/20' : 'opacity-80',
				]"
			>
				<div :class="embedded ? '' : 'p-0'">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex min-w-0 items-start gap-3.5">
							<div
								class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-xs"
								:class="appVisuals(app.definitionId).iconBg"
							>
								<i :class="appVisuals(app.definitionId).icon" class="text-lg" aria-hidden="true"></i>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
									<span class="text-sm font-semibold tracking-tight text-foreground">{{
										app.name
									}}</span>
									<span class="font-mono text-[11px] text-text-secondary"
										>v{{ app.definitionVersion }}</span
									>
									<span
										class="inline-flex items-center gap-1 text-[11px] font-medium"
										:class="app.enabled ? 'text-success' : 'text-text-secondary'"
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
								<div
									class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-secondary"
								>
									<span>{{ definitionName(app.definitionId) }}</span>
									<span aria-hidden="true">·</span>
									<span
										>{{ t('agent.settings.apps.declaredCapabilities') }}
										{{ app.capabilities.length }}</span
									>
									<template v-if="installationFor(app)">
										<span aria-hidden="true">·</span>
										<span class="text-primary">{{
											t(
												isOfficial(app)
													? appVisuals(app.definitionId).badge
													: 'agent.settings.plugins.signatureVerified',
											)
										}}</span>
									</template>
								</div>
							</div>
						</div>
						<div class="flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:self-center">
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
							<UiButton
								type="button"
								appearance="soft"
								:tone="app.enabled || !installationFor(app) ? 'neutral' : 'danger'"
								:disabled="blocked || app.enabled || !installationFor(app)"
								:title="
									t(
										!installationFor(app)
											? 'agent.settings.apps.coreAppCannotUninstall'
											: app.enabled
												? 'agent.settings.apps.uninstallDisabledHint'
												: 'agent.settings.apps.uninstall',
									)
								"
								@click="uninstallAppId = app.id"
							>
								<i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
								{{ t('agent.settings.apps.uninstall') }}
							</UiButton>
						</div>
					</div>
				</div>
				<div v-if="selectedId === app.id" class="mt-3 border-t border-border/40 pt-4">
					<AppGovernanceEditor :key="app.id" :app="app" :active="active" />
				</div>
			</article>
			<UiEmptyState
				v-if="apps.length === 0"
				icon="fa-solid fa-box-open"
				:title="t('agent.settings.apps.empty')"
			/>
		</div>
	</section>
	<UiModal
		:visible="active && Boolean(uninstallApp && uninstallInstallation)"
		:title="t('agent.settings.apps.uninstallConfirmTitle')"
		panel-class="max-w-md p-5 rounded-2xl"
		:close-on-backdrop="!props.plugins.operation.busy.value"
		:close-on-escape="!props.plugins.operation.busy.value"
		@close="uninstallAppId = ''"
	>
		<div class="space-y-4">
			<div class="flex items-center gap-3 rounded-xl border border-error/20 bg-error/5 p-3">
				<i class="fa-solid fa-triangle-exclamation text-error" aria-hidden="true"></i>
				<div>
					<p class="text-sm font-semibold">{{ uninstallApp?.name }}</p>
					<p class="font-mono text-xs text-text-secondary">v{{ uninstallApp?.definitionVersion }}</p>
				</div>
			</div>
			<p class="text-xs leading-relaxed text-text-secondary">
				{{
					t('agent.settings.apps.uninstallConfirmPrompt', {
						name: uninstallApp?.name,
						version: uninstallApp?.definitionVersion,
					})
				}}
			</p>
			<p class="text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.plugins.uninstallDataHint') }}
			</p>
			<PluginDataEditor
				v-if="uninstallInstallation?.status === 'draining'"
				:key="uninstallInstallation.appId + ':' + uninstallInstallation.revision"
				retained-only
				:installation="uninstallInstallation"
				:disabled="blocked"
				:active="active"
				@changed="props.plugins.load"
			/>
		</div>
		<template #footer>
			<UiFormActions>
				<UiButton
					type="button"
					appearance="solid"
					tone="danger"
					:disabled="blocked || uninstallApp?.enabled"
					@click="confirmUninstall()"
				>
					<i
						:class="
							props.plugins.operation.busy.value
								? 'fa-solid fa-circle-notch fa-spin'
								: 'fa-regular fa-trash-can'
						"
						aria-hidden="true"
					></i>
					{{
						t(
							uninstallInstallation?.status === 'draining'
								? 'agent.settings.plugins.continueUninstall'
								: 'agent.settings.apps.uninstall',
						)
					}}
				</UiButton>
				<UiButton
					v-if="uninstallInstallation?.status === 'draining'"
					type="button"
					appearance="soft"
					tone="neutral"
					:disabled="blocked"
					@click="confirmUninstall(true)"
					>{{ t('agent.pluginManagement.cancelRetirement') }}</UiButton
				>
				<UiButton
					type="button"
					appearance="soft"
					tone="neutral"
					:disabled="props.plugins.operation.busy.value"
					@click="uninstallAppId = ''"
					>{{ t('common.cancel') }}</UiButton
				>
			</UiFormActions>
		</template>
	</UiModal>
</template>
