<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiConfirmationPanel, UiEmptyState, UiInlineNotice } from '@/foundation/ui';
	import type { useAppManagement } from '../composables/use-app-management';
	import type { usePluginManagement } from '../plugins/composables/use-plugin-management';
	import type { PluginPackageInstallation } from '../plugins/model/plugin-types';
	import type { ManagedApp } from '../model/app-management-types';
	import InstalledPluginRow from '../plugins/components/InstalledPluginRow.vue';
	import AppGovernanceEditor from './AppGovernanceEditor.vue';
	const { t } = useI18n();
	const props = defineProps<{
		model: ReturnType<typeof useAppManagement>;
		plugins: ReturnType<typeof usePluginManagement>;
		active: boolean;
	}>();
	const emit = defineEmits<{ settings: [installation: PluginPackageInstallation, appId: string] }>();
	const { apps, selectedId, appOperation, loadApps, toggle } = props.model;
	const uninstallAppId = ref('');
	const clearOnUninstall = ref(false);
	watch(uninstallAppId, () => {
		clearOnUninstall.value = false;
	});
	watch(
		() => props.active,
		(active) => {
			if (!active) uninstallAppId.value = '';
		},
	);
	const uninstallApp = computed(() => apps.value.find((app) => app.id === uninstallAppId.value));
	const installationsByApp = computed(
		() =>
			new Map(
				props.plugins.installations.value
					.filter((installation) => installation.status !== 'removed')
					.map((installation) => [installation.appId, installation]),
			),
	);
	const uninstallInstallation = computed(() => installationsByApp.value.get(uninstallAppId.value));
	const blocked = computed(
		() =>
			appOperation.busy.value || appOperation.refreshRequired.value || !props.active || !props.plugins.canWrite(),
	);

	function installationFor(app: ManagedApp) {
		return installationsByApp.value.get(app.id);
	}

	function settingsPackageFor(app: ManagedApp): PluginPackageInstallation | undefined {
		const binding = installationFor(app);
		if (!binding) return undefined;
		const installation = props.plugins.packageInstallations.value.find(
			(item) =>
				item.packageId === app.definitionId &&
				item.packageHash === binding.packageHash &&
				item.publisherKeyId === binding.publisherKeyId &&
				item.status === 'installed',
		);
		if (!installation) return undefined;
		const version = props.plugins.versions.value.find(
			(item) =>
				item.packageHash === installation.packageHash &&
				item.publisherKeyId === installation.publisherKeyId &&
				item.manifest.id === installation.packageId &&
				item.manifest.version === installation.version,
		);
		return version?.manifest.settings ? installation : undefined;
	}

	function openSettings(app: ManagedApp): void {
		const installation = settingsPackageFor(app);
		if (props.active && installation) emit('settings', installation, app.id);
	}

	async function confirmUninstall(cancel = false): Promise<void> {
		const installation = uninstallInstallation.value;
		if (blocked.value || !installation || uninstallApp.value?.enabled) return;
		await props.plugins.retire(installation, cancel, !cancel && clearOnUninstall.value);
		if (!uninstallInstallation.value || cancel) uninstallAppId.value = '';
	}
