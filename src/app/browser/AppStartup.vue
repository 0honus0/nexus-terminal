<script setup lang="ts">
	import { Folder, LoaderCircle, PanelsTopLeft, Puzzle, Terminal } from '@lucide/vue';
	import { useTemplateRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '../../ui/browser/ui-base-api.js';
	import { useUiMotion } from '../../ui/browser/ui-motion-api.js';

	const { failed, motionEnabled } = defineProps<{ failed: boolean; motionEnabled: boolean }>();
	defineEmits<{ retry: [] }>();
	const { t } = useI18n({ useScope: 'global' });
	const icons = [PanelsTopLeft, Terminal, Folder, Puzzle];
	const tiles = useTemplateRef('tiles');
	const { play } = useUiMotion();
	const resting = { opacity: 0.65, transform: 'translateY(0)' };
	const lifted = { opacity: 1, transform: 'translateY(-5px)' };

	watch([tiles, () => motionEnabled, () => failed], ([container, enabled, error], _, onCleanup) => {
		if (!container || !enabled || error || !container.animate) return;

		const elements = [...container.querySelectorAll<HTMLElement>('.app-startup__tile')];
		if (!elements.length) return;

		const frames = elements.map((_, index) =>
			Array.from({ length: 9 }, (_, step) => (step === index * 2 + 1 ? lifted : resting)),
		);
		let stopped = false;
		let frame: number | undefined;
		let cancel: (() => void)[] = [];

		function animate(): void {
			if (stopped) return;
			cancel = elements.map((element, index) =>
				play(element, frames[index], 2600, index ? undefined : nextCycle),
			);
		}

		function nextCycle(): void {
			if (!stopped) frame = requestAnimationFrame(animate);
		}

		// 离开启动页或关掉动画时，结束本轮并撤销已排队的下一轮。
		onCleanup(() => {
			stopped = true;
			if (frame !== undefined) cancelAnimationFrame(frame);
			for (const stop of cancel) stop();
		});
		animate();
	});
</script>

<template>
	<div class="app-startup">
		<div class="app-startup__content">
			<div ref="tiles" class="app-startup__tiles" aria-hidden="true">
				<span v-for="(icon, index) in icons" :key="index" class="app-startup__tile">
					<component :is="icon" :size="25" :stroke-width="1.5" />
				</span>
			</div>
			<div class="app-startup__caption">
				<span class="app-startup__brand" aria-hidden="true">NEXUS TERMINAL</span>
				<template v-if="failed">
					<p role="alert">{{ t('notices.APP_DESKTOP_LOAD_FAILED') }}</p>
					<UiButton tone="primary" @click="$emit('retry')">{{ t('startup.reload') }}</UiButton>
				</template>
				<p v-else role="status" :aria-label="t('startup.loading')">
					<LoaderCircle v-if="!motionEnabled" :size="16" aria-hidden="true" />
					{{ t('startup.loading') }}
				</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
	.app-startup {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: grid;
		place-items: center;
		padding: 24px;
		background:
			radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--ui-primary) 9%, transparent), transparent 58%),
			var(--ui-background);
		color: var(--ui-muted);
	}
	.app-startup__content {
		display: grid;
		justify-items: center;
		gap: 34px;
		text-align: center;
		transform: translateY(-3vh);
	}
	.app-startup__tiles {
		display: grid;
		grid-template-columns: repeat(2, 56px);
		gap: 12px;
	}
	.app-startup__tile {
		--tile-accent: var(--ui-primary);
		display: grid;
		place-items: center;
		height: 56px;
		border: 1px solid color-mix(in srgb, var(--tile-accent) 16%, var(--ui-border));
		border-radius: 17px;
		background: color-mix(in srgb, var(--tile-accent) 8%, var(--ui-surface));
		color: var(--tile-accent);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--ui-text) 4%, transparent);
	}
	.app-startup__tile:nth-child(2) {
		--tile-accent: var(--ui-app-blue);
	}
	.app-startup__tile:nth-child(3) {
		--tile-accent: var(--ui-app-steel);
	}
	.app-startup__brand {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 2.4px;
	}
	.app-startup__caption p {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		margin: 10px 0 0;
		color: var(--ui-text);
		font-size: 14px;
		line-height: 1.7;
		font-weight: 450;
	}
	.app-startup__caption button {
		margin-top: 16px;
	}
</style>
