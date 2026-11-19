<script setup lang="ts">
	import { Archive, ScrollText, Settings, Store } from '@lucide/vue';
	import { computed, onMounted, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { StateClient } from '../../state/browser/state-api.js';
	import { BackupApi, BackupApp, BackupTile } from '../../backup/browser/backup-api.js';
	import { DesktopApi, DesktopShell, type DesktopApplication } from '../../desktop/browser/desktop-api.js';
	import { LogApp } from '../../log/browser/log-history-api.js';
	import type { LogApi } from '../../log/browser/log-api.js';
	import {
		MarketplaceApp,
		MarketplaceDesktopApi,
		MarketplaceTile,
	} from '../../marketplace/browser/marketplace-desktop-api.js';
	import type { MarketplacePlugin } from '../../marketplace/marketplace-types.js';
	import type { PluginContributionList } from '../../plugin/plugin-api.browser.js';
	import { SettingsApp, SettingsTile } from '../../settings/browser/settings-api.js';
	import type { SettingsPreferencesApi } from '../../settings/browser/settings-preferences-api.js';
	import type { AuthApi } from '../../auth/browser/auth-api.js';

	const { contributions, log, signingOut, state, preferences, auth } = defineProps<{
		contributions: PluginContributionList;
		log: LogApi;
		signingOut: boolean;
		state?: Pick<StateClient, 'subscribe'>;
		preferences: SettingsPreferencesApi;
		auth: AuthApi;
	}>();
	const emit = defineEmits<{ logout: [] }>();
	const previewSpeed = defineModel<number>('previewSpeed');
	const settings = preferences.value;
	const { t } = useI18n({ useScope: 'global' });
	const desktop = new DesktopApi(log);
	const backup = new BackupApi();
	const builtins: readonly DesktopApplication[] = [
		{
			key: 'builtin:marketplace',

			label: () => t('market'),

			icon: Store,
			scrollMode: 'window',
			scrollbarGutter: 'stable',
			color: 'var(--ui-app-rose)',
			tileSize: { w: 2, h: 1 },
		},
		{
			key: 'builtin:settings',

			label: () => t('settings'),

			icon: Settings,
			color: 'var(--ui-app-blue)',
			tileSize: { w: 2, h: 1 },
		},
		{
			key: 'builtin:log',

			label: () => t('logViewer.title'),

			icon: ScrollText,
			color: 'var(--ui-app-amber)',
			tileSize: { w: 1, h: 1 },
		},
		{
			key: 'builtin:backup',

			label: () => t('backup.title'),

			icon: Archive,
			color: 'var(--ui-app-steel)',
			tileSize: { w: 2, h: 1 },
			size: { width: 920, height: 760 },
		},
	];
	const marketplaceBuiltins = computed(() =>
		builtins.map((application) => ({
			key: application.key,
			label: application.label(),
			icon: application.icon,
			visible: desktop.isTileVisible(application.key),
		})),
	);

	const marketplaceApplications = computed(() =>
		contributions.value.flatMap((entry) =>
			entry.kind === 'applications'
				? [
						{
							key: entry.key,
							pluginId: entry.context.self.id,
							label: toValue(entry.label),
							visible: desktop.isTileVisible(entry.key),
						},
					]
				: [],
		),
	);

	function showApplication(key: string, visible: boolean): void {
		const builtin = builtins.find((item) => item.key === key);
		if (builtin) {
			desktop.setTileVisible(key, builtin.label(), visible, builtin.tileSize);
			return;
		}
		const application = marketplaceApplications.value.find((item) => item.key === key);
		if (application) desktop.setTileVisible(key, application.label, visible);
	}

	const request = new AbortController();
	const marketplace = new MarketplaceDesktopApi(request.signal, log);
	const installed = shallowRef<readonly MarketplacePlugin[]>();
	const loading = ref(false);

	onScopeDispose(() => request.abort());
	watch(
		() => state,
		(client, _, onCleanup) => {
			if (client) onCleanup(marketplace.connect(client));
		},
		{ immediate: true },
	);
	watch(marketplace.operations, (operations, previous) => {
		if (
			operations.some(
				(next) =>
					(next.state === 'succeeded' || next.state === 'failed') &&
					!previous.some((old) => old.id === next.id && old.state === next.state),
			)
		)
			void refreshMarketplace();
	});
	onMounted(() => {
		void refreshMarketplace();
	});

	async function refreshMarketplace(): Promise<void> {
		if (loading.value || request.signal.aborted) return;
		loading.value = true;
		try {
			installed.value = await marketplace.readInstalled(request.signal);
		} catch {
			if (!request.signal.aborted)
				log.report({ source: 'marketplace', level: 'warn', code: 'MARKETPLACE_PLUGINS_READ_FAILED' });
		} finally {
			loading.value = false;
		}
	}
</script>

<template>
	<DesktopShell
		:desktop="desktop"
		:builtins="builtins"
		:contributions="contributions"
		:log="log"
		:escape-action="settings.escapeAction"
	>
		<template #tile="{ application, size, open }">
			<MarketplaceTile
				v-if="application.key === 'builtin:marketplace'"
				:size="size"
				:open="open"
				:count="installed?.length"
				:loading="loading"
			/>
			<SettingsTile
				v-else-if="application.key === 'builtin:settings'"
				:size="size"
				:open="open"
				:theme="settings.theme"
			/>
			<BackupTile v-else-if="application.key === 'builtin:backup'" :size="size" :open="open" />
		</template>

		<template #window="{ application, minimized, openApplication }">
			<LogApp v-if="application.key === 'builtin:log'" :history="log.history" />
			<SettingsApp
				v-else-if="application.key === 'builtin:settings'"
				v-model:preview-speed="previewSpeed"
				:preferences="preferences"
				:auth="auth"
				:log="log"
				:minimized="minimized"
				:signing-out="signingOut"
				@logout="emit('logout')"
			/>
			<BackupApp v-else-if="application.key === 'builtin:backup'" :api="backup" :log="log" :state="state" />
			<MarketplaceApp
				v-else-if="application.key === 'builtin:marketplace'"
				:installed="installed"
				:loading="loading"
				:api="marketplace"
				:applications="marketplaceApplications"
				:builtins="marketplaceBuiltins"
				@open-application="openApplication"
				@show-application="showApplication"
				:minimized="minimized"
				:log="log"
				@refresh="refreshMarketplace"
			/>
		</template>
	</DesktopShell>
</template>