</script>
<template>
	<section class="min-w-0" :aria-label="t('agent.settings.apps.title')">
		<div class="space-y-2">
			<UiButton
				v-if="appOperation.refreshRequired.value || appOperation.notice.value === 'failed'"
				type="button"
				:disabled="appOperation.busy.value"
				@click="loadApps"
				>{{ t('agent.settings.appManagement.readApps') }}</UiButton
			>
			<InstalledPluginRow
				v-for="app in apps"
				:key="app.id"
				:data-app-id="app.id"
				:name="app.name"
				:version="app.definitionVersion"
				icon="fa-solid fa-wand-magic-sparkles"
				:status-label="
					t(app.enabled ? 'agent.settings.apps.statusEnabled' : 'agent.settings.apps.statusDisabled')
				"
				:status-tone="app.enabled ? 'success' : 'neutral'"
			>
				<template #actions>
					<UiButton
						v-if="settingsPackageFor(app)"
						type="button"
						appearance="ghost"
						density="compact"
						class="agent-app-action--settings"
						:aria-label="t('agent.settings.plugins.settings.open')"
						:title="t('agent.settings.plugins.settings.open')"
						:disabled="!active || !props.plugins.canWrite()"
						@click="openSettings(app)"
						><i class="fa-solid fa-sliders text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{
							t('agent.settings.plugins.settings.open')
						}}</span></UiButton
					>
					<UiButton
						type="button"
						:appearance="selectedId === app.id ? 'soft' : 'ghost'"
						density="compact"
						class="agent-app-action--security"
						:aria-label="t('agent.settings.apps.configPermissions')"
						:title="t('agent.settings.apps.configPermissions')"
						:aria-expanded="selectedId === app.id"
						@click="selectedId = selectedId === app.id ? '' : app.id"
						><i class="fa-solid fa-shield-halved text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{ t('agent.settings.apps.configPermissions') }}</span
						><i
							data-installed-action-label
							class="fa-solid fa-chevron-down text-[9px] transition-transform"
							:class="{ 'rotate-180': selectedId === app.id }"
							aria-hidden="true"
						></i
					></UiButton>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						:tone="app.enabled ? 'warning' : 'success'"
						:class="{ 'agent-app-action--disable': app.enabled }"
						:aria-label="
							t(
								app.enabled
									? 'agent.settings.appManagement.disable'
									: 'agent.settings.appManagement.enable',
							)
						"
						:title="
							t(
								app.enabled
									? 'agent.settings.appManagement.disable'
									: 'agent.settings.appManagement.enable',
							)
						"
						:disabled="blocked"
						@click="toggle(app)"
						><i class="fa-solid fa-power-off text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{
							t(
								app.enabled
									? 'agent.settings.appManagement.disable'
									: 'agent.settings.appManagement.enable',
							)
						}}</span></UiButton
					>
					<UiButton
						type="button"
						appearance="ghost"
						tone="danger"
						density="compact"
						:aria-label="t('agent.settings.apps.uninstall')"
						:title="
							t(
								!installationFor(app)
									? 'agent.settings.apps.installationUnavailable'
									: app.enabled
										? 'agent.settings.apps.uninstallDisabledHint'
										: 'agent.settings.apps.uninstall',
							)
						"
						:disabled="blocked || app.enabled || !installationFor(app)"
						@click="uninstallAppId = app.id"
						><i class="fa-regular fa-trash-can text-[11px]" aria-hidden="true"></i
						><span data-installed-action-label>{{ t('agent.settings.apps.uninstall') }}</span></UiButton
					>
				</template>
				<div v-if="selectedId === app.id" class="mt-3 border-t border-border/40 pt-4">
					<AppGovernanceEditor :key="app.id" :app="app" :active="active" />
				</div>
			</InstalledPluginRow>
			<UiEmptyState
				v-if="apps.length === 0"
				icon="fa-solid fa-box-open"
				:title="t('agent.settings.apps.empty')"
			/>
		</div>
	</section>
	<UiConfirmationPanel
		:visible="active && Boolean(uninstallApp && uninstallInstallation)"
		:title="t('agent.settings.apps.uninstallConfirmTitle')"
		:description="
			t('agent.settings.apps.uninstallConfirmPrompt', {
				name: uninstallApp?.name,
				version: uninstallApp?.definitionVersion,
			})
		"
		tone="danger"
		icon="fas fa-exclamation-triangle"
		:close-on-backdrop="!props.plugins.operation.busy.value"
		:close-on-escape="!props.plugins.operation.busy.value"
		@close="uninstallAppId = ''"
	>
		<div class="space-y-4">
			<UiInlineNotice tone="danger" compact>
				<div>
					<p class="text-sm font-semibold">{{ uninstallApp?.name }}</p>
					<p class="font-mono text-xs text-text-secondary">v{{ uninstallApp?.definitionVersion }}</p>
				</div>
			</UiInlineNotice>
			<p class="text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.plugins.uninstallDataHint') }}
			</p>
			<label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
				<UiCheckbox
					v-model="clearOnUninstall"
					:disabled="props.plugins.operation.busy.value"
					:aria-label="t('agent.settings.plugins.clearOnUninstall')"
				/>
				<span>{{ t('agent.settings.plugins.clearOnUninstall') }}</span>
			</label>
			<p v-if="clearOnUninstall" class="text-xs leading-relaxed text-text-secondary">
				{{ t('agent.settings.plugins.clearDataScope') }}
			</p>
		</div>
		<template #actions>
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
			<UiButton
				type="button"
				appearance="solid"
				tone="danger"
				:loading="props.plugins.operation.busy.value"
				:disabled="blocked || uninstallApp?.enabled"
				@click="confirmUninstall()"
			>
				<i class="fa-regular fa-trash-can" aria-hidden="true"></i>
				{{
					t(
						uninstallInstallation?.status === 'draining'
							? 'agent.settings.plugins.continueUninstall'
							: 'agent.settings.apps.uninstall',
					)
				}}
			</UiButton>
		</template>
	</UiConfirmationPanel>
</template>

<style scoped>
	.agent-app-action--settings {
		color: var(--link-color);
	}
	.agent-app-action--security {
		color: color-mix(in srgb, var(--status-info-color) 70%, var(--text-color));
	}
	.agent-app-action--disable {
		color: color-mix(in srgb, var(--status-warning-color) 45%, var(--text-color));
	}
</style>
