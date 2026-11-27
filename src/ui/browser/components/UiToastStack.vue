<script setup lang="ts">
	import { computed, nextTick, ref, watch } from 'vue';
	import { useEventListener, useMediaQuery, usePointerSwipe, useResizeObserver } from '@vueuse/core';
	import { CircleCheck, CircleAlert, Info, X, ChevronUp, ChevronDown } from '@lucide/vue';
	import { ToastProvider, ToastRoot, ToastDescription, ToastClose, ToastViewport, VisuallyHidden } from 'reka-ui';
	import type { UiToastStackProps } from '../ui-component-types.js';
	import { useUiMotion } from '../ui-motion-api.js';
	import { LayoutProfiles } from '../../../layout/layout-api.js';

	defineOptions({ inheritAttrs: false });
	const props = withDefaults(defineProps<UiToastStackProps>(), { duration: 5000 });
	const emit = defineEmits<{ dismiss: [id: string | number] }>();
	const compact = useMediaQuery(`(width < ${LayoutProfiles.wide.minWidth}px)`);
	const activeId = ref<string | number>();
	const expanded = ref(false);
	const card = ref<HTMLElement>();
	const message = ref<HTMLElement>();
	const truncated = ref(false);
	const icons = { info: Info, success: CircleCheck, warning: CircleAlert, error: CircleAlert };
	const activeIndex = computed(() => props.items.findIndex((item) => item.id === activeId.value));
	const active = computed(() => props.items[activeIndex.value]);
	const position = computed(() => props.items.length - activeIndex.value);
	const { play } = useUiMotion();
	let dragging = false;
	let dragId: string | number | undefined;
	let transitionDirection = 0;

	let stopAnimation = () => {};

	let suppressClick = false;
	let wheelAmount = 0;
	let wheelTime = 0;
	let wheelLockedUntil = 0;

	function measureText() {
		if (!expanded.value && message.value)
			truncated.value = message.value.scrollHeight > message.value.clientHeight + 1;
	}

	useResizeObserver(message, measureText);
	watch([() => active.value?.message, expanded], () => nextTick(measureText));

	watch(
		() => props.items.map((item) => item.id),
		(ids, previous = []) => {
			const added = ids.at(-1);
			if (added !== undefined && !previous.includes(added)) {
				transitionDirection = 0;
				activeId.value = added;
			} else if (!ids.includes(activeId.value!)) {
				const index = previous.indexOf(activeId.value!);
				transitionDirection = 0;
				activeId.value = ids[Math.max(0, Math.min(index - 1, ids.length - 1))];
			}
		},
		{ immediate: true, flush: 'sync' },
	);

	watch(activeId, async () => {
		stopAnimation();
		dragging = false;
		expanded.value = false;
		truncated.value = false;
		await nextTick();
		measureText();
	});

	function enterToast(target: Element, done: () => void) {
		const element = target as HTMLElement;
		const direction = transitionDirection;
		transitionDirection = 0;
		stopAnimation =
			direction === 0
				? play(
						element,
						[
							{ opacity: 0, transform: 'translateY(var(--toast-enter-y, -24px)) scale(0.86)' },
							{
								opacity: 1,
								transform: 'translateY(var(--toast-bounce-y, 3px)) scale(1.018)',
								offset: 0.66,
							},
							{ opacity: 1, transform: 'translateY(0) scale(1)' },
						],
						320,
						done,
						[0.22, 1, 0.36, 1],
					)
				: play(
						element,
						[
							{ opacity: 0, transform: `translateY(${direction > 0 ? -12 : 12}px) scale(0.95)` },
							{ opacity: 1, transform: 'translateY(0) scale(1)' },
						],
						200,
						done,
						[0.22, 1, 0.36, 1],
					);
	}

	function leaveToast(target: Element, done: () => void) {
		const element = target as HTMLElement;
		const direction = transitionDirection;
		play(
			element,
			direction === 0
				? [
						{ opacity: 1, transform: 'translateY(0) scale(1)' },
						{ opacity: 0, transform: 'translateY(var(--toast-leave-y, -16px)) scale(0.92)' },
					]
				: [
						{ opacity: 1, transform: 'translateY(0) scale(1)' },
						{ opacity: 0, transform: `translateY(${direction > 0 ? 10 : -10}px) scale(0.95)` },
					],
			direction === 0 ? 190 : 130,
			done,
			[0.4, 0, 1, 1],
		);
	}

	function select(direction: number) {
		if (props.items.length < 2) return;
		const index = (activeIndex.value + direction + props.items.length) % props.items.length;
		const focused = card.value?.contains(document.activeElement);
		transitionDirection = direction;
		activeId.value = props.items[index]!.id;
		if (focused) void nextTick(() => card.value?.focus({ preventScroll: true }));
	}

	function dismiss() {
		if (!active.value) return;
		const focused = card.value?.contains(document.activeElement);
		transitionDirection = 0;
		emit('dismiss', active.value.id);
		if (focused && props.items.length) void nextTick(() => card.value?.focus({ preventScroll: true }));
	}

	function toggleExpanded(event: MouseEvent) {
		expanded.value = !expanded.value;
		// Touch browsers do not consistently focus tapped buttons. Focus explicitly so
		// Reka pauses expiry while the full message is being read, on every browser.
		(event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
	}

	// Capture before Reka's dialog and menu listeners, regardless of which opened first.
	useEventListener(
		'keydown',
		(event) => {
			if (event.key !== 'Escape' || !active.value) return;
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		},
		{ capture: true },
	);

	function keyboard(event: KeyboardEvent) {
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			event.stopPropagation();
			select(event.key === 'ArrowUp' ? 1 : -1);
		}
	}

	function wheel(event: WheelEvent) {
		if (event.ctrlKey) return;
		event.stopPropagation();
		// Expanded text keeps native scrolling; it must not switch notifications.
		if (expanded.value && (event.target as HTMLElement).closest('.ui-toast__message')) return;
		event.preventDefault();
		if (props.items.length < 2) return;
		const now = performance.now();
		if (now < wheelLockedUntil || !Number.isFinite(event.deltaY)) return;
		if (now - wheelTime > 200 || Math.sign(wheelAmount) !== Math.sign(event.deltaY)) wheelAmount = 0;
		wheelTime = now;
		const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
		wheelAmount += pixels;
		if (Math.abs(wheelAmount) < 32) return;
		select(wheelAmount > 0 ? -1 : 1);
		wheelAmount = 0;
		wheelLockedUntil = now + 260;
	}

	// Reka owns timeout/focus/announcements. VueUse owns the single bidirectional
	// pointer gesture, since Reka's swipe is intentionally limited to one direction.
	const swipe = usePointerSwipe(card, {
		threshold: 24,

		onSwipeStart(event) {
			stopAnimation();
			dragId = activeId.value;
			dragging =
				event.isPrimary &&
				event.button === 0 &&
				!(event.target as HTMLElement).closest('button, .ui-toast__message.is-expanded');
			suppressClick = false;
		},

		onSwipe() {
			if (!dragging || dragId !== activeId.value || !card.value) return;
			suppressClick = true;
			const x = -swipe.distanceX.value;
			if (Math.abs(x) > Math.abs(swipe.distanceY.value)) {
				card.value.style.transform = `translateX(${x}px)`;
				card.value.style.opacity = String(Math.max(0.3, 1 - Math.abs(x) / card.value.clientWidth));
			}
		},

		onSwipeEnd(event, direction) {
			if (!dragging || dragId !== activeId.value) return;
			dragging = false;
			if (card.value) {
				card.value.style.removeProperty('transform');
				card.value.style.removeProperty('opacity');
			}
			if (event.type === 'pointercancel') return;
			if (direction === 'left' || direction === 'right') {
				if (Math.abs(swipe.distanceX.value) >= 56) dismiss();
			} else if (direction === 'up' || direction === 'down') select(direction === 'up' ? -1 : 1);
		},
	});

	// Prevent a drag ending over a button from becoming a click. A fresh press resets it.
	useEventListener(
		card,
		'click',
		(event) => {
			if (!suppressClick) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		{ capture: true },
	);
	useEventListener(card, 'pointercancel', () => {
		dragging = false;
	});
</script>

<template>
	<ToastProvider :duration="expanded ? Infinity : duration" :label="label" disable-swipe>
		<Transition mode="out-in" appear :css="false" @enter="enterToast" @leave="leaveToast">
			<ToastRoot
				v-if="active"
				:key="active.id"
				as-child
				:open="true"
				@update:open="
					(open) => {
						if (!open) dismiss();
					}
				"
			>
				<li
					ref="card"
					class="ui-toast"
					data-ui="toast"
					:data-tone="active.tone"
					:data-expanded="expanded || undefined"
					@keydown="keyboard"
				>
					<div class="ui-toast__icon">
						<component :is="icons[active.tone]" :size="17" aria-hidden="true" />
					</div>
					<div class="ui-toast__content">
						<ToastDescription as-child
							><p ref="message" class="ui-toast__message" :class="{ 'is-expanded': expanded }">
								{{ active.message }}
							</p></ToastDescription
						>
						<div v-if="truncated || expanded" class="ui-toast__footer">
							<button
								class="ui-toast__expand"
								type="button"
								:aria-expanded="expanded"
								@click="toggleExpanded"
							>
								{{ expanded ? collapseLabel : expandLabel }}
								<ChevronUp v-if="expanded" :size="12" aria-hidden="true" />
								<ChevronDown v-else :size="12" aria-hidden="true" />
							</button>
						</div>
					</div>
					<div class="ui-toast__controls">
						<ToastClose class="ui-toast__close" :aria-label="closeLabel"
							><X :size="14" aria-hidden="true"
						/></ToastClose>
						<span v-if="items.length > 1" class="ui-toast__page">
							<VisuallyHidden>{{ positionLabel(position, items.length) }}</VisuallyHidden>
							<span aria-hidden="true">{{ position }}/{{ items.length }}</span>
						</span>
					</div>
				</li>
			</ToastRoot>
		</Transition>
		<ToastViewport
			v-bind="$attrs"
			class="ui-toast-stack"
			data-ui="toast-stack"
			:data-compact="compact || undefined"
			:data-count="Math.min(items.length, 3)"
			:label="label"
			@wheel="wheel"
			@touchmove.stop
			@pointerdown.stop
			@pointerup.stop
		/>
	</ToastProvider>
</template>

<style>
	.ui-toast-stack {
		position: fixed;
		z-index: 1000;
		top: max(16px, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		isolation: isolate;
		width: fit-content;
		min-width: min(260px, calc(100vw - 32px));
		max-width: min(440px, calc(100vw - 32px));
		margin: 0;
		padding: 0;
		list-style: none;
		outline: none;
		overscroll-behavior: contain;
		pointer-events: none;
	}
	.ui-toast-stack::before,
	.ui-toast-stack::after {
		position: absolute;
		z-index: -1;
		inset: 7px 14px -6px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 78%, transparent);
		border-radius: 24px;
		background: color-mix(in srgb, var(--ui-surface) 82%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
		box-shadow: 0 8px 20px color-mix(in srgb, #241b35 10%, transparent);
		content: '';
		opacity: 0;
		transform: translateY(-4px) scale(0.96);
		pointer-events: none;
		transition:
			opacity var(--ui-motion-duration, 180ms) ease,
			transform var(--ui-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);
	}
	.ui-toast-stack::before {
		inset: 14px 26px -12px;
		border-radius: 20px;
	}
	.ui-toast-stack[data-count='2']::after,
	.ui-toast-stack[data-count='3']::after {
		opacity: 0.92;
		transform: translateY(0) scale(1);
	}
	.ui-toast-stack[data-count='3']::before {
		opacity: 0.65;
		transform: translateY(0) scale(1);
	}
	.ui-toast {
		--toast-accent: var(--ui-primary);
		position: relative;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 11px;
		min-height: 58px;
		padding: 9px 12px 9px 10px;
		border: 1px solid color-mix(in srgb, var(--toast-accent) 22%, var(--ui-border));
		border-radius: 26px;
		background: color-mix(in srgb, color-mix(in srgb, var(--ui-surface) 95%, var(--toast-accent)) 92%, transparent);
		backdrop-filter: blur(22px) saturate(150%);
		-webkit-backdrop-filter: blur(22px) saturate(150%);
		color: var(--ui-text);
		box-shadow:
			0 14px 36px -8px color-mix(in srgb, #241b35 16%, transparent),
			0 3px 10px -2px color-mix(in srgb, #241b35 8%, transparent),
			inset 0 1px 0 color-mix(in srgb, #ffffff 48%, transparent);
		outline: none;
		touch-action: none !important;
		pointer-events: auto;
		will-change: transform, opacity;
		transition: border-radius var(--ui-motion-duration, 180ms) cubic-bezier(0.22, 1, 0.36, 1);
	}
	.ui-toast[data-tone='error'] {
		--toast-accent: var(--ui-danger);
	}
	.ui-toast[data-tone='warning'] {
		--toast-accent: var(--ui-warning);
	}
	.ui-toast[data-tone='success'] {
		--toast-accent: var(--ui-success);
	}
	.ui-toast[data-expanded] {
		border-radius: 20px;
		align-items: start;
		padding: 12px 14px;
		touch-action: pan-y !important;
	}
	@keyframes ui-toast-icon-pop {
		0% {
			transform: scale(0.62) rotate(-10deg);
			opacity: 0.4;
		}
		65% {
			transform: scale(1.1) rotate(3deg);
			opacity: 1;
		}
		100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
	}
	.ui-toast__icon {
		display: grid;
		place-items: center;
		align-self: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		color: var(--toast-accent);
		background: color-mix(in srgb, var(--toast-accent) 14%, transparent);
		animation: ui-toast-icon-pop calc(340ms * var(--ui-motion-factor, 1) / var(--ui-motion-speed, 1))
			cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.ui-toast__content {
		min-width: 0;
		align-self: center;
	}
	.ui-toast__message {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		margin: 0;
		overflow: hidden;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.ui-toast__message.is-expanded {
		display: block;
		max-height: min(240px, 35dvh);
		overflow: auto;
	}
	.ui-toast__footer {
		display: flex;
		align-items: center;
		margin-top: 5px;
	}
	.ui-toast__close,
	.ui-toast__expand {
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--ui-muted);
		cursor: pointer;
		transition:
			background-color var(--ui-motion-duration, 140ms) ease,
			color var(--ui-motion-duration, 140ms) ease;
	}
	.ui-toast__expand {
		display: inline-flex;
		gap: 3px;
		width: auto;
		height: 22px;
		padding-inline: 6px;
		margin-left: -6px;
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 500;
	}
	.ui-toast__close {
		align-self: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--ui-text) 5%, transparent);
	}
	.ui-toast__close:hover,
	.ui-toast__expand:hover {
		background: color-mix(in srgb, var(--ui-text) 10%, transparent);
		color: var(--ui-text);
	}
	.ui-toast:focus-visible,
	.ui-toast button:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: 2px;
	}
	.ui-toast__controls {
		display: flex;
		flex-direction: column;
		align-self: stretch;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 26px;
	}
	.ui-toast__page {
		color: var(--ui-muted);
		font-size: 10px;
		font-variant-numeric: lining-nums tabular-nums;
		line-height: 1;
		white-space: nowrap;
		pointer-events: none;
	}
	.ui-toast-stack[data-compact] {
		--toast-enter-y: 24px;
		--toast-bounce-y: -3px;
		--toast-leave-y: 16px;
		top: auto;
		bottom: calc(72px + env(safe-area-inset-bottom));
		width: fit-content;
		min-width: min(220px, calc(100vw - 24px));
		max-width: min(360px, calc(100vw - 24px));
	}
	body:has([data-ui='dialog-overlay']) .ui-toast-stack[data-compact] {
		bottom: max(8px, env(safe-area-inset-bottom));
	}
	.ui-toast-stack[data-compact] .ui-toast {
		grid-template-columns: 26px minmax(0, 1fr) auto;
		min-height: 54px;
		column-gap: 9px;
		padding: 7px 11px 7px 8px;
		border-radius: 22px;
	}
	.ui-toast-stack[data-compact] .ui-toast__icon {
		width: 26px;
		height: 26px;
		border-radius: 50%;
	}
	.ui-toast-stack[data-compact] .ui-toast__message {
		font-size: 12.5px;
	}
	.ui-toast-stack[data-compact] .ui-toast__page {
		font-size: 9.5px;
	}
</style>
