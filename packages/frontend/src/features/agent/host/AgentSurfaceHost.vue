<script setup lang="ts">
	import { onBeforeUnmount, ref, watch } from 'vue';
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
					}
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
			<div
				v-if="operation.notice.value"
				class="fixed bottom-20 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-warning/40 bg-card p-3 text-sm shadow-lg"
				role="alert"
			>
				<i class="fa-solid fa-triangle-exclamation mt-0.5 text-warning" aria-hidden="true"></i>
				<div class="min-w-0 flex-1">
					<p class="font-medium text-foreground">{{ $t('agent.hub.directoryError') }}</p>
					<p class="mt-1 text-xs leading-5 text-text-secondary">{{ $t('agent.hub.directoryErrorHint') }}</p>
				</div>
				<button
					type="button"
					class="shrink-0 rounded-lg border border-border/70 px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground disabled:opacity-50"
					:disabled="operation.busy.value"
					@click="refresh"
				>
					{{ $t('agent.hub.retryDirectory') }}
				</button>
			</div>
		</template>
	</Teleport>
</template>
