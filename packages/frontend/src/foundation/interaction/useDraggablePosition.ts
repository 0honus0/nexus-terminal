import { useEventListener } from '@vueuse/core';
import { computed, onBeforeUnmount, onDeactivated, ref, type Ref } from 'vue';

export interface DragPosition {
	x: number;
	y: number;
}

export interface DraggablePositionOptions {
	position: Ref<DragPosition>;
	getElement: () => HTMLElement | null;
	canStart?: (event: PointerEvent) => boolean;
	constrain?: (position: DragPosition, element: HTMLElement, event: PointerEvent) => DragPosition;
	onStart?: (position: DragPosition) => void;
	onMove?: (position: DragPosition) => void;
	onEnd?: (position: DragPosition) => void;
	onTap?: (event: PointerEvent) => void;
}

/** Pointer-drag mechanics for floating UI. Markup, persistence and bounds remain consumer-owned. */
export function useDraggablePosition(options: DraggablePositionOptions) {
	const dragging = ref(false);
	const didDrag = ref(false);
	const pointerActive = ref(false);

	let activePointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let moveTolerance = 0;
	let offsetX = 0;
	let offsetY = 0;
	let previousBodyUserSelect = '';

	const restoreBodySelection = (): void => {
		document.body.style.userSelect = previousBodyUserSelect;
	};

	const handlePointerMove = (event: PointerEvent): void => {
		if (!pointerActive.value || event.pointerId !== activePointerId) return;

		const element = options.getElement();
		if (!element) return;
		if (!dragging.value) {
			// Match the existing touch/pen long-press tolerance: a tap can emit
			// pointermove without becoming a drag or losing its subsequent click.
			if (Math.hypot(event.clientX - startX, event.clientY - startY) <= moveTolerance) return;
			dragging.value = true;
			previousBodyUserSelect = document.body.style.userSelect;
			document.body.style.userSelect = 'none';
			options.onStart?.(options.position.value);
		}

		const proposed = { x: event.clientX - offsetX, y: event.clientY - offsetY };
		const next = options.constrain?.(proposed, element, event) ?? proposed;
		didDrag.value = true;
		options.position.value = next;
		options.onMove?.(next);
	};

	function releaseDragging(event?: PointerEvent): boolean | null {
		if (!pointerActive.value || (event && event.pointerId !== activePointerId)) return null;

		const moved = dragging.value;
		pointerActive.value = false;
		dragging.value = false;
		activePointerId = null;
		if (moved) restoreBodySelection();
		return moved;
	}

	function stopDragging(event?: PointerEvent): void {
		const moved = releaseDragging(event);
		if (moved) options.onEnd?.(options.position.value);
		else if (
			moved === false &&
			event &&
			Math.hypot(event.clientX - startX, event.clientY - startY) <= moveTolerance
		) {
			options.onTap?.(event);
		}
	}

	function cancelDragging(event?: PointerEvent): void {
		releaseDragging(event);
	}

	const startDragging = (event: PointerEvent): void => {
		if (!event.isPrimary || event.button !== 0 || pointerActive.value || options.canStart?.(event) === false)
			return;

		const element = options.getElement();
		if (!element) return;

		const rect = element.getBoundingClientRect();
		activePointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		moveTolerance = event.pointerType === 'mouse' ? 0 : 12;
		offsetX = event.clientX - rect.left;
		offsetY = event.clientY - rect.top;
		didDrag.value = false;
		pointerActive.value = true;
		event.preventDefault();
	};

	const gestureTarget = computed(() => (pointerActive.value ? window : undefined));
	useEventListener(gestureTarget, 'pointermove', handlePointerMove);
	useEventListener(gestureTarget, 'pointerup', stopDragging);
	useEventListener(gestureTarget, 'pointercancel', cancelDragging);
	useEventListener(gestureTarget, 'blur', () => cancelDragging());
	useEventListener(document, 'visibilitychange', () => {
		if (document.hidden) cancelDragging();
	});

	onBeforeUnmount(() => cancelDragging());
	onDeactivated(() => cancelDragging());

	return { dragging, didDrag, startDragging, stopDragging, cancelDragging };
}
