import type { RemoteTouchMode } from '../model/remote-desktop-types';

export function attachDesktopTouch(element: HTMLElement, canvas: HTMLCanvasElement, initialMode: RemoteTouchMode) {
	let mode = initialMode;
	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastY = 0;
	let cursorX = 0;
	let cursorY = 0;
	let moved = false;
	let dragging = false;
	let fingers = 0;
	let lastTap = 0;
	let held = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const previousTouchAction = element.style.touchAction;
	element.style.touchAction = 'none';

	const mouse = (type: string, button = 0) => {
		const rect = canvas.getBoundingClientRect();
		canvas.dispatchEvent(
			new MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + cursorX,
				clientY: rect.top + cursorY,
				button,
				buttons: dragging ? 1 : 0,
			}),
		);
	};

	const cancel = () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = null;
		if (dragging) {
			dragging = false;
			mouse('mouseup');
		}
		fingers = 0;
	};

	const handle = (event: TouchEvent) => {
		event.preventDefault();
		event.stopImmediatePropagation();
		const touch = event.touches[0];
		if (event.type === 'touchstart' && touch) {
			cancel();
			fingers = event.touches.length;
			startX = lastX = touch.clientX;
			startY = lastY = touch.clientY;
			moved = false;
			held = false;
			const rect = canvas.getBoundingClientRect();
			if (mode === 'direct') {
				cursorX = touch.clientX - rect.left;
				cursorY = touch.clientY - rect.top;
				mouse('mousemove');
			} else if (cursorX === 0 && cursorY === 0) {
				cursorX = rect.width / 2;
				cursorY = rect.height / 2;
			}
			if (fingers === 1 && Date.now() - lastTap < 300) {
				dragging = true;
				mouse('mousedown');
				lastTap = 0;
			}
			timer = setTimeout(() => {
				timer = null;
				if (fingers === 1 && !moved && !dragging && mode === 'direct') {
					held = true;
					mouse('mousedown', 2);
					mouse('mouseup', 2);
				}
			}, 350);
		} else if (event.type === 'touchmove' && touch) {
			const deltaX = touch.clientX - lastX;
			const deltaY = touch.clientY - lastY;
			lastX = touch.clientX;
			lastY = touch.clientY;
			if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 8) {
				moved = true;
			}
			if (moved && timer) {
				clearTimeout(timer);
				timer = null;
			}
			if (fingers > 1) {
				canvas.dispatchEvent(
					new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -deltaX, deltaY: -deltaY }),
				);
				return;
			}
			const rect = canvas.getBoundingClientRect();
			cursorX = Math.max(
				0,
				Math.min(rect.width - 1, mode === 'direct' ? touch.clientX - rect.left : cursorX + deltaX),
			);
			cursorY = Math.max(
				0,
				Math.min(rect.height - 1, mode === 'direct' ? touch.clientY - rect.top : cursorY + deltaY),
			);
			mouse('mousemove');
		} else if (event.type === 'touchend') {
			if (event.touches.length > 0) {
				return;
			}
			if (!dragging && !moved && !held) {
				mouse('mousedown', fingers > 1 ? 2 : 0);
				mouse('mouseup', fingers > 1 ? 2 : 0);
				lastTap = fingers === 1 ? Date.now() : 0;
			}
			cancel();
		} else if (event.type === 'touchcancel') {
			cancel();
		}
	};

	const events = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
	for (const event of events) {
		element.addEventListener(event, handle, { capture: true, passive: false });
	}
	return {
		setMode(value: RemoteTouchMode): void {
			cancel();
			lastTap = 0;
			mode = value;
		},

		close(): void {
			cancel();
			for (const event of events) {
				element.removeEventListener(event, handle, true);
			}
			element.style.touchAction = previousTouchAction;
		},
	};
}
