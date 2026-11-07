<script setup lang="ts">
	import { onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useFeedback } from '@/shared/feedback/public';
	import { isNetworkFailure } from '@/client/http/network-failure';
	import { useAuthSession } from '@/features/auth/public';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import { listManagedApps } from '../api/app-management-api';
	import {
		listPluginInstallations,
		listPluginVersions,
		listPluginAppBindings,
	} from '../plugins/api/plugin-management-api';
	import { getExecutionSettings } from '../api/execution-api';
	import { toHostDirectory } from '../model/host-mapper';
	import type { HostDirectory } from '../model/host-types';
	import { AgentManagementFailure } from '../model/management-failure';
	import { clearNativeTargetPreference } from '../model/native-target-preferences';
	import AgentHubWindow from './AgentHubWindow.vue';
	import AgentLauncher from './AgentLauncher.vue';
	import { agentHostEvents } from '../events/agent-host-events';
	import { provideAgentHostState } from './agent-host-state';
	import { useAgentTaskNotices } from './use-agent-task-notices';

	const auth = useAuthSession();
	const { t } = useI18n();
	const feedback = useFeedback();
	const host = provideAgentHostState();
	const { windowManager } = host;
	const directory = ref<HostDirectory | null>(null);
	const taskNotices = useAgentTaskNotices(host, () => directory.value);
	let userId: number | null = null;
	const operation = useAgentManagementOperation(
		(reason) => {
			persistLayout();
			if (reason === 'view') return;
			directory.value = null;
			windowManager.reset();
			host.clearUiState();
		},
		() => auth.isAuthenticated.value && (auth.user.value?.id ?? null) === 1,
	);

	function persistLayout(): void {
		if (userId !== null) windowManager.persistForUser(userId);
	}

	async function refresh(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [apps, installations, versions, execution, bindings] = await Promise.all([
					listManagedApps(signal),
					listPluginInstallations(signal),
					listPluginVersions(signal),
					getExecutionSettings(signal),
					listPluginAppBindings(signal),
				]);
				return toHostDirectory(apps, installations.installations, versions, execution.enabled, bindings);
			},
			(next) => {
				directory.value = next;
				if (!next.executionEnabled) {
					windowManager.closeHub();
					return;
				}
				const enabled = next.apps.filter((app) => app.enabled);
				if (!enabled.some((app) => app.id === windowManager.state.activeAppId)) {
					const first = enabled[0];
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
						host.clearUiState();
						return;
					}
					if (!isNetworkFailure(cause)) feedback.notifyError(t('agent.hub.directoryErrorHint'), 0);
				},
			},
		);
	}

	watch(
		() => [auth.isAuthenticated.value, auth.user.value?.id ?? null] as const,
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
	const stopDataCleared = agentHostEvents.on('app-data-cleared', ({ appId }) => {
		host.clearAppUiState(appId);
		if (userId !== null) clearNativeTargetPreference(userId, appId);
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
		stopDataCleared();
		document.removeEventListener('visibilitychange', onVisibility);
	});
</script>

<template>
	<Teleport to="body">
		<template
			v-if="auth.isAuthenticated.value && (auth.user.value?.id ?? null) === 1 && directory?.executionEnabled"
		>
			<AgentHubWindow v-if="directory" :directory="directory" @layout-change="persistLayout" />
			<AgentLauncher
				v-if="windowManager.state.status !== 'visible' || !directory"
				:notice="taskNotices.notice.value"
				:queued-count="taskNotices.queuedCount.value"
				:pending-approval-count="taskNotices.pendingApprovalCount.value"
				:notice-time="taskNotices.now.value"
				@notice-dismiss="taskNotices.dismiss"
				@notice-hover="taskNotices.hovered.value = $event"
				@notice-focus="taskNotices.focused.value = $event"
				@layout-change="persistLayout"
			/>
		</template>
	</Teleport>
</template>
