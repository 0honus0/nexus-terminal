import { onBeforeUnmount, ref, type Ref } from 'vue';

export interface ResizeHandleOptions {
  width: Ref<number>;
  height: Ref<number>;
  minWidth: number;
  minHeight: number;
  maxWidth?: () => number;
  maxHeight?: () => number;
  onMove?: (size: { width: number; height: number }) => void;
  onEnd?: (size: { width: number; height: number }) => void;
}

/**
 * Business-agnostic bottom-right resize-handle mechanics.
 * Consumers own the handle markup, dimensions, persistence and feature side effects.
 */
export function useResizeHandle(options: ResizeHandleOptions) {
  const isResizing = ref(false);
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let activePointerId: number | null = null;

  const clamp = (value: number, min: number, max?: number) =>
    Math.min(Math.max(min, value), max ?? Number.POSITIVE_INFINITY);

  const handlePointerMove = (event: PointerEvent) => {
    if (!isResizing.value || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    options.width.value = clamp(startWidth + event.clientX - startX, options.minWidth, options.maxWidth?.());
    options.height.value = clamp(startHeight + event.clientY - startY, options.minHeight, options.maxHeight?.());
    options.onMove?.({ width: options.width.value, height: options.height.value });
  };

  const stopResize = (event?: PointerEvent) => {
    if (!isResizing.value || (event && activePointerId !== null && event.pointerId !== activePointerId)) return;
    isResizing.value = false;
    activePointerId = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    options.onEnd?.({ width: options.width.value, height: options.height.value });
  };

  const startResize = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    isResizing.value = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = options.width.value;
    startHeight = options.height.value;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  onBeforeUnmount(() => {
    const wasResizing = isResizing.value;
    isResizing.value = false;
    activePointerId = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    if (wasResizing) options.onEnd?.({ width: options.width.value, height: options.height.value });
  });

  return { isResizing, startResize, stopResize };
}
