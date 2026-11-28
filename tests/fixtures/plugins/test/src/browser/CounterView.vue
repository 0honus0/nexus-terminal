<script setup lang="ts">
	import {
		PluginHttpError,
		type PluginComponentProps,
		type PluginWindowApi,
		type WindowTab,
	} from 'nexus-terminal/browser';
	import { UiButton } from 'nexus-terminal/browser/ui';
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { z } from 'zod';
	import { counterMessages } from './counter-messages.js';

	const props = defineProps<PluginComponentProps>();
	const { t } = useI18n({ useScope: 'local', messages: counterMessages });
	const count = ref(0);

	const hostControls = new URLSearchParams(location.search).has('host-controls') && 'registerTabs' in props.view;
	const active = ref('one');
	const tabs = ref<WindowTab[]>([
		{ id: 'one', label: 'One' },
		{ id: 'two', label: 'Two', closable: true, status: { tone: 'info', label: 'Marked for suspend' } },
	]);
	const result = ref('');
	const itemCount = ref<number>();
	const conflict = ref('');

	if (hostControls) {
		const view = props.view as PluginWindowApi;
		props.context.app.state.subscribe(
			'items',
			z.object({ count: z.number() }),
			{
				updated({ count }) {
					itemCount.value = count;
				},
			},
			view.signal,
		);
		view.registerTabs({
			items: tabs,
			activeId: active,

			onSelect(id) {
				active.value = id;
			},

			onClose(id) {
				tabs.value = tabs.value.filter((item) => item.id !== id);
				active.value = 'one';
			},
		});
		view.registerActions({
			items: [
				{ id: 'probe', label: 'Probe host' },
				{ id: 'sort', label: 'Fixture sort', items: [{ id: 'name', label: 'By name' }] },
				{
					id: 'layout',
					label: 'Fixture layout',
					menuTransition: 'none',
					items: [{ id: 'edit', label: 'Edit layout' }],
				},
				{
					id: 'fade-layout',
					label: 'Fixture fade layout',
					menuTransition: 'fade',
					items: [{ id: 'edit', label: 'Edit layout' }],
				},
			],

			async onSelect(id) {
				if (id !== 'probe') return;
				const { http, tasks, ws } = props.context.app;
				await tasks.run(
					async (signal) => {
						const response = await http.request('/items', { signal });
						const text = await response.text();
						signal.throwIfAborted();
						result.value = text;
						try {
							await http.json('/conflict', z.strictObject({}), { signal });
						} catch (cause) {
							if (cause instanceof PluginHttpError) conflict.value = cause.code;
						}
					},
					{ view },
				);
				tasks.background('probe', () => {
					window.dispatchEvent(new Event('nexus:test:background'));
				});

				const socket = ws.connect('/echo', {
					signal: view.signal,

					onConnected() {
						socket.send('fixture-frame');
						socket.send(Uint8Array.of(0, 255).buffer);
					},

					onMessage(_socket, message) {
						const value =
							message.data instanceof ArrayBuffer
								? [...new Uint8Array(message.data)].join(',')
								: message.data;
						result.value += ' · ' + value;
					},
				});
			},
		});
	}
	props.view.onDispose(() => {
		window.dispatchEvent(new CustomEvent('nexus:test:lifecycle', { detail: 'view-disposed' }));
	});

	function increment(): void {
		props.view.signal.throwIfAborted();
		count.value++;
		props.context.app.log.report({
			level: 'info',
			code: 'TEST_COUNTER_INCREMENTED',
			params: { count: count.value },
			userVisible: new URLSearchParams(location.search).has('plugin-notices'),
		});
	}
</script>

<template>
	<p>{{ t('count', { count }) }}</p>
	<template v-if="hostControls">
		<p>{{ result }}</p>
		<p>{{ itemCount }}</p>
		<p>{{ conflict }}</p>
	</template>
	<UiButton @click="increment">{{ t('increment') }}</UiButton>
</template>
