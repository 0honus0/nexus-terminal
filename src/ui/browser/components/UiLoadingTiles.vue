<script setup lang="ts">
	import { Folder, PanelsTopLeft, Puzzle, Terminal } from '@lucide/vue';
	import { useTemplateRef, watch } from 'vue';
	import type { UiLoadingTilesProps } from '../ui-component-types.js';
	import { useUiMotion } from '../ui-motion-api.js';

	const {
		icons = [PanelsTopLeft, Terminal, Folder, Puzzle],
		label,
		active = true,
	} = defineProps<UiLoadingTilesProps>();
	const tiles = useTemplateRef('tiles');
	const { play, enabled } = useUiMotion();
	const resting = { opacity: 0.65, transform: 'translateY(0)' };
	const lifted = { opacity: 1, transform: 'translateY(-5px)' };

	watch(
		[tiles, enabled, () => active, () => icons],
		([container, motion, showMotion], _, onCleanup) => {
			if (!container || !motion || !showMotion || !container.animate) return;
			const elements = [...container.querySelectorAll<HTMLElement>('.ui-loading-tiles__tile')];
			if (!elements.length) return;
			const frames = elements.map((_, index) =>
				Array.from({ length: elements.length * 2 + 1 }, (_, step) =>
					step === index * 2 + 1 ? lifted : resting,
				),
			);
			let stopped = false;
			let frame: number | undefined;
			let cancel: (() => void)[] = [];

			function animate() {
				if (stopped) return;
				cancel = elements.map((element, index) =>
					play(element, frames[index], 2600, index ? undefined : nextCycle),
				);
			}

			function nextCycle() {
				if (!stopped) frame = requestAnimationFrame(animate);
			}

			onCleanup(() => {
				stopped = true;
				if (frame !== undefined) cancelAnimationFrame(frame);
				for (const stop of cancel) stop();
			});
			animate();
		},
		{ flush: 'post' },
	);
</script>

<template>
	<div class="ui-loading">
		<div ref="tiles" class="ui-loading-tiles" aria-hidden="true">
			<span v-for="(icon, index) in icons" :key="index" class="ui-loading-tiles__tile">
				<component :is="icon" :stroke-width="1.5" />
			</span>
		</div>
		<slot name="caption">
			<p v-if="label" class="ui-loading__caption" role="status">{{ label }}</p>
		</slot>
	</div>
</template>

<style scoped>
	.ui-loading {
		display: grid;
		justify-items: center;
		gap: var(--ui-loading-caption-gap, 16px);
		color: var(--ui-muted);
		text-align: center;
	}
	.ui-loading__caption {
		margin: 0;
		font-size: var(--ui-loading-caption-size, 14px);
		line-height: 1.5;
	}
	.ui-loading-tiles {
		display: grid;
		grid-template-columns: repeat(2, var(--ui-loading-tile-size, 56px));
		gap: var(--ui-loading-tile-gap, 12px);
	}
	.ui-loading-tiles__tile {
		--tile-accent: var(--ui-primary);
		display: grid;
		place-items: center;
		height: var(--ui-loading-tile-size, 56px);
		border: 1px solid color-mix(in srgb, var(--tile-accent) 16%, var(--ui-border));
		border-radius: var(--ui-loading-tile-radius, 17px);
		background: color-mix(in srgb, var(--tile-accent) 8%, var(--ui-surface));
		color: var(--tile-accent);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--ui-text) 4%, transparent);
	}
	.ui-loading-tiles__tile:nth-child(2) {
		--tile-accent: var(--ui-app-blue);
	}
	.ui-loading-tiles__tile:nth-child(3) {
		--tile-accent: var(--ui-app-steel);
	}
	.ui-loading-tiles__tile > svg {
		width: var(--ui-loading-icon-size, 25px);
		height: var(--ui-loading-icon-size, 25px);
	}
</style>
