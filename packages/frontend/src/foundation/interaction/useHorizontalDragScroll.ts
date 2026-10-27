import { onBeforeUnmount } from 'vue';

/** Mouse dragging complements native touch/trackpad scrolling without stealing vertical gestures. */
export const useHorizontalDragScroll = () => {
	let gesture: { element: HTMLElement; pointerId: number; x: number; scrollLeft: number } | undefined;
	let dragged = false;

	const stop = () => {
		const previous = gesture;
		gesture = undefined;
		if (previous?.element.hasPointerCapture(previous.pointerId))
			previous.element.releasePointerCapture(previous.pointerId);
	};

	const pointerdown = (event: PointerEvent) => {
		stop();
		dragged = false;
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		const element = event.currentTarget as HTMLElement;
		if (element.scrollWidth <= element.clientWidth) return;
		gesture = { element, pointerId: event.pointerId, x: event.clientX, scrollLeft: element.scrollLeft };
	};

	const pointermove = (event: PointerEvent) => {
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		if (!(event.buttons & 1)) {
			stop();
			return;
		}
		const delta = event.clientX - gesture.x;
		if (!dragged && Math.abs(delta) < 6) return;
		dragged = true;
		gesture.element.setPointerCapture(event.pointerId);
		event.preventDefault();
		gesture.element.scrollLeft = gesture.scrollLeft - delta;
	};

	const click = (event: MouseEvent) => {
		if (!dragged || event.detail === 0) return;
		event.preventDefault();
		event.stopPropagation();
		dragged = false;
	};

	onBeforeUnmount(stop);
	return { pointerdown, pointermove, pointerup: stop, pointercancel: stop, lostpointercapture: stop, click };
};
