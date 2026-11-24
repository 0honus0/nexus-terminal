import { useEventListener, useSwipe, useTimeoutFn } from '@vueuse/core';
import type { Ref } from 'vue';

function reservesNavigation(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		!!target.closest(
			'input, textarea, select, [contenteditable], [role=slider], [role=tablist], .desktop-widget, [data-window-id], .dock-region, .desktop-pagination',
		)
	);
}

/** 桌面仅接管落在画布上的翻页手势，保留输入、窗口和插件内容自身的操作。 */
export function useDesktopNavigation(
	canvas: Ref<HTMLElement | undefined>,
	blocked: () => boolean,
	step: (direction: number) => void,
): void {
	const available = () =>
		!blocked() &&
		!document.querySelector(
			'[role=dialog][data-state=open], [role=menu][data-state=open], [data-ui=select-content]',
		);

	let swipe = false;
	let amount = 0;
	let locked = false;
	const { start } = useTimeoutFn(
		() => {
			amount = 0;
			locked = false;
		},
		180,
		{ immediate: false },
	);

	useEventListener(document, 'keydown', (event) => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (!available() || reservesNavigation(event.target)) return;
		event.preventDefault();
		step(event.key === 'ArrowLeft' ? -1 : 1);
	});

	useEventListener(
		canvas,
		'wheel',
		(event) => {
			if (
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				!available() ||
				reservesNavigation(event.target)
			)
				return;
			const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
			const scroller = event.target instanceof Element ? event.target.closest('.desktop-canvas') : null;
			// With clipped rows, vertical wheel movement belongs to the canvas.
			// Horizontal gestures and pagination still change pages.
			if (!horizontal && scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
			const delta = horizontal ? event.deltaX : event.deltaY;
			if (!delta) return;
			event.preventDefault();
			if (locked) return;
			if (Math.sign(amount) !== Math.sign(delta)) amount = 0;
			amount +=
				delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.value?.clientHeight ?? 1) : 1);
			if (Math.abs(amount) >= 50) {
				step(Math.sign(amount));
				locked = true;
			}
			start();
		},
		{ passive: false },
	);

	useEventListener(
		canvas,
		'touchstart',
		(event) => {
			if (event.touches.length !== 1) swipe = false;
		},
		{ capture: true, passive: true },
	);
	useSwipe(canvas, {
		passive: false,

		onSwipeStart(event) {
			swipe = event.touches.length === 1 && !reservesNavigation(event.target);
		},

		onSwipeEnd(event, direction) {
			if (!swipe || event.type === 'touchcancel' || !available()) return;
			if (direction === 'left' || direction === 'right') step(direction === 'left' ? 1 : -1);
		},
	});
}
