<script setup lang="ts">
	import { onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useFeedback } from '@/shared/feedback/public';
	import { isNetworkFailure } from '@/client/http/network-failure';
	import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { listAppDefinitions, listManagedApps } from '../api/app-management-api';
	import { listPluginInstallations, listPluginVersions } from '../api/plugin-management-api';
	import { getExecutionSettings } from '../api/execution-api';
	import { toHostDirectory } from '../model/host-mapper';
	import type { HostDirectory } from '../model/host-types';
	import { AgentManagementFailure } from '../model/management-failure';
	import AgentHubWindow from './AgentHubWindow.vue';
	import AgentLauncher from './AgentLauncher.vue';
	import { agentHostEvents } from '../events/agent-host-events';
	import { provideAgentHostState } from './agent-host-state';

	const auth = useRuntimeFeatureCapabilities().auth;
	const { t } = useI18n();
	const feedback = useFeedback();
	const { windowManager } = provideAgentHostState();
	const directory = ref<HostDirectory | null>(null);
	let userId: number | null = null;
	const operation = useAgentManagementOperation(
		(reason) => {
			persistLayout();
			if (reason === 'view') return;
			directory.value = null;
			windowManager.reset();
		},
		() => auth.authenticated.value && auth.userId.value === 1,
	);

	function persistLayout(): void {
		if (userId !== null) windowManager.persistForUser(userId);
	}

	async function refresh(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [apps, definitions, installations, versions, execution] = await Promise.all([
					listManagedApps(signal),
					listAppDefinitions(signal),
					listPluginInstallations(signal),
					listPluginVersions(signal),
					getExecutionSettings(signal),
				]);
				return toHostDirectory(apps, definitions, installations, versions, execution.enabled);
			},
			(next) => {
				directory.value = next;
				const enabled = next.apps.filter((app) => app.enabled);
				if (!enabled.some((app) => app.id === windowManager.state.activeAppId)) {
					const first = enabled.find((app) => app.surface === 'agent') ?? enabled[0];
					if (first) windowManager.switchApp({ appId: first.id });
					else windowManager.closeHub();
				}
			},
			{
				write: false,

				onFailure: (cause) => {
					if (
						cause instanceof AgentManagementFailure &&
						(cause.code === 'unauthenticated' || cause.code === 'forbidden')
					) {
						directory.value = null;
						windowManager.reset();
						return;
					}
					if (!isNetworkFailure(cause)) feedback.notifyError(t('agent.hub.directoryErrorHint'), 0);
				},
			},
		);
	}

	watch(
		() => [auth.authenticated.value, auth.userId.value] as const,
		([authenticated, next]) => {
			persistLayout();
			userId = authenticated && next === 1 ? next : null;
			if (userId !== null) {
				windowManager.restoreForUser(userId);
				void refresh();
			}
		},
		{ immediate: true, flush: 'post' },
	);
	watch(
		() => windowManager.state.status,
		(status) => {
			if (status === 'visible') void refresh();
		},
	);
	const stopHost = agentHostEvents.on('host-changed', () => {
		void refresh();
	});
	const stopConfiguration = agentHostEvents.on('configuration-changed', () => {
		void refresh();
	});

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') persistLayout();
		else if (userId !== null) void refresh();
	}

	document.addEventListener('visibilitychange', onVisibility);
	onBeforeUnmount(() => {
		persistLayout();
		stopHost();
		stopConfiguration();
		document.removeEventListener('visibilitychange', onVisibility);
	});
</script>

<template>
	<Teleport to="body">
		<template v-if="auth.authenticated.value && auth.userId.value === 1">
			<AgentHubWindow v-if="directory" :directory="directory" @layout-change="persistLayout" />
			<AgentLauncher
				v-if="windowManager.state.status !== 'visible' || !directory"
				@layout-change="persistLayout"
			/>
		</template>
	</Teleport>
</template>
