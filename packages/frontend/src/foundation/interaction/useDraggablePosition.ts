import { onBeforeUnmount, ref, type Ref } from 'vue';

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
}

/** Pointer-drag mechanics for floating UI. Markup, persistence and bounds remain consumer-owned. */
export function useDraggablePosition(options: DraggablePositionOptions) {
  const dragging = ref(false);
  const didDrag = ref(false);

  let activePointerId: number | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let previousBodyUserSelect = '';

  const removeWindowListeners = (): void => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
  };

  const restoreBodySelection = (): void => {
    document.body.style.userSelect = previousBodyUserSelect;
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragging.value || event.pointerId !== activePointerId) return;

    const element = options.getElement();
    if (!element) return;

    const proposed = { x: event.clientX - offsetX, y: event.clientY - offsetY };
    const next = options.constrain?.(proposed, element, event) ?? proposed;
    didDrag.value = true;
    options.position.value = next;
    options.onMove?.(next);
  };

  function stopDragging(event?: PointerEvent): void {
    if (!dragging.value) return;
    if (event && event.pointerId !== activePointerId) return;

    dragging.value = false;
    activePointerId = null;
    removeWindowListeners();
    restoreBodySelection();
    options.onEnd?.(options.position.value);
  }

  const startDragging = (event: PointerEvent): void => {
    if (!event.isPrimary || dragging.value || options.canStart?.(event) === false) return;

    const element = options.getElement();
    if (!element) return;

    const rect = element.getBoundingClientRect();
    activePointerId = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    didDrag.value = false;
    dragging.value = true;

    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    event.preventDefault();

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    options.onStart?.(options.position.value);
  };

  onBeforeUnmount(() => {
    const shouldNotifyEnd = dragging.value;
    dragging.value = false;
    activePointerId = null;
    removeWindowListeners();
    restoreBodySelection();
    if (shouldNotifyEnd) options.onEnd?.(options.position.value);
  });

  return { dragging, didDrag, startDragging, stopDragging };
}
