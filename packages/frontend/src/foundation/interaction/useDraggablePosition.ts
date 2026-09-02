import { onBeforeUnmount, ref, type Ref } from 'vue';

export interface DragPosition {
  x: number;
  y: number;
}

export interface DraggablePositionOptions {
  position: Ref<DragPosition>;
  getElement: () => HTMLElement | null;
  constrain?: (position: DragPosition, element: HTMLElement, event: PointerEvent) => DragPosition;
  canStart?: (event: PointerEvent) => boolean;
  onEnd?: (position: DragPosition) => void;
}

/**
 * Shared pointer-drag mechanics for floating UI. Consumers own markup, persistence,
 * click-vs-drag behavior and the bounds policy through callbacks.
 */
export function useDraggablePosition(options: DraggablePositionOptions) {
  const dragging = ref(false);
  const didDrag = ref(false);
  let activePointerId: number | null = null;
  let offsetX = 0;
  let offsetY = 0;

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragging.value || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    const element = options.getElement();
    if (!element) return;
    didDrag.value = true;
    const next = { x: event.clientX - offsetX, y: event.clientY - offsetY };
    options.position.value = options.constrain?.(next, element, event) ?? next;
  };

  const stopDragging = (event?: PointerEvent) => {
    if (!dragging.value || (event && activePointerId !== null && event.pointerId !== activePointerId)) return;
    dragging.value = false;
    activePointerId = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    options.onEnd?.(options.position.value);
  };

  const startDragging = (event: PointerEvent) => {
    if (!event.isPrimary || options.canStart?.(event) === false) return;
    const element = options.getElement();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    dragging.value = true;
    didDrag.value = false;
    activePointerId = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    event.preventDefault();
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  };

  onBeforeUnmount(() => {
    const wasDragging = dragging.value;
    dragging.value = false;
    activePointerId = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    if (wasDragging) options.onEnd?.(options.position.value);
  });

  return { dragging, didDrag, startDragging, stopDragging };
}
