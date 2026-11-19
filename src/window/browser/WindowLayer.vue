<script setup lang="ts">
	import { useElementSize, useEventListener } from '@vueuse/core';
	import { ref, watch } from 'vue';
	import type { LogApi } from '../../log/browser/log-api.js';
	import type { WindowApi } from './window-api.js';
	import WindowFrame from './WindowFrame.vue';

	const { windows, log, escapeAction } = defineProps<{
		windows: WindowApi;
		log: Pick<LogApi, 'report'>;
		escapeAction: 'minimize' | 'close';
	}>();
	const layer = ref<HTMLElement>();
	const { width, height } = useElementSize(layer);
	watch([width, height], ([w, h]) => windows.resize(w, h), { immediate: true });
	useEventListener('keydown', (event) => {
		const active = windows.active.value;
		if (!active || event.defaultPrevented || event.key !== 'Escape') return;
		// 内层菜单及弹窗先处理它们自己的关闭。
		if (
			document.querySelector(
				'[role=dialog][data-state=open], [role=menu][data-state=open], [data-ui=select-content]',
			)
		)
			return;
		if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-window-id]')) return;
		event.preventDefault();
		if (escapeAction === 'minimize') active.minimized = true;
		else windows.requestClose(active);
	});
</script>

<template>
	<div ref="layer" class="window-layer">
		<WindowFrame v-for="item in windows.items.value" :key="item.id" :item="item" :windows="windows" :log="log">
			<slot :application="item.application" :minimized="item.minimized" />
		</WindowFrame>
	</div>
</template>

<style scoped>
	.window-layer {
		position: fixed;
		inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
		z-index: 20;
		pointer-events: none;
	}
	@media (max-width: 699px) {
		.window-layer {
			inset: 0;
		}
	}
</style>
