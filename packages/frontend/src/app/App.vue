<script setup lang="ts">
	import { computed, defineAsyncComponent, markRaw, onBeforeUnmount, ref, watch } from 'vue';
	import { RouterView, useRoute } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { preloadAuthenticatedRoutes } from './router';
	import { logger } from '@/client/logging/logger';
	import AppHeader from './shell/AppHeader.vue';
	import AppUpdatePrompt from './shell/AppUpdatePrompt.vue';
	import { useAuthSession } from '@/features/auth/public';
	import { BackupRecoveryOverlay, useBackupStore } from '@/features/backup/public';
	import { loadAppearanceCustomizerModal, useAppearance } from '@/features/appearance/public';
	import { AgentSurfaceHost } from '@/features/agent/public';
	import { refreshConnection, useConnections } from '@/features/connections/public';
	import { ConnectionTagPicker, useConnectionTags } from '@/features/tags/public';
	import { useProxies } from '@/features/proxies/public';
	import { SshKeySelector, useSshKeys } from '@/features/ssh-keys/public';
	import { loadTerminalView } from '@/features/terminal/public';
	import { loadRemoteDesktopModal, remoteDesktopLauncher } from '@/features/remote-desktop/public';
	import { usePreferences } from '@/features/preferences/public';
	import { startSuspendedSessionsSync } from '@/features/ssh-suspend/public';
	import {
		DialogHost,
		NotificationHost,
		RuntimeErrorBoundary,
		useSettingsReloadNotifications,
		useOperationFeedback,
		preferenceFailureMessage,
	} from '@/shared/feedback/public';
	import { authenticatedSessionLifecycle, type AuthenticatedSessionDispatch } from '@/shared/session/public';
	import { provideRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
	import { getLocale, setLocale } from './i18n';

	const RemoteDesktopModal = defineAsyncComponent(loadRemoteDesktopModal);
	const AppearanceCustomizerModal = defineAsyncComponent(loadAppearanceCustomizerModal);
	const auth = useAuthSession();
	let stopSuspendedSync: (() => void) | undefined;
	const route = useRoute();
	const { t } = useI18n();
	const desktopFeedback = useOperationFeedback('remote-desktop.size');
	useSettingsReloadNotifications();
	const desktopSizeSaving = ref(false);
	const backup = useBackupStore();
	const connections = useConnections();
	const tags = useConnectionTags();
	const proxies = useProxies();
	const sshKeys = useSshKeys();
	provideRuntimeFeatureCapabilities({
		auth: {
			userId: computed(() => auth.user.value?.id ?? null),
			authenticated: auth.isAuthenticated,
		},
		connections: {
			items: connections.connections,
			loaded: connections.loaded,
			load: connections.load,
			revalidate: connections.revalidate,
		},
		tags: {
			items: tags.tags,
			load: tags.load,
			revalidate: tags.revalidate,

			ensure: tags.ensure,

			picker: markRaw(ConnectionTagPicker),
		},
		proxies: { items: proxies.proxies, load: proxies.load },
		sshKeys: { items: sshKeys.keys, load: sshKeys.load, selector: markRaw(SshKeySelector) },
		remoteDesktop: { open: remoteDesktopLauncher.open },
		terminal: { loadView: loadTerminalView },
	});
	const appearance = useAppearance();
	const appearanceCustomizerVisible = appearance.customizerVisible;
	const preferences = usePreferences();
	watch(
		[preferences.loaded, () => preferences.values.value.language],
		([loaded, language]) => {
			if (loaded) {
				setLocale(language);
			}
		},
		{ immediate: true },
	);
	const authenticatedPageCacheGeneration = ref(0);
	// Authentication changes before the destination route finishes loading. Bind the
	// authenticated chrome to the committed route so public pages never render under it.
	const authenticatedShellVisible = computed(() => auth.isAuthenticated.value && route.meta.public !== true);
	const remoteDesktopConnection = remoteDesktopLauncher.connection;
	const remoteDesktopVisible = remoteDesktopLauncher.visible;
	const remoteDesktopWidth = computed(() =>
		remoteDesktopConnection.value?.type === 'VNC'
			? preferences.values.value.vncModalWidth
			: preferences.values.value.rdpModalWidth,
	);
	const remoteDesktopHeight = computed(() =>
		remoteDesktopConnection.value?.type === 'VNC'
			? preferences.values.value.vncModalHeight
			: preferences.values.value.rdpModalHeight,
	);

	const updateRemoteDesktopConnection = (connectionId: number) => {
		void refreshConnection(connectionId).catch((cause) =>
			logger.debug({ err: cause, connectionId }, 'Desktop connection metadata refresh failed'),
		);
	};

	const saveRemoteDesktopSize = async (size: { width: number; height: number }): Promise<void> => {
		const type = remoteDesktopConnection.value?.type;
		if (!type || desktopSizeSaving.value) {
			return;
		}
		const user = auth.user.value;
		desktopSizeSaving.value = true;
		try {
			await preferences.update(
				type === 'VNC'
					? { vncModalWidth: size.width, vncModalHeight: size.height }
					: { rdpModalWidth: size.width, rdpModalHeight: size.height },
			);
		} catch (cause) {
			if (auth.user.value === user) {
				desktopFeedback.notifyError({
					operation: 'save-size',
					message: preferenceFailureMessage(cause, t),
					cause,
				});
			}
		} finally {
			desktopSizeSaving.value = false;
		}
	};

	const reportSessionCleanupFailures = (result: AuthenticatedSessionDispatch | null): void => {
		if (!result) {
			return;
		}
		for (const failure of result.failures) {
			logger.error(
				{ err: failure.cause, ownerId: failure.ownerId, sessionEvent: result.event.type },
				'Authenticated session owner cleanup failed',
			);
		}
	};

	const disposeAuthenticatedShell = (): void => {
		authenticatedPageCacheGeneration.value += 1;
		remoteDesktopLauncher.close();
	};

	watch(
		[auth.isAuthenticated, () => auth.user.value?.id ?? null],
		([authenticated, userId]) => {
			if (authenticated && userId !== null) {
				const result = authenticatedSessionLifecycle.attach(userId);
				reportSessionCleanupFailures(result);
				if (result?.event.type === 'user-changed') {
					stopSuspendedSync?.();
					stopSuspendedSync = undefined;
					disposeAuthenticatedShell();
				}
				stopSuspendedSync ??= startSuspendedSessionsSync();
				preloadAuthenticatedRoutes();
				void appearance
					.load()
					.catch((cause) => logger.error({ err: cause }, 'Failed to load appearance settings'));
				void preferences
					.load(false, getLocale())
					.catch((cause) => logger.error({ err: cause }, 'Failed to load application preferences'));
				return;
			}
			stopSuspendedSync?.();
			stopSuspendedSync = undefined;
			const result = authenticatedSessionLifecycle.logout();
			reportSessionCleanupFailures(result);
			if (result) {
				disposeAuthenticatedShell();
			}
		},
		{ immediate: true, flush: 'sync' },
	);

	onBeforeUnmount(() => {
		stopSuspendedSync?.();
		reportSessionCleanupFailures(authenticatedSessionLifecycle.dispose());
		remoteDesktopLauncher.close();
	});
</script>

<template>
	<div class="flex min-h-dvh flex-col text-foreground" :inert="backup.blocked">
		<BackupRecoveryOverlay />
		<AppHeader v-if="authenticatedShellVisible" @customize-appearance="appearance.openCustomizer()" />
		<div class="min-h-0 flex-1">
			<RouterView v-slot="{ Component, route }">
				<RuntimeErrorBoundary scope="route" :reset-key="route.fullPath">
					<KeepAlive :key="authenticatedPageCacheGeneration">
						<component v-if="route.meta.keepAlive" :is="Component" :key="String(route.name)" />
					</KeepAlive>
					<component v-if="!route.meta.keepAlive" :is="Component" />
				</RuntimeErrorBoundary>
			</RouterView>
		</div>
		<RuntimeErrorBoundary v-if="authenticatedShellVisible" scope="agent" :reset-key="auth.user.value?.id ?? null">
			<AgentSurfaceHost />
		</RuntimeErrorBoundary>
		<RemoteDesktopModal
			v-if="remoteDesktopVisible"
			:visible="true"
			:connection="remoteDesktopConnection"
			:width="remoteDesktopWidth"
			:height="remoteDesktopHeight"
			:size-saving="desktopSizeSaving"
			@size-change="saveRemoteDesktopSize"
			@connected="updateRemoteDesktopConnection"
			@close="remoteDesktopLauncher.close()"
		/>
		<AppearanceCustomizerModal
			v-if="appearanceCustomizerVisible"
			:visible="true"
			@close="appearance.closeCustomizer()"
		/>
		<NotificationHost />
		<DialogHost />
		<AppUpdatePrompt />
	</div>
</template>
