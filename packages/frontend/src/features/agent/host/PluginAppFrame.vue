<script setup lang="ts">
	import { nextTick, onActivated, onDeactivated, ref, watch } from 'vue';
	import { getPluginFrontendDescriptor } from '../api/plugin-runtime-api';
	import type { PluginFrontendDescriptor } from '../model/plugin-types';
	import { PluginFrontendHostBridge } from '../plugin-sdk/host-bridge';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { UiLoadingState } from '@/foundation/ui';

	const props = defineProps<{ appId: string; version: string; visible: boolean }>();
	const iframe = ref<HTMLIFrameElement | null>(null);
	const descriptor = ref<PluginFrontendDescriptor | null>(null);
	const status = ref<'loading' | 'connecting' | 'ready' | 'unavailable'>('loading');
	const active = ref(true);
	let generation = 0;
	let bridge: PluginFrontendHostBridge | null = null;
	let request: AbortController | null = null;
	const scope = useAuthenticatedViewScope({
		available: () => active.value && props.visible,

		onRevoke() {
			generation += 1;
			request?.abort();
			bridge?.close();
			bridge = null;
			descriptor.value = null;
			status.value = 'unavailable';
		},
	});

	async function load(): Promise<void> {
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		const pending = request;
		bridge?.close();
		bridge = null;
		descriptor.value = null;
		status.value = 'loading';
		try {
			const value = await getPluginFrontendDescriptor(props.appId, AbortSignal.any([signal, pending.signal]));
			if (!scope.isCurrent(signal) || current !== generation) {
				return;
			}
			if (value.version !== props.version) {
				throw new Error('Plugin version changed');
			}
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
			const owner = new PluginFrontendHostBridge(frame, value, () => {
				if (current === generation) {
					bridge = null;
					descriptor.value = null;
					status.value = 'unavailable';
				}
			});
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
		() => [props.appId, props.version, props.visible],
		() => {
			void load();
		},
		{ immediate: true },
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
		<iframe
			v-if="descriptor"
			ref="iframe"
			class="h-full w-full border-0 bg-background"
			sandbox="allow-scripts"
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
