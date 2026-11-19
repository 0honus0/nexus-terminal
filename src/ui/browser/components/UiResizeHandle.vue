<script setup lang="ts">
	import type { UiResizeHandleProps } from '../ui-component-types.js';
	defineOptions({ inheritAttrs: false });
	const props = defineProps<UiResizeHandleProps>();
	const emit = defineEmits<{ resize: [widthDelta: number, heightDelta: number] }>();

	function resizeWithKeyboard(event: KeyboardEvent) {
		const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
		if (!delta) return;
		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 48 : 16;
		emit('resize', delta[0] * step, delta[1] * step);
	}
</script>

<template>
	<button
		v-bind="$attrs"
		type="button"
		data-ui="resize-handle"
		data-ui-resize-edges="bottom right"
		class="ui-resize-handle"
		:class="{ 'has-edges': props.edges }"
		:aria-label="props.label"
		@keydown="resizeWithKeyboard"
	/>
	<span v-if="props.edges" class="ui-resize-edges" aria-hidden="true">
		<span
			v-for="edge in ['top', 'right', 'bottom', 'left', 'top left', 'top right', 'bottom left']"
			:key="edge"
			:data-ui-resize-edges="edge"
		/>
	</span>
</template>

<style scoped>
	.ui-resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		z-index: 2;
		width: var(--ui-resize-handle-size, 40px);
		height: var(--ui-resize-handle-size, 40px);
		padding: 0;
		border: 0;
		background: transparent;
		/* 仅占据右下三角，扩大命中范围而不覆盖整条滚动条或相邻按钮。 */
		clip-path: polygon(100% 0, 100% 100%, 0 100%);
		cursor: nwse-resize;
		touch-action: none;
	}
	.ui-resize-handle.has-edges {
		right: calc(-1 * var(--ui-resize-edge-size, 8px));
		bottom: calc(-1 * var(--ui-resize-edge-size, 8px));
		width: calc(var(--ui-resize-handle-size, 40px) + var(--ui-resize-edge-size, 8px));
		height: calc(var(--ui-resize-handle-size, 40px) + var(--ui-resize-edge-size, 8px));
	}
	.ui-resize-edges {
		--_edge-size: var(--ui-resize-edge-size, 8px);
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}
	.ui-resize-edges > span {
		position: absolute;
		pointer-events: auto;
		touch-action: none;
	}
	.ui-resize-edges > [data-ui-resize-edges='top'],
	.ui-resize-edges > [data-ui-resize-edges='bottom'] {
		left: 0;
		right: 0;
		height: var(--_edge-size);
		cursor: ns-resize;
	}
	.ui-resize-edges > [data-ui-resize-edges='left'],
	.ui-resize-edges > [data-ui-resize-edges='right'] {
		top: 0;
		bottom: 0;
		width: var(--_edge-size);
		cursor: ew-resize;
	}
	.ui-resize-edges > [data-ui-resize-edges~='top'] {
		bottom: 100%;
	}
	.ui-resize-edges > [data-ui-resize-edges~='bottom'] {
		top: 100%;
	}
	.ui-resize-edges > [data-ui-resize-edges~='left'] {
		right: 100%;
	}
	.ui-resize-edges > [data-ui-resize-edges~='right'] {
		left: 100%;
	}
	.ui-resize-edges > [data-ui-resize-edges='top left'],
	.ui-resize-edges > [data-ui-resize-edges='top right'],
	.ui-resize-edges > [data-ui-resize-edges='bottom left'] {
		width: var(--_edge-size);
		height: var(--_edge-size);
		cursor: nesw-resize;
	}
	.ui-resize-edges > [data-ui-resize-edges='top left'] {
		cursor: nwse-resize;
	}
	.ui-resize-handle:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: -2px;
	}
</style>
