<script setup lang="ts">
	import { Copy, Minus, Square, X } from '@lucide/vue';
	import interact from 'interactjs';
	import { computed, nextTick, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { LogApi } from '../../log/browser/log-api.js';
	import { PluginView } from '../../plugin/browser/plugin-view-api.js';
	import { UiButton } from '../../ui/browser/ui-base-api.js';
	import { UiResizeHandle, UiScrollArea, uiResizeEdges } from '../../ui/browser/ui-components-api.js';
	import { useUiMotion } from '../../ui/browser/ui-motion-api.js';
	import WindowTitleControls from './WindowTitleControls.vue';
	import type { DesktopWindow, WindowApi } from './window-api.js';

	const { item, windows, log } = defineProps<{
		item: DesktopWindow;
		windows: WindowApi;
		log: Pick<LogApi, 'report'>;
	}>();
	const { t } = useI18n({ useScope: 'global' });
	const { play } = useUiMotion();
	const element = ref<HTMLElement>();
	const title = computed(item.application.label);
	const scrollMode = computed(() => item.application.scrollMode ?? (item.application.plugin ? 'content' : 'window'));
	const compact = computed(() => windows.profile.value === 'compact');
	const resizable = computed(() => !compact.value && !item.maximized && !item.closing);
	const focused = computed(() => windows.active.value === item);
	const geometry = computed(() => {
		const { x, y, width, height } = windows.visibleBounds(item);
		return { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px', zIndex: item.stack };
	});
	let scroll: { node: HTMLElement; top: number; left: number }[] = [];

	watch(
		() => item.minimized,
		async (minimized) => {
			if (minimized && element.value) {
				// WebKit can reset a scroller inside a hidden container query.
				scroll = [...element.value.querySelectorAll<HTMLElement>('*')]
					.filter((node) => node.scrollTop || node.scrollLeft)
					.map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
				return;
			}
			await nextTick();
			if (item.minimized || item.closing) return;
			for (const { node, top, left } of scroll) if (element.value?.contains(node)) node.scrollTo(left, top);
			scroll = [];
		},
	);

	// 在应用 inert 生效前检查焦点归属。鼠标关闭或焦点已离开窗口时无需交回卡片。
	watch(
		() => item.minimized || item.closing,
		(hidden) => {
			const target = document.activeElement;
			const launcher = item.launcher;
			if (
				hidden &&
				!windows.active.value &&
				target?.matches(':focus-visible') &&
				element.value?.contains(target) &&
				launcher?.isConnected &&
				!launcher.closest('[inert]')
			)
				launcher.focus({ preventScroll: true });
		},
		{ flush: 'sync' },
	);

	watch(
		focused,
		async (active) => {
			if (!active) return;
			await nextTick();
			const root = element.value;
			if (focused.value && root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
		},
		{ immediate: true },
	);

	watch(
		[element, resizable],
		([root, enabled], _, onCleanup) => {
			if (!root || !enabled) return;
			let changed = false;
			const interaction = interact(root)
				.draggable({
					allowFrom: '.application-window__titlebar',
					ignoreFrom: 'button, a, input, [role=tablist]',
					listeners: {
						move: (event) => {
							const bounds = windows.visibleBounds(item);
							windows.updateBounds(item, { ...bounds, x: bounds.x + event.dx, y: bounds.y + event.dy });
							changed = true;
						},

						end: commit,
					},
				})
				.resizable({
					edges: uiResizeEdges,
					modifiers: [interact.modifiers.restrictSize({ min: { width: 320, height: 240 } })],
					listeners: {
						move: (event) => {
							const bounds = windows.visibleBounds(item);
							windows.updateBounds(item, {
								x: bounds.x + event.deltaRect.left,
								y: bounds.y + event.deltaRect.top,
								width: event.rect.width,
								height: event.rect.height,
							});
							changed = true;
						},

						end: commit,
					},
				});
			onCleanup(() => interaction.unset());

			function commit(): void {
				if (changed) windows.saveBounds(item);
				changed = false;
			}
		},
		{ flush: 'post' },
	);

	function resizeBy(dx: number, dy: number): void {
		const bounds = windows.visibleBounds(item);
		windows.updateBounds(item, { ...bounds, width: bounds.width + dx, height: bounds.height + dy });
		windows.saveBounds(item);
	}

	function enter(target: Element, done: () => void): void {
		play(
			target as HTMLElement,
			[
				{ opacity: 0, scale: '.98' },
				{ opacity: 1, scale: '1' },
			],
			180,
			done,
		);
	}

	function leave(target: Element, done: () => void): void {
		play(
			target as HTMLElement,
			[
				{ opacity: 1, scale: '1' },
				{ opacity: 0, scale: '.98' },
			],
			140,
			done,
		);
	}
</script>

<template>
	<Transition appear :css="false" @enter="enter" @leave="leave" @after-leave="windows.finishExit(item)">
		<section
			v-show="!item.minimized && !item.closing"
			ref="element"
			class="application-window"
			:class="{ 'is-focused': focused, 'is-maximized': item.maximized, 'is-compact': compact }"
			:style="geometry"
			:data-window-id="item.id"
			:inert="item.minimized || item.closing"
			:aria-hidden="item.minimized || item.closing || undefined"
			role="region"
			:aria-label="title"
			tabindex="-1"
			@pointerdown="windows.focus(item)"
		>
			<div class="application-window__surface">
				<header
					class="application-window__titlebar"
					@dblclick="
						(event) =>
							!compact &&
							!(event.target as Element).closest('button') &&
							(item.maximized = !item.maximized)
					"
				>
					<WindowTitleControls v-if="item.chrome" :chrome="item.chrome" :title="title">
						<div class="application-window__identity">
							<component
								:is="item.application.icon"
								v-if="item.application.icon"
								:size="16"
								:style="{ color: item.application.color }"
							/>
							<span>{{ title }}</span>
						</div>
					</WindowTitleControls>
					<div v-else class="application-window__identity">
						<component
							:is="item.application.icon"
							v-if="item.application.icon"
							:size="16"
							:style="{ color: item.application.color }"
						/>
						<span>{{ title }}</span>
					</div>
					<div class="application-window__controls">
						<UiButton
							appearance="ghost"
							icon-only
							:aria-label="t('desktop.minimize')"
							@click="item.minimized = true"
							><Minus :size="16"
						/></UiButton>
						<UiButton
							v-if="!compact"
							appearance="ghost"
							icon-only
							:aria-label="t(item.maximized ? 'desktop.restore' : 'desktop.maximize')"
							@click="item.maximized = !item.maximized"
							><component :is="item.maximized ? Copy : Square" :size="14"
						/></UiButton>
						<UiButton
							appearance="ghost"
							tone="danger"
							icon-only
							:aria-label="t('closeApplication')"
							@click="windows.requestClose(item)"
							><X :size="17"
						/></UiButton>
					</div>
				</header>
				<UiScrollArea
					class="application-window__body"
					:data-scroll-mode="scrollMode"
					:overflow="scrollMode === 'window' ? 'auto' : 'hidden'"
					:gutter="scrollMode === 'window' ? item.application.scrollbarGutter : undefined"
				>
					<PluginView
						v-if="item.application.plugin"
						:entry="item.application.plugin"
						:scope="item.view"
						:api="item.pluginApi"
						:log="log"
					/>
					<slot v-else />
				</UiScrollArea>
			</div>
			<UiResizeHandle v-if="resizable" edges :label="t('desktop.resize', { title })" @resize="resizeBy" />
		</section>
	</Transition>
</template>

<style scoped>
	.application-window {
		position: absolute;
		inset: 0 auto auto 0;
		display: flex;
		flex-direction: column;
		pointer-events: auto;
		border: 1px solid var(--ui-border);
		border-radius: 20px;
		/* 活动窗口已有 is-focused 边框与阴影，焦点交接不叠加浏览器默认外框。 */
		outline: none;
		background: var(--ui-surface);
		box-shadow: 0 16px 54px #15132d18;
	}
	.application-window__surface {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
	}
	.application-window.is-focused {
		box-shadow:
			0 24px 80px #17132d2b,
			0 0 0 1px color-mix(in srgb, var(--ui-primary) 12%, transparent);
	}
	.application-window__titlebar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 52px;
		padding: 0 10px 0 20px;
		background: var(--ui-window-header, light-dark(#eeebf2ee, #282431));
		border-bottom: 1px solid var(--ui-border);
		user-select: none;
		touch-action: none;
	}
	.application-window__titlebar:has(.window-tabs) {
		min-height: 46px;
		align-items: stretch;
		gap: 8px;
		padding: 7px 10px 4px 10px;
		background: linear-gradient(
			to top,
			var(--ui-surface) 4px,
			var(--ui-window-header, light-dark(#e8e4f0, #1f1c29)) 4px
		);
		border-bottom: 0;
	}
	.application-window__titlebar:has(.window-tabs) .application-window__controls {
		align-self: center;
		margin-bottom: 2px;
	}
	.application-window__identity {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		font-size: 13px;
		font-weight: 650;
	}
	.application-window__identity span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.application-window__controls {
		display: flex;
		flex-shrink: 0;
		gap: 3px;
	}
	.application-window__body {
		flex: 1;
	}

	.application-window.is-compact,
	.application-window.is-compact.is-focused {
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}
	.is-compact .application-window__titlebar {
		min-height: calc(52px + env(safe-area-inset-top));
		padding-top: env(safe-area-inset-top);
		padding-left: max(14px, env(safe-area-inset-left));
		padding-right: max(10px, env(safe-area-inset-right));
	}
	.is-compact .application-window__titlebar:has(.window-tabs) {
		min-height: calc(46px + env(safe-area-inset-top));
		padding-top: calc(7px + env(safe-area-inset-top));
		padding-bottom: 4px;
		padding-left: max(10px, env(safe-area-inset-left));
	}
	.is-compact .application-window__body {
		padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.is-compact .application-window__controls {
		--ui-button-height: 36px;
	}
</style>
