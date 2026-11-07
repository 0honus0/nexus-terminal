<script setup lang="ts">
	import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInlineNotice, UiLoadingState } from '@/foundation/ui';
	import { logger } from '@/client/logging/logger';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { getPluginSettingsDescriptor } from './plugin-runtime-api';
	import { PluginFrontendHostBridge } from './host-bridge';
	import { PluginSettingsUiBridge } from './settings-ui-bridge';
	import type { PluginFrontendDescriptor } from './plugin-runtime-types';

	const emit = defineEmits<{ saved: [] }>();
	const props = defineProps<{ appId: string; instanceId: string; packageRevision: number }>();
	const { t, locale } = useI18n();
	const frame = ref<HTMLIFrameElement | null>(null);
	const descriptor = ref<PluginFrontendDescriptor | null>(null);
	const status = ref<'loading' | 'ready' | 'failed'>('loading');
	let generation = 0;
	let request: AbortController | null = null;
	let bridge: PluginFrontendHostBridge | null = null;
	let ui: PluginSettingsUiBridge | null = null;
	const scope = useAuthenticatedViewScope({
		onRevoke() {
			generation++;
			request?.abort();
			void bridge?.close();
			bridge = null;
			ui = null;
			descriptor.value = null;
		},
	});

	async function load(): Promise<void> {
		const current = ++generation;
		request?.abort();
		const controller = new AbortController();
		request = controller;
		const identity = scope.capture();
		const signal = AbortSignal.any([controller.signal, identity]);
		const original = bridge;
		bridge = null;
		ui = null;
		descriptor.value = null;
		status.value = 'loading';
		try {
			await original?.close();
			if (signal.aborted || current !== generation) {
				return;
			}
			const value = await getPluginSettingsDescriptor(props.appId, props.instanceId, signal);
			if (signal.aborted || current !== generation) {
				return;
			}
			if (value.uiRevision !== props.packageRevision) {
				throw new Error('Settings package changed');
			}
			descriptor.value = value;
			await nextTick();
			if (signal.aborted || current !== generation) {
				return;
			}
			const element = frame.value;
			if (!element) {
				throw new Error('Settings frame missing');
			}
			const presentation = new PluginSettingsUiBridge(() => {
				const style = getComputedStyle(document.documentElement);
				return {
					appId: props.appId,
					appVersion: props.packageRevision,
					checkpoint: null,
					active: true,
					minimized: false,
					compact: element.clientWidth < 640,
					executionEnabled: false,
					resumeRevision: 0,
					locale: locale.value,
					dark: document.documentElement.classList.contains('dark'),
					themeVariables: Array.from(style)
						.filter((name) => name.startsWith('--'))
						.map((name) => ({ name, value: style.getPropertyValue(name) })),
					imagePreviewMaxMiB: 0,
					targets: [],
					preferredTargetIds: [],
				};
			});
			const owner = new PluginFrontendHostBridge(
				element,
				value,
				() => {
					if (current !== generation) {
						return;
					}
					bridge = null;
					ui = null;
					descriptor.value = null;
					status.value = 'failed';
				},
				presentation,
				() => {
					if (current === generation && scope.isCurrent(identity)) {
						emit('saved');
					}
				},
			);
			bridge = owner;
			ui = presentation;
			await Promise.all([
				owner.start(),
				Promise.resolve().then(() => {
					element.src = value.url;
				}),
			]);
			if (!signal.aborted && current === generation && bridge === owner) {
				status.value = 'ready';
			}
		} catch (error) {
			if (signal.aborted || current !== generation) {
				return;
			}
			void bridge?.close();
			bridge = null;
			ui = null;
			descriptor.value = null;
			status.value = 'failed';
			logger.error({ err: error }, 'Plugin settings Surface failed');
		}
	}

	const theme = new MutationObserver(() => ui?.updateEnvironment());
	theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
	const size = new ResizeObserver(() => ui?.updateEnvironment());
	watch(frame, (value, original) => {
		if (original) {
			size.unobserve(original);
		}
		if (value) {
			size.observe(value);
		}
	});
	watch(locale, () => ui?.updateEnvironment());
	watch(
		() => [props.appId, props.instanceId, props.packageRevision],
		() => {
			void load();
		},
		{ immediate: true },
	);
	onBeforeUnmount(() => {
		generation++;
		request?.abort();
		void bridge?.close();
		theme.disconnect();
		size.disconnect();
	});
</script>

<template>
	<div class="relative min-h-64 w-full">
		<iframe
			v-if="descriptor"
			ref="frame"
			class="h-[min(440px,55dvh)] w-full border-0 bg-background"
			:sandbox="descriptor.sandbox"
			referrerpolicy="no-referrer"
			:title="t('agent.settings.plugins.settings.title')"
		/>
		<UiLoadingState
			v-if="status === 'loading'"
			class="absolute inset-0 bg-background"
			compact
			:bordered="false"
			:title="t('agent.settings.plugins.settings.loading')"
		/>
		<UiInlineNotice v-else-if="status === 'failed'" tone="warning" compact>
			{{ t('agent.settings.plugins.settings.failed') }}
			<template #actions
				><UiButton @click="load">{{ t('agent.settings.plugins.settings.reload') }}</UiButton></template
			>
		</UiInlineNotice>
	</div>
</template>
