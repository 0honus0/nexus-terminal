<script setup lang="ts">
	import { computed, nextTick, ref, watch } from 'vue';
	import { useEventListener, usePointerSwipe, useResizeObserver } from '@vueuse/core';
	import { CircleCheck, CircleAlert, Info, X, ChevronUp, ChevronDown } from '@lucide/vue';
	import { ToastProvider, ToastRoot, ToastDescription, ToastClose, ToastViewport } from 'reka-ui';
	import type { UiToastStackProps } from '../ui-component-types.js';
	import { useUiMotion } from '../ui-motion-api.js';

	defineOptions({ inheritAttrs: false });
	const props = withDefaults(defineProps<UiToastStackProps>(), { duration: 5000 });
	const emit = defineEmits<{ dismiss: [id: string | number] }>();
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
			if (added !== undefined && !previous.includes(added)) activeId.value = added;
			else if (!ids.includes(activeId.value!)) {
				const index = previous.indexOf(activeId.value!);
				activeId.value = ids[Math.max(0, Math.min(index - 1, ids.length - 1))];
			}
		},
		{ immediate: true, flush: 'sync' },
	);

	watch(activeId, async (id) => {
		stopAnimation();
		dragging = false;
		expanded.value = false;
		truncated.value = false;
		await nextTick();
		measureText();
		if (card.value && activeId.value === id)
			stopAnimation = play(
				card.value,
				[
					{ opacity: 0, transform: 'translateY(-6px)' },
					{ opacity: 1, transform: 'translateY(0)' },
				],
				160,
			);
	});

	function select(direction: number) {
		if (props.items.length < 2) return;
		const index = (activeIndex.value + direction + props.items.length) % props.items.length;
		const focused = card.value?.contains(document.activeElement);
		activeId.value = props.items[index]!.id;
		if (focused) void nextTick(() => card.value?.focus({ preventScroll: true }));
	}

	function dismiss() {
		if (!active.value) return;
		const focused = card.value?.contains(document.activeElement);
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
				<div class="ui-toast__icon"><component :is="icons[active.tone]" :size="18" aria-hidden="true" /></div>
				<div class="ui-toast__content">
					<ToastDescription as-child
						><p ref="message" class="ui-toast__message" :class="{ 'is-expanded': expanded }">
							{{ active.message }}
						</p></ToastDescription
					>
					<div v-if="truncated || expanded || items.length > 1" class="ui-toast__footer">
						<button
							v-if="truncated || expanded"
							class="ui-toast__expand"
							type="button"
							:aria-expanded="expanded"
							@click="toggleExpanded"
						>
							{{ expanded ? collapseLabel : expandLabel }}
							<ChevronUp v-if="expanded" :size="12" aria-hidden="true" />
							<ChevronDown v-else :size="12" aria-hidden="true" />
						</button>
						<div v-if="items.length > 1" class="ui-toast__navigation">
							<span :aria-label="positionLabel(position, items.length)"
								><strong>{{ position }}</strong
								><span aria-hidden="true"> / </span>{{ items.length }}</span
							>
						</div>
					</div>
				</div>
				<ToastClose class="ui-toast__close" :aria-label="closeLabel"
					><X :size="15" aria-hidden="true"
				/></ToastClose>
			</li>
		</ToastRoot>
		<ToastViewport
			v-bind="$attrs"
			class="ui-toast-stack"
			data-ui="toast-stack"
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
		top: max(20px, env(safe-area-inset-top));
		right: max(20px, env(safe-area-inset-right));
		isolation: isolate;
		width: min(400px, calc(100vw - 32px));
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
		inset: 8px 7px -7px;
		border: 1px solid var(--ui-border);
		border-radius: 14px;
		background: color-mix(in srgb, var(--ui-surface) 80%, transparent);
		backdrop-filter: blur(14px);
		content: '';
		opacity: 0;
		pointer-events: none;
	}
	.ui-toast-stack::before {
		inset: 16px 12px -14px;
	}
	.ui-toast-stack[data-count='2']::after,
	.ui-toast-stack[data-count='3']::after {
		opacity: 0.9;
	}
	.ui-toast-stack[data-count='3']::before {
		opacity: 0.65;
	}
	.ui-toast {
		--toast-accent: var(--ui-primary);
		position: relative;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) 26px;
		align-items: center;
		column-gap: 12px;
		min-height: 68px;
		padding: 13px 14px;
		border: 1px solid color-mix(in srgb, var(--toast-accent) 14%, transparent);
		border-radius: 20px;
		background: color-mix(in srgb, color-mix(in srgb, var(--ui-surface) 93%, var(--toast-accent)) 94%, transparent);
		backdrop-filter: blur(20px) saturate(1.15);
		color: var(--ui-text);
		box-shadow:
			0 12px 36px color-mix(in srgb, black 12%, transparent),
			0 2px 5px color-mix(in srgb, black 4%, transparent);
		outline: none;
		touch-action: none !important;
		pointer-events: auto;
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
		touch-action: pan-y !important;
	}
	.ui-toast__icon {
		display: grid;
		place-items: center;
		align-self: center;
		width: 34px;
		height: 34px;
		border-radius: 12px;
		color: var(--toast-accent);
		background: color-mix(in srgb, var(--toast-accent) 12%, transparent);
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
		line-height: 1.55;
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
		justify-content: space-between;
		gap: 10px;
		margin-top: 7px;
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
	}
	.ui-toast__expand {
		display: inline-flex;
		gap: 3px;
		width: auto;
		height: 22px;
		padding-inline: 5px;
		margin-left: -5px;
		color: var(--ui-muted);
		font-size: 11px;
	}
	.ui-toast__close {
		align-self: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--ui-text) 4%, transparent);
	}
	.ui-toast__close:hover,
	.ui-toast__expand:hover {
		background: color-mix(in srgb, var(--ui-text) 7%, transparent);
		color: var(--ui-text);
	}
	.ui-toast:focus-visible,
	.ui-toast button:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: 2px;
	}
	.ui-toast__navigation {
		display: flex;
		align-items: center;
		height: 22px;
		margin-left: auto;
		padding: 0 9px;
		border: 1px solid color-mix(in srgb, var(--ui-border) 65%, transparent);
		border-radius: 20px;
		background: color-mix(in srgb, var(--ui-text) 3%, transparent);
		color: var(--ui-muted);
		font-size: 11px;
		font-variant-numeric: lining-nums tabular-nums;
		line-height: 16px;
	}
	.ui-toast__navigation > span {
		display: inline-flex;
		align-items: baseline;
		white-space: pre;
	}
	.ui-toast__navigation strong {
		font: inherit;
		font-weight: 600;
	}
	html[data-layout-profile='compact'] .ui-toast-stack {
		top: max(10px, env(safe-area-inset-top));
		right: auto;
		left: 50%;
		width: min(360px, calc(100vw - 24px));
		transform: translateX(-50%);
	}
	html[data-layout-profile='compact'] .ui-toast {
		grid-template-columns: 30px minmax(0, 1fr) 26px;
		min-height: 58px;
		column-gap: 9px;
		padding: 10px 11px;
	}
	html[data-layout-profile='compact'] .ui-toast__icon {
		width: 30px;
		height: 30px;
		border-radius: 10px;
	}
	html[data-layout-profile='compact'] .ui-toast__message {
		font-size: 12px;
	}
	html[data-layout-profile='compact'] .ui-toast__navigation {
		height: 19px;
		padding-inline: 8px;
	}
</style>
