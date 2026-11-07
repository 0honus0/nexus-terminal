<script setup lang="ts">
	import { logger } from '@/client/logging/logger';
	import { nextTick, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { useAuthSession } from '@/features/auth/public';
	import { useConnections } from '@/features/connections/public';
	import { usePreferences } from '@/features/preferences/public';
	import { useFeedback } from '@/shared/feedback/public';
	import { getAgentDenylist } from '../../api/app-management-api';
	import { useAgentResourceControl } from '../../composables/use-agent-resource-control';
	import { readNativeTargetPreference, writeNativeTargetPreference } from '../../model/native-target-preferences';
	import { PluginUiHostBridge } from './ui-host-bridge';
	import HostArtifactPicker from './HostArtifactPicker.vue';
	import { AgentManagementFailure } from '../../model/management-failure';
	import { useAgentHostState, uiCheckpointKey } from '../../host/agent-host-state';
	import { getPluginFrontendDescriptor } from './plugin-runtime-api';
	import type { PluginFrontendDescriptor } from './plugin-runtime-types';
	import { PluginFrontendHostBridge } from './host-bridge';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { UiLoadingState } from '@/foundation/ui';

	const props = defineProps<{
		appId: string;
		appNames?: Record<string, string>;
		appVersion: number;
		version: string;
		uiRevision: number;
		resumeRevision: number;
		executionEnabled: boolean;
		minimized: boolean;
		compact: boolean;
		visible: boolean;
	}>();
	const { t, te, locale } = useI18n();
	const auth = useAuthSession();
	const connections = useConnections();
	const preferences = usePreferences();
	const feedback = useFeedback();
	const host = useAgentHostState();
	const resources = useAgentResourceControl(() => props.visible);
	const deniedIds = ref<number[]>([]);
	const preferredTargets = ref<number[]>([]);
	const themeRevision = ref(0);
	let uiBridge: PluginUiHostBridge | null = null;
	const themeObserver = new MutationObserver(() => {
		themeRevision.value += 1;
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class', 'style', 'data-theme'],
	});
	onBeforeUnmount(() => themeObserver.disconnect());
	const iframe = ref<HTMLIFrameElement | null>(null);
	const artifactPicker = ref<InstanceType<typeof HostArtifactPicker> | null>(null);
	const descriptor = ref<PluginFrontendDescriptor | null>(null);
	const status = ref<'loading' | 'connecting' | 'ready' | 'unavailable'>('loading');
	const active = ref(true);
	let generation = 0;
	let bridge: PluginFrontendHostBridge | null = null;
	let request: AbortController | null = null;
	let targetRefresh: AbortController | null = null;
	const scope = useAuthenticatedViewScope({
		available: () => active.value && props.executionEnabled,

		onRevoke() {
			generation += 1;
			request?.abort();
			targetRefresh?.abort();
			bridge?.close();
			bridge = null;
			descriptor.value = null;
			status.value = 'unavailable';
		},
	});

	async function refreshTargets(): Promise<void> {
		const signal = scope.capture();
		if (!descriptor.value || !scope.isCurrent(signal)) return;
		const current = generation;
		targetRefresh?.abort();
		const controller = new AbortController();
		targetRefresh = controller;
		try {
			const [denylist] = await Promise.all([
				getAgentDenylist(AbortSignal.any([signal, controller.signal])),
				connections.revalidate(),
			]);
			if (
				!scope.isCurrent(signal) ||
				controller.signal.aborted ||
				current !== generation ||
				targetRefresh !== controller
			)
				return;
			deniedIds.value = denylist.entries.map((item) => item.connectionId);
			const userId = auth.user.value?.id;
			preferredTargets.value = userId === undefined ? [] : readNativeTargetPreference(userId, props.appId);
			uiBridge?.updateEnvironment();
		} catch (error) {
			if (scope.isCurrent(signal) && !controller.signal.aborted && current === generation)
				logger.error({ appId: props.appId, err: error }, 'Plugin target refresh failed');
		} finally {
			if (targetRefresh === controller) targetRefresh = null;
		}
	}

	async function load(): Promise<void> {
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		targetRefresh?.abort();
		request?.abort();
		request = new AbortController();
		const pending = request;
		bridge?.close();
		bridge = null;
		descriptor.value = null;
		status.value = 'loading';
		try {
			const requestSignal = AbortSignal.any([signal, pending.signal]);
			const [value, denylist] = await Promise.all([
				getPluginFrontendDescriptor(props.appId, requestSignal),
				getAgentDenylist(requestSignal),
				connections.revalidate(),
			]);
			if (!scope.isCurrent(signal) || current !== generation) {
				return;
			}
			if (value.version !== props.version || value.uiRevision !== props.uiRevision) {
				throw new Error('Plugin version changed');
			}
			deniedIds.value = denylist.entries.map((item) => item.connectionId);
			const userId = auth.user.value?.id;
			preferredTargets.value = userId === undefined ? [] : readNativeTargetPreference(userId, props.appId);
			descriptor.value = value;
			status.value = 'connecting';
			await nextTick();
			if (!scope.isCurrent(signal) || current !== generation) {
				return;
			}
			const frame = iframe.value;
			if (!frame) {
				throw new Error('Missing plugin frame');
			}
			uiBridge = new PluginUiHostBridge(value, {
				environment: () => {
					const style = getComputedStyle(document.documentElement);
					return {
						appId: props.appId,
						appVersion: props.appVersion,
						checkpoint:
							host.uiCheckpoints.get(
								uiCheckpointKey(value.appId, value.package.packageId, value.package.publisherKeyId),
							) ?? null,
						active: props.visible,
						minimized: props.minimized,
						compact: props.compact,
						executionEnabled: props.executionEnabled,
						resumeRevision: props.resumeRevision,
						locale: locale.value,
						dark: document.documentElement.classList.contains('dark'),
						themeVariables: Array.from(style)
							.filter((name) => name.startsWith('--'))
							.map((name) => ({ name, value: style.getPropertyValue(name) })),
						imagePreviewMaxMiB: preferences.values.value.imagePreviewMaxMiB,
						targets: connections.connections.value
							.filter((item) => item.type === 'SSH' && !deniedIds.value.includes(item.id))
							.map((item) => ({
								id: item.id,
								name: item.name,
								host: item.host,
								username: item.username,
							})),
						preferredTargetIds: [...preferredTargets.value],
					};
				},

				rememberTargets: (ids) => {
					if (!scope.isCurrent(signal) || userId === undefined || auth.user.value?.id !== userId) return;
					preferredTargets.value = ids;
					writeNativeTargetPreference(userId, props.appId, ids);
				},

				frame: () => iframe.value,

				pickArtifacts: (pickerRequest, pickerSignal) => {
					const picker = artifactPicker.value;
					if (!picker) throw new AgentManagementFailure('cancelled', 'not_dispatched');
					return picker.open(pickerRequest, pickerSignal);
				},

				host,
				feedback,
				resources,
				t,
				te,
			});
			const owner = new PluginFrontendHostBridge(
				frame,
				value,
				() => {
					if (current === generation) {
						bridge = null;
						descriptor.value = null;
						status.value = 'unavailable';
						if (value.expiresAt <= Date.now() && scope.isCurrent(signal)) void load();
					}
				},
				uiBridge,
			);
			bridge = owner;
			const connected = owner.start();
			try {
				frame.src = value.url;
			} catch {
				owner.close();
			}
			await connected;
			if (!scope.isCurrent(signal) || current !== generation || bridge !== owner) {
				return;
			}
			status.value = 'ready';
		} catch {
			if (!scope.isCurrent(signal) || current !== generation) {
				return;
			}
			bridge?.close();
			bridge = null;
			descriptor.value = null;
			status.value = 'unavailable';
		}
	}

	watch(
		() => props.resumeRevision,
		() => {
			void refreshTargets();
		},
	);
	watch(
		() => [props.appId, props.version, props.uiRevision, props.appVersion, props.executionEnabled],
		() => {
			void load();
		},
		{ immediate: true },
	);
	watch(
		() => [
			props.visible,
			props.minimized,
			props.compact,
			props.resumeRevision,
			props.executionEnabled,
			locale.value,
			preferences.values.value.imagePreviewMaxMiB,
			themeRevision.value,
			connections.connections.value,
		],
		() => uiBridge?.updateEnvironment(),
		{ flush: 'post' },
	);
	onDeactivated(() => {
		active.value = false;
	});
	onActivated(() => {
		active.value = true;
		if (!descriptor.value) {
			void load();
		}
	});
</script>
<template>
	<div class="relative h-full min-h-0 bg-background">
		<HostArtifactPicker
			ref="artifactPicker"
			:app-id="appId"
			:app-names="appNames"
			:active="visible && executionEnabled && status === 'ready'"
		/>
		<iframe
			v-if="descriptor"
			ref="iframe"
			:data-agent-app-id="appId"
			class="h-full w-full border-0 bg-background"
			:sandbox="descriptor.sandbox"
			referrerpolicy="no-referrer"
			:title="$t('agent.pluginFrontend.frameTitle')"
		/>
		<UiLoadingState
			v-if="status === 'loading' || status === 'connecting'"
			class="absolute inset-0 h-full w-full bg-background"
			compact
			:bordered="false"
			:title="$t(status === 'loading' ? 'agent.pluginFrontend.loading' : 'agent.pluginFrontend.connecting')"
		/>
		<div
			v-else-if="status !== 'ready'"
			class="absolute inset-0 flex items-center justify-center bg-background p-6 text-center text-sm text-text-secondary"
			role="status"
		>
			{{ $t('agent.pluginFrontend.unavailable') }}
		</div>
	</div>
</template>
