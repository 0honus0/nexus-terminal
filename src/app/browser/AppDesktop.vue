<script setup lang="ts">
	import { version as hostVersion } from '../../../package.json';
	import type { WindowLauncher } from '../../window/browser/window-plugin-api.js';
	import { Archive, ScrollText, Settings, Store } from '@lucide/vue';
	import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
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
	import {
		resolveApplicationLabel,
		resolvePluginIcon,
		type PluginContributionList,
	} from '../../plugin/plugin-api.browser.js';
	import type { PluginRuntimeInfo } from '../../plugin/plugin-state-types.js';
	import { SettingsApp, SettingsTile } from '../../settings/browser/settings-api.js';
	import type { SettingsPreferencesApi } from '../../settings/browser/settings-preferences-api.js';
	import type { AuthApi } from '../../auth/browser/auth-api.js';

	const { contributions, log, signingOut, state, pluginRuntime, pluginsReady, preferences, auth, windowLauncher } =
		defineProps<{
			contributions: PluginContributionList;
			log: LogApi;
			signingOut: boolean;
			state?: Pick<StateClient, 'subscribe'>;
			pluginRuntime?: ReadonlyMap<string, PluginRuntimeInfo>;
			pluginsReady: boolean;
			preferences: SettingsPreferencesApi;
			auth: AuthApi;
			windowLauncher: Pick<WindowLauncher, 'attach'>;
		}>();
	const emit = defineEmits<{ ready: []; logout: [] }>();
	const previewSpeed = defineModel<number>('previewSpeed');
	const settings = preferences.value;
	const { t, locale } = useI18n({ useScope: 'global' });
	const desktop = new DesktopApi(log);
	const backup = new BackupApi();
	const builtins: readonly (DesktopApplication & { description: () => string })[] = [
		{
			key: 'builtin:marketplace',

			label: () => t('market'),

			description: () => t('marketDescription'),

			icon: Store,
			scrollMode: 'window',
			scrollbarGutter: 'stable',
			color: 'var(--ui-app-rose)',
			tileSize: { w: 2, h: 1 },
		},
		{
			key: 'builtin:settings',

			label: () => t('settings'),

			description: () => t('settingsDescription'),

			icon: Settings,
			color: 'var(--ui-app-blue)',
			tileSize: { w: 2, h: 1 },
		},
		{
			key: 'builtin:log',

			label: () => t('logViewer.title'),

			description: () => t('logViewer.description'),

			icon: ScrollText,
			color: 'var(--ui-app-amber)',
			tileSize: { w: 1, h: 1 },
		},
		{
			key: 'builtin:backup',

			label: () => t('backup.title'),

			description: () => t('backup.description'),

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
			version: hostVersion,
			visible: desktop.isTileVisible(application.key),
			description: application.description(),
		})),
	);

	const request = new AbortController();
	const marketplace = new MarketplaceDesktopApi(request.signal, log);
	const installed = shallowRef<readonly MarketplacePlugin[]>();
	const pluginIcons = computed(
		() =>
			new Map(
				installed.value?.flatMap(({ pluginId, icon }) => {
					const component = resolvePluginIcon(icon);
					return component ? [[pluginId, component] as const] : [];
				}),
			),
	);

	const marketplaceApplications = computed(() =>
		contributions.value.flatMap((entry) =>
			entry.kind === 'applications'
				? [
						{
							key: entry.key,
							id: entry.id,
							pluginId: entry.context.self.id,
							label: resolveApplicationLabel(entry.label, locale.value),
							icon: pluginIcons.value.get(entry.context.self.id) ?? entry.icon,
							visible: desktop.isTileVisible(entry.key),
							readiness: entry.context.self.readiness.value,
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

	const loading = ref(false);
	const initialReadSettled = ref(false);
	const initialReadDeadline = AbortSignal.timeout(5_000);
	const ready = computed(() => pluginsReady && initialReadSettled.value);
	let installedRead: AbortController | undefined;

	watch(
		ready,
		(value) => {
			if (value) emit('ready');
		},
		{ flush: 'post' },
	);
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
		if (request.signal.aborted) return;

		// 多个插件连续完成时，以最后一次读取为准。
		installedRead?.abort();
		const read = new AbortController();
		installedRead = read;
		const signal = AbortSignal.any([request.signal, read.signal]);
		loading.value = true;

		try {
			const readSignal = initialReadSettled.value ? signal : AbortSignal.any([signal, initialReadDeadline]);
			const items = await marketplace.readInstalled(readSignal);
			if (!readSignal.aborted) installed.value = items;
		} catch {
			if (!signal.aborted)
				log.report({ source: 'marketplace', level: 'warn', code: 'MARKETPLACE_PLUGINS_READ_FAILED' });
		} finally {
			if (installedRead === read) {
				installedRead = undefined;
				loading.value = false;
				if (!request.signal.aborted) initialReadSettled.value = true;
			}
		}
	}
</script>

<template>
	<DesktopShell
		v-if="ready"
		:desktop="desktop"
		:builtins="builtins"
		:contributions="contributions"
		:plugin-icons="pluginIcons"
		:log="log"
		:escape-action="settings.escapeAction"
		:window-launcher="windowLauncher"
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
				:plugin-runtime="pluginRuntime"
				:builtins="marketplaceBuiltins"
				:open-configuration-application="(key) => openApplication(key)?.view?.signal"
				@open-application="openApplication"
				@show-application="showApplication"
				:minimized="minimized"
				:log="log"
				@refresh="refreshMarketplace"
			/>
		</template>
	</DesktopShell>
</template>
