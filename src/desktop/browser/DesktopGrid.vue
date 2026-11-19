<script setup lang="ts">
	import { GridStack, type GridItemHTMLElement } from 'gridstack';
	import 'gridstack/dist/gridstack.min.css';
	import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useElementSize } from '@vueuse/core';
	import type { DesktopPage, DesktopTile } from './desktop-api.js';

	const { page, columns, rows, editing } = defineProps<{
		page: DesktopPage;
		columns: number;
		rows: number;
		editing: boolean;
	}>();
	const emit = defineEmits<{ layout: [tiles: DesktopTile[]] }>();
	const canvas = ref<HTMLElement>();
	const root = ref<HTMLElement>();
	const { height } = useElementSize(canvas);
	let grid: GridStack | undefined;

	const cellHeight = (available: number) => (available || 108) / Math.max(1, rows, Math.floor(available / 108));

	function sync(): void {
		if (!grid || !root.value) return;
		const tiles = new Map(page.tiles.map((tile) => [tile.key, tile]));
		grid.batchUpdate();
		try {
			for (const node of [...grid.engine.nodes])
				if (node.el && !tiles.has(node.id!)) grid.removeWidget(node.el, false);
			for (const element of root.value.querySelectorAll<GridItemHTMLElement>(':scope > .grid-stack-item')) {
				const tile = tiles.get(element.dataset.tile!);
				if (!tile) continue;
				const position = { id: tile.key, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
				if (element.gridstackNode) grid.update(element, position);
				else grid.makeWidget(element, position);
			}
		} finally {
			grid.batchUpdate(false);
		}
	}

	function commit(): void {
		if (!grid || !editing) return;
		const nodes = new Map(grid.engine.nodes.map((node) => [node.id, node]));
		emit(
			'layout',
			page.tiles.map((tile) => {
				const node = nodes.get(tile.key);
				return node ? { ...tile, x: node.x!, y: node.y!, w: node.w!, h: node.h! } : tile;
			}),
		);
	}

	function nudge(event: KeyboardEvent, tile: DesktopTile): void {
		const offsets = new Map([
			['ArrowLeft', [-1, 0]],
			['ArrowRight', [1, 0]],
			['ArrowUp', [0, -1]],
			['ArrowDown', [0, 1]],
		]);
		const direction = offsets.get(event.key);
		const element = grid?.engine.nodes.find((node) => node.id === tile.key)?.el;
		if (!editing || !direction || !element) return;
		event.preventDefault();
		grid?.update(
			element,
			event.shiftKey
				? { w: Math.max(1, tile.w + direction[0]!), h: Math.max(1, tile.h + direction[1]!) }
				: { x: Math.max(0, tile.x + direction[0]!), y: Math.max(0, tile.y + direction[1]!) },
		);
		commit();
	}

	function resize(key: string, width: number, height: number): void {
		const element = grid?.engine.nodes.find((node) => node.id === key)?.el;
		if (!editing || !grid || !element) return;
		grid.update(element, { w: width, h: height });
		commit();
	}

	defineExpose({ resize });

	onMounted(() => {
		if (!root.value) return;
		grid =
			GridStack.init(
				{
					column: columns,
					auto: false,
					mode: 'float',
					animate: false,
					staticGrid: !editing,
					cellHeight: cellHeight(height.value),
					margin: 9,
					minRow: rows,
					maxRow: rows,
					draggable: { handle: '.desktop-tile__move' },
					resizable: { handles: 'se' },
				},
				root.value,
			) ?? undefined;
		grid?.on('dragstop resizestop', commit);
		sync();
	});

	watch(() => page.tiles, sync, { flush: 'post' });
	watch(
		() => editing,
		(value) => grid?.setStatic(!value),
	);
	watch(height, (value) => grid?.cellHeight(cellHeight(value)));
	onBeforeUnmount(() => {
		grid?.destroy(false);
		grid = undefined;
	});
</script>

<template>
	<div ref="canvas" class="desktop-canvas">
		<div ref="root" class="grid-stack desktop-grid">
			<div v-for="tile in page.tiles" :key="tile.key" class="grid-stack-item" :data-tile="tile.key">
				<div class="grid-stack-item-content" @keydown.self="nudge($event, tile)">
					<slot :tile="tile" :nudge="(event: KeyboardEvent) => nudge(event, tile)" />
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
	.desktop-canvas {
		position: relative;
		touch-action: pan-y;
		flex: 1;
		min-height: 0;
		overflow: hidden auto;
	}
	.desktop-grid {
		isolation: isolate;
		margin: 0 -9px;
		min-height: 0;
	}
	.grid-stack-item-content {
		display: flex;
		min-width: 0;
		min-height: 0;
		border-radius: 21px;
		overflow: hidden;
	}
</style>
